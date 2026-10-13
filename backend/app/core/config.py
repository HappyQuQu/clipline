from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppConfig(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CLIPLINE_", extra="ignore")

    data: Path = Path("./data")
    db: Path | None = None
    recordings_root: Path = Path("/recordings")
    static_dir: Path = Path("../frontend/dist")
    timezone: str = "Asia/Shanghai"
    port: int = Field(default=8080, ge=1, le=65535)
    media_threads: int = Field(default=2, ge=1, le=16)
    max_concurrent_transcodes: int = Field(default=1, ge=1, le=3)
    export_ttl_hours: int = Field(default=24, ge=1)
    log_retention_days: int = Field(default=30, ge=1)
    playback_cache_max_bytes: int = Field(default=2 * 1024**3, ge=0)
    heartbeat_interval_seconds: float = Field(default=5, gt=0)
    worker_lease_seconds: float = Field(default=30, gt=0)
    shutdown_grace_seconds: float = Field(default=10, gt=0)
    worker_poll_seconds: float = Field(default=0.2, ge=0.05, le=5)
    scheduler_interval_seconds: float = Field(default=5, ge=0.1)
    max_task_recoveries: int = Field(default=3, ge=1, le=10)
    probe_timeout_seconds: float = Field(default=30, gt=0)
    thumbnail_timeout_seconds: float = Field(default=30, gt=0)
    playback_max_width: int = Field(default=1920, ge=320, le=1920)
    export_fps: int = Field(default=25, ge=1, le=60)
    export_max_width: int = Field(default=3840, ge=320, le=7680)
    export_max_pieces: int = Field(default=500, ge=1, le=500)
    export_timeout_seconds: float = Field(default=3600, gt=0)
    playback_timeout_seconds: float = Field(default=3600, gt=0)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as error:
            raise ValueError("Unknown recording timezone") from error
        return value

    @model_validator(mode="after")
    def validate_layout(self):
        self.data = self.data.expanduser().resolve()
        self.recordings_root = self.recordings_root.expanduser().resolve()
        self.static_dir = self.static_dir.expanduser().resolve()
        self.db = (self.db or self.data / "clipline.db").expanduser().resolve()
        if not self.db.is_relative_to(self.data):
            raise ValueError("Database must be inside the writable data directory")
        if self.recordings_root == Path("/"):
            raise ValueError("The container filesystem root cannot be a recording root")
        if self.data.is_relative_to(self.recordings_root) or self.recordings_root.is_relative_to(
            self.data
        ):
            raise ValueError("Recording and writable data directories must be separate")
        if self.worker_lease_seconds <= self.heartbeat_interval_seconds * 2:
            raise ValueError("Worker lease must exceed two heartbeat intervals")
        return self
