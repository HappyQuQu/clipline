import json
import math
import subprocess
import tempfile
import time
from fractions import Fraction
from pathlib import Path

from app.core.errors import AppError


def run_process(args, context, timeout):
    directory = context.config.data / "tmp"
    with (
        tempfile.TemporaryFile(dir=directory) as output,
        tempfile.TemporaryFile(dir=directory) as error,
    ):
        # Inherit the worker process group: runtime can reap media even if the worker is killed.
        process = subprocess.Popen(args, stdout=output, stderr=error, stdin=subprocess.DEVNULL)
        deadline = time.monotonic() + timeout
        try:
            while process.poll() is None:
                context.check()
                if time.monotonic() >= deadline:
                    raise AppError("MEDIA_TIMEOUT", "媒体文件处理超时，请检查文件或设备。")
                if output.tell() > 1024 * 1024 or error.tell() > 1024 * 1024:
                    raise AppError("MEDIA_OUTPUT_TOO_LARGE", "媒体探测输出过大，文件可能异常。")
                context.stopped.wait(0.1)
            context.check()
            if process.returncode != 0:
                raise AppError("INVALID_MEDIA", "无法读取有效的录像信息。")
            output.seek(0)
            return output.read(1024 * 1024)
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


def probe(path, context):
    raw = run_process(
        [
            "ffprobe",
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
            "-format_whitelist",
            "mov,matroska,mpegts",
            "-show_entries",
            "format=format_name,duration:stream=codec_type,codec_name,width,height,"
            "avg_frame_rate,duration:stream_disposition=attached_pic",
            "-of",
            "json",
            str(path),
        ],
        context,
        context.config.probe_timeout_seconds,
    )
    try:
        data = json.loads(raw)
        videos = [
            row
            for row in data.get("streams", [])
            if row.get("codec_type") == "video"
            and not row.get("disposition", {}).get("attached_pic")
        ]
        video = videos[0]
        duration = float(data.get("format", {}).get("duration") or video.get("duration") or 0)
        if not math.isfinite(duration) or duration <= 0 or duration > 365 * 86400:
            raise ValueError("Invalid duration")
        if int(video.get("width", 0)) <= 0 or int(video.get("height", 0)) <= 0:
            raise ValueError("Invalid video dimensions")
        audio = next(
            (row for row in data.get("streams", []) if row.get("codec_type") == "audio"), {}
        )
        try:
            fps = Fraction(video.get("avg_frame_rate", "0/1"))
        except (ValueError, ZeroDivisionError):
            fps = Fraction(0)
        return {
            "duration_ms": max(1, round(duration * 1000)),
            "container": data["format"]["format_name"],
            "video_codec": video["codec_name"],
            "audio_codec": audio.get("codec_name"),
            "width": int(video["width"]),
            "height": int(video["height"]),
            "fps_num": fps.numerator,
            "fps_den": fps.denominator,
        }
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise AppError("INVALID_MEDIA_METADATA", "录像文件缺少有效的视频参数或时长。") from error


def make_thumbnail(path, metadata, target: Path, context):
    run_process(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
            "-format_whitelist",
            "mov,matroska,mpegts",
            "-threads",
            str(context.config.media_threads),
            "-i",
            str(path),
            "-map",
            "0:V:0",
            "-frames:v",
            "1",
            "-vf",
            "scale=384:-2",
            "-threads",
            str(context.config.media_threads),
            "-y",
            str(target),
        ],
        context,
        context.config.thumbnail_timeout_seconds,
    )
    if not target.is_file() or not 0 < target.stat().st_size <= 2 * 1024 * 1024:
        raise AppError("INVALID_THUMBNAIL", "录像预览图生成失败。")
    with target.open("rb") as stream:
        if stream.read(2) != b"\xff\xd8":
            raise AppError("INVALID_THUMBNAIL", "录像预览图格式异常。")
