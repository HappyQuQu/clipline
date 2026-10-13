import { ArrowRight, ClosedCaptioning, DownloadSimple, FilmStrip, Play } from '@phosphor-icons/react'
import type { DisplaySegment } from '../../utils'
import { formatDuration, formatTime } from '../../utils'

export function PlaybackClipStrip({
  segments,
  selectedId,
  sourceNames,
  transcriptionStatuses,
  onSelect,
  onTranscribe,
  onExportRange,
  onOpenLibrary,
}: {
  segments: DisplaySegment[]
  selectedId?: string
  sourceNames: Map<string, string>
  transcriptionStatuses: Map<string, 'pending' | 'processing' | 'completed' | 'failed'>
  onSelect: (segment: DisplaySegment) => void
  onTranscribe: (segmentId: string) => void
  onExportRange: (segment: DisplaySegment) => void
  onOpenLibrary: () => void
}) {
  const visible = [...segments]
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 8)

  return (
    <section className="playbackClipSection">
      <header className="playbackClipHeader">
        <div>
          <h2>录像片段</h2>
          <span>{segments.length ? `当前范围内 ${segments.length} 个片段` : '当前范围内暂无片段'}</span>
        </div>
        <button type="button" onClick={onOpenLibrary}>查看全部 <ArrowRight size={16} /></button>
      </header>

      {visible.length ? (
        <div className="playbackClipStrip">
          {visible.map((segment) => (
            <article key={segment.id} className={`playbackClipCard${segment.id === selectedId ? ' active' : ''}`}>
              <button type="button" className="playbackClipPreview" onClick={() => onSelect(segment)}>
                {segment.thumbnailUrl ? <img src={segment.thumbnailUrl} alt="" /> : <FilmStrip size={28} />}
                <span><Play size={14} weight="fill" /></span>
                <time>{formatDuration(segment.durationSeconds)}</time>
              </button>
              <div className="playbackClipInfo">
                <button type="button" onClick={() => onSelect(segment)}>
                  <strong>{formatTime(segment.startTime)} – {formatTime(segment.endTime)}</strong>
                  <small>{sourceNames.get(segment.sourceId) ?? '录像源'} · {(() => {
                    const status = transcriptionStatuses.get(segment.id)
                    if (status === 'completed') return '已识别'
                    if (status === 'processing') return '识别中'
                    if (status === 'pending') return '等待识别'
                    if (status === 'failed') return '识别失败'
                    return '未识别'
                  })()}</small>
                </button>
                <div className="playbackClipActions">
                  <button type="button" title="创建语音识别任务" onClick={() => onTranscribe(segment.id)}><ClosedCaptioning size={16} /></button>
                  <button type="button" title="导出此片段" onClick={() => onExportRange(segment)}><DownloadSimple size={16} /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="playbackClipEmpty">
          <FilmStrip size={30} />
          <div><strong>这段时间没有录像</strong><span>选择其他日期，或立即扫描录像目录。</span></div>
        </div>
      )}
    </section>
  )
}
