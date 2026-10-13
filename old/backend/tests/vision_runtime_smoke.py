#!/usr/bin/env python3
"""Run one real isolated YOLO ONNX task through the Clipline API."""

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
DEFAULT_IMAGE = (
    BACKEND_ROOT.parent
    / "frontend/prototypes/clipline-full-redesign/public/assets/front-door-person.png"
)


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
) -> dict[str, Any]:
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=body,
        method=method,
        headers={"Content-Type": "application/json"} if body is not None else {},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read()
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


def make_fixture(image: Path, recordings: Path) -> Path:
    output = recordings / "20260731_150000.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-loop",
            "1",
            "-i",
            str(image),
            "-t",
            "4",
            "-r",
            "24",
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(output),
        ],
        check=True,
    )
    return output


def main() -> int:
    model_value = os.environ.get("CLIPLINE_TEST_VISION_MODEL")
    if not model_value:
        raise SystemExit("CLIPLINE_TEST_VISION_MODEL must point to a YOLOv8 detection ONNX file")
    model = Path(model_value).resolve()
    image = Path(os.environ.get("CLIPLINE_TEST_VISION_IMAGE", str(DEFAULT_IMAGE))).resolve()
    if not model.is_file() or not image.is_file():
        raise SystemExit(f"Missing model or image: model={model}, image={image}")

    with tempfile.TemporaryDirectory(prefix="clipline-vision-runtime-") as temp_value:
        temp_root = Path(temp_value)
        data_root = temp_root / "data"
        recordings = temp_root / "recordings"
        vision_models = data_root / "models" / "vision"
        recordings.mkdir(parents=True)
        vision_models.mkdir(parents=True)
        isolated_model = vision_models / "yolov8n.onnx"
        shutil.copy2(model, isolated_model)
        fixture = make_fixture(image, recordings)
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
        try:
            def backend_ready() -> dict[str, Any] | None:
                if server.poll() is not None:
                    stderr = server.stderr.read() if server.stderr else ""
                    raise AssertionError(f"Isolated backend exited during startup: {stderr[-4000:]}")
                try:
                    return request_json(base_url, "/api/health")
                except urllib.error.URLError:
                    return None

            wait_until("backend startup", backend_ready, timeout=30)
            settings = request_json(base_url, "/api/settings")
            assert settings["vision"]["modelStatus"]["available"] is True, settings["vision"]
            source = request_json(
                base_url,
                "/api/sources",
                method="POST",
                payload={
                    "name": "vision-runtime-smoke",
                    "path": str(recordings),
                    "detectLabels": ["person", "vehicle"],
                    "detectConfidence": 25,
                },
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
                base_url,
                f"/api/segments/{segment_id}/vision",
                method="POST",
            )

            def vision_finished() -> dict[str, Any] | None:
                status = request_json(base_url, f"/api/vision-jobs/{job['id']}")
                return status if status["status"] in {"completed", "failed"} else None

            vision = wait_until("real YOLO inference", vision_finished, timeout=180)
            assert vision["status"] == "completed", vision
            detections = request_json(base_url, f"/api/segments/{segment_id}/vision")
            people = [item for item in detections["items"] if item["label"] == "person"]
            assert people, detections
            reload_result = request_json(base_url, "/api/settings/models/reload", method="POST")
            assert reload_result["reloaded"] is True
            print(
                json.dumps(
                    {
                        "isolated": True,
                        "fixture": fixture.name,
                        "modelBytes": isolated_model.stat().st_size,
                        "status": vision["status"],
                        "detections": len(detections["items"]),
                        "personConfidence": max(item["confidence"] for item in people),
                        "runtimeReload": "invalidated",
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 0
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
