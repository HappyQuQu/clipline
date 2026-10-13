from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import delete, select

from app.core.errors import AppError
from app.core.time import iso_utc, utc_now_ms
from app.db.models import RuntimeLease, SavedSettings, Source, Task, TaskAttempt, new_id
from app.db.transactions import write_session
from app.services.events import emit
from app.services.idempotency import lookup, remember

ACTIVE = ("queued", "running", "cancelling")
TERMINAL = ("completed", "failed", "cancelled")
HANDLERS = ("scan", "reindex")


class Cancelled(Exception):
    pass


class Interrupted(Exception):
    pass


class LeaseLost(Exception):
    pass


@dataclass(frozen=True)
class Claim:
    task_id: str
    source_id: str
    kind: str
    token: str
    owner: str
    attempt_no: int
    payload: dict


def task_dto(session, task):
    attempts = list(
        session.scalars(
            select(TaskAttempt)
            .where(TaskAttempt.task_id == task.id)
            .order_by(TaskAttempt.attempt_no)
        )
    )
    return {
        "id": task.id,
        "kind": task.kind,
        "sourceId": task.source_id,
        "status": task.status,
        "stage": task.stage,
        "progress": task.progress,
        "payload": task.payload_json,
        "result": task.result_json,
        "errorCode": task.error_code,
        "errorMessage": task.error_message,
        "retryOfTaskId": task.retry_of_task_id,
        "attemptNo": task.attempt_no,
        "recoveryCount": task.recovery_count,
        "createdAt": iso_utc(task.created_at),
        "startedAt": iso_utc(task.started_at),
        "finishedAt": iso_utc(task.finished_at),
        "checkpoint": attempts[-1].checkpoint_json if attempts else None,
        "attempts": [
            {
                "attemptNo": row.attempt_no,
                "status": row.status,
                "startedAt": iso_utc(row.started_at),
                "finishedAt": iso_utc(row.finished_at),
                "errorCode": row.error_code,
            }
            for row in attempts
        ],
    }


def concurrency(session):
    row = session.get(SavedSettings, "tasks")
    value = row.value_json.get("concurrency", 2) if row else 2
    return max(1, min(3, value)) if type(value) is int else 2


def enqueue(session, source, kind, trigger="manual", *, retry_of=None, reuse=True):
    if kind not in HANDLERS:
        raise AppError("CAPABILITY_NOT_AVAILABLE", "此任务类型尚未接入，请等待后续阶段。", 409)
    if not source.enabled:
        raise AppError("SOURCE_DISABLED", "请先启用录像源再提交维护任务。", 409)
    active_key = f"{source.id}:{kind}"
    existing = session.scalar(select(Task).where(Task.active_key == active_key))
    if existing:
        if not reuse:
            raise AppError("TASK_ALREADY_ACTIVE", "同类任务正在处理，请先查看当前任务。", 409)
        return existing, True
    scan = session.get(SavedSettings, "scan")
    skip = scan.value_json.get("skipRecent", 30) if scan else 30
    skip = skip if type(skip) is int and 0 <= skip <= 3600 else 30
    task = Task(
        id=new_id(),
        kind=kind,
        source_id=source.id,
        active_key=active_key,
        payload_json={
            "trigger": trigger,
            "sourcePath": source.canonical_path,
            "recordingTimezone": source.recording_timezone,
            "skipRecentSeconds": skip,
        },
        retry_of_task_id=retry_of,
    )
    session.add(task)
    session.flush()
    emit(
        session,
        kind=kind,
        code="TASK_QUEUED",
        title="任务已进入后台队列",
        source_id=source.id,
        task_id=task.id,
        detail={"status": "queued", "trigger": trigger},
    )
    return task, False


def submit(engine, source_id, kind, key=None, *, retry_of=None):
    scope = f"task:retry:{retry_of}" if retry_of else "task:create"
    payload = {"sourceId": source_id, "kind": kind, "retryOfTaskId": retry_of}
    with write_session(engine) as session:
        previous = lookup(session, scope, key, payload)
        if previous is not None:
            return previous
        source = session.get(Source, source_id)
        if source is None:
            raise AppError("SOURCE_NOT_FOUND", "录像源不存在。", 404)
        if retry_of:
            original = session.get(Task, retry_of)
            if original is None or original.source_id != source_id:
                raise AppError("TASK_NOT_FOUND", "原任务不存在。", 404)
            if original.status not in ("failed", "cancelled"):
                raise AppError("TASK_NOT_RETRYABLE", "只有失败或取消的任务可以重新提交。", 409)
        task, reused = enqueue(
            session,
            source,
            kind,
            "retry" if retry_of else "manual",
            retry_of=retry_of,
            reuse=retry_of is None,
        )
        response = {"taskId": task.id, "reused": reused}
        remember(session, scope, key, payload, response, task.id)
        if retry_of:
            emit(
                session,
                kind=kind,
                code="TASK_RETRIED",
                title="任务已重新提交",
                source_id=source_id,
                task_id=task.id,
                detail={"retryOfTaskId": retry_of},
            )
        return response


def release(session, task):
    if task.lease_token:
        session.execute(delete(RuntimeLease).where(RuntimeLease.token == task.lease_token))
    task.active_key = None
    task.lease_owner = task.lease_token = task.lease_until = None


def finish(session, task, status, *, result=None, code=None, message=None):
    token = task.lease_token
    task.status, task.result_json = status, result
    task.error_code, task.error_message = code, message
    task.finished_at = utc_now_ms()
    task.stage = status
    if status == "completed":
        task.progress = 100
    if token:
        attempt = session.scalar(
            select(TaskAttempt).where(
                TaskAttempt.task_id == task.id, TaskAttempt.lease_token == token
            )
        )
        if attempt:
            attempt.status, attempt.finished_at, attempt.error_code = status, utc_now_ms(), code
    release(session, task)
    emit(
        session,
        kind=task.kind,
        code=f"TASK_{status.upper()}",
        title={
            "completed": "后台任务完成",
            "failed": "后台任务失败",
            "cancelled": "后台任务已取消",
        }[status],
        source_id=task.source_id,
        task_id=task.id,
        detail={"status": status, "result": result, "errorCode": code, "message": message},
        level="error" if status == "failed" else "info",
    )


def cancel(engine, task_id):
    with write_session(engine) as session:
        task = session.get(Task, task_id)
        if task is None:
            raise AppError("TASK_NOT_FOUND", "任务不存在。", 404)
        if task.status == "cancelled":
            return task_dto(session, task)
        if task.status in ("completed", "failed"):
            raise AppError("TASK_TERMINAL", "任务已经结束，无法取消。", 409)
        if task.status == "queued":
            task.cancel_requested_at = utc_now_ms()
            finish(session, task, "cancelled")
        elif task.status != "cancelling":
            task.status = "cancelling"
            task.cancel_requested_at = utc_now_ms()
            emit(
                session,
                kind=task.kind,
                code="TASK_CANCELLING",
                title="正在停止后台任务",
                source_id=task.source_id,
                task_id=task.id,
                detail={"status": "cancelling"},
            )
        session.flush()
        return task_dto(session, task)


class Queue:
    def __init__(self, engine, config, owner):
        self.engine, self.config, self.owner = engine, config, owner

    def claim(self):
        with write_session(self.engine) as session:
            running = list(
                session.scalars(select(Task).where(Task.status.in_(("running", "cancelling"))))
            )
            if len(running) >= concurrency(session):
                return None
            tasks = session.scalars(
                select(Task)
                .where(
                    Task.status == "queued",
                    Task.available_at <= utc_now_ms(),
                    Task.kind.in_(HANDLERS),
                )
                .order_by(Task.created_at, Task.id)
            )
            for task in tasks:
                source = session.get(Source, task.source_id)
                if source is None or not source.enabled:
                    finish(
                        session,
                        task,
                        "cancelled",
                        code="SOURCE_DISABLED",
                        message="录像源已停用，维护任务未开始。",
                    )
                    continue
                resource = f"index:{source.id}"
                if session.get(RuntimeLease, resource):
                    continue
                token = str(uuid4())
                task.status, task.stage = "running", "discover"
                task.attempt_no += 1
                task.started_at = utc_now_ms()
                task.finished_at = None
                task.lease_owner, task.lease_token = self.owner, token
                task.lease_until = utc_now_ms() + int(self.config.worker_lease_seconds * 1000)
                session.add(
                    RuntimeLease(
                        resource_key=resource,
                        owner=self.owner,
                        token=token,
                        expires_at=task.lease_until,
                    )
                )
                session.add(
                    TaskAttempt(
                        task_id=task.id,
                        attempt_no=task.attempt_no,
                        lease_token=token,
                        status="running",
                    )
                )
                emit(
                    session,
                    kind=task.kind,
                    code="TASK_RUNNING",
                    title="后台任务开始处理",
                    source_id=source.id,
                    task_id=task.id,
                    detail={"status": "running", "attemptNo": task.attempt_no},
                )
                return Claim(
                    task.id,
                    source.id,
                    task.kind,
                    token,
                    self.owner,
                    task.attempt_no,
                    dict(task.payload_json),
                )
        return None

    def owned(self, session, claim, *, allow_cancel=False):
        task = session.get(Task, claim.task_id)
        resource = session.get(RuntimeLease, f"index:{claim.source_id}")
        if (
            task is None
            or task.lease_token != claim.token
            or task.lease_owner != claim.owner
            or task.status not in ("running", "cancelling")
            or task.lease_until is None
            or task.lease_until <= utc_now_ms()
            or resource is None
            or resource.token != claim.token
            or resource.owner != claim.owner
            or resource.expires_at <= utc_now_ms()
        ):
            raise LeaseLost()
        if not allow_cancel and task.cancel_requested_at is not None:
            raise Cancelled()
        return task

    def update(self, claim, stage, progress, checkpoint):
        with write_session(self.engine) as session:
            task = self.owned(session, claim)
            changed = task.stage != stage
            task.stage, task.progress = stage, max(0, min(99, progress))
            attempt = session.scalar(
                select(TaskAttempt).where(
                    TaskAttempt.task_id == task.id, TaskAttempt.lease_token == claim.token
                )
            )
            attempt.checkpoint_json = dict(checkpoint)
            if changed:
                emit(
                    session,
                    kind=task.kind,
                    code="TASK_STAGE",
                    title="后台任务进入新阶段",
                    source_id=task.source_id,
                    task_id=task.id,
                    detail={"stage": stage},
                )

    def renew(self):
        with write_session(self.engine) as session:
            for task in session.scalars(
                select(Task).where(
                    Task.lease_owner == self.owner, Task.status.in_(("running", "cancelling"))
                )
            ):
                if task.lease_until is None or task.lease_until <= utc_now_ms():
                    raise LeaseLost()
                task.lease_until = utc_now_ms() + int(self.config.worker_lease_seconds * 1000)
                for resource in session.scalars(
                    select(RuntimeLease).where(
                        RuntimeLease.token == task.lease_token, RuntimeLease.owner == self.owner
                    )
                ):
                    resource.expires_at = task.lease_until

    def acquire_media(self, claim):
        with write_session(self.engine) as session:
            task = self.owned(session, claim)
            for slot in range(self.config.max_concurrent_transcodes):
                key = f"media:{slot}"
                if session.get(RuntimeLease, key) is None:
                    session.add(
                        RuntimeLease(
                            resource_key=key,
                            owner=claim.owner,
                            token=claim.token,
                            expires_at=task.lease_until,
                        )
                    )
                    return key
        return None

    def release_media(self, claim, key):
        with write_session(self.engine) as session:
            session.execute(
                delete(RuntimeLease).where(
                    RuntimeLease.resource_key == key,
                    RuntimeLease.token == claim.token,
                    RuntimeLease.owner == claim.owner,
                )
            )

    def recover(self):
        # Called only while holding the exclusive worker.lock: the previous worker is dead.
        with write_session(self.engine) as session:
            for task in session.scalars(
                select(Task).where(Task.status.in_(("running", "cancelling")))
            ):
                if task.status == "cancelling" or task.cancel_requested_at is not None:
                    finish(session, task, "cancelled", code="CANCELLED_DURING_RESTART")
                    continue
                task.recovery_count += 1
                if task.recovery_count > self.config.max_task_recoveries:
                    finish(
                        session,
                        task,
                        "failed",
                        code="RECOVERY_LIMIT",
                        message="任务多次中断，请检查目录或设备后重新提交。",
                    )
                    continue
                self._requeue(session, task, "interrupted", "TASK_RECOVERED")
            active_tokens = set(
                session.scalars(
                    select(Task.lease_token).where(Task.status.in_(("running", "cancelling")))
                )
            )
            for lease in session.scalars(
                select(RuntimeLease).where(RuntimeLease.resource_key != "coordinator")
            ):
                if lease.token not in active_tokens:
                    session.delete(lease)

    def _requeue(self, session, task, attempt_status, event_code):
        attempt = session.scalar(
            select(TaskAttempt).where(
                TaskAttempt.task_id == task.id, TaskAttempt.lease_token == task.lease_token
            )
        )
        if attempt:
            attempt.status, attempt.finished_at = attempt_status, utc_now_ms()
        token = task.lease_token
        if token:
            session.execute(delete(RuntimeLease).where(RuntimeLease.token == token))
        task.status, task.stage, task.progress = "queued", "queued", 0
        task.lease_owner = task.lease_token = task.lease_until = None
        task.error_code = task.error_message = task.finished_at = None
        emit(
            session,
            kind=task.kind,
            code=event_code,
            title="中断任务已安全重新排队",
            source_id=task.source_id,
            task_id=task.id,
            detail={"status": "queued"},
            level="warning",
        )

    def settle(self, claim, *, result=None, error=None, shutdown=False, finalize=None):
        with write_session(self.engine) as session:
            task = self.owned(session, claim, allow_cancel=True)
            if task.cancel_requested_at is not None:
                finish(session, task, "cancelled")
            elif shutdown:
                self._requeue(session, task, "shutdown", "TASK_REQUEUED_ON_SHUTDOWN")
            elif error:
                finish(session, task, "failed", code=error.code, message=error.message)
            else:
                if finalize is not None:
                    finalize(session)
                source = session.get(Source, claim.source_id)
                source.last_scan_at = utc_now_ms()
                source.next_scan_at = (
                    utc_now_ms() + source.scan_interval_minutes * 60_000
                    if source.enabled and source.scan_interval_minutes is not None
                    else None
                )
                finish(session, task, "completed", result=result)

    def schedule(self):
        with write_session(self.engine) as session:
            sources = session.scalars(
                select(Source).where(
                    Source.enabled.is_(True),
                    Source.scan_interval_minutes.is_not(None),
                    Source.next_scan_at <= utc_now_ms(),
                )
            )
            for source in sources:
                enqueue(session, source, "scan", "scheduled")
                source.next_scan_at = utc_now_ms() + source.scan_interval_minutes * 60_000
