from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import Response, StreamingResponse

CONTENT_TYPES = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".ts": "video/mp2t",
}


def _file_iterator(path: Path, start: int, end: int, chunk_size: int = 1024 * 1024):
    with path.open("rb") as file:
        file.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = file.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def stream_file(path: Path, request: Request) -> Response:
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    size = path.stat().st_size
    content_type = CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
    range_header = request.headers.get("range")
    if not range_header:
        return StreamingResponse(
            _file_iterator(path, 0, size - 1),
            media_type=content_type,
            headers={"Accept-Ranges": "bytes", "Content-Length": str(size)},
        )

    units, _, range_value = range_header.partition("=")
    if units != "bytes":
        raise HTTPException(status_code=416, detail="Invalid range")
    start_text, _, end_text = range_value.partition("-")
    start = int(start_text) if start_text else 0
    end = int(end_text) if end_text else size - 1
    if start >= size or end >= size or start > end:
        raise HTTPException(status_code=416, detail="Invalid range")
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Range": f"bytes {start}-{end}/{size}",
        "Content-Length": str(end - start + 1),
    }
    return StreamingResponse(
        _file_iterator(path, start, end),
        status_code=206,
        media_type=content_type,
        headers=headers,
    )

