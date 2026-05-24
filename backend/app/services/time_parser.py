from __future__ import annotations

import re
from datetime import datetime, timedelta
from pathlib import Path


FILENAME_PATTERNS = [
    re.compile(r"(?P<date>\d{8})[_-]?(?P<time>\d{6})"),
    re.compile(
        r"(?P<year>\d{4})[-_](?P<month>\d{2})[-_](?P<day>\d{2})"
        r"[_ -](?P<hour>\d{2})[-_](?P<minute>\d{2})[-_](?P<second>\d{2})"
    ),
]


def infer_start_time(path: Path, mtime: datetime, duration_seconds: float | None) -> tuple[datetime, str, float]:
    text = str(path)
    name = path.name
    for pattern in FILENAME_PATTERNS:
        match = pattern.search(name)
        if not match:
            continue
        groups = match.groupdict()
        if "date" in groups and groups.get("date") and groups.get("time"):
            start = datetime.strptime(groups["date"] + groups["time"], "%Y%m%d%H%M%S")
        else:
            start = datetime(
                int(groups["year"]),
                int(groups["month"]),
                int(groups["day"]),
                int(groups["hour"]),
                int(groups["minute"]),
                int(groups["second"]),
            )
        return start.astimezone() if start.tzinfo else start.replace(tzinfo=mtime.tzinfo), "filename", 0.95

    directory_match = re.search(
        r"(?P<year>\d{4})[/\\](?P<month>\d{2})[/\\](?P<day>\d{2})"
        r"[/\\](?P<hour>\d{2})[/\\](?P<minute>\d{2})[/\\](?P<second>\d{2})",
        text,
    )
    if directory_match:
        groups = directory_match.groupdict()
        start = datetime(
            int(groups["year"]),
            int(groups["month"]),
            int(groups["day"]),
            int(groups["hour"]),
            int(groups["minute"]),
            int(groups["second"]),
            tzinfo=mtime.tzinfo,
        )
        return start, "directory", 0.9

    if duration_seconds:
        return mtime - timedelta(seconds=duration_seconds), "mtime_minus_duration", 0.5
    return mtime, "mtime", 0.3

