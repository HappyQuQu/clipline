#!/usr/bin/env python3
"""Download the smallest ASR model and run one real isolated transcription.

This release check requires network access, FFmpeg and macOS `say`. All model, database,
recording and output files live under one temporary directory and are removed afterward.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def request_json(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    expected: int = 200,
) -> dict[str, Any]:
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=body,
        method=method,
        headers={"Content-Type": "application/json"} if body is not None else {},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            content = response.read()
            if response.status != expected:
                raise AssertionError(f"{method} {path}: expected {expected}, got {response.status}")
    except urllib.error.HTTPError as exc:
        content = exc.read()
        if exc.code != expected:
            raise AssertionError(
                f"{method} {path}: expected {expected}, got {exc.code}: "
                f"{content.decode(errors='replace')}"
            ) from exc
    return json.loads(content) if content else {}


def wait_until(
    description: str,
    callback: Callable[[], dict[str, Any] | None],
    *,
    timeout: float,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        last = callback()
        if last is not None:
            return last
        time.sleep(0.5)
    raise AssertionError(f"Timed out waiting for {description}; last={last}")


def make_spoken_fixture(recordings: Path) -> Path:
    speech = recordings / "speech.aiff"
    output = recordings / "20260731_140000.mp4"
    subprocess.run(
        [
            "say",
            "-v",
            "Samantha",
            "-r",
            "150",
            "-o",
            str(speech),
            "Hello world. This is a real Clipline speech recognition test.",
        ],
        check=True,
    )
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x1f2937:size=640x360:rate=24",
            "-i",
            str(speech),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            "-movflags",
            "+faststart",
            str(output),
        ],
        check=True,
    )
    speech.unlink()
    return output


def main() -> int:
    for command in ("ffmpeg", "ffprobe", "say"):
        if not shutil.which(command):
            raise SystemExit(f"{command} is required")

    with tempfile.TemporaryDirectory(prefix="clipline-model-runtime-") as temp_value:
        temp_root = Path(temp_value)
        data_root = temp_root / "data"
        recordings = temp_root / "recordings"
        recordings.mkdir(parents=True)
        fixture = make_spoken_fixture(recordings)
        port = free_port()
        base_url = f"http://127.0.0.1:{port}"
        environment = os.environ.copy()
        environment.update(
            {
                "CLIPLINE_DATA": str(data_root),
                "CLIPLINE_DB": str(data_root / "clipline.db"),
                "CLIPLINE_MODEL_CACHE_DIR": str(data_root / "models"),
                "CLIPLINE_RECORDINGS_ROOT": str(recordings),
                "CLIPLINE_SKIP_RECENT_SECONDS": "0",
                "CLIPLINE_LOG_LEVEL": "WARNING",
            }
        )
        server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=BACKEND_ROOT,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        summary: dict[str, Any] = {"isolated": True, "fixture": fixture.name}
        try:
            def backend_ready() -> dict[str, Any] | None:
                if server.poll() is not None:
                    stderr = server.stderr.read() if server.stderr else ""
                    raise AssertionError(f"Isolated backend exited during startup: {stderr[-4000:]}")
                try:
                    return request_json(base_url, "/api/health")
                except urllib.error.URLError:
                    return None

            wait_until(
                "backend startup",
                backend_ready,
                timeout=30,
            )
            request_json(
                base_url,
                "/api/settings",
                method="PATCH",
                payload={
                    "asr_model": "whisper",
                    "asr_model_size": "tiny",
                    "asr_device": "cpu",
                    "asr_language": "en",
                },
            )
            download = request_json(
                base_url, "/api/settings/asr/models/whisper%3Atiny/download", method="POST"
            )
            assert download["status"] in {"downloading", "already_downloading"}, download

            def download_finished() -> dict[str, Any] | None:
                status = request_json(
                    base_url, "/api/settings/asr/models/whisper%3Atiny/status"
                )
                return status if status["status"] in {"completed", "failed"} else None

            download_status = wait_until("Whisper tiny download", download_finished, timeout=900)
            assert download_status["status"] == "completed", download_status
            model_path = data_root / "models" / "whisper" / "tiny.pt"
            assert model_path.exists() and model_path.stat().st_size > 1_000_000
            summary["download"] = {"model": "whisper:tiny", "bytes": model_path.stat().st_size}

            source = request_json(
                base_url,
                "/api/sources",
                method="POST",
                payload={"name": "runtime-smoke", "path": str(recordings)},
            )

            def scan_finished() -> dict[str, Any] | None:
                status = request_json(base_url, f"/api/scan-jobs/{source['scanJobId']}")
                return status if status["status"] in {"completed", "failed"} else None

            scan = wait_until("fixture scan", scan_finished, timeout=60)
            assert scan["status"] == "completed", scan
            segments = request_json(base_url, f"/api/segments?sourceId={source['id']}")
            assert segments["total"] == 1, segments
            segment_id = segments["items"][0]["id"]
            job = request_json(
                base_url, f"/api/segments/{segment_id}/transcribe", method="POST"
            )

            def transcription_finished() -> dict[str, Any] | None:
                status = request_json(base_url, f"/api/transcription-jobs/{job['id']}")
                return status if status["status"] in {"completed", "failed"} else None

            transcription = wait_until(
                "real Whisper transcription", transcription_finished, timeout=300
            )
            assert transcription["status"] == "completed", transcription
            transcript = request_json(base_url, f"/api/segments/{segment_id}/transcription")
            text = " ".join(item["text"].strip() for item in transcript["items"] if item["text"].strip())
            assert text, transcript
            summary["transcription"] = {"status": "completed", "text": text}

            request_json(
                base_url,
                "/api/settings",
                method="PATCH",
                payload={"asr_model": "funasr", "asr_model_size": "base"},
            )
            reload_result = request_json(base_url, "/api/settings/models/reload", method="POST")
            assert reload_result["reloaded"] is True
            deleted = request_json(
                base_url, "/api/settings/asr/models/whisper%3Atiny", method="DELETE"
            )
            assert deleted == {"deleted": True} and not model_path.exists()
            summary["cleanup"] = "runtime reloaded; downloaded model deleted; temporary root pending teardown"
            print(json.dumps(summary, ensure_ascii=False, indent=2))
            return 0
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)
            if server.returncode not in (0, -15):
                stderr = server.stderr.read() if server.stderr else ""
                if stderr:
                    print(stderr[-4000:], file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
