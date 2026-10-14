"""Consistent SQLite backups and guarded offline restore. No recording files are copied."""

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
from contextlib import closing
from pathlib import Path
from uuid import uuid4

from alembic.script import ScriptDirectory

from app import __version__
from app.core.config import AppConfig
from app.core.locks import ProcessLock
from app.core.time import iso_utc, utc_now_ms
from app.db.migrations import alembic_config, expected_revision


def checksum(path):
    value = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            value.update(block)
    return value.hexdigest()


def describe(path):
    with closing(sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)) as connection:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Backup integrity check failed")
        if connection.execute("PRAGMA foreign_key_check").fetchone():
            raise RuntimeError("Backup foreign-key check failed")
        revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
    return {
        "version": __version__,
        "schema": revision,
        "createdAt": iso_utc(utc_now_ms()),
        "sizeBytes": path.stat().st_size,
        "sha256": checksum(path),
    }


def create(config):
    from app.bootstrap import backup_database

    target = backup_database(config)
    metadata = describe(target)
    with target.open("rb") as handle:
        os.fsync(handle.fileno())
    manifest = target.with_suffix(".json")
    with manifest.open("w") as handle:
        json.dump(metadata, handle)
        handle.flush()
        os.fsync(handle.fileno())
    from app.services.exports import fsync_directory

    fsync_directory(target.parent)
    return target


def verify(config, name, *, matching=True, target_schema=None):
    if Path(name).name != name or not name.endswith(".sqlite3"):
        raise RuntimeError("Select a backup filename from this data directory")
    path = config.data / "backups" / name
    if path.is_symlink() or not path.resolve().is_relative_to(config.data / "backups"):
        raise RuntimeError("Invalid backup path")
    manifest = path.with_suffix(".json")
    if manifest.is_symlink() or not manifest.resolve().is_relative_to(config.data / "backups"):
        raise RuntimeError("Invalid backup manifest path")
    metadata = json.loads(manifest.read_text())
    actual = describe(path)
    if (
        actual["sha256"] != metadata["sha256"]
        or actual["sizeBytes"] != metadata["sizeBytes"]
        or actual["schema"] != metadata["schema"]
    ):
        raise RuntimeError("Backup does not match its manifest")
    target = target_schema or expected_revision()
    if target_schema:
        try:
            supported = ScriptDirectory.from_config(alembic_config()).get_revision(target)
        except Exception as error:
            raise RuntimeError("Unknown rollback schema") from error
        if supported is None or supported.revision != target:
            raise RuntimeError("Unknown rollback schema")
    if matching and actual["schema"] != target:
        raise RuntimeError(
            "Backup schema does not match this image; restore with the matching old image"
        )
    return path, metadata


def restore(config, name, *, target_schema=None):
    with (
        ProcessLock(config.data / "bootstrap.lock"),
        ProcessLock(config.data / "api.lock"),
        ProcessLock(config.data / "worker.lock"),
    ):
        path, metadata = verify(config, name, target_schema=target_schema)
        # Preserve the current database before replacing it.
        if config.db.exists():
            create(config)
        temporary = config.db.with_name(f".{config.db.name}-{uuid4().hex}.restore-pending")
        with path.open("rb") as source, temporary.open("xb") as destination:
            shutil.copyfileobj(source, destination)
        with temporary.open("rb") as handle:
            os.fsync(handle.fileno())
        for suffix in ("-wal", "-shm"):
            Path(str(config.db) + suffix).unlink(missing_ok=True)
        os.replace(temporary, config.db)
        from app.services.exports import fsync_directory

        fsync_directory(config.db.parent)
        return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["create", "verify", "restore"])
    parser.add_argument("name", nargs="?")
    parser.add_argument(
        "--target-schema",
        help="Offline rollback only: restore this known schema, then start its matching old image",
    )
    args = parser.parse_args()
    config = AppConfig()
    if args.operation == "create":
        print(create(config).name)
    else:
        if args.name is None:
            parser.error("A backup filename is required")
        print(
            json.dumps(
                restore(config, args.name, target_schema=args.target_schema)
                if args.operation == "restore"
                else verify(config, args.name, target_schema=args.target_schema)[1]
            )
        )


if __name__ == "__main__":
    main()
