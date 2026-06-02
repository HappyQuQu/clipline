import { AlertTriangle, CheckCircle, Clock, Download, HardDrive, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DisplaySegment } from '../../utils'
import { toIsoWithOffset, toLocalDateTimePrecise } from '../../utils'

type Operation = 'download' | 'timelapse'

export function ManagePanel({
  segments,
  sources,
  selectedSourceId,
  currentTimeMs,
  externalRangeStart,
  externalRangeEnd,
  onClose,
  onExport,
}: {
  segments: DisplaySegment[]
  sources: { id: string; name: string }[]
  selectedSourceId: string
  currentTimeMs: number | null
  externalRangeStart?: number | null
  externalRangeEnd?: number | null
  onClose: () => void
  onExport: (startTime: string, endTime: string, mode: string, speed?: number) => void
}) {
  const [operation, setOperation] = useState<Operation>('download')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [timelapseSpeed, setTimelapseSpeed] = useState(60)
  const [status, setStatus] = useState<'idle' | 'executing' | 'completed'>('idle')
  const [resultMessage, setResultMessage] = useState('')

  useEffect(() => {
    if (externalRangeStart != null && externalRangeEnd != null) {
      setStartTime(toLocalDateTimePrecise(new Date(externalRangeStart)))
      setEndTime(toLocalDateTimePrecise(new Date(externalRangeEnd)))
    } else {
      const now = currentTimeMs ?? Date.now()
      setStartTime(toLocalDateTimePrecise(new Date(now)))
      setEndTime(toLocalDateTimePrecise(new Date(now + 60_000)))
    }
    setOperation('download')
    setStatus('idle')
    setResultMessage('')
  }, [externalRangeStart, externalRangeEnd])

  const startMs = startTime ? new Date(startTime).getTime() : null
  const endMs = endTime ? new Date(endTime).getTime() : null
  const rangeValid = startMs !== null && endMs !== null && endMs > startMs

  const affectedSegments = useMemo(() => {
    if (!rangeValid) return []
    return segments.filter((seg) => {
      const segStart = new Date(seg.startTime).getTime()
      const segEnd = new Date(seg.endTime).getTime()
      return segEnd > startMs! && segStart < endMs!
    })
  }, [segments, startMs, endMs, rangeValid])

  const totalDuration = useMemo(
    () => affectedSegments.reduce((sum, seg) => sum + seg.durationSeconds, 0),
    [affectedSegments],
  )
  const estimatedSize = useMemo(() => {
    if (!affectedSegments.length) return null
    return Math.round(totalDuration * 2_000_000 / 8)
  }, [affectedSegments, totalDuration])

  function fmtDuration(sec: number) {
    if (sec < 60) return `${Math.round(sec)}秒`
    const m = Math.floor(sec / 60), s = Math.round(sec % 60)
    return s > 0 ? `${m}分${s}秒` : `${m}分`
  }
  function fmtSize(bytes: number | null) {
    if (bytes === null) return '未知'
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  function datePart(value: string) {
    return value.slice(0, 10)
  }

  function timePart(value: string) {
    return value.slice(11, 19) || '00:00:00'
  }

  function updateDateTime(kind: 'start' | 'end', part: 'date' | 'time', value: string) {
    const current = kind === 'start' ? startTime : endTime
    const nextDate = part === 'date' ? value : datePart(current)
    const nextTime = part === 'time' ? value : timePart(current)
    const nextValue = `${nextDate}T${nextTime}`
    if (kind === 'start') setStartTime(nextValue)
    else setEndTime(nextValue)
    setStatus('idle')
  }

  function handleAction() {
    if (!rangeValid) return
    setStatus('executing')
    const mode = operation === 'timelapse' ? 'timelapse' : 'fast'
    onExport(toIsoWithOffset(startTime), toIsoWithOffset(endTime), mode, timelapseSpeed)
    setStatus('completed')
    setResultMessage(operation === 'download' ? '导出任务已创建' : `延时视频(${timelapseSpeed}x)导出任务已创建`)
  }

  return (
    <div className="managePanelColumn">
      <div className="managePanelHeader">
        <span>管理片段</span>
        <button className="managePanelClose" onClick={onClose} title="关闭"><X size={18} /></button>
      </div>

      <div className="managePanelBody">
        {/* 时间范围 */}
        <div className="manageTimeRange">
          <div className="manageTimeBlock">
            <label className="manageTimeLabel">开始</label>
            <div className="manageDateTimeInputs">
              <input type="date" className="manageDateInput" value={datePart(startTime)}
                onChange={(e) => updateDateTime('start', 'date', e.target.value)} />
              <input type="time" step="1" className="manageTimeInput" value={timePart(startTime)}
                onChange={(e) => updateDateTime('start', 'time', e.target.value)} />
            </div>
          </div>
          <div className="manageTimeArrow">›</div>
          <div className="manageTimeBlock">
            <label className="manageTimeLabel">结束</label>
            <div className="manageDateTimeInputs">
              <input type="date" className="manageDateInput" value={datePart(endTime)}
                onChange={(e) => updateDateTime('end', 'date', e.target.value)} />
              <input type="time" step="1" className="manageTimeInput" value={timePart(endTime)}
                onChange={(e) => updateDateTime('end', 'time', e.target.value)} />
            </div>
          </div>
        </div>

        {/* 可用性 */}
        {affectedSegments.length > 0 ? (
          <div className="manageAvailOk"><CheckCircle size={15} /><span>该范围内有 {affectedSegments.length} 个片段</span></div>
        ) : rangeValid ? (
          <div className="manageAvailEmpty"><AlertTriangle size={15} /><span>所选范围内无可用视频</span></div>
        ) : (
          <div className="manageAvailEmpty"><Clock size={15} /><span>请选择时间范围</span></div>
        )}

        {/* 下载模式 */}
        <div className="manageSection">
          <div className="manageSectionTitle">下载模式</div>
          <div className="manageOperations">
            <label className={`manageOpItem ${operation === 'download' ? 'manageOpActive' : ''}`}>
              <input type="radio" name="manageOp" checked={operation === 'download'} onChange={() => setOperation('download')} />
              <span className="manageOpRadio" />
              <Download size={16} /><span>下载</span>
            </label>
            <label className={`manageOpItem ${operation === 'timelapse' ? 'manageOpActive' : ''}`}>
              <input type="radio" name="manageOp" checked={operation === 'timelapse'} onChange={() => setOperation('timelapse')} />
              <span className="manageOpRadio" />
              <Download size={16} /><span>延时视频下载</span>
            </label>
          </div>
          {operation === 'timelapse' && (
            <div className="manageTimelapseSpeed">
              <span className="manageSpeedLabel">倍速</span>
              <select className="manageSpeedSelect" value={timelapseSpeed} onChange={(e) => setTimelapseSpeed(Number(e.target.value))}>
                <option value={10}>10x</option>
                <option value={30}>30x</option>
                <option value={60}>60x</option>
                <option value={120}>120x</option>
                <option value={300}>300x</option>
                <option value={600}>600x</option>
              </select>
              <span className="manageSpeedHint">
                {rangeValid ? `→ 约 ${Math.round(totalDuration / timelapseSpeed)}秒` : ''}
              </span>
            </div>
          )}
        </div>

        {/* 摄像头 */}
        <div className="manageSection">
          <div className="manageSectionTitle">摄像头</div>
          <div className="manageSourceTags">
            {selectedSourceId && (
              <span className="manageSourceTag">{sources.find((s) => s.id === selectedSourceId)?.name ?? '未知'}</span>
            )}
          </div>
        </div>

        {/* 信息 */}
        <div className="manageInfo">
          <div className="manageInfoRow"><Clock size={14} /><span>时长：{rangeValid ? fmtDuration(totalDuration) : '--'}</span></div>
          <div className="manageInfoRow"><HardDrive size={14} /><span>大小：{rangeValid ? fmtSize(estimatedSize) : '--'}</span></div>
        </div>
      </div>

      <div className="managePanelFooter">
        {status === 'completed' ? (
          <div className="manageSuccess"><CheckCircle size={16} /><span>{resultMessage}</span></div>
        ) : (
          <>
            <button className="manageActionButton" onClick={handleAction}
              disabled={!rangeValid || affectedSegments.length === 0 || status === 'executing'}>
              {status === 'executing' && <Loader2 size={15} className="spin" />}
              {operation === 'download' ? '下载' : '延时视频下载'}
            </button>
            <button className="manageCancel" onClick={onClose}>取消</button>
          </>
        )}
      </div>
    </div>
  )
}
