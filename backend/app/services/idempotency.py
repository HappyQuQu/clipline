import hashlib
import json

from app.core.errors import AppError
from app.db.models import TaskRequest


def request_hash(payload: dict) -> str:
    return hashlib.sha256(
        json.dumps(
            payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
        ).encode()
    ).hexdigest()


def lookup(session, scope, key, payload):
    if key is None:
        return None
    record = session.get(TaskRequest, (scope, key))
    if record is None:
        return None
    if record.request_hash != request_hash(payload):
        raise AppError("IDEMPOTENCY_CONFLICT", "同一个请求编号不能用于不同的操作参数。", 409)
    return record.response_json


def remember(session, scope, key, payload, response, task_id=None):
    if key is not None:
        session.add(
            TaskRequest(
                scope=scope,
                request_key=key,
                request_hash=request_hash(payload),
                response_json=response,
                task_id=task_id,
            )
        )
