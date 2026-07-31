import { ArrowClockwise as RefreshCw, CheckCircle, Hourglass, MinusSquare, XCircle } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../api'
import type { DisplaySegment } from '../../utils'

const NAS_BATCH_TRANSCRIBE_LIMIT = 5

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
  const [batchCreating, setBatchCreating] = useState(false)
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

  async function handleBatchTranscribe() {
    const pendingSegments = segments.filter((s) => {
      const status = transcriptionStatuses.get(s.id)
      return !status || status.status === 'none'
    })
    if (pendingSegments.length === 0) {
      onNotify('没有需要识别的片段')
      return
    }
    const batch = pendingSegments.slice(0, NAS_BATCH_TRANSCRIBE_LIMIT)
    setBatchCreating(true)
    let created = 0
    try {
      for (const segment of batch) {
        try {
          await api.triggerTranscription(segment.id)
          created += 1
        } catch {
          // 单个片段失败不阻断后续任务。
        }
      }
      const remaining = pendingSegments.length - batch.length
      onNotify(remaining > 0
        ? `已创建 ${created} 个识别任务，剩余 ${remaining} 个可继续分批创建`
        : `已创建 ${created} 个识别任务`)
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['transcriptionStatus'] })
      }, 500)
    } finally {
      setBatchCreating(false)
    }
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
      case 'completed': return <span className="subtitleBadge completed"><CheckCircle size={13} />已完成</span>
      case 'processing': return <span className="subtitleBadge processing"><RefreshCw size={13} className="spin" />处理中</span>
      case 'pending': return <span className="subtitleBadge pending"><Hourglass size={13} />等待中</span>
      case 'failed': return <span className="subtitleBadge failed"><XCircle size={13} />失败</span>
      default: return <span className="subtitleBadge none"><MinusSquare size={13} />未识别</span>
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
          <button className="subtitleBatchButton" onClick={handleBatchTranscribe} disabled={batchCreating}>
            {batchCreating ? '创建中' : `创建 ${NAS_BATCH_TRANSCRIBE_LIMIT} 个识别任务`}
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
