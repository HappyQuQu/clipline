import {
  ArrowClockwise,
  CheckCircle,
  DownloadSimple,
  DotsThree,
  Eye,
  FileText,
  SpinnerGap,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '../../api'
import type { ExportJob, TranscriptionJob, VisionJob } from '../../types'
import type { DisplaySegment } from '../../utils'
import { exportProgressPercent, formatBytes, formatClipDateTime, formatDuration, queryMessage } from '../../utils'

type TaskKind = 'export' | 'transcription' | 'vision'
type TaskStatus = 'all' | 'active' | 'waiting' | 'completed' | 'failed'

type UnifiedTask = {
  id: string
  kind: TaskKind
  title: string
  subtitle: string
  source: string
  status: string
  statusGroup: Exclude<TaskStatus, 'all'>
  statusLabel: string
  progress: number
  result: string
  createdAt: string
  segment?: DisplaySegment
  downloadUrl?: string | null
  outputSize?: number | null
  error?: string | null
  exportJob?: ExportJob
  transcriptionJob?: TranscriptionJob
  visionJob?: VisionJob
}

function normalizeStatus(status: string): UnifiedTask['statusGroup'] {
  if (status === 'running' || status === 'processing') return 'active'
  if (status === 'queued' || status === 'pending') return 'waiting'
  if (status === 'completed') return 'completed'
  return 'failed'
}

function statusLabel(status: string) {
  if (status === 'running' || status === 'processing') return '进行中'
  if (status === 'queued' || status === 'pending') return '待处理'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'canceled') return '已取消'
  if (status === 'expired') return '已过期'
  return status
}

export function TaskCenterView({
  exports,
  exportError,
  segments,
  sourceNames,
  onSelectSegment,
  onNotify,
}: {
  exports: ExportJob[]
  exportError: unknown
  segments: DisplaySegment[]
  sourceNames: Map<string, string>
  onSelectSegment: (segment: DisplaySegment) => void
  onNotify: (text: string) => void
}) {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<TaskStatus>('all')
  const [retryingId, setRetryingId] = useState('')

  const transcriptionJobsQuery = useQuery({
    queryKey: ['taskCenter', 'transcriptionJobs'],
    queryFn: () => api.getTranscriptionJobs(),
    refetchInterval: 2500,
  })
  const visionJobsQuery = useQuery({
    queryKey: ['taskCenter', 'visionJobs'],
    queryFn: () => api.getVisionJobs(),
    refetchInterval: 2500,
  })

  const segmentById = useMemo(() => new Map(segments.map((segment) => [segment.id, segment])), [segments])

  const tasks = useMemo<UnifiedTask[]>(() => {
    const exportRows: UnifiedTask[] = exports.map((job) => ({
      id: `export:${job.id}`,
      kind: 'export',
      title: `${job.mode === 'accurate' ? '精准' : '快速'}导出 · ${job.sourceName ?? sourceNames.get(job.sourceId) ?? job.sourceId}`,
      subtitle: `${formatClipDateTime(job.startTime)} – ${formatClipDateTime(job.endTime)}`,
      source: job.sourceName ?? sourceNames.get(job.sourceId) ?? job.sourceId,
      status: job.status,
      statusGroup: normalizeStatus(job.status),
      statusLabel: statusLabel(job.status),
      progress: exportProgressPercent(job),
      result: job.hasGaps ? `包含 ${formatDuration(job.gapDurationSeconds)} 断档` : '视频导出',
      createdAt: job.createdAt,
      downloadUrl: job.downloadUrl,
      outputSize: job.outputSizeBytes,
      error: job.errorMessage,
      exportJob: job,
    }))

    const transcriptionRows: UnifiedTask[] = (transcriptionJobsQuery.data?.items ?? []).map((job) => {
      const segment = segmentById.get(job.segmentId)
      return {
        id: `transcription:${job.id}`,
        kind: 'transcription',
        title: segment?.filename ?? `语音识别 · ${job.segmentId}`,
        subtitle: segment ? `${formatClipDateTime(segment.startTime)} · ${formatDuration(segment.durationSeconds)}` : job.id,
        source: segment ? sourceNames.get(segment.sourceId) ?? segment.sourceId : '未知录像源',
        status: job.status,
        statusGroup: normalizeStatus(job.status),
        statusLabel: statusLabel(job.status),
        progress: job.status === 'completed' ? 100 : Math.round((job.progress ?? 0) * 100),
        result: job.status === 'completed' ? '字幕已生成' : job.stage || '等待处理',
        createdAt: job.createdAt,
        segment,
        error: job.errorMessage,
        transcriptionJob: job,
      }
    })

    const visionRows: UnifiedTask[] = (visionJobsQuery.data?.items ?? []).map((job) => {
      const segment = segmentById.get(job.segmentId)
      return {
        id: `vision:${job.id}`,
        kind: 'vision',
        title: segment?.filename ?? `视觉识别 · ${job.segmentId}`,
        subtitle: segment ? `${formatClipDateTime(segment.startTime)} · ${formatDuration(segment.durationSeconds)}` : job.id,
        source: segment ? sourceNames.get(segment.sourceId) ?? segment.sourceId : '未知录像源',
        status: job.status,
        statusGroup: normalizeStatus(job.status),
        statusLabel: statusLabel(job.status),
        progress: job.status === 'completed' ? 100 : Math.round((job.progress ?? 0) * 100),
        result: job.status === 'completed' ? `${job.detectionsCount ?? 0} 个标注` : job.stage || '等待处理',
        createdAt: job.createdAt,
        segment,
        error: job.errorMessage,
        visionJob: job,
      }
    })

    return [...exportRows, ...transcriptionRows, ...visionRows]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [exports, segmentById, sourceNames, transcriptionJobsQuery.data?.items, visionJobsQuery.data?.items])

  const counts = useMemo(() => ({
    all: tasks.length,
    active: tasks.filter((task) => task.statusGroup === 'active').length,
    waiting: tasks.filter((task) => task.statusGroup === 'waiting').length,
    completed: tasks.filter((task) => task.statusGroup === 'completed').length,
    failed: tasks.filter((task) => task.statusGroup === 'failed').length,
  }), [tasks])

  const filtered = tasks.filter((task) => statusFilter === 'all' || task.statusGroup === statusFilter)
  const recognitionCompleted = tasks.filter((task) => task.kind !== 'export' && task.statusGroup === 'completed').length

  async function retryTask(task: UnifiedTask) {
    if (!task.segment || task.kind === 'export') {
      onNotify('该任务类型暂不支持重试')
      return
    }
    setRetryingId(task.id)
    try {
      if (task.kind === 'transcription') await api.triggerTranscription(task.segment.id)
      if (task.kind === 'vision') await api.triggerVision(task.segment.id, true)
      onNotify('重试任务已创建')
      await queryClient.invalidateQueries({ queryKey: ['taskCenter'] })
    } catch (error) {
      onNotify(queryMessage(error, '创建重试任务失败'))
    } finally {
      setRetryingId('')
    }
  }

  return (
    <div className="redesignTaskPage">
      <header className="redesignTaskHeader">
        <div><small>处理</small><h1>任务</h1><p>集中查看导出、语音识别与视觉识别任务</p></div>
        <div>
          <button type="button" className="taskPageSecondary" disabled title="当前后端未提供任务删除接口"><Trash size={17} />清理已完成</button>
        </div>
      </header>

      <div className="redesignTaskTabs">
        {([
          ['all', '全部'], ['active', '进行中'], ['waiting', '待处理'], ['completed', '已完成'], ['failed', '失败'],
        ] as Array<[TaskStatus, string]>).map(([key, label]) => <button type="button" key={key} aria-pressed={statusFilter === key} className={statusFilter === key ? 'active' : ''} onClick={() => setStatusFilter(key)}>{label}<span>{counts[key]}</span></button>)}
      </div>

      {(exportError || transcriptionJobsQuery.error || visionJobsQuery.error) && <div className="taskPageAlert" role="alert"><WarningCircle size={17} weight="fill" /><span>部分任务读取失败：{queryMessage(exportError || transcriptionJobsQuery.error || visionJobsQuery.error, '请检查后端连接')}</span></div>}

      <section className="redesignTaskTable" role="table" aria-label="任务列表">
        <div className="redesignTaskTableHead" role="row"><span role="columnheader">任务</span><span role="columnheader">类型</span><span role="columnheader">来源</span><span role="columnheader">状态</span><span role="columnheader">结果 / 进度</span><span role="columnheader">操作</span></div>
        {filtered.map((task) => {
          const Icon = task.kind === 'export' ? DownloadSimple : task.kind === 'vision' ? Eye : FileText
          return (
            <div className="redesignTaskRow" role="row" key={task.id} tabIndex={task.segment ? 0 : undefined} aria-label={`${task.title}，${task.statusLabel}`} onDoubleClick={() => task.segment && onSelectSegment(task.segment)} onKeyDown={(event) => { if (event.key === 'Enter' && task.segment) onSelectSegment(task.segment) }}>
              <div className="redesignTaskName" role="cell"><span className={`redesignTaskIcon ${task.statusGroup}`}><Icon size={18} weight={task.statusGroup === 'completed' ? 'fill' : 'regular'} /></span><span><strong title={task.title}>{task.title}</strong><small>{formatClipDateTime(task.createdAt)} · {task.subtitle}</small></span></div>
              <span className="redesignTaskKind" role="cell">{task.kind === 'export' ? '视频导出' : task.kind === 'vision' ? '视觉识别' : '语音识别'}</span>
              <span className="redesignTaskSource" role="cell">{task.source}</span>
              <span className={`redesignTaskStatus ${task.statusGroup}`} role="cell">{task.statusLabel}</span>
              <div className="redesignTaskProgress" role="cell">
                {task.statusGroup === 'failed' ? <strong className="failed" title={task.error ?? (task.status === 'expired' ? '导出文件已过期' : '任务失败')}>{task.error ?? (task.status === 'expired' ? '导出文件已过期' : '任务失败')}</strong> : task.downloadUrl ? <a href={task.downloadUrl}><DownloadSimple size={14} />下载{task.outputSize ? ` · ${formatBytes(task.outputSize)}` : ''}</a> : task.kind === 'export' && task.statusGroup === 'completed' ? <strong className="failed">下载不可用，服务端暂存文件可能已清理</strong> : <><div role="progressbar" aria-label={`${task.title}进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress}><span style={{ width: `${task.progress}%` }} /></div><em>{task.result}{task.statusGroup !== 'completed' ? ` · ${task.progress}%` : ''}</em></>}
              </div>
              <div className="redesignTaskActions" role="cell">
                {task.statusGroup === 'failed' && task.kind !== 'export' ? <button type="button" title="重试任务" aria-label="重试任务" disabled={retryingId === task.id} onClick={() => void retryTask(task)}><ArrowClockwise size={16} /></button> : <button type="button" title="更多操作" aria-label="更多操作"><DotsThree size={18} weight="bold" /></button>}
              </div>
            </div>
          )
        })}
        {!filtered.length && <div className="redesignTaskEmpty"><SpinnerGap size={31} /><strong>没有匹配的任务</strong><span>切换筛选条件或在回看、片段库中创建新任务。</span></div>}
      </section>

      <div className="redesignTaskSummary">
        <section><span className="blue"><SpinnerGap size={22} /></span><div><small>处理中</small><strong>{counts.active} 个任务</strong><p>{counts.waiting} 个任务正在等待调度</p></div></section>
        <section><span className="green"><CheckCircle size={22} /></span><div><small>识别完成</small><strong>{recognitionCompleted} 个任务</strong><p>语音与视觉结果可在片段详情查看</p></div></section>
        <section><span className="purple"><WarningCircle size={22} /></span><div><small>需要处理</small><strong>{counts.failed} 个失败</strong><p>可重试识别任务，导出失败请重新创建</p></div></section>
      </div>
    </div>
  )
}
