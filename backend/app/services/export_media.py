"""Bounded, cancellable export commands. All concat paths are generated locally."""

import json
import math
import shutil
import time
from fractions import Fraction

from app.core.errors import AppError
from app.services.media import run_process


def inspect(path, context, *, frames=False):
    args = [
        "ffprobe",
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-threads",
        str(context.config.media_threads),
        "-show_data_hash",
        "sha256",
    ]
    if frames:
        args += ["-count_frames"]
    args += [
        "-show_entries",
        "format=duration:stream=codec_type,codec_name,profile,level,pix_fmt,width,height,sample_aspect_ratio,time_base,r_frame_rate,sample_rate,channels,channel_layout,extradata_hash,start_time,duration,nb_read_frames",
        "-of",
        "json",
        str(path),
    ]
    try:
        value = json.loads(
            run_process(
                args,
                context,
                context.config.export_timeout_seconds
                if frames
                else context.config.probe_timeout_seconds,
            )
        )
        video = next(row for row in value["streams"] if row["codec_type"] == "video")
        duration = float(value["format"]["duration"])
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError()
        return value, video
    except (ValueError, KeyError, StopIteration) as error:
        raise AppError("INVALID_EXPORT_OUTPUT", "导出文件参数校验失败。") from error


def verify_timestamps(path, context, precise, fps, expected_ms):
    packet_file = path.parent / "packets.csv"
    run_process(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_packets",
            "-show_entries",
            "packet=stream_index,pts_time,dts_time,duration_time",
            "-of",
            "csv=p=0",
            "-o",
            str(packet_file),
            str(path),
        ],
        context,
        context.config.export_timeout_seconds,
    )
    last_dts, video_count, first_pts, last_pts = {}, 0, None, None
    with packet_file.open() as handle:
        for index, line in enumerate(handle):
            if index % 1000 == 0:
                context.check()
            values = line.strip().split(",")
            if len(values) < 4 or not values[0].isdigit():
                continue
            stream = int(values[0])
            try:
                pts, dts = float(values[1]), float(values[2])
            except ValueError as error:
                raise AppError("INVALID_EXPORT_OUTPUT", "导出包缺少有效时间戳。") from error
            if (
                not math.isfinite(pts)
                or not math.isfinite(dts)
                or dts < last_dts.get(stream, dts) - 0.00001
            ):
                raise AppError("INVALID_EXPORT_OUTPUT", "导出时间戳不连续，结果未发布。")
            last_dts[stream] = dts
            if stream == 0:
                if precise and last_pts is not None and abs(pts - last_pts - 1 / fps) > 0.00002:
                    raise AppError("INVALID_EXPORT_OUTPUT", "精准导出帧时间不连续。")
                first_pts = pts if first_pts is None else first_pts
                last_pts = pts
                video_count += 1
    if video_count == 0:
        raise AppError("INVALID_EXPORT_OUTPUT", "导出文件没有视频包。")
    if precise and (
        abs(first_pts) > 1 / fps
        or abs((last_pts - first_pts + 1 / fps) * 1000 - expected_ms) > 1000 / fps + 1
    ):
        raise AppError("INVALID_EXPORT_OUTPUT", "精准导出边界时间校验失败。")
    packet_file.unlink(missing_ok=True)


def compatible(metadata):
    signatures = []
    for data, video in metadata:
        audio = next((row for row in data["streams"] if row["codec_type"] == "audio"), None)
        if video["codec_name"] not in ("h264", "hevc", "mpeg4") or (
            audio and audio["codec_name"] not in ("aac", "mp3", "ac3", "eac3", "opus")
        ):
            raise AppError("FAST_UNSUPPORTED", "原编码无法快速封装为 MP4，请选择精准模式重试。")
        # r_frame_rate is a probe estimate, not a codec parameter. Matching
        # codec headers/time bases can carry different packet frame intervals.
        keys = (
            "codec_name",
            "profile",
            "level",
            "pix_fmt",
            "width",
            "height",
            "sample_aspect_ratio",
            "time_base",
            "extradata_hash",
        )
        audio_keys = (
            "codec_name",
            "sample_rate",
            "channels",
            "channel_layout",
            "time_base",
            "extradata_hash",
        )
        signatures.append(
            (
                [video.get(key) for key in keys],
                [audio.get(key) for key in audio_keys] if audio else None,
            )
        )
    if any(row != signatures[0] for row in signatures):
        raise AppError(
            "FAST_INCOMPATIBLE", "片段编码参数不一致，无法快速拼接，请选择精准模式重试。"
        )


def render(paths, plan, target, context):
    metadata = [inspect(path, context) for path in paths]
    precise = plan["mode"] == "precise"
    if not precise:
        compatible(metadata)
    fps = plan["profile"]["fps"]
    video = metadata[0][1]
    width = min(plan["profile"]["maxWidth"], int(video["width"])) // 2 * 2
    height = max(2, round(int(video["height"]) * width / int(video["width"]) / 2) * 2)
    audio = any(piece["audio"] for piece in plan["pieces"])
    cumulative = prior_frames = 0
    parts, durations = [], []
    deadline = time.monotonic() + context.config.export_timeout_seconds
    progress_path = target.parent / "progress.txt"
    last_update = 0

    def command(args, base, length, stage):
        nonlocal last_update
        progress_path.unlink(missing_ok=True)

        def poll():
            nonlocal last_update
            if time.monotonic() - last_update < 0.5:
                return
            last_update = time.monotonic()
            if shutil.disk_usage(context.config.data).free < 64 * 1024**2:
                raise AppError("INSUFFICIENT_STORAGE", "数据目录剩余空间不足，导出已停止。")
            values = {}
            if progress_path.exists():
                with progress_path.open("rb") as handle:
                    handle.seek(max(0, progress_path.stat().st_size - 8192))
                    values = dict(
                        line.split("=", 1)
                        for line in handle.read().decode(errors="ignore").splitlines()
                        if "=" in line
                    )
            try:
                processed = min(length, max(0, int(values.get("out_time_us", 0)) // 1000))
            except ValueError:
                return
            percentage = (
                81 + round(processed / length * 12)
                if stage == "concat"
                else 3 + round((base + processed) / plan["expectedDurationMs"] * 76)
            )
            context.update(
                stage,
                min(93, percentage),
                {"outTimeMs": base + processed},
            )

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise AppError("MEDIA_TIMEOUT", "导出超时，请缩短区间后重试。")
        run_process(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-filter_threads",
                str(context.config.media_threads),
                "-filter_complex_threads",
                str(context.config.media_threads),
            ]
            + args
            + ["-progress", str(progress_path), "-y"],
            context,
            remaining,
            poll,
        )

    for index, (path, piece) in enumerate(zip(paths, plan["pieces"], strict=True)):
        context.check()
        part = target.parent / f"part-{index:04d}.{'nut' if precise else 'mp4'}"
        args = [
            "-protocol_whitelist",
            "file",
            "-threads",
            str(context.config.media_threads),
            "-ss",
            f"{piece['offsetStartMs'] / 1000:.6f}",
            "-i",
            str(path),
        ]
        if precise:
            cumulative += piece["durationMs"]
            total_frames = round(cumulative * fps / 1000)
            frame_count = total_frames - prior_frames
            prior_frames = total_frames
            if frame_count < 1:
                raise AppError("EXPORT_RANGE_TOO_SHORT", "片段区间短于一个输出帧，请扩大区间。")
            duration = frame_count / fps
            if audio and not piece["audio"]:
                args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
            args += [
                "-map",
                "0:V:0",
                "-vf",
                f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},tpad=stop_mode=clone:stop_duration=1,trim=end_frame={frame_count},setpts=N/({fps}*TB)",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                str(plan["profile"]["crf"]),
                "-pix_fmt",
                "yuv420p",
                "-bf",
                "0",
                "-threads",
                str(context.config.media_threads),
            ]
            if audio:
                args += [
                    "-map",
                    "0:a:0" if piece["audio"] else "1:a:0",
                    "-af",
                    (
                        "aresample=48000:async=1:first_pts=0,apad,"
                        f"atrim=end_sample={round(duration * 48000)},asetpts=N/SR/TB"
                    ),
                    "-c:a",
                    "pcm_s16le",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                ]
            args += ["-t", f"{duration:.9f}", "-f", "nut", str(part)]
        else:
            args += [
                "-t",
                f"{piece['durationMs'] / 1000:.6f}",
                "-map",
                "0:V:0",
                "-map",
                "0:a:0?",
                "-c",
                "copy",
                "-avoid_negative_ts",
                "make_zero",
                "-strict",
                "-2",
                str(part),
            ]
            duration = None
        command(
            args,
            sum(p["durationMs"] for p in plan["pieces"][:index]),
            piece["durationMs"],
            "transcode" if precise else "cut",
        )
        part_meta, _ = inspect(part, context)
        if (
            not precise
            and abs(float(part_meta["format"]["duration"]) * 1000 - piece["durationMs"]) > 5000
        ):
            raise AppError(
                "FAST_BOUNDARY_UNSAFE", "关键帧间隔过长，快速裁剪偏差超过 5 秒，请用精准模式重试。"
            )
        durations.append(duration or float(part_meta["format"]["duration"]))
        parts.append(part)
    listing = target.parent / "concat.txt"
    listing.write_text(
        "ffconcat version 1.0\n"
        + "".join(
            f"file '{part.name}'\nduration {duration:.9f}\n"
            for part, duration in zip(parts, durations, strict=True)
        )
    )
    args = [
        "-protocol_whitelist",
        "file",
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
        str(listing),
        "-map",
        "0:V:0",
        "-map",
        "0:a:0?",
        "-c:v",
        "copy",
        "-c:a",
        "aac" if precise else "copy",
        "-strict",
        "-2",
        "-movflags",
        "+faststart",
        str(target),
    ]
    command(args, 0, plan["expectedDurationMs"], "concat")
    context.update("verify", 95, {})
    output, stream = inspect(target, context, frames=precise)
    actual = round(float(output["format"]["duration"]) * 1000)
    verify_timestamps(target, context, precise, fps, plan["expectedDurationMs"])
    warnings = []
    if precise:
        expected_frames = round(plan["expectedDurationMs"] * fps / 1000)
        if (
            int(stream.get("nb_read_frames", 0)) != expected_frames
            or abs(float(stream.get("duration", 0)) * 1000 - plan["expectedDurationMs"])
            > 1000 / fps + 1
        ):
            raise AppError("INVALID_EXPORT_OUTPUT", "精准导出帧数或时长校验失败，结果未发布。")
        if abs(float(stream.get("start_time", 0))) > 1 / fps:
            raise AppError("INVALID_EXPORT_OUTPUT", "视频起始时间校验失败。")
        audio_stream = next(
            (row for row in output["streams"] if row["codec_type"] == "audio"), None
        )
        if audio and (
            not audio_stream
            or abs(float(audio_stream.get("duration", 0)) * 1000 - expected_frames / fps * 1000)
            > 50
            or abs(float(audio_stream.get("start_time", 0))) > 0.05
        ):
            raise AppError("INVALID_EXPORT_OUTPUT", "音视频时间校验失败，结果未发布。")
        # Decode every published precise output, catching broken frames after concatenation.
        run_process(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-xerror",
                "-threads",
                str(context.config.media_threads),
                "-i",
                str(target),
                "-map",
                "0:V:0",
                "-map",
                "0:a:0?",
                "-f",
                "null",
                "-",
            ],
            context,
            max(1, deadline - time.monotonic()),
        )
    else:
        if stream["codec_name"] != metadata[0][1]["codec_name"] or abs(
            actual - sum(durations) * 1000
        ) > max(500, len(parts) * 100):
            raise AppError("INVALID_EXPORT_OUTPUT", "快速拼接校验失败，请用精准模式重试。")
        warnings.append(
            "快速模式按关键帧裁剪，实际边界和时长可能偏移；需要精确边界请选择精准模式。"
        )
    if plan["unrecordedMs"]:
        warnings.append("已跳过没有录像的断档。")
    if plan["omittedMs"]:
        warnings.append("已跳过未选中的录像区间。")
    return {
        "actualDurationMs": actual,
        "expectedDurationMs": plan["expectedDurationMs"],
        "deviationMs": actual - plan["expectedDurationMs"],
        "videoCodec": stream["codec_name"],
        "audioCodec": next(
            (row["codec_name"] for row in output["streams"] if row["codec_type"] == "audio"), None
        ),
        "width": int(stream["width"]),
        "height": int(stream["height"]),
        "fps": fps if precise else str(Fraction(stream["r_frame_rate"])),
        "frameCount": int(stream["nb_read_frames"]) if precise else None,
        "warnings": warnings,
    }
