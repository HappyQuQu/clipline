import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

FILENAME_PATTERNS = (
    re.compile(r"(?<!\d)(?P<date>\d{8})[_-]?(?P<time>\d{6})(?!\d)"),
    re.compile(
        r"(?P<y>\d{4})[-_](?P<m>\d{2})[-_](?P<d>\d{2})[_ T-]"
        r"(?P<h>\d{2})[-_:](?P<n>\d{2})[-_:](?P<s>\d{2})"
    ),
)
DIRECTORY_PATTERN = re.compile(
    r"(?P<y>\d{4})/(?P<m>\d{2})/(?P<d>\d{2})/(?P<h>\d{2})/(?P<n>\d{2})/(?P<s>\d{2})(?:/|$)"
)


def parsed_time(match, timezone):
    values = match.groupdict()
    if "date" in values:
        value = datetime.strptime(values["date"] + values["time"], "%Y%m%d%H%M%S")
    else:
        value = datetime(*(int(values[key]) for key in ("y", "m", "d", "h", "n", "s")))
    return int(value.replace(tzinfo=ZoneInfo(timezone)).timestamp() * 1000)


def infer_start(path: Path, mtime_ns: int, duration_ms: int, timezone: str):
    for pattern in FILENAME_PATTERNS:
        match = pattern.search(path.name)
        if match:
            try:
                return parsed_time(match, timezone), "filename", 0.95
            except ValueError:
                continue
    for match in DIRECTORY_PATTERN.finditer(path.as_posix()):
        try:
            return parsed_time(match, timezone), "directory", 0.9
        except ValueError:
            continue
    return mtime_ns // 1_000_000 - duration_ms, "mtime_minus_duration", 0.5
