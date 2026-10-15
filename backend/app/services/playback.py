import hashlib
import os
import shutil
import stat
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.time import utc_now_ms
from app.db.models import Artifact, Segment, Source, Task
from app.services import media
from app.services.directories import RecordingDirectories
from app.services.maintenance import evict_playback


def profile(config, mode="compatible", start_ms=0):
    if mode == "stream":
        from app.services.hls import profile as hls_profile

        return hls_profile(config, start_ms)
    if mode == "hevc":
        return hashlib.sha256(b"hevc-copy-hvc1-aac-faststart-v1").hexdigest()
    return hashlib.sha256(
        f"h264-aac-yuv420p-crf23-v1:{config.playback_max_width}".encode()
    ).hexdigest()


def playback_mode(segment, requested):
    # Only opt in after the client has checked its decoder. Legacy clients keep H.264.
    if requested == "stream":
        return "stream"
    if segment.video_codec != "hevc":
        return "compatible"
    if requested == "original":
        if "mp4" in (segment.container or "").split(",") and segment.audio_codec in (
            None,
            "aac",
            "opus",
        ):
            return "original"
        return "hevc"
    return requested


def get_segment(session, segment_id):
    row = session.get(Segment, segment_id)
    if row is None:
        raise AppError("SEGMENT_NOT_FOUND", "录像片段不存在。", 404)
    if row.availability != "available":
        raise AppError("RECORDING_UNAVAILABLE", "录像暂时不可用，请查看文件状态或重新扫描。", 409)
    return row


def original_path(session, config, segment):
    source = session.get(Source, segment.source_id)
    root = RecordingDirectories(config.recordings_root).resolve(source.canonical_path)
    relative = Path(segment.relative_path)
    if relative.is_absolute() or ".." in relative.parts:
        raise AppError("RECORDING_PATH_INVALID", "录像路径无效。", 403)
    try:
        path = (root / relative).resolve(strict=True)
        if not path.is_relative_to(root):
            raise AppError("RECORDING_PATH_INVALID", "录像路径超出源目录。", 403)
        info = path.stat()
        if not stat.S_ISREG(info.st_mode):
            raise AppError("RECORDING_UNAVAILABLE", "录像文件不可读。", 409)
        if info.st_size != segment.size_bytes or info.st_mtime_ns != segment.mtime_ns:
            raise AppError("RECORDING_CHANGED", "录像已变化，请重新扫描后播放。", 409)
        return path
    except OSError as error:
        raise AppError(
            "RECORDING_UNAVAILABLE", "录像文件暂时无法读取，请检查挂载。", 409
        ) from error


def cached(session, config, segment, mode="compatible"):
    artifact = session.scalar(
        select(Artifact).where(
            Artifact.segment_id == segment.id,
            Artifact.kind == "playback",
            Artifact.status == "ready",
            Artifact.input_fingerprint == segment.fingerprint,
            Artifact.profile_hash == profile(config, mode),
        )
    )
    if artifact:
        path = (config.data / artifact.relative_path).resolve()
        if (
            path.is_relative_to(config.data / "playback-proxies")
            and path.is_file()
            and path.stat().st_size == artifact.size_bytes
        ):
            return artifact, path
    return None


def playback_status(session, config, segment_id, mode="compatible", start_ms=0):
    segment = get_segment(session, segment_id)
    original_path(session, config, segment)
    mode = playback_mode(segment, mode)
    if mode == "stream":
        legacy = cached(session, config, segment)
        if legacy:
            return {
                "status": "ready",
                "mediaUrl": f"/api/segments/{segment.id}/media?fingerprint={segment.fingerprint}",
                "taskId": None,
                "proxy": True,
                "mode": "compatible",
            }
        from app.services.hls import state

        return state(session, config, segment, start_ms)
    url = f"/api/segments/{segment.id}/media?fingerprint={segment.fingerprint}&mode={mode}"
    if mode == "original":
        return {"status": "direct", "mediaUrl": url, "taskId": None, "proxy": False, "mode": mode}
    cache = cached(session, config, segment, mode)
    if cache:
        return {"status": "ready", "mediaUrl": url, "taskId": None, "proxy": True, "mode": mode}
    if segment.playback_status == "direct":
        return {"status": "direct", "mediaUrl": url, "taskId": None, "proxy": False, "mode": mode}
    active = session.scalar(
        select(Task).where(
            Task.active_key == f"prepare:{segment.id}:{segment.fingerprint}:{profile(config, mode)}"
        )
    )
    latest = session.scalar(
        select(Task)
        .where(
            Task.kind == "prepare",
            Task.payload_json["segmentId"].as_string() == segment.id,
            Task.payload_json["profile"].as_string() == profile(config, mode),
        )
        .order_by(Task.created_at.desc(), Task.id.desc())
        .limit(1)
    )
    return {
        "status": "preparing"
        if active
        else "failed"
        if latest
        and latest.status == "failed"
        and latest.payload_json.get("fingerprint") == segment.fingerprint
        and latest.payload_json.get("profile") == profile(config, mode)
        else "needs_prepare",
        "mediaUrl": None,
        "taskId": active.id
        if active
        else latest.id
        if latest and latest.status in ("failed", "cancelled")
        else None,
        "proxy": True,
        "mode": mode,
        "errorMessage": latest.error_message if latest and latest.status == "failed" else None,
    }


def prepare(context):
    if context.claim.payload.get("mode") == "stream":
        from app.services.hls import prepare as prepare_hls

        return prepare_hls(context)
    context.update("validate", 1, {})
    mode = context.claim.payload.get("mode", "compatible")
    with Session(context.queue.engine) as session:
        segment = get_segment(session, context.claim.payload["segmentId"])
        if (
            segment.fingerprint != context.claim.payload["fingerprint"]
            or profile(context.config, mode) != context.claim.payload["profile"]
            or playback_mode(segment, mode) != mode
        ):
            raise AppError("RECORDING_CHANGED", "录像或播放规格已变化，请重新提交。", 409)
        path = original_path(session, context.config, segment)
        duration_ms, fingerprint, segment_id = segment.duration_ms, segment.fingerprint, segment.id
    directory = context.config.data / "tmp" / context.claim.task_id / context.claim.token
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / "proxy.mp4"
    if context.config.playback_cache_max_bytes == 0:
        raise AppError("PLAYBACK_CACHE_FULL", "播放缓存已禁用，请调整部署容量。", 409)
    if (
        shutil.disk_usage(context.config.data).free
        < min(segment.size_bytes, 256 * 1024**2) + 64 * 1024**2
    ):
        raise AppError("INSUFFICIENT_STORAGE", "数据目录剩余空间不足，无法准备播放。", 409)
    with context.media_slot():
        context.update("transcode", 2, {"outTimeMs": 0})
        if mode == "hevc":
            media.remux_hevc(path, duration_ms, target, context)
        else:
            media.make_proxy(path, duration_ms, target, context)
        context.update("verify", 96, {"outTimeMs": duration_ms})
        metadata = media.probe(target, context)
    if (
        metadata["video_codec"] != ("hevc" if mode == "hevc" else "h264")
        or metadata["audio_codec"] not in (None, "aac")
        or abs(metadata["duration_ms"] - duration_ms) > max(1000, duration_ms * 0.02)
    ):
        raise AppError("INVALID_PLAYBACK_OUTPUT", "播放文件校验失败，未发布结果。")
    size = target.stat().st_size
    final = (
        context.config.data
        / "playback-proxies"
        / f"{segment_id}-{fingerprint}-{profile(context.config, mode)[:16]}.mp4"
    )

    def finalize(session):
        row = get_segment(session, segment_id)
        if row.fingerprint != fingerprint:
            raise AppError("RECORDING_CHANGED", "录像已变化，播放结果未发布。", 409)
        original_path(session, context.config, row)
        evicted = evict_playback(
            session, context.config, size, final.relative_to(context.config.data).as_posix()
        )
        if evicted["removedFiles"]:
            from app.services.events import emit

            emit(
                session,
                kind="system",
                code="PLAYBACK_LRU_EVICTED",
                title="旧播放缓存已按使用顺序清理",
                detail=evicted,
            )
        artifact = session.scalar(
            select(Artifact).where(
                Artifact.relative_path == final.relative_to(context.config.data).as_posix()
            )
        )
        if artifact is None:
            artifact = Artifact(
                kind="playback",
                segment_id=segment_id,
                relative_path=final.relative_to(context.config.data).as_posix(),
                size_bytes=size,
            )
            session.add(artifact)
        os.replace(target, final)
        artifact.task_id, artifact.status = context.claim.task_id, "ready"
        artifact.profile_hash, artifact.input_fingerprint = (
            profile(context.config, mode),
            fingerprint,
        )
        artifact.size_bytes, artifact.duration_ms, artifact.last_access_at = (
            size,
            metadata["duration_ms"],
            utc_now_ms(),
        )
        session.flush()
        session.execute(
            update(Artifact)
            .where(
                Artifact.segment_id == segment_id,
                Artifact.kind == "playback",
                Artifact.profile_hash == artifact.profile_hash,
                Artifact.id != artifact.id,
            )
            .values(status="stale")
        )
        row.playback_status = "ready"

    context.update("publish", 99, {"outTimeMs": duration_ms})
    return {
        "segmentId": segment_id,
        "durationMs": metadata["duration_ms"],
        "sizeBytes": size,
        "profile": profile(context.config, mode),
    }, finalize
