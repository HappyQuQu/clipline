export interface Source {
  id: string
  name: string
  path: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  scanIntervalMinutes: number
  autoTranscribe: boolean
  autoDetect: boolean
  recognitionTrigger: 'manual' | 'new_segments'
  recognitionPriority: 'low' | 'normal' | 'high'
  transcribeLanguage: 'global' | 'auto' | 'zh' | 'en'
  detectLabels: string[]
  detectConfidence: number
  lastScanAt?: string | null
  segmentCount: number
  failedCount: number
}

export interface DirectoryNode {
  name: string
  path: string
  readable: boolean
  hasChildren: boolean
  children: DirectoryNode[]
}

export interface TimelineSegment {
  id: string
  startTime: string
  endTime: string
  durationSeconds: number
  playable: boolean
  needsTranscode: boolean
  thumbnailUrl?: string | null
}

export interface TimelineGap {
  startTime: string
  endTime: string
  durationSeconds: number
}

export interface TimelineResponse {
  sourceId: string
  date: string
  timezone: string
  segments: TimelineSegment[]
  gaps: TimelineGap[]
}

export interface Segment {
  id: string
  sourceId: string
  filename: string
  path: string
  sizeBytes: number
  startTime?: string | null
  endTime?: string | null
  durationSeconds?: number | null
  container?: string | null
  videoCodec?: string | null
  audioCodec?: string | null
  width?: number | null
  height?: number | null
  fps?: number | null
  playable: boolean
  needsTranscode: boolean
  scanStatus: string
  errorMessage?: string | null
  thumbnailUrl?: string | null
}

export interface ExportJob {
  id: string
  fileName?: string | null
  sourceId: string
  sourceName?: string
  startTime: string
  endTime: string
  mode: 'fast' | 'accurate'
  status: string
  progress: number
  hasGaps: boolean
  gapDurationSeconds: number
  outputSizeBytes?: number | null
  downloadUrl?: string | null
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
  expiresAt?: string | null
}

export interface ScanJob {
  id: string
  sourceId?: string | null
  trigger?: 'manual' | 'scheduled' | string
  status: string
  totalFiles: number
  scannedFiles: number
  indexedFiles: number
  failedFiles: number
  startedAt?: string | null
  finishedAt?: string | null
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
}

export interface SystemStatus {
  version: string
  ffmpeg: { available: boolean }
  ffprobe: { available: boolean }
  database: { available: boolean; path: string }
  logging: { level: string; format: string; file: string }
  recordingsRoot: { path: string; readable: boolean }
  paths?: {
    data: string
    models: string
    vision?: string
    modelscope: string
    whisper: string
    huggingface: string
    torch: string
  }
  cache: { thumbnailBytes: number; exportBytes: number }
  sources: Source[]
}

export interface Transcription {
  id: string
  segmentId: string
  startTime: number
  endTime: number
  text: string
  confidence: number
  createdAt: string
}

export interface TranscriptionJob {
  id: string
  segmentId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  stage: string
  progress: number
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
}

export interface VisionDetection {
  id: string
  segmentId: string
  sourceId: string
  label: string
  labelName: string
  confidence: number
  startTime: number
  endTime: number
  frameTime: number
  bbox?: number[] | null
  model: string
  createdAt: string
  segmentStartTime?: string | null
}

export interface VisionJob {
  id: string
  segmentId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  stage: string
  progress: number
  model: string
  labels: string[]
  confidenceThreshold: number
  sampleIntervalSeconds: number
  imageSize: number
  detectionsCount: number
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
}

export interface VisionStatus {
  status: string
  stage?: string
  progress: number
  jobId?: string
  errorMessage?: string | null
  detectionsCount?: number
}

export interface SearchResult {
  transcription: Transcription
  segmentId: string
  segmentStartTime?: string | null
  sourceId: string
  sourceName: string
  highlight: string
}

export interface SearchResponse {
  items: SearchResult[]
  total: number
  limit: number
  offset: number
}

export interface SettingsResponse {
  recordings: {
    recordings_root: string
    scan_interval_seconds: number
    skip_recent_seconds: number
    timezone: string
    scan_workers_per_source?: number
    global_ffprobe_concurrency?: number
    auto_cleanup_days?: number
    idle_scan_enabled?: boolean
    idle_scan_start_hour?: number
    idle_scan_end_hour?: number
  }
  export: {
    export_ttl_hours: number
    max_export_minutes: number
    max_concurrent_exports: number
    thumbnail_mode: string
  }
  asr: {
    model: string
    modelSize: string
    device: string
    language: string
    autoTranscribe: boolean
    hotwords: string
    audioSampleRate?: number
    maxConcurrent?: number
    timeoutSeconds?: number
  }
  vision?: {
    model: string
    device: string
    maxConcurrent: number
    sampleIntervalSeconds: number
    imageSize: number
    confidence: number
    maxAutoJobsPerScan: number
    modelStatus: {
      model: string
      path: string
      available: boolean
      device: string
    }
  }
  logs: {
    log_level: string
    log_format: string
    log_file: string
  }
  paths?: {
    data: string
    models: string
    vision?: string
    modelscope: string
    whisper: string
    huggingface: string
    torch: string
  }
}

export interface ASRModelInfo {
  id: string
  engine: string
  name: string
  size_label: string
  downloaded: boolean
  size_bytes: number
  cache_path: string | null
  download: ASRModelDownloadStatus
}

export interface ASRModelDownloadStatus {
  status: 'idle' | 'downloading' | 'completed' | 'failed'
  stage: string
  progress: number | null
  bytesDownloaded: number
  totalBytes: number | null
  error: string | null
  startedAt: string | null
  updatedAt: string | null
}

export interface ASRModelDownloadTask extends ASRModelDownloadStatus {
  modelId: string
}
