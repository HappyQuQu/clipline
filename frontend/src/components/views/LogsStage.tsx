import { Activity, AlertTriangle, Download, History, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { ExportJob, ScanJob, Segment, Source } from '../../types'
import { exportStatusLabel, formatBytes, formatClipDateTime, scanStatusLabel } from '../../utils'

export function LogsStage({
  sources,
  scanJobs,
  exports,
  failedSegments,
  onRefresh,
  busy,
}: {
  sources: Source[]
  scanJobs: ScanJob[]
  exports: ExportJob[]
  failedSegments: Segment[]
  onRefresh: () => void
  busy: boolean
}) {
  type LogKind = 'all' | 'scan' | 'scheduledScan' | 'manualScan' | 'export' | 'error' | 'login' | 'sourceChange' | 'transcription'
  const sourceNames = new Map(sources.map((source) => [source.id, source.name]))
  const [logKind, setLogKind] = useState<LogKind>('all')
  const scanRows = scanJobs.map((job) => {
    const scheduled = job.trigger === 'scheduled'
    return {
      id: job.id,
      category: scheduled ? 'scheduledScan' as const : 'manualScan' as const,
      type: scheduled ? '定时' : '手动',
      time: job.finishedAt ?? job.startedAt ?? job.createdAt,
      title: `${sourceNames.get(job.sourceId ?? '') ?? '全部源'} · ${scheduled ? '定时扫描' : '手动扫描'} · ${scanStatusLabel(job.status)}`,
      detail: `${job.scannedFiles}/${job.totalFiles || '-'} 文件 · ${job.indexedFiles} 入库 · ${job.failedFiles} 错误`,
      status: job.status,
      statusLabel: scanStatusLabel(job.status),
    }
  })
  const exportRows = exports.slice(0, 8).map((job) => ({
    id: job.id,
    category: 'export' as const,
    type: '导出',
    time: job.updatedAt ?? job.createdAt,
    title: `${job.sourceName ?? sourceNames.get(job.sourceId) ?? '录像源'} · ${job.mode === 'fast' ? '快速' : '精准'}`,
    detail: `${formatClipDateTime(job.startTime)} - ${formatClipDateTime(job.endTime)} · ${formatBytes(job.outputSizeBytes)}`,
    status: job.status,
    statusLabel: exportStatusLabel(job.status),
  }))
  const errorRows = failedSegments.slice(0, 8).map((segment) => ({
    id: segment.id,
    category: 'error' as const,
    type: '错误',
    time: segment.startTime ?? '',
    title: `${sourceNames.get(segment.sourceId) ?? '录像源'} · ${segment.filename}`,
    detail: segment.errorMessage ?? '扫描失败',
    status: segment.scanStatus,
    statusLabel: scanStatusLabel(segment.scanStatus),
  }))
  const allRows = [...scanRows, ...exportRows, ...errorRows]
  const logCounts: Record<LogKind, number> = {
    all: allRows.length,
    scan: scanRows.length,
    scheduledScan: scanRows.filter((row) => row.category === 'scheduledScan').length,
    manualScan: scanRows.filter((row) => row.category === 'manualScan').length,
    export: exportRows.length,
    error: errorRows.length,
    login: 0,
    sourceChange: 0,
    transcription: 0,
  }
  const logFilters: Array<{ key: LogKind; label: string }> = [
    { key: 'all', label: '全部日志' },
    { key: 'scheduledScan', label: '定时扫描' },
    { key: 'manualScan', label: '手动扫描' },
    { key: 'export', label: '导出任务' },
    { key: 'transcription', label: '语音识别' },
    { key: 'error', label: '错误日志' },
    { key: 'login', label: '登录日志' },
    { key: 'sourceChange', label: '源配置变更' },
  ]
  const activeLogLabel = logFilters.find((filter) => filter.key === logKind)?.label ?? '日志'
  const rows = allRows
    .filter((row) => {
      if (logKind === 'all') return true
      if (logKind === 'scan') return row.category === 'scheduledScan' || row.category === 'manualScan'
      return row.category === logKind
    })
    .sort((left, right) => new Date(right.time || 0).getTime() - new Date(left.time || 0).getTime())

  return (
    <section className="modulePanel">
      <div className="moduleHead">
        <div>
          <div className="moduleTitle">日志</div>
          <div className="moduleMeta">扫描、导出、错误和后续登录审计都会集中到这里。</div>
        </div>
        <button className="refreshButton" onClick={onRefresh}>
          <RefreshCw size={18} className={busy ? 'spin' : ''} />
        </button>
      </div>

      <div className="logSummaryGrid">
        <button className={logKind === 'scan' ? 'settingsCard logMetricButton active' : 'settingsCard logMetricButton'} onClick={() => setLogKind('scan')}>
          <Activity size={20} />
          <strong>{scanJobs.length}</strong>
          <span>扫描日志</span>
        </button>
        <button className={logKind === 'export' ? 'settingsCard logMetricButton active' : 'settingsCard logMetricButton'} onClick={() => setLogKind('export')}>
          <Download size={20} />
          <strong>{exports.length}</strong>
          <span>导出日志</span>
        </button>
        <button className={logKind === 'error' ? 'settingsCard warning logMetricButton active' : 'settingsCard warning logMetricButton'} onClick={() => setLogKind('error')}>
          <AlertTriangle size={20} />
          <strong>{failedSegments.length}</strong>
          <span>错误日志</span>
        </button>
        <button className={logKind === 'login' ? 'settingsCard logMetricButton active' : 'settingsCard logMetricButton'} onClick={() => setLogKind('login')}>
          <History size={20} />
          <strong>{logCounts.login}</strong>
          <span>登录日志</span>
        </button>
      </div>

      <div className="logLayout">
        <aside className="logKinds">
          {logFilters.map((filter) => (
            <button className={logKind === filter.key ? 'active' : ''} key={filter.key} onClick={() => setLogKind(filter.key)}>
              <span>{filter.label}</span>
              <small>{logCounts[filter.key]}</small>
            </button>
          ))}
        </aside>
        <div className="logTable">
          <div className="logTableHead">
            <span>类型</span>
            <span>时间</span>
            <span>事件</span>
            <span>状态</span>
          </div>
          {rows.length ? rows.map((row) => (
            <div className="logRow" key={`${row.type}-${row.id}`}>
              <span className={`logType ${row.type === '错误' ? 'warning' : ''}`}>{row.type}</span>
              <span>{row.time ? formatClipDateTime(row.time) : '-'}</span>
              <span>
                <strong>{row.title}</strong>
                <small>{row.detail}</small>
              </span>
              <span>{row.statusLabel}</span>
            </div>
          )) : (
            <div className="moduleEmpty">暂无{activeLogLabel}</div>
          )}
        </div>
      </div>
    </section>
  )
}
