import logging
import os
import shutil
import sqlite3
import subprocess
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from alembic import command
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.core.config import AppConfig
from app.core.locks import ProcessLock
from app.db.migrations import alembic_config, current_revision, expected_revision
from app.db.models import SavedSettings
from app.db.session import make_engine
from app.services.settings import DEFAULTS, initial_values

logger = logging.getLogger(__name__)


def verify_environment(config: AppConfig) -> None:
    root = config.recordings_root
    if not root.is_dir() or not os.access(root, os.R_OK | os.X_OK):
        raise RuntimeError("Recording root is missing or unreadable; check the read-only mount")
    config.data.mkdir(parents=True, exist_ok=True)
    if os.path.samefile(config.data, root):
        raise RuntimeError("Recording and writable data mounts refer to the same directory")
    if not os.access(config.data, os.R_OK | os.W_OK | os.X_OK):
        raise RuntimeError("Data directory is not writable")
    for name in ("ffmpeg", "ffprobe"):
        binary = shutil.which(name)
        if binary is None:
            raise RuntimeError(f"{name} is required")
        subprocess.run([binary, "-version"], check=True, capture_output=True, timeout=10)


def backup_database(config: AppConfig) -> Path:
    if not config.db.is_file():
        raise RuntimeError("Initialize the database before creating a backup")
    directory = config.data / "backups"
    directory.mkdir(exist_ok=True)
    if directory.is_symlink() or not directory.resolve().is_relative_to(config.data):
        raise RuntimeError("Backup directory must stay inside writable application data")
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    target = directory / f"clipline-{stamp}-{uuid4().hex[:8]}.sqlite3"
    # SQLite backup includes committed WAL data; copying only the main file would not.
    with (
        closing(sqlite3.connect(config.db)) as source,
        closing(sqlite3.connect(target)) as destination,
    ):
        source.backup(destination)
    return target


def bootstrap(config: AppConfig, *, check_media: bool = True) -> None:
    if check_media:
        verify_environment(config)
    else:
        config.data.mkdir(parents=True, exist_ok=True)
    config.db.parent.mkdir(parents=True, exist_ok=True)
    with (
        ProcessLock(config.data / "bootstrap.lock"),
        ProcessLock(config.data / "api.lock"),
        ProcessLock(config.data / "worker.lock"),
    ):
        engine = make_engine(config)
        try:
            tables = set(inspect(engine).get_table_names())
            revision = current_revision(engine)
            if tables - {"alembic_version"} and revision is None:
                raise RuntimeError(
                    "Unversioned database detected; legacy databases are not imported"
                )
            with engine.connect() as connection:
                connection.exec_driver_sql("PRAGMA journal_mode=WAL")
            if revision != expected_revision():
                if revision is not None:
                    from app.backup import create

                    create(config)
                with engine.connect() as connection:
                    migration = alembic_config()
                    migration.attributes["connection"] = connection
                    command.upgrade(migration, "head")
            with Session(engine) as session, session.begin():
                for group in DEFAULTS:
                    if session.get(SavedSettings, group) is None:
                        session.add(
                            SavedSettings(group_name=group, value_json=initial_values(group))
                        )
            for name in ("exports", "tmp", "thumbnails", "playback-proxies", "logs"):
                (config.data / name).mkdir(exist_ok=True)
            logger.info("Database is ready at revision %s", expected_revision())
        finally:
            engine.dispose()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    bootstrap(AppConfig())


if __name__ == "__main__":
    main()
