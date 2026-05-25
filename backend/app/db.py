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
        scan_columns = {row[1] for row in connection.execute(text("PRAGMA table_info(scan_jobs)"))}
        if "total_files" not in scan_columns:
            connection.execute(text("ALTER TABLE scan_jobs ADD COLUMN total_files INTEGER NOT NULL DEFAULT 0"))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
