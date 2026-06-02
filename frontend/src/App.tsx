import * as Toast from '@radix-ui/react-toast'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Camera,
  Download,
  Grid3X3,
  History,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings,
  Star,
  Subtitles,
  X,
} from 'lucide-react'
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { api } from './api'
import { BatchActions } from './components/shared/BatchActions'
import { ClipGrid } from './components/shared/ClipGrid'
import { FailurePill } from './components/shared/FailurePill'
import { ManagePanel } from './components/shared/ManagePanel'
import { SourceSelect } from './components/shared/SourceSelect'
import { TimeRail } from './components/shared/TimeRail'
import { SettingsPage } from './components/settings/SettingsPage'
import { ExportStage } from './components/views/ExportStage'
import { LogsStage } from './components/views/LogsStage'
import { SearchStage } from './components/views/SearchStage'
import { SourceStage } from './components/views/SourceStage'
import { SubtitleOverlay } from './components/views/SubtitleOverlay'
import { SubtitleStage } from './components/views/SubtitleStage'
import { TranscriptionPanel } from './components/views/TranscriptionPanel'
import type {
  DirectoryNode,
  ExportJob,
  ScanJob,
  SearchResponse as SearchResponseType,
  Segment,
  Source,
  SystemStatus,
  Transcription,
  TranscriptionJob,
} from './types'
import {
  type DisplaySegment,
  formatBytes,
  formatClipDateTime,
  formatRangeLabel,
  formatTime,
  getDefaultRange,
  queryMessage,
  searchHistoryStorageKey,
  segmentDate,
  selectedSourceStorageKey,
  today,
  toDisplaySegment,
  toIsoWithOffset,
  toLocalInputValue,
} from './utils'

type ViewKey = 'playback' | 'clips' | 'subtitles' | 'sources' | 'exports' | 'logs' | 'settings' | 'search'

const navItems: Array<{ key: ViewKey; label: string; icon: typeof Play }> = [
  { key: 'playback', label: '录像回放', icon: Play },
  { key: 'clips', label: '片段墙', icon: Grid3X3 },
  { key: 'subtitles', label: '字幕', icon: Subtitles },
  { key: 'sources', label: '录像源', icon: Camera },
  { key: 'exports', label: '导出任务', icon: Download },
  { key: 'logs', label: '日志', icon: History },
  { key: 'settings', label: '设置', icon: Settings },
]

const viewTitles: Record<ViewKey, string> = {
  playback: '录像回放',
  clips: '片段墙',
  subtitles: '字幕任务',
  sources: '录像源',
  exports: '导出任务',
  logs: '日志',
  settings: '设置',
  search: '搜索',
}

const clipDockHeightStorageKey = 'clipline.clipDockHeight'
const defaultClipDockHeight = 300
const minClipDockHeight = 150
const minViewerHeight = 240

export function App() {
  const queryClient = useQueryClient()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const viewerRightRef = useRef<HTMLDivElement | null>(null)
  const clipResizeDragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const [sourceId, setSourceId] = useState(() => localStorage.getItem(selectedSourceStorageKey) ?? '')
  const [date, setDate] = useState(today)
  const [selectedSegment, setSelectedSegment] = useState<DisplaySegment | null>(null)
  const [previewSegment, setPreviewSegment] = useState<DisplaySegment | null>(null)
  const [playbackTimeMs, setPlaybackTimeMs] = useState<number | null>(null)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [autoPlayNext, setAutoPlayNext] = useState(false)
  const [sourceName, setSourceName] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [sourceScanInterval, setSourceScanInterval] = useState(0)
  const [exportStart, setExportStart] = useState('')
  const [exportEnd, setExportEnd] = useState('')
  const [exportRangeVisible, setExportRangeVisible] = useState(false)
  const [clipRangeStart, setClipRangeStart] = useState(() => getDefaultRange(7).start)
  const [clipRangeEnd, setClipRangeEnd] = useState(() => getDefaultRange(7).end)
  const [exportMode, setExportMode] = useState<'fast' | 'accurate'>('fast')
  const [message, setMessage] = useState('')
  const [toastDownloadUrl, setToastDownloadUrl] = useState<string | null>(null)
  const [toastOpen, setToastOpen] = useState(false)
  const [watchedExportIds, setWatchedExportIds] = useState<string[]>([])
  const [activeView, setActiveView] = useState<ViewKey>('playback')
  const [managePanelOpen, setManagePanelOpen] = useState(false)
  const [manageRangeStart, setManageRangeStart] = useState<number | null>(null)
  const [manageRangeEnd, setManageRangeEnd] = useState<number | null>(null)
  const [clipDockHeight, setClipDockHeight] = useState(() => {
    const saved = Number(localStorage.getItem(clipDockHeightStorageKey))
    return Number.isFinite(saved) && saved > 0 ? saved : defaultClipDockHeight
  })

  // 搜索相关状态
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [showSearchHistory, setShowSearchHistory] = useState(false)
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(searchHistoryStorageKey)
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [searchSourceId, setSearchSourceId] = useState<string | undefined>(undefined)
  const [searchStartDate, setSearchStartDate] = useState<string | undefined>(undefined)
  const [searchEndDate, setSearchEndDate] = useState<string | undefined>(undefined)
  const [selectedSearchResult, setSelectedSearchResult] = useState<SearchResponseType['items'][0] | null>(null)
  const [searchTranscriptions, setSearchTranscriptions] = useState<Transcription[]>([])

  // 字幕相关状态
  const [currentTranscriptions, setCurrentTranscriptions] = useState<Transcription[]>([])
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0)
  const [subtitleMode, setSubtitleMode] = useState<'list' | 'overlay'>('overlay')

  const segmentPageSize = 1000
  const sourcesQuery = useQuery({
    queryKey: ['sources'],
    queryFn: api.sources,
    refetchInterval: 5000,
  })
  const directoriesQuery = useQuery({
    queryKey: ['directories'],
    queryFn: () => api.directories(),
  })
  const timelineQuery = useQuery({
    queryKey: ['timeline', sourceId, date],
    queryFn: () => api.timeline(sourceId, date),
    enabled: Boolean(sourceId),
  })
  const exportsQuery = useQuery({
    queryKey: ['exports'],
    queryFn: api.exports,
    refetchInterval: 2500,
  })
  const statusQuery = useQuery({
    queryKey: ['systemStatus'],
    queryFn: api.status,
    refetchInterval: 10000,
  })

  // 搜索查询
  const searchQuery_ = useQuery({
    queryKey: ['search', searchQuery, searchSourceId, searchStartDate, searchEndDate],
    queryFn: () => api.search({
      q: searchQuery,
      sourceId: searchSourceId,
      startDate: searchStartDate,
      endDate: searchEndDate,
    }),
    enabled: activeView === 'search' && searchQuery.length > 0,
  })

  // 当前视频的识别结果查询
  const transcriptionQuery = useQuery({
    queryKey: ['transcription', selectedSegment?.id],
    queryFn: () => api.getTranscription(selectedSegment!.id),
    enabled: Boolean(selectedSegment?.id) && activeView === 'playback',
  })

  const scanJobsQuery = useQuery({
    queryKey: ['scanJobs', sourceId || 'all'],
    queryFn: () => api.scanJobs(sourceId || undefined),
    refetchInterval: 2500,
  })
  const failedSegmentsQuery = useQuery({
    queryKey: ['segments', sourceId, 'failed'],
    queryFn: () => api.segments({ sourceId, scanStatus: 'failed', limit: 8 }),
    enabled: Boolean(sourceId),
    refetchInterval: 5000,
  })
  const segmentsQuery = useInfiniteQuery({
    queryKey: ['segments', sourceId, 'indexed'],
    queryFn: ({ pageParam }) =>
      api.segments({
        sourceId,
        scanStatus: 'indexed',
        limit: segmentPageSize,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.offset + lastPage.items.length < lastPage.total ? lastPage.offset + lastPage.items.length : undefined),
    enabled: Boolean(sourceId),
    refetchInterval: 5000,
  })

  const sources = sourcesQuery.data?.items ?? []
  const directories = directoriesQuery.data?.items ?? []
  const directoryRoot = directoriesQuery.data?.root ?? ''
  const timeline = timelineQuery.data ?? null
  const exports = exportsQuery.data?.items ?? []
  const systemStatus = statusQuery.data ?? null
  const scanJobs = scanJobsQuery.data?.items ?? []
  const failedSegments = failedSegmentsQuery.data?.items ?? []
  const selectedSource = sources.find((source) => source.id === sourceId)
  const searchResults = searchQuery_.data ?? null
  const sourceNames = useMemo(() => new Map(sources.map((source) => [source.id, source.name])), [sources])
  const allSegments = useMemo(
    () =>
      (segmentsQuery.data?.pages.flatMap((page) => page.items) ?? [])
        .map(toDisplaySegment)
        .filter((segment): segment is DisplaySegment => Boolean(segment)),
    [segmentsQuery.data?.pages],
  )
  const filteredSegments = useMemo(() => {
    const start = clipRangeStart ? new Date(clipRangeStart).getTime() : null
    const end = clipRangeEnd ? new Date(clipRangeEnd).getTime() : null
    return allSegments.filter((segment) => {
      const time = new Date(segment.startTime).getTime()
      if (start !== null && time < start) return false
      if (end !== null && time > end) return false
      return true
    })
  }, [allSegments, clipRangeEnd, clipRangeStart])
  const loadedSegmentCount = allSegments.length
  const totalAvailableSegments = segmentsQuery.data?.pages[0]?.total ?? loadedSegmentCount
  const rangeSegments = filteredSegments
  const playbackQueue = useMemo(
    () => [...rangeSegments].sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime()),
    [rangeSegments],
  )

  const latestExport = exports[0]
  const activeExportCount = exports.filter((job) => job.status === 'queued' || job.status === 'running').length
  const latestScan = scanJobs[0]
  const allSourceSegmentCount = useMemo(
    () => sources.reduce((sum, source) => sum + source.segmentCount, 0),
    [sources],
  )
  const currentSourceSegmentCount = useMemo(
    () => (sourceId ? selectedSource?.segmentCount ?? allSegments.length : 0),
    [allSegments.length, selectedSource?.segmentCount, sourceId],
  )
  const totalRecordedSeconds = useMemo(
    () => allSegments.reduce((sum, segment) => sum + segment.durationSeconds, 0),
    [allSegments],
  )

  function notify(text: string, downloadUrl?: string | null) {
    setMessage(text)
    setToastDownloadUrl(downloadUrl ?? null)
    setToastOpen(false)
    window.setTimeout(() => setToastOpen(true), 0)
  }

  // 搜索相关函数
  function handleSearch(query: string) {
    if (!query.trim()) return
    setSearchQuery(query.trim())
    setActiveView('search')
    setSelectedSearchResult(null)
    setSearchTranscriptions([])

    // 保存搜索历史
    const newHistory = [query.trim(), ...searchHistory.filter((h) => h !== query.trim())].slice(0, 20)
    setSearchHistory(newHistory)
    localStorage.setItem(searchHistoryStorageKey, JSON.stringify(newHistory))
  }

  function handleSelectSearchResult(result: SearchResponseType['items'][0]) {
    setSelectedSearchResult(result)
    // 加载该视频的识别结果
    api.getTranscription(result.segmentId).then((data) => {
      setSearchTranscriptions(data.items)
    })
  }

  function handleExportSrt(segmentId: string) {
    api.exportTranscription(segmentId, 'srt').then((data) => {
      const blob = new Blob([data.content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `transcription_${segmentId}.srt`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  function handleExportTxt(segmentId: string) {
    api.exportTranscription(segmentId, 'txt').then((data) => {
      const blob = new Blob([data.content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `transcription_${segmentId}.txt`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  function handleClearSearchHistory() {
    setSearchHistory([])
    localStorage.removeItem(searchHistoryStorageKey)
  }

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sources'] }),
      queryClient.invalidateQueries({ queryKey: ['exports'] }),
      queryClient.invalidateQueries({ queryKey: ['systemStatus'] }),
      queryClient.invalidateQueries({ queryKey: ['scanJobs'] }),
      queryClient.invalidateQueries({ queryKey: ['segments'] }),
      queryClient.invalidateQueries({ queryKey: ['timeline'] }),
    ])
  }

  useEffect(() => {
    if (!sourcePath && directories[0]) setSourcePath(directories[0].path)
  }, [directories, sourcePath])

  useEffect(() => {
    if (!sourcesQuery.isSuccess) return
    if (!sources.length) {
      if (sourceId) {
        setSourceId('')
        localStorage.removeItem(selectedSourceStorageKey)
      }
      return
    }
    const hasCurrentSource = sourceId ? sources.some((source) => source.id === sourceId) : false
    if (sourceId && !hasCurrentSource) {
      setSourceId('')
      localStorage.removeItem(selectedSourceStorageKey)
      return
    }
    const savedSourceId = localStorage.getItem(selectedSourceStorageKey)
    if (!sourceId && savedSourceId && sources.some((source) => source.id === savedSourceId)) {
      setSourceId(savedSourceId)
    }
  }, [sourceId, sources, sourcesQuery.isSuccess])

  useEffect(() => {
    if (!sourceId || !rangeSegments.length) {
      setSelectedSegment(null)
      return
    }
    setDate(segmentDate(rangeSegments[0].startTime))
    if (!selectedSegment || !rangeSegments.some((segment) => segment.id === selectedSegment.id)) {
      selectSegment(rangeSegments[0])
    }
  }, [rangeSegments, selectedSegment])

  useEffect(() => {
    if (!autoPlayNext || !selectedSegment || activeView !== 'playback') return
    const video = videoRef.current
    if (!video) return
    requestAnimationFrame(() => {
      video.play().catch(() => {
        setAutoPlayNext(false)
      })
    })
  }, [activeView, autoPlayNext, selectedSegment])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate
  }, [playbackRate, selectedSegment])

  useEffect(() => {
    if (!watchedExportIds.length) return
    const watchedJobs = watchedExportIds
      .map((id) => exports.find((job) => job.id === id))
      .filter((job): job is ExportJob => Boolean(job))
    const completed = watchedJobs.find((job) => job.status === 'completed' && job.downloadUrl)
    if (completed) {
      notify('导出已完成，可以下载', completed.downloadUrl)
      setWatchedExportIds((ids) => ids.filter((id) => id !== completed.id))
      return
    }
    const failed = watchedJobs.find((job) => job.status === 'failed')
    if (failed) {
      notify(`导出失败：${failed.errorMessage ?? '请查看导出任务'}`)
      setWatchedExportIds((ids) => ids.filter((id) => id !== failed.id))
    }
  }, [exports, watchedExportIds])

  // 快捷键支持
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+K 或 Cmd+K 聚焦搜索框
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        const searchInput = document.querySelector('.searchBar input') as HTMLInputElement
        if (searchInput) {
          searchInput.focus()
          searchInput.select()
        }
      }
      // Escape 键返回
      if (e.key === 'Escape' && activeView === 'search') {
        setActiveView('playback')
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeView])

  const createSourceMutation = useMutation({
    mutationFn: api.createSource,
    onSuccess: async (created) => {
      notify(`已创建源 ${created.name}`)
      setSourceName('')
      setSourceScanInterval(0)
      handleSourceChange(created.id)
      await refreshAll()
    },
    onError: (error) => notify(queryMessage(error, '创建源失败')),
  })

  const scanMutation = useMutation({
    mutationFn: api.scanSource,
    onSuccess: (response) => {
      notify(`扫描任务 ${response.status}`)
      window.setTimeout(() => void refreshAll(), 1200)
    },
    onError: (error) => notify(queryMessage(error, '扫描失败')),
  })

  const exportMutation = useMutation({
    mutationFn: api.createExport,
    onSuccess: async (response) => {
      notify('导出任务已创建，完成后会提示下载')
      setWatchedExportIds((ids) => (ids.includes(response.exportId) ? ids : [...ids, response.exportId]))
      await queryClient.invalidateQueries({ queryKey: ['exports'] })
    },
    onError: (error) => notify(queryMessage(error, '创建导出失败')),
  })

  const updateSourceMutation = useMutation({
    mutationFn: ({
      id,
      name,
      path,
      enabled,
      scanIntervalMinutes,
    }: {
      id: string
      name?: string
      path?: string
      enabled?: boolean
      scanIntervalMinutes?: number
    }) => api.updateSource(id, { name, path, enabled, scanIntervalMinutes }),
    onSuccess: async () => {
      notify('源状态已更新')
      await queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
    onError: (error) => notify(queryMessage(error, '更新源失败')),
  })

  const deleteSourceMutation = useMutation({
    mutationFn: (id: string) => api.deleteSource(id),
    onSuccess: async () => {
      notify('录像源已删除')
      setSourceId('')
      localStorage.removeItem(selectedSourceStorageKey)
      await refreshAll()
    },
    onError: (error) => notify(queryMessage(error, '删除录像源失败')),
  })

  function handleCreateSource() {
    if (!sourcePath.trim()) return
    const name = sourceName.trim() || `录像源 ${sources.length + 1}`
    createSourceMutation.mutate({
      name,
      path: sourcePath.trim(),
      scanIntervalMinutes: sourceScanInterval,
    })
  }

  function handleScan() {
    if (sourceId) {
      scanMutation.mutate(sourceId)
      return
    }
    notify('先选择录像源')
  }

  function handleSourceChange(nextSourceId: string) {
    if (nextSourceId === sourceId) return
    setSourceId(nextSourceId)
    if (nextSourceId) {
      localStorage.setItem(selectedSourceStorageKey, nextSourceId)
    } else {
      localStorage.removeItem(selectedSourceStorageKey)
    }
    setSelectedSegment(null)
    setPreviewSegment(null)
    setPlaybackTimeMs(null)
    setIsPlaying(false)
    setAutoPlayNext(false)
    setExportStart('')
    setExportEnd('')
    setExportRangeVisible(false)
  }

  function selectSegment(segment: DisplaySegment, play = false, showExportRange = false) {
    setSelectedSegment(segment)
    setPlaybackTimeMs(new Date(segment.startTime).getTime())
    setAutoPlayNext(play)
    setDate(segmentDate(segment.startTime))
    setExportStart(toLocalInputValue(segment.startTime))
    setExportEnd(toLocalInputValue(segment.endTime))
    setExportRangeVisible(showExportRange)
  }

  function openClipPreview(segment: DisplaySegment) {
    setSelectedSegment(segment)
    setPlaybackTimeMs(new Date(segment.startTime).getTime())
    setDate(segmentDate(segment.startTime))
    setExportStart(toLocalInputValue(segment.startTime))
    setExportEnd(toLocalInputValue(segment.endTime))
    setExportRangeVisible(false)
    setPreviewSegment(segment)
  }

  function handleSegmentEnded() {
    if (!selectedSegment) return
    const currentIndex = playbackQueue.findIndex((segment) => segment.id === selectedSegment.id)
    const nextSegment = currentIndex >= 0 ? playbackQueue[currentIndex + 1] : null
    if (!nextSegment) {
      setAutoPlayNext(false)
      setIsPlaying(false)
      return
    }
    setSelectedSegment(nextSegment)
    setPlaybackTimeMs(new Date(nextSegment.startTime).getTime())
    setAutoPlayNext(true)
    setDate(segmentDate(nextSegment.startTime))
    setExportStart(toLocalInputValue(nextSegment.startTime))
    setExportEnd(toLocalInputValue(nextSegment.endTime))
    setExportRangeVisible(false)
  }

  function syncPlaybackTime() {
    const video = videoRef.current
    if (!video || !selectedSegment || !Number.isFinite(video.currentTime)) return
    setPlaybackTimeMs(new Date(selectedSegment.startTime).getTime() + video.currentTime * 1000)
  }

  function clampClipDockHeight(nextHeight: number) {
    const hostHeight = viewerRightRef.current?.getBoundingClientRect().height ?? 0
    const maxHeight = hostHeight > 0 ? Math.max(minClipDockHeight, hostHeight - minViewerHeight - 8) : 520
    return Math.min(maxHeight, Math.max(minClipDockHeight, Math.round(nextHeight)))
  }

  function updateClipDockHeight(nextHeight: number) {
    setClipDockHeight(() => {
      const clamped = clampClipDockHeight(nextHeight)
      localStorage.setItem(clipDockHeightStorageKey, String(clamped))
      return clamped
    })
  }

  function handleClipResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    clipResizeDragRef.current = {
      startY: event.clientY,
      startHeight: clipDockHeight,
    }
    document.body.classList.add('isResizingPanels')
  }

  function handleClipResizePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = clipResizeDragRef.current
    if (!drag) return
    updateClipDockHeight(drag.startHeight - (event.clientY - drag.startY))
  }

  function handleClipResizeMouseDown(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = clipDockHeight
    document.body.classList.add('isResizingPanels')

    const handleMouseMove = (moveEvent: MouseEvent) => {
      updateClipDockHeight(startHeight - (moveEvent.clientY - startY))
    }
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      finishClipResize()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  function finishClipResize() {
    clipResizeDragRef.current = null
    document.body.classList.remove('isResizingPanels')
  }

  function handlePlaybackRateChange(nextRate: number) {
    setPlaybackRate(nextRate)
    if (videoRef.current) videoRef.current.playbackRate = nextRate
  }

  function togglePlayback() {
    const video = videoRef.current
    if (!video || !selectedSegment) {
      notify('先选择片段')
      return
    }
    if (video.paused) {
      video.play().catch(() => notify('浏览器阻止了自动播放，请再点一次播放'))
      return
    }
    video.pause()
  }

  function showExportRange() {
    if (selectedSegment) {
      setExportStart(toLocalInputValue(selectedSegment.startTime))
      setExportEnd(toLocalInputValue(selectedSegment.endTime))
      setExportRangeVisible(true)
      return true
    }
    if (exportStart && exportEnd) {
      setExportRangeVisible(true)
      return true
    }
    notify('先选择片段')
    return false
  }

  function handleExport() {
    const exportSourceId = selectedSegment?.sourceId ?? sourceId
    if (!exportRangeVisible) {
      showExportRange()
      return
    }
    if (!exportSourceId || !exportStart || !exportEnd) {
      notify('先在时间线上选择导出区间')
      return
    }
    if (new Date(exportStart).getTime() >= new Date(exportEnd).getTime()) {
      notify('导出结束时间必须晚于开始时间')
      return
    }
    exportMutation.mutate({
      sourceId: exportSourceId,
      startTime: toIsoWithOffset(exportStart),
      endTime: toIsoWithOffset(exportEnd),
      mode: exportMode,
    })
  }


  const busy =
    sourcesQuery.isFetching ||
    directoriesQuery.isFetching ||
    timelineQuery.isFetching ||
    exportsQuery.isFetching ||
    statusQuery.isFetching ||
    scanJobsQuery.isFetching ||
    failedSegmentsQuery.isFetching ||
    segmentsQuery.isFetching

  const stageMeta =
    activeView === 'playback' || activeView === 'clips'
      ? sourceId
        ? `${formatRangeLabel(clipRangeStart, clipRangeEnd)} · ${currentSourceSegmentCount} 个片段 · ${Math.round(totalRecordedSeconds)} 秒`
        : '请选择录像源后加载片段'
      : activeView === 'sources'
        ? `${sources.length} 个源 · ${allSourceSegmentCount} 个片段`
        : activeView === 'logs'
          ? `${scanJobs.length} 条扫描 · ${exports.length} 条导出 · ${failedSegments.length} 个错误`
          : activeView === 'exports'
            ? `${exports.length} 条导出记录 · ${activeExportCount} 个进行中`
          : `版本 ${systemStatus?.version ?? '-'} · 数据库 ${systemStatus?.database.path ?? '/app/data/clipline.db'}`
  const showSourceSelect = activeView === 'playback' || activeView === 'clips' || activeView === 'sources'

  return (
    <Toast.Provider swipeDirection="right">
      <div className="protectShell compactShell">
        <aside className="rail">
          <button className="railLogo" title="Clipline" aria-label="Clipline 录像回放" onClick={() => setActiveView('playback')}>
            <svg className="railLogoMark" viewBox="0 0 40 40" role="img" aria-hidden="true">
              <defs>
                <linearGradient id="cliplineLogoFill" x1="7" y1="4" x2="33" y2="36" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="1" stopColor="#eaf2ff" />
                </linearGradient>
                <linearGradient id="cliplineLogoAccent" x1="13" y1="22" x2="29" y2="22" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#34d3c8" />
                  <stop offset="1" stopColor="#2f6df6" />
                </linearGradient>
              </defs>
              <rect x="4.5" y="4.5" width="31" height="31" rx="10" fill="url(#cliplineLogoFill)" />
              <rect x="4.5" y="4.5" width="31" height="31" rx="10" fill="none" stroke="#d6e5ff" />
              <path d="M12 13.5H24.5" stroke="#8ba2bd" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M12 26.5H28" stroke="#b5c4d6" strokeWidth="2.4" strokeLinecap="round" />
              <rect x="11" y="18.5" width="3.5" height="7" rx="1.75" fill="#34d3c8" />
              <path d="M18 16.5L28.5 22L18 27.5V16.5Z" fill="url(#cliplineLogoAccent)" />
            </svg>
            <span className="railLogoStatus" />
          </button>
          {navItems.slice(0, 5).map((item) => {
            const Icon = item.icon
            return (
              <button
                className={activeView === item.key ? 'railButton active' : 'railButton'}
                key={item.key}
                title={item.label}
                aria-label={item.label}
                aria-pressed={activeView === item.key}
                onClick={() => setActiveView(item.key)}
              >
                <Icon size={20} />
              </button>
            )
          })}
          <div className="railSpacer" />
          {navItems.slice(5).map((item) => {
            const Icon = item.icon
            return (
              <button
                className={activeView === item.key ? 'railButton active' : 'railButton'}
                key={item.key}
                title={item.label}
                aria-label={item.label}
                aria-pressed={activeView === item.key}
                onClick={() => setActiveView(item.key)}
              >
                <Icon size={20} />
              </button>
            )
          })}
        </aside>

        <main className="stage">
          <header className="stageTop">
            <div>
              <div className="stageTitle">
                {activeView === 'playback' ? selectedSource?.name ?? viewTitles[activeView] : viewTitles[activeView]}
              </div>
              <div className="stageMeta">
                {stageMeta}
              </div>
            </div>
            <div className="stageTools">
              <div className="searchBarWrapper">
                <div className="searchBar">
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="搜索对话内容... (Ctrl+K)"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchInput.trim()) {
                        handleSearch(searchInput.trim())
                      }
                      if (e.key === 'Escape') {
                        setSearchInput('')
                      }
                    }}
                    onFocus={() => setShowSearchHistory(true)}
                    onBlur={() => setTimeout(() => setShowSearchHistory(false), 200)}
                  />
                  {searchInput && (
                    <button
                      className="searchClear"
                      onClick={() => setSearchInput('')}
                      title="清除"
                    >
                      <X size={14} />
                    </button>
                  )}
                  <button
                    className="searchButton"
                    onClick={() => {
                      if (searchInput.trim()) {
                        handleSearch(searchInput.trim())
                      }
                    }}
                    disabled={!searchInput.trim()}
                    title="搜索"
                  >
                    <Search size={14} />
                  </button>
                </div>
                {showSearchHistory && searchHistory.length > 0 && (
                  <div className="searchHistory">
                    {searchHistory.slice(0, 8).map((item, index) => (
                      <button
                        key={index}
                        className="searchHistoryItem"
                        onClick={() => {
                          setSearchInput(item)
                          handleSearch(item)
                        }}
                      >
                        <History size={14} />
                        <span>{item}</span>
                      </button>
                    ))}
                    <button
                      className="searchHistoryClear"
                      onClick={handleClearSearchHistory}
                    >
                      清除搜索历史
                    </button>
                  </div>
                )}
              </div>
              {showSourceSelect && <SourceSelect sources={sources} value={sourceId} onChange={handleSourceChange} />}
              <button className="refreshButton" onClick={() => void refreshAll()}>
                <RefreshCw size={18} className={busy ? 'spin' : ''} />
              </button>
            </div>
          </header>

          {activeView === 'sources' ? (
            <SourceStage
              sources={sources}
              selectedId={sourceId}
              directories={directories}
              directoryRoot={directoryRoot}
              sourceName={sourceName}
              sourcePath={sourcePath}
              sourceScanInterval={sourceScanInterval}
              scanJobs={scanJobs}
              creating={createSourceMutation.isPending}
              scanning={scanMutation.isPending}
              onSelect={handleSourceChange}
              onScan={(id) => scanMutation.mutate(id)}
              onCreate={handleCreateSource}
              onNameChange={setSourceName}
              onPathChange={setSourcePath}
              onIntervalChange={setSourceScanInterval}
              onToggle={(id, enabled) => updateSourceMutation.mutate({ id, enabled })}
              onScheduleChange={(id, scanIntervalMinutes) =>
                updateSourceMutation.mutate({ id, scanIntervalMinutes })
              }
              onSave={(id, payload) => updateSourceMutation.mutate({ id, ...payload })}
              onDelete={(id) => deleteSourceMutation.mutate(id)}
            />
          ) : activeView === 'search' ? (
            <SearchStage
              searchQuery={searchQuery}
              searchResults={searchResults}
              selectedResult={selectedSearchResult}
              transcriptions={searchTranscriptions}
              sources={sources}
              searchSourceId={searchSourceId}
              searchStartDate={searchStartDate}
              searchEndDate={searchEndDate}
              loading={searchQuery_.isFetching}
              onBack={() => setActiveView('playback')}
              onSelectResult={handleSelectSearchResult}
              onSourceChange={setSearchSourceId}
              onStartDateChange={setSearchStartDate}
              onEndDateChange={setSearchEndDate}
              onExportSrt={handleExportSrt}
              onExportTxt={handleExportTxt}
            />
          ) : activeView === 'settings' ? (
            <SettingsPage
              sources={sources}
              status={systemStatus}
              onRefresh={() => void refreshAll()}
              busy={busy}
            />
          ) : activeView === 'exports' ? (
            <ExportStage
              exports={exports}
              error={exportsQuery.error}
              onRefresh={() => void refreshAll()}
              busy={busy}
            />
          ) : activeView === 'logs' ? (
            <LogsStage
              sources={sources}
              scanJobs={scanJobs}
              exports={exports}
              failedSegments={failedSegments}
              onRefresh={() => void refreshAll()}
              busy={busy}
            />
          ) : activeView === 'subtitles' ? (
            <SubtitleStage
              segments={allSegments}
              sourceNames={sourceNames}
              onSelectSegment={(segment) => {
                selectSegment(segment, true)
                setActiveView('playback')
              }}
              onNotify={notify}
            />
          ) : activeView === 'clips' ? (
            <div className="workbenchLayout">
              <div className="workbenchContent">
                <section className="clipDock fullDock">
                  <div className="dockHead">
                    <div>
                      <div className="dockTitle">全部片段</div>
                      <div className="dockMeta">按最新录像排序</div>
                    </div>
                    {failedSegments.length > 0 && <FailurePill segments={failedSegments} />}
                  </div>
                  <BatchActions
                    segments={filteredSegments}
                    onBatchTranscribe={(segmentIds) => {
                      segmentIds.forEach((id) => {
                        api.triggerTranscription(id).catch(() => {
                          // 忽略单个失败
                        })
                      })
                      notify(`已创建 ${segmentIds.length} 个识别任务`)
                    }}
                  />
                  <ClipGrid
                    sourceName={selectedSource?.name ?? 'Camera'}
                    sourceNames={sourceNames}
                    segments={filteredSegments}
                    selectedId={selectedSegment?.id}
                    hasMore={segmentsQuery.hasNextPage}
                    loadingMore={segmentsQuery.isFetchingNextPage}
                    total={totalAvailableSegments}
                    onLoadMore={() => void segmentsQuery.fetchNextPage()}
                    onSelect={openClipPreview}
                    onTranscribe={(segmentId) => {
                      api.triggerTranscription(segmentId).then(() => {
                        notify('语音识别任务已创建')
                      }).catch((err) => {
                        notify(queryMessage(err, '创建识别任务失败'))
                      })
                    }}
                  />
                </section>
              </div>
            </div>
          ) : (
            <div className="workbenchLayout">
              <div className="workbenchContent">
                <section className={`viewerBand${managePanelOpen ? ' viewerBandWithManage' : ''}`}>
                  <TimeRail
                    dateStart={clipRangeStart ? clipRangeStart.slice(0, 10) : today}
                    dateEnd={clipRangeEnd ? clipRangeEnd.slice(0, 10) : today}
                    segments={rangeSegments}
                    selectedId={selectedSegment?.id}
                    playbackTimeMs={playbackTimeMs}
                    playbackRate={playbackRate}
                    isPlaying={isPlaying}
                    onSelect={(segment) => selectSegment(segment, true)}
                    onPlaybackRateChange={handlePlaybackRateChange}
                    onTogglePlayback={togglePlayback}
                    manageOpen={managePanelOpen}
                    onManage={() => setManagePanelOpen(!managePanelOpen)}
                    onDateStartChange={(d) => setClipRangeStart(d + 'T00:00')}
                    onDateEndChange={(d) => setClipRangeEnd(d + 'T23:59')}
                    onRangeChange={(startMs, endMs) => {
                      setManageRangeStart(startMs)
                      setManageRangeEnd(endMs)
                      setManagePanelOpen(true)
                    }}
                  />
                  {managePanelOpen && (
                    <ManagePanel
                      segments={rangeSegments}
                      sources={sources}
                      selectedSourceId={sourceId}
                      currentTimeMs={playbackTimeMs}
                      externalRangeStart={manageRangeStart}
                      externalRangeEnd={manageRangeEnd}
                      onClose={() => {
                        setManagePanelOpen(false)
                        setManageRangeStart(null)
                        setManageRangeEnd(null)
                      }}
                      onExport={(startTime, endTime, mode, speed) => {
                        exportMutation.mutate({
                          sourceId: selectedSegment?.sourceId ?? sourceId,
                          startTime,
                          endTime,
                          mode: mode || 'fast',
                          timelapseSpeed: speed,
                        })
                        setManagePanelOpen(false)
                        setManageRangeStart(null)
                        setManageRangeEnd(null)
                      }}
                    />
                  )}
                  <div
                    ref={viewerRightRef}
                    className="viewerRight"
                    style={{ gridTemplateRows: `minmax(${minViewerHeight}px, 1fr) 8px ${clipDockHeight}px` }}
                  >
                    <div className="viewer">
                      {selectedSegment ? (
                        <>
                          <video
                            key={selectedSegment.id}
                            ref={videoRef}
                            className="viewerVideo"
                            controls
                            src={`/api/segments/${selectedSegment.id}/stream`}
                            onLoadedMetadata={syncPlaybackTime}
                            onTimeUpdate={() => {
                              syncPlaybackTime()
                              if (videoRef.current) {
                                setCurrentPlaybackTime(videoRef.current.currentTime)
                              }
                            }}
                            onSeeking={syncPlaybackTime}
                            onEnded={handleSegmentEnded}
                            onPlay={() => {
                              setIsPlaying(true)
                              setAutoPlayNext(true)
                            }}
                            onPause={() => {
                              setIsPlaying(false)
                              setAutoPlayNext(false)
                            }}
                          />
                          {subtitleMode === 'overlay' && currentTranscriptions.length > 0 && (
                            <SubtitleOverlay
                              transcriptions={currentTranscriptions}
                              currentTime={currentPlaybackTime}
                            />
                          )}
                          <div className="videoBadge">
                            {formatTime(selectedSegment.startTime)} | {sourceNames.get(selectedSegment.sourceId) ?? selectedSource?.name ?? 'Camera'}
                          </div>
                          <div className="floatingTools">
                            <button title="刷新" onClick={() => void refreshAll()}>
                              <RefreshCw size={17} />
                            </button>
                            <button title="导出" onClick={handleExport} disabled={exportMutation.isPending}>
                              <Download size={17} />
                            </button>
                            <button title="扫描" onClick={handleScan} disabled={scanMutation.isPending}>
                              <Activity size={17} />
                            </button>
                            <button
                              className="floatingToolTranscribe"
                              title="语音识别"
                              onClick={() => {
                                if (selectedSegment) {
                                  api.triggerTranscription(selectedSegment.id).then(() => {
                                    notify('语音识别任务已创建')
                                    void queryClient.invalidateQueries({ queryKey: ['transcription'] })
                                    void queryClient.invalidateQueries({ queryKey: ['transcriptionStatus'] })
                                  }).catch((err) => {
                                    notify(queryMessage(err, '创建识别任务失败'))
                                  })
                                }
                              }}
                            >
                              <Mic size={15} />
                              <span>字幕</span>
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="viewerEmpty">选择片段</div>
                      )}
                    </div>

                    <button
                      className="viewerResizeHandle"
                      type="button"
                      aria-label="调整播放器和录像片段高度"
                      title="拖拽调整高度，双击恢复默认"
                      onPointerDown={handleClipResizePointerDown}
                      onPointerMove={handleClipResizePointerMove}
                      onPointerUp={finishClipResize}
                      onPointerCancel={finishClipResize}
                      onLostPointerCapture={finishClipResize}
                      onMouseDown={handleClipResizeMouseDown}
                      onDoubleClick={() => updateClipDockHeight(defaultClipDockHeight)}
                    >
                      <span />
                    </button>

                    <section className="clipDock">
                      <div className="dockHead">
                        <div>
                          <div className="dockTitle">录像片段</div>
                          <div className="dockMeta">{sourceId ? `${timeline?.gaps.length ?? 0} 个断档` : '按最新录像排序'}</div>
                        </div>
                        {failedSegments.length > 0 && <FailurePill segments={failedSegments} />}
                      </div>
                      <ClipGrid
                        sourceName={selectedSource?.name ?? 'Camera'}
                        sourceNames={sourceNames}
                        segments={allSegments}
                        selectedId={selectedSegment?.id}
                        onSelect={(segment) => selectSegment(segment, true)}
                        onTranscribe={(segmentId) => {
                          api.triggerTranscription(segmentId).then(() => {
                            notify('语音识别任务已创建')
                          }).catch((err) => {
                            notify(queryMessage(err, '创建识别任务失败'))
                          })
                        }}
                      />
                    </section>
                  </div>
                </section>

                {selectedSegment && (
                  <TranscriptionPanel
                    segmentId={selectedSegment.id}
                    transcriptions={currentTranscriptions}
                    currentTime={currentPlaybackTime}
                    mode={subtitleMode}
                    onModeChange={setSubtitleMode}
                    onSelect={(time) => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = time
                      }
                    }}
                    onExportSrt={() => handleExportSrt(selectedSegment.id)}
                    onExportTxt={() => handleExportTxt(selectedSegment.id)}
                    onNotify={notify}
                  />
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      <Toast.Root className="toastRoot" open={toastOpen} onOpenChange={setToastOpen}>
        <Toast.Description>{message}</Toast.Description>
        {toastDownloadUrl && (
          <Toast.Action asChild altText="下载导出文件">
            <a className="toastAction" href={toastDownloadUrl}>
              下载
            </a>
          </Toast.Action>
        )}
      </Toast.Root>
      {previewSegment && (
        <div className="modalBackdrop clipPreviewBackdrop" role="dialog" aria-modal="true" onClick={() => setPreviewSegment(null)}>
          <div className="clipPreviewModal" onClick={(event) => event.stopPropagation()}>
            <div className="clipPreviewTopbar">
              <div className="clipPreviewTitle">
                <Camera size={15} />
                <strong>{sourceNames.get(previewSegment.sourceId) ?? selectedSource?.name ?? 'Camera'}</strong>
                <span>{formatClipDateTime(previewSegment.startTime)}</span>
              </div>
              <div className="clipPreviewTools">
                <button
                  onClick={() => {
                    setPreviewSegment(null)
                    selectSegment(previewSegment, true)
                    setActiveView('playback')
                  }}
                >
                  查看回放
                </button>
                <button title="关闭" onClick={() => setPreviewSegment(null)}>
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="clipPreviewBody">
              <video
                key={previewSegment.id}
                className="clipPreviewVideo"
                src={`/api/segments/${previewSegment.id}/stream`}
                autoPlay
                controls
              />
            </div>
          </div>
        </div>
      )}
      <Toast.Viewport className="toastViewport" />
    </Toast.Provider>
  )
}
