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
