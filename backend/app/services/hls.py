"""Worker-produced immutable H.264 fragments; APIs never transcode on request."""

import hashlib
import math
import os
import re
import shutil
import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.time import utc_now_ms
from app.db.models import Artifact, RuntimeLease, Task, TaskAttempt
from app.db.transactions import write_session
from app.services import media
from app.services.maintenance import evict_playback

CHUNK_MS = 4000
ACTIVE = ("queued", "running", "cancelling")


def start_offset(segment, start_ms):
    if not 0 <= start_ms < segment.duration_ms:
        raise AppError("INVALID_PLAYBACK_POSITION", "播放位置超出录像范围。", 422)
    return start_ms // CHUNK_MS * CHUNK_MS


def profile(config, start_ms):
    return hashlib.sha256(
        f"hls-h264-aac-ultrafast-v1:{config.playback_max_width}:{start_ms}".encode()
    ).hexdigest()


def checkpoint(session, task):
    if task.status == "completed":
        return task.result_json or {}
    for row in session.scalars(
        select(TaskAttempt)
        .where(TaskAttempt.task_id == task.id)
        .order_by(TaskAttempt.attempt_no.desc())
    ):
        if row.checkpoint_json and "hlsChunks" in row.checkpoint_json:
            return row.checkpoint_json
    return {}


def chunk_path(session, config, segment, task, item):
    row = session.get(Artifact, item["id"])
    if (
        not row
        or row.task_id != task.id
        or row.segment_id != segment.id
        or row.kind != "playback"
        or row.status != "ready"
        or row.input_fingerprint != segment.fingerprint
        or not row.profile_hash.startswith("hls:" + task.payload_json["profile"] + ":")
    ):
        raise AppError("PLAYBACK_CACHE_LOST", "播放分片已失效，请重新连接播放。", 410)
    path = config.data / row.relative_path
    if (
        path.is_symlink()
        or not path.resolve().is_relative_to(config.data / "playback-proxies")
        or not path.is_file()
        or path.stat().st_size != row.size_bytes
    ):
        raise AppError("PLAYBACK_CACHE_LOST", "播放分片已失效，请重新连接播放。", 410)
    return row, path


def get_task(session, config, segment, task_id):
    from app.services.playback import original_path

    original_path(session, config, segment)
    task = session.get(Task, task_id)
    if (
        not task
        or task.kind != "prepare"
        or task.payload_json.get("mode") != "stream"
        or task.payload_json.get("segmentId") != segment.id
    ):
        raise AppError("TASK_NOT_FOUND", "播放任务不存在。", 404)
    if task.payload_json.get("fingerprint") != segment.fingerprint:
        raise AppError("RECORDING_CHANGED", "录像已变化，请重新加载。", 409)
    if task.status in ("failed", "cancelled", "cancelling"):
        raise AppError(
            "PLAYBACK_STOPPED", task.error_message or "播放准备已停止，请重新连接。", 410
        )
    return task


def state(session, config, segment, start_ms):
    start_ms = start_offset(segment, start_ms)
    output_profile = profile(config, start_ms)
    # The unique active key avoids scanning task history on every player poll.
    task = session.scalar(
        select(Task).where(
            Task.active_key == f"prepare:{segment.id}:{segment.fingerprint}:{output_profile}"
        )
    )
    if task is None:
        task = session.scalar(
            select(Task)
            .where(
                Task.kind == "prepare",
                Task.payload_json["segmentId"].as_string() == segment.id,
                Task.payload_json["fingerprint"].as_string() == segment.fingerprint,
                Task.payload_json["profile"].as_string() == output_profile,
            )
            .order_by(Task.created_at.desc(), Task.id.desc())
            .limit(1)
        )
    result = {
        "status": "needs_prepare",
        "mediaUrl": None,
        "proxy": True,
        "format": "hls",
        "mode": "stream",
        "startMs": start_ms,
        "taskId": None,
    }
    if not task:
        return result
    data = checkpoint(session, task)
    chunks = data.get("hlsChunks", [])
    if chunks and task.status in (*ACTIVE, "completed") and task.status != "cancelling":
        try:
            check = chunks if task.status == "completed" else chunks[-1:]
            # Keep strong references so Session.get reuses the identity map.
            artifacts = list(
                session.scalars(
                    select(Artifact).where(Artifact.id.in_([item["id"] for item in check]))
                )
            )
            if len(artifacts) != len(check):
                raise AppError("PLAYBACK_CACHE_LOST", "播放分片已失效。", 410)
            for item in check:
                chunk_path(session, config, segment, task, item)
        except AppError:
            if task.status == "completed":
                return result
            return result | {
                "status": "failed",
                "taskId": task.id,
                "errorMessage": "播放分片丢失，请重新连接。",
            }
        return result | {
            "status": "ready" if task.status == "completed" else "streaming",
            "taskId": task.id,
            "mediaUrl": (
                f"/api/segments/{segment.id}/hls/{task.id}/index.m3u8"
                f"?fingerprint={segment.fingerprint}"
            ),
            "availableMs": sum(item["durationMs"] for item in chunks),
            "progress": task.progress,
        }
    return result | {
        "status": "preparing"
        if task.status in ACTIVE
        else task.status
        if task.status in ("failed", "cancelled")
        else "needs_prepare",
        "taskId": task.id if task.status != "completed" else None,
        "progress": task.progress,
        "errorMessage": task.error_message,
    }


def playlist(session, config, segment, task_id):
    task = get_task(session, config, segment, task_id)
    chunks = checkpoint(session, task).get("hlsChunks", [])
    if not chunks:
        raise AppError("PLAYBACK_NOT_READY", "首个分片仍在准备，请稍候。", 503)
    target = math.ceil((CHUNK_MS + 1000) / 1000)
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        f"#EXT-X-TARGETDURATION:{target}",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:EVENT",
        "#EXT-X-INDEPENDENT-SEGMENTS",
    ]
    # Fragments are checked individually when served; do not stat an ever-growing
    # prefix on every playlist reload. The publishing transaction is the boundary.
    for item in chunks:
        if item.get("discontinuity"):
            lines.append("#EXT-X-DISCONTINUITY")
        lines.extend(
            [
                f"#EXTINF:{item['durationMs'] / 1000:.6f},",
                f"/api/segments/{segment.id}/hls/{task.id}/{item['id']}.ts?fingerprint={segment.fingerprint}",
            ]
        )
    if task.status == "completed":
        lines.append("#EXT-X-ENDLIST")
    return "\n".join(lines) + "\n"


def lease(session, config, segment, task_id, client_id, active):
    key = f"hls:{task_id}:{client_id}"
    row = session.get(RuntimeLease, key)
    if not active:
        if row:
            session.delete(row)
        return {"leased": False}
    get_task(session, config, segment, task_id)
    if row is None:
        row = RuntimeLease(resource_key=key, owner="browser", token=client_id, expires_at=0)
        session.add(row)
    seconds = min(20, config.usage_lease_seconds)
    row.expires_at = utc_now_ms() + seconds * 1000
    return {"leased": True, "expiresInSeconds": seconds}


def parse_index(path):
    """Only complete files named in the atomically updated FFmpeg playlist are visible."""
    items, duration = [], None
    if not path.is_file():
        return items
    text = path.read_text()
    if len(text) > 2 * 1024 * 1024:
        raise AppError("PLAYBACK_TOO_LONG", "录像过长，请选择更靠后的播放位置。")
    for line in text.splitlines():
        if line.startswith("#EXTINF:"):
            duration = round(float(line.split(":")[1].split(",")[0]) * 1000)
        elif line and not line.startswith("#"):
            if (
                duration is None
                or not re.fullmatch(r"chunk-\d{6}\.ts", line)
                or not 0 < duration <= CHUNK_MS + 1000
            ):
                raise AppError("INVALID_PLAYBACK_OUTPUT", "播放分片索引校验失败。")
            items.append((line, duration))
            duration = None
    return items


def prepare(context):
    from app.services.playback import get_segment, original_path
    from app.tasks.queue import cancel

    config, claim = context.config, context.claim
    with Session(context.queue.engine) as session:
        segment = get_segment(session, claim.payload["segmentId"])
        path = original_path(session, config, segment)
        start_ms = start_offset(segment, claim.payload.get("startMs", 0))
        output_profile = profile(config, start_ms)
        if (
            segment.fingerprint != claim.payload["fingerprint"]
            or output_profile != claim.payload["profile"]
        ):
            raise AppError("RECORDING_CHANGED", "录像或播放规格已变化。", 409)
        task = session.get(Task, claim.task_id)
        data = checkpoint(session, task)
        chunks = list(data.get("hlsChunks", []))
        for item in chunks:
            chunk_path(session, config, segment, task, item)
        duration_ms, fingerprint, segment_id = segment.duration_ms, segment.fingerprint, segment.id
    if not config.playback_cache_max_bytes:
        raise AppError("PLAYBACK_CACHE_FULL", "播放缓存已禁用。", 409)
    directory = config.data / "tmp" / claim.task_id / claim.token
    directory.mkdir(parents=True, exist_ok=True)
    resumed = bool(chunks)
    completed_ms = sum(item["durationMs"] for item in chunks)
    resume_ms = start_ms + completed_ms
    processed_files, last_poll, saw_viewer = set(), 0, False
    started = time.monotonic()

    def progress(final=False):
        nonlocal last_poll, saw_viewer
        if not final and time.monotonic() - last_poll < 0.25:
            return
        last_poll = time.monotonic()
        context.check()
        with Session(context.queue.engine) as session:
            viewers = (
                session.scalar(
                    select(RuntimeLease.resource_key)
                    .where(
                        RuntimeLease.resource_key.startswith(f"hls:{claim.task_id}:"),
                        RuntimeLease.expires_at > utc_now_ms(),
                    )
                    .limit(1)
                )
                is not None
            )
        saw_viewer |= viewers
        if (
            not claim.payload.get("background")
            and not viewers
            and (saw_viewer or time.monotonic() - started > 20)
        ):
            cancel(context.queue.engine, claim.task_id)
            context.check()
        for name, length in parse_index(directory / "index.m3u8"):
            if name in processed_files:
                continue
            source = directory / name
            if not source.is_file() or source.is_symlink() or source.stat().st_size <= 0:
                raise AppError("INVALID_PLAYBACK_OUTPUT", "播放分片尚未完整写入。")
            # Probe complete immutable fragments, never an in-progress .tmp file.
            metadata = media.probe(source, context)
            if (
                metadata["video_codec"] != "h264"
                or metadata["audio_codec"] not in (None, "aac")
                or abs(metadata["duration_ms"] - length) > 1000
            ):
                raise AppError("INVALID_PLAYBACK_OUTPUT", "播放分片编码或时长校验失败。")
            size = source.stat().st_size
            if shutil.disk_usage(config.data).free < size + 64 * 1024**2:
                raise AppError("INSUFFICIENT_STORAGE", "播放缓存空间不足。", 409)
            index = len(chunks)
            identity = hashlib.sha256(
                f"{output_profile}:{claim.task_id}:{index}".encode()
            ).hexdigest()
            destination = (
                config.data / "playback-proxies" / f"{segment_id}-{fingerprint}-{identity[:16]}.ts"
            )
            with write_session(context.queue.engine) as session:
                task = context.queue.owned(session, claim)
                row = get_segment(session, segment_id)
                if row.fingerprint != fingerprint:
                    raise AppError("RECORDING_CHANGED", "录像已变化，播放分片未发布。", 409)
                original_path(session, config, row)
                evict_playback(
                    session, config, size, destination.relative_to(config.data).as_posix()
                )
                artifact = Artifact(
                    kind="playback",
                    task_id=claim.task_id,
                    segment_id=segment_id,
                    relative_path=destination.relative_to(config.data).as_posix(),
                    profile_hash=f"hls:{output_profile}:{index}",
                    input_fingerprint=fingerprint,
                    size_bytes=size,
                    duration_ms=length,
                    last_access_at=utc_now_ms(),
                )
                os.replace(source, destination)
                session.add(artifact)
                session.flush()
                chunks.append(
                    {
                        "id": artifact.id,
                        "durationMs": length,
                        "discontinuity": resumed and name == "chunk-000000.ts",
                    }
                )
                task.stage, task.progress = (
                    "transcode",
                    min(
                        99,
                        round(
                            sum(item["durationMs"] for item in chunks)
                            / max(1, duration_ms - start_ms)
                            * 100
                        ),
                    ),
                )
                attempt = session.scalar(
                    select(TaskAttempt).where(
                        TaskAttempt.task_id == task.id, TaskAttempt.lease_token == claim.token
                    )
                )
                attempt.checkpoint_json = {
                    "hlsChunks": list(chunks),
                    "startMs": start_ms,
                    "outTimeMs": sum(item["durationMs"] for item in chunks),
                }
            processed_files.add(name)

    with context.media_slot():
        context.update(
            "transcode",
            min(99, round(completed_ms / max(1, duration_ms - start_ms) * 100)),
            {"hlsChunks": chunks, "startMs": start_ms, "outTimeMs": completed_ms},
        )
        if resume_ms < duration_ms - 50:
            media.make_hls(path, resume_ms, duration_ms - resume_ms, directory, context, progress)
            progress(final=True)
    actual = sum(item["durationMs"] for item in chunks)
    if not chunks or abs(actual - (duration_ms - start_ms)) > max(
        1000, (duration_ms - start_ms) * 0.01
    ):
        raise AppError("INVALID_PLAYBACK_OUTPUT", "播放分片总时长校验失败。")
    result = {
        "segmentId": segment_id,
        "startMs": start_ms,
        "durationMs": actual,
        "hlsChunks": chunks,
        "profile": output_profile,
        "sizeBytes": 0,
    }

    def finalize(session):
        row = get_segment(session, segment_id)
        if row.fingerprint != fingerprint:
            raise AppError("RECORDING_CHANGED", "录像已变化，播放结果未发布。", 409)
        original_path(session, config, row)
        for item in chunks:
            chunk_path(session, config, row, session.get(Task, claim.task_id), item)

    with Session(context.queue.engine) as session:
        result["sizeBytes"] = sum(session.get(Artifact, item["id"]).size_bytes for item in chunks)
    return result, finalize
