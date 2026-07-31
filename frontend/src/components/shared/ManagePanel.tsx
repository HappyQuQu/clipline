import {
  CheckCircle,
  Clock,
  DownloadSimple,
  FilmStrip,
  SpinnerGap,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DisplaySegment } from '../../utils'
import { formatBytes, formatDuration, formatTime, toIsoWithOffset, toLocalDateTimePrecise } from '../../utils'
import { useDialogFocus } from './useDialogFocus'

type ExportMode = 'fast' | 'accurate'

export function ManagePanel({
  segments,
  sources,
  selectedSourceId,
  currentTimeMs,
  externalRangeStart,
  externalRangeEnd,
  onClose,
  onExport,
  onViewTasks,
}: {
  segments: DisplaySegment[]
  sources: { id: string; name: string }[]
  selectedSourceId: string
  currentTimeMs: number | null
  externalRangeStart?: number | null
  externalRangeEnd?: number | null
  onClose: () => void
  onExport: (startTime: string, endTime: string, mode: ExportMode) => Promise<void> | void
  onViewTasks?: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  useDialogFocus(dialogRef, true, onClose)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [mode, setMode] = useState<ExportMode>('fast')
  const [fileName, setFileName] = useState('')
  const [status, setStatus] = useState<'idle' | 'executing' | 'completed' | 'failed'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    const start = externalRangeStart ?? currentTimeMs ?? Date.now()
    const end = externalRangeEnd ?? start + 60_000
    setStartTime(toLocalDateTimePrecise(new Date(start)))
    setEndTime(toLocalDateTimePrecise(new Date(end)))
    setMode('fast')
    setStatus('idle')
    setError('')
  }, [externalRangeStart, externalRangeEnd, currentTimeMs])

  const startMs = startTime ? new Date(startTime).getTime() : null
  const endMs = endTime ? new Date(endTime).getTime() : null
  const rangeValid = startMs !== null && endMs !== null && endMs > startMs
  const sourceName = sources.find((source) => source.id === selectedSourceId)?.name ?? '录像源'

  const affectedSegments = useMemo(() => {
    if (!rangeValid) return []
    return segments
      .filter((segment) => new Date(segment.endTime).getTime() > startMs! && new Date(segment.startTime).getTime() < endMs!)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  }, [segments, startMs, endMs, rangeValid])

  const coveredMs = useMemo(() => {
    if (!rangeValid) return 0
    return affectedSegments.reduce((sum, segment) => {
      const start = Math.max(startMs!, new Date(segment.startTime).getTime())
      const end = Math.min(endMs!, new Date(segment.endTime).getTime())
      return sum + Math.max(0, end - start)
    }, 0)
  }, [affectedSegments, endMs, rangeValid, startMs])

  const rangeMs = rangeValid ? endMs! - startMs! : 0
  const gapMs = Math.max(0, rangeMs - coveredMs)
  const estimatedSize = coveredMs ? Math.round((coveredMs / 1000) * 2_000_000 / 8) : null
  const preview = affectedSegments[0]?.thumbnailUrl

  useEffect(() => {
    if (!rangeValid) return
    const stamp = (ms: number) => {
      const date = new Date(ms)
      return `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`
    }
    const day = startTime.slice(0, 10).replaceAll('-', '')
    setFileName(`${sourceName.replaceAll(/\s+/g, '_')}_${day}_${stamp(startMs!)}-${stamp(endMs!)}.mp4`)
  }, [endMs, rangeValid, sourceName, startMs, startTime])

  function updateDateTime(kind: 'start' | 'end', value: string) {
    if (kind === 'start') setStartTime(value)
    else setEndTime(value)
    setStatus('idle')
    setError('')
  }

  async function handleCreate() {
    if (!rangeValid || !affectedSegments.length) return
    setStatus('executing')
    setError('')
    try {
      await onExport(toIsoWithOffset(startTime), toIsoWithOffset(endTime), mode)
      setStatus('completed')
    } catch (reason) {
      setStatus('failed')
      setError(reason instanceof Error ? reason.message : '创建导出任务失败')
    }
  }

  if (status === 'completed') {
    return (
      <section ref={dialogRef} className="exportModal exportSuccessState" role="dialog" aria-modal="true" aria-label="导出任务已创建" tabIndex={-1}>
        <span><CheckCircle size={58} weight="fill" /></span>
        <h2>导出任务已创建</h2>
        <p>可前往“任务”查看处理进度，完成后可直接下载。</p>
        <button type="button" className="exportPrimaryButton" onClick={onViewTasks}>查看任务</button>
        <button type="button" className="exportSecondaryButton" onClick={onClose}>继续浏览</button>
      </section>
    )
  }

  return (
    <section ref={dialogRef} className="exportModal" role="dialog" aria-modal="true" aria-label="创建导出任务" tabIndex={-1}>
      <header className="exportModalHeading">
        <div><small>导出片段</small><h2>创建导出任务</h2></div>
        <button type="button" aria-label="关闭" title="关闭" onClick={onClose}><X size={20} /></button>
      </header>

      <div className={`exportPreview${preview ? '' : ' empty'}`} style={preview ? { backgroundImage: `url(${preview})` } : undefined}>
        {!preview && <FilmStrip size={36} />}
        <span>{sourceName} · {rangeValid ? `${formatTime(new Date(startMs!).toISOString())} – ${formatTime(new Date(endMs!).toISOString())}` : '选择时间范围'}</span>
      </div>

      <div className="exportForm">
        <label>文件名称<input value={fileName} onChange={(event) => setFileName(event.target.value)} /></label>
        <div className="exportFormGrid">
          <label>开始时间<input type="datetime-local" step="1" value={startTime} onChange={(event) => updateDateTime('start', event.target.value)} /></label>
          <label>结束时间<input type="datetime-local" step="1" value={endTime} onChange={(event) => updateDateTime('end', event.target.value)} /></label>
        </div>
        <fieldset className="exportModeField">
          <legend>导出模式</legend>
          <button type="button" className={mode === 'fast' ? 'active' : ''} onClick={() => setMode('fast')}><strong>快速</strong><span>关键帧切割，速度更快</span></button>
          <button type="button" className={mode === 'accurate' ? 'active' : ''} onClick={() => setMode('accurate')}><strong>精准</strong><span>重新编码，边界更准确</span></button>
        </fieldset>

        {!rangeValid ? (
          <p className="exportError"><WarningCircle size={17} weight="fill" />结束时间必须晚于开始时间。</p>
        ) : !affectedSegments.length ? (
          <p className="exportError"><WarningCircle size={17} weight="fill" />选择范围内没有可导出的录像。</p>
        ) : gapMs > 1000 ? (
          <p className="exportNote"><WarningCircle size={17} weight="fill" />选择范围包含 {formatDuration(gapMs / 1000)} 未索引片段，导出结果会保留时间断档。</p>
        ) : (
          <p className="exportReady"><CheckCircle size={17} weight="fill" />范围内包含 {affectedSegments.length} 个可用片段。</p>
        )}
        {status === 'failed' && <p className="exportError"><WarningCircle size={17} weight="fill" />{error}</p>}
      </div>

      <footer className="exportModalFooter">
        <span><Clock size={15} />{formatDuration(rangeMs / 1000)} · 预计 {formatBytes(estimatedSize)} · 不修改源文件</span>
        <button type="button" className="exportSecondaryButton" onClick={onClose}>取消</button>
        <button type="button" className="exportPrimaryButton" disabled={!rangeValid || !affectedSegments.length || status === 'executing'} onClick={() => void handleCreate()}>
          {status === 'executing' ? <SpinnerGap size={17} className="spinning" /> : <DownloadSimple size={17} />}
          {status === 'executing' ? '创建中…' : '创建任务'}
        </button>
      </footer>
    </section>
  )
}
