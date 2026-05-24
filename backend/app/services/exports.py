from __future__ import annotations

import subprocess
from datetime import timedelta
from pathlib import Path

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
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
    if end - start > timedelta(minutes=get_settings().max_export_minutes):
        raise HTTPException(status_code=400, detail="Export range is too long")
    if payload.mode not in {"fast", "accurate"}:
        raise HTTPException(status_code=400, detail="mode must be fast or accurate")

    segments = indexed_segments_for_range(db, source.id, start, end)
    if not segments:
        raise HTTPException(status_code=400, detail="No video segments intersect the export range")

    has_gaps, gap_duration = calculate_export_gaps(segments, start, end)
    timestamp = now_iso()
    job = ExportJob(
        id=make_id("exp"),
        source_id=source.id,
        start_time=start.isoformat(),
        end_time=end.isoformat(),
        mode=payload.mode,
        status="queued",
        progress=0,
        has_gaps=1 if has_gaps else 0,
        gap_duration_seconds=gap_duration,
        created_at=timestamp,
        updated_at=timestamp,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    background_tasks.add_task(run_export_job, job.id)
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


def run_export_job(export_id: str) -> None:
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
        output = settings.exports_path / f"{job.id}.mp4"
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
    if mode == "fast":
        command = [
            "ffmpeg",
            "-y",
            "-ss",
            str(offset),
            "-i",
            str(input_path),
            "-t",
            str(duration),
            "-c",
            "copy",
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
    if mode == "fast":
        command = [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-c",
            "copy",
            str(output_path),
        ]
    else:
        command = [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
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


def run_ffmpeg(command: list[str]) -> None:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffmpeg failed")

