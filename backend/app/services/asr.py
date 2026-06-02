"""语音识别服务模块"""

from __future__ import annotations

import logging
import subprocess
import uuid
from pathlib import Path
from typing import TypedDict

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# 运行时 ASR 配置（内存存储，重启后恢复默认值）
_asr_runtime_overrides: dict[str, str | bool] = {}


def get_asr_config() -> dict:
    """获取 ASR 配置（优先使用运行时配置）"""
    settings = get_settings()
    return {
        "model": _asr_runtime_overrides.get("model", settings.asr_model),
        "model_size": _asr_runtime_overrides.get("model_size", settings.asr_model_size),
        "device": _asr_runtime_overrides.get("device", settings.asr_device),
        "language": _asr_runtime_overrides.get("language", settings.asr_language),
        "auto_transcribe": _asr_runtime_overrides.get("auto_transcribe", settings.asr_auto_transcribe),
        "hotwords": _asr_runtime_overrides.get("hotwords", settings.asr_hotwords),
        "audio_sample_rate": _asr_runtime_overrides.get("audio_sample_rate", settings.asr_audio_sample_rate),
        "max_concurrent": settings.asr_max_concurrent,
        "timeout_seconds": settings.asr_timeout_seconds,
    }


def update_asr_config(updates: dict) -> dict:
    """更新运行时 ASR 配置"""
    allowed_keys = {"model", "model_size", "device", "language", "auto_transcribe", "hotwords", "audio_sample_rate"}
    for key, value in updates.items():
        if key in allowed_keys:
            _asr_runtime_overrides[key] = value

    # 如果更新了 max_concurrent，需要同步到 transcription 模块
    if "max_concurrent" in updates:
        from app.services.transcription import set_max_concurrent_transcriptions
        set_max_concurrent_transcriptions(int(updates["max_concurrent"]))

    return get_asr_config()


class TranscriptionSegment(TypedDict):
    """识别结果片段"""
    start: float
    end: float
    text: str
    confidence: float


class ASRService:
    """语音识别服务"""

    def __init__(self):
        self.settings = get_settings()
        self._model = None
        self._model_loaded = False
        self._current_model_type = None
        self._current_model_size = None

    @property
    def model_loaded(self) -> bool:
        return self._model_loaded

    def invalidate_model(self):
        """清除已加载的模型，下次使用时重新加载"""
        self._model = None
        self._model_loaded = False
        self._current_model_type = None
        self._current_model_size = None

    def _get_runtime_asr_config(self) -> dict:
        """获取 ASR 配置（优先使用运行时配置）"""
        return get_asr_config()

    def _load_model(self, max_retries: int = 2):
        """延迟加载 ASR 模型，支持重试"""
        config = self._get_runtime_asr_config()
        model_type = config["model"]
        model_size = config["model_size"]
        device = config["device"]

        # 如果模型类型或大小变了，需要重新加载
        if self._model is not None:
            if self._current_model_type == model_type and self._current_model_size == model_size:
                return self._model
            # 配置变了，清除旧模型
            self.invalidate_model()

        last_error = None
        for attempt in range(max_retries + 1):
            logger.info(f"Loading ASR model: {model_type} ({model_size}) on {device} (attempt {attempt + 1})")

            try:
                if model_type == "funasr":
                    self._model = self._load_funasr(model_size, device)
                elif model_type == "sensevoice":
                    self._model = self._load_sensevoice(model_size, device)
                elif model_type == "whisper":
                    self._model = self._load_whisper(model_size, device)
                else:
                    raise ValueError(f"Unknown ASR model: {model_type}")

                self._model_loaded = True
                self._current_model_type = model_type
                self._current_model_size = model_size
                logger.info(f"ASR model loaded successfully: {model_type}")
                return self._model

            except Exception as e:
                last_error = e
                logger.warning(f"Failed to load ASR model (attempt {attempt + 1}): {e}")
                if attempt < max_retries:
                    import time
                    time.sleep(1)  # 短暂等待后重试

        self._model_loaded = False
        raise last_error

    def _load_funasr(self, model_size: str, device: str):
        """加载 FunASR 模型"""
        try:
            import torch
            from funasr import AutoModel

            # 根据模型大小选择模型
            model_map = {
                "tiny": "paraformer-zh",
                "base": "paraformer-zh",
                "medium": "paraformer-zh",
                "large": "paraformer-large-zh",
            }
            model_name = model_map.get(model_size, "paraformer-zh")

            # 确定设备
            if device == "auto":
                if torch.cuda.is_available():
                    actual_device = "cuda"
                elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                    actual_device = "mps"
                else:
                    actual_device = "cpu"
            else:
                actual_device = device

            logger.info(f"Using device: {actual_device}")

            return AutoModel(
                model=model_name,
                vad_model="fsmn-vad",
                punc_model="ct-punc",
                device=actual_device,
            )
        except ImportError:
            raise ImportError("FunASR not installed. Run: pip install funasr")

    def _load_sensevoice(self, model_size: str, device: str):
        """加载 SenseVoice 模型"""
        try:
            from funasr import AutoModel

            return AutoModel(
                model="iic/SenseVoiceSmall",
                vad_model="fsmn-vad",
                punc_model="ct-punc",
                device=device if device != "auto" else None,
            )
        except ImportError:
            raise ImportError("FunASR not installed. Run: pip install funasr")

    def _load_whisper(self, model_size: str, device: str):
        """加载 Whisper 模型"""
        try:
            import whisper

            return whisper.load_model(model_size, device=device if device != "auto" else "cpu")
        except ImportError:
            raise ImportError("Whisper not installed. Run: pip install openai-whisper")

    def extract_audio(self, video_path: str) -> str:
        """FFmpeg 提取音频"""
        settings = get_settings()
        config = self._get_runtime_asr_config()
        sample_rate = config.get("audio_sample_rate", 16000)

        # 使用唯一标识符避免并发冲突
        unique_id = uuid.uuid4().hex[:8]
        audio_path = settings.tmp_path / f"audio_{Path(video_path).stem}_{unique_id}.wav"

        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", str(sample_rate),
            "-ac", "1",
            str(audio_path)
        ]

        logger.info(f"Extracting audio: {video_path} -> {audio_path}")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0:
            error_msg = result.stderr.strip() or "ffmpeg failed"
            logger.error(f"Audio extraction failed: {error_msg}")
            raise RuntimeError(f"Audio extraction failed: {error_msg}")

        return str(audio_path)

    def transcribe(self, audio_path: str) -> list[TranscriptionSegment]:
        """语音识别，返回带时间戳的文字"""
        model = self._load_model()
        config = self._get_runtime_asr_config()
        model_type = config["model"]
        hotwords = config.get("hotwords") or None

        logger.info(f"Transcribing audio: {audio_path}")

        try:
            if model_type in ("funasr", "sensevoice"):
                return self._transcribe_funasr(model, audio_path, hotwords)
            elif model_type == "whisper":
                return self._transcribe_whisper(model, audio_path)
            else:
                raise ValueError(f"Unknown ASR model: {model_type}")
        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            raise

    def _transcribe_funasr(self, model, audio_path: str, hotwords: str | None) -> list[TranscriptionSegment]:
        """FunASR 识别"""
        # 转换热词格式：逗号分隔 -> 空格分隔（FunASR 格式）
        formatted_hotwords = None
        if hotwords:
            formatted_hotwords = " ".join(hotwords.split(","))

        result = model.generate(
            input=audio_path,
            hotword=formatted_hotwords,
        )

        logger.debug(f"FunASR result: {len(result) if result else 0} items")

        segments = []
        if result and len(result) > 0:
            for item in result:
                text = item.get("text", "") if isinstance(item, dict) else str(item)
                timestamp = item.get("timestamp", []) if isinstance(item, dict) else []

                if not text:
                    continue

                if timestamp and len(timestamp) > 0:
                    for ts in timestamp:
                        if isinstance(ts, (list, tuple)) and len(ts) == 2:
                            start = ts[0] / 1000.0
                            end = ts[1] / 1000.0
                            segments.append(TranscriptionSegment(
                                start=start,
                                end=end,
                                text=text,
                                confidence=0.9,
                            ))
                else:
                    segments.append(TranscriptionSegment(
                        start=0.0,
                        end=0.0,
                        text=text,
                        confidence=0.9,
                    ))

        logger.debug(f"Parsed {len(segments)} segments")
        return segments

    def _transcribe_whisper(self, model, audio_path: str) -> list[TranscriptionSegment]:
        """Whisper 识别"""
        result = model.transcribe(audio_path, language=self.settings.asr_language)

        segments = []
        for segment in result.get("segments", []):
            segments.append(TranscriptionSegment(
                start=segment["start"],
                end=segment["end"],
                text=segment["text"].strip(),
                confidence=segment.get("avg_logprob", 0.0),
            ))

        return segments

    def process_video(self, video_path: str, timeout: int = 600) -> list[TranscriptionSegment]:
        """处理单个视频，返回识别结果

        Args:
            video_path: 视频文件路径
            timeout: 超时时间（秒），默认 10 分钟
        """
        import signal

        audio_path = None
        try:
            # 提取音频
            audio_path = self.extract_audio(video_path)

            # 设置超时
            def timeout_handler(signum, frame):
                raise TimeoutError(f"Transcription timed out after {timeout} seconds")

            old_handler = signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(timeout)

            try:
                # 识别
                segments = self.transcribe(audio_path)
                return segments
            finally:
                # 恢复信号处理
                signal.alarm(0)
                signal.signal(signal.SIGALRM, old_handler)

        finally:
            # 清理临时音频文件
            if audio_path and Path(audio_path).exists():
                try:
                    Path(audio_path).unlink()
                except Exception:
                    pass


# 单例
_asr_service: ASRService | None = None


def get_asr_service() -> ASRService:
    """获取 ASR 服务单例"""
    global _asr_service
    if _asr_service is None:
        _asr_service = ASRService()
    return _asr_service
