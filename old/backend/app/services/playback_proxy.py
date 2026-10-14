from __future__ import annotations

import hashlib
import subprocess
import threading
from pathlib import Path

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)
_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}


def _proxy_key(source: Path) -> str:
    stat = source.stat()
    identity = f"{source.resolve()}\0{stat.st_size}\0{stat.st_mtime_ns}"
    return hashlib.sha256(identity.encode()).hexdigest()[:20]


def _segment_lock(segment_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(segment_id, threading.Lock())


def ensure_playback_proxy(segment_id: str, source: Path) -> Path:
    """Return a cached browser-compatible MP4 without modifying the recording."""
    if not source.exists() or not source.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    settings = get_settings()
    cache_dir = settings.playback_proxies_path
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = _proxy_key(source)
    target = cache_dir / f"{segment_id}-{key}.mp4"
    if target.exists() and target.stat().st_size > 0:
        return target

    with _segment_lock(segment_id):
        if target.exists() and target.stat().st_size > 0:
            return target

        temporary = target.with_suffix(".part.mp4")
        temporary.unlink(missing_ok=True)
        max_width = max(320, int(settings.playback_proxy_max_width))
        threads = str(max(1, min(16, settings.media_threads)))
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-threads", threads,
            "-filter_threads", threads,
            "-i",
            str(source),
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            f"scale=min({max_width}\\,iw):-2",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            "-threads", threads,
            str(temporary),
        ]
        logger.info(
            "creating browser playback proxy",
            extra={"segment_id": segment_id, "source": str(source), "target": str(target)},
        )
        try:
            subprocess.run(
                command,
                check=True,
                timeout=max(30, int(settings.playback_proxy_timeout_seconds)),
                capture_output=True,
                text=True,
            )
            if not temporary.exists() or temporary.stat().st_size == 0:
                raise RuntimeError("ffmpeg produced an empty proxy")
            temporary.replace(target)
        except (OSError, subprocess.SubprocessError, RuntimeError) as exc:
            temporary.unlink(missing_ok=True)
            stderr = getattr(exc, "stderr", None)
            logger.exception(
                "browser playback proxy failed",
                extra={"segment_id": segment_id, "source": str(source), "stderr": stderr},
            )
            raise HTTPException(status_code=503, detail="Unable to create browser playback proxy") from exc

        for stale in cache_dir.glob(f"{segment_id}-*.mp4"):
            if stale != target:
                stale.unlink(missing_ok=True)
        return target


def remove_playback_proxies(segment_ids: list[str]) -> int:
    cache_dir = get_settings().playback_proxies_path
    removed = 0
    for segment_id in segment_ids:
        with _segment_lock(segment_id):
            for path in cache_dir.glob(f"{segment_id}-*"):
                if path.is_file():
                    path.unlink(missing_ok=True)
                    removed += 1
        with _locks_guard:
            _locks.pop(segment_id, None)
    return removed
