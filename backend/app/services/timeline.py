from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Source, VideoSegment
from app.schemas import TimelineGapOut, TimelineResponse, TimelineSegmentOut
from app.services.common import parse_iso


def get_day_bounds(date_value: str) -> tuple[datetime, datetime]:
    tz = ZoneInfo(get_settings().timezone)
    day = datetime.fromisoformat(date_value).date()
    start = datetime.combine(day, time.min, tz)
    end = start + timedelta(days=1)
    return start, end


def indexed_segments_for_range(db: Session, source_id: str, start: datetime, end: datetime):
    return db.scalars(
        select(VideoSegment)
        .where(
            and_(
                VideoSegment.source_id == source_id,
                VideoSegment.scan_status == "indexed",
                VideoSegment.start_time.is_not(None),
                VideoSegment.end_time.is_not(None),
                VideoSegment.end_time > start.isoformat(),
                VideoSegment.start_time < end.isoformat(),
            )
        )
        .order_by(VideoSegment.start_time.asc())
    ).all()


def build_timeline(db: Session, source_id: str, date_value: str) -> TimelineResponse:
    source = db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    day_start, day_end = get_day_bounds(date_value)
    segments = indexed_segments_for_range(db, source_id, day_start, day_end)
    gaps: list[TimelineGapOut] = []
    previous_end = day_start
    for segment in segments:
        segment_start = parse_iso(segment.start_time)
        segment_end = parse_iso(segment.end_time)
        if segment_start > previous_end:
            gaps.append(
                TimelineGapOut(
                    startTime=previous_end.isoformat(),
                    endTime=segment_start.isoformat(),
                    durationSeconds=(segment_start - previous_end).total_seconds(),
                )
            )
        previous_end = max(previous_end, segment_end)
    if previous_end < day_end:
        gaps.append(
            TimelineGapOut(
                startTime=previous_end.isoformat(),
                endTime=day_end.isoformat(),
                durationSeconds=(day_end - previous_end).total_seconds(),
            )
        )
    return TimelineResponse(
        sourceId=source_id,
        date=date_value,
        timezone=get_settings().timezone,
        segments=[
            TimelineSegmentOut(
                id=segment.id,
                startTime=segment.start_time,
                endTime=segment.end_time,
                durationSeconds=segment.duration_seconds or 0,
                playable=bool(segment.playable),
                needsTranscode=bool(segment.needs_transcode),
                thumbnailUrl=None,
            )
            for segment in segments
        ],
        gaps=gaps,
    )


def resolve_segment_at(db: Session, source_id: str, time_value: str) -> dict:
    target = parse_iso(time_value)
    segment = db.scalar(
        select(VideoSegment)
        .where(
            VideoSegment.source_id == source_id,
            VideoSegment.scan_status == "indexed",
            VideoSegment.start_time <= target.isoformat(),
            VideoSegment.end_time > target.isoformat(),
        )
        .order_by(VideoSegment.start_time.asc())
        .limit(1)
    )
    if segment:
        start = parse_iso(segment.start_time)
        return {
            "segmentId": segment.id,
            "streamUrl": f"/api/segments/{segment.id}/stream",
            "offsetSeconds": (target - start).total_seconds(),
            "startTime": segment.start_time,
            "endTime": segment.end_time,
            "playable": bool(segment.playable),
        }

    previous = db.scalar(
        select(VideoSegment)
        .where(
            VideoSegment.source_id == source_id,
            VideoSegment.scan_status == "indexed",
            VideoSegment.end_time <= target.isoformat(),
        )
        .order_by(VideoSegment.end_time.desc())
        .limit(1)
    )
    next_segment = db.scalar(
        select(VideoSegment)
        .where(
            VideoSegment.source_id == source_id,
            VideoSegment.scan_status == "indexed",
            VideoSegment.start_time > target.isoformat(),
        )
        .order_by(VideoSegment.start_time.asc())
        .limit(1)
    )
    return {
        "segmentId": None,
        "nearestPrevious": {"segmentId": previous.id, "time": previous.end_time} if previous else None,
        "nearestNext": {"segmentId": next_segment.id, "time": next_segment.start_time}
        if next_segment
        else None,
    }

