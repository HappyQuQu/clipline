"""Promote only tested digests, preserving immutable versions and final stable pointers."""

import argparse
import json
import re
import subprocess
from pathlib import Path

from check_manifest import check

DIGEST = re.compile(r"sha256:[a-f0-9]{64}")
SHA = re.compile(r"[a-f0-9]{40}")
TAG = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", re.ASCII)
FIXED = re.compile(r"\d+\.\d+\.\d+")


def validate_records(image, source, version, records, metadata):
    assert SHA.fullmatch(source)
    assert set(records) == {"amd64", "arm64"}, "Both verified architecture records are required"
    assert metadata["image"] == image and metadata["source"] == source
    assert metadata["version"] == version and metadata["channel"] in {"main", "tag", "manual"}
    assert metadata["labels"]["org.opencontainers.image.revision"] == source
    assert metadata["labels"]["org.opencontainers.image.version"] == version
    refs = []
    for arch in ("amd64", "arm64"):
        record = records[arch]
        assert all(
            record.get(key) == value
            for key, value in {
                "image": image,
                "source": source,
                "version": version,
                "arch": arch,
            }.items()
        ), "Verified record does not match the final source"
        assert DIGEST.fullmatch(record["digest"])
        refs.append(image + "@" + record["digest"])
    assert len(set(refs)) == 2, "Architecture digests must be distinct"
    tags = metadata["tags"]
    assert isinstance(tags, list) and tags
    for tag in tags:
        assert isinstance(tag, str) and tag.startswith(image + ":")
        assert TAG.fullmatch(tag[len(image) + 1 :])
    return refs, list(dict.fromkeys(tags))


def contents(value):
    check(value)
    rows = [row for row in value["manifests"] if row["platform"]["architecture"] != "unknown"]
    assert len(rows) == 2, "Duplicate runtime architecture"
    return {row["platform"]["architecture"]: row["digest"] for row in rows}


def runtime_digest(value, arch, digest):
    if "manifests" not in value:
        assert value.get("schemaVersion") == 2 and "config" in value
        return digest
    rows = [
        row
        for row in value["manifests"]
        if row.get("platform", {}).get("architecture") != "unknown"
    ]
    assert (
        len(rows) == 1
        and rows[0]["platform"].get("architecture") == arch
        and rows[0]["platform"].get("os") == "linux"
    ), "Staged image has unexpected runtime platforms"
    assert DIGEST.fullmatch(rows[0]["digest"])
    return rows[0]["digest"]


def inspect(reference):
    result = subprocess.run(
        ["docker", "buildx", "imagetools", "inspect", reference, "--raw"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        message = result.stderr.lower()
        if any(text in message for text in ("not found", "manifest unknown", "no such manifest")):
            return None
        raise RuntimeError(
            "Registry inspection failed; no release tags were changed: " + result.stderr
        )
    return json.loads(result.stdout)


def publish(image, source, version, records, metadata, current_main):
    refs, tags = validate_records(image, source, version, records, metadata)
    expected = {}
    for arch, reference in zip(("amd64", "arm64"), refs, strict=True):
        value = inspect(reference)
        assert value is not None, "Verified digest is missing from registry"
        expected[arch] = runtime_digest(value, arch, records[arch]["digest"])
    if metadata["channel"] != "manual" and current_main != source:
        tags = [
            tag
            for tag in tags
            if FIXED.fullmatch(tag.split(":")[-1]) or tag == image + ":sha-" + source
        ]
        print("Newer main exists; only immutable tags will be published")
    # Preflight every immutable target before publishing any release pointer.
    immutable = [
        tag
        for tag in tags
        if FIXED.fullmatch(tag.split(":")[-1]) or tag == image + ":sha-" + source
    ]
    existing = set()
    for tag in immutable:
        value = inspect(tag)
        if value is not None:
            assert contents(value) == expected, "Immutable image tag already has different content"
            existing.add(tag)
    candidate = image + ":candidate-" + source
    subprocess.run(
        ["docker", "buildx", "imagetools", "create", "--tag", candidate] + refs, check=True
    )
    value = inspect(candidate)
    assert value is not None and contents(value) == expected, (
        "Candidate manifest differs from tested images"
    )
    # Fixed/source tags precede moving aliases; latest is always the final operation.
    ordered = immutable + [
        tag for tag in tags if tag not in immutable and not tag.endswith(":latest")
    ]
    ordered += [tag for tag in tags if tag.endswith(":latest")]
    for tag in ordered:
        if tag not in existing:
            subprocess.run(
                ["docker", "buildx", "imagetools", "create", "--tag", tag, candidate], check=True
            )
            value = inspect(tag)
            assert value is not None and contents(value) == expected, (
                "Published manifest differs from candidate"
            )
    print("Published tested amd64/arm64 digests without rebuilding: " + ", ".join(tags))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--current-main", required=True)
    parser.add_argument("--digests", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    args = parser.parse_args()
    assert {p.name for p in args.digests.glob("*.json")} == {"amd64.json", "arm64.json"}
    records = {
        arch: json.loads((args.digests / (arch + ".json")).read_text())
        for arch in ("amd64", "arm64")
    }
    publish(
        args.image,
        args.source,
        args.version,
        records,
        json.loads(args.metadata.read_text()),
        args.current_main,
    )


if __name__ == "__main__":
    main()
