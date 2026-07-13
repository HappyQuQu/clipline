import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Check,
  CircleAlert,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Mic,
  Play,
  RotateCw,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import type { DisplaySegment } from '../../utils'
import { formatClipDateTime } from '../../utils'

const CARD_TARGET_WIDTH = 210
const CARD_MIN_HEIGHT = 116
const CARD_MAX_HEIGHT = 148
const GRID_GAP = 8

function ClipContextMenu({
  x, y, segment, transcriptionStatus, onTranscribe, onClose,
}: {
  x: number; y: number; segment: DisplaySegment; transcriptionStatus?: string
  onTranscribe?: (segmentId: string) => void; onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const isProcessing = transcriptionStatus === 'processing' || transcriptionStatus === 'pending'
  const isCompleted = transcriptionStatus === 'completed'
  const isFailed = transcriptionStatus === 'failed'

  return (
    <div
      ref={menuRef}
      className="clipContextMenu"
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 132) }}
    >
      {!isCompleted && !isProcessing && (
        <button onClick={() => { onTranscribe?.(segment.id); onClose() }}><Mic size={16} />开始识别</button>
      )}
      {isProcessing && <button disabled><LoaderCircle size={16} className="spin" />识别中...</button>}
      {isCompleted && (
        <button onClick={() => { onTranscribe?.(segment.id); onClose() }}><RotateCw size={16} />重新识别</button>
      )}
      {isFailed && (
        <button onClick={() => { onTranscribe?.(segment.id); onClose() }}><CircleAlert size={16} />重新识别</button>
      )}
      <button onClick={() => { window.open(`/api/segments/${segment.id}/stream`, '_blank'); onClose() }}>
        <ExternalLink size={16} />在新窗口播放
      </button>
    </div>
  )
}

export function ClipGrid({
  sourceName, sourceNames, segments, selectedId, hasMore, loadingMore, total,
  onLoadMore, onSelect, onTranscribe,
}: {
  sourceName: string
  sourceNames?: Map<string, string>
  segments: DisplaySegment[]
  selectedId?: string
  hasMore?: boolean
  loadingMore?: boolean
  total?: number
  onLoadMore?: () => void
  onSelect: (segment: DisplaySegment) => void
  onTranscribe?: (segmentId: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(800)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; segment: DisplaySegment } | null>(null)
  const [transcriptionStatuses, setTranscriptionStatuses] = useState<Map<string, string>>(new Map())

  // 监听容器宽度
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateWidth = () => {
      const width = Math.floor(el.getBoundingClientRect().width)
      if (width > 0) setContainerWidth(width)
    }
    updateWidth()
    const frame = window.requestAnimationFrame(updateWidth)
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.floor(entry.contentRect.width)
        if (width > 0) setContainerWidth(width)
      }
    })
    ro.observe(el)
    return () => {
      window.cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [segments.length])

  const columns = Math.max(1, Math.floor((containerWidth + GRID_GAP) / (CARD_TARGET_WIDTH + GRID_GAP)))
  const cardWidth = Math.max(1, (containerWidth - GRID_GAP * (columns - 1)) / columns)
  const cardHeight = Math.round(Math.min(CARD_MAX_HEIGHT, Math.max(CARD_MIN_HEIGHT, cardWidth * 0.56)))
  const rowCount = Math.ceil(segments.length / columns)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => cardHeight + GRID_GAP,
    overscan: 3,
  })
  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    virtualizer.measure()
  }, [cardHeight, columns, virtualizer])

  // 批量获取字幕状态（只取可见区域）
  const visibleSegments = useMemo(() => {
    const ids: string[] = []
    for (const item of virtualItems) {
      const start = item.index * columns
      const end = Math.min(start + columns, segments.length)
      for (let i = start; i < end; i++) ids.push(segments[i].id)
    }
    return ids
  }, [virtualItems, segments, columns])

  useEffect(() => {
    if (!visibleSegments.length) return
    let cancelled = false
    const fetchStatuses = async () => {
      const statuses = new Map(transcriptionStatuses)
      const toFetch = visibleSegments.filter((id) => !statuses.has(id))
      if (!toFetch.length) return
      await Promise.all(toFetch.map(async (id) => {
        try {
          const status = await api.getTranscriptionStatus(id)
          if (!cancelled) statuses.set(id, status.status)
        } catch { /* ignore */ }
      }))
      if (!cancelled) setTranscriptionStatuses(new Map(statuses))
    }
    fetchStatuses()
    return () => { cancelled = true }
  }, [visibleSegments])

  // 选中变化时滚动到对应位置
  useEffect(() => {
    if (!selectedId) return
    const idx = segments.findIndex((s) => s.id === selectedId)
    if (idx >= 0) {
      const rowIdx = Math.floor(idx / columns)
      virtualizer.scrollToIndex(rowIdx, { align: 'center' })
    }
  }, [selectedId, segments, columns])

  if (!segments.length) return <div className="emptyDock">暂无录像片段</div>

  return (
    <>
      <div ref={containerRef} className="clipGridScroll">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualItems.map((virtualRow) => {
            const rowStart = virtualRow.index * columns
            const rowEnd = Math.min(rowStart + columns, segments.length)
            return (
              <div
                key={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  className="clipGridRow"
                  style={{
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    height: cardHeight,
                  }}
                >
                  {Array.from({ length: rowEnd - rowStart }, (_, i) => {
                    const segment = segments[rowStart + i]
                    const tStatus = transcriptionStatuses.get(segment.id)
                    return (
                      <button
                        key={segment.id}
                        className={segment.id === selectedId ? 'clipCard selected' : 'clipCard'}
                        onClick={() => onSelect(segment)}
                        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, segment }) }}
                      >
                        <div className="clipPoster">
                          {segment.thumbnailUrl && (
                            <img
                              src={segment.thumbnailUrl}
                              loading="lazy"
                              decoding="async"
                              alt={`${sourceNames?.get(segment.sourceId) ?? sourceName} ${formatClipDateTime(segment.startTime)}`}
                            />
                          )}
                          <Play size={22} />
                        </div>
                        <span className="clipLabel">
                          {sourceNames?.get(segment.sourceId) ?? sourceName}
                          <br />
                          {formatClipDateTime(segment.startTime)}
                        </span>
                        <span className="confidence">{segment.playable ? '可播放' : '转码'}</span>
                        {tStatus && tStatus !== 'none' && <div className={`clipSubtitleBar ${tStatus}`}>
                          {tStatus === 'completed' && <><Check size={12} /> 已识别</>}
                          {tStatus === 'processing' && <><RotateCw size={12} className="spin" /> 识别中</>}
                          {tStatus === 'pending' && <><Clock3 size={12} /> 等待中</>}
                          {tStatus === 'failed' && <><X size={12} /> 失败</>}
                        </div>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {hasMore && (
        <button className="clipGridMore" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? '加载中...' : `继续加载，已显示 ${segments.length}/${total ?? segments.length}`}
        </button>
      )}
      {contextMenu && (
        <ClipContextMenu
          x={contextMenu.x} y={contextMenu.y} segment={contextMenu.segment}
          transcriptionStatus={transcriptionStatuses.get(contextMenu.segment.id)}
          onTranscribe={onTranscribe} onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}
