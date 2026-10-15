from datetime import date as Date
from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
PathValue = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4096)]
RequestKey = Annotated[
    str, StringConstraints(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_.:-]+$")
]


class APIModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class SourceCreate(APIModel):
    name: Name
    path: PathValue
    scan_interval_minutes: Literal[5, 10, 30] | None = None
    scan_on_create: StrictBool = True
    allow_overlap: StrictBool = False
    auto_transcribe: Literal[False] = False
    auto_detect: Literal[False] = False

    @field_validator("name")
    @classmethod
    def plain_name(cls, value):
        if any(ord(char) < 32 for char in value):
            raise ValueError("Name cannot contain control characters")
        return value


class SourcePatch(APIModel):
    name: Name | None = None
    path: PathValue | None = None
    enabled: StrictBool | None = None
    scan_interval_minutes: Literal[5, 10, 30] | None = None
    revision: Annotated[StrictInt, Field(ge=1)] | None = None
    allow_overlap: StrictBool = False
    auto_transcribe: Literal[False] = False
    auto_detect: Literal[False] = False

    @model_validator(mode="after")
    def no_null_required_fields(self):
        for name in ("name", "path", "enabled", "revision"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        if self.name is not None and any(ord(char) < 32 for char in self.name):
            raise ValueError("Name cannot contain control characters")
        return self


class TaskCreate(APIModel):
    kind: Literal["scan", "reindex", "prepare"]
    source_id: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    payload: dict = Field(default_factory=dict)

    @field_validator("payload")
    @classmethod
    def no_client_scan_options(cls, value):
        if value:
            raise ValueError("Custom task options are not supported in this milestone")
        return value


PlaybackMode = Literal["compatible", "hevc", "original", "stream"]


class PrepareRequest(APIModel):
    force: StrictBool = False
    mode: PlaybackMode = "compatible"
    start_ms: StrictInt = Field(default=0, ge=0, le=31536000000)


class ExportRequest(APIModel):
    plan_hash: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")] | None = None
    source_id: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    start_at: datetime
    end_at: datetime
    date: Date | None = None
    view_timezone: Annotated[str, StringConstraints(min_length=1, max_length=80)] | None = None
    mode: Literal["fast", "precise"] = "fast"
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)] = (
        "Clipline录像"
    )
    segment_ids: list[Annotated[str, StringConstraints(min_length=1, max_length=80)]] | None = (
        Field(None, max_length=500)
    )

    @field_validator("name")
    @classmethod
    def valid_export_name(cls, value):
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("File name cannot contain control characters")
        return value


class RetryRequest(APIModel):
    mode: Literal["fast", "precise"] | None = None


class SettingsPatch(APIModel):
    revision: StrictInt = Field(ge=1)
    values: dict


class PlaybackLeaseRequest(APIModel):
    client_id: Annotated[str, StringConstraints(pattern=r"^[a-f0-9-]{36}$")]
    active: StrictBool = True
