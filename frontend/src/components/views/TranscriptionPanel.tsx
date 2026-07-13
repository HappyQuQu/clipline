import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AudioLines, Captions, CircleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import type { Transcription } from '../../types'
import { queryMessage } from '../../utils'

export function TranscriptionPanel({
  segmentId,
  transcriptions,
  currentTime,
  mode,
  onModeChange,
  onSelect,
  onExportSrt,
  onExportTxt,
  onNotify,
}: {
  segmentId: string
  transcriptions: Transcription[]
  currentTime: number
  mode: 'list' | 'overlay'
  onModeChange: (mode: 'list' | 'overlay') => void
  onSelect: (time: number) => void
  onExportSrt: () => void
  onExportTxt: () => void
  onNotify: (text: string) => void
}) {
  const [jobStatus, setJobStatus] = useState<{ status: string; stage: string; progress: number; jobId?: string; errorMessage?: string } | null>(null)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const startTimeRef = useRef<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const queryClient = useQueryClient()
  const listRef = useRef<HTMLDivElement>(null)

  const statusQuery = useQuery({
    queryKey: ['transcriptionStatus', segmentId],
    queryFn: () => api.getTranscriptionStatus(segmentId),
    enabled: Boolean(segmentId),
    refetchInterval: (query) => {
      const data = query.state.data
      if (data && (data.status === 'processing' || data.status === 'pending')) {
        return 1000
      }
      return false
    },
  })

  useEffect(() => {
    if (statusQuery.data) {
      setJobStatus(statusQuery.data)
    }
  }, [statusQuery.data])

  useEffect(() => {
    if (jobStatus?.status === 'processing' || jobStatus?.status === 'pending') {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now()
      }
      const timer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current!) / 1000))
      }, 1000)
      return () => clearInterval(timer)
    } else {
      startTimeRef.current = null
      setElapsed(0)
    }
  }, [jobStatus?.status])

  useEffect(() => {
    if (!listRef.current || mode !== 'list') return
    const activeItem = listRef.current.querySelector('.transcriptionPanelItem.active')
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [currentTime, mode])

  function handleTranscribe() {
    setIsTranscribing(true)
    startTimeRef.current = Date.now()
    api.triggerTranscription(segmentId).then(() => {
      onNotify('语音识别任务已创建')
      void queryClient.invalidateQueries({ queryKey: ['transcriptionStatus', segmentId] })
      void queryClient.invalidateQueries({ queryKey: ['transcription', segmentId] })
    }).catch((err) => {
      onNotify(queryMessage(err, '创建识别任务失败'))
    }).finally(() => {
      setIsTranscribing(false)
    })
  }

  function getStageText(stage: string, progress: number) {
    if (progress < 0.1) return '正在提取音频...'
    if (stage === 'extracting_audio') return '正在提取音频...'
    if (stage === 'transcribing' || progress < 0.85) return '正在识别语音...'
    if (stage === 'saving') return '正在生成字幕...'
    return '正在识别语音...'
  }

  function formatElapsed(seconds: number) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  function getEstimatedRemaining() {
    if (!jobStatus || jobStatus.progress <= 0.05) return null
    const progress = jobStatus.progress
    const estimatedTotal = elapsed / progress
    const remaining = Math.max(0, Math.ceil(estimatedTotal - elapsed))
    return remaining
  }

  function formatTranscriptionTime(seconds: number) {
    const minutes = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const isProcessing = jobStatus && (jobStatus.status === 'processing' || jobStatus.status === 'pending')
  const isCompleted = jobStatus && jobStatus.status === 'completed'
  const isFailed = jobStatus && jobStatus.status === 'failed'
  const hasTranscriptions = transcriptions.length > 0

  if (!hasTranscriptions && !isProcessing && !isFailed) {
    return null
  }

  return (
    <div className={`transcriptionPanel${hasTranscriptions && mode === 'overlay' && !isProcessing && !isFailed ? ' transcriptionPanelCompact' : ''}`}>
      {isProcessing && (
        <div className="transcriptionProcessing">
          <div className="transcriptionProcessingHeader">
            <span className="transcriptionProcessingTitle"><AudioLines size={17} />语音识别</span>
            <button
              className="transcriptionCancelButton"
              onClick={() => onNotify('暂不支持取消，请等待完成')}
            >
              取消
            </button>
          </div>
          <div className="transcriptionProcessingStage">
            <AudioLines size={16} />
            {getStageText(jobStatus.stage, jobStatus.progress)}
          </div>
          <div className="transcriptionProgressBar">
            <div
              className="transcriptionProgressFill"
              style={{ width: `${Math.max(5, (jobStatus.progress || 0) * 100)}%` }}
            />
          </div>
          <div className="transcriptionProcessingMeta">
            <span className="transcriptionProgressPercent">
              {Math.round((jobStatus.progress || 0) * 100)}%
            </span>
            <span className="transcriptionProcessingTime">
              已用 {formatElapsed(elapsed)}
              {getEstimatedRemaining() !== null && ` · 预估剩余 ${formatElapsed(getEstimatedRemaining()!)}`}
            </span>
          </div>
        </div>
      )}

      {isFailed && (
        <div className="transcriptionFailed">
          <div className="transcriptionFailedIcon"><CircleAlert size={30} /></div>
          <div className="transcriptionFailedText">{jobStatus.errorMessage || '识别失败，请重试'}</div>
          <button className="transcriptionRetryButton" onClick={handleTranscribe}>
            重新识别
          </button>
        </div>
      )}

      {hasTranscriptions && (
        <>
          <div className="transcriptionPanelHeader">
            <div className="transcriptionPanelTitle">
              <span><Captions size={17} />字幕 · {transcriptions.length} 条</span>
            </div>
            <div className="transcriptionPanelActions">
              <button
                className={mode === 'overlay' ? 'active' : ''}
                onClick={() => onModeChange('overlay')}
                title="实时字幕模式"
              >
                字幕
              </button>
              <button
                className={mode === 'list' ? 'active' : ''}
                onClick={() => onModeChange('list')}
                title="字幕列表模式"
              >
                列表
              </button>
              <button onClick={onExportSrt} title="导出 SRT 字幕文件">
                导出 SRT
              </button>
              <button onClick={onExportTxt} title="导出 TXT 文本文件">
                导出 TXT
              </button>
              <button
                className="transcriptionPanelButton"
                onClick={handleTranscribe}
                disabled={isTranscribing}
              >
                重新识别
              </button>
            </div>
          </div>
          {mode === 'list' && (
            <div className="transcriptionPanelList" ref={listRef}>
              {transcriptions.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={`transcriptionPanelItem ${currentTime >= t.startTime && currentTime <= t.endTime ? 'active' : ''}`}
                  onClick={() => onSelect(t.startTime)}
                >
                  <span className="transcriptionPanelItemTime">{formatTranscriptionTime(t.startTime)}</span>
                  <span className="transcriptionPanelItemText">{t.text}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
