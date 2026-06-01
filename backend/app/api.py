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
    SearchResponse,
    SegmentListResponse,
    SegmentOut,
    SegmentResolveOut,
    SourceCreate,
    SourceCreateOut,
    SourcesResponse,
    SourceUpdate,
    TimelineResponse,
    TranscriptionJobListResponse,
    TranscriptionJobOut,
    TranscriptionListResponse,
)
from app.services.paths import directory_tree
from app.services.exports import create_export_job, get_export_job, list_export_jobs
from app.services.sources import create_source, list_sources, queue_scan, source_to_out, update_source
from app.services.streaming import stream_file
from app.services.timeline import build_timeline, resolve_segment_at
from app.services.thumbnails import ensure_thumbnail, thumbnail_url
from app.services.transcription import (
    create_transcription_job,
    run_transcription_job,
    list_transcription_jobs,
    get_transcription_job,
    list_transcriptions,
    get_transcription_status,
    delete_transcription,
)
from app.services.search import search_transcriptions, get_search_suggestions, get_popular_searches

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


@router.delete("/sources/{source_id}")
def delete_source(
    source_id: str,
    db: Session = Depends(get_db),
) -> dict:
    """删除录像源"""
    from app.services.sources import delete_source as delete_source_fn
    delete_source_fn(db, source_id)
    return {"deleted": True}


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


@router.get("/settings/asr")
def get_asr_settings_api() -> dict:
    from app.services.asr import get_asr_config
    return get_asr_config()


@router.patch("/settings/asr")
def update_asr_settings_api(payload: dict) -> dict:
    from app.services.asr import update_asr_config, get_asr_service
    result = update_asr_config(payload)
    # 如果模型配置变了，清除已加载的模型
    if any(key in payload for key in ("model", "modelSize", "device")):
        get_asr_service().invalidate_model()
    return result


# 语音识别相关端点

@router.post("/segments/{segment_id}/transcribe", response_model=TranscriptionJobOut)
def trigger_transcription(
    segment_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> TranscriptionJobOut:
    """手动触发语音识别"""
    try:
        job = create_transcription_job(db, segment_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    # 后台执行识别任务
    background_tasks.add_task(run_transcription_job, job.id)

    return TranscriptionJobOut(
        id=job.id,
        segmentId=job.segment_id,
        status=job.status,
        progress=job.progress,
        errorMessage=job.error_message,
        createdAt=job.created_at,
        updatedAt=job.updated_at,
    )


@router.get("/transcription-jobs", response_model=TranscriptionJobListResponse)
def get_transcription_jobs(
    segmentId: str | None = None,
    status: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> TranscriptionJobListResponse:
    """获取识别任务列表"""
    result = list_transcription_jobs(db, segmentId, status, limit, offset)
    return TranscriptionJobListResponse(**result)


@router.get("/transcription-jobs/{job_id}", response_model=TranscriptionJobOut)
def get_transcription_job_by_id(job_id: str, db: Session = Depends(get_db)) -> TranscriptionJobOut:
    """获取识别任务详情"""
    job = get_transcription_job(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Transcription job not found")
    return TranscriptionJobOut(**job)


@router.get("/segments/{segment_id}/transcription", response_model=TranscriptionListResponse)
def get_segment_transcription(
    segment_id: str,
    limit: int = Query(default=1000, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> TranscriptionListResponse:
    """获取某个视频的识别结果"""
    result = list_transcriptions(db, segment_id, limit, offset)
    return TranscriptionListResponse(**result)


@router.get("/segments/{segment_id}/transcription/status")
def get_segment_transcription_status(
    segment_id: str,
    db: Session = Depends(get_db),
) -> dict:
    """获取某个视频的识别状态"""
    return get_transcription_status(db, segment_id)


@router.delete("/segments/{segment_id}/transcription")
def delete_segment_transcription(
    segment_id: str,
    db: Session = Depends(get_db),
) -> dict:
    """删除某个视频的所有识别结果"""
    count = delete_transcription(db, segment_id)
    return {"deleted": count}


@router.get("/segments/{segment_id}/transcription/export")
def export_transcription(
    segment_id: str,
    format: str = Query(default="srt", regex="^(srt|txt)$"),
    db: Session = Depends(get_db),
) -> dict:
    """导出识别结果（SRT/TXT）"""
    result = list_transcriptions(db, segment_id, limit=5000)
    transcriptions = result["items"]

    if format == "srt":
        content = _export_srt(transcriptions)
    else:
        content = _export_txt(transcriptions)

    return {"content": content}


def _export_srt(transcriptions: list[dict]) -> str:
    """导出为 SRT 格式"""
    lines = []
    for i, t in enumerate(transcriptions, 1):
        start = _format_srt_time(t["startTime"])
        end = _format_srt_time(t["endTime"])
        text = t["text"]
        lines.append(f"{i}")
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)


def _export_txt(transcriptions: list[dict]) -> str:
    """导出为 TXT 格式"""
    lines = []
    for t in transcriptions:
        start = _format_time(t["startTime"])
        text = t["text"]
        lines.append(f"[{start}] {text}")
    return "\n".join(lines)


def _format_srt_time(seconds: float) -> str:
    """格式化 SRT 时间"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _format_time(seconds: float) -> str:
    """格式化时间"""
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{minutes:02d}:{secs:02d}"


@router.get("/search", response_model=SearchResponse)
def search(
    q: str = Query(..., min_length=1),
    sourceId: str | None = None,
    startDate: str | None = None,
    endDate: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> SearchResponse:
    """全文检索"""
    result = search_transcriptions(db, q, sourceId, startDate, endDate, limit, offset)
    return SearchResponse(**result)


@router.get("/search/suggestions")
def search_suggestions(
    q: str = Query(..., min_length=1),
    limit: int = Query(default=10, ge=1, le=20),
    db: Session = Depends(get_db),
) -> dict:
    """获取搜索建议"""
    suggestions = get_search_suggestions(db, q, limit)
    return {"suggestions": suggestions}


@router.get("/search/popular")
def popular_searches(
    limit: int = Query(default=10, ge=1, le=20),
    db: Session = Depends(get_db),
) -> dict:
    """获取热门搜索"""
    popular = get_popular_searches(db, limit)
    return {"popular": popular}
