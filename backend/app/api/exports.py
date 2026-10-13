from urllib.parse import quote

from fastapi import APIRouter, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.indexing import KeyHeader
from app.api.playback import serve_file
from app.api.schemas import ExportRequest
from app.core.errors import AppError
from app.core.time import utc_now_ms
from app.db.models import Artifact, Task
from app.db.transactions import write_session
from app.services.export_plan import build_plan, public_plan, safe_filename
from app.services.exports import submit_export

router = APIRouter(prefix="/api/exports")


@router.post("/plan")
def preview(request: Request, body: ExportRequest):
    with Session(request.app.state.engine) as session:
        return public_plan(build_plan(session, request.app.state.config, body))


@router.post("", status_code=202)
def submit(request: Request, body: ExportRequest, key: KeyHeader = None):
    return submit_export(request.app.state.engine, request.app.state.config, body, key)


@router.post("/{task_id}/resubmit", status_code=202)
def resubmit(request: Request, task_id: str, key: KeyHeader = None):
    return submit_export(
        request.app.state.engine, request.app.state.config, key=key, retry_of=task_id, resubmit=True
    )


@router.api_route("/{task_id}/download", methods=["GET", "HEAD"])
def download(request: Request, task_id: str):
    config = request.app.state.config
    with write_session(request.app.state.engine) as session:
        task = session.get(Task, task_id)
        if task is None or task.kind != "export":
            raise AppError("TASK_NOT_FOUND", "导出任务不存在。", 404)
        if task.status != "completed":
            raise AppError("EXPORT_NOT_READY", "导出尚未完成，请稍后从任务中心下载。", 409)
        artifact = session.scalar(
            select(Artifact).where(
                Artifact.task_id == task.id, Artifact.kind == "export", Artifact.status == "ready"
            )
        )
        if artifact is None or artifact.expires_at is None or artifact.expires_at <= utc_now_ms():
            raise AppError("EXPORT_EXPIRED", "导出结果已过期，请重新导出。", 410)
        path = (config.data / artifact.relative_path).resolve()
        if (
            not path.is_relative_to(config.data / "exports")
            or not path.is_file()
            or path.stat().st_size != artifact.size_bytes
        ):
            raise AppError("EXPORT_UNAVAILABLE", "导出文件已失效，请重新导出。", 410)
        artifact.last_access_at = utc_now_ms()
        size = artifact.size_bytes
        name = safe_filename(task.payload_json["name"])
        etag = f'"{task.result_json["sha256"]}"'
    return serve_file(
        request,
        path,
        size,
        None,
        etag,
        {
            "Content-Disposition": (
                f"attachment; filename=\"clipline-{task_id}.mp4\"; filename*=UTF-8''{quote(name)}"
            ),
            "Cache-Control": "private, no-store",
        },
    )
