import fcntl
import logging
import os
import stat
import threading
from uuid import uuid4

from sqlalchemy import delete

from app.core.errors import AppError
from app.core.time import utc_now_ms
from app.db.models import RuntimeLease
from app.db.transactions import write_session

logger = logging.getLogger(__name__)


class FileUse:
    """The DB lease protects request gaps; the OS lock protects arbitrarily slow streams."""

    def __init__(self, session, engine, config, artifact, path):
        self.engine, self.config = engine, config
        self.key = f"use:{artifact.id}:{uuid4()}"
        self.lock = threading.Lock()
        self.closed = False
        self.handle = None
        try:
            self.handle = os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb")
            info = os.fstat(self.handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size != artifact.size_bytes:
                raise AppError("ARTIFACT_UNAVAILABLE", "缓存或导出文件已失效，请重新准备。", 410)
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
            session.add(
                RuntimeLease(
                    resource_key=self.key,
                    owner=f"api:{os.getpid()}",
                    token=self.key,
                    expires_at=utc_now_ms() + config.usage_lease_seconds * 1000,
                )
            )
        except (OSError, AppError) as error:
            if self.handle:
                self.handle.close()
            if isinstance(error, AppError):
                raise
            raise AppError("ARTIFACT_UNAVAILABLE", "文件暂时无法读取，请稍后重试。", 410) from error

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            self.handle.close()
            try:
                with write_session(self.engine) as session:
                    row = session.get(RuntimeLease, self.key)
                    if row:
                        if self.config.usage_idle_seconds:
                            row.expires_at = utc_now_ms() + self.config.usage_idle_seconds * 1000
                        else:
                            session.delete(row)
            except Exception:
                # On API shutdown the OS lock is released; the persisted lease has a bounded expiry.
                logger.warning("Could not release file-use lease; it will expire")


def view_lease(session, config, artifact, client_id, active):
    key = f"view:{artifact.id}:{client_id}"
    if not active:
        session.execute(delete(RuntimeLease).where(RuntimeLease.resource_key == key))
        return {"leased": False}
    lease = session.get(RuntimeLease, key)
    if lease is None:
        lease = RuntimeLease(resource_key=key, owner="browser", token=client_id, expires_at=0)
        session.add(lease)
    lease.expires_at = utc_now_ms() + config.usage_lease_seconds * 1000
    artifact.last_access_at = utc_now_ms()
    return {"leased": True, "expiresInSeconds": config.usage_lease_seconds}
