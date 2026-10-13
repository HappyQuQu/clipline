import os
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.time import iso_utc, utc_now_ms
from app.db.models import SavedSettings, Segment, Source, Task, new_id
from app.db.transactions import write_session
from app.services.events import emit
from app.services.idempotency import lookup, remember
from app.tasks.queue import ACTIVE, enqueue, finish


def source_dto(session, source):
    count = session.scalar(
        select(func.count()).select_from(Segment).where(Segment.source_id == source.id)
    )
    available = session.scalar(
        select(func.count())
        .select_from(Segment)
        .where(Segment.source_id == source.id, Segment.availability == "available")
    )
    size = session.scalar(
        select(func.coalesce(func.sum(Segment.size_bytes), 0)).where(
            Segment.source_id == source.id, Segment.availability != "missing"
        )
    )
    recent = session.scalar(
        select(Task)
        .where(Task.source_id == source.id, Task.kind.in_(("scan", "reindex")))
        .order_by(Task.created_at.desc(), Task.id.desc())
        .limit(1)
    )
    return {
        "id": source.id,
        "name": source.name,
        "path": source.canonical_path,
        "enabled": source.enabled,
        "scanIntervalMinutes": source.scan_interval_minutes,
        "recordingTimezone": source.recording_timezone,
        "autoTranscribe": False,
        "autoDetect": False,
        "segmentCount": count,
        "availableCount": available,
        "totalBytes": size,
        "lastScanAt": iso_utc(source.last_scan_at),
        "nextScanAt": iso_utc(source.next_scan_at),
        "createdAt": iso_utc(source.created_at),
        "updatedAt": iso_utc(source.updated_at),
        "revision": source.revision,
        "lastScanTask": (
            {
                "id": recent.id,
                "status": recent.status,
                "result": recent.result_json,
                "errorCode": recent.error_code,
            }
            if recent
            else None
        ),
    }


def check_duplicate(session, path, exclude_id=None):
    for source in session.scalars(select(Source)):
        if source.id == exclude_id:
            continue
        duplicate = source.canonical_path == str(path)
        if not duplicate:
            try:
                duplicate = os.path.samefile(path, source.canonical_path)
            except OSError:
                pass
        if duplicate:
            raise AppError(
                "SOURCE_DUPLICATE",
                "这个录像目录已经添加，请选择其他目录。",
                409,
                {"sourceId": source.id, "field": "path"},
            )


def create_source(engine, config, directories, body, key=None):
    payload = body.model_dump(mode="json", by_alias=True) | {"path": str(Path(body.path))}
    if "scan_interval_minutes" not in body.model_fields_set:
        payload.pop("scanIntervalMinutes")
    with Session(engine) as read:
        previous = lookup(read, "source:create", key, payload)
        if previous is not None:
            return previous
    path = directories.resolve(body.path)
    with write_session(engine) as session:
        previous = lookup(session, "source:create", key, payload)
        if previous is not None:
            return previous
        check_duplicate(session, path)
        if "scan_interval_minutes" in body.model_fields_set:
            interval = body.scan_interval_minutes
        else:
            scan = session.get(SavedSettings, "scan")
            interval = scan.value_json.get("interval", 5) if scan else 5
            interval = interval if interval in (5, 10, 30) else 5
        source = Source(
            id=new_id(),
            name=body.name,
            canonical_path=str(path),
            enabled=True,
            scan_interval_minutes=interval,
            recording_timezone=config.timezone,
            next_scan_at=utc_now_ms() + interval * 60_000 if interval is not None else None,
        )
        session.add(source)
        session.flush()
        emit(
            session,
            kind="source",
            code="SOURCE_CREATED",
            title="录像源已添加",
            source_id=source.id,
            detail={"name": source.name, "path": str(path)},
        )
        task = enqueue(session, source, "scan", "source_added")[0] if body.scan_on_create else None
        response = {"source": source_dto(session, source), "firstTaskId": task.id if task else None}
        remember(session, "source:create", key, payload, response, task.id if task else None)
        return response


def update_source(engine, directories, source_id, body):
    changes = body.model_dump(exclude_unset=True)
    path = directories.resolve(body.path) if "path" in changes else None
    with write_session(engine) as session:
        source = session.get(Source, source_id)
        if source is None:
            raise AppError("SOURCE_NOT_FOUND", "录像源不存在。", 404)
        if body.revision is not None and body.revision != source.revision:
            raise AppError("SOURCE_CHANGED", "录像源已被修改，请重新加载后再保存。", 409)
        actual = set()
        if path is not None and str(path) != source.canonical_path:
            if session.scalar(select(Segment.id).where(Segment.source_id == source.id).limit(1)):
                raise AppError(
                    "SOURCE_PATH_LOCKED", "此源已有索引，请添加新源来使用其他目录。", 409
                )
            if session.scalar(
                select(Task.id).where(Task.source_id == source.id, Task.status.in_(ACTIVE)).limit(1)
            ):
                raise AppError("SOURCE_BUSY", "此源正在处理任务，请先停止任务再改目录。", 409)
            check_duplicate(session, path, source.id)
            source.canonical_path = str(path)
            actual.add("path")
        if "name" in changes and body.name != source.name:
            source.name = body.name
            actual.add("name")
        if "enabled" in changes and body.enabled != source.enabled:
            source.enabled = body.enabled
            actual.add("enabled")
        if (
            "scan_interval_minutes" in changes
            and body.scan_interval_minutes != source.scan_interval_minutes
        ):
            source.scan_interval_minutes = body.scan_interval_minutes
            actual.add("scanIntervalMinutes")
        if not actual:
            return source_dto(session, source)
        if not source.enabled:
            source.next_scan_at = None
            for task in session.scalars(
                select(Task).where(
                    Task.source_id == source.id,
                    Task.status == "queued",
                    Task.kind.in_(("scan", "reindex")),
                )
            ):
                finish(
                    session,
                    task,
                    "cancelled",
                    code="SOURCE_DISABLED",
                    message="录像源已停用，维护任务未开始。",
                )
        elif {"enabled", "scanIntervalMinutes"} & actual:
            source.next_scan_at = (
                utc_now_ms() + source.scan_interval_minutes * 60_000
                if source.scan_interval_minutes is not None
                else None
            )
        source.updated_at = max(utc_now_ms(), source.updated_at + 1)
        source.revision += 1
        session.flush()
        emit(
            session,
            kind="source",
            code="SOURCE_UPDATED",
            title="录像源配置已更新",
            source_id=source.id,
            detail={"changedFields": sorted(actual), "enabled": source.enabled},
        )
        return source_dto(session, source)
