from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.core.logging import RequestLoggingMiddleware, get_logger, setup_logging
from app.api import router as api_router
from app.db import init_db

setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_db()
    logger.info(
        "clipline backend started",
        extra={
            "data_path": str(settings.data_path),
            "db_path": str(settings.db_path),
            "recordings_root": str(settings.recordings_root_path),
            "log_file": str(settings.resolved_log_file),
        },
    )
    yield
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
        return FileResponse(static_dir / "index.html")
