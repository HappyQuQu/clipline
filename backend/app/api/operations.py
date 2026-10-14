import asyncio
import json
import platform
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import __version__
from app.api.streaming import ClosingStreamingResponse
from app.core.errors import AppError
from app.core.time import iso_utc, utc_now_ms
from app.db.migrations import expected_revision
from app.db.models import BusinessLog, Event, Source, Task
from app.services import logs
from app.services.settings import read_settings

router = APIRouter(prefix="/api")


def filters(
    q: str = Query("", max_length=300),
    level: Literal["info", "warning", "error"] | None = None,
    kind: Literal["scan", "reindex", "prepare", "export", "source", "settings", "system"]
    | None = None,
    sourceId: str | None = Query(None, max_length=80),
    taskId: str | None = Query(None, max_length=80),
):
    return {
        "q": q.strip().casefold(),
        "level": level,
        "kind": kind,
        "sourceId": sourceId,
        "taskId": taskId,
    }


LogFilters = Annotated[dict, Depends(filters)]


@router.get("/logs")
def list_logs(
    request: Request,
    selected: LogFilters,
    cursor: str | None = Query(None, max_length=2048),
    limit: int = Query(50, ge=1, le=200),
):
    with Session(request.app.state.engine) as session:
        session.connection().exec_driver_sql("BEGIN")
        return logs.list_logs(session, selected, cursor, limit)


def download_json(request, selected, snapshot, diagnostic):
    engine, config = request.app.state.engine, request.app.state.config
    filename = "clipline-diagnostics.json" if diagnostic else "clipline-logs.json"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }
    with Session(engine) as session:
        if snapshot is not None and snapshot > logs.newest(session):
            raise AppError("LOG_SNAPSHOT_EXPIRED", "日志快照已失效，请刷新列表后重新导出。", 410)
    if request.method == "HEAD":
        return Response(media_type="application/json", headers=headers)

    # The transaction belongs to the iterator, so disconnect closes the SQLite snapshot.
    def chunks():
        with Session(engine) as session:
            session.connection().exec_driver_sql("BEGIN")
            latest = logs.newest(session)
            watermark = latest if snapshot is None else snapshot
            if watermark > latest:
                # Usually caught by the route; retain valid JSON if logs were cleared meanwhile.
                watermark = latest
            query = logs.statement(selected).where(BusinessLog.sequence <= watermark)
            count = session.scalar(select(func.count()).select_from(query.subquery()))
            metadata = {
                "version": __version__,
                "createdAt": iso_utc(utc_now_ms()),
                "filters": selected,
                "snapshot": watermark,
                "total": count,
            }
            if diagnostic:
                settings = read_settings(session, config)
                metadata["system"] = {
                    "version": __version__,
                    "schema": expected_revision(),
                    "arch": platform.machine(),
                    "exportTtlHours": config.export_ttl_hours,
                    "logRetentionDays": config.log_retention_days,
                    "playbackCacheMaxBytes": config.playback_cache_max_bytes,
                }
                metadata["settings"] = settings["groups"]
                metadata["sources"] = [
                    {
                        "id": row.id,
                        "name": row.name,
                        "enabled": row.enabled,
                        "recordingTimezone": row.recording_timezone,
                        "scanIntervalMinutes": row.scan_interval_minutes,
                    }
                    for row in session.scalars(
                        select(Source).where(Source.id == selected["sourceId"])
                        if selected.get("sourceId")
                        else select(Source).order_by(Source.created_at, Source.id)
                    )
                ]
            yield json.dumps(metadata, ensure_ascii=False)[:-1] + ","
            if diagnostic:
                yield '"tasks":['
                task_query = select(Task).order_by(Task.created_at, Task.id)
                if selected.get("taskId"):
                    task_query = task_query.where(Task.id == selected["taskId"])
                if selected.get("sourceId"):
                    task_query = task_query.where(Task.source_id == selected["sourceId"])
                if selected.get("kind") in ("scan", "reindex", "prepare", "export"):
                    task_query = task_query.where(Task.kind == selected["kind"])
                comma = ""
                for task in session.scalars(task_query.execution_options(yield_per=200)):
                    item = {
                        "id": task.id,
                        "kind": task.kind,
                        "status": task.status,
                        "sourceId": task.source_id,
                        "stage": task.stage,
                        "progress": task.progress,
                        "attemptNo": task.attempt_no,
                        "retryOfTaskId": task.retry_of_task_id,
                        "errorCode": task.error_code,
                        "result": logs.safe_detail(task.result_json),
                    }
                    yield comma + json.dumps(item, ensure_ascii=False)
                    comma = ","
                yield "],"
            yield '"items":['
            comma = ""
            for row in session.scalars(
                query.order_by(BusinessLog.sequence.desc()).execution_options(yield_per=200)
            ):
                yield comma + json.dumps(logs.dto(row, downloadable=True), ensure_ascii=False)
                comma = ","
            yield "]}"

    return ClosingStreamingResponse(
        chunks(),
        media_type="application/json",
        headers=headers,
    )


@router.api_route("/logs/export", methods=["GET", "HEAD"])
def export_logs(request: Request, selected: LogFilters, snapshot: int | None = Query(None, ge=0)):
    return download_json(request, selected, snapshot, False)


@router.api_route("/system/diagnostics", methods=["GET", "HEAD"])
def diagnostics(request: Request, selected: LogFilters, snapshot: int | None = Query(None, ge=0)):
    return download_json(request, selected, snapshot, True)


@router.get("/logs/{log_id}")
def log_detail(request: Request, log_id: str):
    with Session(request.app.state.engine) as session:
        row = session.scalar(select(BusinessLog).where(BusinessLog.id == log_id))
        if row is None:
            raise AppError("LOG_NOT_FOUND", "日志不存在或已超过保留期限。", 404)
        return logs.dto(row)


def event_batch(engine, after):
    with Session(engine) as session:
        oldest, latest = session.execute(select(func.min(Event.id), func.max(Event.id))).one()
        latest = latest or 0
        if after is None:
            return "ready", latest, []
        if after > latest or (oldest is not None and after < oldest - 1):
            return "reset", latest, []
        rows = list(
            session.scalars(select(Event).where(Event.id > after).order_by(Event.id).limit(100))
        )
        return (
            "events",
            latest,
            [
                {
                    "id": row.id,
                    "type": row.event_type,
                    "entityId": row.entity_id,
                    "sourceId": row.payload_json.get("sourceId"),
                    "taskId": row.payload_json.get("taskId"),
                }
                for row in rows
            ],
        )


@router.get("/events")
async def events(
    request: Request,
    after: int | None = Query(None, ge=0),
    last_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
):
    if last_id is not None:
        if not last_id.isdecimal() or len(last_id) > 18:
            raise AppError("INVALID_EVENT_ID", "事件游标无效。")
        after = int(last_id)

    async def stream():
        position, last_heartbeat = after, 0
        yield "retry: 3000\n\n"
        while not await request.is_disconnected():
            mode, latest, rows = await asyncio.to_thread(
                event_batch, request.app.state.engine, position
            )
            if mode in ("ready", "reset"):
                position = latest
                yield f'id: {latest}\nevent: {mode}\ndata: {{"refresh":true}}\n\n'
            for row in rows:
                position = row["id"]
                yield f"id: {position}\ndata: {json.dumps(row)}\n\n"
            now = asyncio.get_running_loop().time()
            if now - last_heartbeat >= 15:
                yield ": keep-alive\n\n"
                last_heartbeat = now
            await asyncio.sleep(0.5)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
