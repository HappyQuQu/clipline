"""Read-only real-media checks for D1; never writes to the user's recording mount."""

import argparse
import json
import subprocess
import time
from urllib.error import URLError
from urllib.request import urlopen


def docker(*args: str) -> str:
    return subprocess.check_output(["docker", *args], text=True, timeout=90)


def get(url: str) -> dict:
    with urlopen(url, timeout=5) as response:
        return json.load(response)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", required=True)
    parser.add_argument("--url", default="http://127.0.0.1:8088")
    args = parser.parse_args()
    deadline = time.monotonic() + 40
    while True:
        try:
            state = get(args.url + "/api/health/ready")
            if state["ready"]:
                break
        except (OSError, URLError):
            pass
        if time.monotonic() > deadline:
            raise RuntimeError("Foundation API/worker did not become ready")
        time.sleep(0.5)
    container = json.loads(docker("inspect", args.container))[0]
    mounts = {item["Destination"]: item for item in container["Mounts"]}
    recordings, data = mounts["/recordings"], mounts["/app/data"]
    assert recordings["Source"] == "/Volumes/extended/clipline"
    assert recordings["RW"] is False and data["RW"] is True
    assert data["Source"] != recordings["Source"]
    flags = get(args.url + "/api/capabilities")
    assert flags["backendStage"] == "foundation"
    assert all(
        flags[key] is False
        for key in (
            "scan",
            "export",
            "prepare",
            "reindex",
            "transcription",
            "visualRecognition",
            "semanticSearch",
        )
    )
    browse = get(args.url + "/api/recording-directories?relativePath=media")
    assert browse["items"], "No real recording directory found under media"
    probe = r"""
import hashlib, importlib.metadata, json, os, subprocess
from pathlib import Path

root = Path('/recordings/media').resolve()
sample = None
visited = 0
for directory, children, files in os.walk(root, followlinks=False):
    children[:] = sorted(name for name in children if not name.startswith('.'))
    for filename in sorted(files):
        visited += 1
        if visited > 20_000:
            raise RuntimeError('No sample found within the bounded media search')
        candidate = (Path(directory) / filename).resolve()
        if candidate.is_relative_to(root) and candidate.is_file() and candidate.suffix.lower() in {
            '.mp4', '.mkv', '.mov', '.ts'
        }:
            sample = candidate
            break
    if sample is not None:
        break
if sample is None:
    raise RuntimeError('No real video sample available')

def fingerprint(path):
    sha = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(chunk)
    return sha.hexdigest()

before = fingerprint(sample)
info = json.loads(subprocess.check_output([
    'ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(sample)
], text=True, timeout=30))
output = Path('/app/data/tmp/d1-media-probe.jpg')
subprocess.run([
    'ffmpeg', '-v', 'error', '-threads', '2', '-i', str(sample),
    '-frames:v', '1', '-y', str(output)
], check=True, timeout=30, capture_output=True)
assert fingerprint(sample) == before
assert output.stat().st_size > 0
packages = {item.metadata['Name'].lower() for item in importlib.metadata.distributions()}
assert not packages & {'torch', 'torchaudio', 'funasr', 'openai-whisper', 'onnxruntime'}
assert not Path('/app/data/models').exists()
video = next(item for item in info['streams'] if item['codec_type'] == 'video')
print(json.dumps({
    'sourceUnchanged': True, 'frameCreated': True,
    'videoCodec': video['codec_name'], 'durationSeconds': float(info['format']['duration']),
    'frameBytes': output.stat().st_size, 'recognitionPackagesInstalled': False
}))
"""
    media = json.loads(docker("exec", args.container, "python", "-c", probe))
    host_arch = docker("info", "--format", "{{.Architecture}}").strip()
    normalized = {"aarch64": "arm64", "arm64": "arm64", "x86_64": "amd64", "amd64": "amd64"}
    execution = (
        "native" if normalized.get(host_arch) == normalized.get(flags["arch"]) else "emulated"
    )
    print(
        json.dumps(
            {
                "ready": True,
                "arch": flags["arch"],
                "execution": execution,
                "readOnlyRecordingMount": True,
                "separateWritableData": True,
                "realSourceDirectories": len(browse["items"]),
                "media": media,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
