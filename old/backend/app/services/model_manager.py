"""ASR 模型管理 — 缓存扫描、下载、删除."""

from __future__ import annotations

import hashlib
import shutil
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.logging import get_logger
from app.services.model_cache import (
    cached_modelscope_dir,
    configure_model_cache_env,
    modelscope_models_path,
    whisper_cache_root,
)

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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _update_download_status(model_id: str, **updates: Any) -> None:
    """Update one in-memory download status without dropping its start time."""
    with _status_lock:
        current = dict(_download_status.get(model_id, {}))
        current.update(updates)
        current.setdefault("startedAt", _now_iso())
        current["updatedAt"] = _now_iso()
        _download_status[model_id] = current


def _modelscope_cache() -> Path:
    configure_model_cache_env()
    return modelscope_models_path()


def _whisper_cache() -> Path:
    configure_model_cache_env()
    return whisper_cache_root()


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
    configure_model_cache_env()
    cache_dir = cached_modelscope_dir(cache_pattern)
    if cache_dir:
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
            "download": get_download_status(model_id),
        })

    return results


def _do_download(model_id: str, engine: str, size: str) -> None:
    """后台下载模型。"""
    _update_download_status(
        model_id,
        status="downloading",
        stage="preparing",
        progress=0.02,
        bytesDownloaded=0,
        totalBytes=None,
        error=None,
    )

    try:
        if engine in ("funasr", "sensevoice"):
            _download_funasr(model_id, engine, size)
        elif engine == "whisper":
            _download_whisper(model_id, size)

        _update_download_status(
            model_id,
            status="completed",
            stage="completed",
            progress=1.0,
            error=None,
        )
        logger.info("model download completed: %s", model_id)
    except Exception as exc:
        _update_download_status(model_id, status="failed", stage="failed", error=str(exc))
        logger.error("model download failed: %s — %s", model_id, exc)


def _download_funasr(model_id: str, engine: str, size: str) -> None:
    """通过 FunASR 库触发模型下载。"""
    try:
        configure_model_cache_env()
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

        # ModelScope does not expose a stable byte callback here. Keep the task
        # explicitly indeterminate instead of presenting a fabricated percentage.
        _update_download_status(
            model_id,
            stage="downloading_modelscope",
            progress=None,
            bytesDownloaded=0,
            totalBytes=None,
        )
        AutoModel(
            model=model_name,
            vad_model="fsmn-vad",
            punc_model="ct-punc",
            device=device,
        )
        _update_download_status(model_id, stage="verifying", progress=0.95)
    except ImportError as exc:
        raise RuntimeError(f"FunASR 未安装: {exc}") from exc


def _download_whisper(model_id: str, size: str) -> None:
    """通过 Whisper 库触发模型下载。"""
    try:
        configure_model_cache_env()
        import whisper

        url = whisper._MODELS.get(size)  # type: ignore[attr-defined]
        if not url:
            raise RuntimeError(f"Whisper 不支持模型规格: {size}")
        model_path = _whisper_cache() / MODEL_REGISTRY[("whisper", size)]["whisper_file"]
        _download_with_resume(url, model_path, model_id=model_id)
        _update_download_status(model_id, stage="loading", progress=0.97)
        whisper.load_model(size, device="cpu", download_root=str(_whisper_cache()))
    except ImportError as exc:
        raise RuntimeError(f"Whisper 未安装: {exc}") from exc


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download_with_resume(
    url: str,
    target: Path,
    retries: int = 8,
    model_id: str | None = None,
) -> None:
    """Download a model with bounded reads and byte-range resume."""
    expected_sha256 = url.rstrip("/").split("/")[-2]
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and _file_sha256(target) == expected_sha256:
        return

    partial = target.with_name(f"{target.name}.part")
    if target.exists():
        target.replace(partial)

    last_error: Exception | None = None
    for attempt in range(retries):
        offset = partial.stat().st_size if partial.exists() else 0
        request = urllib.request.Request(url)
        if offset:
            request.add_header("Range", f"bytes={offset}-")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                resumed = offset > 0 and response.status == 206
                mode = "ab" if resumed else "wb"
                content_range = response.headers.get("Content-Range", "")
                content_length = int(response.headers.get("Content-Length", "0") or 0)
                if "/" in content_range:
                    total_bytes = int(content_range.rsplit("/", 1)[1])
                else:
                    total_bytes = content_length + (offset if resumed else 0)
                downloaded_bytes = offset if resumed else 0
                if model_id:
                    _update_download_status(
                        model_id,
                        stage="downloading",
                        progress=(downloaded_bytes / total_bytes) * 0.9 if total_bytes else None,
                        bytesDownloaded=downloaded_bytes,
                        totalBytes=total_bytes or None,
                    )
                with partial.open(mode) as output:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        output.write(chunk)
                        downloaded_bytes += len(chunk)
                        if model_id:
                            _update_download_status(
                                model_id,
                                stage="downloading",
                                progress=(
                                    min(0.9, (downloaded_bytes / total_bytes) * 0.9)
                                    if total_bytes
                                    else None
                                ),
                                bytesDownloaded=downloaded_bytes,
                                totalBytes=total_bytes or None,
                            )
            if model_id:
                _update_download_status(model_id, stage="verifying", progress=0.93)
            if _file_sha256(partial) == expected_sha256:
                partial.replace(target)
                return
            last_error = RuntimeError("Whisper 模型校验失败或下载不完整")
        except (OSError, TimeoutError, urllib.error.URLError) as exc:
            last_error = exc
        logger.warning(
            "Whisper model download interrupted; retrying",
            extra={"target": str(target), "attempt": attempt + 1, "offset": offset},
        )
        time.sleep(min(2 ** attempt, 15))

    raise RuntimeError(f"Whisper 模型下载失败（已重试 {retries} 次）: {last_error}")


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
        return {
            "status": "idle",
            "stage": "",
            "progress": 0.0,
            "bytesDownloaded": 0,
            "totalBytes": None,
            "error": None,
            "startedAt": None,
            "updatedAt": None,
        }
    return dict(status)


def list_download_statuses() -> list[dict[str, Any]]:
    """Return only downloads started in this process; safe for frequent polling."""
    with _status_lock:
        return [
            {"modelId": model_id, **dict(status)}
            for model_id, status in _download_status.items()
        ]


def is_active_model(model_id: str, engine: str, size: str) -> bool:
    parts = model_id.split(":", 1)
    if len(parts) != 2:
        return False
    candidate_engine, candidate_size = parts
    if candidate_engine != engine:
        return False
    if engine == "funasr" and candidate_size in {"tiny", "base", "medium"}:
        return size in {"tiny", "base", "medium"}
    return candidate_size == size


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
        cache_dir = cached_modelscope_dir(cache_pattern)
        if cache_dir:
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
