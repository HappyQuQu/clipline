from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import get_db
from app.models import ExportJob, ScanJob, VideoSegment
from app.schemas import (
    DirectoryTreeResponse,
    ExportCreate,
    ExportCreateOut,
    ExportJobOut,
    ExportListResponse,
    ScanJobOut,
    ScanJobsResponse,
    ScanQueuedOut,
    SegmentListResponse,
    SegmentOut,
    SegmentResolveOut,
    SourceCreate,
    SourceCreateOut,
    SourcesResponse,
    SourceUpdate,
    TimelineResponse,
)
from app.services.paths import directory_tree
from app.services.exports import create_export_job, get_export_job, list_export_jobs
from app.services.sources import create_source, list_sources, queue_scan, source_to_out, update_source
from app.services.streaming import stream_file
from app.services.timeline import build_timeline, resolve_segment_at
from app.services.thumbnails import ensure_thumbnail, thumbnail_url

router = APIRouter(prefix="/api")


@router.get("/sources", response_model=SourcesResponse)
def get_sources(db: Session = Depends(get_db)) -> SourcesResponse:
    return SourcesResponse(items=list_sources(db))


@router.post("/sources", response_model=SourceCreateOut)
def post_source(
    payload: SourceCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> SourceCreateOut:
    source, scan_job_id = create_source(db, payload, background_tasks)
    out = source_to_out(db, source).model_dump()
    return SourceCreateOut(**out, scanJobId=scan_job_id)


@router.patch("/sources/{source_id}", response_model=SourceCreateOut)
def patch_source(
    source_id: str,
    payload: SourceUpdate,
    db: Session = Depends(get_db),
) -> SourceCreateOut:
    source = update_source(db, source_id, payload)
    return SourceCreateOut(**source_to_out(db, source).model_dump(), scanJobId=None)


@router.post("/sources/{source_id}/scan", response_model=ScanQueuedOut)
def post_source_scan(
    source_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> ScanQueuedOut:
    scan_job_id, status = queue_scan(db, source_id, background_tasks)
    return ScanQueuedOut(scanJobId=scan_job_id, status=status)


@router.get("/recording-directories", response_model=DirectoryTreeResponse)
def get_recording_directories(
    path: str | None = None,
    depth: int = Query(default=2, ge=0, le=5),
) -> dict:
    return directory_tree(path, depth)


def _scan_job_to_out(job: ScanJob) -> ScanJobOut:
    return ScanJobOut(
        id=job.id,
        sourceId=job.source_id,
        trigger=job.trigger,
        status=job.status,
        totalFiles=job.total_files,
        scannedFiles=job.scanned_files,
        indexedFiles=job.indexed_files,
        failedFiles=job.failed_files,
        startedAt=job.started_at,
        finishedAt=job.finished_at,
        errorMessage=job.error_message,
        createdAt=job.created_at,
        updatedAt=job.updated_at,
    )


@router.get("/scan-jobs", response_model=ScanJobsResponse)
def get_scan_jobs(
    sourceId: str | None = None,
    status: str | None = None,
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> ScanJobsResponse:
    filters = []
    if sourceId:
        filters.append(ScanJob.source_id == sourceId)
    if status:
        filters.append(ScanJob.status == status)

    total_query = select(func.count()).select_from(ScanJob)
    jobs_query = select(ScanJob).order_by(ScanJob.created_at.desc()).limit(limit).offset(offset)
    if filters:
        total_query = total_query.where(*filters)
        jobs_query = jobs_query.where(*filters)

    total = db.scalar(total_query) or 0
    jobs = db.scalars(jobs_query).all()
    return ScanJobsResponse(items=[_scan_job_to_out(job) for job in jobs], total=total, limit=limit, offset=offset)


@router.get("/scan-jobs/{scan_job_id}", response_model=ScanJobOut)
def get_scan_job(scan_job_id: str, db: Session = Depends(get_db)) -> ScanJobOut:
    job = db.get(ScanJob, scan_job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Scan job not found")
    return _scan_job_to_out(job)


@router.get("/timeline", response_model=TimelineResponse)
def get_timeline(
    sourceId: str,
    date: str,
    db: Session = Depends(get_db),
) -> TimelineResponse:
    return build_timeline(db, sourceId, date)


def _segment_to_out(segment: VideoSegment) -> SegmentOut:
    return SegmentOut(
        id=segment.id,
        sourceId=segment.source_id,
        filename=segment.filename,
        path=segment.path,
        sizeBytes=segment.size_bytes,
        startTime=segment.start_time,
        endTime=segment.end_time,
        durationSeconds=segment.duration_seconds,
        container=segment.container,
        videoCodec=segment.video_codec,
        audioCodec=segment.audio_codec,
        width=segment.width,
        height=segment.height,
        fps=segment.fps,
        playable=bool(segment.playable),
        needsTranscode=bool(segment.needs_transcode),
        scanStatus=segment.scan_status,
        errorMessage=segment.error_message,
        thumbnailUrl=thumbnail_url(segment.id) if segment.scan_status == "indexed" else None,
    )


@router.get("/segments", response_model=SegmentListResponse)
def get_segments(
    sourceId: str | None = None,
    scanStatus: str | None = None,
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> SegmentListResponse:
    filters = []
    if sourceId:
        filters.append(VideoSegment.source_id == sourceId)
    if scanStatus:
        filters.append(VideoSegment.scan_status == scanStatus)

    total_query = select(func.count()).select_from(VideoSegment)
    segments_query = (
        select(VideoSegment)
        .order_by(VideoSegment.start_time.desc(), VideoSegment.filename.desc())
        .limit(limit)
        .offset(offset)
    )
    if filters:
        total_query = total_query.where(*filters)
        segments_query = segments_query.where(*filters)

    total = db.scalar(total_query) or 0
    segments = db.scalars(segments_query).all()
    return SegmentListResponse(
        items=[_segment_to_out(segment) for segment in segments],
        total=total,
        limit=limit,
        offset=offset,
        hasMore=offset + len(segments) < total,
    )


@router.get("/segments/resolve", response_model=SegmentResolveOut)
def resolve_segment(sourceId: str, time: str, db: Session = Depends(get_db)) -> dict:
    return resolve_segment_at(db, sourceId, time)


@router.get("/segments/{segment_id}", response_model=SegmentOut)
def get_segment(segment_id: str, db: Session = Depends(get_db)) -> SegmentOut:
    segment = db.get(VideoSegment, segment_id)
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")
    return _segment_to_out(segment)


@router.get("/segments/{segment_id}/stream")
def get_segment_stream(segment_id: str, request: Request, db: Session = Depends(get_db)):
    segment = db.get(VideoSegment, segment_id)
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")
    return stream_file(Path(segment.path), request)


@router.get("/segments/{segment_id}/thumbnail")
def get_segment_thumbnail(segment_id: str, db: Session = Depends(get_db)):
    segment = db.get(VideoSegment, segment_id)
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")
    path = ensure_thumbnail(db, segment)
    if not path:
        return Response(status_code=204)
    return FileResponse(path, media_type="image/jpeg")


@router.post("/exports", response_model=ExportCreateOut)
def post_export(
    payload: ExportCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> ExportCreateOut:
    job = create_export_job(db, payload, background_tasks)
    return ExportCreateOut(exportId=job.id, status=job.status)


@router.get("/exports", response_model=ExportListResponse)
def get_exports(
    sourceId: str | None = None,
    status: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> ExportListResponse:
    items, total = list_export_jobs(db, limit, offset, sourceId, status)
    return ExportListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/exports/{export_id}", response_model=ExportJobOut)
def get_export(export_id: str, db: Session = Depends(get_db)) -> ExportJobOut:
    return get_export_job(db, export_id)


@router.get("/exports/{export_id}/download")
def download_export(export_id: str, db: Session = Depends(get_db)) -> FileResponse:
    job = db.get(ExportJob, export_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")
    if job.status != "completed" or not job.output_path:
        raise HTTPException(status_code=409, detail="Export is not ready")
    path = Path(job.output_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Export file not found")
    return FileResponse(path, filename=path.name, media_type="video/mp4")


@router.get("/system/status")
def system_status(db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    sources = list_sources(db)
    return {
        "version": "0.1.0",
        "ffmpeg": {"available": shutil.which("ffmpeg") is not None},
        "ffprobe": {"available": shutil.which("ffprobe") is not None},
        "database": {"available": settings.db_path.exists(), "path": str(settings.db_path)},
        "logging": {
            "level": settings.log_level,
            "format": settings.log_format,
            "file": str(settings.resolved_log_file),
        },
        "recordingsRoot": {
            "path": str(settings.recordings_root_path),
            "readable": settings.recordings_root_path.exists(),
        },
        "cache": {
            "thumbnailBytes": 0,
            "exportBytes": sum(
                file.stat().st_size for file in settings.exports_path.rglob("*") if file.is_file()
            )
            if settings.exports_path.exists()
            else 0,
        },
        "sources": [source.model_dump() for source in sources],
    }


@router.get("/system/logs")
def system_logs(lines: int = Query(default=200, ge=1, le=2000)) -> dict:
    settings = get_settings()
    path = settings.resolved_log_file
    if not path.exists():
        return {"path": str(path), "lines": []}
    content = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return {"path": str(path), "lines": content[-lines:]}
