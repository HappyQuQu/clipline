from pydantic import BaseModel, Field

DEFAULT_DETECT_LABELS = ["person", "cat", "dog", "vehicle", "phone"]


class SourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    path: str = Field(min_length=1)
    scanIntervalMinutes: int = Field(default=0, ge=0, le=1440)
    autoTranscribe: bool = False
    autoDetect: bool = False
    recognitionTrigger: str = Field(default="manual", pattern="^(manual|new_segments)$")
    recognitionPriority: str = Field(default="normal", pattern="^(low|normal|high)$")
    transcribeLanguage: str = Field(default="global", pattern="^(global|auto|zh|en)$")
    detectLabels: list[str] = Field(default_factory=lambda: DEFAULT_DETECT_LABELS.copy())
    detectConfidence: int = Field(default=80, ge=1, le=100)


class SourceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    path: str | None = Field(default=None, min_length=1)
    enabled: bool | None = None
    scanIntervalMinutes: int | None = Field(default=None, ge=0, le=1440)
    autoTranscribe: bool | None = None
    autoDetect: bool | None = None
    recognitionTrigger: str | None = Field(default=None, pattern="^(manual|new_segments)$")
    recognitionPriority: str | None = Field(default=None, pattern="^(low|normal|high)$")
    transcribeLanguage: str | None = Field(default=None, pattern="^(global|auto|zh|en)$")
    detectLabels: list[str] | None = None
    detectConfidence: int | None = Field(default=None, ge=1, le=100)


class SourceOut(BaseModel):
    id: str
    name: str
    path: str
    enabled: bool
    createdAt: str
    updatedAt: str
    scanIntervalMinutes: int = 0
    autoTranscribe: bool = False
    autoDetect: bool = False
    recognitionTrigger: str = "manual"
    recognitionPriority: str = "normal"
    transcribeLanguage: str = "global"
    detectLabels: list[str] = Field(default_factory=lambda: DEFAULT_DETECT_LABELS.copy())
    detectConfidence: int = 80
    lastScanAt: str | None = None
    segmentCount: int = 0
    failedCount: int = 0


class SourceCreateOut(SourceOut):
    scanJobId: str | None = None


class SourcesResponse(BaseModel):
    items: list[SourceOut]


class DirectoryNode(BaseModel):
    name: str
    path: str
    readable: bool
    hasChildren: bool
    children: list["DirectoryNode"] = Field(default_factory=list)


class DirectoryTreeResponse(BaseModel):
    root: str
    items: list[DirectoryNode]


class ScanJobOut(BaseModel):
    id: str
    sourceId: str | None
    trigger: str = "manual"
    status: str
    totalFiles: int = 0
    scannedFiles: int
    indexedFiles: int
    failedFiles: int
    startedAt: str | None = None
    finishedAt: str | None = None
    errorMessage: str | None = None
    createdAt: str
    updatedAt: str


class ScanQueuedOut(BaseModel):
    scanJobId: str
    status: str


class ScanJobsResponse(BaseModel):
    items: list[ScanJobOut]
    total: int
    limit: int
    offset: int


class TimelineSegmentOut(BaseModel):
    id: str
    startTime: str
    endTime: str
    durationSeconds: float
    playable: bool
    needsTranscode: bool
    thumbnailUrl: str | None = None


class TimelineGapOut(BaseModel):
    startTime: str
    endTime: str
    durationSeconds: float


class TimelineResponse(BaseModel):
    sourceId: str
    date: str
    timezone: str
    segments: list[TimelineSegmentOut]
    gaps: list[TimelineGapOut]


class SegmentOut(BaseModel):
    id: str
    sourceId: str
    filename: str
    path: str
    sizeBytes: int
    startTime: str | None
    endTime: str | None
    durationSeconds: float | None
    container: str | None = None
    videoCodec: str | None = None
    audioCodec: str | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    playable: bool
    needsTranscode: bool
    scanStatus: str
    errorMessage: str | None = None
    thumbnailUrl: str | None = None


class SegmentListResponse(BaseModel):
    items: list[SegmentOut]
    total: int
    limit: int
    offset: int
    hasMore: bool = False


class SegmentResolveOut(BaseModel):
    segmentId: str | None
    streamUrl: str | None = None
    offsetSeconds: float | None = None
    startTime: str | None = None
    endTime: str | None = None
    playable: bool | None = None
    nearestPrevious: dict | None = None
    nearestNext: dict | None = None


class ExportCreate(BaseModel):
    sourceId: str
    startTime: str
    endTime: str
    mode: str = "fast"
    timelapseSpeed: int = 60
    fileName: str | None = None
    segmentIds: list[str] | None = None


class ExportCreateOut(BaseModel):
    exportId: str
    status: str


class ExportJobOut(BaseModel):
    id: str
    sourceId: str
    sourceName: str | None = None
    fileName: str | None = None
    startTime: str
    endTime: str
    mode: str
    status: str
    progress: float
    hasGaps: bool
    gapDurationSeconds: float
    outputSizeBytes: int | None = None
    downloadUrl: str | None = None
    errorMessage: str | None = None
    createdAt: str
    updatedAt: str
    expiresAt: str | None = None


class ExportListResponse(BaseModel):
    items: list[ExportJobOut]
    total: int
    limit: int
    offset: int


class TranscriptionOut(BaseModel):
    id: str
    segmentId: str
    startTime: float
    endTime: float
    text: str
    confidence: float
    createdAt: str


class TranscriptionJobOut(BaseModel):
    id: str
    segmentId: str
    status: str
    stage: str = ""
    progress: float
    errorMessage: str | None = None
    createdAt: str
    updatedAt: str


class TranscriptionListResponse(BaseModel):
    items: list[TranscriptionOut]
    total: int
    limit: int
    offset: int


class TranscriptionJobListResponse(BaseModel):
    items: list[TranscriptionJobOut]
    total: int
    limit: int
    offset: int


class VisionDetectionOut(BaseModel):
    id: str
    segmentId: str
    sourceId: str
    label: str
    labelName: str
    confidence: float
    startTime: float
    endTime: float
    frameTime: float
    bbox: list[float] | None = None
    model: str
    createdAt: str
    segmentStartTime: str | None = None


class VisionJobOut(BaseModel):
    id: str
    segmentId: str
    status: str
    stage: str = ""
    progress: float
    model: str = "yolov8n"
    labels: list[str] = Field(default_factory=list)
    confidenceThreshold: float = 0.45
    sampleIntervalSeconds: float = 5
    imageSize: int = 416
    detectionsCount: int = 0
    errorMessage: str | None = None
    createdAt: str
    updatedAt: str


class VisionJobListResponse(BaseModel):
    items: list[VisionJobOut]
    total: int
    limit: int
    offset: int


class VisionDetectionListResponse(BaseModel):
    items: list[VisionDetectionOut]
    total: int
    limit: int | None = None
    offset: int | None = None


class SearchResultOut(BaseModel):
    transcription: TranscriptionOut
    segmentId: str
    segmentStartTime: str | None = None
    sourceId: str
    sourceName: str
    highlight: str


class SearchResponse(BaseModel):
    items: list[SearchResultOut]
    total: int
    limit: int
    offset: int
