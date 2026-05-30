"""识别任务管理模块"""

from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import SessionLocal
from app.models import Transcription, TranscriptionJob, VideoSegment
from app.services.common import make_id, now_iso
from app.services.asr import get_asr_service

logger = logging.getLogger(__name__)


def create_transcription_job(db: Session, segment_id: str) -> TranscriptionJob:
    """创建识别任务"""
    # 检查 segment 是否存在
    segment = db.get(VideoSegment, segment_id)
    if not segment:
        raise ValueError(f"Segment not found: {segment_id}")

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
    """运行识别任务（后台执行）"""
    db = SessionLocal()
    try:
        job = db.get(TranscriptionJob, job_id)
        if not job:
            logger.error(f"Transcription job not found: {job_id}")
            return

        # 更新状态为处理中
        job.status = "processing"
        job.progress = 0.0
        job.updated_at = now_iso()
        db.commit()

        # 获取 segment
        segment = db.get(VideoSegment, job.segment_id)
        if not segment:
            raise ValueError(f"Segment not found: {job.segment_id}")

        # 检查文件是否存在
        video_path = Path(segment.path)
        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found: {video_path}")

        # 执行识别
        asr_service = get_asr_service()
        asr_segments = asr_service.process_video(str(video_path))

        # 更新进度
        job.progress = 0.5
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
        "progress": job.progress,
        "jobId": job.id,
        "errorMessage": job.error_message,
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
