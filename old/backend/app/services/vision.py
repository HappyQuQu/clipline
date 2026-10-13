from __future__ import annotations

import json
import logging
import queue
import threading
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.settings_store import get_effective
from app.db import SessionLocal
from app.models import Source, VideoSegment, VisionDetection, VisionJob
from app.services.common import make_id, now_iso
from app.services.vision_detector import bbox_to_json, get_vision_detector

logger = logging.getLogger(__name__)

_max_concurrent_vision_jobs = 1
_job_queue: queue.Queue[str] = queue.Queue()
_worker_threads: list[threading.Thread] = []
_worker_lock = threading.Lock()
_running_jobs: set[str] = set()
_running_jobs_lock = threading.Lock()


def set_max_concurrent_vision_jobs(max_count: int) -> None:
    global _max_concurrent_vision_jobs
    _max_concurrent_vision_jobs = max(1, min(int(max_count or 1), 4))
    _ensure_workers()


def _ensure_workers() -> None:
    with _worker_lock:
        while len(_worker_threads) < _max_concurrent_vision_jobs:
            worker_index = len(_worker_threads) + 1
            thread = threading.Thread(
                target=_worker_loop,
                name=f"vision-worker-{worker_index}",
                daemon=True,
            )
            thread.start()
            _worker_threads.append(thread)


def _worker_loop() -> None:
    while True:
        job_id = _job_queue.get()
        try:
            run_vision_job(job_id)
        except Exception:
            logger.exception("vision worker failed while processing %s", job_id)
        finally:
            _job_queue.task_done()


def enqueue_vision_job(job_id: str) -> None:
    _ensure_workers()
    _job_queue.put(job_id)
    logger.info(
        "vision job enqueued",
        extra={"job_id": job_id, "queue_size": _job_queue.qsize(), "max_workers": _max_concurrent_vision_jobs},
    )


def resume_pending_vision_jobs(limit: int = 50) -> int:
    db = SessionLocal()
    try:
        jobs = db.scalars(
            select(VisionJob)
            .where(VisionJob.status.in_(["pending", "processing"]))
            .order_by(VisionJob.created_at.asc())
            .limit(limit)
        ).all()
        for job in jobs:
            job.status = "pending"
            job.stage = "queued"
            job.updated_at = now_iso()
        if jobs:
            db.commit()
        for job in jobs:
            enqueue_vision_job(job.id)
        return len(jobs)
    finally:
        db.close()


def get_running_jobs_count() -> int:
    with _running_jobs_lock:
        return len(_running_jobs)


def get_queue_size() -> int:
    return _job_queue.qsize()


def create_vision_job(db: Session, segment_id: str, force: bool = False) -> VisionJob:
    segment = db.get(VideoSegment, segment_id)
    if not segment:
        raise ValueError(f"Segment not found: {segment_id}")
    if not segment.video_codec:
        raise ValueError("该片段没有视频轨道，无法视觉识别")

    existing_job = db.scalar(
        select(VisionJob)
        .where(VisionJob.segment_id == segment_id)
        .where(VisionJob.status.in_(["pending", "processing"]))
    )
    if existing_job:
        raise ValueError(f"Vision job already exists: {existing_job.id}")

    completed_count = db.scalar(
        select(func.count()).select_from(VisionDetection).where(VisionDetection.segment_id == segment_id)
    ) or 0
    if completed_count > 0 and not force:
        raise ValueError("该片段已经有视觉识别结果，如需重跑请使用 force=true")

    source = db.get(Source, segment.source_id)
    labels = source.detect_labels if source else '["person","cat","dog","vehicle","phone"]'
    try:
        parsed_labels = json.loads(labels)
    except json.JSONDecodeError:
        parsed_labels = ["person", "cat", "dog", "vehicle", "phone"]
    confidence = (source.detect_confidence if source else int(get_effective("vision_confidence", 45))) / 100

    job = VisionJob(
        id=make_id("vj"),
        segment_id=segment_id,
        status="pending",
        stage="queued",
        progress=0.0,
        model=str(get_effective("vision_model", "yolov8n")),
        labels_json=json.dumps(parsed_labels, ensure_ascii=False),
        confidence_threshold=max(0.01, min(float(confidence), 0.99)),
        sample_interval_seconds=float(get_effective("vision_sample_interval_seconds", 5)),
        image_size=int(get_effective("vision_image_size", 416)),
        detections_count=0,
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def run_vision_job(job_id: str) -> None:
    with _running_jobs_lock:
        _running_jobs.add(job_id)

    db = SessionLocal()
    try:
        job = db.get(VisionJob, job_id)
        if not job:
            logger.error("vision job not found: %s", job_id)
            return
        if job.status == "completed":
            return
        if job.status not in ("pending", "processing"):
            logger.info("skip vision job with status %s", job.status, extra={"job_id": job_id})
            return

        job.status = "processing"
        job.stage = "preparing"
        job.progress = 0.02
        job.updated_at = now_iso()
        db.commit()

        segment = db.get(VideoSegment, job.segment_id)
        if not segment:
            raise ValueError(f"Segment not found: {job.segment_id}")
        video_path = Path(segment.path)
        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found: {video_path}")

        job.stage = "detecting"
        job.progress = 0.12
        job.updated_at = now_iso()
        db.commit()

        labels = json.loads(job.labels_json)
        detector = get_vision_detector()
        last_reported_progress = job.progress

        def update_detection_progress(stage: str, value: float) -> None:
            nonlocal last_reported_progress
            value = min(0.89, max(job.progress, value))
            if value - last_reported_progress < 0.01 and stage == job.stage:
                return
            job.stage = stage
            job.progress = value
            job.updated_at = now_iso()
            db.commit()
            last_reported_progress = value

        spans = detector.detect_video(
            video_path=video_path,
            labels=labels,
            confidence_threshold=job.confidence_threshold,
            sample_interval_seconds=job.sample_interval_seconds,
            image_size=job.image_size,
            timeout=900,
            progress_callback=update_detection_progress,
        )

        job.stage = "saving"
        job.progress = 0.90
        job.updated_at = now_iso()
        db.commit()

        db.execute(delete(VisionDetection).where(VisionDetection.segment_id == job.segment_id))
        for span in spans:
            db.add(
                VisionDetection(
                    id=make_id("vd"),
                    segment_id=job.segment_id,
                    source_id=segment.source_id,
                    label=span.label,
                    label_name=span.label_name,
                    confidence=span.confidence,
                    start_time=span.start_time,
                    end_time=span.end_time,
                    frame_time=span.frame_time,
                    bbox_json=bbox_to_json(span.bbox),
                    model=job.model,
                    created_at=now_iso(),
                )
            )

        job.status = "completed"
        job.stage = ""
        job.progress = 1.0
        job.detections_count = len(spans)
        job.error_message = None
        job.updated_at = now_iso()
        db.commit()
        logger.info("vision job %s completed: %d detections", job_id, len(spans))
    except Exception as exc:
        job = db.get(VisionJob, job_id)
        if job:
            job.status = "failed"
            job.error_message = str(exc)
            job.updated_at = now_iso()
            db.commit()
        logger.exception("vision job %s failed", job_id)
    finally:
        with _running_jobs_lock:
            _running_jobs.discard(job_id)
        db.close()


def list_vision_jobs(
    db: Session,
    segment_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    filters = []
    if segment_id:
        filters.append(VisionJob.segment_id == segment_id)
    if status:
        filters.append(VisionJob.status == status)

    total_query = select(func.count()).select_from(VisionJob)
    jobs_query = select(VisionJob).order_by(VisionJob.created_at.desc()).limit(limit).offset(offset)
    if filters:
        total_query = total_query.where(*filters)
        jobs_query = jobs_query.where(*filters)

    total = db.scalar(total_query) or 0
    jobs = db.scalars(jobs_query).all()
    return {
        "items": [_job_to_out(job) for job in jobs],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def get_vision_job(db: Session, job_id: str) -> dict | None:
    job = db.get(VisionJob, job_id)
    return _job_to_out(job) if job else None


def get_vision_status(db: Session, segment_id: str) -> dict:
    job = db.scalar(
        select(VisionJob)
        .where(VisionJob.segment_id == segment_id)
        .order_by(VisionJob.created_at.desc())
    )
    if not job:
        count = db.scalar(
            select(func.count()).select_from(VisionDetection).where(VisionDetection.segment_id == segment_id)
        ) or 0
        if count:
            return {"status": "completed", "progress": 1.0, "detectionsCount": count}
        return {"status": "none", "progress": 0.0, "detectionsCount": 0}
    result = _job_to_out(job)
    result["concurrency"] = {
        "running": get_running_jobs_count(),
        "queued": get_queue_size(),
        "max": _max_concurrent_vision_jobs,
    }
    return result


def list_segment_detections(db: Session, segment_id: str) -> dict:
    detections = db.scalars(
        select(VisionDetection)
        .where(VisionDetection.segment_id == segment_id)
        .order_by(VisionDetection.start_time.asc(), VisionDetection.confidence.desc())
    ).all()
    return {"items": [_detection_to_out(item) for item in detections], "total": len(detections)}


def list_detections(
    db: Session,
    source_id: str | None = None,
    labels: list[str] | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 2000,
) -> dict:
    query = select(VisionDetection, VideoSegment.start_time).join(
        VideoSegment, VisionDetection.segment_id == VideoSegment.id
    )
    filters = []
    if source_id:
        filters.append(VisionDetection.source_id == source_id)
    if labels:
        filters.append(VisionDetection.label.in_(labels))
    if start_date:
        filters.append(VideoSegment.start_time >= f"{start_date}T00:00:00")
    if end_date:
        filters.append(VideoSegment.start_time <= f"{end_date}T23:59:59")
    if filters:
        query = query.where(*filters)
    rows = db.execute(
        query.order_by(VideoSegment.start_time.desc(), VisionDetection.start_time.asc()).limit(limit)
    ).all()
    return {
        "items": [
            {**_detection_to_out(detection), "segmentStartTime": segment_start_time}
            for detection, segment_start_time in rows
        ],
        "total": len(rows),
        "limit": limit,
    }


def list_detection_labels(db: Session, source_id: str | None = None) -> list[dict]:
    query = select(
        VisionDetection.label,
        VisionDetection.label_name,
        func.count(VisionDetection.id),
    ).group_by(VisionDetection.label, VisionDetection.label_name)
    if source_id:
        query = query.where(VisionDetection.source_id == source_id)
    rows = db.execute(query.order_by(func.count(VisionDetection.id).desc())).all()
    return [
        {"label": label, "labelName": label_name, "count": count}
        for label, label_name, count in rows
    ]


def delete_segment_detections(db: Session, segment_id: str) -> int:
    detections = db.scalars(select(VisionDetection).where(VisionDetection.segment_id == segment_id)).all()
    count = len(detections)
    for detection in detections:
        db.delete(detection)
    db.commit()
    return count


def _job_to_out(job: VisionJob) -> dict:
    return {
        "id": job.id,
        "segmentId": job.segment_id,
        "status": job.status,
        "stage": job.stage or "",
        "progress": job.progress,
        "model": job.model,
        "labels": json.loads(job.labels_json),
        "confidenceThreshold": job.confidence_threshold,
        "sampleIntervalSeconds": job.sample_interval_seconds,
        "imageSize": job.image_size,
        "detectionsCount": job.detections_count,
        "errorMessage": job.error_message,
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
    }


def _detection_to_out(detection: VisionDetection) -> dict:
    bbox = None
    if detection.bbox_json:
        try:
            bbox = json.loads(detection.bbox_json)
        except json.JSONDecodeError:
            bbox = None
    return {
        "id": detection.id,
        "segmentId": detection.segment_id,
        "sourceId": detection.source_id,
        "label": detection.label,
        "labelName": detection.label_name,
        "confidence": detection.confidence,
        "startTime": detection.start_time,
        "endTime": detection.end_time,
        "frameTime": detection.frame_time,
        "bbox": bbox,
        "model": detection.model,
        "createdAt": detection.created_at,
    }
