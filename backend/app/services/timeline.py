import json
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select

from app.core.errors import AppError
from app.core.pagination import decode_cursor, encode_cursor
from app.core.time import iso_utc
from app.db.models import Segment, Source
from app.services.catalog import segment_dto


def local_day(date, timezone):
    try:
        zone = ZoneInfo(timezone)
        start = datetime.combine(date, time.min, zone)
        end = datetime.combine(date + timedelta(days=1), time.min, zone)
        return int(start.timestamp() * 1000), int(end.timestamp() * 1000)
    except (ZoneInfoNotFoundError, ValueError, OverflowError) as error:
        raise AppError("INVALID_TIMEZONE", "显示日期或时区无效。") from error


def require_source(session, source_id):
    source = session.get(Source, source_id)
    if source is None:
        raise AppError("SOURCE_NOT_FOUND", "录像源不存在。", 404)
    return source


def available(source_id):
    return select(Segment).where(
        Segment.source_id == source_id,
        Segment.availability == "available",
        Segment.start_at.is_not(None),
        Segment.end_at.is_not(None),
    )


def recording_dates(session, source_id, timezone):
    require_source(session, source_id)
    local_day(datetime.now(UTC).date(), timezone)
    zone = ZoneInfo(timezone)
    days = set()
    for start, end in session.execute(
        available(source_id).with_only_columns(Segment.start_at, Segment.end_at)
    ):
        first = datetime.fromtimestamp(start / 1000, UTC).astimezone(zone).date()
        last = datetime.fromtimestamp((end - 1) / 1000, UTC).astimezone(zone).date()
        while first <= last:
            days.add(first.isoformat())
            first += timedelta(days=1)
    return {"items": sorted(days, reverse=True), "timezone": timezone}


def timeline(session, source_id, date, timezone, start_seconds, end_seconds, cursor, limit):
    require_source(session, source_id)
    day_start, day_end = local_day(date, timezone)
    start = day_start + int(start_seconds * 1000)
    end = min(day_end, day_start + int(end_seconds * 1000))
    if end <= start:
        raise AppError("INVALID_TIME_RANGE", "时间范围需要位于当前日期内，结束晚于开始。")
    context = json.dumps([source_id, str(date), timezone, start_seconds, end_seconds])
    position = decode_cursor(cursor, context)
    all_rows = list(
        session.execute(
            available(source_id)
            .with_only_columns(Segment.start_at, Segment.end_at)
            .where(Segment.start_at < day_end, Segment.end_at > day_start)
            .order_by(Segment.start_at, Segment.id)
        )
    )
    coverage = []
    for row_start, row_end in all_rows:
        row_start, row_end = max(day_start, row_start), min(day_end, row_end)
        if coverage and row_start <= coverage[-1][1]:
            coverage[-1][1] = max(coverage[-1][1], row_end)
        else:
            coverage.append([row_start, row_end])
    gaps, point = [], day_start
    for left, right in coverage:
        if left > point:
            gaps.append([point, left])
        point = right
    if point < day_end:
        gaps.append([point, day_end])
    statement = available(source_id).where(Segment.start_at < end, Segment.end_at > start)
    if position:
        try:
            stamp, row_id = json.loads(position)
            if type(stamp) is not int or not isinstance(row_id, str):
                raise ValueError()
        except (ValueError, TypeError) as error:
            raise AppError("INVALID_CURSOR", "时间轴分页已失效，请重新加载。") from error
        statement = statement.where(
            (Segment.start_at > stamp) | ((Segment.start_at == stamp) & (Segment.id > row_id))
        )
    rows = list(session.scalars(statement.order_by(Segment.start_at, Segment.id).limit(limit + 1)))
    more, rows = len(rows) > limit, rows[:limit]
    return {
        "sourceId": source_id,
        "date": date.isoformat(),
        "timezone": timezone,
        "dayStartAt": iso_utc(day_start),
        "dayEndAt": iso_utc(day_end),
        "coverage": [{"startAt": iso_utc(a), "endAt": iso_utc(b)} for a, b in coverage],
        "gaps": [{"startAt": iso_utc(a), "endAt": iso_utc(b)} for a, b in gaps],
        "coverageMs": sum(b - a for a, b in coverage),
        "segmentCount": len(all_rows),
        "items": [segment_dto(row) for row in rows],
        "nextCursor": encode_cursor(context, json.dumps([rows[-1].start_at, rows[-1].id]))
        if more
        else None,
    }


def resolve(session, source_id, at):
    require_source(session, source_id)
    if at.tzinfo is None:
        raise AppError("INVALID_TIMESTAMP", "请提供包含时区的录像时间。")
    stamp = int(at.timestamp() * 1000)
    row = session.scalar(
        available(source_id)
        .where(Segment.start_at <= stamp, Segment.end_at > stamp)
        .order_by(Segment.start_at, Segment.id)
        .limit(1)
    )
    if row:
        return {
            "status": "recording",
            "segment": segment_dto(row),
            "offsetMs": stamp - row.start_at,
        }
    next_row = session.scalar(
        available(source_id)
        .where(Segment.start_at > stamp)
        .order_by(Segment.start_at, Segment.id)
        .limit(1)
    )
    return {
        "status": "gap",
        "segment": None,
        "nextAt": iso_utc(next_row.start_at) if next_row else None,
    }
