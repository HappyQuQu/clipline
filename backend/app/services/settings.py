from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    ValidationError,
    field_validator,
)
from sqlalchemy import select

from app.core.errors import AppError
from app.core.time import utc_now_ms
from app.db.models import SavedSettings
from app.db.transactions import write_session
from app.services.events import emit

DEFAULTS = {
    "general": {
        "theme": "system",
        "timezone": "Asia/Shanghai",
        "logRetentionDays": 30,
        "playbackCacheMaxBytes": 2 * 1024**3,
    },
    "scan": {"interval": 5, "skipRecent": 30},
    "playback": {"autoNext": True, "skipGaps": True, "playbackMaxWidth": 1920},
    "export": {
        "defaultMode": "fast",
        "maxDuration": 10080,
        "exportMaxWidth": 3840,
        "exportTtlHours": 24,
    },
    "tasks": {"concurrency": 2, "mediaThreads": 2, "maxConcurrentTranscodes": 1},
}
RUNTIME_FIELDS = {
    "timezone": "timezone",
    "mediaThreads": "media_threads",
    "maxConcurrentTranscodes": "max_concurrent_transcodes",
    "playbackMaxWidth": "playback_max_width",
    "exportMaxWidth": "export_max_width",
    "exportTtlHours": "export_ttl_hours",
    "playbackCacheMaxBytes": "playback_cache_max_bytes",
    "logRetentionDays": "log_retention_days",
}


class Values(BaseModel):
    model_config = ConfigDict(extra="forbid")


class General(Values):
    theme: Literal["light", "dark", "system"]
    timezone: str = Field(strict=True, min_length=1, max_length=100)
    logRetentionDays: StrictInt = Field(ge=1, le=3650)
    playbackCacheMaxBytes: StrictInt = Field(ge=0, le=1024**4)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ValueError, ZoneInfoNotFoundError) as error:
            raise ValueError("Unknown timezone") from error
        return value


class Scan(Values):
    interval: StrictInt | None
    skipRecent: StrictInt = Field(ge=0, le=3600)


class Playback(Values):
    autoNext: StrictBool
    skipGaps: StrictBool
    playbackMaxWidth: StrictInt = Field(ge=320, le=1920)

    @field_validator("playbackMaxWidth")
    @classmethod
    def even_width(cls, value):
        if value % 2:
            raise ValueError("Width must be even")
        return value


class Export(Values):
    defaultMode: Literal["fast", "precise"]
    maxDuration: StrictInt
    exportMaxWidth: StrictInt = Field(ge=320, le=7680)
    exportTtlHours: StrictInt = Field(ge=1, le=87600)
    even_width = field_validator("exportMaxWidth")(Playback.even_width.__func__)


class Tasks(Values):
    concurrency: StrictInt = Field(ge=1, le=3)
    mediaThreads: StrictInt = Field(ge=1, le=16)
    maxConcurrentTranscodes: StrictInt = Field(ge=1, le=3)


VALIDATORS = {
    "general": General,
    "scan": Scan,
    "playback": Playback,
    "export": Export,
    "tasks": Tasks,
}


def initial_values(group):
    # Unset runtime fields inherit legacy environment values until saved in the UI.
    return {key: value for key, value in DEFAULTS[group].items() if key not in RUNTIME_FIELDS}


def effective_config(session, config):
    updates = {}
    for row in session.scalars(select(SavedSettings).where(SavedSettings.group_name.in_(DEFAULTS))):
        for key in DEFAULTS[row.group_name]:
            if key in RUNTIME_FIELDS and key in row.value_json:
                updates[RUNTIME_FIELDS[key]] = row.value_json[key]
    return config.model_copy(update=updates)


def group_dto(row, config=None):
    defaults = dict(DEFAULTS[row.group_name])
    if config is not None:
        defaults.update(
            {key: getattr(config, RUNTIME_FIELDS[key]) for key in defaults if key in RUNTIME_FIELDS}
        )
    return {
        "values": defaults
        | {key: value for key, value in row.value_json.items() if key in defaults},
        "revision": row.revision,
    }


def read_settings(session, config):
    config = effective_config(session, config)
    return {
        "groups": {
            row.group_name: group_dto(row, config)
            for row in session.scalars(select(SavedSettings))
            if row.group_name in DEFAULTS
        },
        "defaults": DEFAULTS,
        "deployment": {
            "timezone": config.timezone,
            "recordingsRoot": str(config.recordings_root),
            "dataPath": str(config.data),
            "maxConcurrentTranscodes": config.max_concurrent_transcodes,
            "mediaThreads": config.media_threads,
            "exportTtlHours": config.export_ttl_hours,
            "logRetentionDays": config.log_retention_days,
            "playbackCacheMaxBytes": config.playback_cache_max_bytes,
            "playbackMaxWidth": config.playback_max_width,
            "maintenanceIntervalSeconds": config.maintenance_interval_seconds,
            "exportFps": config.export_fps,
            "exportMaxWidth": config.export_max_width,
        },
    }


def save_settings(engine, group, body, config=None):
    if group not in DEFAULTS:
        raise AppError("SETTINGS_READ_ONLY", "此分类为只读部署信息或二期占位。", 409)
    with write_session(engine) as session:
        row = session.get(SavedSettings, group)
        current = group_dto(row, config)
        try:
            values = VALIDATORS[group].model_validate(current["values"] | body.values).model_dump()
            if group == "scan" and values["interval"] not in (5, 10, 30, None):
                raise ValueError()
            if group == "export" and values["maxDuration"] not in (
                10,
                30,
                60,
                360,
                1440,
                4320,
                10080,
            ):
                raise ValueError()
        except (ValidationError, ValueError) as error:
            raise AppError("INVALID_SETTINGS", "设置字段或数值不符合该分类的允许范围。") from error
        if row.revision != body.revision:
            raise AppError(
                "SETTINGS_CONFLICT",
                "此分类已在其他页面修改，请核对最新配置后再保存。",
                409,
                {"current": current},
            )
        if current["values"] != values:
            previous = current["values"]
            row.value_json = values
            row.revision += 1
            row.updated_at = utc_now_ms()
            emit(
                session,
                kind="settings",
                code="SETTINGS_UPDATED",
                title="设置分类已保存",
                detail={
                    "group": group,
                    "revision": row.revision,
                    "previous": previous,
                    "values": values,
                },
            )
        elif row.value_json != values:
            # Explicitly saving inherited defaults pins them independently of Docker overrides.
            row.value_json = values
            row.revision += 1
            row.updated_at = utc_now_ms()
        return group_dto(row, config)
