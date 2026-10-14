"""Require both Linux runtime architectures before changing release pointers."""

import argparse
import json
import re


def check(manifest):
    platforms = {
        (row.get("platform", {}).get("os"), row.get("platform", {}).get("architecture"))
        for row in manifest["manifests"]
        if row.get("platform", {}).get("architecture") != "unknown"
    }
    assert platforms == {("linux", "amd64"), ("linux", "arm64")}, platforms
    for row in manifest["manifests"]:
        assert re.fullmatch(r"sha256:[0-9a-f]{64}", row["digest"])
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest")
    parser.add_argument("--existing")
    args = parser.parse_args()
    with open(args.manifest) as handle:
        manifest = json.load(handle)
    check(manifest)
    if args.existing:
        with open(args.existing) as handle:
            existing = json.load(handle)
        check(existing)

        def contents(value):
            return {
                (row["platform"]["architecture"], row["digest"])
                for row in value["manifests"]
                if row["platform"]["architecture"] != "unknown"
            }

        assert contents(manifest) == contents(existing), (
            "Fixed version already has different content"
        )
    print("Linux amd64/arm64 candidate manifest verified")
