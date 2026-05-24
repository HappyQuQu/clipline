from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:16]}"


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value)


def bool_int(value: bool) -> int:
    return 1 if value else 0

