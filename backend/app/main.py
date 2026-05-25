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
from app.services.scheduler import scheduled_scan_loop

setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_db()
    stop_event = asyncio.Event()
    scheduler_task = asyncio.create_task(scheduled_scan_loop(stop_event))
    logger.info(
        "clipline backend started",
        extra={
            "data_path": str(settings.data_path),
            "db_path": str(settings.db_path),
            "recordings_root": str(settings.recordings_root_path),
            "log_file": str(settings.resolved_log_file),
        },
    )
    try:
        yield
    finally:
        stop_event.set()
        scheduler_task.cancel()
        try:
            await scheduler_task
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
