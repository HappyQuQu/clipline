from __future__ import annotations

import concurrent.futures
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.settings_store import get_effective
from app.db import SessionLocal
from app.models import ScanJob, Source, Thumbnail, VideoSegment
from app.services.common import make_id, now_iso
from app.services.probe import ffprobe
from app.services.time_parser import infer_start_time
from app.services.playback_proxy import remove_playback_proxies
from app.services.transcription import create_transcription_job, enqueue_transcription_job
from app.services.vision import create_vision_job, enqueue_vision_job

SUPPORTED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".ts", ".m4v"}
BATCH_SIZE = 50
logger = get_logger(__name__)
MAX_AUTO_TRANSCRIPTION_JOBS_PER_SCAN = 20


def _is_idle_time() -> bool:
    """检查当前是否在闲时扫描时段内"""
    if not get_effective("idle_scan_enabled", False):
        return False  # 未启用闲时扫描时，不限制（始终允许）
    from datetime import datetime
    now = datetime.now()
    start_hour = int(get_effective("idle_scan_start_hour", 2))
    end_hour = int(get_effective("idle_scan_end_hour", 6))
    if start_hour <= end_hour:
        return start_hour <= now.hour < end_hour
    else:
        return now.hour >= start_hour or now.hour < end_hour


def _should_skip_scan(trigger: str) -> bool:
    """判断是否应该跳过本次扫描（闲时模式下非闲时段）"""
    if trigger == "manual":
        return False  # 手动扫描始终执行
    return not _is_idle_time()


def create_scan_job(source_id: str | None, trigger: str = "manual") -> str:
    db = SessionLocal()
    try:
        timestamp = now_iso()
        job = ScanJob(
            id=make_id("scan"),
            source_id=source_id,
            trigger=trigger,
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


def _probe_file(path: Path) -> dict | None:
    """对单个文件执行 ffprobe，返回 metadata 或 None"""
    try:
        return ffprobe(path)
    except Exception:
        return None


def run_scan_job(job_id: str) -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        job = db.get(ScanJob, job_id)
        if not job:
            return

        # 闲时扫描检查
        if _should_skip_scan(job.trigger or "manual"):
            job.status = "completed"
            job.finished_at = now_iso()
            job.updated_at = job.finished_at
            job.error_message = "非闲时段，跳过扫描"
            db.commit()
            logger.info("scan skipped (not idle time)", extra={"scan_job_id": job.id})
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
        skip_seconds = int(get_effective("skip_recent_seconds", 30))
        cutoff = datetime.now(timezone.utc).astimezone() - timedelta(seconds=skip_seconds)

        # 收集所有文件
        paths = sorted(
            [p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS],
            key=lambda item: str(item),
        )
        job.total_files = len(paths)
        job.updated_at = now_iso()
        db.commit()

        # 批量加载已有记录（按 path 索引）
        existing_map: dict[str, VideoSegment] = {}
        for seg in db.scalars(
            select(VideoSegment).where(VideoSegment.source_id == source.id)
        ).all():
            existing_map[seg.path] = seg

        discovered_paths: set[str] = set()
        auto_transcription_segment_ids: list[str] = []
        auto_vision_segment_ids: list[str] = []
        pending_probe: list[tuple[Path, str, datetime, str, str]] = []
        batch_count = 0

        for path in paths:
            file_path = str(path)
            discovered_paths.add(file_path)
            job.scanned_files += 1

            stat = path.stat()
            mtime_dt = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).astimezone()
            ctime_dt = datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc).astimezone()
            mtime = mtime_dt.isoformat(timespec="seconds")
            ctime = ctime_dt.isoformat(timespec="seconds")

            existing = existing_map.get(file_path)

            # 增量检查：大小和修改时间未变则跳过
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
                batch_count += 1
                continue

            # 收集待 ffprobe 的文件
            pending_probe.append((path, file_path, mtime_dt, mtime, ctime))

        # 批量提交 pending 文件
        if batch_count > 0:
            db.commit()

        # 并发 ffprobe
        if pending_probe:
            workers = int(get_effective("global_ffprobe_concurrency", 4))
            logger.info("probing %d files with %d workers", len(pending_probe), workers)
            with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
                future_map = {
                    executor.submit(_probe_file, item[0]): item
                    for item in pending_probe
                }
                for future in concurrent.futures.as_completed(future_map):
                    path, file_path, mtime_dt, mtime, ctime = future_map[future]
                    metadata = future.result()
                    timestamp = now_iso()
                    existing = existing_map.get(file_path)
                    segment = existing or VideoSegment(
                        id=make_id("seg"),
                        source_id=source.id,
                        path=file_path,
                        filename=path.name,
                        size_bytes=path.stat().st_size,
                        scan_status="pending",
                        created_at=timestamp,
                        updated_at=timestamp,
                    )
                    segment.filename = path.name
                    segment.size_bytes = path.stat().st_size
                    segment.mtime = mtime
                    segment.ctime = ctime
                    segment.updated_at = timestamp

                    if metadata:
                        was_indexed = existing.scan_status == "indexed" if existing else False
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
                        if (
                            source.auto_transcribe
                            and source.recognition_trigger == "new_segments"
                            and not was_indexed
                        ):
                            auto_transcription_segment_ids.append(segment.id)
                        if (
                            source.auto_detect
                            and source.recognition_trigger == "new_segments"
                            and not was_indexed
                        ):
                            auto_vision_segment_ids.append(segment.id)
                    else:
                        segment.scan_status = "failed"
                        segment.error_message = "ffprobe failed"
                        job.failed_files += 1

                    db.add(segment)
                    batch_count += 1
                    if batch_count >= BATCH_SIZE:
                        db.commit()
                        job.updated_at = now_iso()
                        db.commit()
                        batch_count = 0

        # 最后一批提交
        if batch_count > 0:
            db.commit()

        if auto_transcription_segment_ids:
            queued = 0
            for segment_id in auto_transcription_segment_ids[:MAX_AUTO_TRANSCRIPTION_JOBS_PER_SCAN]:
                try:
                    transcription_job = create_transcription_job(db, segment_id)
                except ValueError:
                    continue
                enqueue_transcription_job(transcription_job.id)
                queued += 1
            logger.info(
                "auto transcription jobs queued",
                extra={
                    "scan_job_id": job.id,
                    "source_id": source.id,
                    "queued": queued,
                    "matched": len(auto_transcription_segment_ids),
                    "limit": MAX_AUTO_TRANSCRIPTION_JOBS_PER_SCAN,
                },
            )

        if auto_vision_segment_ids:
            limit = int(get_effective("vision_max_auto_jobs_per_scan", 10))
            queued = 0
            for segment_id in auto_vision_segment_ids[:limit]:
                try:
                    vision_job = create_vision_job(db, segment_id)
                except ValueError:
                    continue
                enqueue_vision_job(vision_job.id)
                queued += 1
            logger.info(
                "auto vision jobs queued",
                extra={
                    "scan_job_id": job.id,
                    "source_id": source.id,
                    "queued": queued,
                    "matched": len(auto_vision_segment_ids),
                    "limit": limit,
                },
            )

        # 清理已删除的文件（用 set 操作代替 NOT IN）
        stale_ids = [
            seg.id for seg in existing_map.values()
            if seg.path not in discovered_paths
        ]
        if stale_ids:
            db.execute(delete(Thumbnail).where(Thumbnail.segment_id.in_(stale_ids)))
            db.execute(delete(VideoSegment).where(VideoSegment.id.in_(stale_ids)))
            db.commit()
            remove_playback_proxies(stale_ids)
            logger.info(
                "scan stale segments removed",
                extra={"scan_job_id": job.id, "source_id": source.id, "removed": len(stale_ids)},
            )

        # 自动清理过期片段
        cleanup_days = int(get_effective("auto_cleanup_days", 0))
        if cleanup_days > 0:
            cutoff_date = (datetime.now(timezone.utc) - timedelta(days=cleanup_days)).isoformat(timespec="seconds")
            old_ids = list(
                db.scalars(
                    select(VideoSegment.id).where(
                        VideoSegment.source_id == source.id,
                        VideoSegment.end_time < cutoff_date,
                        VideoSegment.scan_status == "indexed",
                    )
                )
            )
            if old_ids:
                db.execute(delete(Thumbnail).where(Thumbnail.segment_id.in_(old_ids)))
                db.execute(delete(VideoSegment).where(VideoSegment.id.in_(old_ids)))
                db.commit()
                remove_playback_proxies(old_ids)
                logger.info(
                    "auto cleanup removed old segments",
                    extra={"scan_job_id": job.id, "source_id": source.id, "removed": len(old_ids), "cutoff_days": cleanup_days},
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
