"""搜索服务模块"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import select, func, or_, and_
from sqlalchemy.orm import Session

from app.models import Transcription, VideoSegment, Source
from app.services.common import now_iso

logger = logging.getLogger(__name__)


def search_transcriptions(
    db: Session,
    query: str,
    source_id: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """
    全文检索

    Args:
        db: 数据库会话
        query: 搜索关键词
        source_id: 按摄像头筛选
        start_date: 开始日期 (ISO 格式)
        end_date: 结束日期 (ISO 格式)
        limit: 返回数量限制
        offset: 偏移量

    Returns:
        搜索结果
    """
    if not query or not query.strip():
        return {"items": [], "total": 0, "limit": limit, "offset": offset}

    query = query.strip()

    # 构建查询
    # SELECT t.*, v.source_id, v.start_time as segment_start_time, s.name as source_name
    # FROM transcriptions t
    # JOIN video_segments v ON t.segment_id = v.id
    # JOIN sources s ON v.source_id = s.id
    # WHERE t.text LIKE '%关键词%'
    # ORDER BY v.start_time DESC
    # LIMIT 50 OFFSET 0

    # 基础查询
    base_query = (
        select(
            Transcription,
            VideoSegment.source_id,
            VideoSegment.start_time.label("segment_start_time"),
            Source.name.label("source_name"),
        )
        .join(VideoSegment, Transcription.segment_id == VideoSegment.id)
        .join(Source, VideoSegment.source_id == Source.id)
        .where(Transcription.text.contains(query))
    )

    # 应用筛选条件
    filters = []

    if source_id:
        filters.append(VideoSegment.source_id == source_id)

    if start_date:
        filters.append(VideoSegment.start_time >= start_date)

    if end_date:
        filters.append(VideoSegment.start_time <= end_date)

    if filters:
        base_query = base_query.where(and_(*filters))

    # 计算总数
    count_query = select(func.count()).select_from(base_query.subquery())
    total = db.scalar(count_query) or 0

    # 获取结果
    results_query = (
        base_query
        .order_by(VideoSegment.start_time.desc())
        .limit(limit)
        .offset(offset)
    )
    results = db.execute(results_query).all()

    # 转换结果
    items = []
    for row in results:
        transcription = row[0]
        source_id = row[1]
        segment_start_time = row[2]
        source_name = row[3]

        # 高亮匹配的文本
        highlight = _highlight_text(transcription.text, query)

        items.append({
            "transcription": {
                "id": transcription.id,
                "segmentId": transcription.segment_id,
                "startTime": transcription.start_time,
                "endTime": transcription.end_time,
                "text": transcription.text,
                "confidence": transcription.confidence,
                "createdAt": transcription.created_at,
            },
            "segmentId": transcription.segment_id,
            "segmentStartTime": segment_start_time,
            "sourceId": source_id,
            "sourceName": source_name,
            "highlight": highlight,
        })

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def _highlight_text(text: str, query: str, context_chars: int = 50) -> str:
    """
    高亮匹配的文本，返回带上下文的片段

    Args:
        text: 原始文本
        query: 搜索关键词
        context_chars: 上下文字符数

    Returns:
        高亮后的文本片段
    """
    # 查找匹配位置
    index = text.lower().find(query.lower())
    if index == -1:
        # 如果没找到，返回前 context_chars 个字符
        return text[:context_chars * 2] + ("..." if len(text) > context_chars * 2 else "")

    # 计算上下文范围
    start = max(0, index - context_chars)
    end = min(len(text), index + len(query) + context_chars)

    # 构建高亮文本
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(text) else ""

    before = text[start:index]
    match = text[index:index + len(query)]
    after = text[index + len(query):end]

    return f"{prefix}{before}**{match}**{after}{suffix}"


def get_search_suggestions(db: Session, query: str, limit: int = 10) -> list[str]:
    """
    获取搜索建议

    Args:
        db: 数据库会话
        query: 搜索关键词
        limit: 返回数量限制

    Returns:
        搜索建议列表
    """
    if not query or len(query) < 2:
        return []

    # 查找以查询开头的文本
    results = db.scalars(
        select(Transcription.text)
        .where(Transcription.text.contains(query))
        .limit(limit)
        .distinct()
    ).all()

    # 去重并返回
    suggestions = list(set(results))
    return suggestions[:limit]


def get_popular_searches(db: Session, limit: int = 10) -> list[str]:
    """
    获取热门搜索

    Args:
        db: 数据库会话
        limit: 返回数量限制

    Returns:
        热门搜索列表
    """
    # 统计最常见的文本片段
    results = db.scalars(
        select(Transcription.text)
        .group_by(Transcription.text)
        .order_by(func.count().desc())
        .limit(limit)
    ).all()

    return results
