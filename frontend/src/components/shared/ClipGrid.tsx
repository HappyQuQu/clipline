import { Check, Play, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import type { DisplaySegment } from '../../utils'
import { formatClipDateTime } from '../../utils'

function ClipContextMenu({
  x,
  y,
  segment,
  transcriptionStatus,
  onTranscribe,
  onClose,
}: {
  x: number
  y: number
  segment: DisplaySegment
  transcriptionStatus?: string
  onTranscribe?: (segmentId: string) => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
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
      style={{ left: x, top: y }}
    >
      {!isCompleted && !isProcessing && (
        <button onClick={() => { onTranscribe?.(segment.id); onClose() }}>
          🎤 开始识别
        </button>
      )}
      {isProcessing && (
        <button disabled>
          ⏳ 识别中...
        </button>
      )}
      {isCompleted && (
        <>
          <button onClick={() => { onTranscribe?.(segment.id); onClose() }}>
            🔄 重新识别
          </button>
        </>
      )}
      {isFailed && (
        <button onClick={() => { onTranscribe?.(segment.id); onClose() }}>
          ❌ 重新识别
        </button>
      )}
      <button onClick={() => { window.open(`/api/segments/${segment.id}/stream`, '_blank'); onClose() }}>
        📹 在新窗口播放
      </button>
    </div>
  )
}

export function ClipGrid({
  sourceName,
  sourceNames,
  segments,
  selectedId,
  hasMore,
  loadingMore,
  total,
  onLoadMore,
  onSelect,
  onTranscribe,
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; segment: DisplaySegment } | null>(null)
  const [transcriptionStatuses, setTranscriptionStatuses] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    const segmentIds = segments.map((s) => s.id)
    if (segmentIds.length === 0) return

    const fetchStatuses = async () => {
      const statuses = new Map<string, string>()
      await Promise.all(
        segmentIds.map(async (id) => {
          try {
            const status = await api.getTranscriptionStatus(id)
            statuses.set(id, status.status)
          } catch {
            // 忽略错误
          }
        })
      )
      setTranscriptionStatuses(statuses)
    }
    fetchStatuses()
  }, [segments])

  function handleContextMenu(e: React.MouseEvent, segment: DisplaySegment) {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, segment })
  }

  function handleCloseContextMenu() {
    setContextMenu(null)
  }

  if (!segments.length) return <div className="emptyDock">暂无录像片段</div>

  return (
    <>
      <div className="clipGrid">
        {segments.map((segment) => {
          const tStatus = transcriptionStatuses.get(segment.id)
          return (
            <button
              key={segment.id}
              className={segment.id === selectedId ? 'clipCard selected' : 'clipCard'}
              onClick={() => onSelect(segment)}
              onContextMenu={(e) => handleContextMenu(e, segment)}
            >
              <div className="clipPoster">
                {segment.thumbnailUrl && <img src={segment.thumbnailUrl} loading="lazy" decoding="async" alt="" />}
                <Play size={22} />
              </div>
              <span className="clipLabel">
                {sourceNames?.get(segment.sourceId) ?? sourceName}
                <br />
                {formatClipDateTime(segment.startTime)}
              </span>
              <span className="confidence">{segment.playable ? '可播放' : '转码'}</span>
              <div className={`clipSubtitleBar ${tStatus || 'none'}`}>
                {tStatus === 'completed' && <><Check size={12} /> 已识别</>}
                {tStatus === 'processing' && <><RotateCw size={12} className="spin" /> 识别中</>}
                {tStatus === 'pending' && <>⏳ 等待中</>}
                {tStatus === 'failed' && <><X size={12} /> 失败</>}
                {(!tStatus || tStatus === 'none') && <>未识别</>}
              </div>
            </button>
          )
        })}
      </div>
      {hasMore && (
        <button className="clipGridMore" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? '加载中...' : `继续加载，已显示 ${segments.length}/${total ?? segments.length}`}
        </button>
      )}
      {contextMenu && (
        <ClipContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          segment={contextMenu.segment}
          transcriptionStatus={transcriptionStatuses.get(contextMenu.segment.id)}
          onTranscribe={onTranscribe}
          onClose={handleCloseContextMenu}
        />
      )}
    </>
  )
}
