import time
from datetime import UTC, datetime


def utc_now_ms() -> int:
    return time.time_ns() // 1_000_000


def iso_utc(value: int | None) -> str | None:
    if value is None:
        return None
    return (
        datetime.fromtimestamp(value / 1000, UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
