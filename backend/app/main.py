import logging
import re
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from app import __version__
from app.api.foundation import router
from app.api.indexing import router as indexing_router
from app.api.playback import router as playback_router
from app.core.config import AppConfig
from app.core.errors import AppError
from app.db.migrations import require_current_schema
from app.db.session import make_engine
from app.services.directories import RecordingDirectories

logger = logging.getLogger(__name__)


def error_response(request: Request, code: str, message: str, status: int, details=None):
    request_id = getattr(request.state, "request_id", str(uuid4()))
    return JSONResponse(
        {
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
                "requestId": request_id,
            }
        },
        status_code=status,
        headers={"X-Request-ID": request_id},
    )


def create_app(config: AppConfig | None = None) -> FastAPI:
    config = config or AppConfig()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = make_engine(config)
        try:
            require_current_schema(engine)
            app.state.engine = engine
            yield
        finally:
            engine.dispose()

    app = FastAPI(title="Clipline API", version=__version__, lifespan=lifespan)
    app.state.config = config
    app.state.directories = RecordingDirectories(config.recordings_root)

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        provided = request.headers.get("X-Request-ID", "")
        request.state.request_id = (
            provided if re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", provided) else str(uuid4())
        )
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("Unhandled API error; requestId=%s", request.state.request_id)
            response = error_response(request, "INTERNAL_ERROR", "服务暂时无法完成请求。", 500)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    @app.exception_handler(AppError)
    async def domain_error(request: Request, error: AppError):
        return error_response(request, error.code, error.message, error.status, error.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError):
        fields = [
            {"field": ".".join(map(str, item["loc"])), "code": item["type"]}
            for item in error.errors()
        ]
        return error_response(
            request, "VALIDATION_ERROR", "请求参数格式不正确。", 422, {"fields": fields}
        )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException):
        return error_response(
            request, f"HTTP_{error.status_code}", "请求的资源不可用。", error.status_code
        )

    app.include_router(router)
    app.include_router(indexing_router)
    app.include_router(playback_router)
    if (config.static_dir / "index.html").is_file():
        app.mount("/", StaticFiles(directory=config.static_dir, html=True), name="frontend")
    return app


app = create_app()
