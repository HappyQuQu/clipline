from __future__ import annotations

import subprocess
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Thumbnail, VideoSegment
from app.services.common import now_iso
def thumbnail_path(segment_id: str) -> Path:
    return get_settings().thumbnails_path / f"{segment_id}.jpg"


def thumbnail_url(segment_id: str) -> str:
    return f"/api/segments/{segment_id}/thumbnail"


def ensure_thumbnail(db: Session, segment: VideoSegment) -> Path | None:
    output = thumbnail_path(segment.id)
    if output.exists() and output.stat().st_size > 0:
        return output

    duration = segment.duration_seconds or 0
    timestamp = max(0.1, min(duration * 0.2, 3.0))
    output.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{timestamp:.2f}",
            "-i",
            segment.path,
            "-frames:v",
            "1",
            "-vf",
            "scale=360:-1",
            "-q:v",
            "5",
            str(output),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0 or not output.exists():
        return None

    existing = db.get(Thumbnail, segment.id)
    if existing:
        existing.path = str(output)
        existing.status = "ready"
        existing.error_message = None
    else:
        db.add(
            Thumbnail(
                id=segment.id,
                segment_id=segment.id,
                timestamp_seconds=timestamp,
                path=str(output),
                status="ready",
                created_at=now_iso(),
            )
        )
    db.commit()
    return output
