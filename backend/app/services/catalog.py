import json
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, or_, select

from app.core.errors import AppError
from app.core.pagination import decode_cursor, encode_cursor
from app.core.time import iso_utc
from app.db.models import Segment


def clock(value, zone):
    if value is None:
        return ""
    try:
        return (
            datetime.fromtimestamp(value / 1000, UTC)
            .astimezone(ZoneInfo(zone))
            .strftime("%H:%M:%S")
        )
    except (ValueError, OverflowError):
        return ""


def segment_dto(row):
    return {
        "id": row.id,
        "sourceId": row.source_id,
        "filename": row.filename,
        "relativePath": row.relative_path,
        "sizeBytes": row.size_bytes,
        "startAt": iso_utc(row.start_at),
        "endAt": iso_utc(row.end_at),
        "durationMs": row.duration_ms,
        "timeSource": row.time_source,
        "timeConfidence": row.time_confidence,
        "videoCodec": row.video_codec,
        "audioCodec": row.audio_codec,
        "container": row.container,
        "width": row.width,
        "height": row.height,
        "fpsNum": row.fps_num,
        "fpsDen": row.fps_den,
        "availability": row.availability,
        "playbackStatus": row.playback_status,
        "errorCode": row.error_code,
        "fingerprint": row.fingerprint,
        "indexRevision": row.index_revision,
        "thumbnailUrl": f"/api/segments/{row.id}/thumbnail",
    }


def list_segments(session, *, source_id, date, q, timezone, cursor, limit):
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise AppError("INVALID_TIMEZONE", "显示时区无效。") from error
    q = q.strip().casefold().replace("：", ":")
    context = json.dumps(
        {"sourceId": source_id, "date": str(date), "q": q, "timezone": timezone}, sort_keys=True
    )
    position = decode_cursor(cursor, context)
    statement = select(Segment)
    if source_id:
        statement = statement.where(Segment.source_id == source_id)
    if date:
        start = datetime.combine(date, time.min, zone)
        end = datetime.combine(date + timedelta(days=1), time.min, zone)
        statement = statement.where(
            Segment.start_at < int(end.timestamp() * 1000),
            Segment.end_at > int(start.timestamp() * 1000),
        )
    if q:
        statement = statement.where(
            or_(
                func.casefold(Segment.filename).contains(q, autoescape=True),
                func.recording_clock(Segment.start_at, timezone).contains(q, autoescape=True),
                func.recording_clock(Segment.end_at, timezone).contains(q, autoescape=True),
            )
        )
    ordered_start = func.coalesce(Segment.start_at, -9223372036854775808)
    if position:
        try:
            last_start, last_id = json.loads(position)
            if type(last_start) is not int or not isinstance(last_id, str):
                raise ValueError()
        except (ValueError, TypeError) as error:
            raise AppError("INVALID_CURSOR", "分页位置已失效，请重新加载。") from error
        statement = statement.where(
            (ordered_start < last_start) | ((ordered_start == last_start) & (Segment.id < last_id))
        )
    rows = list(
        session.scalars(
            statement.order_by(ordered_start.desc(), Segment.id.desc()).limit(limit + 1)
        )
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = (
        encode_cursor(
            context,
            json.dumps(
                [
                    rows[-1].start_at if rows[-1].start_at is not None else -9223372036854775808,
                    rows[-1].id,
                ]
            ),
        )
        if has_more
        else None
    )
    return {"items": [segment_dto(row) for row in rows], "nextCursor": next_cursor}
