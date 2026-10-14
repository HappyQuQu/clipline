from app.db.models import BusinessLog, Event


def emit(session, *, kind, code, title, source_id=None, task_id=None, detail=None, level="info"):
    detail = detail or {}
    session.add(
        BusinessLog(
            level=level,
            kind=kind,
            source_id=source_id,
            task_id=task_id,
            event_code=code,
            title=title,
            detail_json=detail,
        )
    )
    session.add(
        Event(
            event_type=code,
            entity_id=task_id or source_id or "system",
            payload_json={"sourceId": source_id, "taskId": task_id, **detail},
        )
    )
