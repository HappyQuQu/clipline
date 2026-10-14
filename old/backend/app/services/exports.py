from __future__ import annotations

import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.settings_store import get_effective
from app.db import SessionLocal
from app.models import ExportJob, Source, VideoSegment
from app.schemas import ExportCreate, ExportJobOut
from app.services.common import make_id, now_iso, parse_iso
from app.services.timeline import indexed_segments_for_range

logger = get_logger(__name__)


def _job_to_out(db: Session, job: ExportJob) -> ExportJobOut:
    source = db.get(Source, job.source_id)
    download_url = f"/api/exports/{job.id}/download" if job.status == "completed" else None
    return ExportJobOut(
        id=job.id,
        sourceId=job.source_id,
        sourceName=source.name if source else None,
        fileName=Path(job.output_path).name if job.output_path else None,
        startTime=job.start_time,
        endTime=job.end_time,
        mode=job.mode,
        status=job.status,
        progress=job.progress,
        hasGaps=bool(job.has_gaps),
        gapDurationSeconds=job.gap_duration_seconds,
        outputSizeBytes=job.output_size_bytes,
        downloadUrl=download_url,
        errorMessage=job.error_message,
        createdAt=job.created_at,
        updatedAt=job.updated_at,
        expiresAt=job.expires_at,
    )


def list_export_jobs(db: Session, limit: int, offset: int, source_id: str | None, status: str | None):
    query = select(ExportJob)
    count_query = select(func.count()).select_from(ExportJob)
    if source_id:
        query = query.where(ExportJob.source_id == source_id)
        count_query = count_query.where(ExportJob.source_id == source_id)
    if status:
        query = query.where(ExportJob.status == status)
        count_query = count_query.where(ExportJob.status == status)
    total = db.scalar(count_query) or 0
    jobs = db.scalars(query.order_by(ExportJob.created_at.desc()).limit(limit).offset(offset)).all()
    return [_job_to_out(db, job) for job in jobs], total


def get_export_job(db: Session, export_id: str) -> ExportJobOut:
    job = db.get(ExportJob, export_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")
    return _job_to_out(db, job)


def create_export_job(db: Session, payload: ExportCreate, background_tasks: BackgroundTasks) -> ExportJob:
    source = db.get(Source, payload.sourceId)
    if not source or not source.enabled:
        raise HTTPException(status_code=404, detail="Source not found")
    start = parse_iso(payload.startTime)
    end = parse_iso(payload.endTime)
    if start >= end:
        raise HTTPException(status_code=400, detail="startTime must be before endTime")
    if end - start > timedelta(minutes=int(get_effective("max_export_minutes", 30))):
        raise HTTPException(status_code=400, detail="Export range is too long")
    if payload.mode not in {"fast", "accurate", "timelapse"}:
        raise HTTPException(status_code=400, detail="mode must be fast, accurate, or timelapse")
    # timelapse 模式把速度编码在 mode 里
    mode_str = payload.mode
    if payload.mode == "timelapse":
        speed = max(2, min(3600, payload.timelapseSpeed))
        mode_str = f"timelapse:{speed}"

    segments = indexed_segments_for_range(db, source.id, start, end)
    if payload.segmentIds is not None:
        selected_ids = set(payload.segmentIds)
        if not selected_ids or not selected_ids.issubset({segment.id for segment in segments}):
            raise HTTPException(status_code=400, detail="Selected segments must belong to this source and export range")
        segments = [segment for segment in segments if segment.id in selected_ids]
    filename = payload.fileName.strip() if payload.fileName is not None else None
    if filename is not None:
        if not filename or len(filename) > 180 or any(ord(char) < 32 or char in '/\\<>:\"|?*' for char in filename) or filename in {'.', '..'}:
            raise HTTPException(status_code=400, detail="Invalid export file name")
        if not filename.lower().endswith('.mp4'):
            filename += '.mp4'
    if not segments:
        raise HTTPException(status_code=400, detail="No video segments intersect the export range")

    has_gaps, gap_duration = calculate_export_gaps(segments, start, end)
    timestamp = now_iso()
    ttl_hours = int(get_effective("export_ttl_hours", 24))
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=ttl_hours)).isoformat() if ttl_hours > 0 else None
    job = ExportJob(
        id=make_id("exp"),
        source_id=source.id,
        start_time=start.isoformat(),
        end_time=end.isoformat(),
        mode=mode_str,
        status="queued",
        progress=0,
        has_gaps=1 if has_gaps else 0,
        gap_duration_seconds=gap_duration,
        created_at=timestamp,
        updated_at=timestamp,
        expires_at=expires_at,
    )
    db.add(job)
    if filename:
        job.output_path = str(get_settings().exports_path / job.id / filename)
    db.commit()
    db.refresh(job)
    background_tasks.add_task(run_export_job, job.id, payload.segmentIds)
    logger.info(
        "export job created",
        extra={
            "export_job_id": job.id,
            "source_id": source.id,
            "mode": job.mode,
            "has_gaps": bool(job.has_gaps),
            "gap_duration_seconds": job.gap_duration_seconds,
        },
    )
    return job


def calculate_export_gaps(segments: list[VideoSegment], start, end) -> tuple[bool, float]:
    previous_end = start
    gap = 0.0
    for segment in segments:
        segment_start = parse_iso(segment.start_time)
        segment_end = parse_iso(segment.end_time)
        if segment_start > previous_end:
            gap += (segment_start - previous_end).total_seconds()
        previous_end = max(previous_end, segment_end)
    if previous_end < end:
        gap += (end - previous_end).total_seconds()
    return gap > 0, gap


def run_export_job(export_id: str, segment_ids: list[str] | None = None) -> None:
    settings = get_settings()
    db = SessionLocal()
    tmp_files: list[Path] = []
    try:
        job = db.get(ExportJob, export_id)
        if not job:
            return
        start = parse_iso(job.start_time)
        end = parse_iso(job.end_time)
        segments = indexed_segments_for_range(db, job.source_id, start, end)
        if segment_ids is not None:
            segments = [segment for segment in segments if segment.id in set(segment_ids)]
        if not segments:
            raise ValueError("Selected video segments are no longer available")
        output = Path(job.output_path) if job.output_path else settings.exports_path / f"{job.id}.mp4"
        output.parent.mkdir(parents=True, exist_ok=True)
        temp_dir = settings.tmp_path / job.id
        temp_dir.mkdir(parents=True, exist_ok=True)
        job.status = "running"
        job.progress = 0.05
        job.updated_at = now_iso()
        db.commit()
        logger.info("export job started", extra={"export_job_id": job.id, "segments": len(segments)})

        for index, segment in enumerate(segments):
            clip_start = max(start, parse_iso(segment.start_time))
            clip_end = min(end, parse_iso(segment.end_time))
            offset = (clip_start - parse_iso(segment.start_time)).total_seconds()
            duration = (clip_end - clip_start).total_seconds()
            temp_file = temp_dir / f"part_{index:04d}.mp4"
            trim_segment(Path(segment.path), temp_file, offset, duration, job.mode)
            tmp_files.append(temp_file)
            job.progress = 0.05 + (0.75 * ((index + 1) / len(segments)))
            job.updated_at = now_iso()
            db.commit()

        concat_file = temp_dir / "concat.txt"
        concat_file.write_text(
            "\n".join(f"file '{file.as_posix()}'" for file in tmp_files),
            encoding="utf-8",
        )
        concat_segments(concat_file, output, job.mode)
        job.status = "completed"
        job.progress = 1
        job.output_path = str(output)
        job.output_size_bytes = output.stat().st_size
        job.updated_at = now_iso()
        db.commit()
        logger.info(
            "export job completed",
            extra={"export_job_id": job.id, "output_path": str(output), "size": job.output_size_bytes},
        )
    except Exception as exc:  # noqa: BLE001
        job = db.get(ExportJob, export_id)
        if job:
            job.status = "failed"
            job.error_message = str(exc)
            job.updated_at = now_iso()
            db.commit()
        logger.exception("export job failed", extra={"export_job_id": export_id, "error": str(exc)})
    finally:
        for file in tmp_files:
            try:
                file.unlink(missing_ok=True)
            except OSError:
                pass
        db.close()


def trim_segment(input_path: Path, output_path: Path, offset: float, duration: float, mode: str) -> None:
    # timelapse 模式：裁剪 + 变速一起做，避免最后处理超大文件
    if mode.startswith("timelapse:"):
        speed = int(mode.split(":")[1])
        afilters = build_atempo_chain(speed)
        command = [
            "ffmpeg", "-y",
            "-ss", str(offset),
            "-i", str(input_path),
            "-t", str(duration),
            "-filter:v", f"setpts=PTS/{speed}",
            "-r", "30",
        ]
        if afilters:
            command += ["-filter:a", afilters]
        else:
            command += ["-an"]
        command += [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-movflags", "+faststart",
            str(output_path),
        ]
    elif mode == "fast":
        command = [
            "ffmpeg", "-y",
            "-ss", str(offset),
            "-i", str(input_path),
            "-t", str(duration),
            "-c", "copy",
            str(output_path),
        ]
    else:
        command = [
            "ffmpeg",
            "-y",
            "-ss",
            str(offset),
            "-i",
            str(input_path),
            "-t",
            str(duration),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    run_ffmpeg(command)


def concat_segments(concat_file: Path, output_path: Path, mode: str) -> None:
    # timelapse: 变速已在 trim_segment 完成，这里只做快速合并
    if mode.startswith("timelapse:"):
        mode = "fast"
    if mode == "fast":
        command = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(concat_file),
            "-c", "copy",
            str(output_path),
        ]
        run_ffmpeg(command)
    else:
        command = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(concat_file),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac",
            "-movflags", "+faststart",
            str(output_path),
        ]
        run_ffmpeg(command)


def build_atempo_chain(speed: int) -> str | None:
    """构建 atempo 链。单个 atempo 范围 0.5~100，多个串联。"""
    if speed <= 0:
        return None
    filters = []
    remaining = speed
    while remaining > 100:
        filters.append("atempo=100.0")
        remaining /= 100
    if remaining > 1:
        filters.append(f"atempo={remaining:.1f}")
    return ",".join(filters) if filters else None


def run_ffmpeg(command: list[str]) -> None:
    # Bound both decoder and encoder threads: automatic x264 threading on 4K
    # recordings can consume most of a small Docker Desktop VM's memory.
    threads = str(max(1, min(16, get_settings().media_threads)))
    command = [command[0], "-threads", threads, "-filter_threads", threads, *command[1:-1], "-threads", threads, command[-1]]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffmpeg failed")


def mark_interrupted_exports() -> int:
    """Do not leave dead background tasks 'running' after a service restart.

    Selected segment IDs are not persisted, so automatic replay could export
    unselected clips. Fail explicitly and let the user choose the range again.
    """
    with SessionLocal() as db:
        jobs = db.scalars(select(ExportJob).where(ExportJob.status.in_(["queued", "running"]))).all()
        for job in jobs:
            job.status = "failed"
            job.error_message = "服务重启导致导出中断，请重新选取区间下载。"
            job.updated_at = now_iso()
        db.commit()
        return len(jobs)


def cleanup_expired_exports() -> int:
    """删除过期的导出任务和文件，返回清理数量。"""
    from app.models import ExportJob as ExportJobModel

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc).isoformat()
        expired = db.scalars(
            select(ExportJobModel).where(
                ExportJobModel.expires_at.is_not(None),
                ExportJobModel.expires_at <= now,
            )
        ).all()

        count = 0
        for job in expired:
            # 删除输出文件
            if job.output_path:
                output = Path(job.output_path)
                if output.exists():
                    try:
                        output.unlink()
                    except OSError as exc:
                        logger.warning("failed to delete export file %s: %s", output, exc)
            db.delete(job)
            count += 1

        if count:
            db.commit()
            logger.info("cleaned up %d expired export(s)", count)
        return count
    finally:
        db.close()
