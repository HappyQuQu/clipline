"""语音识别服务模块"""

from __future__ import annotations

import logging
import subprocess
import tempfile
from pathlib import Path
from typing import TypedDict

from app.core.config import get_settings

logger = logging.getLogger(__name__)


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

    @property
    def model_loaded(self) -> bool:
        return self._model_loaded

    def _load_model(self):
        """延迟加载 ASR 模型"""
        if self._model is not None:
            return self._model

        model_type = self.settings.asr_model
        model_size = self.settings.asr_model_size
        device = self.settings.asr_device

        logger.info(f"Loading ASR model: {model_type} ({model_size}) on {device}")

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
            logger.info(f"ASR model loaded successfully: {model_type}")
            return self._model

        except Exception as e:
            logger.error(f"Failed to load ASR model: {e}")
            self._model_loaded = False
            raise

    def _load_funasr(self, model_size: str, device: str):
        """加载 FunASR 模型"""
        try:
            from funasr import AutoModel

            # 根据模型大小选择模型
            model_map = {
                "tiny": "paraformer-zh",
                "base": "paraformer-zh",
                "medium": "paraformer-zh",
                "large": "paraformer-large-zh",
            }
            model_name = model_map.get(model_size, "paraformer-zh")

            return AutoModel(
                model=model_name,
                vad_model="fsmn-vad",
                punc_model="ct-punc",
                device=device if device != "auto" else None,
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
        audio_path = settings.tmp_path / f"audio_{Path(video_path).stem}.wav"

        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
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
        model_type = self.settings.asr_model
        hotwords = self.settings.asr_hotwords if self.settings.asr_hotwords else None

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
        result = model.generate(
            input=audio_path,
            hotword=hotwords,
        )

        segments = []
        if result and len(result) > 0:
            # FunASR 返回格式: [{"text": "...", "timestamp": [[start, end], ...]}]
            for item in result:
                text = item.get("text", "")
                timestamp = item.get("timestamp", [])

                if timestamp:
                    # 有时间戳的情况
                    for ts in timestamp:
                        start = ts[0] / 1000.0  # 毫秒转秒
                        end = ts[1] / 1000.0
                        segments.append(TranscriptionSegment(
                            start=start,
                            end=end,
                            text=text,
                            confidence=0.9,
                        ))
                else:
                    # 没有时间戳的情况，估计时长
                    segments.append(TranscriptionSegment(
                        start=0.0,
                        end=0.0,
                        text=text,
                        confidence=0.9,
                    ))

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

    def process_video(self, video_path: str) -> list[TranscriptionSegment]:
        """处理单个视频，返回识别结果"""
        audio_path = None
        try:
            # 提取音频
            audio_path = self.extract_audio(video_path)

            # 识别
            segments = self.transcribe(audio_path)

            return segments

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
