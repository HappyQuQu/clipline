"""Validate resolved Compose mappings before starting a NAS/local deployment."""

import argparse
import json
import subprocess
from pathlib import Path


def check(service):
    mounts = {row["target"]: row for row in service["volumes"]}
    source, data = mounts["/recordings"], mounts["/app/data"]
    assert source["type"] == data["type"] == "bind"
    assert source.get("read_only") and not data.get("read_only", False)
    original = Path(source["source"]).resolve(strict=True)
    writable = Path(data["source"]).resolve(strict=True)
    assert original.is_dir() and writable.is_dir()
    assert not original.is_relative_to(writable) and not writable.is_relative_to(original), (
        "Recordings and writable application data must be separate host directories"
    )
    assert service["user"].split(":")[0].isdigit() and int(service["user"].split(":")[0]) > 0
    environment = service["environment"]
    assert environment["CLIPLINE_RECORDINGS_ROOT"] == "/recordings"
    assert environment["CLIPLINE_DATA"] == "/app/data"
    assert environment["CLIPLINE_DB"] == "/app/data/clipline.db"
    assert service.get("init") and service["restart"] == "unless-stopped"
    assert service["logging"]["options"]["max-file"] == "3"
    return {
        "image": service["image"],
        "recordingsReadOnly": True,
        "separateData": True,
        "nonRoot": True,
        "restartAndLogRotation": True,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", required=True)
    args = parser.parse_args()
    config = json.loads(
        subprocess.check_output(
            ["docker", "compose", "--env-file", args.env_file, "config", "--format", "json"],
            text=True,
        )
    )
    print(json.dumps(check(config["services"]["clipline"]), indent=2))


if __name__ == "__main__":
    main()
