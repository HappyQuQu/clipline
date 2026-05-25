from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete, select

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db import SessionLocal
from app.models import ScanJob, Source, Thumbnail, VideoSegment
from app.services.common import make_id, now_iso
from app.services.probe import ffprobe
from app.services.time_parser import infer_start_time

SUPPORTED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".ts", ".m4v"}
logger = get_logger(__name__)


def create_scan_job(source_id: str | None) -> str:
    db = SessionLocal()
    try:
        timestamp = now_iso()
        job = ScanJob(
            id=make_id("scan"),
            source_id=source_id,
            status="queued",
            created_at=timestamp,
            updated_at=timestamp,
        )
        db.add(job)
        db.commit()
        logger.info("scan job created", extra={"scan_job_id": job.id, "source_id": source_id})
        return job.id
    finally:
        db.close()


def run_scan_job(job_id: str) -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        job = db.get(ScanJob, job_id)
        if not job:
            return
        source = db.get(Source, job.source_id) if job.source_id else None
        if not source:
            job.status = "failed"
            job.error_message = "Source not found"
            job.updated_at = now_iso()
            db.commit()
            return

        job.status = "running"
        job.started_at = now_iso()
        job.updated_at = job.started_at
        db.commit()
        logger.info("scan job started", extra={"scan_job_id": job.id, "source_id": source.id})

        root = Path(source.path)
        cutoff = datetime.now(timezone.utc).astimezone() - timedelta(seconds=settings.skip_recent_seconds)

        paths = sorted(
            [path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS],
            key=lambda item: str(item),
        )
        job.total_files = len(paths)
        job.updated_at = now_iso()
        db.commit()

        discovered_paths: set[str] = set()

        for path in paths:
            file_path = str(path)
            discovered_paths.add(file_path)
            job.scanned_files += 1
            stat = path.stat()
            mtime_dt = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).astimezone()
            ctime_dt = datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc).astimezone()
            mtime = mtime_dt.isoformat(timespec="seconds")
            ctime = ctime_dt.isoformat(timespec="seconds")
            existing = db.scalar(
                select(VideoSegment).where(
                    VideoSegment.source_id == source.id,
                    VideoSegment.path == file_path,
                )
            )

            if existing and existing.size_bytes == stat.st_size and existing.mtime == mtime:
                continue

            timestamp = now_iso()
            segment = existing or VideoSegment(
                id=make_id("seg"),
                source_id=source.id,
                path=file_path,
                filename=path.name,
                size_bytes=stat.st_size,
                scan_status="pending",
                created_at=timestamp,
                updated_at=timestamp,
            )
            segment.filename = path.name
            segment.size_bytes = stat.st_size
            segment.mtime = mtime
            segment.ctime = ctime
            segment.updated_at = timestamp

            if mtime_dt > cutoff:
                segment.scan_status = "pending"
                segment.error_message = "File modified recently; waiting for it to become stable"
                db.add(segment)
                db.commit()
                logger.info(
                    "scan file pending",
                    extra={"scan_job_id": job.id, "source_id": source.id, "path": file_path},
                )
                continue

            try:
                metadata = ffprobe(path)
                duration = metadata["duration_seconds"]
                start, source_name, confidence = infer_start_time(path, mtime_dt, duration)
                end = start + timedelta(seconds=duration or 0)

                segment.start_time = start.isoformat(timespec="seconds")
                segment.end_time = end.isoformat(timespec="seconds")
                segment.duration_seconds = duration
                segment.time_source = source_name
                segment.time_confidence = confidence
                segment.container = metadata["container"]
                segment.video_codec = metadata["video_codec"]
                segment.audio_codec = metadata["audio_codec"]
                segment.width = metadata["width"]
                segment.height = metadata["height"]
                segment.fps = metadata["fps"]
                segment.playable = 1 if metadata["playable"] else 0
                segment.needs_transcode = 0 if metadata["playable"] else 1
                segment.scan_status = "indexed"
                segment.error_message = None
                job.indexed_files += 1
                logger.info(
                    "scan file indexed",
                    extra={
                        "scan_job_id": job.id,
                        "source_id": source.id,
                        "segment_id": segment.id,
                        "path": file_path,
                        "duration_seconds": duration,
                    },
                )
            except Exception as exc:  # noqa: BLE001
                segment.scan_status = "failed"
                segment.error_message = str(exc)
                job.failed_files += 1
                logger.warning(
                    "scan file failed",
                    extra={
                        "scan_job_id": job.id,
                        "source_id": source.id,
                        "path": file_path,
                        "error": str(exc),
                    },
                )

            db.add(segment)
            db.commit()

        discovered_path_list = sorted(discovered_paths)
        stale_segment_ids = list(
            db.scalars(
                select(VideoSegment.id).where(
                    VideoSegment.source_id == source.id,
                    VideoSegment.path.not_in(discovered_path_list),
                )
            )
        )
        if stale_segment_ids:
            db.execute(delete(Thumbnail).where(Thumbnail.segment_id.in_(stale_segment_ids)))
            db.execute(delete(VideoSegment).where(VideoSegment.id.in_(stale_segment_ids)))
            db.commit()
            logger.info(
                "scan stale segments removed",
                extra={
                    "scan_job_id": job.id,
                    "source_id": source.id,
                    "removed_segments": len(stale_segment_ids),
                },
            )

        job.status = "completed"
        job.finished_at = now_iso()
        job.updated_at = job.finished_at
        db.commit()
        logger.info(
            "scan job completed",
            extra={
                "scan_job_id": job.id,
                "source_id": source.id,
                "scanned_files": job.scanned_files,
                "indexed_files": job.indexed_files,
                "failed_files": job.failed_files,
            },
        )
    except Exception as exc:  # noqa: BLE001
        job = db.get(ScanJob, job_id)
        if job:
            job.status = "failed"
            job.error_message = str(exc)
            job.finished_at = now_iso()
            job.updated_at = job.finished_at
            db.commit()
        logger.exception("scan job failed", extra={"scan_job_id": job_id, "error": str(exc)})
    finally:
        db.close()
