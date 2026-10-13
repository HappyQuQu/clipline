import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.time import utc_now_ms
from app.db.models import (
    BusinessLog,
    RuntimeLease,
    SavedSettings,
    Segment,
    Source,
    Task,
    TaskAttempt,
    TaskRequest,
)
from app.db.transactions import write_session
from app.services import media, scanner
from app.services.recording_time import infer_start
from app.tasks.context import TaskContext
from app.tasks.queue import Cancelled, Interrupted, LeaseLost, Queue, cancel
from app.worker import execute


def add_source(client, config, folder="alpha", scan=False, key=None):
    body = {
        "name": folder,
        "path": str(config.recordings_root / folder),
        "scanIntervalMinutes": None,
        "scanOnCreate": scan,
    }
    response = client.post(
        "/api/sources", json=body, headers={"Idempotency-Key": key} if key else {}
    )
    assert response.status_code == 201, response.text
    return response.json()


def submit_task(client, source_id, kind="scan", key=None):
    response = client.post(
        "/api/tasks",
        json={"kind": kind, "sourceId": source_id},
        headers={"Idempotency-Key": key} if key else {},
    )
    assert response.status_code == 202, response.text
    return response.json()["taskId"]


def run_task(config, database):
    queue = Queue(database, config, "test-worker")
    claim = queue.claim()
    assert claim is not None
    execute(queue, claim, threading.Event())
    return claim


def test_source_creation_and_first_task_are_atomic_and_idempotent(client, config, database):
    response = add_source(client, config, scan=True, key="source-create")
    duplicate = add_source(client, config, scan=True, key="source-create")
    assert duplicate == response
    assert response["firstTaskId"]
    assert response["source"]["segmentCount"] == 0
    with Session(database) as session:
        assert session.scalar(select(func.count()).select_from(Source)) == 1
        assert session.scalar(select(func.count()).select_from(Task)) == 1
        assert session.scalar(select(func.count()).select_from(TaskRequest)) == 1
    (config.recordings_root / "alpha").rename(config.recordings_root / "offline")
    assert add_source(client, config, scan=True, key="source-create") == response


def test_create_without_scan_default_interval_and_duplicate_alias(client, config, database):
    result = client.post(
        "/api/sources",
        json={
            "name": "Camera",
            "path": str(config.recordings_root / "alpha"),
            "scanOnCreate": False,
        },
    ).json()
    assert result["firstTaskId"] is None
    assert result["source"]["scanIntervalMinutes"] == 5
    alias = config.recordings_root / "alias"
    alias.symlink_to(config.recordings_root / "alpha", target_is_directory=True)
    duplicate = client.post("/api/sources", json={"name": "Other", "path": str(alias)})
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "SOURCE_DUPLICATE"
    assert client.get("/api/sources").json()["items"][0]["id"] == result["source"]["id"]


@pytest.mark.parametrize(
    "patch",
    [
        {"enabled": "false"},
        {"enabled": None},
        {"name": " "},
        {"autoDetect": True},
        {"autoTranscribe": True},
    ],
)
def test_source_validation_rejects_invalid_or_phase_two_fields(client, config, patch):
    source = add_source(client, config)["source"]
    assert client.patch(f"/api/sources/{source['id']}", json=patch).status_code == 422


def test_source_revision_and_noop_do_not_create_false_configuration_events(
    client, config, database
):
    source = add_source(client, config)["source"]
    changed = client.patch(f"/api/sources/{source['id']}", json={"name": "Changed", "revision": 1})
    assert changed.status_code == 200
    assert changed.json()["revision"] == 2
    assert (
        client.patch(
            f"/api/sources/{source['id']}", json={"name": "Stale", "revision": 1}
        ).status_code
        == 409
    )
    assert (
        client.patch(
            f"/api/sources/{source['id']}", json={"name": "Changed", "revision": 2}
        ).json()["revision"]
        == 2
    )
    with Session(database) as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(BusinessLog)
                .where(BusinessLog.event_code == "SOURCE_UPDATED")
            )
            == 1
        )


def test_source_disable_cancels_queued_but_preserves_running(client, config, database):
    source = add_source(client, config)["source"]
    queued = submit_task(client, source["id"])
    client.patch(f"/api/sources/{source['id']}", json={"enabled": False})
    assert client.get(f"/api/tasks/{queued}").json()["status"] == "cancelled"
    assert client.post(f"/api/sources/{source['id']}/scan").status_code == 409
    client.patch(f"/api/sources/{source['id']}", json={"enabled": True})
    running = submit_task(client, source["id"])
    queue = Queue(database, config, "worker")
    claim = queue.claim()
    client.patch(f"/api/sources/{source['id']}", json={"enabled": False})
    assert client.get(f"/api/tasks/{running}").json()["status"] == "running"
    queue.settle(claim, result={"processed": 0})
    assert client.get(f"/api/tasks/{running}").json()["status"] == "completed"
    assert client.get("/api/sources").json()["items"][0]["nextScanAt"] is None


def test_active_request_alias_is_remembered_after_completion(client, config, database):
    source = add_source(client, config)["source"]
    first = submit_task(client, source["id"], key="one")
    assert submit_task(client, source["id"], key="two") == first
    queue = Queue(database, config, "owner")
    queue.settle(queue.claim(), result={})
    assert submit_task(client, source["id"], key="two") == first
    mismatch = client.post(
        "/api/tasks",
        json={"sourceId": source["id"], "kind": "reindex"},
        headers={"Idempotency-Key": "two"},
    )
    assert mismatch.status_code == 409
    with Session(database) as session:
        assert session.scalar(select(func.count()).select_from(Task)) == 1


def test_index_mutex_and_global_concurrency_under_simultaneous_claims(client, config, database):
    one = add_source(client, config)["source"]["id"]
    two = add_source(client, config, "beta")["source"]["id"]
    submit_task(client, one)
    submit_task(client, one, "reindex")
    submit_task(client, two)
    with ThreadPoolExecutor(max_workers=3) as pool:
        claims = list(
            pool.map(lambda owner: Queue(database, config, owner).claim(), ["a", "b", "c"])
        )
    actual = [claim for claim in claims if claim]
    assert len(actual) == 2
    assert {claim.source_id for claim in actual} == {one, two}
    with Session(database) as session:
        assert (
            session.scalar(select(func.count()).select_from(Task).where(Task.status == "queued"))
            == 1
        )


def test_cancel_retry_and_terminal_guards_keep_attempt_history(client, config, database):
    source = add_source(client, config)["source"]
    task = submit_task(client, source["id"])
    queue = Queue(database, config, "owner")
    claim = queue.claim()
    assert client.post(f"/api/tasks/{task}/cancel").json()["status"] == "cancelling"
    with pytest.raises(Cancelled):
        TaskContext(queue, claim, threading.Event()).check()
    queue.settle(claim)
    assert client.post(f"/api/tasks/{task}/cancel").json()["status"] == "cancelled"
    retry = client.post(f"/api/tasks/{task}/retry", headers={"Idempotency-Key": "retry"}).json()[
        "taskId"
    ]
    assert retry != task
    assert client.get(f"/api/tasks/{retry}").json()["retryOfTaskId"] == task
    queue.settle(queue.claim(), result={})
    assert client.post(f"/api/tasks/{retry}/cancel").status_code == 409
    old = client.get(f"/api/tasks/{task}").json()
    assert old["attempts"][0]["status"] == "cancelled"
    logs = client.get("/api/logs", params={"taskId": task}).json()["items"]
    assert {row["eventCode"] for row in logs} >= {
        "TASK_QUEUED",
        "TASK_RUNNING",
        "TASK_CANCELLING",
        "TASK_CANCELLED",
    }


def test_restart_recovery_fences_old_claim_and_cancel_is_not_reexecuted(client, config, database):
    source = add_source(client, config)["source"]
    task = submit_task(client, source["id"])
    old = Queue(database, config, "old")
    claim = old.claim()
    new = Queue(database, config, "new")
    new.recover()
    with pytest.raises(LeaseLost):
        old.settle(claim, result={})
    recovered = new.claim()
    assert (
        recovered.task_id == task and recovered.attempt_no == 2 and recovered.token != claim.token
    )
    cancel(database, task)
    new.recover()
    assert client.get(f"/api/tasks/{task}").json()["status"] == "cancelled"
    assert new.claim() is None
    with Session(database) as session:
        assert session.scalar(select(func.count()).select_from(RuntimeLease)) == 0
        assert len(list(session.scalars(select(TaskAttempt)))) == 2


def test_graceful_shutdown_requeues_without_spending_fault_budget(client, config, database):
    source = add_source(client, config)["source"]
    task = submit_task(client, source["id"])
    queue = Queue(database, config, "owner")
    claim = queue.claim()
    queue.settle(claim, shutdown=True)
    result = client.get(f"/api/tasks/{task}").json()
    assert result["status"] == "queued" and result["recoveryCount"] == 0
    assert result["attempts"][0]["status"] == "shutdown"


def test_recovery_budget_eventually_fails_instead_of_looping(client, config, database):
    source = add_source(client, config)["source"]
    task = submit_task(client, source["id"])
    queue = Queue(database, config, "owner")
    for _ in range(config.max_task_recoveries + 1):
        assert queue.claim()
        queue.recover()
    result = client.get(f"/api/tasks/{task}").json()
    assert result["status"] == "failed" and result["errorCode"] == "RECOVERY_LIMIT"
    assert queue.claim() is None


def test_expired_lease_is_not_revived(client, config, database):
    source = add_source(client, config)["source"]
    task = submit_task(client, source["id"])
    queue = Queue(database, config, "owner")
    claim = queue.claim()
    with write_session(database) as session:
        session.get(Task, task).lease_until = utc_now_ms() - 1
    with pytest.raises(LeaseLost):
        queue.renew()
    with pytest.raises(LeaseLost):
        queue.settle(claim, result={})


def test_media_budget_is_persistent_cancelable_and_release_is_fenced(client, config, database):
    first_source = add_source(client, config)["source"]["id"]
    second_source = add_source(client, config, "beta")["source"]["id"]
    submit_task(client, first_source)
    submit_task(client, second_source)
    queue = Queue(database, config, "owner")
    one, two = queue.claim(), queue.claim()
    key = queue.acquire_media(one)
    assert key == "media:0" and queue.acquire_media(two) is None
    with Session(database) as session:
        assert session.get(RuntimeLease, key).token == one.token
    cancel(database, two.task_id)
    with pytest.raises(Cancelled):
        with TaskContext(queue, two, threading.Event()).media_slot():
            pytest.fail("Cancelled task acquired media budget")
    with write_session(database) as session:
        session.get(RuntimeLease, key).token = "new-token"
    queue.release_media(one, key)
    with Session(database) as session:
        assert session.get(RuntimeLease, key).token == "new-token"


def test_reindex_recovery_reuses_completed_files_in_same_logical_task(
    client, config, database, put_video, monkeypatch
):
    path = put_video(config.recordings_root / "alpha")
    source = add_source(client, config, scan=True)["source"]
    run_task(config, database)
    task_id = submit_task(client, source["id"], "reindex")
    old = Queue(database, config, "old")
    claim = old.claim()
    context = TaskContext(old, claim, threading.Event())
    stats = dict.fromkeys(
        (
            "discovered",
            "processed",
            "added",
            "updated",
            "unchanged",
            "pending",
            "failed",
            "thumbnails",
            "thumbnailFailed",
            "missing",
            "warnings",
        ),
        0,
    )
    scanner.scan_file(path, path.parent, context, stats)
    new = Queue(database, config, "new")
    new.recover()
    monkeypatch.setattr(
        media, "probe", lambda *_: pytest.fail("Completed file was unnecessarily reprobed")
    )
    recovered = new.claim()
    execute(new, recovered, threading.Event())
    task = client.get(f"/api/tasks/{task_id}").json()
    assert task["status"] == "completed" and task["result"]["unchanged"] == 1


def test_scheduler_deduplicates_missed_intervals_and_manual_is_ignored(client, config, database):
    source = add_source(client, config)["source"]
    client.patch(f"/api/sources/{source['id']}", json={"scanIntervalMinutes": 5})
    with write_session(database) as session:
        session.get(Source, source["id"]).next_scan_at = utc_now_ms() - 1_000_000
    queue = Queue(database, config, "owner")
    queue.schedule()
    queue.schedule()
    with Session(database) as session:
        rows = list(session.scalars(select(Task)))
        assert len(rows) == 1 and rows[0].payload_json["trigger"] == "scheduled"
    client.patch(f"/api/sources/{source['id']}", json={"scanIntervalMinutes": None})
    cancel(database, rows[0].id)
    queue.schedule()
    assert client.get("/api/tasks", params={"status": "active"}).json()["items"] == []


def test_source_path_is_locked_during_work_and_after_indexing(client, config, database, put_video):
    put_video(config.recordings_root / "alpha")
    source = add_source(client, config, scan=True)["source"]
    patch = {"path": str(config.recordings_root / "beta")}
    assert (
        client.patch(f"/api/sources/{source['id']}", json=patch).json()["error"]["code"]
        == "SOURCE_BUSY"
    )
    run_task(config, database)
    assert (
        client.patch(f"/api/sources/{source['id']}", json=patch).json()["error"]["code"]
        == "SOURCE_PATH_LOCKED"
    )


def test_real_probe_index_thumbnail_search_and_incremental_reuse(
    client, config, database, put_video
):
    path = put_video(config.recordings_root / "alpha")
    before = path.read_bytes()
    source = add_source(client, config, scan=True)
    first = source["firstTaskId"]
    run_task(config, database)
    result = client.get(f"/api/tasks/{first}").json()
    assert result["status"] == "completed", result
    assert result["result"]["added"] == 1 and result["result"]["thumbnails"] == 1
    rows = client.get(
        "/api/segments", params={"sourceId": source["source"]["id"], "date": "2026-10-13"}
    ).json()["items"]
    assert len(rows) == 1
    segment = rows[0]
    assert segment["startAt"] == "2026-10-13T01:15:00.000Z"
    assert segment["videoCodec"] == "h264" and segment["durationMs"] == 1000
    assert segment["playbackStatus"] == "direct"
    thumbnail = client.get(segment["thumbnailUrl"])
    assert thumbnail.status_code == 200 and thumbnail.content.startswith(b"\xff\xd8")
    assert len(client.get("/api/segments", params={"q": "09：15：00"}).json()["items"]) == 1
    assert len(client.get("/api/segments", params={"q": "20261013_091500"}).json()["items"]) == 1
    assert client.get("/api/segments", params={"viewTimezone": "../bad"}).status_code == 422
    second = submit_task(client, source["source"]["id"])
    run_task(config, database)
    assert client.get(f"/api/tasks/{second}").json()["result"]["unchanged"] == 1
    assert client.get("/api/segments").json()["items"][0]["id"] == segment["id"]
    assert path.read_bytes() == before


def test_reindex_preserves_ids_and_true_missing_does_not_delete_rows(
    client, config, database, put_video
):
    path = put_video(config.recordings_root / "alpha")
    source = add_source(client, config, scan=True)["source"]
    run_task(config, database)
    first = client.get("/api/segments").json()["items"][0]
    task = submit_task(client, source["id"], "reindex")
    run_task(config, database)
    second = client.get("/api/segments").json()["items"][0]
    assert second["id"] == first["id"] and second["indexRevision"] > first["indexRevision"]
    assert client.get(f"/api/tasks/{task}").json()["status"] == "completed"
    path.unlink()
    task = submit_task(client, source["id"])
    run_task(config, database)
    assert client.get(f"/api/tasks/{task}").json()["result"]["missing"] == 1
    row = client.get(f"/api/segments/{first['id']}").json()
    assert row["availability"] == "missing"
    assert client.get(first["thumbnailUrl"]).status_code == 404


def test_recent_and_corrupt_files_are_distinguished_without_failing_good_files(
    client, config, database, put_video
):
    put_video(config.recordings_root / "alpha")
    recent = put_video(config.recordings_root / "alpha", "20261013_091600.mp4")
    os.utime(recent, None)
    bad = config.recordings_root / "alpha" / "broken.mp4"
    bad.write_bytes(b"not a video")
    os.utime(bad, (1_700_000_000, 1_700_000_000))
    task = add_source(client, config, scan=True)["firstTaskId"]
    run_task(config, database)
    result = client.get(f"/api/tasks/{task}").json()
    assert result["status"] == "completed"
    assert result["result"]["added"] == 1 and result["result"]["pending"] == 1
    assert result["result"]["failed"] == 1
    rows = client.get("/api/segments").json()["items"]
    assert {row["availability"] for row in rows} == {"available", "pending", "invalid"}
    assert len(client.get("/api/logs", params={"taskId": task}).json()["items"]) > 3


def test_changed_during_probe_is_pending_and_old_thumbnail_is_invalidated(
    client, config, database, put_video, monkeypatch
):
    put_video(config.recordings_root / "alpha")
    source = add_source(client, config, scan=True)["source"]
    run_task(config, database)
    old = client.get("/api/segments").json()["items"][0]
    original = media.probe

    def changing(path, context):
        data = original(path, context)
        with path.open("ab") as stream:
            stream.write(b"changed")
        return data

    monkeypatch.setattr(media, "probe", changing)
    task = submit_task(client, source["id"], "reindex")
    run_task(config, database)
    assert client.get(f"/api/tasks/{task}").json()["result"]["pending"] == 1
    new = client.get(f"/api/segments/{old['id']}").json()
    assert new["availability"] == "pending" and new["startAt"] is None
    assert client.get(old["thumbnailUrl"]).status_code == 404


def test_offline_or_incomplete_directory_does_not_mark_old_files_missing(
    client, config, database, put_video, monkeypatch
):
    put_video(config.recordings_root / "alpha")
    source = add_source(client, config, scan=True)["source"]
    run_task(config, database)
    original = client.get("/api/segments").json()["items"][0]
    task = submit_task(client, source["id"])
    (config.recordings_root / "alpha").rename(config.recordings_root / "offline")
    run_task(config, database)
    assert client.get(f"/api/tasks/{task}").json()["status"] == "failed"
    assert client.get(f"/api/segments/{original['id']}").json()["availability"] == "available"
    (config.recordings_root / "offline").rename(config.recordings_root / "alpha")

    def partial(*args, **kwargs):
        raise AppError("SCAN_INCOMPLETE", "test partial traversal")

    monkeypatch.setattr(scanner, "collect", partial)
    task = submit_task(client, source["id"])
    run_task(config, database)
    assert client.get(f"/api/tasks/{task}").json()["status"] == "failed"
    assert client.get(f"/api/segments/{original['id']}").json()["availability"] == "available"


def test_cancel_before_completion_prevents_missing_finalization(
    client, config, database, put_video
):
    path = put_video(config.recordings_root / "alpha")
    source = add_source(client, config, scan=True)["source"]
    run_task(config, database)
    first = client.get("/api/segments").json()["items"][0]
    path.unlink()
    task = submit_task(client, source["id"])
    queue = Queue(database, config, "owner")
    claim = queue.claim()
    result, finalize = scanner.scan(TaskContext(queue, claim, threading.Event()))
    cancel(database, task)
    queue.settle(claim, result=result, finalize=finalize)
    assert client.get(f"/api/tasks/{task}").json()["status"] == "cancelled"
    assert client.get(f"/api/segments/{first['id']}").json()["availability"] == "available"


def test_media_timeout_and_shutdown_stop_the_actual_child_process(client, config, database):
    source = add_source(client, config)["source"]
    submit_task(client, source["id"])
    queue = Queue(database, config, "owner")
    claim = queue.claim()
    context = TaskContext(queue, claim, threading.Event())
    with pytest.raises(AppError) as error:
        media.run_process([sys.executable, "-c", "import time;time.sleep(30)"], context, 0.05)
    assert error.value.code == "MEDIA_TIMEOUT"
    context.stopped.set()
    with pytest.raises(Interrupted):
        media.run_process([sys.executable, "-c", "import time;time.sleep(30)"], context, 10)
    queue.settle(claim, shutdown=True)


def test_timezone_invalid_filename_and_directory_rules_are_explicit():
    stamp = int(datetime(2026, 10, 13, 2, tzinfo=UTC).timestamp() * 1_000_000_000)
    assert infer_start(Path("00_20261013091500_20261013091600.mp4"), stamp, 1000, "Asia/Shanghai")[
        0
    ] == (int(datetime(2026, 10, 13, 1, 15, tzinfo=UTC).timestamp() * 1000))
    assert (
        infer_start(Path("20260230091500_20260301091500.mp4"), stamp, 1000, "Asia/Shanghai")[1]
        == "mtime_minus_duration"
    )
    assert (
        infer_start(Path("2026/10/13/09/15/00/clip.mp4"), stamp, 1000, "Asia/Shanghai")[1]
        == "directory"
    )


def test_unsupported_tasks_are_rejected_and_cursor_cannot_cross_filters(client, config):
    source = add_source(client, config)["source"]
    for kind in ("prepare", "export", "transcription", "visual"):
        response = client.post("/api/tasks", json={"sourceId": source["id"], "kind": kind})
        assert response.status_code in (409, 422)
    one = submit_task(client, source["id"])
    client.post(f"/api/tasks/{one}/cancel")
    submit_task(client, source["id"])
    page = client.get("/api/tasks", params={"limit": 1}).json()
    assert page["nextCursor"]
    assert (
        client.get(
            "/api/tasks", params={"cursor": page["nextCursor"], "kind": "reindex"}
        ).status_code
        == 422
    )


def test_lower_concurrency_does_not_interrupt_existing_tasks(client, config, database):
    for folder in ("alpha", "beta", "gamma"):
        source = add_source(client, config, folder)["source"]
        submit_task(client, source["id"])
    queue = Queue(database, config, "owner")
    one, two = queue.claim(), queue.claim()
    with write_session(database) as session:
        session.get(SavedSettings, "tasks").value_json = {"concurrency": 1}
    assert queue.claim() is None
    queue.settle(one, result={})
    assert queue.claim() is None
    queue.settle(two, result={})
    assert queue.claim() is not None


def test_cross_day_catalog_and_text_clock_search(client, config, database):
    source = add_source(client, config)["source"]
    start = int(datetime(2026, 10, 13, 15, 59, 59, tzinfo=UTC).timestamp() * 1000)
    with write_session(database) as session:
        session.add(
            Segment(
                id="overnight",
                source_id=source["id"],
                relative_path="night.mp4",
                filename="night.mp4",
                size_bytes=100,
                mtime_ns=1,
                fingerprint="test",
                start_at=start,
                end_at=start + 2000,
                duration_ms=2000,
            )
        )
    for date in ("2026-10-13", "2026-10-14"):
        assert (
            client.get("/api/segments", params={"date": date}).json()["items"][0]["id"]
            == "overnight"
        )
    assert (
        client.get("/api/segments", params={"q": "23：59：59"}).json()["items"][0]["id"]
        == "overnight"
    )
    assert (
        client.get("/api/segments", params={"q": "00:00:01"}).json()["items"][0]["id"]
        == "overnight"
    )
    assert client.get("/api/segments", params={"date": "2026-10-12"}).json()["items"] == []


def test_log_pagination_is_complete_and_filter_scoped(client, config):
    source = add_source(client, config)["source"]
    task = submit_task(client, source["id"])
    client.post(f"/api/tasks/{task}/cancel")
    first = client.get("/api/logs", params={"limit": 1}).json()
    assert first["nextCursor"]
    assert (
        client.get("/api/logs", params={"cursor": first["nextCursor"], "taskId": task}).status_code
        == 422
    )
    rows = first["items"]
    cursor = first["nextCursor"]
    while cursor:
        page = client.get("/api/logs", params={"limit": 1, "cursor": cursor}).json()
        rows += page["items"]
        cursor = page["nextCursor"]
    assert len(rows) == 3 and len({row["id"] for row in rows}) == 3
