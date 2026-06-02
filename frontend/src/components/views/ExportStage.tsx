import { Activity, AlertTriangle, Check, Download, RefreshCw } from 'lucide-react'
import type { ExportJob } from '../../types'
import { exportProgressPercent, exportStatusLabel, formatBytes, formatClipDateTime, formatDuration, queryMessage } from '../../utils'

export function ExportStage({
  exports,
  error,
  onRefresh,
  busy,
}: {
  exports: ExportJob[]
  error: unknown
  onRefresh: () => void
  busy: boolean
}) {
  const activeJobs = exports.filter((job) => job.status === 'queued' || job.status === 'running')
  const completedJobs = exports.filter((job) => job.status === 'completed')
  const failedJobs = exports.filter((job) => job.status === 'failed')
  const latestActive = activeJobs[0] ?? exports[0]

  return (
    <section className="modulePanel exportStage">
      <div className="moduleHead">
        <div>
          <div className="moduleTitle">导出任务</div>
          <div className="moduleMeta">查看正在导出的进度、历史记录和下载入口。</div>
        </div>
        <button className="refreshButton" onClick={onRefresh} title="刷新导出任务">
          <RefreshCw size={18} className={busy ? 'spin' : ''} />
        </button>
      </div>

      <div className="settingsGrid exportSummaryGrid">
        <div className="settingsCard">
          <Activity size={20} />
          <strong>{activeJobs.length}</strong>
          <span>进行中</span>
        </div>
        <div className="settingsCard">
          <Check size={20} />
          <strong>{completedJobs.length}</strong>
          <span>已完成</span>
        </div>
        <div className="settingsCard warning">
          <AlertTriangle size={20} />
          <strong>{failedJobs.length}</strong>
          <span>失败</span>
        </div>
        <div className="settingsCard">
          <Download size={20} />
          <strong>{exports.length}</strong>
          <span>总记录</span>
        </div>
      </div>

      {Boolean(error) ? (
        <div className="moduleAlert warning">
          <AlertTriangle size={16} />
          <span>导出记录读取失败：{queryMessage(error, '请检查后端连接')}</span>
        </div>
      ) : null}

      {latestActive && (
        <div className={`exportCurrent ${latestActive.status}`}>
          <div>
            <span>{exportStatusLabel(latestActive.status)}</span>
            <strong>{latestActive.sourceName ?? latestActive.sourceId}</strong>
            <small>
              {formatClipDateTime(latestActive.startTime)} - {formatClipDateTime(latestActive.endTime)}
            </small>
          </div>
          <div className="exportCurrentProgress">
            <span>{exportProgressPercent(latestActive)}%</span>
            <div className="progressTrack">
              <i style={{ width: `${exportProgressPercent(latestActive)}%` }} />
            </div>
          </div>
        </div>
      )}

      <div className="exportTable">
        <div className="exportTableHead">
          <span>任务</span>
          <span>时间范围</span>
          <span>进度</span>
          <span>结果</span>
        </div>
        {exports.length ? exports.map((job) => {
          const progress = exportProgressPercent(job)
          return (
            <div className={`exportRow ${job.status}`} key={job.id}>
              <div className="exportTaskCell">
                <strong>{job.sourceName ?? job.sourceId}</strong>
                <small>{job.mode === 'fast' ? '快速导出' : '精准导出'} · {job.id}</small>
              </div>
              <div className="exportRangeCell">
                <span>{formatClipDateTime(job.startTime)} - {formatClipDateTime(job.endTime)}</span>
                {job.hasGaps && <small>包含断档，跳过约 {formatDuration(job.gapDurationSeconds)}</small>}
              </div>
              <div className="exportProgressCell">
                <div className="exportStatusLine">
                  <span className={`exportStatusPill ${job.status}`}>{exportStatusLabel(job.status)}</span>
                  <strong>{progress}%</strong>
                </div>
                <div className="progressTrack">
                  <i style={{ width: `${progress}%` }} />
                </div>
              </div>
              <div className="exportResultCell">
                {job.status === 'completed' && job.downloadUrl ? (
                  <a className="exportDownload" href={job.downloadUrl}>
                    <Download size={15} />
                    下载
                  </a>
                ) : job.status === 'failed' ? (
                  <span className="exportError" title={job.errorMessage ?? '导出失败'}>
                    {job.errorMessage ?? '导出失败'}
                  </span>
                ) : (
                  <span className="exportMuted">等待完成</span>
                )}
                <small>{formatBytes(job.outputSizeBytes)}</small>
              </div>
            </div>
          )
        }) : (
          <div className="moduleEmpty">暂无导出记录</div>
        )}
      </div>
    </section>
  )
}
