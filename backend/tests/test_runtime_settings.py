import threading
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from test_exports import archive as archive
from test_maintenance import artifact

from app.bootstrap import bootstrap
from app.core.time import utc_now_ms
from app.db.models import BusinessLog, SavedSettings, Source
from app.db.transactions import write_session
from app.main import create_app
from app.services.maintenance import maintain
from app.services.settings import effective_config
from app.tasks.context import TaskContext
from app.tasks.queue import Queue, submit
from app.worker import execute


def patch(client, group, values):
    revision = client.get("/api/settings").json()["groups"][group]["revision"]
    response = client.patch(f"/api/settings/{group}", json={"revision": revision, "values": values})
    assert response.status_code == 200, response.text
    return response.json()


def test_all_runtime_fields_persist_override_environment_and_survive_restart(database, config):
    patches = {
        "general": {
            "timezone": "Asia/Tokyo",
            "logRetentionDays": 7,
            "playbackCacheMaxBytes": 1024**3,
        },
        "playback": {"playbackMaxWidth": 1280},
        "export": {"exportMaxWidth": 1920, "exportTtlHours": 48},
        "tasks": {"mediaThreads": 1, "maxConcurrentTranscodes": 2},
    }
    with TestClient(create_app(config)) as client:
        for group, values in patches.items():
            patch(client, group, values)
    with Session(database) as session:
        settings = effective_config(session, config)
    assert settings.timezone == "Asia/Tokyo" and settings.media_threads == 1
    assert settings.max_concurrent_transcodes == 2 and settings.playback_max_width == 1280
    assert settings.export_max_width == 1920 and settings.export_ttl_hours == 48
    assert settings.log_retention_days == 7 and settings.playback_cache_max_bytes == 1024**3
    changed_env = config.model_copy(update={"timezone": "UTC", "export_ttl_hours": 1})
    bootstrap(changed_env, check_media=False)
    with TestClient(create_app(changed_env)) as restarted:
        groups = restarted.get("/api/settings").json()["groups"]
        for group, values in patches.items():
            assert all(groups[group]["values"][key] == value for key, value in values.items())
    assert config.timezone == "Asia/Shanghai" and config.export_ttl_hours == 24


def test_legacy_defaults_and_partial_saves_preserve_other_fields(config, database):
    with TestClient(create_app(config)) as client:
        config.media_threads = 1
        assert client.get("/api/settings").json()["groups"]["tasks"]["values"]["mediaThreads"] == 1
        patch(client, "tasks", {"mediaThreads": 3})
        patch(client, "tasks", {"concurrency": 1})
        assert client.get("/api/settings").json()["groups"]["tasks"]["values"] == {
            "concurrency": 1,
            "mediaThreads": 3,
            "maxConcurrentTranscodes": 1,
        }
    with write_session(database) as session:
        session.delete(session.get(SavedSettings, "general"))
    bootstrap(config, check_media=False)
    with TestClient(create_app(config)) as client:
        assert (
            client.get("/api/settings").json()["groups"]["general"]["values"]["timezone"]
            == config.timezone
        )


@pytest.mark.parametrize(
    ("group", "values"),
    [
        ("general", {"timezone": "invalid/timezone"}),
        ("general", {"timezone": "../etc/passwd"}),
        ("general", {"logRetentionDays": 0}),
        ("general", {"playbackCacheMaxBytes": -1}),
        ("tasks", {"mediaThreads": True}),
        ("tasks", {"mediaThreads": 17}),
        ("tasks", {"maxConcurrentTranscodes": 0}),
        ("playback", {"playbackMaxWidth": 1921}),
        ("playback", {"playbackMaxWidth": 641}),
        ("export", {"exportMaxWidth": 100}),
        ("export", {"exportTtlHours": 0}),
        ("general", {"dataPath": "/recordings"}),
    ],
)
def test_invalid_values_cannot_change_settings(client, group, values):
    before = client.get("/api/settings").json()["groups"][group]
    result = client.patch(
        f"/api/settings/{group}", json={"revision": before["revision"], "values": values}
    )
    assert result.status_code == 422
    assert client.get("/api/settings").json()["groups"][group] == before


def test_timezone_changes_display_and_new_sources_without_reinterpreting_existing(
    client, database, config
):
    old = client.post(
        "/api/sources",
        json={"name": "Old", "path": str(config.recordings_root / "alpha"), "scanOnCreate": False},
    ).json()["source"]
    patch(client, "general", {"timezone": "UTC"})
    new = client.post(
        "/api/sources",
        json={"name": "New", "path": str(config.recordings_root / "beta"), "scanOnCreate": False},
    ).json()["source"]
    with Session(database) as session:
        assert session.get(Source, old["id"]).recording_timezone == "Asia/Shanghai"
        assert session.get(Source, new["id"]).recording_timezone == "UTC"
    assert client.get("/api/settings").json()["deployment"]["timezone"] == "UTC"


def test_worker_snapshots_threads_but_media_admission_uses_latest_limit(client, database, config):
    ids = []
    for name in ("alpha", "beta", "gamma"):
        source = client.post(
            "/api/sources",
            json={"name": name, "path": str(config.recordings_root / name), "scanOnCreate": False},
        ).json()["source"]
        ids.append(submit(database, source["id"], "scan")["taskId"])
    patch(client, "tasks", {"concurrency": 3, "mediaThreads": 1, "maxConcurrentTranscodes": 3})
    queue = Queue(database, config, "runtime-test")
    claims = [queue.claim() for _ in ids]
    first = TaskContext(queue, claims[0], threading.Event())
    slots = [queue.acquire_media(claim) for claim in claims]
    assert all(slots) and first.config.media_threads == 1
    patch(client, "tasks", {"mediaThreads": 2, "maxConcurrentTranscodes": 1})
    assert first.config.media_threads == 1
    assert TaskContext(queue, claims[1], threading.Event()).config.media_threads == 2
    queue.release_media(claims[0], slots[0])
    assert queue.acquire_media(claims[0]) is None
    for claim, slot in zip(claims[1:], slots[1:], strict=True):
        queue.release_media(claim, slot)
    assert queue.acquire_media(claims[0]) is not None


def test_new_export_plan_and_playback_use_saved_width_and_keep_queued_profile(
    client, config, database, archive
):
    patch(client, "export", {"exportMaxWidth": 1280, "exportTtlHours": 2})
    row = archive[1][0]
    start = datetime.fromisoformat(row["startAt"])
    body = {
        "sourceId": archive[0]["id"],
        "startAt": start.isoformat(),
        "endAt": (start + timedelta(seconds=1)).isoformat(),
    }
    plan = client.post("/api/exports/plan", json=body).json()
    exported = client.post("/api/exports", json=body | {"planHash": plan["planHash"]}).json()
    payload = client.get(f"/api/tasks/{exported['taskId']}").json()["payload"]
    assert payload["profile"]["maxWidth"] == 1280
    patch(client, "export", {"exportMaxWidth": 1920})
    queue = Queue(database, config, "export-settings-test")
    claim = queue.claim()
    execute(queue, claim, threading.Event())
    completed = client.get(f"/api/tasks/{exported['taskId']}").json()
    assert completed["status"] == "completed", completed
    expires = datetime.fromisoformat(completed["result"]["expiresAt"]).timestamp() * 1000
    assert abs(expires - utc_now_ms() - 2 * 3600_000) < 5000
    assert client.get(f"/api/exports/{exported['taskId']}/download").status_code == 200
    patch(client, "export", {"exportTtlHours": 1})
    assert (
        client.get(f"/api/tasks/{exported['taskId']}").json()["result"]["expiresAt"]
        == completed["result"]["expiresAt"]
    )
    patch(client, "playback", {"playbackMaxWidth": 640})
    submitted = client.post(f"/api/segments/{row['id']}/prepare", json={"force": True}).json()
    queue = Queue(database, config, "profile-test")
    # archive indexing already completed; only the prepare should be queued.
    claim = queue.claim()
    assert claim.task_id == submitted["taskId"] and claim.payload["playbackMaxWidth"] == 640
    patch(client, "playback", {"playbackMaxWidth": 1280})
    context = TaskContext(queue, claim, threading.Event())
    assert context.config.playback_max_width == 640
    with Session(database) as session:
        assert effective_config(session, config).playback_max_width == 1280


def test_cleanup_uses_saved_capacity_and_retention_and_preserves_recordings(
    client, config, database
):
    original = config.recordings_root / "alpha" / "keep.mp4"
    original.write_bytes(b"original")
    _, proxy, _ = artifact(database, config, kind="playback", size=100)
    with write_session(database) as session:
        session.add(
            BusinessLog(
                kind="system",
                level="info",
                event_code="OLD_LOG",
                title="old",
                created_at=utc_now_ms() - 2 * 86400_000,
            )
        )
    patch(client, "general", {"playbackCacheMaxBytes": 0, "logRetentionDays": 1})
    result = maintain(database, config)
    assert result["evictedPlayback"] == 1 and result["logsPruned"] == 1
    assert not proxy.exists() and original.read_bytes() == b"original"
