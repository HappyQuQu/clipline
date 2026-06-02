"""ASR 模型管理 — 缓存扫描、下载、删除."""

from __future__ import annotations

import shutil
import threading
from pathlib import Path
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)

# 模型注册表: (engine, size) → 缓存信息
MODEL_REGISTRY: dict[tuple[str, str], dict[str, Any]] = {
    # FunASR — paraformer-zh (tiny/base/medium 都是同一个模型)
    ("funasr", "tiny"): {
        "name": "paraformer-zh",
        "model_scope_id": "iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        "cache_pattern": "iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    },
    ("funasr", "base"): {
        "name": "paraformer-zh",
        "model_scope_id": "iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        "cache_pattern": "iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    },
    ("funasr", "medium"): {
        "name": "paraformer-zh",
        "model_scope_id": "iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        "cache_pattern": "iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    },
    ("funasr", "large"): {
        "name": "paraformer-large-zh",
        "model_scope_id": "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        "cache_pattern": "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    },
    # SenseVoice
    ("sensevoice", "small"): {
        "name": "SenseVoiceSmall",
        "model_scope_id": "iic/SenseVoiceSmall",
        "cache_pattern": "iic/SenseVoiceSmall",
    },
    # Whisper
    ("whisper", "tiny"): {
        "name": "tiny",
        "whisper_file": "tiny.pt",
    },
    ("whisper", "base"): {
        "name": "base",
        "whisper_file": "base.pt",
    },
    ("whisper", "medium"): {
        "name": "medium",
        "whisper_file": "medium.pt",
    },
    ("whisper", "large"): {
        "name": "large",
        "whisper_file": "large-v3.pt",
    },
}

# FunASR 共享子模型
_FUNASR_SHARED_MODELS = [
    "speech_fsmn_vad_zh-cn-16k-common-pytorch",
    "punc_ct-transformer_cn-en-common-vocab471067-large",
]

# 下载状态跟踪
_download_status: dict[str, dict[str, Any]] = {}
_status_lock = threading.Lock()


def _modelscope_cache() -> Path:
    return Path.home() / ".cache" / "modelscope" / "hub" / "models"


def _whisper_cache() -> Path:
    return Path.home() / ".cache" / "whisper"


def _dir_size(path: Path) -> int:
    """递归计算目录大小。"""
    if not path.exists():
        return 0
    total = 0
    try:
        for item in path.rglob("*"):
            if item.is_file():
                total += item.stat().st_size
    except OSError:
        pass
    return total


def _file_size(path: Path) -> int:
    try:
        return path.stat().st_size if path.exists() else 0
    except OSError:
        return 0


def _is_funasr_downloaded(cache_pattern: str) -> tuple[bool, int, Path | None]:
    """检查 FunASR 模型是否已下载。"""
    cache_dir = _modelscope_cache() / cache_pattern
    if cache_dir.exists() and any(cache_dir.iterdir()):
        return True, _dir_size(cache_dir), cache_dir
    return False, 0, None


def _is_whisper_downloaded(whisper_file: str) -> tuple[bool, int, Path | None]:
    """检查 Whisper 模型是否已下载。"""
    model_path = _whisper_cache() / whisper_file
    if model_path.exists():
        return True, _file_size(model_path), model_path
    return False, 0, None


def list_models() -> list[dict[str, Any]]:
    """列出所有支持的模型及其下载状态。"""
    results = []
    seen: set[tuple[str, str]] = set()

    for (engine, size), info in MODEL_REGISTRY.items():
        # FunASR tiny/base/medium 共享同一个模型文件，只返回 medium 作为代表
        if engine == "funasr" and size in ("tiny", "base"):
            seen.add((engine, size))
            continue
        if (engine, size) in seen:
            continue

        model_id = f"{engine}:{size}"

        if engine in ("funasr", "sensevoice"):
            cache_pattern = info.get("cache_pattern", "")
            downloaded, size_bytes, cache_path = _is_funasr_downloaded(cache_pattern)
            # 标记共享模型为已见
            if engine == "funasr":
                for s in ("tiny", "base", "medium"):
                    seen.add(("funasr", s))
        elif engine == "whisper":
            whisper_file = info.get("whisper_file", "")
            downloaded, size_bytes, cache_path = _is_whisper_downloaded(whisper_file)
        else:
            continue

        results.append({
            "id": model_id,
            "engine": engine,
            "name": info["name"],
            "size_label": size,
            "downloaded": downloaded,
            "size_bytes": size_bytes,
            "cache_path": str(cache_path) if cache_path else None,
        })

    return results


def _do_download(model_id: str, engine: str, size: str) -> None:
    """后台下载模型。"""
    with _status_lock:
        _download_status[model_id] = {"status": "downloading", "error": None}

    try:
        if engine in ("funasr", "sensevoice"):
            _download_funasr(engine, size)
        elif engine == "whisper":
            _download_whisper(size)

        with _status_lock:
            _download_status[model_id] = {"status": "completed", "error": None}
        logger.info("model download completed: %s", model_id)
    except Exception as exc:
        with _status_lock:
            _download_status[model_id] = {"status": "failed", "error": str(exc)}
        logger.error("model download failed: %s — %s", model_id, exc)


def _download_funasr(engine: str, size: str) -> None:
    """通过 FunASR 库触发模型下载。"""
    try:
        import torch
        from funasr import AutoModel

        model_map = {
            "tiny": "paraformer-zh",
            "base": "paraformer-zh",
            "medium": "paraformer-zh",
            "large": "paraformer-large-zh",
        }
        model_name = model_map.get(size, "paraformer-zh")

        if engine == "sensevoice":
            model_name = "iic/SenseVoiceSmall"

        device = "cpu"
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"

        # 这会触发下载
        AutoModel(
            model=model_name,
            vad_model="fsmn-vad",
            punc_model="ct-punc",
            device=device,
        )
    except ImportError as exc:
        raise RuntimeError(f"FunASR 未安装: {exc}") from exc


def _download_whisper(size: str) -> None:
    """通过 Whisper 库触发模型下载。"""
    try:
        import whisper

        whisper.load_model(size, device="cpu")
    except ImportError as exc:
        raise RuntimeError(f"Whisper 未安装: {exc}") from exc


def download_model(model_id: str) -> dict[str, str]:
    """触发模型下载（后台线程）。"""
    parts = model_id.split(":", 1)
    if len(parts) != 2:
        raise ValueError(f"无效的 model_id 格式: {model_id}")
    engine, size = parts

    info = MODEL_REGISTRY.get((engine, size))
    if not info:
        raise ValueError(f"未知的模型: {model_id}")

    with _status_lock:
        current = _download_status.get(model_id, {})
        if current.get("status") == "downloading":
            return {"status": "already_downloading"}

    thread = threading.Thread(target=_do_download, args=(model_id, engine, size), daemon=True)
    thread.start()
    return {"status": "downloading"}


def get_download_status(model_id: str) -> dict[str, Any]:
    """获取模型下载状态。"""
    with _status_lock:
        status = _download_status.get(model_id)
    if not status:
        return {"status": "idle", "error": None}
    return dict(status)


def delete_model(model_id: str) -> bool:
    """删除模型缓存。"""
    parts = model_id.split(":", 1)
    if len(parts) != 2:
        raise ValueError(f"无效的 model_id 格式: {model_id}")
    engine, size = parts

    info = MODEL_REGISTRY.get((engine, size))
    if not info:
        raise ValueError(f"未知的模型: {model_id}")

    deleted = False

    if engine in ("funasr", "sensevoice"):
        cache_pattern = info.get("cache_pattern", "")
        cache_dir = _modelscope_cache() / cache_pattern
        if cache_dir.exists():
            shutil.rmtree(cache_dir)
            deleted = True
            logger.info("deleted model cache: %s", cache_dir)

        # SenseVoice 没有共享子模型，但 FunASR 有
        # 不删除共享子模型（VAD/punctuation），因为其他模型也需要
    elif engine == "whisper":
        whisper_file = info.get("whisper_file", "")
        model_path = _whisper_cache() / whisper_file
        if model_path.exists():
            model_path.unlink()
            deleted = True
            logger.info("deleted whisper model: %s", model_path)

    return deleted
