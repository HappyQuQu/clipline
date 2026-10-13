import fcntl
from pathlib import Path


class ProcessLock:
    """Locks are never unlinked: all processes must keep locking the same inode."""

    def __init__(self, path: Path):
        self.path = path
        self.file = None

    def __enter__(self):
        self.file = self.path.open("a+")
        try:
            fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.file.close()
            self.file = None
            raise RuntimeError(f"Another process holds {self.path.name}") from error
        return self

    def __exit__(self, *_):
        if self.file is not None:
            fcntl.flock(self.file.fileno(), fcntl.LOCK_UN)
            self.file.close()
            self.file = None
