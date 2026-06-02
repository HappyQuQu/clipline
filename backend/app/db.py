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
settings.logs_path.mkdir(parents=True, exist_ok=True)

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
                UNIQUE (name)
            )
            """
        )
    )
    connection.execute(
        text(
            """
            INSERT INTO sources_new (id, name, path, enabled, created_at, updated_at, scan_interval_minutes)
            SELECT id, name, path, enabled, created_at, updated_at, COALESCE(scan_interval_minutes, 0)
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


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
