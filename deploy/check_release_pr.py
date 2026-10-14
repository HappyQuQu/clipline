"""Validate the generated version-only PR before its automatic merge."""

import argparse
import base64
import copy
import json
import re
import subprocess
import tomllib
from pathlib import Path

FILES = {
    "version.txt",
    ".release-please-manifest.json",
    "CHANGELOG.md",
    "frontend/package.json",
    "frontend/package-lock.json",
    "backend/pyproject.toml",
    "backend/uv.lock",
    "backend/app/__init__.py",
}


def normalized(path, content):
    if path == "version.txt":
        assert re.fullmatch(r"\d+\.\d+\.\d+\s*", content)
        return None
    if path == "backend/app/__init__.py":
        return re.sub(r'(__version__ = ")[^"]+(".*)', r"\1VERSION\2", content)
    value = tomllib.loads(content) if path.endswith((".toml", ".lock")) else json.loads(content)
    value = copy.deepcopy(value)
    if path == "frontend/package-lock.json":
        value["version"] = value["packages"][""]["version"] = "VERSION"
    elif path == "backend/pyproject.toml":
        value["project"]["version"] = "VERSION"
    elif path == "backend/uv.lock":
        next(row for row in value["package"] if row["name"] == "clipline-backend")["version"] = (
            "VERSION"
        )
    elif path == ".release-please-manifest.json":
        value["."] = "VERSION"
    else:
        value["version"] = "VERSION"
    return value


def check_changes(before, after):
    assert set(after) <= FILES, "Release PR contains unexpected files"
    assert "version.txt" in after and ".release-please-manifest.json" in after
    version = after["version.txt"].strip()
    assert re.fullmatch(r"\d+\.\d+\.\d+", version)
    previous = before["version.txt"].strip()
    assert tuple(map(int, version.split("."))) > tuple(map(int, previous.split("."))), (
        "Release version must increase"
    )
    for path, content in after.items():
        if path == "CHANGELOG.md":
            continue
        assert normalized(path, before[path]) == normalized(path, content), (
            "Release PR changes more than the version: " + path
        )
    return version


def api(route):
    return json.loads(subprocess.check_output(["gh", "api", route], text=True))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    pr = api(f"repos/{args.repo}/pulls/{args.pr}")
    assert pr["state"] == "open" and pr["user"]["login"] == "github-actions[bot]"
    assert pr["base"]["ref"] == "main" and pr["base"]["sha"] == args.source
    assert pr["head"]["repo"]["full_name"] == args.repo
    assert pr["head"]["ref"].startswith("release-please--branches--main")
    assert pr["changed_files"] <= len(FILES)
    files = api(f"repos/{args.repo}/pulls/{args.pr}/files?per_page=100")
    before, after = {}, {}
    for file in files:
        path = file["filename"]
        assert path in FILES and file["status"] in ("modified", "added")
        if path != "CHANGELOG.md":
            before[path] = Path(path).read_text()
        entry = api(f"repos/{args.repo}/contents/{path}?ref={pr['head']['sha']}")
        after[path] = base64.b64decode(entry["content"]).decode()
    version = check_changes(before, after)
    # Check all version fields, including unchanged files, against the proposed release.
    import tempfile

    from validate_release import validate

    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        for path in FILES - {"CHANGELOG.md"}:
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(after.get(path, Path(path).read_text()))
        assert validate(root) == version
    title = pr["title"].removesuffix(" [skip ci]")
    assert "\n" not in title and "\r" not in title
    args.output.write_text(f"head={pr['head']['sha']}\ntitle={title}\n")


if __name__ == "__main__":
    main()
