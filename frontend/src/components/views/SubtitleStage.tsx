import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../api'
import type { DisplaySegment } from '../../utils'

export function SubtitleStage({
  segments,
  sourceNames,
  onSelectSegment,
  onNotify,
}: {
  segments: DisplaySegment[]
  sourceNames: Map<string, string>
  onSelectSegment: (segment: DisplaySegment) => void
  onNotify: (text: string) => void
}) {
  const [transcriptionStatuses, setTranscriptionStatuses] = useState<Map<string, { status: string; progress: number }>>(new Map())
  const [filter, setFilter] = useState<'all' | 'completed' | 'processing' | 'pending' | 'failed' | 'none'>('all')
  const queryClient = useQueryClient()

  useEffect(() => {
    if (segments.length === 0) return
    const fetchStatuses = async () => {
      const statuses = new Map<string, { status: string; progress: number }>()
      await Promise.all(
        segments.map(async (s) => {
          try {
            const status = await api.getTranscriptionStatus(s.id)
            statuses.set(s.id, { status: status.status, progress: status.progress })
          } catch {
            // 忽略
          }
        })
      )
      setTranscriptionStatuses(statuses)
    }
    fetchStatuses()
  }, [segments])

  useEffect(() => {
    const hasProcessing = Array.from(transcriptionStatuses.values()).some(
      (s) => s.status === 'processing' || s.status === 'pending'
    )
    if (!hasProcessing) return
    const timer = setInterval(async () => {
      const statuses = new Map(transcriptionStatuses)
      for (const [id, s] of statuses) {
        if (s.status === 'processing' || s.status === 'pending') {
          try {
            const updated = await api.getTranscriptionStatus(id)
            statuses.set(id, { status: updated.status, progress: updated.progress })
          } catch {
            // 忽略
          }
        }
      }
      setTranscriptionStatuses(statuses)
    }, 2000)
    return () => clearInterval(timer)
  }, [transcriptionStatuses])

  function handleBatchTranscribe() {
    const pendingSegments = segments.filter((s) => {
      const status = transcriptionStatuses.get(s.id)
      return !status || status.status === 'none'
    })
    if (pendingSegments.length === 0) {
      onNotify('没有需要识别的片段')
      return
    }
    pendingSegments.forEach((s) => {
      api.triggerTranscription(s.id).catch(() => {})
    })
    onNotify(`已创建 ${pendingSegments.length} 个识别任务`)
    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['transcriptionStatus'] })
    }, 500)
  }

  const filteredSegments = segments.filter((s) => {
    if (filter === 'all') return true
    const status = transcriptionStatuses.get(s.id)
    if (filter === 'none') return !status || status.status === 'none'
    return status?.status === filter
  })

  const counts = {
    all: segments.length,
    completed: 0,
    processing: 0,
    pending: 0,
    failed: 0,
    none: 0,
  }
  for (const s of segments) {
    const status = transcriptionStatuses.get(s.id)
    if (!status || status.status === 'none') counts.none++
    else if (status.status === 'completed') counts.completed++
    else if (status.status === 'processing') counts.processing++
    else if (status.status === 'pending') counts.pending++
    else if (status.status === 'failed') counts.failed++
  }

  function formatDateTime(iso: string) {
    if (!iso) return '-'
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  function getStatusBadge(status?: string) {
    switch (status) {
      case 'completed': return <span className="subtitleBadge completed">✅ 已完成</span>
      case 'processing': return <span className="subtitleBadge processing">🔄 处理中</span>
      case 'pending': return <span className="subtitleBadge pending">⏳ 等待中</span>
      case 'failed': return <span className="subtitleBadge failed">❌ 失败</span>
      default: return <span className="subtitleBadge none">⬜ 未识别</span>
    }
  }

  return (
    <section className="modulePanel">
      <div className="moduleHead">
        <div>
          <div className="moduleTitle">字幕任务</div>
          <div className="moduleMeta">
            已完成 {counts.completed} · 处理中 {counts.processing + counts.pending} · 未识别 {counts.none} · 共 {counts.all}
          </div>
        </div>
        <div className="subtitleStageActions">
          <button className="subtitleBatchButton" onClick={handleBatchTranscribe}>
            🎤 全部识别
          </button>
          <button className="refreshButton" onClick={() => void queryClient.invalidateQueries({ queryKey: ['transcriptionStatus'] })}>
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      <div className="subtitleFilters">
        {(['all', 'completed', 'processing', 'pending', 'failed', 'none'] as const).map((f) => (
          <button
            key={f}
            className={`subtitleFilter ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' && `全部 (${counts.all})`}
            {f === 'completed' && `已完成 (${counts.completed})`}
            {f === 'processing' && `处理中 (${counts.processing})`}
            {f === 'pending' && `等待中 (${counts.pending})`}
            {f === 'failed' && `失败 (${counts.failed})`}
            {f === 'none' && `未识别 (${counts.none})`}
          </button>
        ))}
      </div>

      <div className="subtitleTaskList">
        {filteredSegments.length === 0 ? (
          <div className="subtitleEmpty">没有匹配的片段</div>
        ) : (
          filteredSegments.map((segment) => {
            const tStatus = transcriptionStatuses.get(segment.id)
            return (
              <div
                key={segment.id}
                className="subtitleTaskItem"
                onClick={() => onSelectSegment(segment)}
              >
                <div className="subtitleTaskInfo">
                  <span className="subtitleTaskName">
                    {sourceNames?.get(segment.id) ?? segment.filename ?? '未知'}
                  </span>
                  <span className="subtitleTaskTime">
                    {formatDateTime(segment.startTime)}
                  </span>
                </div>
                <div className="subtitleTaskStatus">
                  {getStatusBadge(tStatus?.status)}
                  {(tStatus?.status === 'processing' || tStatus?.status === 'pending') && (
                    <span className="subtitleTaskProgress">
                      {Math.round((tStatus.progress || 0) * 100)}%
                    </span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
