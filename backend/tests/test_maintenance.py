import os
import time
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.backup import create, restore, verify
from app.core.errors import AppError
from app.core.locks import ProcessLock
from app.core.time import utc_now_ms
from app.db.models import Artifact, RuntimeLease, Source, Task
from app.db.transactions import write_session
from app.services.maintenance import evict_playback, maintain
from app.services.usage import FileUse, view_lease


def artifact(database, config, kind="export", age=0, size=100, access=1):
    id = str(uuid4())
    name = "exports" if kind == "export" else "playback-proxies"
    file = config.data / name / f"{id}.mp4"
    file.write_bytes(b"x" * size)
    with write_session(database) as session:
        task = Task(
            id=id,
            kind="export",
            status="completed",
            result_json={"sha256": "hash"},
            payload_json={"name": "file.mp4"},
        )
        session.add(task)
        session.flush()
        item = Artifact(
            kind=kind,
            task_id=id,
            relative_path=f"{name}/{id}.mp4",
            size_bytes=size,
            expires_at=utc_now_ms() + age,
            last_access_at=access,
        )
        session.add(item)
        session.flush()
        return item.id, file, id


def test_expired_export_preserves_slow_stream_even_after_lease_expiry(client, config, database):
    config.usage_idle_seconds = 0
    aid, file, tid = artifact(database, config, age=10000)
    manifests = config.data / "exports" / "manifests"
    manifests.mkdir()
    manifest = manifests / f"{tid}.json"
    manifest.write_text("{}")
    with write_session(database) as session:
        item = session.get(Artifact, aid)
        usage = FileUse(session, database, config, item, file)
        item.expires_at = 1
    with write_session(database) as session:
        session.get(RuntimeLease, usage.key).expires_at = 1
    assert maintain(database, config)["expiredExports"] == 0
    assert file.exists() and usage.handle.read(1) == b"x"
    assert client.get(f"/api/exports/{tid}/download").status_code == 410
    usage.close()
    assert maintain(database, config)["expiredExports"] == 1
    assert not file.exists() and not manifest.exists()
    assert client.get(f"/api/tasks/{tid}").json()["downloadStatus"] == "expired"
    assert client.get(f"/api/tasks/{tid}").json()["status"] == "completed"


def test_playback_view_lease_and_pressure_lru_skip_active_files(config, database):
    config.playback_cache_max_bytes = 200
    aid, first, _ = artifact(database, config, kind="playback", access=1)
    bid, second, _ = artifact(database, config, kind="playback", access=2)
    with write_session(database) as session:
        view_lease(session, config, session.get(Artifact, aid), str(uuid4()), True)
        removed = evict_playback(session, config, required=100)
        assert removed["removedFiles"] == 1
    assert first.exists() and not second.exists()
    with write_session(database) as session:
        with pytest.raises(AppError, match="缓存空间不足"):
            evict_playback(session, config, required=300)
    assert first.exists()
    with write_session(database) as session:
        for row in session.scalars(select(RuntimeLease)):
            row.expires_at = 1
    config.playback_cache_max_bytes = 0
    assert maintain(database, config)["evictedPlayback"] == 1
    assert not first.exists()


def test_os_read_lock_also_protects_proxy_after_process_lease_expiry(config, database):
    config.usage_idle_seconds = 0
    config.playback_cache_max_bytes = 0
    aid, file, _ = artifact(database, config, kind="playback")
    with write_session(database) as session:
        usage = FileUse(session, database, config, session.get(Artifact, aid), file)
    with write_session(database) as session:
        session.get(RuntimeLease, usage.key).expires_at = 1
    assert maintain(database, config)["evictedPlayback"] == 0
    assert file.exists()
    usage.close()
    assert maintain(database, config)["evictedPlayback"] == 1


def test_original_and_active_attempts_never_enter_cleanup(config, database):
    original = config.recordings_root / "alpha" / "original.mp4"
    original.write_bytes(b"keep")
    with write_session(database) as session:
        queued = Task(kind="export", status="queued")
        finished = Task(kind="export", status="completed")
        session.add_all([queued, finished])
        session.flush()
        ids = (queued.id, finished.id)
    attempts = []
    for id in ids:
        folder = config.data / "tmp" / id / str(uuid4())
        folder.mkdir(parents=True)
        (folder / "part.mp4").write_bytes(b"part")
        os.utime(folder, (time.time() - 7200, time.time() - 7200))
        attempts.append(folder)
    manifests = config.data / "exports" / "manifests"
    manifests.mkdir()
    for task_id in ids:
        manifest = manifests / f"{task_id}.json"
        manifest.write_text("{}")
        os.utime(manifest, (time.time() - 7200, time.time() - 7200))
    custom = config.data / "tmp" / "user-folder"
    custom.mkdir()
    (custom / "keep").write_text("keep")
    outside = config.data / "exports" / "link.mp4"
    outside.symlink_to(original)
    with write_session(database) as session:
        session.add(
            Artifact(kind="export", relative_path="exports/link.mp4", size_bytes=4, expires_at=1)
        )
    summary = maintain(database, config)
    assert summary["temporaryFiles"] == 2 and not attempts[1].exists()
    assert attempts[0].exists() and custom.exists() and outside.is_symlink()
    assert (manifests / f"{ids[0]}.json").exists()
    assert not (manifests / f"{ids[1]}.json").exists()
    assert original.read_bytes() == b"keep"


def test_backup_matches_manifest_live_api_blocks_restore_then_offline_recovery(
    client, config, database
):
    with write_session(database) as session:
        session.add(Source(name="Before", canonical_path="/before"))
    backup = create(config)
    assert verify(config, backup.name)[1]["schema"]
    with pytest.raises(RuntimeError, match="api.lock"):
        restore(config, backup.name)
    with pytest.raises(RuntimeError):
        verify(config, "../private.sqlite3")
    manifest = backup.with_suffix(".json")
    import json

    data = json.loads(manifest.read_text())
    data["schema"] = "unknown"
    manifest.write_text(json.dumps(data))
    with pytest.raises(RuntimeError, match="manifest"):
        verify(config, backup.name)


def test_offline_restore_uses_consistent_backup_and_preserves_current_db(config, database):
    with write_session(database) as session:
        row = Source(name="Before", canonical_path="/before")
        session.add(row)
        session.flush()
        sid = row.id
    backup = create(config)
    with write_session(database) as session:
        session.get(Source, sid).name = "After"
    database.dispose()
    restore(config, backup.name)
    with Session(database) as session:
        assert session.get(Source, sid).name == "Before"
    assert len(list((config.data / "backups").glob("*.sqlite3"))) == 2
    with ProcessLock(config.data / "worker.lock"):
        with pytest.raises(RuntimeError):
            restore(config, backup.name)


def test_upgrade_preserves_public_logs_and_backups_previous_schema(config):
    from alembic import command

    from app.bootstrap import bootstrap
    from app.db.migrations import alembic_config, current_revision
    from app.db.session import make_engine

    config.data.mkdir()
    config.db.parent.mkdir(exist_ok=True)
    engine = make_engine(config)
    with engine.connect() as connection:
        migration = alembic_config()
        migration.attributes["connection"] = connection
        command.upgrade(migration, "0003_indexing_queue")
        connection.exec_driver_sql(
            "INSERT INTO business_logs(id,created_at,level,kind,event_code,title,detail_json) "
            "VALUES('existing-log',1,'info','system','OLD','keep','{}')"
        )
        connection.commit()
    engine.dispose()
    bootstrap(config, check_media=False)
    engine = make_engine(config)
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT id,sequence FROM business_logs").one() == (
            "existing-log",
            1,
        )
    assert current_revision(engine) == "0004_log_sequence"
    backups = list((config.data / "backups").glob("*.sqlite3"))
    assert len(backups) == 1
    with pytest.raises(RuntimeError, match="matching old image"):
        verify(config, backups[0].name)
    assert (
        verify(config, backups[0].name, target_schema="0003_indexing_queue")[1]["schema"]
        == "0003_indexing_queue"
    )
    engine.dispose()
    restore(config, backups[0].name, target_schema="0003_indexing_queue")
    assert current_revision(engine) == "0003_indexing_queue"
    engine.dispose()


def test_symlinked_export_root_cannot_delete_original_manifest(config, database):
    with write_session(database) as session:
        task = Task(kind="export", status="completed")
        session.add(task)
        session.flush()
        tid = task.id
    originals = config.recordings_root / "alpha"
    directory = originals / "manifests"
    directory.mkdir()
    original = directory / f"{tid}.json"
    original.write_bytes(b'{"keep":true}')
    os.utime(original, (time.time() - 7200, time.time() - 7200))
    (config.data / "exports").rmdir()
    (config.data / "exports").symlink_to(originals)
    assert maintain(database, config)["temporaryFiles"] == 0
    assert original.read_bytes() == b'{"keep":true}'
