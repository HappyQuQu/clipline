from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import delete, select
from test_exports import archive as archive

from app.api.operations import event_batch
from app.db.models import BusinessLog, Event, Source
from app.db.transactions import write_session
from app.services.events import emit
from app.services.maintenance import maintain
from app.tasks.queue import Queue, submit


def patch(client, group, values, revision=1):
    return client.patch(f"/api/settings/{group}", json={"revision": revision, "values": values})


def test_category_revision_isolation_validation_and_saved_defaults(client, config, database):
    before = client.get("/api/settings").json()
    response = patch(client, "scan", {"interval": None, "skipRecent": 120})
    assert response.json()["revision"] == 2
    after = client.get("/api/settings").json()
    assert after["groups"]["playback"] == before["groups"]["playback"]
    assert after["deployment"]["exportTtlHours"] == config.export_ttl_hours
    conflict = patch(client, "scan", {"interval": 10, "skipRecent": 60})
    assert conflict.status_code == 409
    assert conflict.json()["error"]["details"]["current"]["values"]["interval"] is None
    invalid = [
        ({"interval": "5", "skipRecent": 30}, "scan"),
        ({"interval": True, "skipRecent": 30}, "scan"),
        ({"interval": 20, "skipRecent": 30}, "scan"),
        ({"autoNext": 1, "skipGaps": False}, "playback"),
        ({"concurrency": 0}, "tasks"),
        ({"concurrency": 4}, "tasks"),
        ({"defaultMode": "accurate", "maxDuration": 30}, "export"),
        ({"defaultMode": "precise", "maxDuration": 20}, "export"),
        ({"concurrency": 2, "autoDetect": True}, "tasks"),
    ]
    for values, group in invalid:
        assert patch(client, group, values).status_code == 422
    assert patch(client, "recognition", {"enabled": True}).status_code == 409
    assert patch(client, "deployment", {"dataPath": "/wrong"}).status_code == 409
    assert (
        client.patch(
            "/api/settings/tasks", json={"revision": True, "values": {"concurrency": 1}}
        ).status_code
        == 422
    )
    source = client.post(
        "/api/sources",
        json={
            "name": "Manual",
            "path": str(config.recordings_root / "alpha"),
            "scanOnCreate": False,
        },
    ).json()["source"]
    assert source["scanIntervalMinutes"] is None
    old = submit(database, source["id"], "scan")["taskId"]
    assert patch(client, "scan", {"interval": 30, "skipRecent": 60}, 2).status_code == 200
    new_source = client.post(
        "/api/sources",
        json={
            "name": "Scheduled",
            "path": str(config.recordings_root / "beta"),
            "scanOnCreate": False,
        },
    ).json()["source"]
    assert new_source["scanIntervalMinutes"] == 30
    assert client.get("/api/sources").json()["items"][0]["scanIntervalMinutes"] is None
    newer = submit(database, new_source["id"], "scan")["taskId"]
    assert client.get(f"/api/tasks/{old}").json()["payload"]["skipRecentSeconds"] == 120
    assert client.get(f"/api/tasks/{newer}").json()["payload"]["skipRecentSeconds"] == 60
    assert patch(client, "tasks", {"concurrency": 1}).status_code == 200
    queue = Queue(database, config, "test")
    first = queue.claim()
    assert first and queue.claim() is None
    assert patch(client, "tasks", {"concurrency": 2}, 2).status_code == 200
    second = queue.claim()
    assert second and first.task_id != second.task_id
    assert patch(client, "tasks", {"concurrency": 1}, 3).status_code == 200
    assert client.get("/api/tasks/" + first.task_id).json()["status"] == "running"


def test_export_default_and_span_are_applied_on_server(client, database, archive):
    assert patch(client, "export", {"defaultMode": "precise", "maxDuration": 10}).status_code == 200
    start = datetime.fromisoformat(archive[1][0]["startAt"])
    body = {
        "sourceId": archive[0]["id"],
        "startAt": start.isoformat(),
        "endAt": (start + timedelta(seconds=1)).isoformat(),
    }
    plan = client.post("/api/exports/plan", json=body).json()
    assert plan["mode"] == "precise"
    assert (
        client.post(
            "/api/exports/plan", json=body | {"endAt": (start + timedelta(minutes=11)).isoformat()}
        ).json()["error"]["code"]
        == "EXPORT_RANGE_TOO_LARGE"
    )
    assert client.post("/api/exports/plan", json=body | {"mode": "fast"}).json()["mode"] == "fast"


def seed_logs(database, count=125):
    with write_session(database) as session:
        source = Source(name="测试源", canonical_path=f"/example-{uuid4()}")
        session.add(source)
        session.flush()
        for index in range(count):
            emit(
                session,
                kind="scan",
                code="TEST",
                title=f"记录 {index}",
                source_id=source.id,
                level="warning" if index % 2 else "info",
                detail={
                    "message": f"文件 中文 {index}",
                    "password": "private",
                    "apiKey": "private",
                    "nested": {"token": "private"},
                },
            )
        return source.id


def test_server_filters_stable_snapshot_full_export_and_diagnostics(client, database):
    source = seed_logs(database)
    response = client.get(
        "/api/logs", params={"sourceId": source, "kind": "scan", "limit": 10}
    ).json()
    assert len(response["items"]) == 10 and response["summary"]["total"] == 125
    snapshot = response["snapshot"]
    seed_logs(database, 1)
    collected = list(response["items"])
    cursor = response["nextCursor"]
    while cursor:
        page = client.get(
            "/api/logs", params={"sourceId": source, "kind": "scan", "limit": 10, "cursor": cursor}
        ).json()
        collected += page["items"]
        cursor = page["nextCursor"]
    assert len(collected) == 125 and len({row["id"] for row in collected}) == 125
    exported = client.get(
        "/api/logs/export", params={"sourceId": source, "kind": "scan", "snapshot": snapshot}
    )
    data = exported.json()
    assert len(data["items"]) == 125 and data["total"] == 125
    assert (
        "password" not in exported.text
        and "apiKey" not in exported.text
        and "private" not in exported.text
    )
    assert client.head("/api/logs/export", params={"snapshot": snapshot}).status_code == 200
    assert (
        client.get("/api/logs", params={"level": "warning", "sourceId": source}).json()["summary"][
            "total"
        ]
        == 62
    )
    assert client.get("/api/logs", params={"q": "中文 124"}).json()["summary"]["total"] == 1
    assert client.get("/api/logs", params={"q": "测试源"}).json()["summary"]["total"] == 126
    assert client.get("/api/logs", params={"q": "%"}).json()["summary"]["total"] == 0
    assert client.get("/api/logs", params={"kind": "invalid"}).status_code == 422
    assert (
        client.get(
            "/api/logs", params={"cursor": response["nextCursor"], "q": "different"}
        ).status_code
        == 422
    )
    detail = client.get("/api/logs/" + data["items"][0]["id"]).json()
    assert isinstance(detail["detail"], dict)
    assert client.get("/api/logs/not-found").status_code == 404
    assert client.get("/api/logs/export", params={"snapshot": 999999}).status_code == 410
    diagnostic = client.get("/api/system/diagnostics", params={"sourceId": source}).json()
    assert diagnostic["system"]["arch"] and "schema" in diagnostic["system"]
    assert len(diagnostic["items"]) == 125 and diagnostic["tasks"] == []
    assert set(diagnostic["settings"]) == {"general", "scan", "playback", "export", "tasks"}


def test_event_replay_expired_cursor_reset_and_log_retention(client, config, database):
    seed_logs(database, 125)
    mode, latest, rows = event_batch(database, None)
    assert mode == "ready" and latest == 125 and rows == []
    assert len(event_batch(database, 0)[2]) == 100
    with write_session(database) as session:
        for row in session.scalars(select(BusinessLog).where(BusinessLog.sequence <= 10)):
            row.created_at = 1
        for row in session.scalars(select(Event).where(Event.id <= 10)):
            row.created_at = 1
    summary = maintain(database, config)
    assert summary["logsPruned"] == 10 and summary["eventsPruned"] == 10
    assert event_batch(database, 0)[0] == "reset"
    assert event_batch(database, 999999)[0] == "reset"
    assert event_batch(database, 10)[0] == "events"
    with write_session(database) as session:
        session.execute(delete(Event))
    assert event_batch(database, latest)[0] == "reset"
    assert client.get("/api/system/status").json()["maintenance"]["lastRunAt"]
    assert set(client.get("/api/settings").json()["groups"]) == {
        "general",
        "scan",
        "playback",
        "export",
        "tasks",
    }


def test_concurrent_settings_saves_have_one_winner(client):
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(lambda value: patch(client, "tasks", {"concurrency": value}), [1, 3])
        )
    assert sorted(response.status_code for response in results) == [200, 409]
    assert client.get("/api/settings").json()["groups"]["tasks"]["revision"] == 2
