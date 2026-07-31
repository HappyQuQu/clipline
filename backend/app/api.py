from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.settings_store import get_effective, update_settings
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
    VisionDetectionListResponse,
    VisionJobListResponse,
    VisionJobOut,
)
from app.services.paths import directory_tree
from app.services.exports import create_export_job, get_export_job, list_export_jobs
from app.services.sources import create_source, list_sources, queue_scan, source_to_out, update_source
from app.services.streaming import stream_file
from app.services.playback_proxy import ensure_playback_proxy
from app.services.timeline import build_timeline, resolve_segment_at
from app.services.thumbnails import ensure_thumbnail, thumbnail_url
from app.services.transcription import (
    create_transcription_job,
    enqueue_transcription_job,
    list_transcription_jobs,
    get_transcription_job,
    list_transcriptions,
    get_transcription_status,
    delete_transcription,
)
from app.services.vision import (
    create_vision_job,
    delete_segment_detections,
    enqueue_vision_job,
    get_vision_job,
    get_vision_status,
    list_detection_labels,
    list_detections,
    list_segment_detections,
    list_vision_jobs,
)
from app.services.vision_detector import get_vision_detector
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
    path = Path(segment.path)
    if segment.needs_transcode:
        path = ensure_playback_proxy(segment.id, path)
    return stream_file(path, request)


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
            "level": get_effective("log_level", "INFO"),
            "format": get_effective("log_format", "text"),
            "file": str(settings.resolved_log_file),
        },
        "recordingsRoot": {
            "path": str(settings.recordings_root_path),
            "readable": settings.recordings_root_path.exists(),
        },
        "paths": {
            "data": str(settings.data_path),
            "models": str(settings.models_path),
            "vision": str(settings.vision_models_path),
            "modelscope": str(settings.modelscope_cache_path),
            "whisper": str(settings.whisper_cache_path),
            "huggingface": str(settings.huggingface_cache_path),
            "torch": str(settings.torch_cache_path),
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


@router.get("/settings")
def get_all_settings() -> dict:
    """获取所有有效设置（按类别分组）"""
    from app.services.asr import get_asr_config
    settings = get_settings()
    return {
        "recordings": {
            "recordings_root": str(settings.recordings_root_path),
            "scan_interval_seconds": int(get_effective("scan_interval_seconds", 300)),
            "skip_recent_seconds": int(get_effective("skip_recent_seconds", 30)),
            "timezone": get_effective("timezone", "Asia/Shanghai"),
            "scan_workers_per_source": int(get_effective("scan_workers_per_source", 1)),
            "global_ffprobe_concurrency": int(get_effective("global_ffprobe_concurrency", 4)),
            "auto_cleanup_days": int(get_effective("auto_cleanup_days", 0)),
            "idle_scan_enabled": bool(get_effective("idle_scan_enabled", False)),
            "idle_scan_start_hour": int(get_effective("idle_scan_start_hour", 2)),
            "idle_scan_end_hour": int(get_effective("idle_scan_end_hour", 6)),
        },
        "export": {
            "export_ttl_hours": int(get_effective("export_ttl_hours", 24)),
            "max_export_minutes": int(get_effective("max_export_minutes", 30)),
            "max_concurrent_exports": int(get_effective("max_concurrent_exports", 1)),
            "thumbnail_mode": get_effective("thumbnail_mode", "middle"),
        },
        "asr": get_asr_config(),
        "vision": {
            "model": get_effective("vision_model", "yolov8n"),
            "device": get_effective("vision_device", "cpu"),
            "maxConcurrent": int(get_effective("vision_max_concurrent", 1)),
            "sampleIntervalSeconds": int(get_effective("vision_sample_interval_seconds", 5)),
            "imageSize": int(get_effective("vision_image_size", 416)),
            "confidence": int(get_effective("vision_confidence", 45)),
            "maxAutoJobsPerScan": int(get_effective("vision_max_auto_jobs_per_scan", 10)),
            "modelStatus": get_vision_detector().model_status(),
        },
        "logs": {
            "log_level": get_effective("log_level", "INFO"),
            "log_format": get_effective("log_format", "text"),
            "log_file": str(settings.resolved_log_file),
        },
        "paths": {
            "data": str(settings.data_path),
            "models": str(settings.models_path),
            "vision": str(settings.vision_models_path),
            "modelscope": str(settings.modelscope_cache_path),
            "whisper": str(settings.whisper_cache_path),
            "huggingface": str(settings.huggingface_cache_path),
            "torch": str(settings.torch_cache_path),
        },
    }


@router.patch("/settings")
def update_all_settings(payload: dict) -> dict:
    """批量更新设置"""
    try:
        update_settings(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    # 如果 ASR 模型配置变了，清除已加载的模型
    asr_model_keys = {"asr_model", "asr_model_size", "asr_device"}
    if asr_model_keys & set(payload.keys()):
        from app.services.asr import get_asr_service
        get_asr_service().invalidate_model()
    if "asr_max_concurrent" in payload:
        from app.services.transcription import set_max_concurrent_transcriptions
        set_max_concurrent_transcriptions(int(payload["asr_max_concurrent"]))
    if "vision_max_concurrent" in payload:
        from app.services.vision import set_max_concurrent_vision_jobs
        set_max_concurrent_vision_jobs(int(payload["vision_max_concurrent"]))
    if {"vision_model", "vision_device"} & set(payload.keys()):
        get_vision_detector().invalidate()
    # 如果日志配置变了，立即生效
    log_keys = {"log_level", "log_format"}
    if log_keys & set(payload.keys()):
        from app.core.logging import reconfigure_logging
        reconfigure_logging()
    return get_all_settings()


@router.patch("/settings/asr")
def update_asr_settings_api(payload: dict) -> dict:
    from app.services.asr import update_asr_config, get_asr_service
    result = update_asr_config(payload)
    # 如果模型配置变了，清除已加载的模型
    if any(key in payload for key in ("model", "model_size", "device")):
        get_asr_service().invalidate_model()
    return result


# ASR 模型管理端点


@router.get("/settings/asr/models")
def list_asr_models() -> dict:
    """列出所有 ASR 模型及下载状态"""
    from app.services.model_manager import list_models
    return {"models": list_models()}


@router.post("/settings/asr/models/{model_id}/download")
def download_asr_model(model_id: str) -> dict:
    """触发模型下载"""
    from app.services.model_manager import download_model
    try:
        return download_model(model_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/settings/asr/models/{model_id}/status")
def get_asr_model_status(model_id: str) -> dict:
    """获取模型下载状态"""
    from app.services.model_manager import get_download_status
    return get_download_status(model_id)


@router.delete("/settings/asr/models/{model_id}")
def delete_asr_model(model_id: str) -> dict:
    """删除模型缓存"""
    from app.services.model_manager import delete_model, is_active_model
    try:
        current_engine = str(get_effective("asr_model", "funasr"))
        current_size = str(get_effective("asr_model_size", "base"))
        if is_active_model(model_id, current_engine, current_size):
            raise HTTPException(status_code=409, detail="当前使用中的模型不可删除")
        deleted = delete_model(model_id)
        return {"deleted": deleted}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/settings/models/reload")
def reload_runtime_models() -> dict:
    """Release loaded model sessions so the next recognition task reloads current files."""
    from app.services.asr import get_asr_config, get_asr_service

    asr_service = get_asr_service()
    asr_service.invalidate_model()
    detector = get_vision_detector()
    detector.invalidate()
    return {
        "reloaded": True,
        "asr": {**get_asr_config(), "loaded": asr_service.model_loaded},
        "vision": detector.model_status(),
    }


# 语音识别相关端点

@router.post("/segments/{segment_id}/transcribe", response_model=TranscriptionJobOut)
def trigger_transcription(
    segment_id: str,
    db: Session = Depends(get_db),
) -> TranscriptionJobOut:
    """手动触发语音识别"""
    try:
        job = create_transcription_job(db, segment_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    enqueue_transcription_job(job.id)

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


# 视频视觉识别相关端点

@router.post("/segments/{segment_id}/vision", response_model=VisionJobOut)
def trigger_vision_detection(
    segment_id: str,
    force: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> VisionJobOut:
    try:
        job = create_vision_job(db, segment_id, force=force)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    enqueue_vision_job(job.id)
    return VisionJobOut(
        id=job.id,
        segmentId=job.segment_id,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        model=job.model,
        labels=[],
        confidenceThreshold=job.confidence_threshold,
        sampleIntervalSeconds=job.sample_interval_seconds,
        imageSize=job.image_size,
        detectionsCount=job.detections_count,
        errorMessage=job.error_message,
        createdAt=job.created_at,
        updatedAt=job.updated_at,
    )


@router.get("/vision-jobs", response_model=VisionJobListResponse)
def get_vision_jobs(
    segmentId: str | None = None,
    status: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> VisionJobListResponse:
    result = list_vision_jobs(db, segmentId, status, limit, offset)
    return VisionJobListResponse(**result)


@router.get("/vision-jobs/{job_id}", response_model=VisionJobOut)
def get_vision_job_by_id(job_id: str, db: Session = Depends(get_db)) -> VisionJobOut:
    job = get_vision_job(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Vision job not found")
    return VisionJobOut(**job)


@router.get("/segments/{segment_id}/vision", response_model=VisionDetectionListResponse)
def get_segment_vision_detections(
    segment_id: str,
    db: Session = Depends(get_db),
) -> VisionDetectionListResponse:
    result = list_segment_detections(db, segment_id)
    return VisionDetectionListResponse(**result)


@router.get("/segments/{segment_id}/vision/status")
def get_segment_vision_status(
    segment_id: str,
    db: Session = Depends(get_db),
) -> dict:
    return get_vision_status(db, segment_id)


@router.delete("/segments/{segment_id}/vision")
def delete_segment_vision_detections(
    segment_id: str,
    db: Session = Depends(get_db),
) -> dict:
    return {"deleted": delete_segment_detections(db, segment_id)}


@router.get("/vision/detections", response_model=VisionDetectionListResponse)
def get_vision_detections(
    sourceId: str | None = None,
    labels: str | None = None,
    startDate: str | None = None,
    endDate: str | None = None,
    limit: int = Query(default=2000, ge=1, le=10000),
    db: Session = Depends(get_db),
) -> VisionDetectionListResponse:
    parsed_labels = [label for label in (labels or "").split(",") if label]
    result = list_detections(db, sourceId, parsed_labels, startDate, endDate, limit)
    return VisionDetectionListResponse(**result)


@router.get("/vision/labels")
def get_vision_labels(sourceId: str | None = None, db: Session = Depends(get_db)) -> dict:
    return {"items": list_detection_labels(db, sourceId)}


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
