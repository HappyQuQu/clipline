"""Release gates prevent promoting an incomplete or mismatched candidate."""

import importlib.util
import json
from pathlib import Path

import pytest


def module(name):
    path = Path(__file__).resolve().parents[2] / "deploy" / (name + ".py")
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def test_release_manifest_rejects_missing_foreign_platform_and_invalid_digest():
    check = module("check_manifest").check
    digest = "sha256:" + "a" * 64
    manifests = [
        {"platform": {"os": "linux", "architecture": arch}, "digest": digest}
        for arch in ("amd64", "arm64")
    ]
    assert check({"manifests": manifests})
    for invalid in (
        manifests[:1],
        manifests + [{"platform": {"os": "linux", "architecture": "386"}, "digest": digest}],
        [manifests[0], manifests[1] | {"digest": "sha256:incomplete"}],
    ):
        with pytest.raises(AssertionError):
            check({"manifests": invalid})


def test_release_tag_and_lock_must_match_application(tmp_path):
    validate = module("validate_release").validate
    (tmp_path / "frontend").mkdir()
    (tmp_path / "backend/app").mkdir(parents=True)
    (tmp_path / "frontend/package.json").write_text('{"version":"0.7.0"}')
    lock = {"version": "0.7.0", "packages": {"": {"version": "0.7.0"}}}
    (tmp_path / "frontend/package-lock.json").write_text(json.dumps(lock))
    (tmp_path / "backend/pyproject.toml").write_text('[project]\nversion="0.7.0"')
    (tmp_path / "backend/app/__init__.py").write_text('__version__ = "0.7.0"')
    assert validate(tmp_path, "v0.7.0") == "0.7.0"
    with pytest.raises(AssertionError):
        validate(tmp_path, "v0.6.0")
    lock["packages"][""]["version"] = "0.6.0"
    (tmp_path / "frontend/package-lock.json").write_text(json.dumps(lock))
    with pytest.raises(AssertionError):
        validate(tmp_path)


def test_deployment_rejects_writable_inputs_nested_data_and_root(tmp_path):
    check = module("check_deployment").check
    original, data = tmp_path / "recordings", tmp_path / "data"
    original.mkdir()
    data.mkdir()
    service = {
        "volumes": [
            {"target": "/recordings", "source": str(original), "type": "bind", "read_only": True},
            {"target": "/app/data", "source": str(data), "type": "bind"},
        ],
        "user": "1001:1001",
        "environment": {
            "CLIPLINE_RECORDINGS_ROOT": "/recordings",
            "CLIPLINE_DATA": "/app/data",
            "CLIPLINE_DB": "/app/data/clipline.db",
        },
        "init": True,
        "restart": "unless-stopped",
        "logging": {"options": {"max-file": "3"}},
        "image": "clipline:ci",
    }
    assert check(service)["recordingsReadOnly"]
    service["volumes"][0]["read_only"] = False
    with pytest.raises(AssertionError):
        check(service)
    service["volumes"][0]["read_only"] = True
    nested = original / "nested"
    nested.mkdir()
    service["volumes"][1]["source"] = str(nested)
    with pytest.raises(AssertionError):
        check(service)
    service["volumes"][1]["source"] = str(data)
    service["user"] = "0:0"
    with pytest.raises(AssertionError):
        check(service)


@pytest.fixture
def publication(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "deploy"))
    return module("publish_manifest")


def release_records():
    image, source, version = "evanqu/clipline", "a" * 40, "0.8.0"
    records = {
        arch: dict(
            image=image, source=source, version=version, arch=arch, digest="sha256:" + char * 64
        )
        for arch, char in [("amd64", "b"), ("arm64", "c")]
    }
    return image, source, version, records


def metadata_module(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "deploy"))
    return module("release_metadata")


def test_release_channels_and_manual_recovery(monkeypatch):
    tools = metadata_module(monkeypatch)
    image, source, version, _ = release_records()
    main = tools.metadata(image, source, version, "push", "refs/heads/main", release_created=True)
    assert main["tags"][:4] == [image + ":" + tag for tag in ["0.8.0", "0.8", "edge", "latest"]]
    preview = tools.metadata(
        image, source, version, "workflow_dispatch", "refs/heads/dev", "testing"
    )
    assert preview["channel"] == "manual" and image + ":latest" not in preview["tags"]
    retry = tools.metadata(
        image, source, version, "workflow_dispatch", "refs/tags/v0.8.0", "release"
    )
    assert retry["channel"] == "tag" and image + ":0.8.0" in retry["tags"]
    for tag in ["latest", "0.8.0", "0.8", "v0.8.0", "sha-test", "candidate-test", "bad tag"]:
        with pytest.raises(AssertionError):
            tools.check_input("workflow_dispatch", "refs/heads/dev", tag)
    with pytest.raises(AssertionError):
        tools.check_input("workflow_dispatch", "refs/heads/main", "release")
    with pytest.raises(AssertionError):
        tools.metadata(image, source, version, "push", "refs/tags/v0.7.0")


def candidate_manifest(records):
    return {
        "manifests": [
            dict(platform=dict(os="linux", architecture=arch), digest=row["digest"])
            for arch, row in records.items()
        ]
    }


def test_publication_requires_exact_source_version_and_two_architectures(publication, monkeypatch):
    image, source, version, records = release_records()
    data = metadata_module(monkeypatch).metadata(
        image, source, version, "push", "refs/heads/main", release_created=True
    )
    assert len(publication.validate_records(image, source, version, records, data)[0]) == 2
    for invalid in [
        dict(amd64=records["amd64"]),
        records | {"arm64": records["arm64"] | {"source": "d" * 40}},
        records | {"arm64": records["arm64"] | {"version": "0.7.0"}},
        records | {"arm64": records["arm64"] | {"digest": records["amd64"]["digest"]}},
    ]:
        with pytest.raises(AssertionError):
            publication.validate_records(image, source, version, invalid, data)
    with pytest.raises(AssertionError):
        publication.validate_records(
            image, source, version, records, data | {"tags": ["other/image:latest"]}
        )


def test_attested_architecture_digest_is_flattened_without_foreign_or_duplicate_runtime(
    publication,
):
    root, runtime = "sha256:" + "b" * 64, "sha256:" + "d" * 64
    value = {
        "manifests": [
            dict(platform=dict(os="linux", architecture="arm64"), digest=runtime),
            dict(platform=dict(os="unknown", architecture="unknown"), digest=root),
        ]
    }
    assert publication.runtime_digest(value, "arm64", root) == runtime
    value["manifests"][0]["platform"]["variant"] = "v8"
    assert publication.runtime_digest(value, "arm64", root) == runtime
    with pytest.raises(AssertionError):
        publication.runtime_digest(value, "amd64", root)
    with pytest.raises(AssertionError):
        publication.runtime_digest({"manifests": value["manifests"] * 2}, "arm64", root)


def test_fixed_tag_conflict_is_rejected_before_any_registry_write(publication, monkeypatch):
    image, source, version, records = release_records()
    data = metadata_module(monkeypatch).metadata(
        image, source, version, "push", "refs/heads/main", release_created=True
    )
    conflict = candidate_manifest(
        records | {"arm64": records["arm64"] | {"digest": "sha256:" + "e" * 64}}
    )
    monkeypatch.setattr(
        publication,
        "inspect",
        lambda ref: conflict if ref == image + ":0.8.0" else {"schemaVersion": 2, "config": {}},
    )
    calls = []
    monkeypatch.setattr(publication.subprocess, "run", lambda *a, **kw: calls.append(a))
    with pytest.raises(AssertionError, match="Immutable"):
        publication.publish(image, source, version, records, data, source)
    assert not calls


def test_latest_is_last_and_only_tested_manifest_is_promoted(publication, monkeypatch):
    image, source, version, records = release_records()
    data = metadata_module(monkeypatch).metadata(
        image, source, version, "push", "refs/heads/main", release_created=True
    )
    manifest, created, calls = candidate_manifest(records), set(), []

    def inspect(ref):
        return (
            manifest
            if ref in created
            else {"schemaVersion": 2, "config": {}}
            if "@" in ref
            else None
        )

    def run(command, **kwargs):
        calls.append(command)
        created.add(command[command.index("--tag") + 1])

    monkeypatch.setattr(publication, "inspect", inspect)
    monkeypatch.setattr(publication.subprocess, "run", run)
    publication.publish(image, source, version, records, data, source)
    assert calls[-1][calls[-1].index("--tag") + 1] == image + ":latest"
    assert all(command[:4] == ["docker", "buildx", "imagetools", "create"] for command in calls)
    assert calls[0][-2:] == [image + "@" + records[arch]["digest"] for arch in ["amd64", "arm64"]]


def test_superseded_main_cannot_move_latest_edge_or_minor(publication, monkeypatch):
    image, source, version, records = release_records()
    data = metadata_module(monkeypatch).metadata(
        image, source, version, "push", "refs/heads/main", release_created=True
    )
    manifest, created = candidate_manifest(records), set()
    monkeypatch.setattr(
        publication,
        "inspect",
        lambda ref: (
            manifest
            if ref in created
            else {"schemaVersion": 2, "config": {}}
            if "@" in ref
            else None
        ),
    )
    monkeypatch.setattr(
        publication.subprocess,
        "run",
        lambda command, **kw: created.add(command[command.index("--tag") + 1]),
    )
    publication.publish(image, source, version, records, data, "d" * 40)
    assert image + ":0.8.0" in created
    assert not created & {image + ":latest", image + ":edge", image + ":0.8"}


def test_generated_release_cannot_change_dependencies_or_unexpected_files(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "deploy"))
    tools = module("check_release_pr")
    before = {
        "version.txt": "0.7.0\n",
        ".release-please-manifest.json": '{".":"0.7.0"}',
        "frontend/package.json": '{"version":"0.7.0","dependencies":{"react":"19.2.0"}}',
    }
    after = {path: content.replace("0.7.0", "0.8.0") for path, content in before.items()}
    assert tools.check_changes(before, after) == "0.8.0"
    with pytest.raises(AssertionError):
        tools.check_changes(
            before,
            after
            | {"frontend/package.json": after["frontend/package.json"].replace("19.2.0", "20.0.0")},
        )
    with pytest.raises(AssertionError):
        tools.check_changes(before, after | {"Dockerfile": "unexpected"})
    with pytest.raises(AssertionError):
        tools.check_changes(before, before)
    with pytest.raises(AssertionError):
        tools.check_changes(
            before, {path: content.replace("0.7.0", "0.6.0") for path, content in before.items()}
        )


def test_new_release_version_and_uv_lock_are_checked(tmp_path):
    root = Path(__file__).resolve().parents[2]
    for path in [
        "frontend/package.json",
        "frontend/package-lock.json",
        "backend/pyproject.toml",
        "backend/uv.lock",
        "backend/app/__init__.py",
        "version.txt",
        ".release-please-manifest.json",
    ]:
        destination = tmp_path / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text((root / path).read_text())
    validate = module("validate_release").validate
    version = validate(root)
    other = "999.0.0" if version != "999.0.0" else "998.0.0"
    assert validate(tmp_path) == version
    (tmp_path / "version.txt").write_text(other + "\n")
    with pytest.raises(AssertionError):
        validate(tmp_path)
    (tmp_path / "version.txt").write_text(version + "\n")
    path = tmp_path / "backend/uv.lock"
    path.write_text(
        path.read_text().replace(
            f'name = "clipline-backend"\nversion = "{version}"',
            f'name = "clipline-backend"\nversion = "{other}"',
        )
    )
    with pytest.raises(AssertionError):
        validate(tmp_path)
