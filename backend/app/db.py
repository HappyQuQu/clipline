from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
settings.data_path.mkdir(parents=True, exist_ok=True)
settings.exports_path.mkdir(parents=True, exist_ok=True)
settings.tmp_path.mkdir(parents=True, exist_ok=True)
settings.thumbnails_path.mkdir(parents=True, exist_ok=True)
settings.playback_proxies_path.mkdir(parents=True, exist_ok=True)
settings.logs_path.mkdir(parents=True, exist_ok=True)
settings.models_path.mkdir(parents=True, exist_ok=True)
settings.vision_models_path.mkdir(parents=True, exist_ok=True)
settings.modelscope_cache_path.mkdir(parents=True, exist_ok=True)
settings.whisper_cache_path.mkdir(parents=True, exist_ok=True)
settings.huggingface_cache_path.mkdir(parents=True, exist_ok=True)
settings.torch_cache_path.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    f"sqlite:///{settings.db_path}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    import app.models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        columns = {row[1] for row in connection.execute(text("PRAGMA table_info(sources)"))}
        if "scan_interval_minutes" not in columns:
            connection.execute(
                text("ALTER TABLE sources ADD COLUMN scan_interval_minutes INTEGER NOT NULL DEFAULT 0")
            )
        source_defaults = {
            "auto_transcribe": "INTEGER NOT NULL DEFAULT 0",
            "auto_detect": "INTEGER NOT NULL DEFAULT 0",
            "recognition_trigger": "VARCHAR NOT NULL DEFAULT 'manual'",
            "recognition_priority": "VARCHAR NOT NULL DEFAULT 'normal'",
            "transcribe_language": "VARCHAR NOT NULL DEFAULT 'global'",
            "detect_labels": "TEXT NOT NULL DEFAULT '[\"person\",\"cat\",\"dog\",\"vehicle\",\"phone\"]'",
            "detect_confidence": "INTEGER NOT NULL DEFAULT 80",
        }
        for column, definition in source_defaults.items():
            if column not in columns:
                connection.execute(text(f"ALTER TABLE sources ADD COLUMN {column} {definition}"))
        _migrate_sources_unique_name(connection)
        scan_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(scan_jobs)"))}
        if "total_files" not in scan_columns:
            connection.execute(text("ALTER TABLE scan_jobs ADD COLUMN total_files INTEGER NOT NULL DEFAULT 0"))
        if "trigger" not in scan_columns:
            connection.execute(
                text("ALTER TABLE scan_jobs ADD COLUMN trigger VARCHAR NOT NULL DEFAULT 'manual'")
            )
        _ensure_transcription_indexes(connection)
        _ensure_transcription_job_stage(connection)
        _ensure_vision_indexes(connection)
        _ensure_segment_indexes(connection)


def _migrate_sources_unique_name(connection) -> None:
    indexes = connection.execute(text("PRAGMA index_list(sources)")).fetchall()
    has_unique_path = False
    has_unique_name = False
    for index in indexes:
        index_name = index[1]
        is_unique = bool(index[2])
        if not is_unique:
            continue
        columns = [row[2] for row in connection.execute(text(f"PRAGMA index_info('{index_name}')"))]
        if columns == ["path"]:
            has_unique_path = True
        if columns == ["name"]:
            has_unique_name = True

    if not has_unique_path and has_unique_name:
        return

    connection.execute(text("PRAGMA foreign_keys=OFF"))
    connection.execute(text("DROP TABLE IF EXISTS sources_new"))
    connection.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS sources_new (
                id VARCHAR NOT NULL PRIMARY KEY,
                name VARCHAR NOT NULL,
                path VARCHAR NOT NULL,
                enabled INTEGER NOT NULL,
                created_at VARCHAR NOT NULL,
                updated_at VARCHAR NOT NULL,
                scan_interval_minutes INTEGER NOT NULL DEFAULT 0,
                auto_transcribe INTEGER NOT NULL DEFAULT 0,
                auto_detect INTEGER NOT NULL DEFAULT 0,
                recognition_trigger VARCHAR NOT NULL DEFAULT 'manual',
                recognition_priority VARCHAR NOT NULL DEFAULT 'normal',
                transcribe_language VARCHAR NOT NULL DEFAULT 'global',
                detect_labels TEXT NOT NULL DEFAULT '["person","cat","dog","vehicle","phone"]',
                detect_confidence INTEGER NOT NULL DEFAULT 80,
                UNIQUE (name)
            )
            """
        )
    )
    connection.execute(
        text(
            """
            INSERT INTO sources_new (
                id, name, path, enabled, created_at, updated_at, scan_interval_minutes,
                auto_transcribe, auto_detect, recognition_trigger, recognition_priority,
                transcribe_language, detect_labels, detect_confidence
            )
            SELECT
                id, name, path, enabled, created_at, updated_at, COALESCE(scan_interval_minutes, 0),
                COALESCE(auto_transcribe, 0), COALESCE(auto_detect, 0),
                COALESCE(recognition_trigger, 'manual'), COALESCE(recognition_priority, 'normal'),
                COALESCE(transcribe_language, 'global'),
                COALESCE(detect_labels, '["person","cat","dog","vehicle","phone"]'),
                COALESCE(detect_confidence, 80)
            FROM sources
            """
        )
    )
    connection.execute(text("DROP TABLE sources"))
    connection.execute(text("ALTER TABLE sources_new RENAME TO sources"))
    connection.execute(text("PRAGMA foreign_keys=ON"))


def _ensure_transcription_indexes(connection) -> None:
    """确保转录相关表的索引存在"""
    indexes = {row[1] for row in connection.execute(text("PRAGMA index_list(transcriptions)"))}
    if "idx_transcription_segment" not in indexes:
        connection.execute(text("CREATE INDEX IF NOT EXISTS idx_transcription_segment ON transcriptions(segment_id)"))
    if "idx_transcription_text" not in indexes:
        connection.execute(text("CREATE INDEX IF NOT EXISTS idx_transcription_text ON transcriptions(text)"))

    job_indexes = {row[1] for row in connection.execute(text("PRAGMA index_list(transcription_jobs)"))}
    if "idx_transcription_job_segment" not in job_indexes:
        connection.execute(text("CREATE INDEX IF NOT EXISTS idx_transcription_job_segment ON transcription_jobs(segment_id)"))


def _ensure_transcription_job_stage(connection) -> None:
    """确保 transcription_jobs 表有 stage 字段"""
    columns = {row[1] for row in connection.execute(text("PRAGMA table_info(transcription_jobs)"))}
    if "stage" not in columns:
        connection.execute(text("ALTER TABLE transcription_jobs ADD COLUMN stage VARCHAR NOT NULL DEFAULT ''"))


def _ensure_segment_indexes(connection) -> None:
    """确保 video_segments 表的查询索引存在"""
    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_seg_source_time ON video_segments(source_id, start_time, end_time)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_seg_source_status ON video_segments(source_id, scan_status)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_seg_path ON video_segments(source_id, path)"))


def _ensure_vision_indexes(connection) -> None:
    """确保视觉识别相关索引存在"""
    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_vision_detection_segment ON vision_detections(segment_id)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_vision_detection_source_label ON vision_detections(source_id, label)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_vision_job_segment ON vision_jobs(segment_id)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_vision_job_status ON vision_jobs(status)"))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
