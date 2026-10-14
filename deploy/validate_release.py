"""Keep image/application versions aligned; refuse mismatched release tags."""

import argparse
import json
import re
import tomllib
from pathlib import Path


def validate(root, tag=None):
    frontend = json.loads((root / "frontend/package.json").read_text())["version"]
    backend = tomllib.loads((root / "backend/pyproject.toml").read_text())["project"]["version"]
    app = re.search(r'__version__ = "([^"]+)"', (root / "backend/app/__init__.py").read_text())[1]
    assert frontend == backend == app, "Application versions must agree"
    assert re.fullmatch(r"\d+\.\d+\.\d+", app), "Use a fixed release version"
    lock = json.loads((root / "frontend/package-lock.json").read_text())
    assert lock["version"] == lock["packages"][""]["version"] == app
    if (root / "version.txt").exists():
        assert (root / "version.txt").read_text().strip() == app, "Release version must agree"
    if (root / ".release-please-manifest.json").exists():
        assert json.loads((root / ".release-please-manifest.json").read_text())["."] == app
    if (root / "backend/uv.lock").exists():
        packages = tomllib.loads((root / "backend/uv.lock").read_text())["package"]
        assert next(row["version"] for row in packages if row["name"] == "clipline-backend") == app
    if tag:
        assert tag == "v" + app, f"Tag {tag} does not match application {app}"
    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag")
    args = parser.parse_args()
    print(validate(Path(__file__).resolve().parents[1], args.tag))


if __name__ == "__main__":
    main()
