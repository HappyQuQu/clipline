import {
  CalendarBlank,
  CaretRight,
  Check,
  CheckCircle,
  Clock,
  DownloadSimple,
  Eye,
  FileText,
  FilmStrip,
  HashStraight,
  ListBullets,
  MagnifyingGlass,
  Microphone,
  Play,
  SquaresFour,
  Tag,
  X,
} from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import type { SearchResult, VisionDetection } from '../../types'
import type { DisplaySegment } from '../../utils'
import { formatTime } from '../../utils'

function formatOffset(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function formatHourMinute(value: string) {
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatFullDate(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export function ClipLibraryView({
  segments,
  sourceNames,
  selectedId,
  onOpenPlayback,
  onExportSegments,
  onNotify,
}: {
  segments: DisplaySegment[]
  sourceNames: Map<string, string>
  selectedId?: string
  onOpenPlayback: (segment: DisplaySegment) => void
  onExportSegments: (segments: DisplaySegment[]) => void
  onNotify: (text: string) => void
}) {
  const queryClient = useQueryClient()
  const sortedSegments = useMemo(
    () => [...segments].sort((left, right) => new Date(right.startTime).getTime() - new Date(left.startTime).getTime()),
    [segments],
  )
  const [selectedClipId, setSelectedClipId] = useState(selectedId ?? '')
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sourceFilter, setSourceFilter] = useState(sortedSegments[0]?.sourceId ?? '')
  const [recognitionFilter, setRecognitionFilter] = useState('all')
  const [startDate, setStartDate] = useState(() => {
    return (sortedSegments[0]?.startTime ?? new Date().toISOString()).slice(0, 10)
  })
  const [endDate, setEndDate] = useState(() => (sortedSegments[0]?.startTime ?? new Date().toISOString()).slice(0, 10))
  const hasAppliedSegmentRange = useRef(sortedSegments.length > 0)
  const [speechQuery, setSpeechQuery] = useState('')
  const sourceId = sortedSegments[0]?.sourceId

  useEffect(() => {
    if (hasAppliedSegmentRange.current || !sortedSegments[0]?.startTime) return
    const latest = new Date(sortedSegments[0].startTime)
    const latestDate = latest.toISOString().slice(0, 10)
    setStartDate(latestDate)
    setEndDate(latestDate)
    setSourceFilter(sortedSegments[0].sourceId)
    hasAppliedSegmentRange.current = true
  }, [sortedSegments])

  const speech = speechQuery.trim()
  const transcriptionJobsQuery = useQuery({
    queryKey: ['clipLibraryTranscriptionJobs'],
    queryFn: () => api.getTranscriptionJobs(),
    refetchInterval: 3000,
  })
  const transcriptionStatusBySegment = useMemo(() => {
    const result = new Map<string, string>()
    for (const job of transcriptionJobsQuery.data?.items ?? []) {
      if (!result.has(job.segmentId)) result.set(job.segmentId, job.status)
    }
    return result
  }, [transcriptionJobsQuery.data?.items])
  const speechSearchQuery = useQuery({
    queryKey: ['clipLibrarySpeechSearch', speech, startDate, endDate],
    queryFn: () => api.search({
      q: speech,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      limit: 200,
    }),
    enabled: speech.length > 0,
  })

  const speechMatches = useMemo(() => {
    const matches = new Map<string, SearchResult>()
    for (const item of speechSearchQuery.data?.items ?? []) {
      if (!matches.has(item.segmentId)) matches.set(item.segmentId, item)
    }
    return matches
  }, [speechSearchQuery.data?.items])

  const visionDetectionsQuery = useQuery({
    queryKey: ['clipLibraryVisionDetections', sourceId, startDate, endDate],
    queryFn: () => api.listVisionDetections({
      sourceId,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      limit: 5000,
    }),
    enabled: Boolean(sourceId),
  })

  const detectionsBySegment = useMemo(() => {
    const grouped = new Map<string, VisionDetection[]>()
    for (const item of visionDetectionsQuery.data?.items ?? []) {
      grouped.set(item.segmentId, [...(grouped.get(item.segmentId) ?? []), item])
    }
    return grouped
  }, [visionDetectionsQuery.data?.items])

  const filtered = useMemo(() => {
    const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY
    const endMs = endDate ? new Date(`${endDate}T23:59:59`).getTime() : Number.POSITIVE_INFINITY
    return sortedSegments.filter((segment) => {
      const clipMs = new Date(segment.startTime).getTime()
      if (clipMs < startMs || clipMs > endMs) return false
      if (sourceFilter && segment.sourceId !== sourceFilter) return false
      if (speech) {
        const query = speech.toLocaleLowerCase()
        const localText = [
          segment.filename,
          sourceNames.get(segment.sourceId),
          ...(detectionsBySegment.get(segment.id) ?? []).flatMap((item) => [item.label, item.labelName]),
        ].filter(Boolean).join(' ').toLocaleLowerCase()
        if (!speechMatches.has(segment.id) && !localText.includes(query)) return false
      }
      const recognitionStatus = transcriptionStatusBySegment.get(segment.id)
      if (recognitionFilter === 'completed' && recognitionStatus !== 'completed') return false
      if (recognitionFilter === 'processing' && recognitionStatus !== 'pending' && recognitionStatus !== 'processing') return false
      if (recognitionFilter === 'none' && recognitionStatus) return false
      return true
    })
  }, [detectionsBySegment, endDate, recognitionFilter, sortedSegments, sourceFilter, sourceNames, speech, speechMatches, startDate, transcriptionStatusBySegment])

  const selectedSegment = selectedClipId ? filtered.find((segment) => segment.id === selectedClipId) : undefined
  const selectedTranscriptionQuery = useQuery({
    queryKey: ['clipLibraryTranscription', selectedSegment?.id],
    queryFn: () => api.getTranscription(selectedSegment!.id),
    enabled: Boolean(selectedSegment),
  })
  const selectedTranscriptions = selectedTranscriptionQuery.data?.items ?? []
  const selectedDetectionsQuery = useQuery({
    queryKey: ['clipLibrarySegmentVision', selectedSegment?.id],
    queryFn: () => api.getVisionDetections(selectedSegment!.id),
    enabled: Boolean(selectedSegment),
    refetchInterval: selectedSegment ? 3000 : false,
  })
  const selectedVisionStatusQuery = useQuery({
    queryKey: ['clipLibrarySegmentVisionStatus', selectedSegment?.id],
    queryFn: () => api.getVisionStatus(selectedSegment!.id),
    enabled: Boolean(selectedSegment),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'pending' || status === 'processing' ? 2500 : false
    },
  })
  const selectedDetections = selectedDetectionsQuery.data?.items ?? []
  const selectedDetectionSummary = useMemo(() => {
    const grouped = new Map<string, { label: string; labelName: string; count: number; confidence: number }>()
    for (const item of selectedDetections) {
      const current = grouped.get(item.label)
      if (!current) {
        grouped.set(item.label, {
          label: item.label,
          labelName: item.labelName,
          count: 1,
          confidence: item.confidence,
        })
        continue
      }
      current.count += 1
      current.confidence = Math.max(current.confidence, item.confidence)
    }
    return Array.from(grouped.values()).sort((left, right) => right.confidence - left.confidence)
  }, [selectedDetections])
  const triggerVisionMutation = useMutation({
    mutationFn: ({ segmentId, force }: { segmentId: string; force: boolean }) => api.triggerVision(segmentId, force),
    onSuccess: async (_job, variables) => {
      onNotify(variables.force ? '视觉重新识别任务已创建，将覆盖旧结果' : '视觉识别任务已创建')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['clipLibrarySegmentVisionStatus'] }),
        queryClient.invalidateQueries({ queryKey: ['visionLabels'] }),
        queryClient.invalidateQueries({ queryKey: ['clipLibraryVisionDetections'] }),
      ])
    },
    onError: (error) => onNotify(error instanceof Error ? error.message : '创建视觉识别任务失败'),
  })
  const triggerTranscriptionMutation = useMutation({
    mutationFn: async ({ segmentId, reset }: { segmentId: string; reset: boolean }) => {
      if (reset) await api.deleteTranscription(segmentId)
      return api.triggerTranscription(segmentId)
    },
    onSuccess: async (_job, variables) => {
      onNotify(variables.reset ? '语音重新识别任务已创建，将覆盖旧字幕' : '语音识别任务已创建')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['clipLibraryTranscription'] }),
        queryClient.invalidateQueries({ queryKey: ['transcription'] }),
      ])
    },
    onError: (error) => onNotify(error instanceof Error ? error.message : '创建语音识别任务失败'),
  })

  const hasVisionResults = selectedDetectionSummary.length > 0
  const hasTranscriptionResults = selectedTranscriptions.length > 0

  function toggleClipSelection(segmentId: string) {
    setSelectedClipIds((current) => current.includes(segmentId) ? current.filter((id) => id !== segmentId) : [...current, segmentId])
  }

  function recognitionLabel(segmentId: string) {
    const status = transcriptionStatusBySegment.get(segmentId)
    if (status === 'completed') return '已识别'
    if (status === 'processing') return '识别中'
    if (status === 'pending') return '等待识别'
    if (status === 'failed') return '识别失败'
    return '未识别'
  }

  async function transcribeSelected() {
    const targets = sortedSegments.filter((segment) => selectedClipIds.includes(segment.id))
    if (!targets.length) return
    const results = await Promise.allSettled(targets.map((segment) => api.triggerTranscription(segment.id)))
    const failed = results.filter((result) => result.status === 'rejected').length
    onNotify(failed ? `已创建 ${targets.length - failed} 个识别任务，${failed} 个失败` : `已创建 ${targets.length} 个语音识别任务`)
    void queryClient.invalidateQueries({ queryKey: ['clipLibraryTranscriptionJobs'] })
  }

  async function detectSelected() {
    const targets = sortedSegments.filter((segment) => selectedClipIds.includes(segment.id))
    if (!targets.length) return
    const results = await Promise.allSettled(targets.map((segment) => api.triggerVision(segment.id, false)))
    const failed = results.filter((result) => result.status === 'rejected').length
    onNotify(failed ? `已创建 ${targets.length - failed} 个视觉识别任务，${failed} 个失败` : `已创建 ${targets.length} 个视觉识别任务`)
    void queryClient.invalidateQueries({ queryKey: ['clipLibraryVisionDetections'] })
  }

  const selectedSegments = sortedSegments.filter((segment) => selectedClipIds.includes(segment.id))

  return (
    <div className="redesignLibraryPage">
      <header className="redesignLibraryHeader">
        <div><small>内容</small><h1>片段库</h1><p>按日期、识别状态、视觉标签与字幕内容筛选已索引片段</p></div>
        <div>
          <button type="button" className="librarySecondary" disabled={!selectedSegments.length} onClick={() => void transcribeSelected()}><Microphone size={18} />批量识别</button>
          <button type="button" className="libraryPrimary" disabled={!selectedSegments.length} onClick={() => onExportSegments(selectedSegments)}><DownloadSimple size={18} />导出所选</button>
        </div>
      </header>

      <div className="redesignLibraryToolbar">
        <label className="libraryInlineSearch"><MagnifyingGlass size={17} /><input value={speechQuery} onChange={(event) => setSpeechQuery(event.target.value)} placeholder="搜索文件名、标签或字幕" />{speech && <button type="button" aria-label="清除搜索" onClick={() => setSpeechQuery('')}><X size={14} /></button>}</label>
        <select className="librarySourceFilter" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="">全部录像源</option>{Array.from(sourceNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <select className="libraryRecognitionFilter" value={recognitionFilter} onChange={(event) => setRecognitionFilter(event.target.value)}><option value="all">全部识别状态</option><option value="completed">已识别</option><option value="processing">识别中</option><option value="none">未识别</option></select>
        <label className="libraryDate"><CalendarBlank size={16} /><input aria-label="片段日期" type="date" value={endDate} onChange={(event) => { setStartDate(event.target.value); setEndDate(event.target.value) }} /></label>
        <div className="libraryViewSwitch"><button type="button" aria-label="网格视图" aria-pressed={viewMode === 'grid'} className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}><SquaresFour size={18} /></button><button type="button" aria-label="列表视图" aria-pressed={viewMode === 'list'} className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}><ListBullets size={18} /></button></div>
      </div>

      <div className="redesignLibraryContent">
        <main className={viewMode === 'grid' ? 'redesignLibraryGrid' : 'redesignLibraryList'}>
          {filtered.map((segment) => {
            const detections = detectionsBySegment.get(segment.id) ?? []
            const transcriptHit = speech ? speechMatches.get(segment.id)?.transcription : null
            const checked = selectedClipIds.includes(segment.id)
            return (
              <article key={segment.id} role="button" tabIndex={0} aria-pressed={selectedClipId === segment.id} className={`redesignLibraryCard${selectedClipId === segment.id ? ' active' : ''}`} onClick={() => setSelectedClipId(segment.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedClipId(segment.id) } }}>
                <div className="redesignLibraryImage">
                  {segment.thumbnailUrl ? <img src={segment.thumbnailUrl} alt="" loading="lazy" /> : <span className="libraryImageEmpty"><FilmStrip size={28} /></span>}
                  <button type="button" aria-label={checked ? '取消选择片段' : '选择片段'} className={`librarySelectCheck${checked ? ' checked' : ''}`} onClick={(event) => { event.stopPropagation(); toggleClipSelection(segment.id) }}>{checked && <Check size={13} weight="bold" />}</button>
                  <time>{formatHourMinute(segment.startTime)}</time>
                </div>
                <div className="redesignLibraryCardCopy">
                  <div><strong>{sourceNames.get(segment.sourceId) ?? '录像源'} · {formatHourMinute(segment.startTime)}</strong><p>{formatTime(segment.startTime)} – {formatTime(segment.endTime)} · {formatOffset(segment.durationSeconds)}</p>{transcriptHit && <p className="clipSpeechHit">{formatOffset(transcriptHit.startTime)} {transcriptHit.text}</p>}</div>
                  <span className={`libraryRecognitionStatus ${transcriptionStatusBySegment.get(segment.id) ?? 'none'}`}>{recognitionLabel(segment.id)}</span>
                </div>
                {detections.length > 0 && <div className="redesignLibraryTags">{detections.slice(0, 3).map((item) => <span key={item.id}>{item.labelName}</span>)}</div>}
              </article>
            )
          })}
          {!filtered.length && <div className="redesignLibraryEmpty"><FilmStrip size={34} /><strong>{speech ? '没有匹配的字幕结果' : '当前筛选范围内没有片段'}</strong><span>调整筛选条件或扫描录像目录后再试。</span></div>}
        </main>

        <aside className="redesignLibraryInspector">
          {selectedSegment ? <>
            <header><div><small>片段详情</small><h2>{sourceNames.get(selectedSegment.sourceId) ?? '录像源'} · {formatHourMinute(selectedSegment.startTime)}</h2></div><button type="button" aria-label="关闭详情" onClick={() => setSelectedClipId('')}><X size={18} /></button></header>
            <button type="button" className="libraryDetailPreview" onClick={() => onOpenPlayback(selectedSegment)}>{selectedSegment.thumbnailUrl ? <img src={selectedSegment.thumbnailUrl} alt="" /> : <FilmStrip size={32} />}<span><Play size={18} weight="fill" /></span></button>
            <dl><div><dt>录像源</dt><dd>{sourceNames.get(selectedSegment.sourceId) ?? '录像源'}</dd></div><div><dt>日期</dt><dd>{formatFullDate(selectedSegment.startTime)}</dd></div><div><dt>时长</dt><dd>{formatOffset(selectedSegment.durationSeconds)}</dd></div><div><dt>状态</dt><dd>{recognitionLabel(selectedSegment.id)}</dd></div><div><dt>标签</dt><dd>{selectedDetectionSummary.length ? selectedDetectionSummary.slice(0, 2).map((item) => <span className="libraryTag" key={item.label}>{item.labelName}</span>) : '暂无标签'}</dd></div></dl>
            <div className="libraryRecognitionActions"><button type="button" onClick={() => triggerTranscriptionMutation.mutate({ segmentId: selectedSegment.id, reset: hasTranscriptionResults })}><Microphone size={16} />{hasTranscriptionResults ? '重新识别' : '识别字幕'}</button><button type="button" onClick={() => triggerVisionMutation.mutate({ segmentId: selectedSegment.id, force: hasVisionResults })}><Eye size={16} />视觉识别</button></div>
            <button type="button" className="libraryPrimary full" onClick={() => onExportSegments([selectedSegment])}><DownloadSimple size={17} />导出当前片段</button>
            {selectedTranscriptions.length > 0 && <section className="libraryTranscriptPreview"><strong><FileText size={15} />字幕预览</strong>{selectedTranscriptions.slice(0, 3).map((line) => <p key={line.id}><time>{formatOffset(line.startTime)}</time>{line.text}<CaretRight size={13} /></p>)}</section>}
          </> : <div className="redesignLibraryInspectorEmpty"><FilmStrip size={30} /><strong>选择片段查看详情</strong><span>可预览、识别或导出当前片段。</span></div>}
        </aside>
      </div>

      {selectedSegments.length > 0 && <div className="redesignSelectionBar" role="region" aria-label="批量操作"><span aria-live="polite"><CheckCircle size={19} weight="fill" />已选 {selectedSegments.length} 个片段</span><button type="button" onClick={() => setSelectedClipIds([])}>取消选择</button><button type="button" className="secondary" onClick={() => void detectSelected()}><Eye size={16} />视觉识别</button><button type="button" className="primary" onClick={() => onExportSegments(selectedSegments)}><DownloadSimple size={16} />合并导出</button></div>}
    </div>
  )
}
