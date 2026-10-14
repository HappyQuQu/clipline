"""Inspect a candidate image without running migration or mounting user data."""

import argparse
import json
import subprocess

INSPECT = r"""
import json, importlib.metadata, os, platform, subprocess
from pathlib import Path
from app import __version__
from app.db.migrations import expected_revision
root=Path('/app')
for forbidden in ('old', 'models', 'tests', '.env', 'clipline.db', 'node_modules'):
    assert not list(root.rglob(forbidden)), forbidden
for suffix in ('*.pt','*.onnx','*.safetensors','*.mp4','*.jpg','*.sqlite3','*.log'):
    assert not list(root.rglob(suffix)), suffix
packages={dist.metadata['Name'].lower() for dist in importlib.metadata.distributions()}
forbidden_packages={'torch','transformers','ultralytics','whisper',
                    'openai-whisper','faster-whisper'}
assert not packages & forbidden_packages
assert os.getuid() != 0, 'Image must default to a non-root user'
assert (root/'static/index.html').is_file()
assert (root/'static/assets/recording-placeholder.svg').is_file()
print(json.dumps({'version': __version__, 'schema': expected_revision(),
 'arch': platform.machine(), 'uid': os.getuid(), 'noRecognitionPackages': True,
 'noPrivateOrDemoMedia': True,
 'ffmpeg': subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0]}))
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--platform")
    parser.add_argument("--version")
    args = parser.parse_args()
    command = ["docker", "run", "--rm", "--network", "none", "--entrypoint", "python"]
    if args.platform:
        command += ["--platform", args.platform]
    result = json.loads(subprocess.check_output(command + [args.image, "-c", INSPECT], text=True))
    if args.version:
        assert result["version"] == args.version, result
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
