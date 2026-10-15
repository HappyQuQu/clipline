from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, ValidationError
from sqlalchemy import select

from app.core.errors import AppError
from app.core.time import utc_now_ms
from app.db.models import SavedSettings
from app.db.transactions import write_session
from app.services.events import emit

DEFAULTS = {
    "scan": {"interval": 5, "skipRecent": 30},
    "playback": {"autoNext": True, "skipGaps": True},
    "export": {"defaultMode": "fast", "maxDuration": 10080},
    "tasks": {"concurrency": 2},
}


class Values(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Scan(Values):
    interval: StrictInt | None
    skipRecent: StrictInt = Field(ge=0, le=3600)


class Playback(Values):
    autoNext: StrictBool
    skipGaps: StrictBool


class Export(Values):
    defaultMode: Literal["fast", "precise"]
    maxDuration: StrictInt


class Tasks(Values):
    concurrency: StrictInt = Field(ge=1, le=3)


VALIDATORS = {"scan": Scan, "playback": Playback, "export": Export, "tasks": Tasks}


def group_dto(row):
    return {
        "values": DEFAULTS[row.group_name]
        | {key: value for key, value in row.value_json.items() if key in DEFAULTS[row.group_name]},
        "revision": row.revision,
    }


def read_settings(session, config):
    return {
        "groups": {
            row.group_name: group_dto(row)
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
            "maintenanceIntervalSeconds": config.maintenance_interval_seconds,
            "exportFps": config.export_fps,
            "exportMaxWidth": config.export_max_width,
        },
    }


def save_settings(engine, group, body):
    if group not in DEFAULTS:
        raise AppError("SETTINGS_READ_ONLY", "此分类为只读部署信息或二期占位。", 409)
    try:
        values = VALIDATORS[group].model_validate(body.values).model_dump()
        if group == "scan" and values["interval"] not in (5, 10, 30, None):
            raise ValueError()
        if group == "export" and values["maxDuration"] not in (10, 30, 60, 360, 1440, 4320, 10080):
            raise ValueError()
    except (ValidationError, ValueError) as error:
        raise AppError("INVALID_SETTINGS", "设置字段或数值不符合该分类的允许范围。") from error
    with write_session(engine) as session:
        row = session.get(SavedSettings, group)
        if row.revision != body.revision:
            raise AppError(
                "SETTINGS_CONFLICT",
                "此分类已在其他页面修改，请核对最新配置后再保存。",
                409,
                {"current": group_dto(row)},
            )
        if row.value_json != values:
            previous = dict(row.value_json)
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
        return group_dto(row)
