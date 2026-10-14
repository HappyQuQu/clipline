"""Unified model cache paths for ASR and future recognition models."""

from __future__ import annotations

import os
from pathlib import Path

from app.core.config import get_settings


def model_cache_root() -> Path:
    return get_settings().models_path


def modelscope_cache_root() -> Path:
    return get_settings().modelscope_cache_path


def modelscope_models_path() -> Path:
    return modelscope_cache_root() / "hub" / "models"


def whisper_cache_root() -> Path:
    return get_settings().whisper_cache_path


def cached_modelscope_dir(model_id: str) -> Path | None:
    """Find a migrated model without downloading it or changing its cache layout."""
    root = modelscope_cache_root()
    candidates = [
        modelscope_models_path() / model_id,
        root / "models" / model_id.replace("/", "--") / "snapshots" / "master",
        root / "hub" / model_id,
    ]
    for candidate in candidates:
        if candidate.is_dir() and any(candidate.iterdir()):
            return candidate
    return None


def huggingface_cache_root() -> Path:
    return get_settings().huggingface_cache_path


def torch_cache_root() -> Path:
    return get_settings().torch_cache_path


def configure_model_cache_env() -> dict[str, str]:
    """Point third-party model caches at Clipline's mapped data directory."""
    paths = [
        model_cache_root(),
        modelscope_cache_root(),
        modelscope_models_path(),
        whisper_cache_root(),
        huggingface_cache_root(),
        torch_cache_root(),
    ]
    for path in paths:
        path.mkdir(parents=True, exist_ok=True)

    env = {
        "MODELSCOPE_CACHE": str(modelscope_cache_root()),
        "HF_HOME": str(huggingface_cache_root()),
        "HUGGINGFACE_HUB_CACHE": str(huggingface_cache_root() / "hub"),
        "TORCH_HOME": str(torch_cache_root()),
        "XDG_CACHE_HOME": str(model_cache_root() / "xdg"),
    }
    for key, value in env.items():
        os.environ.setdefault(key, value)
    return env
