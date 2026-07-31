import * as Toast from '@radix-ui/react-toast'
import {
  Pulse as Activity,
  Archive as ArchiveIcon,
  ArrowClockwise as RefreshCw,
  Bell,
  Camera,
  CaretDown,
  ClockCounterClockwise as History,
  DownloadSimple as Download,
  FileText as FileTextIcon,
  Gear as GearIcon,
  ListChecks,
  MagnifyingGlass,
  Microphone as Mic,
  Pause,
  Play,
  Play as PlayIcon,
  Star,
  SlidersHorizontal,
  VideoCamera,
  X,
} from '@phosphor-icons/react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { api } from './api'
import { ManagePanel } from './components/shared/ManagePanel'
import { TimeRail } from './components/shared/TimeRail'
import { useDialogFocus } from './components/shared/useDialogFocus'
import { SETTINGS_TABS, SettingsPage, type SettingsTab } from './components/settings/SettingsPage'
import { ClipLibraryView } from './components/views/ClipLibraryView'
import { LogsStage } from './components/views/LogsStage'
import { PlaybackClipStrip } from './components/views/PlaybackClipStrip'
import { SourceStage } from './components/views/SourceStage'
import { SubtitleOverlay } from './components/views/SubtitleOverlay'
import { TaskCenterView } from './components/views/TaskCenterView'
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
  formatTime,
  getDefaultRange,
  playbackRates,
  queryMessage,
  searchHistoryStorageKey,
  segmentDate,
  selectedSourceStorageKey,
  today,
  toLocalDateTimeInput,
  toDisplaySegment,
  toIsoWithOffset,
  toLocalInputValue,
} from './utils'

type ViewKey = 'playback' | 'clips' | 'tasks' | 'manage'
type ManageSection = 'sources' | 'logs' | 'settings'
type ThemeMode = 'light' | 'dark'

const navItems = [
  { key: 'playback' as const, label: '回看', icon: PlayIcon },
  { key: 'clips' as const, label: '片段库', icon: ArchiveIcon },
  { key: 'tasks' as const, label: '任务', icon: ListChecks },
  { key: 'manage' as const, label: '管理', icon: GearIcon },
]

const viewTitles: Record<ViewKey, string> = {
  playback: '回看',
  clips: '片段库',
  tasks: '任务',
  manage: '管理',
}

const clipDockHeightStorageKey = 'clipline.clipDockHeight'
const activeViewStorageKey = 'clipline.activeView'
const themeStorageKey = 'clipline.theme'
const defaultClipDockHeight = 300
const minClipDockHeight = 150
const minViewerHeight = 240

function readInitialTheme(): ThemeMode {
  return 'light'
}

function readInitialView(): ViewKey {
  const saved = localStorage.getItem(activeViewStorageKey)
  if (saved === 'subtitles' || saved === 'exports') return 'tasks'
  if (saved === 'sources' || saved === 'logs' || saved === 'settings') return 'manage'
  if (saved === 'search') return 'playback'
  return saved && saved in viewTitles ? (saved as ViewKey) : 'playback'
}

function readInitialManageSection(): ManageSection {
  const saved = localStorage.getItem(activeViewStorageKey)
  return saved === 'logs' || saved === 'settings' ? saved : 'sources'
}

function searchResultClock(result: SearchResponseType['items'][0]) {
  if (!result.segmentStartTime) {
    const seconds = Math.max(0, Math.floor(result.transcription.startTime))
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }
  const value = new Date(result.segmentStartTime).getTime() + result.transcription.startTime * 1000
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function searchResultSegmentLabel(result: SearchResponseType['items'][0]) {
  if (!result.segmentStartTime) return `${result.sourceName} · 录像片段`
  const value = new Date(result.segmentStartTime)
  return `${result.sourceName} · ${value.getMonth() + 1}月${value.getDate()}日 ${value.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}`
}

function recognitionJobLabel(status?: TranscriptionJob['status']) {
  if (status === 'completed') return '已完成'
  if (status === 'processing') return '识别中'
  if (status === 'pending') return '排队中'
  if (status === 'failed') return '失败'
  return '未开始'
}

export function App() {
  const queryClient = useQueryClient()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const previewDialogRef = useRef<HTMLDivElement | null>(null)
  const hasAppliedInitialSegmentRange = useRef(false)
  const pendingSeekSecondsRef = useRef<number | null>(null)
  const viewerRightRef = useRef<HTMLDivElement | null>(null)
  const clipResizeDragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const [sourceId, setSourceId] = useState(() => localStorage.getItem(selectedSourceStorageKey) ?? '')
  const [date, setDate] = useState(today)
  const [selectedSegment, setSelectedSegment] = useState<DisplaySegment | null>(null)
  const [previewSegment, setPreviewSegment] = useState<DisplaySegment | null>(null)
  useDialogFocus(previewDialogRef, Boolean(previewSegment), () => setPreviewSegment(null))
  const [playbackTimeMs, setPlaybackTimeMs] = useState<number | null>(null)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [videoState, setVideoState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [autoPlayNext, setAutoPlayNext] = useState(false)
  const [sourceName, setSourceName] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [sourceScanInterval, setSourceScanInterval] = useState(0)
  const [playbackHour, setPlaybackHour] = useState(9)
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
  const [activeView, setActiveView] = useState<ViewKey>(readInitialView)
  const [theme] = useState<ThemeMode>(readInitialTheme)
  const [manageSection, setManageSection] = useState<ManageSection>(readInitialManageSection)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('overview')
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
    enabled: searchQuery.length > 0,
  })
  const popularSearchesQuery = useQuery({
    queryKey: ['popularSearches'],
    queryFn: api.popularSearches,
    enabled: showSearchHistory,
  })

  // 当前视频的识别结果查询
  const transcriptionQuery = useQuery({
    queryKey: ['transcription', selectedSegment?.id],
    queryFn: () => api.getTranscription(selectedSegment!.id),
    enabled: Boolean(selectedSegment?.id) && activeView === 'playback',
  })
  const transcriptionJobsQuery = useQuery({
    queryKey: ['transcriptionJobs', 'playback-strip'],
    queryFn: () => api.getTranscriptionJobs(),
    refetchInterval: 3000,
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
  const quickSearchResult = searchQuery_.data?.items[0]
  const quickSearchJob = quickSearchResult
    ? (transcriptionJobsQuery.data?.items ?? []).find((job) => job.segmentId === quickSearchResult.segmentId)
    : undefined
  const sourceNames = useMemo(() => new Map(sources.map((source) => [source.id, source.name])), [sources])
  const transcriptionStatusBySegment = useMemo(() => {
    const result = new Map<string, TranscriptionJob['status']>()
    for (const job of transcriptionJobsQuery.data?.items ?? []) {
      if (!result.has(job.segmentId)) result.set(job.segmentId, job.status)
    }
    return result
  }, [transcriptionJobsQuery.data?.items])
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
  const currentSourceSegmentCount = useMemo(
    () => (sourceId ? selectedSource?.segmentCount ?? allSegments.length : 0),
    [allSegments.length, selectedSource?.segmentCount, sourceId],
  )
  const playbackWindowStartMs = new Date(`${date}T${String(playbackHour).padStart(2, '0')}:00:00`).getTime()
  const playbackWindowEndMs = playbackWindowStartMs + 60 * 60 * 1000

  useEffect(() => {
    localStorage.setItem(activeViewStorageKey, activeView)
  }, [activeView])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(themeStorageKey, theme)
  }, [theme])

  function notify(text: string, downloadUrl?: string | null) {
    setMessage(text)
    setToastDownloadUrl(downloadUrl ?? null)
    setToastOpen(false)
    window.setTimeout(() => setToastOpen(true), 0)
  }

  function setPlaybackWindow(nextDate: string, nextHour: number) {
    const start = new Date(`${nextDate}T${String(nextHour).padStart(2, '0')}:00:00`)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    setDate(nextDate)
    setPlaybackHour(nextHour)
    setClipRangeStart(toLocalDateTimeInput(start))
    setClipRangeEnd(toLocalDateTimeInput(end))
  }

  // 搜索相关函数
  function handleSearch(query: string) {
    if (!query.trim()) return
    setSearchQuery(query.trim())
    setSelectedSearchResult(null)
    setSearchTranscriptions([])

    // 保存搜索历史
    const newHistory = [query.trim(), ...searchHistory.filter((h) => h !== query.trim())].slice(0, 20)
    setSearchHistory(newHistory)
    localStorage.setItem(searchHistoryStorageKey, JSON.stringify(newHistory))
  }

  async function handleSelectSearchResult(result: SearchResponseType['items'][0]) {
    setSelectedSearchResult(result)
    let segment = allSegments.find((item) => item.id === result.segmentId)
    if (!segment) {
      try {
        const response = await api.segments({ sourceId: result.sourceId, limit: 1000 })
        const candidates = response.items.map(toDisplaySegment).filter((item): item is DisplaySegment => Boolean(item))
        segment = candidates.find((item) => item.id === result.segmentId)
      } catch {
        segment = undefined
      }
    }
    if (!segment) {
      notify('无法加载该搜索结果对应的录像片段')
      return
    }
    setSourceId(result.sourceId)
    localStorage.setItem(selectedSourceStorageKey, result.sourceId)
    const absoluteTime = new Date(segment.startTime).getTime() + result.transcription.startTime * 1000
    selectSegmentAtTime(segment, absoluteTime)
    setShowSearchHistory(false)
    setActiveView('playback')
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
      return
    }
    if (!sourceId) {
      setSourceId(sources[0].id)
      localStorage.setItem(selectedSourceStorageKey, sources[0].id)
    }
  }, [sourceId, sources, sourcesQuery.isSuccess])

  useEffect(() => {
    if (hasAppliedInitialSegmentRange.current || !allSegments.length) return
    const latest = [...allSegments].sort((left, right) => new Date(right.startTime).getTime() - new Date(left.startTime).getTime())[0]
    const latestDate = segmentDate(latest.startTime)
    setPlaybackWindow(latestDate, new Date(latest.startTime).getHours())
    hasAppliedInitialSegmentRange.current = true
  }, [allSegments])

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
      autoTranscribe,
      autoDetect,
      recognitionTrigger,
      recognitionPriority,
      transcribeLanguage,
      detectLabels,
      detectConfidence,
    }: {
      id: string
      name?: string
      path?: string
      enabled?: boolean
      scanIntervalMinutes?: number
      autoTranscribe?: boolean
      autoDetect?: boolean
      recognitionTrigger?: Source['recognitionTrigger']
      recognitionPriority?: Source['recognitionPriority']
      transcribeLanguage?: Source['transcribeLanguage']
      detectLabels?: string[]
      detectConfidence?: number
    }) => api.updateSource(id, {
      name,
      path,
      enabled,
      scanIntervalMinutes,
      autoTranscribe,
      autoDetect,
      recognitionTrigger,
      recognitionPriority,
      transcribeLanguage,
      detectLabels,
      detectConfidence,
    }),
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
    setVideoState('idle')
    setAutoPlayNext(false)
    setExportStart('')
    setExportEnd('')
    setExportRangeVisible(false)
  }

  function selectSegment(segment: DisplaySegment, play = false, showExportRange = false) {
    pendingSeekSecondsRef.current = null
    setSelectedSegment(segment)
    setVideoState('loading')
    setPlaybackTimeMs(new Date(segment.startTime).getTime())
    setAutoPlayNext(play)
    setDate(segmentDate(segment.startTime))
    setExportStart(toLocalInputValue(segment.startTime))
    setExportEnd(toLocalInputValue(segment.endTime))
    setExportRangeVisible(showExportRange)
  }

  function selectSegmentAtTime(segment: DisplaySegment, absoluteTimeMs: number) {
    pendingSeekSecondsRef.current = Math.max(0, Math.min(segment.durationSeconds, (absoluteTimeMs - new Date(segment.startTime).getTime()) / 1000))
    setSelectedSegment(segment)
    setVideoState('loading')
    setPlaybackTimeMs(absoluteTimeMs)
    setAutoPlayNext(true)
    setDate(segmentDate(segment.startTime))
    setExportStart(toLocalInputValue(segment.startTime))
    setExportEnd(toLocalInputValue(segment.endTime))
    setExportRangeVisible(false)
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

  return (
    <Toast.Provider swipeDirection="right">
      <div className="protectShell compactShell fullRedesignShell">
        <header className="fullTopbar">
          <button className="fullBrand" aria-label="返回回看" onClick={() => setActiveView('playback')}>
            <img src="/clipline-logo.svg" alt="" />
            <span>Clipline</span>
          </button>
          <div className="searchBarWrapper fullGlobalSearch">
            <div className={`searchBar${showSearchHistory ? ' isOpen' : ''}`}>
              <MagnifyingGlass size={18} />
                  <input
                    type="text"
                    aria-label="全局搜索"
                    placeholder="搜索字幕内容"
                    value={searchInput}
                    onChange={(e) => {
                      setSearchInput(e.target.value)
                      setSearchQuery(e.target.value.trim())
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchInput.trim()) {
                        handleSearch(searchInput.trim())
                      }
                      if (e.key === 'Escape') {
                        setSearchInput('')
                        setSearchQuery('')
                        setShowSearchHistory(false)
                      }
                    }}
                    onFocus={() => setShowSearchHistory(true)}
                    onBlur={() => setTimeout(() => setShowSearchHistory(false), 200)}
                  />
                  {searchInput && (
                    <button
                      className="searchClear"
                      onClick={() => { setSearchInput(''); setSearchQuery('') }}
                      title="清除"
                    >
                      <X size={14} />
                    </button>
                  )}
                  <kbd>⌘ K</kbd>
            </div>
            {showSearchHistory && (
              <div className="fullSearchResults redesignSearchPopover">
                {searchInput.trim() ? (
                  <>
                    <div className="searchPopoverHeading"><span>字幕与片段结果</span></div>
                    {searchQuery_.isFetching && <div className="searchPopoverState">正在搜索真实字幕…</div>}
                    {!searchQuery_.isFetching && searchQuery_.isError && <div className="searchPopoverState error">搜索失败，请稍后重试</div>}
                    {!searchQuery_.isFetching && !searchQuery_.isError && (searchQuery_.data?.items.length ?? 0) === 0 && <div className="searchPopoverState">没有找到匹配的字幕内容</div>}
                    {!searchQuery_.isFetching && quickSearchResult && (
                      <div className="searchResultRows">
                        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => handleSelectSearchResult(quickSearchResult)}>
                          <span className="searchResultIcon"><Play size={15} /></span>
                          <strong>“{(quickSearchResult.transcription.text || quickSearchResult.highlight).replaceAll('**', '').slice(0, 18)}”</strong>
                          <time>{searchResultClock(quickSearchResult)}</time>
                        </button>
                        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => handleSelectSearchResult(quickSearchResult)}>
                          <span className="searchResultIcon"><ArchiveIcon size={15} /></span>
                          <strong>{searchResultSegmentLabel(quickSearchResult)}</strong>
                          <small>片段</small>
                        </button>
                        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setShowSearchHistory(false); setActiveView('tasks') }}>
                          <span className="searchResultIcon"><Mic size={15} /></span>
                          <strong>语音识别任务</strong>
                          <small>{recognitionJobLabel(quickSearchJob?.status)}</small>
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {(popularSearchesQuery.data?.popular.length ?? 0) > 0 && <section className="searchPresetSection"><strong>热门搜索</strong><div>{popularSearchesQuery.data?.popular.slice(0, 6).map((item) => <button key={item} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setSearchInput(item); handleSearch(item) }}>{item}</button>)}</div></section>}
                    {searchHistory.length > 0 ? <section className="searchPresetSection"><header><strong>最近搜索</strong><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={handleClearSearchHistory}>清除</button></header><div>{searchHistory.slice(0, 6).map((item) => <button key={item} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setSearchInput(item); handleSearch(item) }}><History size={13} />{item}</button>)}</div></section> : <div className="searchPopoverState">输入关键词搜索真实字幕内容</div>}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="fullTopActions">
            <button className="fullIconButton notificationButton" aria-label="通知" title="通知">
              <Bell size={19} />
              {activeExportCount > 0 && <span />}
            </button>
            <button className="accountButton" aria-label="管理员账户">
              <span className="accountAvatar">管</span>
              <span>管理员</span>
              <CaretDown size={14} />
            </button>
          </div>
        </header>

        <aside className="rail fullNavRail" aria-label="主导航">
          <div className="fullNavStack">
            {navItems.map((item) => {
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
                  <Icon size={22} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
          <button className="navCollapse" aria-label="收起导航" title="收起导航">‹</button>
        </aside>

        <main className={`stage fullPageStage${activeView === 'manage' ? ' manageStage' : ''}`}>

          {activeView === 'manage' ? (
            <div className="fullManagePage">
              <aside className="fullManageSidebar">
                <div className="manageHeading">
                  <small>管理</small>
                  <h1>系统管理</h1>
                </div>
                <nav className="manageNavigation" aria-label="系统管理">
                  <button className={manageSection === 'sources' ? 'active' : ''} onClick={() => setManageSection('sources')}>
                    <VideoCamera size={19} /><span>录像源</span><span>›</span>
                  </button>
                  <button className={manageSection === 'logs' ? 'active' : ''} onClick={() => setManageSection('logs')}>
                    <FileTextIcon size={19} /><span>日志</span><span>›</span>
                  </button>
                  <button className={manageSection === 'settings' ? 'active' : ''} onClick={() => setManageSection('settings')}>
                    <GearIcon size={19} /><span>设置</span><span>›</span>
                  </button>
                </nav>
                {manageSection === 'settings' && (
                  <div className="manageSettingsNav" aria-label="设置分类">
                    <span>设置分类</span>
                    {SETTINGS_TABS.map((tab) => {
                      const Icon = tab.icon
                      return (
                        <button
                          key={tab.key}
                          className={settingsTab === tab.key ? 'active' : ''}
                          onClick={() => setSettingsTab(tab.key)}
                        >
                          <Icon size={17} />
                          <span>{tab.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className="manageIndexStatus">
                  <ArchiveIcon size={18} />
                  <strong>索引状态</strong>
                  <p>{selectedSource?.name ?? '暂无录像源'} · {currentSourceSegmentCount} 个片段</p>
                  <div><span style={{ width: `${Math.min(100, currentSourceSegmentCount)}%` }} /></div>
                  <button onClick={() => { setManageSection('settings'); setSettingsTab('overview') }}>查看系统状态</button>
                </div>
              </aside>
              <section className="fullManageContent">
                {manageSection === 'sources' && (
                  <SourceStage
                    sources={sources}
                    segments={allSegments}
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
                    onRecognitionChange={(id, payload) => updateSourceMutation.mutate({ id, ...payload })}
                    onSave={(id, payload) => updateSourceMutation.mutate({ id, ...payload })}
                    onDelete={(id) => deleteSourceMutation.mutate(id)}
                  />
                )}
                {manageSection === 'logs' && (
                  <LogsStage
                    sources={sources}
                    segments={allSegments}
                    scanJobs={scanJobs}
                    exports={exports}
                    failedSegments={failedSegments}
                    onRefresh={() => void refreshAll()}
                    busy={busy}
                  />
                )}
                {manageSection === 'settings' && (
                  <SettingsPage
                    sources={sources}
                    status={systemStatus}
                    onRefresh={() => void refreshAll()}
                    busy={busy}
                    activeTab={settingsTab}
                    onTabChange={setSettingsTab}
                    onOpenSources={() => setManageSection('sources')}
                    embedded
                  />
                )}
              </section>
            </div>
          ) : activeView === 'tasks' ? (
            <TaskCenterView
              exports={exports}
              exportError={exportsQuery.error}
              segments={allSegments}
              sourceNames={sourceNames}
              onNotify={notify}
              onSelectSegment={(segment) => {
                selectSegment(segment, true)
                setActiveView('playback')
              }}
            />
          ) : activeView === 'clips' ? (
            <ClipLibraryView
              segments={allSegments}
              sourceNames={sourceNames}
              selectedId={selectedSegment?.id}
              onOpenPlayback={(segment) => {
                selectSegment(segment, true)
                setActiveView('playback')
              }}
              onExportSegments={(segments) => {
                if (!segments.length) return
                const sourceIds = new Set(segments.map((segment) => segment.sourceId))
                if (sourceIds.size > 1) {
                  notify('合并导出仅支持同一录像源，请调整选择')
                  return
                }
                const orderedSelection = [...segments].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                const first = orderedSelection[0]
                const last = orderedSelection[orderedSelection.length - 1]
                selectSegment(first)
                setManageRangeStart(new Date(first.startTime).getTime())
                setManageRangeEnd(new Date(last.endTime).getTime())
                setManagePanelOpen(true)
                setActiveView('playback')
              }}
              onNotify={notify}
            />
          ) : (
            <div className="redesignPlaybackPage">
              <aside className="playbackSourceContext">
                <div className="playbackContextEyebrow">回看上下文</div>
                <h1>录像源</h1>
                <label className="playbackSourceSelect">
                  <span>当前录像源</span>
                  <select value={sourceId} onChange={(event) => handleSourceChange(event.target.value)}>
                    <option value="">选择录像源</option>
                    {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                  </select>
                </label>
                <div className="playbackSourceCard">
                  <div className="playbackSourceStatus">
                    <strong>{selectedSource?.name ?? '暂无录像源'}</strong>
                    <small>{selectedSource?.enabled ? '已启用' : '未连接'}</small>
                  </div>
                  <p>{selectedSource?.path ?? '请在管理中添加录像目录'}</p>
                  <dl>
                    <div><dt>录像片段</dt><dd>{currentSourceSegmentCount} 个片段</dd></div>
                    <div><dt>最近扫描</dt><dd>{selectedSource?.lastScanAt ? formatClipDateTime(selectedSource.lastScanAt) : '尚未扫描'}</dd></div>
                  </dl>
                </div>
                <div className="playbackContextBlock playbackDateBlock">
                  <span>日期</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(event) => setPlaybackWindow(event.target.value, playbackHour)}
                  />
                </div>
                <label className="playbackContextBlock playbackRangeBlock">
                  <span>显示范围</span>
                  <select value={playbackHour} onChange={(event) => setPlaybackWindow(date, Number(event.target.value))}>
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00 – {String((hour + 1) % 24).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                </label>
                {(selectedSource?.failedCount ?? 0) > 0 && <p className="playbackContextAlert" role="status">当前录像源有 {selectedSource?.failedCount} 个扫描失败文件，可在活动日志查看原因。</p>}
                <button className="playbackScanButton" type="button" onClick={handleScan} disabled={!sourceId || scanMutation.isPending}>
                  <RefreshCw size={17} className={scanMutation.isPending ? 'spinning' : ''} />
                  {scanMutation.isPending ? '扫描中…' : '立即扫描'}
                </button>
                <p className="playbackContextNote"><Activity size={15} />录像源是已连接的摄像目录。扫描只建立索引，不修改源文件。</p>
                <button className="playbackManageLink" type="button" onClick={() => { setManageSection('sources'); setActiveView('manage') }}>
                  管理录像源
                </button>
              </aside>

              <section className="playbackWorkspace">
                <div className="playbackViewerShell">
                  <div className="playbackViewerHeader">
                    <div>
                      <span>正在回看</span>
                      <strong>{selectedSource?.name ?? '选择录像源'}</strong>
                    </div>
                    <div>
                      <button aria-label="刷新回看数据" title="刷新" onClick={() => void refreshAll()}><RefreshCw size={17} /></button>
                      <button
                        aria-label="导出当前片段"
                        title="导出"
                        onClick={() => {
                          if (!selectedSegment) return
                          setManageRangeStart(new Date(selectedSegment.startTime).getTime())
                          setManageRangeEnd(new Date(selectedSegment.endTime).getTime())
                          setManagePanelOpen(true)
                        }}
                        disabled={!selectedSegment || exportMutation.isPending}
                      ><Download size={17} /></button>
                      <button aria-label="识别当前片段字幕" title="语音识别" disabled={!selectedSegment} onClick={() => {
                        if (!selectedSegment) return
                        api.triggerTranscription(selectedSegment.id).then(() => notify('语音识别任务已创建')).catch((error) => notify(queryMessage(error, '创建识别任务失败')))
                      }}><Mic size={17} /></button>
                    </div>
                  </div>
                  <div className="prototypeViewer">
                    {selectedSegment ? (
                      <>
                        <video
                          key={selectedSegment.id}
                          ref={videoRef}
                          className="viewerVideo"
                          src={`/api/segments/${selectedSegment.id}/stream`}
                          poster={selectedSegment.thumbnailUrl ?? undefined}
                          aria-label={`${sourceNames.get(selectedSegment.sourceId) ?? '录像源'}录像回放`}
                          onClick={togglePlayback}
                          onLoadStart={() => setVideoState('loading')}
                          onLoadedMetadata={() => {
                            const pendingSeek = pendingSeekSecondsRef.current
                            if (videoRef.current && pendingSeek !== null) videoRef.current.currentTime = pendingSeek
                            pendingSeekSecondsRef.current = null
                            syncPlaybackTime()
                          }}
                          onCanPlay={() => setVideoState('ready')}
                          onWaiting={() => setVideoState('loading')}
                          onError={() => { setVideoState('error'); setIsPlaying(false); setAutoPlayNext(false) }}
                          onTimeUpdate={() => {
                            syncPlaybackTime()
                            if (videoRef.current) setCurrentPlaybackTime(videoRef.current.currentTime)
                          }}
                          onSeeking={syncPlaybackTime}
                          onEnded={handleSegmentEnded}
                          onPlay={() => { setIsPlaying(true); setAutoPlayNext(true) }}
                          onPause={() => { setIsPlaying(false); setAutoPlayNext(false) }}
                        />
                        {subtitleMode === 'overlay' && currentTranscriptions.length > 0 && (
                          <SubtitleOverlay transcriptions={currentTranscriptions} currentTime={currentPlaybackTime} />
                        )}
                        <div className="prototypeViewerMeta">
                          <span className="liveDot" />
                          <strong>{sourceNames.get(selectedSegment.sourceId) ?? selectedSource?.name ?? '录像源'}</strong>
                          <span>{formatTime(selectedSegment.startTime)}</span>
                        </div>
                        {videoState === 'loading' && <div className="prototypeVideoState" aria-live="polite"><RefreshCw size={25} className="spinning" /><strong>正在加载录像</strong></div>}
                        {videoState === 'error' && <div className="prototypeVideoState error" role="alert"><VideoCamera size={30} /><strong>录像无法播放</strong><span>文件可能损坏或浏览器不支持该编码。</span></div>}
                        <div className="prototypePlayerControls">
                          <button type="button" className="mainPlay" aria-label={isPlaying ? '暂停' : '播放'} onClick={togglePlayback}>{isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
                          <button type="button" className="skipControl" aria-label="后退 10 秒" onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10) }}>−10</button>
                          <button type="button" className="skipControl" aria-label="前进 10 秒" onClick={() => { if (videoRef.current) videoRef.current.currentTime += 10 }}>+10</button>
                          <time>{formatTime(new Date(playbackTimeMs ?? new Date(selectedSegment.startTime).getTime()).toISOString())}<small> / {formatTime(selectedSegment.endTime)}</small></time>
                          <div className="prototypeProgress" role="progressbar" aria-label="播放进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, Math.max(0, (currentPlaybackTime / Math.max(1, selectedSegment.durationSeconds)) * 100)))}><span style={{ width: `${Math.min(100, Math.max(0, (currentPlaybackTime / Math.max(1, selectedSegment.durationSeconds)) * 100))}%` }} /></div>
                          <button type="button" className="playerRate" aria-label="切换播放速度" onClick={() => {
                            const currentIndex = playbackRates.indexOf(playbackRate)
                            handlePlaybackRateChange(playbackRates[(currentIndex + 1) % playbackRates.length] ?? 1)
                          }}>{playbackRate.toFixed(1)}x</button>
                          <button type="button" aria-label="切换字幕显示" onClick={() => setSubtitleMode((mode) => mode === 'overlay' ? 'list' : 'overlay')}><SlidersHorizontal size={16} /></button>
                        </div>
                      </>
                    ) : (
                      <div className={`prototypeViewerEmpty${timelineQuery.isError ? ' error' : ''}`} role={timelineQuery.isError ? 'alert' : 'status'}>
                        {timelineQuery.isFetching ? <RefreshCw size={36} className="spinning" /> : <VideoCamera size={42} />}
                        <strong>{timelineQuery.isFetching ? '正在加载回看数据' : timelineQuery.isError ? '回看数据加载失败' : '选择录像片段开始回看'}</strong>
                        <span>{timelineQuery.isError ? '请检查后端连接后重试刷新。' : sourceId ? '当前日期暂无可播放片段' : '请先从左侧选择录像源'}</span>
                      </div>
                    )}
                  </div>
                </div>

                <TimeRail
                    dateStart={date}
                    dateEnd={date}
                    segments={rangeSegments}
                    gaps={timeline?.gaps ?? []}
                    selectedId={selectedSegment?.id}
                    playbackTimeMs={playbackTimeMs}
                    playbackRate={playbackRate}
                    isPlaying={isPlaying}
                    onSelect={(segment) => selectSegment(segment, true)}
                    onSeek={selectSegmentAtTime}
                    onGapClick={(gap) => notify(`该时段断档 ${Math.round(gap.durationSeconds)} 秒，可选择相邻录像片段`)}
                    onPlaybackRateChange={handlePlaybackRateChange}
                    onTogglePlayback={togglePlayback}
                    manageOpen={managePanelOpen}
                    onManage={() => setManagePanelOpen(!managePanelOpen)}
                    onDateStartChange={(nextDate) => {
                      setPlaybackWindow(nextDate, playbackHour)
                    }}
                    onDateEndChange={(nextDate) => {
                      setPlaybackWindow(nextDate, playbackHour)
                    }}
                    onRangeChange={(startMs, endMs) => {
                      setManageRangeStart(startMs)
                      setManageRangeEnd(endMs)
                    }}
                    exportMode={exportMode}
                    onExportModeChange={setExportMode}
                    windowStartMs={playbackWindowStartMs}
                    windowEndMs={playbackWindowEndMs}
                  />

                  {managePanelOpen && (
                    <div className="playbackManageOverlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setManagePanelOpen(false) }}>
                      <ManagePanel
                        segments={rangeSegments}
                        sources={sources}
                        selectedSourceId={sourceId}
                        currentTimeMs={playbackTimeMs}
                        externalRangeStart={manageRangeStart}
                        externalRangeEnd={manageRangeEnd}
                        onClose={() => { setManagePanelOpen(false); setManageRangeStart(null); setManageRangeEnd(null) }}
                        onExport={async (startTime, endTime, mode) => {
                          await exportMutation.mutateAsync({ sourceId: selectedSegment?.sourceId ?? sourceId, startTime, endTime, mode })
                        }}
                        onViewTasks={() => { setManagePanelOpen(false); setActiveView('tasks') }}
                      />
                    </div>
                  )}

                <PlaybackClipStrip
                  segments={rangeSegments}
                  selectedId={selectedSegment?.id}
                  sourceNames={sourceNames}
                  transcriptionStatuses={transcriptionStatusBySegment}
                  onSelect={(segment) => selectSegment(segment, true)}
                  onTranscribe={(segmentId) => api.triggerTranscription(segmentId).then(() => notify('语音识别任务已创建')).catch((error) => notify(queryMessage(error, '创建识别任务失败')))}
                  onExportRange={(segment) => {
                    selectSegment(segment)
                    setManageRangeStart(new Date(segment.startTime).getTime())
                    setManageRangeEnd(new Date(segment.endTime).getTime())
                    setManagePanelOpen(true)
                  }}
                  onOpenLibrary={() => setActiveView('clips')}
                />

                {selectedSegment && (
                  <details className="playbackTranscriptDetails">
                    <summary>字幕与识别结果</summary>
                    <TranscriptionPanel
                      segmentId={selectedSegment.id}
                      transcriptions={currentTranscriptions}
                      currentTime={currentPlaybackTime}
                      mode={subtitleMode}
                      onModeChange={setSubtitleMode}
                      onSelect={(time) => { if (videoRef.current) videoRef.current.currentTime = time }}
                      onExportSrt={() => handleExportSrt(selectedSegment.id)}
                      onExportTxt={() => handleExportTxt(selectedSegment.id)}
                      onNotify={notify}
                    />
                  </details>
                )}
              </section>
            </div>
          )}
        </main>
      </div>

      <Toast.Root className="toastRoot" open={toastOpen} onOpenChange={setToastOpen}>
        <Toast.Description aria-live="polite">{message}</Toast.Description>
        {toastDownloadUrl && (
          <Toast.Action asChild altText="下载导出文件">
            <a className="toastAction" href={toastDownloadUrl}>
              下载
            </a>
          </Toast.Action>
        )}
      </Toast.Root>
      {previewSegment && (
        <div className="modalBackdrop clipPreviewBackdrop" role="presentation" onClick={() => setPreviewSegment(null)}>
          <div ref={previewDialogRef} className="clipPreviewModal" role="dialog" aria-modal="true" aria-label="片段预览" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
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
                <button aria-label="关闭片段预览" title="关闭" onClick={() => setPreviewSegment(null)}>
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="clipPreviewBody">
              <video
                key={previewSegment.id}
                className="clipPreviewVideo"
                src={`/api/segments/${previewSegment.id}/stream`}
                aria-label="片段预览视频"
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
