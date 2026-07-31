from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi import Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.core.logging import RequestLoggingMiddleware, get_logger, setup_logging
from app.api import router as api_router
from app.db import init_db
from app.services.model_cache import configure_model_cache_env
from app.services.scheduler import export_cleanup_loop, scheduled_scan_loop
from app.services.transcription import resume_pending_transcription_jobs, set_max_concurrent_transcriptions
from app.services.vision import resume_pending_vision_jobs, set_max_concurrent_vision_jobs

setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_model_cache_env()
    init_db()

    # 初始化 ASR 并发控制
    from app.core.settings_store import get_effective
    max_concurrent = int(get_effective("asr_max_concurrent", 1))
    set_max_concurrent_transcriptions(max_concurrent)
    logger.info(f"ASR max concurrent transcriptions: {max_concurrent}")
    restored_transcriptions = resume_pending_transcription_jobs()
    if restored_transcriptions:
        logger.info("restored pending ASR jobs: %d", restored_transcriptions)
    max_vision_concurrent = int(get_effective("vision_max_concurrent", 1))
    set_max_concurrent_vision_jobs(max_vision_concurrent)
    logger.info(f"Vision max concurrent jobs: {max_vision_concurrent}")
    restored_vision_jobs = resume_pending_vision_jobs()
    if restored_vision_jobs:
        logger.info("restored pending vision jobs: %d", restored_vision_jobs)

    stop_event = asyncio.Event()
    scheduler_task = asyncio.create_task(scheduled_scan_loop(stop_event))
    cleanup_task = asyncio.create_task(export_cleanup_loop(stop_event))
    logger.info(
        "clipline backend started",
        extra={
            "data_path": str(settings.data_path),
            "db_path": str(settings.db_path),
            "recordings_root": str(settings.recordings_root_path),
            "log_file": str(settings.resolved_log_file),
            "models_path": str(settings.models_path),
        },
    )
    try:
        yield
    finally:
        stop_event.set()
        scheduler_task.cancel()
        cleanup_task.cancel()
        try:
            await scheduler_task
        except asyncio.CancelledError:
            pass
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass
    logger.info("clipline backend stopped")


app = FastAPI(title="Clipline API", version="0.1.0", lifespan=lifespan)
app.add_middleware(RequestLoggingMiddleware)
app.include_router(api_router)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


static_dir = Path("/app/static")
if static_dir.exists():
    assets_dir = static_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/")
    def frontend_index():
        return FileResponse(
            static_dir / "index.html",
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )

    @app.get("/favicon.ico")
    def favicon():
        return Response(status_code=204)
