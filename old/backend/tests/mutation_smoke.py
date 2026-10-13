#!/usr/bin/env python3
"""Run destructive API smoke checks against an isolated temporary Clipline instance.

The script never touches the configured production database or recording directories. It
creates a short H.264/AAC fixture, boots uvicorn with temporary CLIPLINE_DATA/DB roots,
exercises mutation paths, and removes the entire fixture after the server stops.
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
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable


BACKEND_ROOT = Path(__file__).resolve().parents[1]
TERMINAL_JOB_STATES = {"completed", "failed"}


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
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status != expected:
                raise AssertionError(f"{method} {path}: expected {expected}, got {response.status}")
            content = response.read()
    except urllib.error.HTTPError as exc:
        content = exc.read().decode(errors="replace")
        if exc.code != expected:
            raise AssertionError(
                f"{method} {path}: expected {expected}, got {exc.code}: {content}"
            ) from exc
        return json.loads(content) if content else {}
    return json.loads(content) if content else {}


def wait_until(
    description: str,
    callback: Callable[[], dict[str, Any] | None],
    *,
    timeout: float = 45,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        last = callback()
        if last is not None:
            return last
        time.sleep(0.25)
    raise AssertionError(f"Timed out waiting for {description}; last={last}")


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def make_fixture(recordings: Path) -> Path:
    output = recordings / "20260731_120000.mp4"
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=24:duration=6",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=16000:duration=6",
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
    ]
    subprocess.run(command, check=True, cwd=BACKEND_ROOT)
    return output


def make_incompatible_fixture(recordings: Path) -> Path:
    output = recordings / "20260731_130000.mp4"
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=24:duration=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=660:sample_rate=48000:duration=3",
        "-c:v",
        "libx265",
        "-x265-params",
        "pools=1:frame-threads=1:log-level=error",
        "-pix_fmt",
        "yuv420p",
        "-tag:v",
        "hvc1",
        "-c:a",
        "libopus",
        "-shortest",
        str(output),
    ]
    subprocess.run(command, check=True, cwd=BACKEND_ROOT)
    return output


def poll_job(base_url: str, path: str, *, timeout: float = 90) -> dict[str, Any]:
    def probe() -> dict[str, Any] | None:
        job = request_json(base_url, path)
        return job if job.get("status") in TERMINAL_JOB_STATES else None

    return wait_until(path, probe, timeout=timeout)


def download_bytes(base_url: str, path: str) -> bytes:
    with urllib.request.urlopen(f"{base_url}{path}", timeout=30) as response:
        if response.status != 200:
            raise AssertionError(f"GET {path}: expected 200, got {response.status}")
        return response.read()


def download_range(base_url: str, path: str, start: int, end: int) -> tuple[int, bytes, str | None]:
    request = urllib.request.Request(
        f"{base_url}{path}", headers={"Range": f"bytes={start}-{end}"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.status, response.read(), response.headers.get("Content-Range")


def wait_for_server(base_url: str, server: subprocess.Popen[str]) -> dict[str, Any]:
    def probe() -> dict[str, Any] | None:
        if server.poll() is not None:
            stderr = server.stderr.read() if server.stderr else ""
            raise AssertionError(f"Isolated backend exited during startup: {stderr[-4000:]}")
        try:
            return request_json(base_url, "/api/system/status")
        except urllib.error.URLError:
            return None

    return wait_until("isolated backend startup", probe, timeout=30)


def main() -> int:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise SystemExit("ffmpeg and ffprobe are required")

    with tempfile.TemporaryDirectory(prefix="clipline-mutation-smoke-") as temp_value:
        temp_root = Path(temp_value)
        data_root = temp_root / "data"
        recordings = temp_root / "recordings"
        recordings.mkdir(parents=True)
        fixture = make_fixture(recordings)
        port = free_port()
        base_url = f"http://127.0.0.1:{port}"
        environment = os.environ.copy()
        environment.update(
            {
                "CLIPLINE_DATA": str(data_root),
                "CLIPLINE_DB": str(data_root / "clipline.db"),
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
            wait_for_server(base_url, server)

            source = request_json(
                base_url,
                "/api/sources",
                method="POST",
                payload={"name": "mutation-smoke", "path": str(recordings), "scanIntervalMinutes": 0},
            )
            source_id = source["id"]
            scan_id = source["scanJobId"]
            scan = poll_job(base_url, f"/api/scan-jobs/{scan_id}")
            assert scan["status"] == "completed", scan

            def indexed_fixture() -> dict[str, Any] | None:
                response = request_json(base_url, f"/api/segments?sourceId={source_id}")
                return response if response.get("total") == 1 else None

            segments = wait_until("fixture indexing", indexed_fixture)
            segment = segments["items"][0]
            assert segment["scanStatus"] == "indexed", segment
            assert segment["videoCodec"] == "h264", segment
            assert segment["audioCodec"] == "aac", segment
            summary["scan"] = {"status": scan["status"], "indexed": scan["indexedFiles"]}

            updated = request_json(
                base_url,
                f"/api/sources/{source_id}",
                method="PATCH",
                payload={
                    "scanIntervalMinutes": 15,
                    "recognitionPriority": "high",
                    "detectConfidence": 67,
                },
            )
            assert updated["scanIntervalMinutes"] == 15, updated
            assert updated["recognitionPriority"] == "high", updated
            assert updated["detectConfidence"] == 67, updated

            scan_request = request_json(base_url, f"/api/sources/{source_id}/scan", method="POST")
            rescan = poll_job(base_url, f"/api/scan-jobs/{scan_request['scanJobId']}")
            assert rescan["status"] == "completed", rescan
            summary["sourceUpdateAndRescan"] = "completed"

            settings = request_json(
                base_url,
                "/api/settings",
                method="PATCH",
                payload={"max_export_minutes": 12, "thumbnail_mode": "middle"},
            )
            assert settings["export"]["max_export_minutes"] == 12, settings
            assert (data_root / "settings.json").exists()
            summary["settingsSave"] = "persisted"

            start = datetime.fromisoformat(segment["startTime"]) + timedelta(seconds=1)
            end = start + timedelta(seconds=3)
            for mode in ("fast", "accurate"):
                created = request_json(
                    base_url,
                    "/api/exports",
                    method="POST",
                    payload={
                        "sourceId": source_id,
                        "startTime": start.isoformat(),
                        "endTime": end.isoformat(),
                        "mode": mode,
                    },
                )
                export = poll_job(base_url, f"/api/exports/{created['exportId']}")
                assert export["status"] == "completed", export
                content = download_bytes(base_url, export["downloadUrl"])
                assert len(content) > 1024, len(content)
                summary[f"export:{mode}"] = {"status": export["status"], "bytes": len(content)}

            transcription = request_json(
                base_url, f"/api/segments/{segment['id']}/transcribe", method="POST"
            )
            transcription = poll_job(
                base_url, f"/api/transcription-jobs/{transcription['id']}", timeout=120
            )
            assert transcription["status"] in TERMINAL_JOB_STATES, transcription
            summary["transcription"] = {
                "status": transcription["status"],
                "errorSurfaced": bool(transcription.get("errorMessage")),
            }
            request_json(
                base_url, f"/api/segments/{segment['id']}/transcription", method="DELETE"
            )

            vision = request_json(base_url, f"/api/segments/{segment['id']}/vision", method="POST")
            vision = poll_job(base_url, f"/api/vision-jobs/{vision['id']}", timeout=120)
            assert vision["status"] in TERMINAL_JOB_STATES, vision
            summary["vision"] = {
                "status": vision["status"],
                "errorSurfaced": bool(vision.get("errorMessage")),
            }
            request_json(base_url, f"/api/segments/{segment['id']}/vision", method="DELETE")

            models = request_json(base_url, "/api/settings/asr/models")
            assert models.get("models"), models
            active_delete = request_json(
                base_url,
                "/api/settings/asr/models/funasr%3Amedium",
                method="DELETE",
                expected=409,
            )
            assert "使用中" in active_delete.get("detail", ""), active_delete
            invalid_delete = request_json(
                base_url,
                "/api/settings/asr/models/not-a-model",
                method="DELETE",
                expected=400,
            )
            assert invalid_delete.get("detail"), invalid_delete
            whisper_fixture = data_root / "models" / "whisper" / "tiny.pt"
            whisper_fixture.parent.mkdir(parents=True, exist_ok=True)
            whisper_fixture.write_bytes(b"isolated fake model cache")
            cached_models = request_json(base_url, "/api/settings/asr/models")["models"]
            whisper_tiny = next(model for model in cached_models if model["id"] == "whisper:tiny")
            assert whisper_tiny["downloaded"] is True, whisper_tiny
            deleted_model = request_json(
                base_url, "/api/settings/asr/models/whisper%3Atiny", method="DELETE"
            )
            assert deleted_model == {"deleted": True}, deleted_model
            assert not whisper_fixture.exists()
            reload_result = request_json(base_url, "/api/settings/models/reload", method="POST")
            assert reload_result["reloaded"] is True, reload_result
            assert reload_result["asr"]["loaded"] is False, reload_result
            summary["modelLifecycle"] = {
                "activeDelete": "rejected",
                "cachedDelete": "completed",
                "runtimeReload": "invalidated",
            }

            incompatible_fixture = make_incompatible_fixture(recordings)
            proxy_scan_request = request_json(base_url, f"/api/sources/{source_id}/scan", method="POST")
            proxy_scan = poll_job(base_url, f"/api/scan-jobs/{proxy_scan_request['scanJobId']}")
            assert proxy_scan["status"] == "completed", proxy_scan

            def indexed_incompatible_fixture() -> dict[str, Any] | None:
                response = request_json(base_url, f"/api/segments?sourceId={source_id}")
                match = next(
                    (item for item in response.get("items", []) if item["filename"] == incompatible_fixture.name),
                    None,
                )
                return match

            incompatible_segment = wait_until(
                "incompatible fixture indexing", indexed_incompatible_fixture
            )
            assert incompatible_segment["videoCodec"] == "hevc", incompatible_segment
            assert incompatible_segment["audioCodec"] == "opus", incompatible_segment
            assert incompatible_segment["needsTranscode"] is True, incompatible_segment
            proxy_content = download_bytes(
                base_url, f"/api/segments/{incompatible_segment['id']}/stream"
            )
            assert len(proxy_content) > 1024
            range_status, range_content, content_range = download_range(
                base_url, f"/api/segments/{incompatible_segment['id']}/stream", 0, 1023
            )
            assert range_status == 206
            assert len(range_content) == 1024
            assert content_range and content_range.startswith("bytes 0-1023/")
            proxy_download = temp_root / "proxy-download.mp4"
            proxy_download.write_bytes(proxy_content)
            proxy_probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "stream=codec_type,codec_name",
                    "-of",
                    "json",
                    str(proxy_download),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            proxy_streams = json.loads(proxy_probe.stdout)["streams"]
            assert {stream["codec_name"] for stream in proxy_streams} >= {"h264", "aac"}, proxy_streams
            assert list((data_root / "playback-proxies").glob(f"{incompatible_segment['id']}-*.mp4"))
            summary["playbackProxy"] = {
                "source": "hevc/opus",
                "proxy": "h264/aac",
                "bytes": len(proxy_content),
                "range": "206 bytes 0-1023",
            }

            deleted = request_json(base_url, f"/api/sources/{source_id}", method="DELETE")
            assert deleted == {"deleted": True}, deleted
            remaining = request_json(base_url, "/api/sources")
            assert not remaining["items"], remaining
            assert not list((data_root / "playback-proxies").glob("*.mp4"))
            summary["isolatedCleanup"] = "source and playback proxies deleted; temp root pending teardown"
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
