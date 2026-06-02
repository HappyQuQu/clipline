import { ChevronDown, ChevronUp, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DisplaySegment } from '../../utils'
import { formatPlaybackRate, formatTime, playbackRates } from '../../utils'

const MIN_SPAN = 60_000
const MAX_SPAN = 24 * 60 * 60_000
const DAY_MS = 24 * 60 * 60_000

function startOfLocalDay(ms: number) {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function formatTimelineDate(ms: number) {
  const date = new Date(ms)
  const now = new Date()
  const month = date.getMonth() + 1
  const day = date.getDate()
  if (date.getFullYear() !== now.getFullYear()) return `${date.getFullYear()}年${month}月${day}日`
  return `${month}月${day}日`
}

export function TimeRail({
  dateStart,
  dateEnd,
  segments,
  selectedId,
  playbackTimeMs,
  playbackRate,
  isPlaying,
  manageOpen,
  onSelect,
  onPlaybackRateChange,
  onManage,
  onDateStartChange,
  onDateEndChange,
  onRangeChange,
}: {
  dateStart: string
  dateEnd: string
  segments: DisplaySegment[]
  selectedId?: string
  playbackTimeMs: number | null
  playbackRate: number
  isPlaying: boolean
  manageOpen?: boolean
  onSelect: (segment: DisplaySegment) => void
  onPlaybackRateChange: (rate: number) => void
  onTogglePlayback: () => void
  onManage?: () => void
  onDateStartChange?: (date: string) => void
  onDateEndChange?: (date: string) => void
  onRangeChange?: (startMs: number, endMs: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const previousSelectedIdRef = useRef<string | undefined>(undefined)

  const orderedSegments = useMemo(
    () => [...segments].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    [segments],
  )
  const firstStart = orderedSegments[0] ? new Date(orderedSegments[0].startTime).getTime() : Date.now()
  const lastEnd = orderedSegments[orderedSegments.length - 1]
    ? new Date(orderedSegments[orderedSegments.length - 1].endTime).getTime()
    : firstStart

  const selectedSegment = orderedSegments.find((s) => s.id === selectedId)
  const currentTimeMs = playbackTimeMs ?? (selectedSegment ? new Date(selectedSegment.startTime).getTime() : null)

  const DEFAULT_SPAN = 60 * 60_000 // 默认 1 小时
  const [windowRange, setWindowRange] = useState(() => {
    return { start: lastEnd - DEFAULT_SPAN, end: lastEnd }
  })

  function rangeAroundFocus(focusMs: number, segmentEndMs = focusMs, span = DEFAULT_SPAN) {
    const lead = Math.min(span * 0.06, 4 * 60_000)
    const segmentTail = Math.min(span * 0.015, 60_000)
    const end = Math.max(focusMs + lead, segmentEndMs + segmentTail)
    return { start: end - span, end }
  }

  // 区间选择
  const [rangeSelectMode, setRangeSelectMode] = useState(false)
  const [rangeStart, setRangeStart] = useState<number | null>(null)
  const [rangeEnd, setRangeEnd] = useState<number | null>(null)
  const [rangeDragging, setRangeDragging] = useState<'none' | 'selecting' | 'moving-start' | 'moving-end'>('none')

  function notifyRange(startMs: number, endMs: number) {
    if (!onRangeChange) return
    const rs = Math.min(startMs, endMs)
    const re = Math.max(startMs, endMs)
    if (re - rs > 1000) onRangeChange(rs, re)
  }

  function setRange(nextStart: number, nextEnd: number, notify = false) {
    setRangeStart(nextStart)
    setRangeEnd(nextEnd)
    if (notify) notifyRange(nextStart, nextEnd)
  }

  // 缩放
  function spanToSlider(spanMs: number) {
    return Math.round(((Math.log(Math.max(MIN_SPAN, Math.min(MAX_SPAN, spanMs))) - Math.log(MIN_SPAN)) / (Math.log(MAX_SPAN) - Math.log(MIN_SPAN))) * 100)
  }
  function sliderToSpan(v: number) {
    return Math.exp(Math.log(MIN_SPAN) + (v / 100) * (Math.log(MAX_SPAN) - Math.log(MIN_SPAN)))
  }
  const zoomValue = spanToSlider(windowRange.end - windowRange.start)
  function handleZoomChange(v: number) {
    const newSpan = sliderToSpan(v)
    const center = (windowRange.start + windowRange.end) / 2
    setWindowRange({ start: center - newSpan / 2, end: center + newSpan / 2 })
  }

  useEffect(() => {
    if (!orderedSegments.length) return
    setWindowRange({ start: lastEnd - DEFAULT_SPAN, end: lastEnd })
  }, [dateStart, dateEnd, lastEnd, orderedSegments.length])

  useEffect(() => {
    if (!selectedSegment || !selectedId) return
    if (previousSelectedIdRef.current === selectedId) return
    previousSelectedIdRef.current = selectedId
    const sStart = new Date(selectedSegment.startTime).getTime()
    const sEnd = new Date(selectedSegment.endTime).getTime()
    const segSpan = Math.max(sEnd - sStart, 1)
    const center = currentTimeMs !== null && currentTimeMs >= sStart && currentTimeMs <= sEnd
      ? currentTimeMs : sStart + segSpan / 2
    const span = DEFAULT_SPAN
    setWindowRange(rangeAroundFocus(center, sEnd, span))
  }, [currentTimeMs, selectedId, selectedSegment])

  // 管理面板打开 → 初始化为当前片段区间，关闭 → 退出
  const prevManageOpenRef = useRef(false)
  useEffect(() => {
    if (manageOpen && !prevManageOpenRef.current) {
      const now = currentTimeMs ?? Date.now()
      const initialStart = selectedSegment ? new Date(selectedSegment.startTime).getTime() : now
      const initialEnd = selectedSegment ? new Date(selectedSegment.endTime).getTime() : now + 60_000
      const initialSpan = Math.max(initialEnd - initialStart, 60_000)
      const manageSpan = Math.min(30 * 60_000, Math.max(10 * 60_000, initialSpan * 4))
      setRange(initialStart, initialEnd, true)
      setWindowRange(rangeAroundFocus(initialStart, initialEnd, manageSpan))
      setRangeSelectMode(true)
    } else if (!manageOpen && prevManageOpenRef.current) {
      setRangeSelectMode(false)
      setRangeStart(null)
      setRangeEnd(null)
    }
    prevManageOpenRef.current = Boolean(manageOpen)
  }, [manageOpen, currentTimeMs, selectedSegment])

  // 用户手动拖拽后暂停自动滚动，点"定位"或选片段恢复
  const userPanningRef = useRef(false)

  // ── 播放时自动向下滚动，保持指针可见 ──
  useEffect(() => {
    if (!isPlaying || currentTimeMs === null || userPanningRef.current) return
    setWindowRange((cur) => {
      const span = cur.end - cur.start
      const margin = span * 0.15 // 指针接近底部 15% 时触发滚动
      // 最新在上，所以 currentTimeMs 越大越靠下
      // 如果指针超出底部边缘，把窗口向下移
      if (currentTimeMs > cur.end - margin) {
        const newEnd = currentTimeMs + margin
        return { start: newEnd - span, end: newEnd }
      }
      // 如果指针超出顶部边缘（倒放等场景），把窗口向上移
      if (currentTimeMs < cur.start + margin) {
        const newStart = currentTimeMs - margin
        return { start: newStart, end: newStart + span }
      }
      return cur
    })
  }, [isPlaying, currentTimeMs])

  function enterRangeMode() {
    if (!selectedSegment || !currentTimeMs) { onManage?.(); return }
    setRangeStart(new Date(selectedSegment.startTime).getTime())
    setRangeEnd(new Date(selectedSegment.endTime).getTime())
    setRangeSelectMode(true)
  }
  function exitRangeMode() {
    setRangeSelectMode(false); setRangeStart(null); setRangeEnd(null); setRangeDragging('none')
  }

  function getTimelineY(ms: number) {
    const span = Math.max(windowRange.end - windowRange.start, 1)
    const trackTop = 14
    const trackBottom = canvasSize.h - 14
    const trackH = trackBottom - trackTop
    return Math.max(trackTop, Math.min(trackBottom, trackBottom - ((ms - windowRange.start) / span) * trackH))
  }

  // ── ResizeObserver ──
  const [canvasSize, setCanvasSize] = useState({ w: 240, h: 400 })
  useEffect(() => {
    const parent = canvasRef.current?.parentElement
    if (!parent) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) setCanvasSize({ w: Math.round(width), h: Math.round(height) })
      }
    })
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])

  // 布局常量
  const lineX = 48   // 线条位置（左侧）
  const thumbLeft = 62 // 缩略图起始 X

  // ── 绘制（仅刻度 + 线条 + 指针） ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvasSize.w
    const h = canvasSize.h
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const start = windowRange.start
    const end = windowRange.end
    const span = Math.max(end - start, 1)
    const trackTop = 14
    const trackBottom = h - 14
    const trackH = trackBottom - trackTop

    function yForTime(ms: number) { return trackBottom - ((ms - start) / span) * trackH }
    function clampY(y: number) { return Math.max(trackTop, Math.min(trackBottom, y)) }

    ctx.clearRect(0, 0, w, h)

    // 底线
    ctx.strokeStyle = '#e5e7eb'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(lineX, trackTop)
    ctx.lineTo(lineX, trackBottom)
    ctx.stroke()

    // 跨天日期分隔条，使用中文格式，避免浏览器默认英文月份。
    const firstBoundary = startOfLocalDay(start) + DAY_MS
    ctx.font = '12px Inter, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    for (let boundary = firstBoundary; boundary < end; boundary += DAY_MS) {
      const y = clampY(yForTime(boundary))
      const label = formatTimelineDate(boundary - 1)
      const bandHeight = 38
      const bandY = Math.max(trackTop, Math.min(trackBottom - bandHeight, y - bandHeight / 2))

      ctx.fillStyle = 'rgba(248, 250, 252, 0.94)'
      ctx.fillRect(0, bandY, w, bandHeight)
      ctx.strokeStyle = '#eef1f4'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, bandY + 0.5)
      ctx.lineTo(w, bandY + 0.5)
      ctx.moveTo(0, bandY + bandHeight - 0.5)
      ctx.lineTo(w, bandY + bandHeight - 0.5)
      ctx.stroke()

      ctx.fillStyle = '#7b8794'
      ctx.font = '12px Inter, system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(label, lineX - 10, bandY + bandHeight / 2)
    }

    // 录像区间（蓝色粗线）+ 连接线到缩略图
    ctx.lineCap = 'round'
    const thumbLeftEdge = 62
    orderedSegments.forEach((seg) => {
      const segStart = new Date(seg.startTime).getTime()
      const segEnd = new Date(seg.endTime).getTime()
      if (segEnd < start || segStart > end) return
      const y1 = clampY(yForTime(segStart))
      const y2 = clampY(yForTime(segEnd))
      const isActive = seg.id === selectedId

      // 蓝色粗线
      ctx.strokeStyle = isActive ? '#2563eb' : '#93c5fd'
      ctx.lineWidth = isActive ? 6 : 4
      ctx.beginPath()
      ctx.moveTo(lineX, y1)
      ctx.lineTo(lineX, y2)
      ctx.stroke()

      // 连接线：从时间线到缩略图
      ctx.strokeStyle = isActive ? '#93c5fd' : '#cbd5e1'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(lineX + 5, y1)
      ctx.lineTo(thumbLeftEdge - 2, y1)
      ctx.stroke()
      // 连接点小圆
      ctx.fillStyle = isActive ? '#3b82f6' : '#94a3b8'
      ctx.beginPath()
      ctx.arc(thumbLeftEdge - 2, y1, 3, 0, Math.PI * 2)
      ctx.fill()
    })

    // 刻度标签（线条左侧）
    const majorTicks = Math.max(2, Math.min(12, Math.floor(trackH / 56)))
    ctx.font = '10px Inter, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'right'
    ctx.lineWidth = 1
    for (let i = 0; i <= majorTicks; i++) {
      const y = trackTop + (trackH / majorTicks) * i
      // 反转：y 越小（上方）时间越新
      const time = end - (span / majorTicks) * i
      // 刻度短线
      ctx.strokeStyle = '#d1d5db'
      ctx.beginPath()
      ctx.moveTo(lineX - 3, y)
      ctx.lineTo(lineX + 3, y)
      ctx.stroke()
      // 标签
      ctx.fillStyle = '#9ca3af'
      ctx.fillText(formatTime(new Date(time).toISOString()).slice(0, 5), lineX - 6, y)
    }

    // 播放指针
    if (currentTimeMs !== null && currentTimeMs >= start && currentTimeMs <= end) {
      const y = yForTime(currentTimeMs)
      ctx.fillStyle = '#111827'
      ctx.beginPath()
      ctx.arc(lineX, y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(lineX, y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [orderedSegments, selectedId, currentTimeMs, windowRange, rangeSelectMode, rangeStart, rangeEnd, canvasSize])

  // ── 计算可见缩略图位置（固定高度，定位在片段起始时间） ──
  const visibleThumbs = useMemo(() => {
    const start = windowRange.start
    const end = windowRange.end
    const span = Math.max(end - start, 1)
    const trackTop = 14
    const trackBottom = canvasSize.h - 14
    const trackH = trackBottom - trackTop
    function yForTime(ms: number) { return trackBottom - ((ms - start) / span) * trackH }

    return orderedSegments
      .filter((seg) => {
        const segEnd = new Date(seg.endTime).getTime()
        const segStart = new Date(seg.startTime).getTime()
        return segEnd > start && segStart < end
      })
      .map((seg) => {
        const segStart = new Date(seg.startTime).getTime()
        const y = Math.max(trackTop, Math.min(trackBottom, yForTime(segStart)))
        return { seg, top: y }
      })
      .filter((item) => item.top + 36 > trackTop && item.top - 36 < trackBottom)
  }, [orderedSegments, windowRange, canvasSize])

  // ── 滚轮 ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
      setWindowRange((cur) => {
        const span = cur.end - cur.start
        const next = Math.min(MAX_SPAN, Math.max(MIN_SPAN, span * (e.deltaY > 0 ? 1.25 : 0.8)))
        const anchor = cur.start + span * ratio
        return { start: anchor - next * ratio, end: anchor + next * (1 - ratio) }
      })
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [])

  // ── 坐标 ──
  function timeForY(clientY: number) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const ratio = 1 - Math.min(1, Math.max(0, (clientY - rect.top - 14) / (rect.height - 28)))
    return windowRange.start + ratio * (windowRange.end - windowRange.start)
  }
  function findNearestSegment(clientY: number) {
    const target = timeForY(clientY)
    if (target === null) return null
    const containing = orderedSegments.find((s) => {
      const st = new Date(s.startTime).getTime()
      const en = new Date(s.endTime).getTime()
      return target >= st && target <= en
    })
    if (containing) return containing
    return orderedSegments.reduce<DisplaySegment | null>((best, s) => {
      if (!best) return s
      return Math.abs(new Date(s.startTime).getTime() - target) < Math.abs(new Date(best.startTime).getTime() - target) ? s : best
    }, null)
  }

  // ── 指针事件 ──
  const dragRef = useRef<{ anchorY: number; anchorStart: number; anchorEnd: number; moved: boolean }>({ anchorY: 0, anchorStart: 0, anchorEnd: 0, moved: false })

  function handlePointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const canvas = canvasRef.current
    if (!canvas) return
    // 平移。管理模式下空白点击也只平移时间线，避免选择框跳到鼠标位置。
    dragRef.current = { anchorY: e.clientY, anchorStart: windowRange.start, anchorEnd: windowRange.end, moved: false }
  }

  function handlePointerMove(e: React.PointerEvent) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()

    if (rangeDragging === 'selecting') {
      const ms = timeForY(e.clientY)
      if (ms !== null && rangeStart !== null) setRange(rangeStart, ms, true)
      return
    }
    if (rangeDragging === 'moving-start') {
      const ms = timeForY(e.clientY)
      if (ms !== null && rangeEnd !== null) setRange(ms, rangeEnd, true)
      return
    }
    if (rangeDragging === 'moving-end') {
      const ms = timeForY(e.clientY)
      if (ms !== null && rangeStart !== null) setRange(rangeStart, ms, true)
      return
    }

    if (dragRef.current.anchorY !== 0) {
      if (Math.abs(e.clientY - dragRef.current.anchorY) > 3) {
        dragRef.current.moved = true
        userPanningRef.current = true
      }
      const span = dragRef.current.anchorEnd - dragRef.current.anchorStart
      const delta = ((e.clientY - dragRef.current.anchorY) / rect.height) * span
      setWindowRange({ start: dragRef.current.anchorStart + delta, end: dragRef.current.anchorEnd + delta })
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (rangeDragging === 'selecting' || rangeDragging === 'moving-start' || rangeDragging === 'moving-end') {
      if (onRangeChange && rangeStart !== null && rangeEnd !== null) {
        const rs = Math.min(rangeStart, rangeEnd)
        const re = Math.max(rangeStart, rangeEnd)
        if (re - rs > 1000) onRangeChange(rs, re)
      }
      setRangeDragging('none')
      return
    }
    const wasDragged = dragRef.current.moved
    dragRef.current = { anchorY: 0, anchorStart: 0, anchorEnd: 0, moved: false }
    // 只有没拖拽才算点击，才触发选片段
    if (!wasDragged && !rangeSelectMode) {
      const seg = findNearestSegment(e.clientY)
      if (seg) {
        userPanningRef.current = false
        onSelect(seg)
      }
    }
  }

  function handleRangeHandlePointerDown(kind: 'moving-start' | 'moving-end', event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    setRangeDragging(kind)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleRangeHandlePointerMove(kind: 'moving-start' | 'moving-end', event: React.PointerEvent<HTMLButtonElement>) {
    if (rangeDragging !== kind) return
    const ms = timeForY(event.clientY)
    if (ms === null) return
    if (kind === 'moving-start' && rangeEnd !== null) setRange(ms, rangeEnd, true)
    if (kind === 'moving-end' && rangeStart !== null) setRange(rangeStart, ms, true)
  }

  function handleRangeHandlePointerUp() {
    setRangeDragging('none')
  }

  const rangeOverlay = useMemo(() => {
    if (!rangeSelectMode || rangeStart === null || rangeEnd === null) return null
    const startMs = Math.min(rangeStart, rangeEnd)
    const endMs = Math.max(rangeStart, rangeEnd)
    const yTop = getTimelineY(endMs)
    const yBottom = getTimelineY(startMs)
    const rawCurrentY = currentTimeMs !== null && currentTimeMs >= windowRange.start && currentTimeMs <= windowRange.end
      ? getTimelineY(currentTimeMs)
      : null
    const currentY = rawCurrentY !== null && rawCurrentY - yTop > 34 && yBottom - rawCurrentY > 34
      ? rawCurrentY
      : null
    return {
      yTop,
      yBottom,
      height: Math.max(42, yBottom - yTop),
      startMs,
      endMs,
      currentY,
    }
  }, [rangeSelectMode, rangeStart, rangeEnd, currentTimeMs, windowRange, canvasSize])

  function selectRelative(dir: 1 | -1) {
    if (!orderedSegments.length) return
    const idx = Math.max(0, orderedSegments.findIndex((s) => s.id === selectedId))
    const next = orderedSegments[Math.min(orderedSegments.length - 1, Math.max(0, idx + dir))]
    if (next) onSelect(next)
  }
  function focusCurrent() {
    userPanningRef.current = false
    const center = currentTimeMs ?? (selectedSegment ? new Date(selectedSegment.startTime).getTime() : null)
    if (center === null) return
    const sStart = selectedSegment ? new Date(selectedSegment.startTime).getTime() : center
    const sEnd = selectedSegment ? new Date(selectedSegment.endTime).getTime() : center
    const span = DEFAULT_SPAN
    setWindowRange(rangeAroundFocus(center, sEnd, span))
  }
  function cycleRate() {
    const idx = playbackRates.findIndex((r) => r === playbackRate)
    onPlaybackRateChange(playbackRates[(idx + 1) % playbackRates.length] ?? 1)
  }

  return (
    <aside className="timeRail">
      <div className="timelineHead">
        <div className="timelineButtons">
          <button title="倍速" onClick={cycleRate}>{formatPlaybackRate(playbackRate)}</button>
        </div>
        <div className="timelineClock">
          {currentTimeMs !== null ? formatTime(new Date(currentTimeMs).toISOString()) : '--:--:--'}
        </div>
      </div>

      <div className="timelineDateZoom">
        <div className="timelineDateRange">
          {onDateStartChange ? (
            <input type="date" className="timelineDatePicker" value={dateStart}
              onChange={(e) => onDateStartChange(e.target.value)} />
          ) : (
            <span className="timelineDateDisplay">{dateStart}</span>
          )}
          <span className="timelineDateArrow">→</span>
          {onDateEndChange ? (
            <input type="date" className="timelineDatePicker" value={dateEnd}
              onChange={(e) => onDateEndChange(e.target.value)} />
          ) : (
            <span className="timelineDateDisplay">{dateEnd}</span>
          )}
        </div>
        <div className="timelineZoomSlider">
          <span className="timelineZoomLabel">−</span>
          <input type="range" min={0} max={100} value={zoomValue}
            onChange={(e) => handleZoomChange(Number(e.target.value))} />
          <span className="timelineZoomLabel">+</span>
        </div>
      </div>

      {rangeSelectMode && (
        <div className="timelineRangeHint">
          <span>拖拽开始/结束边界</span>
          <button onClick={exitRangeMode}>取消</button>
        </div>
      )}

      <div className="recordingTimelineHost">
        <canvas ref={canvasRef}
          className={rangeSelectMode ? 'rangeMode' : ''}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        {rangeOverlay && (
          <div
            className="timelineRangeOverlay"
            style={{ top: rangeOverlay.yTop, height: rangeOverlay.height }}
          >
            <button
              type="button"
              className="timelineRangeHandle timelineRangeHandleEnd"
              title="拖拽调整结束时间"
              onPointerDown={(event) => handleRangeHandlePointerDown('moving-end', event)}
              onPointerMove={(event) => handleRangeHandlePointerMove('moving-end', event)}
              onPointerUp={handleRangeHandlePointerUp}
              onPointerCancel={handleRangeHandlePointerUp}
            >
              <span>结束</span>
              <ChevronUp size={20} />
              <time>{formatTime(new Date(rangeOverlay.endMs).toISOString())}</time>
            </button>
            <div className="timelineRangeBox" />
            {rangeOverlay.currentY !== null && (
              <div
                className="timelineRangeCurrent"
                style={{ top: rangeOverlay.currentY - rangeOverlay.yTop }}
              >
                <span>{formatTime(new Date(currentTimeMs ?? rangeOverlay.startMs).toISOString())}</span>
              </div>
            )}
            <button
              type="button"
              className="timelineRangeHandle timelineRangeHandleStart"
              title="拖拽调整开始时间"
              onPointerDown={(event) => handleRangeHandlePointerDown('moving-start', event)}
              onPointerMove={(event) => handleRangeHandlePointerMove('moving-start', event)}
              onPointerUp={handleRangeHandlePointerUp}
              onPointerCancel={handleRangeHandlePointerUp}
            >
              <span>开始</span>
              <ChevronDown size={20} />
              <time>{formatTime(new Date(rangeOverlay.startMs).toISOString())}</time>
            </button>
          </div>
        )}
        {!manageOpen && (
          <div className="timelineThumbs">
            {visibleThumbs.map(({ seg, top }) => (
              <button
                key={seg.id}
                className={`timelineThumb${seg.id === selectedId ? ' timelineThumbActive' : ''}`}
                style={{ top: top - 36 }}
                onClick={() => { userPanningRef.current = false; onSelect(seg) }}
                title={`${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}`}
              >
                {seg.thumbnailUrl ? (
                  <img src={seg.thumbnailUrl} alt="" />
                ) : (
                  <div className="timelineThumbPlaceholder">
                    <span className="timelineThumbTime">{formatTime(seg.startTime).slice(0, 5)}</span>
                    <span className="timelineThumbDur">{Math.round(seg.durationSeconds)}秒</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="timelineActions">
        <button onClick={() => selectRelative(-1)}><ChevronUp size={16} /><span>上一个</span></button>
        <button onClick={() => selectRelative(1)}><ChevronDown size={16} /><span>下一个</span></button>
        <button onClick={focusCurrent} disabled={!selectedSegment}><RefreshCw size={16} /><span>定位</span></button>
        <button onClick={() => onManage?.()}>
          <SlidersHorizontal size={16} /><span>管理</span>
        </button>
      </div>
    </aside>
  )
}
