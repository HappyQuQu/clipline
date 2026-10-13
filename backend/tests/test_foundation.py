import hashlib
import shutil
import sqlite3
import sys
import threading
import time
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.bootstrap import backup_database, bootstrap
from app.core.config import AppConfig
from app.core.errors import AppError
from app.core.locks import ProcessLock
from app.core.time import iso_utc, utc_now_ms
from app.db.migrations import current_revision, expected_revision
from app.db.models import Base, Event, RuntimeLease, SavedSettings, Source, Task
from app.main import create_app
from app.services.directories import RecordingDirectories
from app.worker import heartbeat
from app.worker import run as run_worker


def test_bootstrap_creates_versioned_schema_and_preserves_settings(config, database):
    assert set(inspect(database).get_table_names()) == set(Base.metadata.tables) | {
        "alembic_version"
    }
    assert current_revision(database) == expected_revision()
    with database.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert connection.exec_driver_sql("PRAGMA synchronous").scalar() == 2
    with Session(database) as session, session.begin():
        settings = session.get(SavedSettings, "tasks")
        settings.value_json = {"concurrency": 1}
    bootstrap(config, check_media=False)
    with Session(database) as session:
        assert session.get(SavedSettings, "tasks").value_json == {"concurrency": 1}
    assert not (config.data / "models").exists()


def test_foreign_keys_duplicate_paths_and_task_constraints(database):
    with Session(database) as session:
        session.add(Task(kind="scan", source_id="unknown-source"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        session.add_all(
            [
                Source(name="One", canonical_path="/recordings/one"),
                Source(name="Two", canonical_path="/recordings/one"),
            ]
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        session.add(Task(kind="transcription"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        session.add(Task(kind="scan", progress=101))
        with pytest.raises(IntegrityError):
            session.commit()


def test_legacy_database_is_rejected_without_modification(config):
    config.data.mkdir()
    with sqlite3.connect(config.db) as connection:
        connection.execute("CREATE TABLE legacy (value TEXT)")
        connection.execute("INSERT INTO legacy VALUES ('keep')")
    before = hashlib.sha256(config.db.read_bytes()).hexdigest()
    with pytest.raises(RuntimeError, match="Unversioned database"):
        bootstrap(config, check_media=False)
    assert hashlib.sha256(config.db.read_bytes()).hexdigest() == before


def test_backup_contains_committed_wal_data(config, database):
    with Session(database) as session, session.begin():
        session.add(Source(name="Backup", canonical_path="/recordings/backup"))
    backup = backup_database(config)
    with sqlite3.connect(backup) as connection:
        assert connection.execute("SELECT name FROM sources").fetchone()[0] == "Backup"
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def test_failed_upgrade_preserves_database_and_creates_backup(
    config, database, tmp_path, monkeypatch
):
    base_revision = current_revision(database)
    scripts = tmp_path / "migrations"
    shutil.copytree(Path(__file__).resolve().parents[1] / "migrations", scripts)
    (scripts / "versions" / "next_failure.py").write_text(
        "revision = 'next_failure'\n"
        f"down_revision = {base_revision!r}\n"
        "def upgrade():\n    raise RuntimeError('deliberate migration failure')\n"
        "def downgrade():\n    pass\n"
    )
    migration = Config()
    migration.set_main_option("script_location", str(scripts))
    monkeypatch.setattr("app.bootstrap.alembic_config", lambda: migration)
    monkeypatch.setattr(
        "app.bootstrap.expected_revision",
        lambda: ScriptDirectory.from_config(migration).get_current_head(),
    )
    with pytest.raises(RuntimeError, match="deliberate migration failure"):
        bootstrap(config, check_media=False)
    assert current_revision(database) == base_revision
    backups = list((config.data / "backups").glob("*.sqlite3"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as connection:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone()[0] == (
            base_revision
        )
        assert connection.execute("SELECT COUNT(*) FROM settings").fetchone()[0] == 4


def test_event_ids_are_not_reused_after_retention_cleanup(database):
    with Session(database) as session:
        first = Event(event_type="test", entity_id="one")
        session.add(first)
        session.commit()
        previous_id = first.id
        session.delete(first)
        session.commit()
        second = Event(event_type="test", entity_id="two")
        session.add(second)
        session.commit()
        assert second.id > previous_id


@pytest.mark.parametrize(
    "override",
    [
        {"recordings_root": "/"},
        {"db": "/outside/clipline.db"},
        {"timezone": "not/a-timezone"},
        {"heartbeat_interval_seconds": 5, "worker_lease_seconds": 10},
    ],
)
def test_invalid_configuration_rejected(config, override):
    values = config.model_dump() | override
    with pytest.raises(ValidationError):
        AppConfig(**values)


def test_data_and_recordings_must_be_separate(config):
    with pytest.raises(ValidationError):
        AppConfig(data=config.recordings_root / "data", recordings_root=config.recordings_root)


def test_process_lock_excludes_second_coordinator_and_can_be_reacquired(config):
    config.data.mkdir()
    path = config.data / "worker.lock"
    with ProcessLock(path), pytest.raises(RuntimeError, match="Another process"):
        with ProcessLock(path):
            pytest.fail("Second coordinator acquired exclusive lock")
    with ProcessLock(path):
        assert path.exists()


def test_bootstrap_cannot_run_while_worker_owns_lock(config, database):
    with ProcessLock(config.data / "worker.lock"):
        with pytest.raises(RuntimeError, match="Another process"):
            bootstrap(config, check_media=False)
    assert current_revision(database) == expected_revision()


def test_worker_heartbeat_and_shutdown_release_lease(config, database):
    stopped = threading.Event()
    thread = threading.Thread(target=run_worker, args=(config, stopped))
    thread.start()
    try:
        deadline = time.monotonic() + 3
        found = False
        while time.monotonic() < deadline:
            with Session(database) as session:
                found = session.get(RuntimeLease, "coordinator") is not None
            if found:
                break
            stopped.wait(0.01)
        assert found
        with ProcessLock(config.data / "bootstrap.lock"):
            with pytest.raises(RuntimeError, match="Another process"):
                with ProcessLock(config.data / "worker.lock"):
                    pytest.fail("Worker lock was not held")
    finally:
        stopped.set()
        thread.join(timeout=3)
    assert not thread.is_alive()
    with Session(database) as session:
        assert session.get(RuntimeLease, "coordinator") is None


def test_api_does_not_auto_migrate(config):
    config.data.mkdir()
    with pytest.raises(RuntimeError, match="schema is not current"):
        with TestClient(create_app(config)):
            pytest.fail("Unmigrated API should not start")


def test_directory_pagination_and_cursor_scope(config, client):
    response = client.get("/api/recording-directories", params={"limit": 1})
    assert response.status_code == 200
    first = response.json()
    assert first["items"][0]["name"] == "alpha"
    next_page = client.get(
        "/api/recording-directories",
        params={
            "limit": 1,
            "cursor": first["nextCursor"],
        },
    ).json()
    assert next_page["items"][0]["name"] == "beta"
    wrong_scope = client.get(
        "/api/recording-directories",
        params={
            "relativePath": "alpha",
            "cursor": first["nextCursor"],
        },
    )
    assert wrong_scope.status_code == 422
    assert wrong_scope.json()["error"]["code"] == "INVALID_CURSOR"
    assert len(client.get("/api/recording-directories").json()["items"]) == 3


@pytest.mark.parametrize("path", ["..", "alpha/../../", "/", "alpha\\beta", "\x00"])
def test_directory_traversal_and_invalid_paths_rejected(client, path):
    response = client.get("/api/recording-directories", params={"relativePath": path})
    assert response.status_code == 422


def test_symlinks_cannot_escape_root(config, client, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (config.recordings_root / "escape").symlink_to(outside, target_is_directory=True)
    response = client.get("/api/recording-directories", params={"relativePath": "escape"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "SOURCE_PATH_OUTSIDE_ROOT"
    assert "escape" not in [
        item["name"] for item in client.get("/api/recording-directories").json()["items"]
    ]


def test_directory_read_permission_checked(config, monkeypatch):
    monkeypatch.setattr("app.services.directories.os.access", lambda *_: False)
    with pytest.raises(AppError) as error:
        RecordingDirectories(config.recordings_root).resolve("alpha", relative=True)
    assert error.value.code == "SOURCE_PATH_UNREADABLE"


def test_absolute_path_outside_root_is_rejected_before_filesystem_lookup(config, tmp_path):
    with pytest.raises(AppError) as error:
        RecordingDirectories(config.recordings_root).resolve(str(tmp_path / "not-existing"))
    assert error.value.code == "SOURCE_PATH_OUTSIDE_ROOT"


@pytest.mark.parametrize(
    "params, status, code",
    [
        ({"rootId": "unknown"}, 404, "UNKNOWN_RECORDING_ROOT"),
        ({"relativePath": "missing"}, 404, "SOURCE_PATH_UNAVAILABLE"),
        ({"limit": 0}, 422, "VALIDATION_ERROR"),
        ({"cursor": "%%%"}, 422, "INVALID_CURSOR"),
    ],
)
def test_api_error_contract(client, params, status, code):
    response = client.get(
        "/api/recording-directories", params=params, headers={"X-Request-ID": "request-example"}
    )
    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    assert response.json()["error"]["requestId"] == "request-example"
    assert response.headers["X-Request-ID"] == "request-example"


def test_readiness_requires_current_worker_and_source_offline_does_not_fail(
    config, client, database
):
    assert client.get("/api/health/live").status_code == 200
    assert client.get("/api/health/ready").status_code == 503
    heartbeat(database, "test-owner", "test-token", 30)
    assert client.get("/api/health/ready").status_code == 200
    config.recordings_root.rename(config.recordings_root.with_name("offline"))
    assert client.get("/api/health/ready").status_code == 200
    with Session(database) as session, session.begin():
        session.get(RuntimeLease, "coordinator").expires_at = utc_now_ms() - 1
    assert client.get("/api/health/ready").status_code == 503


def test_capabilities_are_truthful_and_recognition_is_unavailable(client):
    flags = client.get("/api/capabilities").json()
    assert flags["backendStage"] == "exports"
    assert all(flags[key] for key in ("scan", "reindex", "prepare", "playback", "export"))
    for key in (
        "transcription",
        "visualRecognition",
        "semanticSearch",
    ):
        assert flags[key] is False
    assert client.post("/api/tasks", json={"kind": "transcription"}).status_code == 422
    assert not any(
        name.startswith(("torch", "funasr", "whisper", "onnxruntime")) for name in sys.modules
    )


def test_readonly_settings_and_status_use_persisted_values(client, database):
    with Session(database) as session, session.begin():
        session.get(SavedSettings, "export").value_json = {
            "defaultMode": "precise",
            "maxDuration": 10,
        }
    assert client.get("/api/settings").json()["groups"]["export"]["values"]["maxDuration"] == 10
    status = client.get("/api/system/status").json()
    assert status["queue"]["executionEnabled"] is True
    assert status["storage"]["freeBytes"] > 0


def test_iso_time_uses_utc_milliseconds():
    assert iso_utc(0) == "1970-01-01T00:00:00.000Z"
    assert iso_utc(None) is None
