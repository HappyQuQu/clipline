from __future__ import annotations

import json
import subprocess
from fractions import Fraction
from pathlib import Path


def _ratio_to_float(value: str | None) -> float | None:
    if not value or value == "0/0":
        return None
    try:
        return float(Fraction(value))
    except (ValueError, ZeroDivisionError):
        return None


def ffprobe(path: Path) -> dict:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffprobe failed")
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), {})
    duration = data.get("format", {}).get("duration") or video.get("duration")
    return {
        "duration_seconds": float(duration) if duration else None,
        "container": data.get("format", {}).get("format_name"),
        "video_codec": video.get("codec_name"),
        "audio_codec": audio.get("codec_name"),
        "width": video.get("width"),
        "height": video.get("height"),
        "fps": _ratio_to_float(video.get("r_frame_rate")),
        "playable": video.get("codec_name") == "h264"
        and (not audio or audio.get("codec_name") in {"aac", "mp3", None}),
    }

