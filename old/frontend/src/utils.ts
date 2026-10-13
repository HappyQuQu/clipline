import type { ExportJob, Segment, TimelineSegment } from './types'

// ── 类型 ──

export type DisplaySegment = TimelineSegment & { sourceId: string; filename?: string }

// ── 常量 ──

export const today = new Date().toLocaleDateString('sv-SE')
export const playbackRates = [1, 1.5, 2, 4]
export const selectedSourceStorageKey = 'clipline.selectedSourceId'
export const searchHistoryStorageKey = 'clipline.searchHistory'

// ── 日期/时间格式化 ──

export function toLocalInputValue(value: string) {
  return toLocalDateTimePrecise(new Date(value))
}

export function toIsoWithOffset(value: string) {
  const date = new Date(value)
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const hours = String(Math.floor(abs / 60)).padStart(2, '0')
  const minutes = String(abs % 60).padStart(2, '0')
  const hasSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
  const localValue = hasSeconds ? value : `${value}:00`
  return `${localValue}${sign}${hours}:${minutes}`
}

export function formatTime(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function toLocalDateTimeInput(dateValue: Date) {
  const offsetMs = dateValue.getTimezoneOffset() * 60_000
  return new Date(dateValue.getTime() - offsetMs).toISOString().slice(0, 16)
}

export function toLocalDateTimePrecise(dateValue: Date) {
  const offsetMs = dateValue.getTimezoneOffset() * 60_000
  return new Date(dateValue.getTime() - offsetMs).toISOString().slice(0, 23)
}

export function getDefaultRange(days = 7) {
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - days + 1)
  start.setHours(0, 0, 0, 0)
  return {
    start: toLocalDateTimeInput(start),
    end: toLocalDateTimeInput(end),
  }
}

export function formatRangeLabel(start: string, end: string) {
  if (!start && !end) return '全部时间'
  const startLabel = start ? formatClipDateTime(toIsoWithOffset(start)) : '开始'
  const endLabel = end ? formatClipDateTime(toIsoWithOffset(end)) : '现在'
  return `${startLabel} - ${endLabel}`
}

export function formatClipDateTime(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function segmentDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString('sv-SE') : today
}

// ── 数值格式化 ──

export function formatBytes(value?: number | null) {
  if (!value) return '-'
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function formatPlaybackRate(value: number) {
  return `${value.toFixed(1)}x`
}

export function formatDuration(seconds?: number | null) {
  const total = Math.max(0, Math.round(seconds ?? 0))
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  const remainingSeconds = total % 60
  if (minutes < 60) return remainingSeconds ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`
}

// ── 状态标签 ──

export function scanStatusLabel(status?: string) {
  if (!status) return '未扫描'
  if (status === 'queued') return '排队中'
  if (status === 'running') return '扫描中'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  return status
}

export function exportStatusLabel(status?: string) {
  if (!status) return '未开始'
  if (status === 'queued') return '排队中'
  if (status === 'running') return '导出中'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'canceled') return '已取消'
  if (status === 'expired') return '已过期'
  return status
}

export function exportProgressPercent(job: ExportJob) {
  if (job.status === 'completed') return 100
  const progress = Number.isFinite(job.progress) ? job.progress : 0
  return Math.max(0, Math.min(100, Math.round(progress * 100)))
}

// ── 数据转换 ──

export function toDisplaySegment(segment: Segment): DisplaySegment | null {
  if (!segment.startTime || !segment.endTime) return null
  return {
    id: segment.id,
    sourceId: segment.sourceId,
    filename: segment.filename,
    startTime: segment.startTime,
    endTime: segment.endTime,
    durationSeconds: segment.durationSeconds ?? 0,
    playable: segment.playable,
    needsTranscode: segment.needsTranscode,
    thumbnailUrl: segment.thumbnailUrl ?? null,
  }
}

// ── 通用工具 ──

export function queryMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
