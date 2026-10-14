import hashlib
import json
import re

from sqlalchemy import select

from app.core.errors import AppError
from app.core.time import iso_utc
from app.db.models import SavedSettings, Segment
from app.services.playback import original_path
from app.services.timeline import local_day, require_source


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def merged(intervals):
    result = []
    for start, end in sorted(intervals):
        if result and start <= result[-1][1]:
            result[-1][1] = max(result[-1][1], end)
        else:
            result.append([start, end])
    return result


def safe_filename(name):
    cleaned = re.sub(r"[\x00-\x1f\x7f/\\]", "_", name).strip(" .")[:100] or "Clipline录像"
    return cleaned if cleaned.lower().endswith(".mp4") else cleaned + ".mp4"


def build_plan(session, config, body):
    source = require_source(session, body.source_id)
    if body.start_at.tzinfo is None or body.end_at.tzinfo is None:
        raise AppError("INVALID_TIMESTAMP", "导出时间必须包含时区。")
    start, end = int(body.start_at.timestamp() * 1000), int(body.end_at.timestamp() * 1000)
    timezone = body.view_timezone or config.timezone
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        date = body.date or body.start_at.astimezone(ZoneInfo(timezone)).date()
    except (ValueError, ZoneInfoNotFoundError) as error:
        raise AppError("INVALID_TIMEZONE", "导出时区无效。") from error
    day_start, day_end = local_day(date, timezone)
    if end <= start or start < day_start or end > day_end:
        raise AppError("INVALID_EXPORT_RANGE", "请选择同一天内、结束晚于开始的录像区间。")
    setting = session.get(SavedSettings, "export")
    maximum = setting.value_json.get("maxDuration", 30) if setting else 30
    maximum = maximum if type(maximum) is int and 1 <= maximum <= 1440 else 30
    if end - start > maximum * 60_000:
        raise AppError("EXPORT_RANGE_TOO_LARGE", f"单次导出跨度不能超过 {maximum} 分钟。")
    rows = list(
        session.scalars(
            select(Segment)
            .where(
                Segment.source_id == body.source_id,
                Segment.availability == "available",
                Segment.start_at < end,
                Segment.end_at > start,
            )
            .order_by(Segment.start_at, Segment.id)
        )
    )
    selected_ids = sorted(set(body.segment_ids)) if body.segment_ids is not None else None
    if selected_ids is not None:
        known = {row.id for row in rows}
        if not selected_ids or not set(selected_ids).issubset(known):
            raise AppError(
                "INVALID_EXPORT_SELECTION", "所选片段需可用且属于同一源、所选日期和区间。"
            )
    selected = [row for row in rows if selected_ids is None or row.id in selected_ids]
    if len(selected) > config.export_max_pieces:
        raise AppError(
            "EXPORT_TOO_MANY_FILES", f"单次最多选择 {config.export_max_pieces} 个输入文件。"
        )
    recorded = merged([(max(start, row.start_at), min(end, row.end_at)) for row in rows])
    pieces, cursor = [], start
    for row in selected:
        left, right = max(start, row.start_at, cursor), min(end, row.end_at)
        if right <= left:
            continue
        original_path(session, config, row)
        pieces.append(
            {
                "segmentId": row.id,
                "fingerprint": row.fingerprint,
                "startAt": iso_utc(left),
                "endAt": iso_utc(right),
                "offsetStartMs": left - row.start_at,
                "offsetEndMs": right - row.start_at,
                "durationMs": right - left,
                "audio": row.audio_codec is not None,
                "sizeBytes": row.size_bytes,
                "sourceDurationMs": row.duration_ms,
            }
        )
        cursor = right
    selected_ms = sum(piece["durationMs"] for piece in pieces)
    if not selected_ms:
        raise AppError("EXPORT_NO_RECORDING", "所选区间没有可导出的录像。")
    recorded_ms = sum(b - a for a, b in recorded)
    profile = {
        "fps": config.export_fps,
        "maxWidth": config.export_max_width,
        "crf": 20,
        "implementation": "export-v1",
    }
    mode = (
        body.mode
        if "mode" in body.model_fields_set
        else (setting.value_json.get("defaultMode", "fast") if setting else "fast")
    )
    return {
        "sourceId": body.source_id,
        "sourcePath": source.canonical_path,
        "date": date.isoformat(),
        "viewTimezone": timezone,
        "startAt": iso_utc(start),
        "endAt": iso_utc(end),
        "name": safe_filename(body.name),
        "mode": mode,
        "segmentIds": selected_ids,
        "recordedCoverageMs": recorded_ms,
        "selectedCoverageMs": selected_ms,
        "unrecordedMs": end - start - recorded_ms,
        "omittedMs": recorded_ms - selected_ms,
        "expectedDurationMs": selected_ms,
        "pieces": pieces,
        "profile": profile,
    }


def validate_inputs(session, config, plan):
    source = require_source(session, plan["sourceId"])
    if source.canonical_path != plan.get("sourcePath", source.canonical_path):
        raise AppError("INPUT_CHANGED", "录像源目录已变化，请重新选择导出区间。", 409)
    paths = []
    for piece in plan["pieces"]:
        row = session.get(Segment, piece["segmentId"])
        if (
            row is None
            or row.source_id != plan["sourceId"]
            or row.fingerprint != piece["fingerprint"]
            or row.availability != "available"
        ):
            raise AppError("INPUT_CHANGED", "输入录像已变化，请重新选择区间后提交。", 409)
        if (
            iso_utc(row.start_at + piece["offsetStartMs"]) != piece["startAt"]
            or iso_utc(row.start_at + piece["offsetEndMs"]) != piece["endAt"]
        ):
            raise AppError("INPUT_CHANGED", "录像时间索引已变化，请重新选择区间。", 409)
        try:
            paths.append(original_path(session, config, row))
        except AppError as error:
            raise AppError(
                "INPUT_CHANGED", "输入录像已变化或不可读，未发布导出结果。", 409
            ) from error
    return paths


def public_plan(plan):
    return {
        key: value for key, value in plan.items() if key not in ("pieces", "profile", "sourcePath")
    } | {
        "pieceCount": len(plan["pieces"]),
        "planHash": digest(plan),
    }
