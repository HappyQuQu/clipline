"""Maintenance never traverses the recording mount; only generated data is eligible."""

import fcntl
import logging
import os
import re
import shutil
import stat

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.time import iso_utc, utc_now_ms
from app.db.models import Artifact, BusinessLog, Event, RuntimeLease, SavedSettings, Segment, Task
from app.db.transactions import write_session
from app.services.events import emit

logger = logging.getLogger(__name__)
ROOTS = {"export": "exports", "playback": "playback-proxies", "thumbnail": "thumbnails"}
UUID = re.compile(r"^[a-f0-9-]{36}$")
CACHE_FILE = re.compile(r"^[a-f0-9-]{36}-[a-f0-9]{64}-(?:[a-f0-9]{16}\.(?:mp4|ts)|first-v1\.jpg)$")


def generated_path(config, relative, kind):
    root = config.data / ROOTS[kind]
    path = config.data / relative
    if (
        root.is_symlink()
        or path.is_symlink()
        or not path.resolve().is_relative_to(root)
        or path.resolve().is_relative_to(config.recordings_root)
    ):
        raise AppError("UNSAFE_ARTIFACT_PATH", "应用文件路径无效，已跳过清理。")
    return path


def in_use(session, artifact):
    if (artifact.profile_hash or "").startswith("hls:") and artifact.task_id:
        task = session.get(Task, artifact.task_id)
        if task and task.status in ("queued", "running", "cancelling"):
            return True
        if session.scalar(
            select(RuntimeLease.resource_key)
            .where(
                RuntimeLease.resource_key.startswith(f"hls:{artifact.task_id}:"),
                RuntimeLease.expires_at > utc_now_ms(),
            )
            .limit(1)
        ):
            return True
    return (
        session.scalar(
            select(RuntimeLease.resource_key)
            .where(
                or_(
                    RuntimeLease.resource_key.startswith(f"use:{artifact.id}:"),
                    RuntimeLease.resource_key.startswith(f"view:{artifact.id}:"),
                ),
                RuntimeLease.expires_at > utc_now_ms(),
            )
            .limit(1)
        )
        is not None
    )


def lock_file(path):
    if not path.exists():
        return None
    handle = os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb")
    try:
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
            raise OSError("Not a regular generated file")
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return handle
    except BaseException:
        handle.close()
        raise


def remove_artifact(session, config, artifact):
    if in_use(session, artifact):
        return None
    path = generated_path(config, artifact.relative_path, artifact.kind)
    try:
        handle = lock_file(path)
    except BlockingIOError:
        return None
    try:
        size = path.stat().st_size if handle else 0
        path.unlink(missing_ok=True)
        artifact.status = "expired" if artifact.kind == "export" else "evicted"
        if artifact.kind == "export" and artifact.task_id:
            manifest = config.data / "exports" / "manifests" / f"{artifact.task_id}.json"
            if not manifest.is_symlink() and manifest.resolve().is_relative_to(
                config.data / "exports"
            ):
                manifest.unlink(missing_ok=True)
        return size
    finally:
        if handle:
            handle.close()


def evict_playback(session, config, required=0, exclude=None):
    rows = list(
        session.scalars(
            select(Artifact)
            .where(
                Artifact.kind == "playback",
                Artifact.status == "ready",
                Artifact.relative_path != (exclude or ""),
            )
            .order_by(func.coalesce(Artifact.last_access_at, Artifact.created_at), Artifact.id)
        )
    )
    total = sum(row.size_bytes for row in rows)
    needed = total + required - config.playback_cache_max_bytes
    if needed <= 0:
        return {"removedFiles": 0, "removedBytes": 0}
    chosen, handles, reclaim = [], [], 0
    try:
        for row in rows:
            if in_use(session, row):
                continue
            try:
                path = generated_path(config, row.relative_path, row.kind)
                handle = lock_file(path)
            except (OSError, AppError):
                continue
            chosen.append((row, path))
            handles.append(handle)
            reclaim += row.size_bytes
            if reclaim >= needed:
                break
        if reclaim < needed and required:
            raise AppError(
                "PLAYBACK_CACHE_FULL", "缓存空间不足且已有文件正在使用，请稍后重试或调整容量。", 409
            )
        removed = 0
        for row, path in chosen:
            removed += path.stat().st_size if path.is_file() else 0
            path.unlink(missing_ok=True)
            row.status = "evicted"
        return {"removedFiles": len(chosen), "removedBytes": removed}
    finally:
        for handle in handles:
            if handle:
                handle.close()


def cleanup_generated(config, engine, now):
    removed = 0
    with Session(engine) as session:
        states = dict(session.execute(select(Task.id, Task.status)).all())
        registered = set(session.scalars(select(Artifact.relative_path)))
        retained_manifests = set(
            session.scalars(
                select(Artifact.task_id).where(
                    Artifact.kind == "export", Artifact.status == "ready"
                )
            )
        )
    # UUID task directories only; queued/running attempts protect their crash manifests.
    temporary = config.data / "tmp"
    if not temporary.is_symlink():
        processed = 0
        for folder in temporary.iterdir():
            if processed >= 200:
                break
            if (
                not UUID.fullmatch(folder.name)
                or folder.is_symlink()
                or not folder.is_dir()
                or states.get(folder.name) in ("queued", "running", "cancelling")
            ):
                continue
            processed += 1
            for attempt in folder.iterdir():
                if (
                    UUID.fullmatch(attempt.name)
                    and attempt.is_dir()
                    and not attempt.is_symlink()
                    and attempt.resolve().is_relative_to(temporary)
                    and now - int(attempt.stat().st_mtime * 1000)
                    > config.temporary_retention_seconds * 1000
                ):
                    shutil.rmtree(attempt)
                    removed += 1
            try:
                folder.rmdir()
            except OSError:
                pass
    for kind, name in ROOTS.items():
        root = config.data / name
        if root.is_symlink():
            continue
        processed = 0
        for file in root.iterdir():
            if processed >= 500:
                break
            if (
                file.is_symlink()
                or not file.is_file()
                or file.relative_to(config.data).as_posix() in registered
                or now - int(file.stat().st_mtime * 1000)
                <= config.temporary_retention_seconds * 1000
            ):
                continue
            # Active tasks may be between atomic rename and DB registration.
            if kind == "export" and (
                not UUID.fullmatch(file.stem)
                or states.get(file.stem) not in ("completed", "failed", "cancelled")
            ):
                continue
            if kind != "export" and not CACHE_FILE.fullmatch(file.name):
                continue
            processed += 1
            try:
                handle = lock_file(file)
            except BlockingIOError:
                continue
            try:
                file.unlink(missing_ok=True)
                removed += 1
            finally:
                if handle:
                    handle.close()
    manifests = config.data / "exports" / "manifests"
    if (
        manifests.is_dir()
        and not manifests.is_symlink()
        and not (config.data / "exports").is_symlink()
        and manifests.resolve().is_relative_to(config.data / "exports")
    ):
        for file in manifests.iterdir():
            if (
                file.is_symlink()
                or file.suffix not in (".json", ".pending")
                or not UUID.fullmatch(file.stem)
                or states.get(file.stem) not in ("completed", "failed", "cancelled")
                or file.stem in retained_manifests
                or now - int(file.stat().st_mtime * 1000)
                <= config.temporary_retention_seconds * 1000
            ):
                continue
            file.unlink(missing_ok=True)
            removed += 1
    return removed


def maintain(engine, config):
    now = utc_now_ms()
    summary = {
        "removedFiles": 0,
        "removedBytes": 0,
        "expiredExports": 0,
        "evictedPlayback": 0,
        "temporaryFiles": 0,
        "logsPruned": 0,
        "eventsPruned": 0,
        "skippedFiles": 0,
    }
    with write_session(engine) as session:
        session.execute(
            delete(RuntimeLease).where(
                or_(
                    RuntimeLease.resource_key.startswith("use:"),
                    RuntimeLease.resource_key.startswith("view:"),
                    RuntimeLease.resource_key.startswith("hls:"),
                ),
                RuntimeLease.expires_at <= now,
            )
        )
        abandoned_streams = select(Task.id).where(
            Task.kind == "prepare",
            Task.status.in_(("cancelled", "failed")),
            Task.payload_json["mode"].as_string() == "stream",
        )
        unavailable = select(Segment.id).where(Segment.availability != "available")
        candidates = list(
            session.scalars(
                select(Artifact)
                .where(
                    or_(
                        (Artifact.kind == "playback")
                        & Artifact.profile_hash.startswith("hls:")
                        & (Artifact.task_id.in_(abandoned_streams))
                        & (Artifact.status == "ready"),
                        (Artifact.kind == "export")
                        & (Artifact.expires_at <= now)
                        & (Artifact.status != "expired"),
                        (Artifact.kind.in_(("playback", "thumbnail")))
                        & (Artifact.status == "stale"),
                        (Artifact.kind.in_(("playback", "thumbnail")))
                        & (Artifact.status == "ready")
                        & (Artifact.segment_id.in_(unavailable)),
                    )
                )
                .order_by(Artifact.created_at)
                .limit(100)
            )
        )
        for row in candidates:
            try:
                size = remove_artifact(session, config, row)
            except (OSError, AppError):
                summary["skippedFiles"] += 1
                logger.warning("Skipped unsafe or unreadable generated artifact %s", row.id)
                continue
            if size is not None:
                summary["removedFiles"] += 1
                summary["removedBytes"] += size
                summary["expiredExports" if row.kind == "export" else "evictedPlayback"] += 1
        evicted = evict_playback(session, config)
        summary["removedFiles"] += evicted["removedFiles"]
        summary["removedBytes"] += evicted["removedBytes"]
        summary["evictedPlayback"] += evicted["removedFiles"]
        summary["logsPruned"] = session.execute(
            delete(BusinessLog).where(
                BusinessLog.created_at < now - config.log_retention_days * 86400_000
            )
        ).rowcount
        max_event = session.scalar(select(func.max(Event.id))) or 0
        summary["eventsPruned"] = session.execute(
            delete(Event).where(
                or_(
                    Event.created_at < now - config.event_retention_hours * 3600_000,
                    Event.id <= max_event - config.event_max_count,
                )
            )
        ).rowcount
    summary["temporaryFiles"] = cleanup_generated(config, engine, now)
    with write_session(engine) as session:
        state = session.get(SavedSettings, "maintenance")
        if state is None:
            state = SavedSettings(group_name="maintenance", value_json={})
            session.add(state)
        state.value_json = {"lastRunAt": iso_utc(now), **summary}
        if any(summary.values()):
            emit(
                session,
                kind="system",
                code="MAINTENANCE_WARNING" if summary["skippedFiles"] else "MAINTENANCE_COMPLETED",
                title="清理跳过不可访问的应用文件"
                if summary["skippedFiles"]
                else "到期文件与应用缓存已清理",
                detail=summary,
                level="warning" if summary["skippedFiles"] else "info",
            )
    return summary


def run(engine, config, stopped):
    while not stopped.is_set():
        try:
            maintain(engine, config)
        except Exception:
            logger.exception("Maintenance failed; will retry at the next interval")
        stopped.wait(config.maintenance_interval_seconds)
