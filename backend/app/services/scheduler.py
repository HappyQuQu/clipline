from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db import SessionLocal
from app.models import ScanJob, Source
from app.services.scanner import create_scan_job, run_scan_job

logger = get_logger(__name__)
ACTIVE_SCAN_STATUSES = ("queued", "running")


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)


def _due_for_scan(source: Source, last_scan_at: str | None) -> bool:
    if not source.enabled or source.scan_interval_minutes <= 0:
        return False
    last_scan = _parse_time(last_scan_at)
    if last_scan is None:
        return True
    now = datetime.now(ZoneInfo(get_settings().timezone))
    return now - last_scan >= timedelta(minutes=source.scan_interval_minutes)


async def scheduled_scan_loop(stop_event: asyncio.Event) -> None:
    interval_seconds = max(30, get_settings().scan_interval_seconds)
    while not stop_event.is_set():
        try:
            with SessionLocal() as db:
                sources = db.scalars(select(Source).where(Source.enabled == 1, Source.scan_interval_minutes > 0)).all()
                for source in sources:
                    active_job = db.scalar(
                        select(ScanJob)
                        .where(ScanJob.source_id == source.id, ScanJob.status.in_(ACTIVE_SCAN_STATUSES))
                        .order_by(ScanJob.created_at.desc())
                        .limit(1)
                    )
                    if active_job:
                        continue
                    last_scan_at = db.scalar(
                        select(ScanJob.finished_at)
                        .where(ScanJob.source_id == source.id)
                        .order_by(ScanJob.created_at.desc())
                        .limit(1)
                    )
                    if _due_for_scan(source, last_scan_at):
                        scan_job_id = create_scan_job(source.id, trigger="scheduled")
                        asyncio.create_task(asyncio.to_thread(run_scan_job, scan_job_id))
                        logger.info(
                            "scheduled scan queued",
                            extra={"source_id": source.id, "scan_job_id": scan_job_id},
                        )
        except Exception:
            logger.exception("scheduled scan loop failed")

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
        except TimeoutError:
            continue
