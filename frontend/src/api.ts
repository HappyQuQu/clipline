import type { DirectoryNode, ExportJob, ScanJob, Segment, Source, SystemStatus, TimelineResponse } from './types'

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
  updateSource: (sourceId: string, payload: Partial<Pick<Source, 'name' | 'path' | 'enabled' | 'scanIntervalMinutes'>>) =>
    request<Source & { scanJobId?: string | null }>(`/api/sources/${sourceId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
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
  createExport: (payload: { sourceId: string; startTime: string; endTime: string; mode: 'fast' | 'accurate' }) =>
    request<{ exportId: string; status: string }>('/api/exports', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  status: () => request<SystemStatus>('/api/system/status'),
}
