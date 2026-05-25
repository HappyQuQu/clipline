export interface Source {
  id: string
  name: string
  path: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  scanIntervalMinutes: number
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
