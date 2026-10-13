import os
import platform
import shutil

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app import __version__
from app.core.time import iso_utc, utc_now_ms
from app.db.migrations import current_revision, expected_revision
from app.db.models import RuntimeLease, SavedSettings, Task

router = APIRouter(prefix="/api")


def readiness(request: Request) -> dict:
    config, engine = request.app.state.config, request.app.state.engine
    try:
        revision = current_revision(engine)
        with Session(engine) as session:
            session.execute(text("SELECT 1"))
            lease = session.get(RuntimeLease, "coordinator")
            worker_ready = lease is not None and lease.expires_at > utc_now_ms()
            last_heartbeat = (
                iso_utc(lease.expires_at - int(config.worker_lease_seconds * 1000))
                if lease
                else None
            )
        db_ready = revision == expected_revision()
    except Exception:
        db_ready, worker_ready, last_heartbeat = False, False, None
    data_ready = os.access(config.data, os.R_OK | os.W_OK | os.X_OK)
    return {
        "ready": db_ready and worker_ready and data_ready,
        "database": {"ready": db_ready},
        "worker": {"ready": worker_ready, "lastHeartbeatAt": last_heartbeat, "mode": "playback"},
        "storage": {"ready": data_ready},
    }


@router.get("/health/live")
def live():
    return {"alive": True, "version": __version__}


@router.get("/health/ready")
def ready(request: Request):
    state = readiness(request)
    return JSONResponse(state, status_code=200 if state["ready"] else 503)


@router.get("/capabilities")
def capabilities():
    return {
        "backendStage": "playback",
        "recordingDirectories": True,
        "scan": True,
        "export": False,
        "reindex": True,
        "prepare": True,
        "playback": True,
        "transcription": False,
        "visualRecognition": False,
        "semanticSearch": False,
        "supportedExportModes": ["fast", "precise"],
        "arch": platform.machine(),
    }


@router.get("/recording-directories")
def directories(
    request: Request,
    rootId: str = "default",
    relativePath: str = Query(default="", max_length=4096),
    cursor: str | None = Query(default=None, max_length=2048),
    limit: int = Query(default=50, ge=1, le=200),
):
    return request.app.state.directories.browse(rootId, relativePath, cursor, limit)


@router.get("/settings")
def settings(request: Request):
    with Session(request.app.state.engine) as session:
        groups = {
            row.group_name: {"values": row.value_json, "revision": row.revision}
            for row in session.scalars(select(SavedSettings))
        }
    config = request.app.state.config
    return {
        "groups": groups,
        "deployment": {
            "timezone": config.timezone,
            "recordingsRoot": str(config.recordings_root),
            "dataPath": str(config.data),
            "maxConcurrentTranscodes": config.max_concurrent_transcodes,
            "mediaThreads": config.media_threads,
        },
    }


@router.get("/system/status")
def system_status(request: Request):
    config = request.app.state.config
    disk = shutil.disk_usage(config.data)
    with Session(request.app.state.engine) as session:
        counts = dict(
            session.execute(select(Task.status, func.count()).group_by(Task.status)).all()
        )
    return {
        "version": __version__,
        "arch": platform.machine(),
        "backendStage": "playback",
        "health": readiness(request),
        "queue": {"executionEnabled": True, "counts": counts},
        "storage": {"totalBytes": disk.total, "freeBytes": disk.free},
        "media": {"ffmpeg": bool(shutil.which("ffmpeg")), "ffprobe": bool(shutil.which("ffprobe"))},
    }
