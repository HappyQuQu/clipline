from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException

from app.core.config import get_settings


def resolve_recording_path(path: str | None = None) -> Path:
    settings = get_settings()
    root = settings.recordings_root_path.resolve()
    requested = Path(path or str(root))
    if not requested.is_absolute():
        raise HTTPException(status_code=400, detail="Path must be absolute")
    resolved = requested.resolve()
    if os.path.commonpath([str(root), str(resolved)]) != str(root):
        raise HTTPException(status_code=400, detail=f"Path must be within {root}")
    return resolved


def validate_source_path(path: str) -> Path:
    resolved = resolve_recording_path(path)
    if not resolved.exists():
        raise HTTPException(status_code=400, detail="Path does not exist")
    if not resolved.is_dir():
        raise HTTPException(status_code=400, detail="Path must be a directory")
    if not os.access(resolved, os.R_OK):
        raise HTTPException(status_code=400, detail="Path is not readable")
    return resolved


def validate_data_child(path: str | Path, parent: Path) -> Path:
    resolved = Path(path).resolve()
    parent_resolved = parent.resolve()
    if os.path.commonpath([str(parent_resolved), str(resolved)]) != str(parent_resolved):
        raise HTTPException(status_code=400, detail="File path is outside the allowed data directory")
    return resolved


def directory_tree(path: str | None, depth: int = 2) -> dict:
    root = resolve_recording_path(path)
    if not root.exists() or not root.is_dir():
        raise HTTPException(status_code=400, detail="Path does not exist or is not a directory")

    def children(current: Path, remaining: int) -> list[dict]:
        if remaining <= 0:
            return []
        items: list[dict] = []
        try:
            dirs = sorted([entry for entry in current.iterdir() if entry.is_dir()], key=lambda p: p.name)
        except OSError:
            return []
        for entry in dirs:
            if entry.name.startswith("."):
                continue
            readable = os.access(entry, os.R_OK)
            try:
                has_children = any(child.is_dir() for child in entry.iterdir()) if readable else False
            except OSError:
                has_children = False
            items.append(
                {
                    "name": entry.name,
                    "path": str(entry),
                    "readable": readable,
                    "hasChildren": has_children,
                    "children": children(entry, remaining - 1) if readable else [],
                }
            )
        return items

    return {"root": str(root), "items": children(root, max(depth, 0))}

