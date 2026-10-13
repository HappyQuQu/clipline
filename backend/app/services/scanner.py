import hashlib
import os
import stat
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.time import utc_now_ms
from app.db.models import Artifact, Segment, new_id
from app.db.transactions import write_session
from app.services import media
from app.services.directories import RecordingDirectories
from app.services.events import emit
from app.services.recording_time import infer_start

EXTENSIONS = {".mp4", ".mov", ".mkv", ".ts"}
THUMBNAIL_PROFILE = "thumbnail-first-v1"


def file_fingerprint(source_id, relative_path, info):
    return hashlib.sha256(
        f"{source_id}:{relative_path}:{info.st_size}:{info.st_mtime_ns}".encode()
    ).hexdigest()


def identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


def collect(root, context, stats):
    paths = []

    def failed(error):
        raise AppError("SCAN_INCOMPLETE", "录像目录未能完整读取，原有索引已保留。") from error

    try:
        for directory, children, files in os.walk(root, onerror=failed, followlinks=False):
            context.check()
            children[:] = sorted(name for name in children if not name.startswith("."))
            for name in sorted(files):
                if Path(name).suffix.lower() in EXTENSIONS and not name.startswith("."):
                    paths.append(Path(directory) / name)
            stats["discovered"] = len(paths)
            context.update("discover", 0, stats)
    except OSError as error:
        failed(error)
    return paths


def warning(session, context, stats, code, path):
    stats["warnings"] += 1
    if stats["warnings"] <= 10:
        emit(
            session,
            kind=context.claim.kind,
            code=code,
            title="扫描发现文件异常",
            source_id=context.claim.source_id,
            task_id=context.claim.task_id,
            detail={"relativePath": str(path), "errorCode": code},
            level="warning",
        )


def existing_info(engine, source_id, relative):
    with Session(engine) as session:
        row = session.scalar(
            select(Segment).where(Segment.source_id == source_id, Segment.relative_path == relative)
        )
        if row is None:
            return None
        artifact = session.scalar(
            select(Artifact).where(
                Artifact.segment_id == row.id,
                Artifact.kind == "thumbnail",
                Artifact.status == "ready",
                Artifact.input_fingerprint == row.fingerprint,
                Artifact.profile_hash == THUMBNAIL_PROFILE,
            )
        )
        return {
            "id": row.id,
            "fingerprint": row.fingerprint,
            "availability": row.availability,
            "lastSeenScan": row.last_seen_scan,
            "artifactPath": artifact.relative_path if artifact else None,
        }


def scan_file(path, root, context, stats):
    context.check()
    relative = path.relative_to(root).as_posix()
    existing = existing_info(context.queue.engine, context.claim.source_id, relative)
    segment_id = existing["id"] if existing else new_id()
    temporary = None
    metadata, thumb_error, file_error = None, None, None
    pending = False
    try:
        canonical = path.resolve(strict=True)
        if not canonical.is_relative_to(root):
            raise AppError("SOURCE_PATH_OUTSIDE_ROOT", "文件位置已超出此录像源目录。")
        before = canonical.stat()
        if not stat.S_ISREG(before.st_mode) or not os.access(canonical, os.R_OK):
            raise AppError("FILE_UNREADABLE", "录像文件不可读。")
        fingerprint = file_fingerprint(context.claim.source_id, relative, before)
        pending = before.st_mtime_ns // 1_000_000 > (
            utc_now_ms() - context.claim.payload["skipRecentSeconds"] * 1000
        )
        thumbnail_ready = False
        if existing and existing["artifactPath"]:
            cached = context.config.data / existing["artifactPath"]
            thumbnail_ready = (
                existing["fingerprint"] == fingerprint
                and cached.resolve().is_relative_to(context.config.data)
                and cached.is_file()
            )
        unchanged = (
            existing
            and existing["fingerprint"] == fingerprint
            and existing["availability"] == "available"
        )
        if (
            not pending
            and unchanged
            and thumbnail_ready
            and (context.claim.kind == "scan" or existing["lastSeenScan"] == context.claim.task_id)
        ):
            with write_session(context.queue.engine) as session:
                context.queue.owned(session, context.claim)
                row = session.get(Segment, segment_id)
                row.last_seen_scan = context.claim.task_id
            stats["unchanged"] += 1
            return
        if not pending:
            metadata = media.probe(canonical, context)
            start, origin, confidence = infer_start(
                path,
                before.st_mtime_ns,
                metadata["duration_ms"],
                context.claim.payload["recordingTimezone"],
            )
            metadata |= {
                "start_at": start,
                "end_at": start + metadata["duration_ms"],
                "time_source": origin,
                "time_confidence": confidence,
            }
            if identity(canonical.stat()) != identity(before):
                pending, metadata = True, None
            elif not thumbnail_ready or context.claim.kind == "reindex":
                directory = (
                    context.config.data / "tmp" / context.claim.task_id / context.claim.token
                )
                directory.mkdir(parents=True, exist_ok=True)
                temporary = directory / f"{segment_id}.jpg"
                try:
                    with context.media_slot():
                        media.make_thumbnail(canonical, metadata, temporary, context)
                except AppError as error:
                    thumb_error = error.code
                if identity(canonical.stat()) != identity(before):
                    pending, metadata = True, None
        after = canonical.stat()
        if identity(after) != identity(before):
            pending, metadata = True, None
        info = after
        fingerprint = file_fingerprint(context.claim.source_id, relative, info)
    except (FileNotFoundError, PermissionError, OSError) as error:
        raise AppError(
            "SCAN_INCOMPLETE", "扫描中有文件无法访问，未清理旧索引，请稍后重试。"
        ) from error
    except AppError as error:
        file_error = error.code
        try:
            info = path.stat()
            fingerprint = file_fingerprint(context.claim.source_id, relative, info)
        except OSError as stat_error:
            raise AppError("SCAN_INCOMPLETE", "无法确认文件状态，旧索引已保留。") from stat_error
    try:
        with write_session(context.queue.engine) as session:
            context.queue.owned(session, context.claim)
            row = session.get(Segment, segment_id)
            if row is None:
                row = Segment(
                    id=segment_id,
                    source_id=context.claim.source_id,
                    relative_path=relative,
                    filename=path.name,
                    size_bytes=info.st_size,
                    mtime_ns=info.st_mtime_ns,
                    fingerprint=fingerprint,
                )
                session.add(row)
            changed = row.fingerprint != fingerprint
            row.size_bytes, row.mtime_ns, row.fingerprint = (
                info.st_size,
                info.st_mtime_ns,
                fingerprint,
            )
            row.last_seen_scan = context.claim.task_id
            if changed or pending or file_error:
                session.execute(
                    update(Artifact).where(Artifact.segment_id == row.id).values(status="stale")
                )
                row.start_at = row.end_at = row.duration_ms = None
            if pending:
                row.availability, row.error_code = "pending", "FILE_STILL_WRITING"
                row.playback_status = "needs_prepare"
                stats["pending"] += 1
            elif file_error:
                row.availability, row.error_code = "invalid", file_error
                row.playback_status = "failed"
                warning(session, context, stats, file_error, relative)
                stats["failed"] += 1
            else:
                for key, value in metadata.items():
                    setattr(row, key, value)
                row.availability, row.error_code = "available", None
                row.playback_status = (
                    "direct"
                    if row.container.startswith("mov")
                    and row.video_codec == "h264"
                    and row.audio_codec in (None, "aac")
                    else "needs_prepare"
                )
                row.index_revision = (row.index_revision or 0) + 1
                session.flush()
                if temporary and temporary.exists() and not thumb_error:
                    target = (
                        context.config.data / "thumbnails" / f"{row.id}-{fingerprint}-first-v1.jpg"
                    )
                    os.replace(temporary, target)
                    artifact = session.scalar(
                        select(Artifact).where(
                            Artifact.relative_path
                            == target.relative_to(context.config.data).as_posix()
                        )
                    )
                    if artifact is None:
                        artifact = Artifact(
                            segment_id=row.id,
                            kind="thumbnail",
                            relative_path=target.relative_to(context.config.data).as_posix(),
                            size_bytes=target.stat().st_size,
                        )
                        session.add(artifact)
                    artifact.status, artifact.task_id = "ready", context.claim.task_id
                    artifact.input_fingerprint, artifact.profile_hash = (
                        fingerprint,
                        THUMBNAIL_PROFILE,
                    )
                    session.execute(
                        update(Artifact)
                        .where(
                            Artifact.segment_id == row.id,
                            Artifact.kind == "thumbnail",
                            Artifact.profile_hash != THUMBNAIL_PROFILE,
                        )
                        .values(status="stale")
                    )
                    artifact.size_bytes = target.stat().st_size
                    stats["thumbnails"] += 1
                if thumb_error:
                    warning(session, context, stats, thumb_error, relative)
                    stats["thumbnailFailed"] += 1
                stats["updated" if existing else "added"] += 1
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def scan(context):
    directories = RecordingDirectories(context.config.recordings_root)
    root = directories.resolve(context.claim.payload["sourcePath"])
    root_identity = identity(root.stat())[:2]
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
    paths = collect(root, context, stats)
    for index, path in enumerate(paths):
        context.update("probe", int(index * 90 / max(1, len(paths))), stats)
        scan_file(path, root, context, stats)
        stats["processed"] += 1
    context.update("index", 95, stats)
    if not root.is_dir() or identity(root.stat())[:2] != root_identity:
        raise AppError("SCAN_ROOT_CHANGED", "扫描过程中录像目录发生变化，旧索引已保留。")
    with Session(context.queue.engine) as session:
        unseen = list(
            session.execute(
                select(Segment.id, Segment.relative_path).where(
                    Segment.source_id == context.claim.source_id,
                    (Segment.last_seen_scan != context.claim.task_id)
                    | Segment.last_seen_scan.is_(None),
                    Segment.availability != "missing",
                )
            )
        )
    missing = []
    for segment_id, relative in unseen:
        context.check()
        try:
            (root / relative).stat()
        except FileNotFoundError:
            missing.append(segment_id)
        except OSError as error:
            raise AppError("SCAN_INCOMPLETE", "无法确认旧文件状态，原有索引已保留。") from error

    def finalize(session):
        if not root.is_dir() or identity(root.stat())[:2] != root_identity:
            raise AppError("SCAN_ROOT_CHANGED", "完成扫描前录像目录发生变化，旧索引已保留。")
        for start in range(0, len(missing), 250):
            ids = missing[start : start + 250]
            session.execute(
                update(Segment)
                .where(Segment.id.in_(ids))
                .values(availability="missing", error_code="FILE_MISSING")
            )
            session.execute(
                update(Artifact).where(Artifact.segment_id.in_(ids)).values(status="stale")
            )

    context.update("finalize", 99, stats)
    return {**stats, "missing": len(missing)}, finalize
