from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CLIPLINE_", extra="ignore")

    port: int = 8080
    db: str = "/app/data/clipline.db"
    data: str = "/app/data"
    recordings_root: str = "/"
    recordings_roots: str | None = None
    scan_interval_seconds: int = 300
    export_ttl_hours: int = 24
    max_export_minutes: int = 30
    max_concurrent_exports: int = 1
    thumbnail_mode: str = "middle"
    timezone: str = "Asia/Shanghai"
    skip_recent_seconds: int = 30
    log_level: str = "INFO"
    log_format: str = "text"
    log_file: str | None = None

    @property
    def data_path(self) -> Path:
        return Path(self.data)

    @property
    def db_path(self) -> Path:
        return Path(self.db)

    @property
    def recordings_root_path(self) -> Path:
        return Path(self.recordings_root)

    @property
    def recordings_root_paths(self) -> list[Path]:
        raw = self.recordings_roots or self.recordings_root
        roots = [value.strip() for value in raw.split(",") if value.strip()]
        return [Path(value) for value in roots] or [self.recordings_root_path]

    @property
    def exports_path(self) -> Path:
        return self.data_path / "exports"

    @property
    def tmp_path(self) -> Path:
        return self.data_path / "tmp"

    @property
    def thumbnails_path(self) -> Path:
        return self.data_path / "thumbnails"

    @property
    def logs_path(self) -> Path:
        return self.data_path / "logs"

    @property
    def resolved_log_file(self) -> Path:
        return Path(self.log_file) if self.log_file else self.logs_path / "clipline.log"


@lru_cache
def get_settings() -> Settings:
    return Settings()
