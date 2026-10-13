import json
from datetime import date as Date
from typing import Annotated, Literal

from fastapi import APIRouter, Body, Header, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import RequestKey, SourceCreate, SourcePatch, TaskCreate
from app.core.errors import AppError
from app.core.pagination import decode_cursor, encode_cursor
from app.core.time import iso_utc
from app.db.models import Artifact, BusinessLog, Segment, Source, Task
from app.services.catalog import list_segments, segment_dto
from app.services.sources import create_source, source_dto, update_source
from app.tasks.queue import ACTIVE, cancel, submit, submit_prepare, task_dto

router = APIRouter(prefix="/api")
KeyHeader = Annotated[RequestKey | None, Header(alias="Idempotency-Key")]


@router.get("/sources")
def sources(request: Request):
    with Session(request.app.state.engine) as session:
        return {
            "items": [
                source_dto(session, row)
                for row in session.scalars(select(Source).order_by(Source.created_at, Source.id))
            ],
            "nextCursor": None,
        }


@router.post("/sources", status_code=201)
def add_source(request: Request, body: SourceCreate, key: KeyHeader = None):
    return create_source(
        request.app.state.engine, request.app.state.config, request.app.state.directories, body, key
    )


@router.patch("/sources/{source_id}")
def patch_source(request: Request, source_id: str, body: SourcePatch):
    return update_source(request.app.state.engine, request.app.state.directories, source_id, body)


@router.post("/sources/{source_id}/scan", status_code=202)
def scan_source(
    request: Request, source_id: str, key: KeyHeader = None, body: Annotated[dict, Body()] = None
):
    if body:
        raise AppError("INVALID_TASK_PAYLOAD", "目录扫描不接受额外的执行参数。")
    return submit(request.app.state.engine, source_id, "scan", key)


@router.post("/tasks", status_code=202)
def create_task(request: Request, body: TaskCreate, key: KeyHeader = None):
    if body.kind == "prepare":
        raise AppError("SEGMENT_REQUIRED", "请在具体录像片段上发起播放准备。")
    return submit(request.app.state.engine, body.source_id, body.kind, key)


@router.get("/tasks")
def tasks(
    request: Request,
    status: Literal[
        "all", "active", "queued", "running", "cancelling", "completed", "failed", "cancelled"
    ] = "all",
    kind: Literal["scan", "reindex", "prepare", "export"] | None = None,
    sourceId: str | None = None,
    cursor: str | None = Query(None, max_length=2048),
    limit: int = Query(50, ge=1, le=200),
):
    context = json.dumps([status, kind, sourceId])
    position = decode_cursor(cursor, context)
    statement = select(Task)
    if status == "active":
        statement = statement.where(Task.status.in_(ACTIVE))
    elif status != "all":
        statement = statement.where(Task.status == status)
    if kind:
        statement = statement.where(Task.kind == kind)
    if sourceId:
        statement = statement.where(Task.source_id == sourceId)
    if position:
        try:
            last_time, last_id = json.loads(position)
            if type(last_time) is not int or not isinstance(last_id, str):
                raise ValueError()
        except (ValueError, TypeError) as error:
            raise AppError("INVALID_CURSOR", "分页位置已失效，请重新加载。") from error
        statement = statement.where(
            (Task.created_at < last_time) | ((Task.created_at == last_time) & (Task.id < last_id))
        )
    with Session(request.app.state.engine) as session:
        rows = list(
            session.scalars(
                statement.order_by(Task.created_at.desc(), Task.id.desc()).limit(limit + 1)
            )
        )
        more = len(rows) > limit
        rows = rows[:limit]
        return {
            "items": [task_dto(session, row) for row in rows],
            "nextCursor": encode_cursor(context, json.dumps([rows[-1].created_at, rows[-1].id]))
            if more
            else None,
        }


@router.get("/tasks/{task_id}")
def task_detail(request: Request, task_id: str):
    with Session(request.app.state.engine) as session:
        task = session.get(Task, task_id)
        if task is None:
            raise AppError("TASK_NOT_FOUND", "任务不存在。", 404)
        return task_dto(session, task)


@router.post("/tasks/{task_id}/cancel")
def cancel_task(request: Request, task_id: str):
    return cancel(request.app.state.engine, task_id)


@router.post("/tasks/{task_id}/retry", status_code=202)
def retry_task(
    request: Request, task_id: str, key: KeyHeader = None, body: Annotated[dict, Body()] = None
):
    if body:
        raise AppError("INVALID_TASK_PAYLOAD", "当前扫描重试不接受额外的执行参数。")
    with Session(request.app.state.engine) as session:
        task = session.get(Task, task_id)
        if task is None:
            raise AppError("TASK_NOT_FOUND", "任务不存在。", 404)
        source_id, kind, payload = task.source_id, task.kind, task.payload_json
    if kind == "prepare":
        return submit_prepare(
            request.app.state.engine,
            request.app.state.config,
            payload["segmentId"],
            key,
            force=payload.get("force", False),
            retry_of=task_id,
        )
    return submit(request.app.state.engine, source_id, kind, key, retry_of=task_id)


@router.get("/segments")
def segments(
    request: Request,
    sourceId: str | None = None,
    date: Date | None = None,
    q: str = Query("", max_length=300),
    viewTimezone: str | None = None,
    cursor: str | None = Query(None, max_length=2048),
    limit: int = Query(50, ge=1, le=200),
):
    with Session(request.app.state.engine) as session:
        return list_segments(
            session,
            source_id=sourceId,
            date=date,
            q=q,
            timezone=viewTimezone or request.app.state.config.timezone,
            cursor=cursor,
            limit=limit,
        )


@router.get("/segments/{segment_id}")
def segment_detail(request: Request, segment_id: str):
    with Session(request.app.state.engine) as session:
        segment = session.get(Segment, segment_id)
        if segment is None:
            raise AppError("SEGMENT_NOT_FOUND", "录像片段不存在。", 404)
        return segment_dto(segment)


@router.get("/segments/{segment_id}/thumbnail")
def thumbnail(request: Request, segment_id: str):
    with Session(request.app.state.engine) as session:
        segment = session.get(Segment, segment_id)
        if segment is None or segment.availability != "available":
            raise AppError("THUMBNAIL_NOT_READY", "录像预览图尚未准备好。", 404)
        artifact = session.scalar(
            select(Artifact).where(
                Artifact.segment_id == segment.id,
                Artifact.kind == "thumbnail",
                Artifact.status == "ready",
                Artifact.input_fingerprint == segment.fingerprint,
            )
        )
        if artifact is None:
            raise AppError("THUMBNAIL_NOT_READY", "录像预览图尚未准备好。", 404)
        path = (request.app.state.config.data / artifact.relative_path).resolve()
        if not path.is_relative_to(request.app.state.config.data) or not path.is_file():
            raise AppError("THUMBNAIL_NOT_READY", "录像预览图已失效。", 404)
    return FileResponse(path, media_type="image/jpeg")


@router.get("/logs")
def logs(
    request: Request,
    taskId: str | None = None,
    sourceId: str | None = None,
    cursor: str | None = Query(None, max_length=2048),
    limit: int = Query(50, ge=1, le=200),
):
    context = json.dumps([taskId, sourceId])
    position = decode_cursor(cursor, context)
    statement = select(BusinessLog)
    if taskId:
        statement = statement.where(BusinessLog.task_id == taskId)
    if sourceId:
        statement = statement.where(BusinessLog.source_id == sourceId)
    if position:
        try:
            stamp, row_id = json.loads(position)
            if type(stamp) is not int or not isinstance(row_id, str):
                raise ValueError()
        except (ValueError, TypeError) as error:
            raise AppError("INVALID_CURSOR", "分页位置已失效，请重新加载。") from error
        statement = statement.where(
            (BusinessLog.created_at < stamp)
            | ((BusinessLog.created_at == stamp) & (BusinessLog.id < row_id))
        )
    with Session(request.app.state.engine) as session:
        rows = list(
            session.scalars(
                statement.order_by(BusinessLog.created_at.desc(), BusinessLog.id.desc()).limit(
                    limit + 1
                )
            )
        )
        more = len(rows) > limit
        rows = rows[:limit]
        return {
            "items": [
                {
                    "id": row.id,
                    "createdAt": iso_utc(row.created_at),
                    "level": row.level,
                    "kind": row.kind,
                    "sourceId": row.source_id,
                    "taskId": row.task_id,
                    "eventCode": row.event_code,
                    "title": row.title,
                    "detail": row.detail_json,
                }
                for row in rows
            ],
            "nextCursor": encode_cursor(context, json.dumps([rows[-1].created_at, rows[-1].id]))
            if more
            else None,
        }
