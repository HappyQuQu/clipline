import json

from sqlalchemy import case, func, or_, select

from app.core.errors import AppError
from app.core.pagination import decode_cursor, encode_cursor
from app.core.time import iso_utc
from app.db.models import BusinessLog, Source

# Only documented business fields are downloadable; arbitrary provider/debug dictionaries are not.
DETAIL_FIELDS = set(
    "status trigger retryOfTaskId segmentId stage attemptNo result errorCode message "
    "relativePath name changedFields enabled group revision previous values interval "
    "skipRecent autoNext skipGaps defaultMode maxDuration concurrency mode "
    "expectedDurationMs actualDurationMs deviationMs videoCodec audioCodec width "
    "height fps frameCount warnings pieceCount unrecordedMs omittedMs sizeBytes "
    "sha256 downloadUrl expiresAt processed added updated unchanged missing invalid "
    "protected pending removedBytes removedFiles expiredExports evictedPlayback "
    "temporaryFiles logsPruned eventsPruned profile durationMs skippedFiles "
    "discovered failed thumbnails thumbnailFailed ".split()
)


def safe_detail(value):
    if isinstance(value, dict):
        return {key: safe_detail(item) for key, item in value.items() if key in DETAIL_FIELDS}
    if isinstance(value, list):
        return [safe_detail(item) for item in value]
    return value if isinstance(value, (str, int, float, bool)) or value is None else None


def dto(row, *, downloadable=False):
    return {
        "id": row.id,
        "createdAt": iso_utc(row.created_at),
        "level": row.level,
        "kind": row.kind,
        "sourceId": row.source_id,
        "taskId": row.task_id,
        "eventCode": row.event_code,
        "title": row.title,
        "detail": safe_detail(row.detail_json) if downloadable else row.detail_json,
    }


def statement(filters):
    query = select(BusinessLog)
    for key, field in [
        ("level", BusinessLog.level),
        ("kind", BusinessLog.kind),
        ("sourceId", BusinessLog.source_id),
        ("taskId", BusinessLog.task_id),
    ]:
        if filters.get(key):
            query = query.where(field == filters[key])
    q = filters.get("q", "").strip().casefold()
    if q:
        names = select(Source.id).where(func.casefold(Source.name).contains(q, autoescape=True))
        query = query.where(
            or_(
                func.casefold(BusinessLog.title).contains(q, autoescape=True),
                func.casefold(BusinessLog.event_code).contains(q, autoescape=True),
                func.log_text(BusinessLog.detail_json).contains(q, autoescape=True),
                func.casefold(BusinessLog.task_id).contains(q, autoescape=True),
                BusinessLog.source_id.in_(names),
            )
        )
    return query


def newest(session):
    return session.scalar(select(func.max(BusinessLog.sequence))) or 0


def list_logs(session, filters, cursor=None, limit=50):
    context = json.dumps(filters, sort_keys=True)
    position = decode_cursor(cursor, context)
    snapshot, before = newest(session), None
    if position:
        try:
            snapshot, before = json.loads(position)
            if (
                type(snapshot) is not int
                or type(before) is not int
                or not 0 < before <= snapshot
                or snapshot > newest(session)
            ):
                raise ValueError()
        except (ValueError, TypeError) as error:
            raise AppError("INVALID_CURSOR", "日志分页位置已失效，请重新加载。") from error
    query = statement(filters).where(BusinessLog.sequence <= snapshot)
    totals = query.subquery()
    count, warnings, errors = session.execute(
        select(
            func.count(),
            func.sum(case((totals.c.level == "warning", 1), else_=0)),
            func.sum(case((totals.c.level == "error", 1), else_=0)),
        ).select_from(totals)
    ).one()
    if before:
        query = query.where(BusinessLog.sequence < before)
    rows = list(session.scalars(query.order_by(BusinessLog.sequence.desc()).limit(limit + 1)))
    more, rows = len(rows) > limit, rows[:limit]
    return {
        "items": [dto(row) for row in rows],
        "summary": {"total": count, "warning": warnings or 0, "error": errors or 0},
        "snapshot": snapshot,
        "nextCursor": encode_cursor(context, json.dumps([snapshot, rows[-1].sequence]))
        if more
        else None,
    }
