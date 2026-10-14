import hashlib
import json
import os
import shutil
from contextlib import nullcontext

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.time import iso_utc, utc_now_ms
from app.db.models import Artifact, Task, new_id
from app.db.transactions import write_session
from app.services import export_media
from app.services.events import emit
from app.services.export_plan import build_plan, digest, validate_inputs
from app.services.idempotency import lookup, remember


def submit_export(engine, config, body=None, key=None, *, retry_of=None, mode=None, resubmit=False):
    scope = (
        f"export:{'resubmit' if resubmit else 'retry'}:{retry_of}" if retry_of else "export:create"
    )
    request = (
        body.model_dump(mode="json", by_alias=True)
        if body
        else {"retryOfTaskId": retry_of, "mode": mode, "resubmit": resubmit}
    )
    with write_session(engine) as session:
        previous = lookup(session, scope, key, request)
        if previous is not None:
            return previous
        if retry_of:
            original = session.get(Task, retry_of)
            allowed = ("completed",) if resubmit else ("failed", "cancelled")
            if original is None or original.kind != "export":
                raise AppError("TASK_NOT_FOUND", "原导出任务不存在。", 404)
            if original.status not in allowed:
                raise AppError("TASK_NOT_RETRYABLE", "当前状态无法重新提交导出。", 409)
            plan = dict(original.payload_json)
            if mode:
                plan["mode"] = mode
            validate_inputs(session, config, plan)
        else:
            plan = build_plan(session, config, body)
            if body.plan_hash and body.plan_hash != digest(plan):
                raise AppError("EXPORT_PLAN_CHANGED", "录像计划已变化，请重新预览后提交。", 409)
        active_key = "export:" + digest(plan)
        existing = session.scalar(select(Task).where(Task.active_key == active_key))
        if existing and retry_of:
            raise AppError("TASK_ALREADY_ACTIVE", "相同导出正在处理，请查看当前任务。", 409)
        task = existing
        if task is None:
            task = Task(
                id=new_id(),
                kind="export",
                source_id=plan["sourceId"],
                payload_json=plan,
                active_key=active_key,
                retry_of_task_id=retry_of,
            )
            session.add(task)
            session.flush()
            emit(
                session,
                kind="export",
                code="TASK_RETRIED" if retry_of else "TASK_QUEUED",
                title="录像导出已加入后台队列",
                source_id=task.source_id,
                task_id=task.id,
                detail={
                    "mode": plan["mode"],
                    "expectedDurationMs": plan["expectedDurationMs"],
                    "retryOfTaskId": retry_of,
                },
            )
        response = {"taskId": task.id, "reused": existing is not None}
        remember(session, scope, key, request, response, task.id)
        return response


def fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def save_manifest(path, value):
    temporary = path.with_suffix(".pending")
    with temporary.open("w") as handle:
        json.dump(value, handle, sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    fsync_directory(path.parent)


def file_hash(path, context):
    value = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            context.check()
            value.update(block)
    return value.hexdigest()


def export(context):
    plan, task_id = context.claim.payload, context.claim.task_id
    config = context.config
    context.update("validate", 1, {})
    with Session(context.queue.engine) as session:
        paths = validate_inputs(session, config, plan)
    directory = config.data / "tmp" / task_id / context.claim.token
    directory.mkdir(parents=True, exist_ok=True)
    final = config.data / "exports" / f"{task_id}.mp4"
    manifests = config.data / "exports" / "manifests"
    manifests.mkdir(exist_ok=True)
    manifest_path = manifests / f"{task_id}.json"
    manifest = None
    target = directory / "output.mp4"
    if manifest_path.is_file():
        try:
            candidate = json.loads(manifest_path.read_text())
            staged = (config.data / candidate["temporaryPath"]).resolve()
            recovered = final if final.is_file() else staged
            if (
                candidate["planHash"] == digest(plan)
                and candidate["taskId"] == task_id
                and staged.is_relative_to(config.data / "tmp" / task_id)
                and recovered.is_file()
                and not recovered.is_symlink()
                and recovered.stat().st_size == candidate["sizeBytes"]
                and file_hash(recovered, context) == candidate["sha256"]
            ):
                # Only a verified manifest written after full output validation is reusable.
                manifest, target = candidate, recovered
        except (ValueError, KeyError, OSError):
            pass
    if manifest is None:
        if shutil.disk_usage(config.data).free < 128 * 1024**2:
            raise AppError("INSUFFICIENT_STORAGE", "数据目录剩余空间不足，无法导出。", 409)
        with context.media_slot() if plan["mode"] == "precise" else nullcontext():
            result = export_media.render(paths, plan, target, context)
        with target.open("rb") as handle:
            os.fsync(handle.fileno())
        manifest = {
            "taskId": task_id,
            "planHash": digest(plan),
            "temporaryPath": target.relative_to(config.data).as_posix(),
            "sizeBytes": target.stat().st_size,
            "sha256": file_hash(target, context),
            "result": result,
        }
        save_manifest(manifest_path, manifest)
    result = dict(manifest["result"]) | {
        "name": plan["name"],
        "mode": plan["mode"],
        "pieceCount": len(plan["pieces"]),
        "unrecordedMs": plan["unrecordedMs"],
        "omittedMs": plan["omittedMs"],
        "sizeBytes": manifest["sizeBytes"],
        "sha256": manifest["sha256"],
        "downloadUrl": f"/api/exports/{task_id}/download",
    }

    def finalize(session):
        validate_inputs(session, config, plan)
        # Queue.settle already checks the owner token and cancellation inside this transaction.
        if target != final:
            os.replace(target, final)
        fsync_directory(final.parent)
        expires = utc_now_ms() + config.export_ttl_hours * 3600_000
        result["expiresAt"] = iso_utc(expires)
        relative = final.relative_to(config.data).as_posix()
        artifact = session.scalar(select(Artifact).where(Artifact.relative_path == relative))
        if artifact is None:
            artifact = Artifact(
                kind="export",
                task_id=task_id,
                relative_path=relative,
                size_bytes=manifest["sizeBytes"],
            )
            session.add(artifact)
        artifact.status, artifact.expires_at = "ready", expires
        artifact.duration_ms = result["actualDurationMs"]
        artifact.input_fingerprint = manifest["planHash"]
        artifact.profile_hash = digest(plan["profile"])
        artifact.last_access_at = utc_now_ms()
        session.flush()

    context.update("publish", 99, {})
    return result, finalize
