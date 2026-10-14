import {
  CalendarBlank,
  DownloadSimple,
  MagnifyingGlass,
} from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '../../api'
import type { ExportJob, ScanJob, Segment, Source } from '../../types'
import type { DisplaySegment } from '../../utils'
import { exportStatusLabel, formatBytes, formatClipDateTime, scanStatusLabel } from '../../utils'

type LogType = 'scan' | 'export' | 'transcription' | 'vision' | 'error'
type LogRow = {
  id: string
  time: string
  type: LogType
  typeLabel: string
  event: string
  sourceId: string
  source: string
  detail: string
  tone: 'neutral' | 'blue' | 'green' | 'red' | 'purple'
}

function isoDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

export function LogsStage({
  sources,
  segments,
  scanJobs,
  exports,
  failedSegments,
}: {
  sources: Source[]
  segments: DisplaySegment[]
  scanJobs: ScanJob[]
  exports: ExportJob[]
  failedSegments: Segment[]
  onRefresh: () => void
  busy: boolean
}) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<LogType | 'all'>('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('')

  const transcriptionJobs = useQuery({ queryKey: ['logs', 'transcriptionJobs'], queryFn: () => api.getTranscriptionJobs(), refetchInterval: 5000 })
  const visionJobs = useQuery({ queryKey: ['logs', 'visionJobs'], queryFn: () => api.getVisionJobs(), refetchInterval: 5000 })
  const sourceNames = useMemo(() => new Map(sources.map((source) => [source.id, source.name])), [sources])
  const segmentById = useMemo(() => new Map(segments.map((segment) => [segment.id, segment])), [segments])

  const rows = useMemo<LogRow[]>(() => {
    const scanRows: LogRow[] = scanJobs.map((job) => ({
      id: `scan:${job.id}`,
      time: job.finishedAt ?? job.startedAt ?? job.createdAt,
      type: 'scan',
      typeLabel: job.trigger === 'scheduled' ? '定时扫描' : '手动扫描',
      event: `${sourceNames.get(job.sourceId ?? '') ?? '全部录像源'}扫描${scanStatusLabel(job.status)}`,
      sourceId: job.sourceId ?? '',
      source: sourceNames.get(job.sourceId ?? '') ?? '全部录像源',
      detail: `${job.scannedFiles}/${job.totalFiles || '-'} 个文件 · ${job.indexedFiles} 个入库 · ${job.failedFiles} 个错误`,
      tone: job.status === 'failed' ? 'red' : job.status === 'completed' ? 'green' : 'blue',
    }))

    const exportRows: LogRow[] = exports.map((job) => ({
      id: `export:${job.id}`,
      time: job.updatedAt ?? job.createdAt,
      type: 'export',
      typeLabel: '导出',
      event: `${job.mode === 'fast' ? '快速' : '精准'}导出${exportStatusLabel(job.status)}`,
      sourceId: job.sourceId,
      source: job.sourceName ?? sourceNames.get(job.sourceId) ?? '录像源',
      detail: job.errorMessage ?? `${formatClipDateTime(job.startTime)} – ${formatClipDateTime(job.endTime)} · ${formatBytes(job.outputSizeBytes)}`,
      tone: job.status === 'failed' ? 'red' : job.status === 'completed' ? 'green' : 'blue',
    }))

    const failedRows: LogRow[] = failedSegments.map((segment) => ({
      id: `error:${segment.id}`,
      time: segment.startTime ?? '',
      type: 'error',
      typeLabel: '文件失败',
      event: segment.filename,
      sourceId: segment.sourceId,
      source: sourceNames.get(segment.sourceId) ?? '录像源',
      detail: segment.errorMessage ?? '片段扫描失败',
      tone: 'red',
    }))

    const transcriptionRows: LogRow[] = (transcriptionJobs.data?.items ?? []).map((job) => {
      const segment = segmentById.get(job.segmentId)
      return {
        id: `transcription:${job.id}`,
        time: job.updatedAt ?? job.createdAt,
        type: 'transcription',
        typeLabel: '语音识别',
        event: `${segment?.filename ?? job.segmentId} · ${job.status === 'completed' ? '字幕已生成' : job.status === 'failed' ? '识别失败' : '正在识别'}`,
        sourceId: segment?.sourceId ?? '',
        source: segment ? sourceNames.get(segment.sourceId) ?? segment.sourceId : '未知录像源',
        detail: job.errorMessage ?? job.stage ?? `${Math.round((job.progress ?? 0) * 100)}%`,
        tone: job.status === 'failed' ? 'red' : job.status === 'completed' ? 'green' : 'purple',
      }
    })

    const visionRows: LogRow[] = (visionJobs.data?.items ?? []).map((job) => {
      const segment = segmentById.get(job.segmentId)
      return {
        id: `vision:${job.id}`,
        time: job.updatedAt ?? job.createdAt,
        type: 'vision',
        typeLabel: '视觉识别',
        event: `${segment?.filename ?? job.segmentId} · ${job.status === 'completed' ? '标注已生成' : job.status === 'failed' ? '识别失败' : '正在识别'}`,
        sourceId: segment?.sourceId ?? '',
        source: segment ? sourceNames.get(segment.sourceId) ?? segment.sourceId : '未知录像源',
        detail: job.errorMessage ?? (job.status === 'completed' ? `${job.detectionsCount ?? 0} 个标注` : job.stage ?? `${Math.round((job.progress ?? 0) * 100)}%`),
        tone: job.status === 'failed' ? 'red' : job.status === 'completed' ? 'green' : 'purple',
      }
    })

    return [...scanRows, ...exportRows, ...transcriptionRows, ...visionRows, ...failedRows]
      .sort((left, right) => new Date(right.time || 0).getTime() - new Date(left.time || 0).getTime())
  }, [exports, failedSegments, scanJobs, segmentById, sourceNames, transcriptionJobs.data?.items, visionJobs.data?.items])

  const filteredRows = rows.filter((row) => {
    const normalizedQuery = query.trim().toLowerCase()
    const matchesQuery = !normalizedQuery || `${row.event} ${row.detail} ${row.source}`.toLowerCase().includes(normalizedQuery)
    return matchesQuery
      && (typeFilter === 'all' || row.type === typeFilter)
      && (sourceFilter === 'all' || row.sourceId === sourceFilter)
      && (!dateFilter || isoDate(row.time) === dateFilter)
  })

  function downloadCsv() {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`
    const csv = ['时间,类型,事件,录像源,详情', ...filteredRows.map((row) => [row.time, row.typeLabel, row.event, row.source, row.detail].map(escape).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `clipline-logs-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="redesignLogsPage">
      <header className="redesignManagePageHeader">
        <div><small>管理 / 活动日志</small><h1>活动日志</h1><p>查看扫描、导出、识别和失败片段记录</p></div>
        <button type="button" className="manageSecondary" disabled={!filteredRows.length} onClick={downloadCsv}><DownloadSimple size={16} />导出日志</button>
      </header>

      <div className="redesignLogsToolbar">
        <label className="logsInlineSearch"><MagnifyingGlass size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索事件、文件或详情" /></label>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}><option value="all">全部类型</option><option value="scan">扫描</option><option value="export">导出</option><option value="transcription">语音识别</option><option value="vision">视觉识别</option><option value="error">文件失败</option></select>
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="all">全部录像源</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select>
        <label className="logsDate"><CalendarBlank size={15} /><input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label>
      </div>

      <section className="redesignLogsTable" role="table" aria-label="活动日志">
        <div className="redesignLogsHead" role="row"><span role="columnheader">时间</span><span role="columnheader">类型</span><span role="columnheader">事件</span><span role="columnheader">录像源</span><span role="columnheader">详情</span></div>
        {filteredRows.map((row) => <div className="redesignLogRow" role="row" key={row.id}><time role="cell">{row.time ? formatClipDateTime(row.time) : '-'}</time><span role="cell"><i className={row.tone}>{row.typeLabel}</i></span><strong role="cell" title={row.event}>{row.event}</strong><span role="cell" title={row.source}>{row.source}</span><span role="cell" title={row.detail}>{row.detail}</span></div>)}
        {!filteredRows.length && <div className="redesignLogsEmpty"><strong>没有匹配的活动记录</strong><span>调整筛选条件，或在扫描和识别任务运行后刷新查看。</span></div>}
      </section>
      <footer className="redesignLogsFooter"><span>显示 {filteredRows.length ? `1–${filteredRows.length}` : '0'}，共 {filteredRows.length} 条</span><button type="button" disabled>‹</button><button type="button" className="active">1</button><button type="button" disabled>›</button></footer>
    </section>
  )
}
