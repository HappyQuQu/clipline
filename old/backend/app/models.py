from sqlalchemy import Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Source(Base):
    __tablename__ = "sources"
    __table_args__ = (UniqueConstraint("name", name="uq_sources_name"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    path: Mapped[str] = mapped_column(String, nullable=False)
    enabled: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    scan_interval_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    auto_transcribe: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    auto_detect: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    recognition_trigger: Mapped[str] = mapped_column(String, nullable=False, default="manual")
    recognition_priority: Mapped[str] = mapped_column(String, nullable=False, default="normal")
    transcribe_language: Mapped[str] = mapped_column(String, nullable=False, default="global")
    detect_labels: Mapped[str] = mapped_column(Text, nullable=False, default='["person","cat","dog","vehicle","phone"]')
    detect_confidence: Mapped[int] = mapped_column(Integer, nullable=False, default=80)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)


class VideoSegment(Base):
    __tablename__ = "video_segments"
    __table_args__ = (UniqueConstraint("source_id", "path", name="uq_video_segments_source_path"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    source_id: Mapped[str] = mapped_column(String, ForeignKey("sources.id"), nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    mtime: Mapped[str | None] = mapped_column(String)
    ctime: Mapped[str | None] = mapped_column(String)
    start_time: Mapped[str | None] = mapped_column(String)
    end_time: Mapped[str | None] = mapped_column(String)
    duration_seconds: Mapped[float | None] = mapped_column(Float)
    time_source: Mapped[str | None] = mapped_column(String)
    time_confidence: Mapped[float | None] = mapped_column(Float)
    container: Mapped[str | None] = mapped_column(String)
    video_codec: Mapped[str | None] = mapped_column(String)
    audio_codec: Mapped[str | None] = mapped_column(String)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    fps: Mapped[float | None] = mapped_column(Float)
    playable: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    needs_transcode: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    scan_status: Mapped[str] = mapped_column(String, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)


class Thumbnail(Base):
    __tablename__ = "thumbnails"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    segment_id: Mapped[str] = mapped_column(String, ForeignKey("video_segments.id"), nullable=False)
    timestamp_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class ExportJob(Base):
    __tablename__ = "export_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    source_id: Mapped[str] = mapped_column(String, ForeignKey("sources.id"), nullable=False)
    start_time: Mapped[str] = mapped_column(String, nullable=False)
    end_time: Mapped[str] = mapped_column(String, nullable=False)
    mode: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    has_gaps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    gap_duration_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    output_path: Mapped[str | None] = mapped_column(Text)
    output_size_bytes: Mapped[int | None] = mapped_column(Integer)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[str | None] = mapped_column(String)


class ScanJob(Base):
    __tablename__ = "scan_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    source_id: Mapped[str | None] = mapped_column(String, ForeignKey("sources.id"))
    trigger: Mapped[str] = mapped_column(String, nullable=False, default="manual")
    status: Mapped[str] = mapped_column(String, nullable=False)
    total_files: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    scanned_files: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    indexed_files: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_files: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[str | None] = mapped_column(String)
    finished_at: Mapped[str | None] = mapped_column(String)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)


class Transcription(Base):
    __tablename__ = "transcriptions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    segment_id: Mapped[str] = mapped_column(String, ForeignKey("video_segments.id"), nullable=False, index=True)
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class TranscriptionJob(Base):
    __tablename__ = "transcription_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    segment_id: Mapped[str] = mapped_column(String, ForeignKey("video_segments.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    stage: Mapped[str] = mapped_column(String, nullable=False, default="")
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)


class VisionDetection(Base):
    __tablename__ = "vision_detections"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    segment_id: Mapped[str] = mapped_column(String, ForeignKey("video_segments.id"), nullable=False, index=True)
    source_id: Mapped[str] = mapped_column(String, ForeignKey("sources.id"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String, nullable=False, index=True)
    label_name: Mapped[str] = mapped_column(String, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    frame_time: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_json: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)


class VisionJob(Base):
    __tablename__ = "vision_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    segment_id: Mapped[str] = mapped_column(String, ForeignKey("video_segments.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    stage: Mapped[str] = mapped_column(String, nullable=False, default="")
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    model: Mapped[str] = mapped_column(String, nullable=False, default="yolov8n")
    labels_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    confidence_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=0.45)
    sample_interval_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=5.0)
    image_size: Mapped[int] = mapped_column(Integer, nullable=False, default=416)
    detections_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)
