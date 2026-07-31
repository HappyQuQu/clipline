import {
  ArrowsOutSimple,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  DownloadSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Pause,
  Play,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DisplaySegment } from '../../utils'
import { formatPlaybackRate, formatTime, playbackRates } from '../../utils'

const HOUR = 60 * 60_000
const MINUTE = 60_000

function inputDate(ms: number) {
  const date = new Date(ms)
  const offset = date.getTimezoneOffset() * MINUTE
  return new Date(ms - offset).toISOString().slice(0, 10)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function TimeRail({
  dateStart,
  dateEnd,
  segments,
  gaps,
  selectedId,
  playbackTimeMs,
  playbackRate,
  isPlaying,
  manageOpen,
  onSelect,
  onSeek,
  onPlaybackRateChange,
  onTogglePlayback,
  onManage,
  onDateStartChange,
  onDateEndChange,
  onRangeChange,
  onGapClick,
  exportMode,
  onExportModeChange,
  windowStartMs,
  windowEndMs,
}: {
  dateStart: string
  dateEnd: string
  segments: DisplaySegment[]
  gaps?: { startTime: string; endTime: string; durationSeconds: number }[]
  selectedId?: string
  playbackTimeMs: number | null
  playbackRate: number
  isPlaying: boolean
  manageOpen?: boolean
  onSelect: (segment: DisplaySegment) => void
  onSeek?: (segment: DisplaySegment, absoluteTimeMs: number) => void
  onPlaybackRateChange: (rate: number) => void
  onTogglePlayback: () => void
  onManage?: () => void
  onDateStartChange?: (date: string) => void
  onDateEndChange?: (date: string) => void
  onRangeChange?: (startMs: number, endMs: number) => void
  onGapClick?: (gap: { startTime: string; endTime: string; durationSeconds: number }) => void
  exportMode?: 'fast' | 'accurate'
  onExportModeChange?: (mode: 'fast' | 'accurate') => void
  windowStartMs?: number
  windowEndMs?: number
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const ordered = useMemo(
    () => [...segments].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    [segments],
  )
  const selected = ordered.find((segment) => segment.id === selectedId)
  const lastTime = ordered.length ? new Date(ordered[ordered.length - 1].endTime).getTime() : Date.now()
  const [span, setSpan] = useState(HOUR)
  const [windowEnd, setWindowEnd] = useState(lastTime + 5 * MINUTE)
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const dragRef = useRef<'start' | 'end' | null>(null)
  const windowStart = windowEnd - span

  useEffect(() => {
    if (windowStartMs !== undefined && windowEndMs !== undefined && windowEndMs > windowStartMs) {
      setSpan(windowEndMs - windowStartMs)
      setWindowEnd(windowEndMs)
      return
    }
    setWindowEnd(lastTime + 5 * MINUTE)
  }, [lastTime, dateStart, dateEnd, windowEndMs, windowStartMs])

  useEffect(() => {
    if (!selected) return
    const start = new Date(selected.startTime).getTime()
    const end = new Date(selected.endTime).getTime()
    if (start < windowStart || end > windowEnd) setWindowEnd(Math.max(end + 5 * MINUTE, start + span))
  }, [selectedId])

  useEffect(() => {
    if (!manageOpen || !selected) return
    const next = { start: new Date(selected.startTime).getTime(), end: new Date(selected.endTime).getTime() }
    setRange(next)
  }, [manageOpen, selectedId])

  const ticks = useMemo(
    () => Array.from({ length: 7 }, (_, index) => windowStart + (span / 6) * index),
    [windowStart, span],
  )

  const percent = (ms: number) => clamp(((ms - windowStart) / span) * 100, 0, 100)

  function timeAt(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return windowStart
    return windowStart + clamp((clientX - rect.left) / rect.width, 0, 1) * span
  }

  function commitRange(next: { start: number; end: number }) {
    const normalized = next.start <= next.end ? next : { start: next.end, end: next.start }
    setRange(normalized)
    if (normalized.end - normalized.start > 1000) onRangeChange?.(normalized.start, normalized.end)
  }

  function handleTrackClick(event: React.MouseEvent<HTMLDivElement>) {
    if (dragRef.current) return
    const target = timeAt(event.clientX)
    const containing = ordered.find((segment) => {
      const start = new Date(segment.startTime).getTime()
      const end = new Date(segment.endTime).getTime()
      return target >= start && target <= end
    })
    if (containing) {
      if (onSeek) onSeek(containing, target)
      else onSelect(containing)
      return
    }
    const clickedGap = gaps?.find((gap) => target >= new Date(gap.startTime).getTime() && target <= new Date(gap.endTime).getTime())
    if (clickedGap) onGapClick?.(clickedGap)
  }

  function openExportRange() {
    if (selected) {
      const next = { start: new Date(selected.startTime).getTime(), end: new Date(selected.endTime).getTime() }
      commitRange(next)
    }
    onManage?.()
  }

  function shiftDay(direction: -1 | 1) {
    const base = new Date(`${dateStart}T12:00:00`).getTime() + direction * 24 * HOUR
    const next = inputDate(base)
    onDateStartChange?.(next)
    onDateEndChange?.(next)
  }

  function cycleRate() {
    const index = playbackRates.findIndex((rate) => rate === playbackRate)
    onPlaybackRateChange(playbackRates[(index + 1) % playbackRates.length] ?? 1)
  }

  function selectRelative(direction: -1 | 1) {
    if (!ordered.length) return
    const currentIndex = ordered.findIndex((segment) => segment.id === selectedId)
    const base = currentIndex < 0 ? (direction > 0 ? -1 : ordered.length) : currentIndex
    const next = ordered[clamp(base + direction, 0, ordered.length - 1)]
    if (next) onSelect(next)
  }

  const activeRange = range ?? (selected ? {
    start: new Date(selected.startTime).getTime(),
    end: new Date(selected.endTime).getTime(),
  } : null)

  const selectedGapMs = useMemo(() => {
    if (!activeRange || !gaps?.length) return 0
    return gaps.reduce((sum, gap) => {
      const start = Math.max(activeRange.start, new Date(gap.startTime).getTime())
      const end = Math.min(activeRange.end, new Date(gap.endTime).getTime())
      return sum + Math.max(0, end - start)
    }, 0)
  }, [activeRange, gaps])

  return (
    <section className="playbackTimelinePanel" aria-label="录像时间线">
      <div className="playbackTimelineToolbar">
        <div className="playbackSegmentNavigation">
          <button type="button" onClick={() => selectRelative(-1)} disabled={!ordered.length}><CaretLeft size={14} />上一片段</button>
          <button type="button" onClick={() => selectRelative(1)} disabled={!ordered.length}>下一片段<CaretRight size={14} /></button>
        </div>
        <div className="playbackDateControl">
          <CalendarBlank size={17} />
          <button type="button" aria-label="前一天" onClick={() => shiftDay(-1)}><CaretLeft size={15} /></button>
          <input
            type="date"
            value={dateStart}
            onChange={(event) => {
              onDateStartChange?.(event.target.value)
              onDateEndChange?.(event.target.value)
            }}
          />
          <button type="button" aria-label="后一天" onClick={() => shiftDay(1)}><CaretRight size={15} /></button>
        </div>
        <div className="playbackTimelineTools">
          <button type="button" onClick={() => setSpan((value) => Math.min(24 * HOUR, value * 2))} title="缩小时间线"><MagnifyingGlassMinus size={17} /></button>
          <button type="button" onClick={() => setSpan((value) => Math.max(10 * MINUTE, value / 2))} title="放大时间线"><MagnifyingGlassPlus size={17} /></button>
          <button type="button" onClick={() => {
            const focus = playbackTimeMs ?? (selected ? new Date(selected.startTime).getTime() : lastTime)
            setWindowEnd(focus + span * 0.72)
          }} title="定位当前时间"><ArrowsOutSimple size={17} /></button>
          <button type="button" className="playbackRateButton" onClick={cycleRate}>{formatPlaybackRate(playbackRate)}</button>
          <span className="playbackTimelineLegend">{gaps?.length ?? 0} 个断档 <i className="recorded" />有录像 <i />断档</span>
        </div>
      </div>

      <div className="playbackTimelineRuler">
        {ticks.map((tick) => <time key={tick}>{formatTime(new Date(tick).toISOString()).slice(0, 5)}</time>)}
      </div>

      <div
        ref={trackRef}
        className="playbackTimelineTrack"
        onClick={handleTrackClick}
        onPointerMove={(event) => {
          if (!dragRef.current || !activeRange) return
          const point = timeAt(event.clientX)
          commitRange(dragRef.current === 'start' ? { start: point, end: activeRange.end } : { start: activeRange.start, end: point })
        }}
        onPointerUp={() => { dragRef.current = null }}
        onPointerCancel={() => { dragRef.current = null }}
      >
        <div className="playbackTimelineBaseline" />
        {gaps?.map((gap) => {
          const start = new Date(gap.startTime).getTime()
          const end = new Date(gap.endTime).getTime()
          if (end < windowStart || start > windowEnd) return null
          return <button key={`${gap.startTime}-${gap.endTime}`} type="button" className="playbackGapBlock" style={{ left: `${percent(start)}%`, width: `${Math.max(0.5, percent(end) - percent(start))}%` }} onClick={(event) => { event.stopPropagation(); onGapClick?.(gap) }} title={`断档 ${Math.round(gap.durationSeconds)} 秒`} />
        })}
        {ordered.map((segment) => {
          const start = new Date(segment.startTime).getTime()
          const end = new Date(segment.endTime).getTime()
          if (end < windowStart || start > windowEnd) return null
          return (
            <button
              key={segment.id}
              type="button"
              className={`playbackRecordingBlock${segment.id === selectedId ? ' active' : ''}`}
              style={{ left: `${percent(start)}%`, width: `${Math.max(0.8, percent(end) - percent(start))}%` }}
              onClick={(event) => { event.stopPropagation(); onSelect(segment) }}
              title={`${formatTime(segment.startTime)} – ${formatTime(segment.endTime)}`}
            />
          )
        })}
        {activeRange && (
          <div
            className={`playbackExportSelection${manageOpen ? ' active' : ''}`}
            style={{ left: `${percent(activeRange.start)}%`, width: `${Math.max(1, percent(activeRange.end) - percent(activeRange.start))}%` }}
          >
            <button type="button" className="start" aria-label="调整开始时间" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = 'start' }} />
            <button type="button" className="end" aria-label="调整结束时间" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = 'end' }} />
          </div>
        )}
        {playbackTimeMs !== null && playbackTimeMs >= windowStart && playbackTimeMs <= windowEnd && (
          <div className="playbackTimelinePlayhead" style={{ left: `${percent(playbackTimeMs)}%` }}><span /></div>
        )}
      </div>

      <div className="playbackExportRow">
        <button type="button" className="timelinePlayButton" aria-label={isPlaying ? '暂停' : '播放'} onClick={onTogglePlayback} disabled={!selected}>
          {isPlaying ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
        </button>
        <div className="playbackTimeReadout">
          <strong>{playbackTimeMs !== null ? formatTime(new Date(playbackTimeMs).toISOString()) : '--:--:--'}</strong>
          <span>{selected ? ` / ${formatTime(selected.endTime)}` : '选择录像片段开始回看'}</span>
        </div>
        <div className="playbackRangeReadout">
          <span>导出区间</span>
          <strong>{activeRange ? `${formatTime(new Date(activeRange.start).toISOString())} – ${formatTime(new Date(activeRange.end).toISOString())}` : '选择一个片段'}</strong>
        </div>
        {selectedGapMs > 1000 && <span className="playbackGapWarning">包含 {Math.round(selectedGapMs / 1000)} 秒断档</span>}
        <div className="playbackExportModes" aria-label="导出模式">
          <span>导出模式</span>
          <button type="button" className={exportMode !== 'accurate' ? 'active' : ''} onClick={() => onExportModeChange?.('fast')}>快速</button>
          <button type="button" className={exportMode === 'accurate' ? 'active' : ''} onClick={() => onExportModeChange?.('accurate')}>精准</button>
        </div>
        <button type="button" className="timelineExportButton" onClick={openExportRange} disabled={!selected}>
          <DownloadSimple size={17} /> 导出片段
        </button>
      </div>
    </section>
  )
}
