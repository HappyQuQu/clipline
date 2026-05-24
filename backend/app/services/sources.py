from __future__ import annotations

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models import ScanJob, Source, VideoSegment
from app.schemas import SourceCreate, SourceOut, SourceUpdate
from app.services.common import bool_int, make_id, now_iso
from app.services.paths import validate_source_path
from app.services.scanner import create_scan_job, run_scan_job

logger = get_logger(__name__)
ACTIVE_SCAN_STATUSES = ("queued", "running")


def source_to_out(db: Session, source: Source) -> SourceOut:
    segment_count = db.scalar(
        select(func.count()).select_from(VideoSegment).where(VideoSegment.source_id == source.id)
    )
    failed_count = db.scalar(
        select(func.count())
        .select_from(VideoSegment)
        .where(VideoSegment.source_id == source.id, VideoSegment.scan_status == "failed")
    )
    last_scan = db.scalar(
        select(ScanJob.finished_at)
        .where(ScanJob.source_id == source.id)
        .order_by(ScanJob.created_at.desc())
        .limit(1)
    )
    return SourceOut(
        id=source.id,
        name=source.name,
        path=source.path,
        enabled=bool(source.enabled),
        createdAt=source.created_at,
        updatedAt=source.updated_at,
        lastScanAt=last_scan,
        segmentCount=segment_count or 0,
        failedCount=failed_count or 0,
    )


def list_sources(db: Session) -> list[SourceOut]:
    sources = db.scalars(select(Source).order_by(Source.created_at.asc())).all()
    return [source_to_out(db, source) for source in sources]


def create_source(db: Session, payload: SourceCreate, background_tasks: BackgroundTasks) -> tuple[Source, str]:
    path = validate_source_path(payload.path)
    existing = db.scalar(select(Source).where(Source.path == str(path)))
    if existing:
        raise HTTPException(status_code=409, detail="Source path already exists")

    timestamp = now_iso()
    source = Source(
        id=make_id("src"),
        name=payload.name.strip(),
        path=str(path),
        enabled=1,
        created_at=timestamp,
        updated_at=timestamp,
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    scan_job_id = create_scan_job(source.id)
    background_tasks.add_task(run_scan_job, scan_job_id)
    logger.info(
        "source created",
        extra={"source_id": source.id, "path": source.path, "scan_job_id": scan_job_id},
    )
    return source, scan_job_id


def update_source(db: Session, source_id: str, payload: SourceUpdate) -> Source:
    source = db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    if payload.path is not None:
        path = validate_source_path(payload.path)
        existing = db.scalar(select(Source).where(Source.path == str(path), Source.id != source_id))
        if existing:
            raise HTTPException(status_code=409, detail="Source path already exists")
        source.path = str(path)

    if payload.name is not None:
        source.name = payload.name.strip()
    if payload.enabled is not None:
        source.enabled = bool_int(payload.enabled)
    source.updated_at = now_iso()
    db.commit()
    db.refresh(source)
    logger.info("source updated", extra={"source_id": source.id, "path": source.path})
    return source


def queue_scan(db: Session, source_id: str, background_tasks: BackgroundTasks) -> tuple[str, str]:
    source = db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    if not source.enabled:
        raise HTTPException(status_code=409, detail="Source is disabled")

    active_job = db.scalar(
        select(ScanJob)
        .where(ScanJob.source_id == source.id, ScanJob.status.in_(ACTIVE_SCAN_STATUSES))
        .order_by(ScanJob.created_at.desc())
        .limit(1)
    )
    if active_job:
        logger.info(
            "manual scan reused active job",
            extra={"source_id": source.id, "scan_job_id": active_job.id, "status": active_job.status},
        )
        return active_job.id, active_job.status

    scan_job_id = create_scan_job(source.id)
    background_tasks.add_task(run_scan_job, scan_job_id)
    logger.info("manual scan queued", extra={"source_id": source.id, "scan_job_id": scan_job_id})
    return scan_job_id, "queued"
