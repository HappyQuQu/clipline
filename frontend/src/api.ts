import type {
  ASRModelDownloadStatus,
  ASRModelDownloadTask,
  ASRModelInfo,
  DirectoryNode,
  ExportJob,
  ScanJob,
  SearchResponse,
  Segment,
  SettingsResponse,
  Source,
  SystemStatus,
  TimelineResponse,
  Transcription,
  TranscriptionJob,
  VisionDetection,
  VisionJob,
  VisionStatus,
} from './types'

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (!response.ok) {
    const text = await response.text()
    let message = text || response.statusText
    try {
      const payload = JSON.parse(text) as { detail?: unknown }
      if (typeof payload.detail === 'string') message = payload.detail
    } catch {
      // Keep the raw response text when the backend did not return JSON.
    }
    throw new Error(message)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error('接口返回的不是 JSON，请检查 /api 是否连接到 Clipline 后端')
  }
  return response.json() as Promise<T>
}

export const api = {
  sources: () => request<{ items: Source[] }>('/api/sources'),
  createSource: (payload: { name: string; path: string; scanIntervalMinutes?: number }) =>
    request<Source & { scanJobId?: string }>('/api/sources', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSource: (
    sourceId: string,
    payload: Partial<Pick<
      Source,
      | 'name'
      | 'path'
      | 'enabled'
      | 'scanIntervalMinutes'
      | 'autoTranscribe'
      | 'autoDetect'
      | 'recognitionTrigger'
      | 'recognitionPriority'
      | 'transcribeLanguage'
      | 'detectLabels'
      | 'detectConfidence'
    >>,
  ) =>
    request<Source & { scanJobId?: string | null }>(`/api/sources/${sourceId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteSource: (sourceId: string) =>
    request<{ deleted: boolean }>(`/api/sources/${sourceId}`, {
      method: 'DELETE',
    }),
  scanSource: (sourceId: string) =>
    request<{ scanJobId: string; status: string }>(`/api/sources/${sourceId}/scan`, {
      method: 'POST',
    }),
  scanJobs: (sourceId?: string) => {
    const query = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}&limit=6` : '?limit=6'
    return request<{ items: ScanJob[]; total: number; limit: number; offset: number }>(`/api/scan-jobs${query}`)
  },
  directories: (path?: string, depth = 3) => {
    const query = new URLSearchParams({ depth: String(depth) })
    if (path) query.set('path', path)
    return request<{ root: string; items: DirectoryNode[] }>(`/api/recording-directories?${query}`)
  },
  timeline: (sourceId: string, date: string) =>
    request<TimelineResponse>(`/api/timeline?sourceId=${encodeURIComponent(sourceId)}&date=${date}`),
  segments: (params: { sourceId?: string; scanStatus?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams()
    if (params.sourceId) query.set('sourceId', params.sourceId)
    if (params.scanStatus) query.set('scanStatus', params.scanStatus)
    if (params.limit) query.set('limit', String(params.limit))
    if (params.offset) query.set('offset', String(params.offset))
    return request<{ items: Segment[]; total: number; limit: number; offset: number }>(`/api/segments?${query}`)
  },
  exports: () => request<{ items: ExportJob[]; total: number; limit: number; offset: number }>('/api/exports'),
  createExport: (payload: { sourceId: string; startTime: string; endTime: string; mode: string; timelapseSpeed?: number }) =>
    request<{ exportId: string; status: string }>('/api/exports', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  status: () => request<SystemStatus>('/api/system/status'),
  systemLogs: (lines = 200) => request<{ path: string; lines: string[] }>(`/api/system/logs?lines=${lines}`),

  // 搜索
  search: (params: {
    q: string
    sourceId?: string
    startDate?: string
    endDate?: string
    limit?: number
    offset?: number
  }) => {
    const searchParams = new URLSearchParams()
    searchParams.set('q', params.q)
    if (params.sourceId) searchParams.set('sourceId', params.sourceId)
    if (params.startDate) searchParams.set('startDate', params.startDate)
    if (params.endDate) searchParams.set('endDate', params.endDate)
    searchParams.set('limit', String(params.limit ?? 50))
    searchParams.set('offset', String(params.offset ?? 0))
    return request<SearchResponse>(`/api/search?${searchParams}`)
  },

  searchSuggestions: (q: string) =>
    request<{ suggestions: string[] }>(`/api/search/suggestions?q=${encodeURIComponent(q)}`),

  popularSearches: () =>
    request<{ popular: string[] }>('/api/search/popular'),

  // 语音识别
  triggerTranscription: (segmentId: string) =>
    request<TranscriptionJob>(`/api/segments/${segmentId}/transcribe`, { method: 'POST' }),

  getTranscriptionJobs: (params?: { segmentId?: string; status?: string }) => {
    const searchParams = new URLSearchParams()
    if (params?.segmentId) searchParams.set('segmentId', params.segmentId)
    if (params?.status) searchParams.set('status', params.status)
    return request<{ items: TranscriptionJob[] }>(`/api/transcription-jobs?${searchParams}`)
  },

  getTranscriptionJob: (jobId: string) =>
    request<TranscriptionJob>(`/api/transcription-jobs/${jobId}`),

  getTranscription: (segmentId: string) =>
    request<{ items: Transcription[] }>(`/api/segments/${segmentId}/transcription`),

  getTranscriptionStatus: (segmentId: string) =>
    request<{ status: string; stage: string; progress: number; jobId?: string; errorMessage?: string }>(
      `/api/segments/${segmentId}/transcription/status`
    ),

  deleteTranscription: (segmentId: string) =>
    request<{ deleted: number }>(`/api/segments/${segmentId}/transcription`, { method: 'DELETE' }),

  exportTranscription: (segmentId: string, format: 'srt' | 'txt' = 'srt') =>
    request<{ content: string }>(`/api/segments/${segmentId}/transcription/export?format=${format}`),

  // 视频视觉识别
  triggerVision: (segmentId: string, force = false) =>
    request<VisionJob>(`/api/segments/${segmentId}/vision?force=${force ? 'true' : 'false'}`, { method: 'POST' }),

  getVisionJobs: (params?: { segmentId?: string; status?: string }) => {
    const searchParams = new URLSearchParams()
    if (params?.segmentId) searchParams.set('segmentId', params.segmentId)
    if (params?.status) searchParams.set('status', params.status)
    return request<{ items: VisionJob[] }>(`/api/vision-jobs?${searchParams}`)
  },

  getVisionStatus: (segmentId: string) =>
    request<VisionStatus>(`/api/segments/${segmentId}/vision/status`),

  getVisionDetections: (segmentId: string) =>
    request<{ items: VisionDetection[]; total: number }>(`/api/segments/${segmentId}/vision`),

  listVisionDetections: (params: {
    sourceId?: string
    labels?: string[]
    startDate?: string
    endDate?: string
    limit?: number
  }) => {
    const searchParams = new URLSearchParams()
    if (params.sourceId) searchParams.set('sourceId', params.sourceId)
    if (params.labels?.length) searchParams.set('labels', params.labels.join(','))
    if (params.startDate) searchParams.set('startDate', params.startDate)
    if (params.endDate) searchParams.set('endDate', params.endDate)
    searchParams.set('limit', String(params.limit ?? 2000))
    return request<{ items: VisionDetection[]; total: number }>(`/api/vision/detections?${searchParams}`)
  },

  getVisionLabels: (sourceId?: string) => {
    const searchParams = new URLSearchParams()
    if (sourceId) searchParams.set('sourceId', sourceId)
    return request<{ items: Array<{ label: string; labelName: string; count: number }> }>(
      `/api/vision/labels?${searchParams}`
    )
  },

  // 全局设置
  getSettings: () => request<SettingsResponse>('/api/settings'),

  updateSettings: (payload: Record<string, unknown>) =>
    request<SettingsResponse>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // ASR 模型管理
  getASRModels: () => request<{ models: ASRModelInfo[] }>('/api/settings/asr/models'),

  getASRModelDownloads: () =>
    request<{ items: ASRModelDownloadTask[] }>('/api/settings/asr/model-downloads'),

  downloadASRModel: (modelId: string) =>
    request<{ status: string }>(`/api/settings/asr/models/${encodeURIComponent(modelId)}/download`, {
      method: 'POST',
    }),

  getASRModelStatus: (modelId: string) =>
    request<ASRModelDownloadStatus>(`/api/settings/asr/models/${encodeURIComponent(modelId)}/status`),

  deleteASRModel: (modelId: string) =>
    request<{ deleted: boolean }>(`/api/settings/asr/models/${encodeURIComponent(modelId)}`, {
      method: 'DELETE',
    }),
}
