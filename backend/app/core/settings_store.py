"""持久化设置存储 — JSON file-backed overrides."""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)

_lock = threading.RLock()

# 内存缓存
_cache: dict[str, Any] | None = None
_cache_mtime: float | None = None

# 允许通过 UI 修改的 key
ALLOWED_KEYS: set[str] = {
    "scan_interval_seconds",
    "export_ttl_hours",
    "max_export_minutes",
    "max_concurrent_exports",
    "thumbnail_mode",
    "timezone",
    "skip_recent_seconds",
    "log_level",
    "log_format",
    "asr_model",
    "asr_model_size",
    "asr_device",
    "asr_language",
    "asr_auto_transcribe",
    "asr_hotwords",
}

# key → 类型校验
_KEY_TYPES: dict[str, type | tuple[type, ...]] = {
    "scan_interval_seconds": int,
    "export_ttl_hours": int,
    "max_export_minutes": int,
    "max_concurrent_exports": int,
    "thumbnail_mode": str,
    "timezone": str,
    "skip_recent_seconds": int,
    "log_level": str,
    "log_format": str,
    "asr_model": str,
    "asr_model_size": str,
    "asr_device": str,
    "asr_language": str,
    "asr_auto_transcribe": bool,
    "asr_hotwords": str,
}


def _settings_path() -> Path:
    from app.core.config import get_settings

    return get_settings().data_path / "settings.json"


def load_overrides() -> dict[str, Any]:
    """读取 settings.json，带内存缓存。"""
    global _cache, _cache_mtime
    path = _settings_path()
    try:
        mtime = path.stat().st_mtime
    except FileNotFoundError:
        return {}
    except OSError:
        return {}

    with _lock:
        if _cache is not None and _cache_mtime == mtime:
            return dict(_cache)

    try:
        text = path.read_text(encoding="utf-8")
        data = json.loads(text) if text.strip() else {}
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("failed to read settings.json: %s", exc)
        return {}

    with _lock:
        _cache = data
        _cache_mtime = mtime
    return dict(data)


def save_overrides(overrides: dict[str, Any]) -> None:
    """原子写入 settings.json。"""
    global _cache, _cache_mtime
    path = _settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(overrides, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
    except OSError as exc:
        logger.error("failed to write settings.json: %s", exc)
        raise

    with _lock:
        _cache = overrides
        try:
            _cache_mtime = path.stat().st_mtime
        except OSError:
            _cache_mtime = None


def get_effective(key: str, default: Any = None) -> Any:
    """获取有效设置值：overrides 优先，fallback 到 env defaults。"""
    overrides = load_overrides()
    if key in overrides:
        return overrides[key]
    from app.core.config import get_settings

    settings = get_settings()
    return getattr(settings, key, default)


def update_settings(updates: dict[str, Any]) -> dict[str, Any]:
    """批量更新设置（仅允许的 key），返回完整 overrides。"""
    # 验证 key
    invalid = set(updates.keys()) - ALLOWED_KEYS
    if invalid:
        raise ValueError(f"不允许的设置项: {', '.join(sorted(invalid))}")

    # 类型校验
    for key, value in updates.items():
        expected = _KEY_TYPES.get(key)
        if expected and not isinstance(value, expected):
            raise ValueError(f"{key} 期望 {expected.__name__}，收到 {type(value).__name__}")

    with _lock:
        current = load_overrides()
        current.update(updates)
        save_overrides(current)
    return current
