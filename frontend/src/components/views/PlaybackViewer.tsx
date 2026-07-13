import {
  Activity,
  Camera,
  Download,
  Maximize,
  Mic,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { forwardRef, useImperativeHandle, useRef, useState, type CSSProperties } from 'react'
import type { Transcription } from '../../types'
import type { DisplaySegment } from '../../utils'
import { SubtitleOverlay } from './SubtitleOverlay'

function formatPlayerTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '00:00'
  const totalSeconds = Math.floor(value)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const minuteLabel = String(minutes).padStart(hours ? 2 : 1, '0')
  const secondLabel = String(seconds).padStart(2, '0')
  return hours
    ? `${hours}:${minuteLabel}:${secondLabel}`
    : `${minuteLabel}:${secondLabel}`
}

function formatSegmentDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export const PlaybackViewer = forwardRef<HTMLVideoElement, {
  segment: DisplaySegment
  sourceName: string
  playbackRate: number
  transcriptions: Transcription[]
  subtitleMode: 'list' | 'overlay'
  refreshing?: boolean
  exporting?: boolean
  scanning?: boolean
  onTimeChange: (seconds: number) => void
  onEnded: () => void
  onPlayStateChange: (playing: boolean) => void
  onPlaybackRateChange: (rate: number) => void
  onPlaybackError: () => void
  onRefresh: () => void
  onExport: () => void
  onScan: () => void
  onTranscribe: () => void
}>(function PlaybackViewer({
  segment,
  sourceName,
  playbackRate,
  transcriptions,
  subtitleMode,
  refreshing,
  exporting,
  scanning,
  onTimeChange,
  onEnded,
  onPlayStateChange,
  onPlaybackRateChange,
  onPlaybackError,
  onRefresh,
  onExport,
  onScan,
  onTranscribe,
}, forwardedRef) {
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(segment.durationSeconds || 0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)

  useImperativeHandle(forwardedRef, () => videoRef.current as HTMLVideoElement)

  function syncTime() {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.currentTime)) return
    setCurrentTime(video.currentTime)
    onTimeChange(video.currentTime)
  }

  function togglePlayback() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().catch(onPlaybackError)
      return
    }
    video.pause()
  }

  function seekTo(nextTime: number) {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, Math.min(duration || video.duration || 0, nextTime))
    syncTime()
  }

  function updateVolume(nextVolume: number) {
    const video = videoRef.current
    if (!video) return
    video.volume = nextVolume
    video.muted = nextVolume === 0
    setVolume(nextVolume)
    setMuted(nextVolume === 0)
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    void viewerRef.current?.requestFullscreen()
  }

  return (
    <div className="viewer" ref={viewerRef}>
      <video
        ref={videoRef}
        className="viewerVideo"
        src={`/api/segments/${segment.id}/stream`}
        onClick={togglePlayback}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={() => {
          const video = videoRef.current
          if (!video) return
          setDuration(Number.isFinite(video.duration) ? video.duration : segment.durationSeconds || 0)
          video.playbackRate = playbackRate
          syncTime()
        }}
        onDurationChange={() => {
          const nextDuration = videoRef.current?.duration
          if (nextDuration && Number.isFinite(nextDuration)) setDuration(nextDuration)
        }}
        onTimeUpdate={syncTime}
        onSeeking={syncTime}
        onEnded={onEnded}
        onPlay={() => {
          setIsPlaying(true)
          onPlayStateChange(true)
        }}
        onPause={() => {
          setIsPlaying(false)
          onPlayStateChange(false)
        }}
      />

      {subtitleMode === 'overlay' && transcriptions.length > 0 && (
        <SubtitleOverlay transcriptions={transcriptions} currentTime={currentTime} />
      )}

      <div className="videoTopBar">
        <div className="videoIdentity">
          <span className="videoIdentityIcon"><Camera size={15} /></span>
          <span>
            <strong>{sourceName}</strong>
            <small>{formatSegmentDate(segment.startTime)}</small>
          </span>
        </div>
        <div className="videoActions" aria-label="录像操作">
          <button type="button" title="刷新数据" aria-label="刷新数据" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
          </button>
          <button type="button" title="扫描录像源" aria-label="扫描录像源" onClick={onScan} disabled={scanning}>
            <Activity size={17} />
          </button>
          <button type="button" title="语音识别" aria-label="语音识别" onClick={onTranscribe}>
            <Mic size={17} />
          </button>
          <button
            className="videoExportAction"
            type="button"
            title="导出录像"
            aria-label="导出录像"
            onClick={onExport}
            disabled={exporting}
          >
            <Download size={16} />
            <span>导出</span>
          </button>
        </div>
      </div>

      {!isPlaying && (
        <button className="videoCenterPlay" type="button" onClick={togglePlayback} aria-label="播放">
          <Play size={28} fill="currentColor" />
        </button>
      )}

      <div className="videoControls">
        <input
          className="videoSeek"
          type="range"
          min={0}
          max={Math.max(duration, 0.1)}
          step={0.1}
          value={Math.min(currentTime, duration || currentTime)}
          onChange={(event) => seekTo(Number(event.target.value))}
          aria-label="播放进度"
          style={{ '--seek-progress': `${duration > 0 ? (currentTime / duration) * 100 : 0}%` } as CSSProperties}
        />
        <div className="videoControlRow">
          <div className="videoControlGroup">
            <button type="button" onClick={togglePlayback} aria-label={isPlaying ? '暂停' : '播放'} title={isPlaying ? '暂停' : '播放'}>
              {isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
            </button>
            <button type="button" onClick={() => seekTo(currentTime - 10)} aria-label="后退 10 秒" title="后退 10 秒">
              <RotateCcw size={18} />
              <span className="videoSkipLabel">10</span>
            </button>
            <button type="button" onClick={() => seekTo(currentTime + 10)} aria-label="前进 10 秒" title="前进 10 秒">
              <RotateCw size={18} />
              <span className="videoSkipLabel">10</span>
            </button>
            <time className="videoTime">
              {formatPlayerTime(currentTime)} <span>/</span> {formatPlayerTime(duration)}
            </time>
          </div>
          <div className="videoControlGroup videoControlGroupEnd">
            <button
              className="videoRateButton"
              type="button"
              onClick={() => {
                const rates = [1, 1.5, 2, 4]
                const index = rates.indexOf(playbackRate)
                onPlaybackRateChange(rates[(index + 1) % rates.length])
              }}
              aria-label={`当前倍速 ${playbackRate} 倍`}
              title="切换倍速"
            >
              {playbackRate}x
            </button>
            <button type="button" onClick={toggleMute} aria-label={muted ? '取消静音' : '静音'} title={muted ? '取消静音' : '静音'}>
              {muted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </button>
            <input
              className="videoVolume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(event) => updateVolume(Number(event.target.value))}
              aria-label="音量"
            />
            <button type="button" onClick={toggleFullscreen} aria-label="全屏" title="全屏">
              <Maximize size={19} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
