"""识别任务管理模块"""

from __future__ import annotations

import logging
import queue
import threading
from pathlib import Path

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.core.settings_store import get_effective
from app.db import SessionLocal
from app.models import Source, Transcription, TranscriptionJob, VideoSegment
from app.services.common import make_id, now_iso
from app.services.asr import get_asr_service

logger = logging.getLogger(__name__)

# NAS 友好：所有识别任务进入一个进程内队列，避免批量操作时创建大量后台线程。
_max_concurrent_transcriptions = 1
_job_queue: queue.Queue[str] = queue.Queue()
_worker_threads: list[threading.Thread] = []
_worker_lock = threading.Lock()
_running_jobs: set[str] = set()
_running_jobs_lock = threading.Lock()


def set_max_concurrent_transcriptions(max_count: int):
    """设置最大并发识别任务数"""
    global _max_concurrent_transcriptions
    _max_concurrent_transcriptions = max(1, min(int(max_count or 1), 8))
    _ensure_workers()


def _ensure_workers() -> None:
    """按配置启动队列 worker。"""
    with _worker_lock:
        while len(_worker_threads) < _max_concurrent_transcriptions:
            worker_index = len(_worker_threads) + 1
            thread = threading.Thread(
                target=_worker_loop,
                name=f"transcription-worker-{worker_index}",
                daemon=True,
            )
            thread.start()
            _worker_threads.append(thread)


def _worker_loop() -> None:
    while True:
        job_id = _job_queue.get()
        try:
            run_transcription_job(job_id)
        except Exception:
            logger.exception("transcription worker failed while processing %s", job_id)
        finally:
            _job_queue.task_done()


def enqueue_transcription_job(job_id: str) -> None:
    """把识别任务放入队列。"""
    _ensure_workers()
    _job_queue.put(job_id)
    logger.info(
        "transcription job enqueued",
        extra={"job_id": job_id, "queue_size": _job_queue.qsize(), "max_workers": _max_concurrent_transcriptions},
    )


def resume_pending_transcription_jobs(limit: int = 50) -> int:
    """服务重启后恢复未完成的识别任务。"""
    db = SessionLocal()
    try:
        jobs = db.scalars(
            select(TranscriptionJob)
            .where(TranscriptionJob.status.in_(["pending", "processing"]))
            .order_by(TranscriptionJob.created_at.asc())
            .limit(limit)
        ).all()
        for job in jobs:
            job.status = "pending"
            job.stage = "queued"
            job.updated_at = now_iso()
        if jobs:
            db.commit()
        for job in jobs:
            enqueue_transcription_job(job.id)
        return len(jobs)
    finally:
        db.close()


def get_running_jobs_count() -> int:
    """获取当前运行中的任务数"""
    with _running_jobs_lock:
        return len(_running_jobs)


def get_queue_size() -> int:
    """获取等待中的任务数量。"""
    return _job_queue.qsize()


def create_transcription_job(db: Session, segment_id: str) -> TranscriptionJob:
    """创建识别任务"""
    # 检查 segment 是否存在
    segment = db.get(VideoSegment, segment_id)
    if not segment:
        raise ValueError(f"Segment not found: {segment_id}")
    if not segment.audio_codec:
        raise ValueError("该片段没有音频轨道，无法语音识别")

    completed_count = db.scalar(
        select(func.count()).select_from(Transcription).where(Transcription.segment_id == segment_id)
    ) or 0
    if completed_count > 0:
        raise ValueError("该片段已经有语音识别结果，如需重跑请先删除字幕")

    # 检查是否已有进行中的任务
    existing_job = db.scalar(
        select(TranscriptionJob)
        .where(TranscriptionJob.segment_id == segment_id)
        .where(TranscriptionJob.status.in_(["pending", "processing"]))
    )
    if existing_job:
        raise ValueError(f"Transcription job already exists: {existing_job.id}")

    # 创建新任务
    job = TranscriptionJob(
        id=make_id("tj"),
        segment_id=segment_id,
        status="pending",
        stage="queued",
        progress=0.0,
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    logger.info(f"Created transcription job {job.id} for segment {segment_id}")
    return job


def run_transcription_job(job_id: str) -> None:
    """运行识别任务。请通过 enqueue_transcription_job 入队调用。"""
    with _running_jobs_lock:
        _running_jobs.add(job_id)

    db = SessionLocal()
    audio_path = None
    try:
        job = db.get(TranscriptionJob, job_id)
        if not job:
            logger.error(f"Transcription job not found: {job_id}")
            return
        if job.status == "completed":
            return
        if job.status not in ("pending", "processing"):
            logger.info("skip transcription job with status %s", job.status, extra={"job_id": job_id})
            return

        # 更新状态为处理中
        job.status = "processing"
        job.stage = "preparing"
        job.progress = 0.02
        job.updated_at = now_iso()
        db.commit()

        # 获取 segment
        segment = db.get(VideoSegment, job.segment_id)
        if not segment:
            raise ValueError(f"Segment not found: {job.segment_id}")
        if not segment.audio_codec:
            raise ValueError("该片段没有音频轨道，无法语音识别")
        source = db.get(Source, segment.source_id)
        language = None
        if source and source.transcribe_language not in ("global", "auto"):
            language = source.transcribe_language

        # 检查文件是否存在
        video_path = Path(segment.path)
        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found: {video_path}")

        # 更新进度：开始提取音频
        job.stage = "extracting_audio"
        job.progress = 0.05
        job.updated_at = now_iso()
        db.commit()

        # 提取音频
        asr_service = get_asr_service()
        timeout_seconds = int(get_effective("asr_timeout_seconds", 600))
        audio_path = asr_service.extract_audio(str(video_path), timeout=timeout_seconds)

        # 更新进度：音频提取完成，开始识别
        job.stage = "transcribing"
        job.progress = 0.20
        job.updated_at = now_iso()
        db.commit()

        # 执行识别
        asr_segments = asr_service.transcribe(audio_path, language=language)

        # 更新进度：识别完成，开始保存
        job.stage = "saving"
        job.progress = 0.90
        job.updated_at = now_iso()
        db.commit()

        # 保存识别结果
        for seg in asr_segments:
            transcription = Transcription(
                id=make_id("trs"),
                segment_id=job.segment_id,
                start_time=seg["start"],
                end_time=seg["end"],
                text=seg["text"],
                confidence=seg["confidence"],
                created_at=now_iso(),
            )
            db.add(transcription)

        # 更新任务状态
        job.status = "completed"
        job.stage = ""
        job.progress = 1.0
        job.updated_at = now_iso()
        db.commit()

        logger.info(f"Transcription job {job_id} completed: {len(asr_segments)} segments")

    except Exception as e:
        # 更新失败状态
        job = db.get(TranscriptionJob, job_id)
        if job:
            job.status = "failed"
            job.error_message = str(e)
            job.updated_at = now_iso()
            db.commit()
        logger.exception(f"Transcription job {job_id} failed")

    finally:
        if audio_path and Path(audio_path).exists():
            try:
                Path(audio_path).unlink()
            except Exception:
                pass
        with _running_jobs_lock:
            _running_jobs.discard(job_id)
        db.close()


def list_transcription_jobs(
    db: Session,
    segment_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """列出识别任务"""
    filters = []
    if segment_id:
        filters.append(TranscriptionJob.segment_id == segment_id)
    if status:
        filters.append(TranscriptionJob.status == status)

    total_query = select(func.count()).select_from(TranscriptionJob)
    jobs_query = select(TranscriptionJob).order_by(TranscriptionJob.created_at.desc()).limit(limit).offset(offset)

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


def get_transcription_job(db: Session, job_id: str) -> dict | None:
    """获取识别任务详情"""
    job = db.get(TranscriptionJob, job_id)
    if not job:
        return None
    return _job_to_out(job)


def list_transcriptions(
    db: Session,
    segment_id: str,
    limit: int = 1000,
    offset: int = 0,
) -> dict:
    """列出某个视频的识别结果"""
    total_query = select(func.count()).select_from(Transcription).where(Transcription.segment_id == segment_id)
    transcriptions_query = (
        select(Transcription)
        .where(Transcription.segment_id == segment_id)
        .order_by(Transcription.start_time.asc())
        .limit(limit)
        .offset(offset)
    )

    total = db.scalar(total_query) or 0
    transcriptions = db.scalars(transcriptions_query).all()

    return {
        "items": [_transcription_to_out(t) for t in transcriptions],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def get_transcription_status(db: Session, segment_id: str) -> dict:
    """获取某个视频的识别状态"""
    # 检查是否有任务
    job = db.scalar(
        select(TranscriptionJob)
        .where(TranscriptionJob.segment_id == segment_id)
        .order_by(TranscriptionJob.created_at.desc())
    )

    if not job:
        return {"status": "none", "progress": 0.0}

    return {
        "status": job.status,
        "stage": job.stage or "",
        "progress": job.progress,
        "jobId": job.id,
        "errorMessage": job.error_message,
        "concurrency": {
            "running": get_running_jobs_count(),
            "queued": get_queue_size(),
            "max": _max_concurrent_transcriptions,
        },
    }


def delete_transcription(db: Session, segment_id: str) -> int:
    """删除某个视频的所有识别结果"""
    result = db.execute(
        select(Transcription).where(Transcription.segment_id == segment_id)
    )
    transcriptions = result.scalars().all()
    count = len(transcriptions)

    for t in transcriptions:
        db.delete(t)

    db.commit()
    return count


def _job_to_out(job: TranscriptionJob) -> dict:
    """转换任务为输出格式"""
    return {
        "id": job.id,
        "segmentId": job.segment_id,
        "status": job.status,
        "stage": job.stage or "",
        "progress": job.progress,
        "errorMessage": job.error_message,
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
    }


def _transcription_to_out(transcription: Transcription) -> dict:
    """转换识别结果为输出格式"""
    return {
        "id": transcription.id,
        "segmentId": transcription.segment_id,
        "startTime": transcription.start_time,
        "endTime": transcription.end_time,
        "text": transcription.text,
        "confidence": transcription.confidence,
        "createdAt": transcription.created_at,
    }
