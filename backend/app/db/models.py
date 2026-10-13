from uuid import uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.time import utc_now_ms


def new_id() -> str:
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class Entity:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)


class Timestamped:
    created_at: Mapped[int] = mapped_column(BigInteger, default=utc_now_ms)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=utc_now_ms, onupdate=utc_now_ms)


class Source(Entity, Timestamped, Base):
    __tablename__ = "sources"
    __table_args__ = (
        CheckConstraint("scan_interval_minutes IS NULL OR scan_interval_minutes IN (5, 10, 30)"),
    )

    name: Mapped[str] = mapped_column(String(120))
    canonical_path: Mapped[str] = mapped_column(String, unique=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    scan_interval_minutes: Mapped[int | None] = mapped_column(Integer().evaluates_none(), default=5)
    recording_timezone: Mapped[str] = mapped_column(String(80), default="Asia/Shanghai")
    auto_transcribe: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_detect: Mapped[bool] = mapped_column(Boolean, default=False)
    last_scan_at: Mapped[int | None] = mapped_column(BigInteger)
    next_scan_at: Mapped[int | None] = mapped_column(BigInteger)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class Segment(Entity, Timestamped, Base):
    __tablename__ = "segments"
    __table_args__ = (
        UniqueConstraint("source_id", "relative_path"),
        CheckConstraint("duration_ms IS NULL OR duration_ms > 0"),
        CheckConstraint("start_at IS NULL OR end_at IS NULL OR end_at > start_at"),
        CheckConstraint("size_bytes >= 0"),
        Index("ix_segments_source_start", "source_id", "start_at"),
        Index("ix_segments_source_end", "source_id", "end_at"),
    )

    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="RESTRICT"))
    relative_path: Mapped[str] = mapped_column(String)
    filename: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    mtime_ns: Mapped[int] = mapped_column(BigInteger)
    fingerprint: Mapped[str] = mapped_column(String(128))
    start_at: Mapped[int | None] = mapped_column(BigInteger)
    end_at: Mapped[int | None] = mapped_column(BigInteger)
    duration_ms: Mapped[int | None] = mapped_column(BigInteger)
    time_source: Mapped[str | None] = mapped_column(String(40))
    time_confidence: Mapped[float | None]
    container: Mapped[str | None] = mapped_column(String(80))
    video_codec: Mapped[str | None] = mapped_column(String(80))
    audio_codec: Mapped[str | None] = mapped_column(String(80))
    width: Mapped[int | None]
    height: Mapped[int | None]
    fps_num: Mapped[int | None]
    fps_den: Mapped[int | None]
    availability: Mapped[str] = mapped_column(String(30), default="available")
    playback_status: Mapped[str] = mapped_column(String(30), default="needs_prepare")
    error_code: Mapped[str | None] = mapped_column(String(80))
    index_revision: Mapped[int] = mapped_column(Integer, default=1)
    last_seen_scan: Mapped[str | None] = mapped_column(String(80))


class Task(Entity, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("kind IN ('scan', 'export', 'reindex', 'prepare')"),
        CheckConstraint(
            "status IN ('queued','running','cancelling','completed','failed','cancelled')"
        ),
        CheckConstraint("progress >= 0 AND progress <= 100"),
        Index("ix_tasks_queue", "status", "available_at", "created_at"),
    )

    kind: Mapped[str] = mapped_column(String(30))
    source_id: Mapped[str | None] = mapped_column(ForeignKey("sources.id", ondelete="SET NULL"))
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(30), default="queued")
    stage: Mapped[str | None] = mapped_column(String(80))
    progress: Mapped[int] = mapped_column(Integer, default=0)
    result_json: Mapped[dict | None] = mapped_column(JSON)
    error_code: Mapped[str | None] = mapped_column(String(80))
    error_message: Mapped[str | None] = mapped_column(String)
    retry_of_task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id"))
    attempt_no: Mapped[int] = mapped_column(Integer, default=0)
    recovery_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    idempotency_key: Mapped[str | None] = mapped_column(String(200), unique=True)
    active_key: Mapped[str | None] = mapped_column(String(300), unique=True)
    available_at: Mapped[int] = mapped_column(BigInteger, default=utc_now_ms)
    lease_owner: Mapped[str | None] = mapped_column(String(80))
    lease_token: Mapped[str | None] = mapped_column(String(80))
    lease_until: Mapped[int | None] = mapped_column(BigInteger)
    cancel_requested_at: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[int] = mapped_column(BigInteger, default=utc_now_ms)
    started_at: Mapped[int | None] = mapped_column(BigInteger)
    finished_at: Mapped[int | None] = mapped_column(BigInteger)


class TaskAttempt(Entity, Base):
    __tablename__ = "task_attempts"
    __table_args__ = (UniqueConstraint("task_id", "attempt_no"),)

    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    attempt_no: Mapped[int] = mapped_column(Integer)
    lease_token: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(30))
    started_at: Mapped[int] = mapped_column(BigInteger, default=utc_now_ms)
    finished_at: Mapped[int | None] = mapped_column(BigInteger)
    checkpoint_json: Mapped[dict | None] = mapped_column(JSON)
    error_code: Mapped[str | None] = mapped_column(String(80))


class Artifact(Entity, Base):
    __tablename__ = "artifacts"

    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    segment_id: Mapped[str | None] = mapped_column(ForeignKey("segments.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(30))
    relative_path: Mapped[str] = mapped_column(String, unique=True)
    profile_hash: Mapped[str | None] = mapped_column(String(128))
    input_fingerprint: Mapped[str | None] = mapped_column(String(128))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    duration_ms: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(30), default="ready")
    expires_at: Mapped[int | None] = mapped_column(BigInteger)
    last_access_at: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[int] = mapped_column(BigInteger, default=utc_now_ms)


class BusinessLog(Base):
    __tablename__ = "business_logs"
    __table_args__ = (
        Index("ix_logs_time", "created_at", "id"),
        Index("ix_logs_task_time", "task_id", "created_at"),
        Index("ix_logs_source_time", "source_id", "created_at"),
        {"sqlite_autoincrement": True},
    )

    sequence: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id: Mapped[str] = mapped_column(String(36), unique=True, default=new_id)

    created_at: Mapped[int] = mapped_column(BigInteger, default=utc_now_ms)
    level: Mapped[str] = mapped_column(String(20))
    kind: Mapped[str] = mapped_column(String(30))
    source_id: Mapped[str | None] = mapped_column(ForeignKey("sources.id", ondelete="SET NULL"))
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    event_code: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(200))
    detail_json: Mapped[dict] = mapped_column(JSON, default=dict)


class SavedSettings(Base):
    __tablename__ = "settings"

    group_name: Mapped[str] = mapped_column(String(40), primary_key=True)
    value_json: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=utc_now_ms)


class RuntimeLease(Base):
    __tablename__ = "runtime_leases"

    resource_key: Mapped[str] = mapped_column(String(200), primary_key=True)
    owner: Mapped[str] = mapped_column(String(80))
    token: Mapped[str] = mapped_column(String(80))
    expires_at: Mapped[int] = mapped_column(BigInteger)


class Event(Base):
    __tablename__ = "events"
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str] = mapped_column(String(80))
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[int] = mapped_column(BigInteger, default=utc_now_ms)


class TaskRequest(Base):
    __tablename__ = "task_requests"

    scope: Mapped[str] = mapped_column(String(120), primary_key=True)
    request_key: Mapped[str] = mapped_column(String(200), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    response_json: Mapped[dict] = mapped_column(JSON)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id", ondelete="RESTRICT"))
    created_at: Mapped[int] = mapped_column(BigInteger, default=utc_now_ms)
