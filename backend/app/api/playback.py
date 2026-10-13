import os
import re
from datetime import date as Date
from datetime import datetime

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.api.indexing import KeyHeader
from app.api.schemas import PlaybackLeaseRequest, PrepareRequest
from app.api.streaming import ClosingStreamingResponse
from app.core.errors import AppError
from app.core.time import utc_now_ms
from app.db.transactions import write_session
from app.services import playback, timeline
from app.services.usage import FileUse, view_lease
from app.tasks.queue import submit_prepare

router = APIRouter(prefix="/api")


@router.get("/sources/{source_id}/dates")
def dates(request: Request, source_id: str, viewTimezone: str | None = None):
    with Session(request.app.state.engine) as session:
        return timeline.recording_dates(
            session, source_id, viewTimezone or request.app.state.config.timezone
        )


@router.get("/timeline")
def get_timeline(
    request: Request,
    sourceId: str,
    date: Date,
    viewTimezone: str | None = None,
    startSeconds: float = Query(0, ge=0, lt=90000),
    endSeconds: float = Query(90000, gt=0, le=90000),
    cursor: str | None = Query(None, max_length=2048),
    limit: int = Query(100, ge=1, le=200),
):
    with Session(request.app.state.engine) as session:
        return timeline.timeline(
            session,
            sourceId,
            date,
            viewTimezone or request.app.state.config.timezone,
            startSeconds,
            endSeconds,
            cursor,
            limit,
        )


@router.get("/sources/{source_id}/resolve")
def resolve(request: Request, source_id: str, at: datetime):
    with Session(request.app.state.engine) as session:
        return timeline.resolve(session, source_id, at)


@router.get("/segments/{segment_id}/playback")
def status(request: Request, segment_id: str):
    with Session(request.app.state.engine) as session:
        return playback.playback_status(session, request.app.state.config, segment_id)


@router.post("/segments/{segment_id}/prepare", status_code=202)
def prepare(request: Request, segment_id: str, body: PrepareRequest, key: KeyHeader = None):
    return submit_prepare(
        request.app.state.engine, request.app.state.config, segment_id, key, force=body.force
    )


def parse_range(value, size):
    if len(value) > 200:
        return None
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
    if not match or not any(match.groups()) or size <= 0:
        return None
    left, right = match.groups()
    if not left:
        length = int(right)
        return (max(0, size - length), size - 1) if length > 0 else None
    start, end = int(left), min(int(right), size - 1) if right else size - 1
    return (start, end) if start < size and end >= start else None


@router.api_route("/segments/{segment_id}/media", methods=["GET", "HEAD"])
def stream(request: Request, segment_id: str, fingerprint: str = Query(..., max_length=128)):
    config = request.app.state.config
    with write_session(request.app.state.engine) as session:
        segment = playback.get_segment(session, segment_id)
        if segment.fingerprint != fingerprint:
            raise AppError("RECORDING_CHANGED", "录像已变化，请重新加载。", 409)
        original = playback.original_path(session, config, segment)
        cache = playback.cached(session, config, segment)
        usage = None
        if cache:
            artifact, path = cache
            artifact.last_access_at = utc_now_ms()
            expected_size, expected_mtime = artifact.size_bytes, None
            usage = FileUse(session, request.app.state.engine, config, artifact, path)
            etag = f'"{fingerprint}-{artifact.profile_hash}"'
        elif segment.playback_status == "direct":
            path, expected_size, expected_mtime = original, segment.size_bytes, segment.mtime_ns
            etag = f'"{fingerprint}"'
        else:
            raise AppError("PLAYBACK_NOT_READY", "请先准备浏览器兼容的播放版本。", 409)
        return serve_file(request, path, expected_size, expected_mtime, etag, usage=usage)


def serve_file(
    request,
    path,
    expected_size,
    expected_mtime,
    etag,
    extra_headers=None,
    usage=None,
    content_type="video/mp4",
):
    background = BackgroundTask(usage.close) if usage else None
    try:
        handle = (
            usage.handle if usage else os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb")
        )
        info = os.fstat(handle.fileno())
        if info.st_size != expected_size or (
            expected_mtime is not None and info.st_mtime_ns != expected_mtime
        ):
            handle.close()
            raise AppError("RECORDING_CHANGED", "录像已变化，请重新扫描。", 409)
    except OSError as error:
        raise AppError("RECORDING_UNAVAILABLE", "录像暂时无法读取。", 409) from error
    size = info.st_size
    headers = {
        "Accept-Ranges": "bytes",
        "ETag": etag,
        "Cache-Control": "private, no-cache",
        "Content-Type": content_type,
    }
    headers.update(extra_headers or {})
    if request.headers.get("if-none-match") == etag:
        handle.close()
        return Response(status_code=304, headers=headers, background=background)
    range_value = request.headers.get("range")
    if request.headers.get("if-range", etag) != etag or request.method == "HEAD":
        range_value = None
    interval = parse_range(range_value, size) if range_value else (0, size - 1)
    if interval is None:
        handle.close()
        return Response(
            status_code=416,
            background=background,
            headers=headers | {"Content-Range": f"bytes */{size}", "Content-Length": "0"},
        )
    start, end = interval
    headers["Content-Length"] = str(max(0, end - start + 1))
    if range_value:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    if request.method == "HEAD":
        handle.close()
        return Response(headers=headers, background=background)

    def chunks():
        try:
            handle.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                block = handle.read(min(1024 * 1024, remaining))
                if not block:
                    break
                remaining -= len(block)
                yield block
        finally:
            handle.close()

    return ClosingStreamingResponse(
        chunks(),
        close=usage.close if usage else handle.close,
        status_code=206 if range_value else 200,
        headers=headers,
    )


@router.post("/segments/{segment_id}/lease")
def lease_view(request: Request, segment_id: str, body: PlaybackLeaseRequest):
    with write_session(request.app.state.engine) as session:
        segment = playback.get_segment(session, segment_id)
        cache = playback.cached(session, request.app.state.config, segment)
        if cache is None:
            return {"leased": False}
        return view_lease(session, request.app.state.config, cache[0], body.client_id, body.active)
