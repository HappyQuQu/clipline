"""Resolve release channels before building images; no registry writes."""

import argparse
import json
import re
import subprocess
from pathlib import Path

from validate_release import validate

TAG = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", re.ASCII)
VERSION_TAG = re.compile(r"v?\d+(?:\.\d+){0,2}")


def check_input(event, ref, tag):
    if event != "workflow_dispatch":
        return
    if tag == "release":
        assert re.fullmatch(r"refs/tags/v\d+\.\d+\.\d+", ref), (
            "Manual release requires an existing vX.Y.Z Git tag"
        )
        return
    assert TAG.fullmatch(tag), "Invalid Docker preview tag"
    assert tag != "latest" and not VERSION_TAG.fullmatch(tag), (
        "Use image_tag=release on a version tag to publish stable versions"
    )
    assert not tag.startswith(("sha-", "candidate-")), "Reserved pipeline tag"


def metadata(image, source, version, event, ref, manual="edge", release_created=False):
    assert re.fullmatch(r"[a-z0-9]+(?:[._-][a-z0-9]+)*/[a-z0-9]+(?:[._-][a-z0-9]+)*", image)
    assert re.fullmatch(r"[a-f0-9]{40}", source)
    assert re.fullmatch(r"\d+\.\d+\.\d+", version)
    check_input(event, ref, manual)
    if event == "workflow_dispatch" and manual != "release":
        channel, names = "manual", [manual]
    elif ref.startswith("refs/tags/"):
        assert ref == "refs/tags/v" + version, "Git tag and application version differ"
        channel, names = "tag", [version, ".".join(version.split(".")[:2]), "latest"]
    else:
        assert event == "push" and ref == "refs/heads/main"
        channel, names = "main", ["edge", "latest"]
        if release_created:
            names = [version, ".".join(version.split(".")[:2])] + names
    return {
        "channel": channel,
        "image": image,
        "source": source,
        "version": version,
        "tags": [image + ":" + name for name in dict.fromkeys(names + ["sha-" + source])],
        "labels": {
            "org.opencontainers.image.source": "https://github.com/HappyQuQu/clipline",
            "org.opencontainers.image.revision": source,
            "org.opencontainers.image.version": version,
            "org.opencontainers.image.title": "Clipline",
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-input", action="store_true")
    parser.add_argument("--labels", type=Path)
    parser.add_argument("--image")
    parser.add_argument("--source")
    parser.add_argument("--event")
    parser.add_argument("--ref")
    parser.add_argument("--manual", default="edge")
    parser.add_argument("--release-created", default="false")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.check_input:
        check_input(args.event, args.ref, args.manual)
    elif args.labels:
        value = json.loads(args.labels.read_text())
        assert (
            value["source"]
            == subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        )
        assert value["version"] == validate(Path.cwd())
        print("labels<<CLIPLINE_OCI_LABELS")
        print("\n".join(key + "=" + text for key, text in value["labels"].items()))
        print("CLIPLINE_OCI_LABELS")
    else:
        value = metadata(
            args.image,
            args.source,
            validate(Path.cwd()),
            args.event,
            args.ref,
            args.manual,
            args.release_created == "true",
        )
        args.output.write_text(json.dumps(value, indent=2))


if __name__ == "__main__":
    main()
