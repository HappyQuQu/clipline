"""Start a real API preview with isolated, explicitly labelled test recordings.

Run from backend: PYTHONPATH=. .venv/bin/python tests/workspace_preview.py
The temporary database never reads or modifies the normal Clipline library.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
from datetime import datetime, timedelta
from pathlib import Path


def main() -> None:
    root = Path(tempfile.mkdtemp(prefix="clipline-workspace-preview-"))
    recordings = root / "recordings"
    recordings.mkdir()
    os.environ.update(CLIPLINE_DATA=str(root / "data"), CLIPLINE_DB=str(root / "data/clipline.db"), CLIPLINE_RECORDINGS_ROOT=str(recordings), CLIPLINE_SKIP_RECENT_SECONDS="0", CLIPLINE_LOG_LEVEL="WARNING")
    from app.db import SessionLocal, init_db
    from app.models import Source, VideoSegment, Thumbnail, Transcription, TranscriptionJob, VisionDetection

    init_db()
    assets = Path(__file__).resolve().parents[2] / "frontend/prototypes/clipline-full-redesign/public/assets"
    now = datetime.now().astimezone().isoformat()
    day = datetime.now().astimezone().replace(hour=9, minute=14, second=0, microsecond=0)
    db = SessionLocal()
    source = Source(id="preview-source", name="测试录像 · 打印工作台", path=str(recordings), created_at=now, updated_at=now)
    db.add(source)
    for index, image in enumerate(["printer-0914.jpg", "printer-0919.jpg", "printer-0924.jpg", "printer-0930.jpg", "printer-0935.jpg", "printer-main.png"]):
        start = day + timedelta(minutes=index * 5)
        output = recordings / f"{start:%Y%m%d_%H%M%S}.mp4"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", "12", "-i", str(assets / image), "-t", "60", "-vf", "scale=960:-2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output)], check=True)
        segment_id = f"preview-segment-{index}"
        db.add(VideoSegment(id=segment_id, source_id=source.id, path=str(output), filename=output.name, size_bytes=output.stat().st_size, start_time=start.isoformat(), end_time=(start + timedelta(seconds=60)).isoformat(), duration_seconds=60, video_codec="h264", container="mp4", width=960, height=540, fps=12, playable=1, needs_transcode=0, scan_status="indexed", created_at=now, updated_at=now))
        db.add(Thumbnail(id=f"preview-thumb-{index}", segment_id=segment_id, timestamp_seconds=0, path=str(assets / image), width=960, height=540, status="completed", created_at=now))
        db.add(TranscriptionJob(id=f"preview-speech-{index}", segment_id=segment_id, status="completed", stage="completed", progress=1, created_at=now, updated_at=now))
        for line, text in enumerate(["测试字幕：检查打印工作台。", "测试字幕：打印任务正在进行，观察设备状态。", "测试字幕：这一段用于验证时间定位和导出。"]):
            db.add(Transcription(id=f"preview-line-{index}-{line}", segment_id=segment_id, start_time=line * 18, end_time=line * 18 + 15, text=text, confidence=.99, created_at=now))
        db.add(VisionDetection(id=f"preview-tag-{index}", segment_id=segment_id, source_id=source.id, label="printer", label_name="打印机（测试标签）", confidence=.99, start_time=0, end_time=60, frame_time=0, model="preview-fixture", created_at=now))
    db.commit()
    db.close()
    print(f"Isolated preview data: {root}", flush=True)
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8082, log_level="warning")


if __name__ == "__main__":
    main()
