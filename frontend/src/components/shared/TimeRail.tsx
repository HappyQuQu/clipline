import { Download, Pause, Play, RefreshCw, RotateCcw, RotateCw, Unlink } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DisplaySegment } from '../../utils'
import { formatPlaybackRate, formatTime, playbackRates, toIsoWithOffset, toLocalDateTimePrecise } from '../../utils'
import { ExportMode } from './ExportMode'

export function TimeRail({
  date,
  segments,
  selectedId,
  playbackTimeMs,
  playbackRate,
  isPlaying,
  exportStart,
  exportEnd,
  exportRangeVisible,
  exportMode,
  exportStatus,
  exporting,
  onSelect,
  onPlaybackRateChange,
  onTogglePlayback,
  onExportRangeChange,
  onExportRangeActivate,
  onExportModeChange,
  onExport,
}: {
  date: string
  segments: DisplaySegment[]
  selectedId?: string
  playbackTimeMs: number | null
  playbackRate: number
  isPlaying: boolean
  exportStart: string
  exportEnd: string
  exportRangeVisible: boolean
  exportMode: 'fast' | 'accurate'
  exportStatus: string
  exporting: boolean
  onSelect: (segment: DisplaySegment) => void
  onPlaybackRateChange: (rate: number) => void
  onTogglePlayback: () => void
  onExportRangeChange: (start: string, end: string) => void
  onExportRangeActivate: () => void
  onExportModeChange: (value: 'fast' | 'accurate') => void
  onExport: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<
    | { kind: 'pan'; x: number; start: number; end: number; moved: boolean }
    | { kind: 'export-start' | 'export-end'; moved: boolean }
  >(null)
  const previousSelectedIdRef = useRef<string | undefined>(undefined)
  const trackInset = 14
  const orderedSegments = useMemo(
    () => [...segments].sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime()),
    [segments],
  )
  const firstStart = orderedSegments[0] ? new Date(orderedSegments[0].startTime).getTime() : Date.now()
  const lastEnd = orderedSegments[orderedSegments.length - 1]
    ? new Date(orderedSegments[orderedSegments.length - 1].endTime).getTime()
    : firstStart
  const selectedSegment = orderedSegments.find((segment) => segment.id === selectedId)
  const currentTimeMs = playbackTimeMs ?? (selectedSegment ? new Date(selectedSegment.startTime).getTime() : null)
  const exportStartMs = exportStart ? new Date(exportStart).getTime() : null
  const exportEndMs = exportEnd ? new Date(exportEnd).getTime() : null
  const [windowRange, setWindowRange] = useState(() => {
    const span = Math.max(lastEnd - firstStart, 30 * 60_000)
    return { start: lastEnd - span, end: lastEnd }
  })

  useEffect(() => {
    if (!orderedSegments.length) return
    const span = Math.max(lastEnd - firstStart, 30 * 60_000)
    setWindowRange({ start: lastEnd - span, end: lastEnd })
  }, [date, firstStart, lastEnd, orderedSegments.length])

  useEffect(() => {
    if (!selectedSegment || !selectedId) return
    if (previousSelectedIdRef.current === selectedId) return
    previousSelectedIdRef.current = selectedId
    const selectedStart = new Date(selectedSegment.startTime).getTime()
    const selectedEnd = new Date(selectedSegment.endTime).getTime()
    const segmentSpan = Math.max(selectedEnd - selectedStart, 1)
    const center =
      currentTimeMs !== null && currentTimeMs >= selectedStart && currentTimeMs <= selectedEnd
        ? currentTimeMs
        : selectedStart + segmentSpan / 2
    const span = Math.max(60_000, Math.min(10 * 60_000, Math.max(segmentSpan * 2, 2 * 60_000)))
    setWindowRange({ start: center - span / 2, end: center + span / 2 })
  }, [currentTimeMs, selectedId, selectedSegment])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    const width = Math.max(1, parent?.clientWidth ?? 800)
    const height = parent?.clientHeight ?? 94
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)

    const start = windowRange.start
    const end = windowRange.end
    const span = Math.max(end - start, 1)
    const bandTop = 34
    const bandHeight = 36
    const trackStart = trackInset
    const trackWidth = Math.max(1, width - trackInset * 2)
    const xForTime = (time: number) => trackStart + ((time - start) / span) * trackWidth
    const clampedXForTime = (time: number) => Math.min(width - trackInset, Math.max(trackInset, xForTime(time)))
    const shouldShowSegmentLabels = span <= 3 * 60 * 60_000

    context.clearRect(0, 0, width, height)
    context.fillStyle = '#151515'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#565656'
    context.fillRect(trackStart, bandTop, trackWidth, bandHeight)

    context.save()
    context.beginPath()
    context.rect(trackStart, bandTop, trackWidth, bandHeight)
    context.clip()
    context.strokeStyle = 'rgba(0,0,0,.18)'
    for (let x = trackStart - height; x < width - trackInset + height; x += 9) {
      context.beginPath()
      context.moveTo(x, bandTop + bandHeight)
      context.lineTo(x + bandHeight, bandTop)
      context.stroke()
    }
    context.restore()

    orderedSegments.forEach((segment) => {
      const segmentStart = new Date(segment.startTime).getTime()
      const segmentEnd = new Date(segment.endTime).getTime()
      if (segmentEnd < start || segmentStart > end) return
      const x = Math.max(trackInset, xForTime(segmentStart))
      const segmentWidth = Math.max(3, Math.min(width - trackInset, xForTime(segmentEnd)) - x)
      context.fillStyle = segment.id === selectedId ? '#8befff' : '#43d3ec'
      context.fillRect(x, bandTop, segmentWidth, bandHeight)
      context.strokeStyle = 'rgba(9, 54, 69, .55)'
      context.lineWidth = 1
      context.strokeRect(x + 0.5, bandTop + 0.5, Math.max(1, segmentWidth - 1), bandHeight - 1)
      if (shouldShowSegmentLabels && segmentWidth >= 54) {
        context.fillStyle = '#10708a'
        context.font = '11px Inter, sans-serif'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(formatTime(segment.startTime).slice(0, 5), x + segmentWidth / 2, bandTop + bandHeight / 2)
      }
    })

    if (exportRangeVisible && exportStartMs !== null && exportEndMs !== null && exportEndMs > exportStartMs && exportEndMs >= start && exportStartMs <= end) {
      const rangeX = clampedXForTime(exportStartMs)
      const rangeEndX = clampedXForTime(exportEndMs)
      const rangeWidth = Math.max(2, rangeEndX - rangeX)
      context.fillStyle = 'rgba(47, 109, 246, .28)'
      context.fillRect(rangeX, bandTop - 6, rangeWidth, bandHeight + 12)
      context.strokeStyle = '#2f6df6'
      context.lineWidth = 2
      context.strokeRect(rangeX + 1, bandTop - 5, Math.max(1, rangeWidth - 2), bandHeight + 10)

      ;[rangeX, rangeEndX].forEach((x) => {
        context.fillStyle = '#ffffff'
        context.strokeStyle = '#2f6df6'
        context.lineWidth = 2
        context.beginPath()
        context.roundRect(x - 5, bandTop - 11, 10, bandHeight + 22, 4)
        context.fill()
        context.stroke()
      })
    }

    const majorTicks = Math.max(2, Math.min(10, Math.floor(width / 110)))
    context.strokeStyle = '#d1d5db'
    context.fillStyle = '#9fb6c8'
    context.font = '12px Inter, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'alphabetic'
    for (let index = 0; index <= majorTicks; index += 1) {
      const x = trackStart + (trackWidth / majorTicks) * index
      const time = start + (span / majorTicks) * index
      context.beginPath()
      context.moveTo(x, 10)
      context.lineTo(x, bandTop + bandHeight + 14)
      context.stroke()
      context.fillText(formatTime(new Date(time).toISOString()).slice(0, 5), x, bandTop - 10)
    }

    if (currentTimeMs !== null && currentTimeMs >= start && currentTimeMs <= end) {
      const x = xForTime(currentTimeMs)
      context.strokeStyle = '#ffffff'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(x, 4)
      context.lineTo(x, bandTop + bandHeight + 18)
      context.stroke()
    }
  }, [orderedSegments, selectedId, currentTimeMs, exportRangeVisible, exportStartMs, exportEndMs, windowRange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const rect = canvas.getBoundingClientRect()
      const pointerRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      setWindowRange((currentRange) => {
        const span = currentRange.end - currentRange.start
        const nextSpan = Math.min(24 * 60 * 60_000, Math.max(60_000, span * (event.deltaY > 0 ? 1.25 : 0.8)))
        const anchor = currentRange.start + span * pointerRatio
        return {
          start: anchor - nextSpan * pointerRatio,
          end: anchor + nextSpan * (1 - pointerRatio),
        }
      })
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [])

  function timeAt(clientX: number) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const trackWidth = Math.max(1, rect.width - trackInset * 2)
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - trackInset) / trackWidth))
    return windowRange.start + ratio * (windowRange.end - windowRange.start)
  }

  function pickSegmentAt(clientX: number) {
    const target = timeAt(clientX)
    if (target === null) return
    const containing = orderedSegments.find((segment) => {
      const start = new Date(segment.startTime).getTime()
      const end = new Date(segment.endTime).getTime()
      return target >= start && target <= end
    })
    if (containing) {
      onSelect(containing)
      return
    }
    const nearest = orderedSegments.reduce<DisplaySegment | null>((best, segment) => {
      if (!best) return segment
      const bestDistance = Math.abs(new Date(best.startTime).getTime() - target)
      const distance = Math.abs(new Date(segment.startTime).getTime() - target)
      return distance < bestDistance ? segment : best
    }, null)
    if (nearest) onSelect(nearest)
  }

  function selectRelative(direction: 1 | -1) {
    if (!orderedSegments.length) return
    const currentIndex = Math.max(0, orderedSegments.findIndex((segment) => segment.id === selectedId))
    const next = orderedSegments[Math.min(orderedSegments.length - 1, Math.max(0, currentIndex + direction))]
    if (next) onSelect(next)
  }

  function moveWindow(multiplier: number) {
    const span = windowRange.end - windowRange.start
    const delta = span * multiplier
    setWindowRange({ start: windowRange.start + delta, end: windowRange.end + delta })
  }

  function focusCurrentPlayback() {
    const selectedStart = selectedSegment ? new Date(selectedSegment.startTime).getTime() : null
    const selectedEnd = selectedSegment ? new Date(selectedSegment.endTime).getTime() : null
    const center = currentTimeMs ?? selectedStart
    if (center === null) return
    const segmentSpan = selectedStart !== null && selectedEnd !== null ? selectedEnd - selectedStart : 0
    const span = Math.max(60_000, Math.min(10 * 60_000, Math.max(segmentSpan * 2, 2 * 60_000)))
    setWindowRange({ start: center - span / 2, end: center + span / 2 })
  }

  function cyclePlaybackRate() {
    const currentIndex = playbackRates.findIndex((rate) => rate === playbackRate)
    const nextRate = playbackRates[(currentIndex + 1) % playbackRates.length] ?? 1
    onPlaybackRateChange(nextRate)
  }

  function exportHandleAt(clientX: number) {
    if (!exportRangeVisible) return null
    if (exportStartMs === null || exportEndMs === null) return null
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const span = Math.max(windowRange.end - windowRange.start, 1)
    const trackWidth = Math.max(1, rect.width - trackInset * 2)
    const xForTime = (time: number) => trackInset + ((time - windowRange.start) / span) * trackWidth
    const x = clientX - rect.left
    const startDistance = Math.abs(x - xForTime(exportStartMs))
    const endDistance = Math.abs(x - xForTime(exportEndMs))
    if (startDistance <= 12 || endDistance <= 12) {
      return startDistance <= endDistance ? 'export-start' : 'export-end'
    }
    return null
  }

  function updateExportHandle(kind: 'export-start' | 'export-end', clientX: number) {
    if (exportStartMs === null || exportEndMs === null) return
    const target = timeAt(clientX)
    if (target === null) return
    const minDuration = 1000
    if (kind === 'export-start') {
      const nextStart = Math.min(target, exportEndMs - minDuration)
      onExportRangeChange(toLocalDateTimePrecise(new Date(nextStart)), toLocalDateTimePrecise(new Date(exportEndMs)))
      return
    }
    const nextEnd = Math.max(target, exportStartMs + minDuration)
    onExportRangeChange(toLocalDateTimePrecise(new Date(exportStartMs)), toLocalDateTimePrecise(new Date(nextEnd)))
  }

  return (
    <aside className="timeRail">
      <div className="timelineHead">
        <div className="timelineButtons">
          <button title={isPlaying ? '暂停播放' : '播放'} onClick={onTogglePlayback} disabled={!selectedSegment}>
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button title="切换播放倍速" onClick={cyclePlaybackRate}>{formatPlaybackRate(playbackRate)}</button>
        </div>
        <div className="timelineClock">{currentTimeMs !== null ? formatTime(new Date(currentTimeMs).toISOString()) : formatTime(orderedSegments[orderedSegments.length - 1]?.startTime)}</div>
        <div className="timelineExportTools">
          <button className="exportRangeLabel" onClick={onExportRangeActivate} title="在时间线上显示导出区间，然后拖动左右把手调整">
            <Download size={15} />
            <span>{exportRangeVisible && exportStart && exportEnd ? `${formatTime(toIsoWithOffset(exportStart))} - ${formatTime(toIsoWithOffset(exportEnd))}` : '选择导出区间'}</span>
          </button>
          <ExportMode value={exportMode} onChange={onExportModeChange} />
          <button
            className="exportButton timelineExportButton"
            onClick={onExport}
            disabled={exporting}
            title={exportRangeVisible ? '按当前时间线区间创建导出任务' : '先显示导出区间，确认后再导出'}
          >
            <Download size={16} />
            {exportRangeVisible ? '确认导出' : '导出'}
          </button>
        </div>
      </div>
      {exportStatus && <div className="timelineExportStatus">{exportStatus}</div>}
      <div className="recordingTimelineHost">
        <canvas
          ref={canvasRef}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            const handle = exportHandleAt(event.clientX)
            if (handle) {
              dragRef.current = { kind: handle, moved: false }
              return
            }
            dragRef.current = { kind: 'pan', x: event.clientX, start: windowRange.start, end: windowRange.end, moved: false }
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current
            if (!drag) return
            if (drag.kind !== 'pan') {
              drag.moved = true
              updateExportHandle(drag.kind, event.clientX)
              return
            }
            const canvas = canvasRef.current
            if (!canvas) return
            const rect = canvas.getBoundingClientRect()
            const span = drag.end - drag.start
            const delta = ((event.clientX - drag.x) / rect.width) * span
            if (Math.abs(event.clientX - drag.x) > 3) drag.moved = true
            setWindowRange({ start: drag.start - delta, end: drag.end - delta })
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current
            dragRef.current = null
            if (drag?.kind === 'export-start' || drag?.kind === 'export-end') {
              updateExportHandle(drag.kind, event.clientX)
              return
            }
            if (!drag?.moved) pickSegmentAt(event.clientX)
          }}
        />
      </div>
      <div className="timelineActions">
        <button onClick={() => selectRelative(-1)}><RotateCcw size={18} /><span>上一个事件</span></button>
        <button onClick={() => selectRelative(1)}><RotateCw size={18} /><span>下一个事件</span></button>
        <button onClick={focusCurrentPlayback} disabled={currentTimeMs === null && !selectedSegment}><RefreshCw size={18} /><span>定位当前</span></button>
        <button onClick={() => {
          const center = currentTimeMs ?? (windowRange.start + windowRange.end) / 2
          const span = Math.max(60_000, (windowRange.end - windowRange.start) * 0.5)
          setWindowRange({ start: center - span / 2, end: center + span / 2 })
        }}><Unlink size={18} /><span>放大时间刻度</span></button>
        <button title="把时间线往更早时间移动半屏" onClick={() => moveWindow(-0.5)}><RotateCcw size={18} /><span>左移时间线</span></button>
      </div>
    </aside>
  )
}
