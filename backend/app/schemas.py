from pydantic import BaseModel, Field


class SourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    path: str = Field(min_length=1)


class SourceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    path: str | None = Field(default=None, min_length=1)
    enabled: bool | None = None


class SourceOut(BaseModel):
    id: str
    name: str
    path: str
    enabled: bool
    createdAt: str
    updatedAt: str
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
    status: str
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


class SegmentListResponse(BaseModel):
    items: list[SegmentOut]
    total: int
    limit: int
    offset: int


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


class ExportCreateOut(BaseModel):
    exportId: str
    status: str


class ExportJobOut(BaseModel):
    id: str
    sourceId: str
    sourceName: str | None = None
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
