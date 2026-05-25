import * as Select from '@radix-ui/react-select'
import * as Switch from '@radix-ui/react-switch'
import * as Toast from '@radix-ui/react-toast'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  Download,
  FolderOpen,
  FolderPlus,
  Grid3X3,
  History,
  LayoutDashboard,
  Pencil,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Settings,
  Unlink,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import type { DirectoryNode, ExportJob, ScanJob, Segment, Source, SystemStatus, TimelineSegment } from './types'

const today = new Date().toISOString().slice(0, 10)
type ViewKey = 'playback' | 'clips' | 'sources' | 'exports' | 'logs' | 'settings'
type DisplaySegment = TimelineSegment & { sourceId: string; filename?: string }
const playbackRates = [1, 1.5, 2, 4]
const selectedSourceStorageKey = 'clipline.selectedSourceId'

const navItems: Array<{ key: ViewKey; label: string; icon: typeof Play }> = [
  { key: 'playback', label: '录像回放', icon: Play },
  { key: 'clips', label: '片段墙', icon: Grid3X3 },
  { key: 'sources', label: '录像源', icon: Camera },
  { key: 'exports', label: '导出任务', icon: Download },
  { key: 'logs', label: '日志', icon: History },
  { key: 'settings', label: '设置', icon: Settings },
]

const viewTitles: Record<ViewKey, string> = {
  playback: '录像回放',
  clips: '片段墙',
  sources: '录像源',
  exports: '导出任务',
  logs: '日志',
  settings: '设置',
}

function toLocalInputValue(value: string) {
  return toLocalDateTimePrecise(new Date(value))
}

function toIsoWithOffset(value: string) {
  const date = new Date(value)
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const hours = String(Math.floor(abs / 60)).padStart(2, '0')
  const minutes = String(abs % 60).padStart(2, '0')
  const hasSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
  const localValue = hasSeconds ? value : `${value}:00`
  return `${localValue}${sign}${hours}:${minutes}`
}

function formatTime(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function toLocalDateTimeInput(dateValue: Date) {
  const offsetMs = dateValue.getTimezoneOffset() * 60_000
  return new Date(dateValue.getTime() - offsetMs).toISOString().slice(0, 16)
}

function toLocalDateTimePrecise(dateValue: Date) {
  const offsetMs = dateValue.getTimezoneOffset() * 60_000
  return new Date(dateValue.getTime() - offsetMs).toISOString().slice(0, 23)
}

function getDefaultRange(days = 7) {
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - days + 1)
  start.setHours(0, 0, 0, 0)
  return {
    start: toLocalDateTimeInput(start),
    end: toLocalDateTimeInput(end),
  }
}

function formatRangeLabel(start: string, end: string) {
  if (!start && !end) return '全部时间'
  const startLabel = start ? formatClipDateTime(toIsoWithOffset(start)) : '开始'
  const endLabel = end ? formatClipDateTime(toIsoWithOffset(end)) : '现在'
  return `${startLabel} - ${endLabel}`
}

function formatClipDateTime(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function segmentDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : today
}

function toDisplaySegment(segment: Segment): DisplaySegment | null {
  if (!segment.startTime || !segment.endTime) return null
  return {
    id: segment.id,
    sourceId: segment.sourceId,
    filename: segment.filename,
    startTime: segment.startTime,
    endTime: segment.endTime,
    durationSeconds: segment.durationSeconds ?? 0,
    playable: segment.playable,
    needsTranscode: segment.needsTranscode,
    thumbnailUrl: segment.thumbnailUrl ?? null,
  }
}

function formatBytes(value?: number | null) {
  if (!value) return '-'
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatPlaybackRate(value: number) {
  return `${value.toFixed(1)}x`
}

function queryMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function App() {
  const queryClient = useQueryClient()
  const videoRef = useRef<HTMLVideoElement | null>(null)
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
  const segmentPageSize = 1000
  const showFilterPane = activeView === 'playback' || activeView === 'clips'

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

  function handleCreateSource() {
    if (!sourceName.trim() || !sourcePath.trim()) return
    createSourceMutation.mutate({
      name: sourceName.trim(),
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

  function applyClipRange(days: number) {
    const nextRange = getDefaultRange(days)
    setClipRangeStart(nextRange.start)
    setClipRangeEnd(nextRange.end)
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

  const filterPane = showFilterPane ? (
    <aside className="controlPane">
      <div className="filterTitle">浏览范围</div>
      <div className="filterSectionLabel">片段时间</div>
      <div className="rangeFields unifiedRange">
        <label>
          <span>开始</span>
          <input type="datetime-local" value={clipRangeStart} onChange={(event) => setClipRangeStart(event.target.value)} />
        </label>
        <label>
          <span>结束</span>
          <input type="datetime-local" value={clipRangeEnd} onChange={(event) => setClipRangeEnd(event.target.value)} />
        </label>
      </div>
      <div className="quickDates">
        {[
          ['今天', 1],
          ['近 7 天', 7],
          ['近 30 天', 30],
        ].map(([label, days]) => (
          <button
            key={label}
            onClick={() => applyClipRange(Number(days))}
          >
            {label}
          </button>
        ))}
        <button onClick={() => {
          setClipRangeStart('')
          setClipRangeEnd('')
        }}>
          清除范围
        </button>
      </div>
      <div className="filterDivider" />
      <div className="filterSectionLabel">当前源</div>
      <div className="filterMeta">
        <strong>{selectedSource?.name ?? '请选择源'}</strong>
        <small>{rangeSegments.length} 个片段</small>
      </div>
      <div className="filterCount">
        <strong>{rangeSegments.length}</strong>
        <span>当前片段</span>
      </div>
    </aside>
  ) : null

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
            />
          ) : activeView === 'settings' ? (
            <SettingsStage
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
          ) : activeView === 'clips' ? (
            <div className="workbenchLayout">
              {filterPane}
              <div className="workbenchContent">
                <section className="clipDock fullDock">
                  <div className="dockHead">
                    <div>
                      <div className="dockTitle">全部片段</div>
                      <div className="dockMeta">按最新录像排序</div>
                    </div>
                    {failedSegments.length > 0 && <FailurePill segments={failedSegments} />}
                  </div>
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
                  />
                </section>
              </div>
            </div>
          ) : (
            <div className="workbenchLayout">
              {filterPane}
              <div className="workbenchContent">
                <section className="viewerBand">
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
                          onTimeUpdate={syncPlaybackTime}
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
                        </div>
                      </>
                    ) : (
                      <div className="viewerEmpty">选择片段</div>
                    )}
                  </div>
                  <TimeRail
                    date={`${clipRangeStart}-${clipRangeEnd}`}
                    segments={rangeSegments}
                    selectedId={selectedSegment?.id}
                    playbackTimeMs={playbackTimeMs}
                    playbackRate={playbackRate}
                    isPlaying={isPlaying}
                    exportStart={exportStart}
                    exportEnd={exportEnd}
                    exportRangeVisible={exportRangeVisible}
                    exportMode={exportMode}
                    exportStatus={latestExport ? `${latestExport.status} · ${formatBytes(latestExport.outputSizeBytes)}` : ''}
                    exporting={exportMutation.isPending}
                    onSelect={(segment) => selectSegment(segment, true)}
                    onPlaybackRateChange={handlePlaybackRateChange}
                    onTogglePlayback={togglePlayback}
                    onExportRangeChange={(start, end) => {
                      setExportStart(start)
                      setExportEnd(end)
                      setExportRangeVisible(true)
                    }}
                    onExportRangeActivate={() => {
                      showExportRange()
                    }}
                    onExportModeChange={setExportMode}
                    onExport={handleExport}
                  />
                </section>

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
                  />
                </section>
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

function SourceStage({
  sources,
  selectedId,
  directories,
  directoryRoot,
  sourceName,
  sourcePath,
  sourceScanInterval,
  scanJobs,
  creating,
  scanning,
  onSelect,
  onScan,
  onCreate,
  onNameChange,
  onPathChange,
  onIntervalChange,
  onToggle,
  onScheduleChange,
  onSave,
}: {
  sources: Source[]
  selectedId: string
  directories: DirectoryNode[]
  directoryRoot: string
  sourceName: string
  sourcePath: string
  sourceScanInterval: number
  scanJobs: ScanJob[]
  creating: boolean
  scanning: boolean
  onSelect: (id: string) => void
  onScan: (id: string) => void
  onCreate: () => void
  onNameChange: (value: string) => void
  onPathChange: (value: string) => void
  onIntervalChange: (value: number) => void
  onToggle: (id: string, enabled: boolean) => void
  onScheduleChange: (id: string, minutes: number) => void
  onSave: (id: string, payload: { name: string; path: string }) => void
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [editName, setEditName] = useState('')
  const [editPath, setEditPath] = useState('')
  const latestJobBySource = useMemo(() => {
    const map = new Map<string, ScanJob>()
    scanJobs.forEach((job) => {
      if (job.sourceId && !map.has(job.sourceId)) map.set(job.sourceId, job)
    })
    return map
  }, [scanJobs])

  function startEdit(source: Source) {
    setEditingId(source.id)
    setEditName(source.name)
    setEditPath(source.path)
    onSelect(source.id)
  }

  function cancelEdit() {
    setEditingId('')
    setEditName('')
    setEditPath('')
  }

  function saveEdit(source: Source) {
    const name = editName.trim()
    const path = editPath.trim()
    if (!name || !path) return
    onSave(source.id, { name, path })
    cancelEdit()
  }

  function submitCreate() {
    onCreate()
    setCreateOpen(false)
  }

  return (
    <section className="modulePanel">
      <div className="moduleHead">
        <div>
          <div className="moduleTitle">录像源</div>
          <div className="moduleMeta">管理视频目录、扫描状态和自动扫描策略。</div>
        </div>
        <button className="blueAction moduleAction" onClick={() => setCreateOpen((open) => !open)}>
          <FolderPlus size={16} />
          添加录像源
        </button>
      </div>

      {createOpen && (
        <div className="sourceCreateBox">
          <div className="sourceCreateTitle">
            <strong>新增录像源</strong>
            <span>选择一个目录后，系统会扫描其中的视频文件。</span>
          </div>
          <div className="sourceCreateForm">
            <input className="field" placeholder="源名称，例如 车载记录仪" value={sourceName} onChange={(event) => onNameChange(event.target.value)} />
            <PathPicker value={sourcePath} root={directoryRoot} nodes={directories} onChange={onPathChange} />
            <select value={sourceScanInterval} onChange={(event) => onIntervalChange(Number(event.target.value))}>
              <option value={0}>关闭定时扫描</option>
              <option value={5}>每 5 分钟扫描</option>
              <option value={15}>每 15 分钟扫描</option>
              <option value={30}>每 30 分钟扫描</option>
              <option value={60}>每 1 小时扫描</option>
            </select>
            <div className="sourceCreateActions">
              <button className="ghostAction" onClick={() => setCreateOpen(false)}>取消</button>
              <button className="blueAction" onClick={submitCreate} disabled={creating}>
                <FolderPlus size={16} />
                创建并扫描
              </button>
            </div>
          </div>
        </div>
      )}

      {sources.length ? (
        <div className="sourceTable">
          <div className="sourceTableHead">
            <span>源</span>
            <span>统计</span>
            <span>状态</span>
            <span>定时扫描</span>
            <span>扫描进度</span>
            <span>操作</span>
          </div>
          {sources.map((source) => {
            const editing = editingId === source.id
            const scanJob = latestJobBySource.get(source.id)
            return (
              <div className={source.id === selectedId ? 'sourceRow selected' : 'sourceRow'} key={source.id}>
                <div className="sourceIdentity">
                  <button className="sourceCardIcon" onClick={() => onSelect(source.id)}>
                    <Camera size={20} />
                  </button>
                  {editing ? (
                    <div className="sourceEditFields">
                      <input className="field" value={editName} onChange={(event) => setEditName(event.target.value)} />
                      <PathPicker value={editPath} root={directoryRoot} nodes={directories} onChange={setEditPath} />
                    </div>
                  ) : (
                    <button className="sourceCardBody" onClick={() => onSelect(source.id)}>
                      <strong>{source.name}</strong>
                      <small>{source.path}</small>
                    </button>
                  )}
                </div>
                <div className="sourceStats">
                  <strong>{source.segmentCount}</strong>
                  <span>{source.failedCount} 错误</span>
                </div>
                <label className="sourceStatusControl">
                  <Switch.Root className="switchRoot" checked={source.enabled} onCheckedChange={(enabled) => onToggle(source.id, enabled)}>
                    <Switch.Thumb className="switchThumb" />
                  </Switch.Root>
                  <span>{source.enabled ? '启用' : '停用'}</span>
                </label>
                <select
                  className="sourceScheduleSelect"
                  value={source.scanIntervalMinutes}
                  onChange={(event) => onScheduleChange(source.id, Number(event.target.value))}
                >
                  <option value={0}>关闭</option>
                  <option value={5}>5 分钟</option>
                  <option value={15}>15 分钟</option>
                  <option value={30}>30 分钟</option>
                  <option value={60}>1 小时</option>
                </select>
                <ScanProgress job={scanJob} />
                <div className="sourceActions">
                  {editing ? (
                    <>
                      <button className="iconAction primary" title="保存" onClick={() => saveEdit(source)}>
                        <Check size={15} />
                      </button>
                      <button className="iconAction" title="取消" onClick={cancelEdit}>
                        <X size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="iconAction" title="编辑" onClick={() => startEdit(source)}>
                        <Pencil size={15} />
                      </button>
                      <button className="iconAction primary" title="扫描" onClick={() => onScan(source.id)} disabled={scanning}>
                        <RefreshCw size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="moduleEmpty">新建一个源后，这里会显示摄像头列表。</div>
      )}
    </section>
  )
}

function SettingsStage({
  sources,
  status,
  onRefresh,
  busy,
}: {
  sources: Source[]
  status: SystemStatus | null
  onRefresh: () => void
  busy: boolean
}) {
  return (
    <section className="modulePanel">
      <div className="moduleHead">
        <div>
          <div className="moduleTitle">系统设置</div>
          <div className="moduleMeta">运行环境、存储路径和后端能力。</div>
        </div>
        <button className="refreshButton" onClick={onRefresh}>
          <RefreshCw size={18} className={busy ? 'spin' : ''} />
        </button>
      </div>

      <div className="settingsGrid">
        <div className="settingsCard">
          <LayoutDashboard size={20} />
          <strong>{status?.version ?? '-'}</strong>
          <span>版本</span>
        </div>
        <div className="settingsCard">
          <Check size={20} />
          <strong>{status?.ffmpeg.available ? '可用' : '不可用'}</strong>
          <span>FFmpeg</span>
        </div>
        <div className="settingsCard">
          <Check size={20} />
          <strong>{status?.ffprobe.available ? '可用' : '不可用'}</strong>
          <span>FFprobe</span>
        </div>
        <div className="settingsCard">
          <Camera size={20} />
          <strong>{sources.length}</strong>
          <span>录像源</span>
        </div>
      </div>

      <div className="settingsSections">
        <div className="settingsSection">
          <div className="settingsSectionTitle">路径</div>
          <div className="settingsKV">
            <span>数据库</span>
            <strong>{status?.database.path ?? '-'}</strong>
          </div>
          <div className="settingsKV">
            <span>日志文件</span>
            <strong>{status?.logging.file ?? '-'}</strong>
          </div>
          <div className="settingsKV">
            <span>默认浏览根</span>
            <strong>/</strong>
          </div>
        </div>
        <div className="settingsSection">
          <div className="settingsSectionTitle">运行配置</div>
          <div className="settingsKV">
            <span>日志级别</span>
            <strong>{status?.logging.level ?? '-'}</strong>
          </div>
          <div className="settingsKV">
            <span>日志格式</span>
            <strong>{status?.logging.format ?? '-'}</strong>
          </div>
          <div className="settingsKV">
            <span>导出缓存</span>
            <strong>{formatBytes(status?.cache.exportBytes)}</strong>
          </div>
        </div>
      </div>
    </section>
  )
}

function ExportStage({
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

function LogsStage({
  sources,
  scanJobs,
  exports,
  failedSegments,
  onRefresh,
  busy,
}: {
  sources: Source[]
  scanJobs: ScanJob[]
  exports: ExportJob[]
  failedSegments: Segment[]
  onRefresh: () => void
  busy: boolean
}) {
  type LogKind = 'all' | 'scan' | 'scheduledScan' | 'manualScan' | 'export' | 'error' | 'login' | 'sourceChange'
  const sourceNames = new Map(sources.map((source) => [source.id, source.name]))
  const [logKind, setLogKind] = useState<LogKind>('all')
  const scanRows = scanJobs.map((job) => {
    const scheduled = job.trigger === 'scheduled'
    return {
      id: job.id,
      category: scheduled ? 'scheduledScan' as const : 'manualScan' as const,
      type: scheduled ? '定时' : '手动',
      time: job.finishedAt ?? job.startedAt ?? job.createdAt,
      title: `${sourceNames.get(job.sourceId ?? '') ?? '全部源'} · ${scheduled ? '定时扫描' : '手动扫描'} · ${scanStatusLabel(job.status)}`,
      detail: `${job.scannedFiles}/${job.totalFiles || '-'} 文件 · ${job.indexedFiles} 入库 · ${job.failedFiles} 错误`,
      status: job.status,
      statusLabel: scanStatusLabel(job.status),
    }
  })
  const exportRows = exports.slice(0, 8).map((job) => ({
    id: job.id,
    category: 'export' as const,
    type: '导出',
    time: job.updatedAt ?? job.createdAt,
    title: `${job.sourceName ?? sourceNames.get(job.sourceId) ?? '录像源'} · ${job.mode === 'fast' ? '快速' : '精准'}`,
    detail: `${formatClipDateTime(job.startTime)} - ${formatClipDateTime(job.endTime)} · ${formatBytes(job.outputSizeBytes)}`,
    status: job.status,
    statusLabel: exportStatusLabel(job.status),
  }))
  const errorRows = failedSegments.slice(0, 8).map((segment) => ({
    id: segment.id,
    category: 'error' as const,
    type: '错误',
    time: segment.startTime ?? '',
    title: `${sourceNames.get(segment.sourceId) ?? '录像源'} · ${segment.filename}`,
    detail: segment.errorMessage ?? '扫描失败',
    status: segment.scanStatus,
    statusLabel: scanStatusLabel(segment.scanStatus),
  }))
  const allRows = [...scanRows, ...exportRows, ...errorRows]
  const logCounts: Record<LogKind, number> = {
    all: allRows.length,
    scan: scanRows.length,
    scheduledScan: scanRows.filter((row) => row.category === 'scheduledScan').length,
    manualScan: scanRows.filter((row) => row.category === 'manualScan').length,
    export: exportRows.length,
    error: errorRows.length,
    login: 0,
    sourceChange: 0,
  }
  const logFilters: Array<{ key: LogKind; label: string }> = [
    { key: 'all', label: '全部日志' },
    { key: 'scheduledScan', label: '定时扫描' },
    { key: 'manualScan', label: '手动扫描' },
    { key: 'export', label: '导出任务' },
    { key: 'error', label: '错误日志' },
    { key: 'login', label: '登录日志' },
    { key: 'sourceChange', label: '源配置变更' },
  ]
  const activeLogLabel = logFilters.find((filter) => filter.key === logKind)?.label ?? '日志'
  const rows = allRows
    .filter((row) => {
      if (logKind === 'all') return true
      if (logKind === 'scan') return row.category === 'scheduledScan' || row.category === 'manualScan'
      return row.category === logKind
    })
    .sort((left, right) => new Date(right.time || 0).getTime() - new Date(left.time || 0).getTime())

  return (
    <section className="modulePanel">
      <div className="moduleHead">
        <div>
          <div className="moduleTitle">日志</div>
          <div className="moduleMeta">扫描、导出、错误和后续登录审计都会集中到这里。</div>
        </div>
        <button className="refreshButton" onClick={onRefresh}>
          <RefreshCw size={18} className={busy ? 'spin' : ''} />
        </button>
      </div>

      <div className="logSummaryGrid">
        <button className={logKind === 'scan' ? 'settingsCard logMetricButton active' : 'settingsCard logMetricButton'} onClick={() => setLogKind('scan')}>
          <Activity size={20} />
          <strong>{scanJobs.length}</strong>
          <span>扫描日志</span>
        </button>
        <button className={logKind === 'export' ? 'settingsCard logMetricButton active' : 'settingsCard logMetricButton'} onClick={() => setLogKind('export')}>
          <Download size={20} />
          <strong>{exports.length}</strong>
          <span>导出日志</span>
        </button>
        <button className={logKind === 'error' ? 'settingsCard warning logMetricButton active' : 'settingsCard warning logMetricButton'} onClick={() => setLogKind('error')}>
          <AlertTriangle size={20} />
          <strong>{failedSegments.length}</strong>
          <span>错误日志</span>
        </button>
        <button className={logKind === 'login' ? 'settingsCard logMetricButton active' : 'settingsCard logMetricButton'} onClick={() => setLogKind('login')}>
          <History size={20} />
          <strong>{logCounts.login}</strong>
          <span>登录日志</span>
        </button>
      </div>

      <div className="logLayout">
        <aside className="logKinds">
          {logFilters.map((filter) => (
            <button className={logKind === filter.key ? 'active' : ''} key={filter.key} onClick={() => setLogKind(filter.key)}>
              <span>{filter.label}</span>
              <small>{logCounts[filter.key]}</small>
            </button>
          ))}
        </aside>
        <div className="logTable">
          <div className="logTableHead">
            <span>类型</span>
            <span>时间</span>
            <span>事件</span>
            <span>状态</span>
          </div>
          {rows.length ? rows.map((row) => (
            <div className="logRow" key={`${row.type}-${row.id}`}>
              <span className={`logType ${row.type === '错误' ? 'warning' : ''}`}>{row.type}</span>
              <span>{row.time ? formatClipDateTime(row.time) : '-'}</span>
              <span>
                <strong>{row.title}</strong>
                <small>{row.detail}</small>
              </span>
              <span>{row.statusLabel}</span>
            </div>
          )) : (
            <div className="moduleEmpty">暂无{activeLogLabel}</div>
          )}
        </div>
      </div>
    </section>
  )
}

function SourceSelect({
  sources,
  value,
  onChange,
}: {
  sources: Source[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Select.Root value={value || undefined} onValueChange={onChange} disabled={!sources.length}>
      <Select.Trigger className="selectTrigger" aria-label="选择源">
        <Camera size={16} />
        <Select.Value placeholder="选择源" />
        <Select.Icon className="selectIcon">
          <ChevronDown size={16} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="selectContent" position="popper" sideOffset={6}>
          <Select.Viewport>
            {sources.map((source) => (
              <Select.Item className="selectItem" key={source.id} value={source.id}>
                <Select.ItemText>{source.name}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}

function scanStatusLabel(status?: string) {
  if (!status) return '未扫描'
  if (status === 'queued') return '排队中'
  if (status === 'running') return '扫描中'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  return status
}

function exportStatusLabel(status?: string) {
  if (!status) return '未开始'
  if (status === 'queued') return '排队中'
  if (status === 'running') return '导出中'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'canceled') return '已取消'
  if (status === 'expired') return '已过期'
  return status
}

function exportProgressPercent(job: ExportJob) {
  if (job.status === 'completed') return 100
  const progress = Number.isFinite(job.progress) ? job.progress : 0
  return Math.max(0, Math.min(100, Math.round(progress * 100)))
}

function formatDuration(seconds?: number | null) {
  const total = Math.max(0, Math.round(seconds ?? 0))
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  const remainingSeconds = total % 60
  if (minutes < 60) return remainingSeconds ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`
}

function ScanProgress({ job }: { job?: ScanJob }) {
  if (!job) {
    return (
      <div className="scanProgress idle">
        <span>未扫描</span>
        <div className="progressTrack">
          <i style={{ width: '0%' }} />
        </div>
      </div>
    )
  }
  const total = job.totalFiles || job.scannedFiles || 0
  const progress = total > 0 ? Math.min(100, Math.round((job.scannedFiles / total) * 100)) : job.status === 'completed' ? 100 : 0
  return (
    <div className={`scanProgress ${job.status}`}>
      <span>
        {scanStatusLabel(job.status)} · {job.scannedFiles}/{total || '-'}
      </span>
      <div className="progressTrack">
        <i style={{ width: `${progress}%` }} />
      </div>
      <small>{job.indexedFiles} 入库 · {job.failedFiles} 错误</small>
    </div>
  )
}

function SourceSummary({
  source,
  latestScan,
  failedCount,
  scanning,
  onScan,
  onToggle,
}: {
  source: Source
  latestScan?: ScanJob
  failedCount: number
  scanning: boolean
  onScan: () => void
  onToggle: (enabled: boolean) => void
}) {
  return (
    <div className="sourceSummary">
      <div className="sourcePath">{source.path}</div>
      <div className="metricGrid">
        <span>{source.segmentCount} 片段</span>
        <span>{source.failedCount || failedCount} 错误</span>
      </div>
      <div className="muted">
        定时扫描：{source.scanIntervalMinutes > 0 ? `${source.scanIntervalMinutes} 分钟` : '关闭'}
      </div>
      <div className="switchLine">
        <span>启用</span>
        <Switch.Root className="switchRoot" checked={source.enabled} onCheckedChange={onToggle}>
          <Switch.Thumb className="switchThumb" />
        </Switch.Root>
      </div>
      <div className="scanLine">
        <span>{latestScan ? `${latestScan.status} · ${formatTime(latestScan.finishedAt ?? latestScan.updatedAt)}` : '未扫描'}</span>
        <button onClick={onScan} disabled={scanning}>
          <RefreshCw size={14} />
        </button>
      </div>
    </div>
  )
}

function flattenDirectories(nodes: DirectoryNode[]): DirectoryNode[] {
  return nodes.flatMap((node) => [node, ...flattenDirectories(node.children ?? [])])
}

function PathPicker({
  value,
  root,
  nodes,
  onChange,
}: {
  value: string
  root: string
  nodes: DirectoryNode[]
  onChange: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="pathPicker">
      <input className="field" value={value} placeholder="选择 Docker 视频目录，例如 /video1" readOnly />
      <button className="pathBrowseButton" type="button" onClick={() => setOpen(true)}>
        <FolderOpen size={15} />
        选择目录
      </button>
      {open && (
        <DirectoryPickerModal
          currentValue={value}
          initialPath={root || '/'}
          root={root || '/'}
          fallbackNodes={nodes}
          onClose={() => setOpen(false)}
          onPick={(path) => {
            onChange(path)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

function DirectoryPickerModal({
  currentValue,
  initialPath,
  root,
  fallbackNodes,
  onClose,
  onPick,
}: {
  currentValue: string
  initialPath: string
  root: string
  fallbackNodes: DirectoryNode[]
  onClose: () => void
  onPick: (path: string) => void
}) {
  const [currentPath, setCurrentPath] = useState(initialPath || root)
  const directoryQuery = useQuery({
    queryKey: ['directories', currentPath],
    queryFn: () => api.directories(currentPath, 1),
    enabled: Boolean(currentPath),
  })
  const items = directoryQuery.data?.items ?? (currentPath === root ? fallbackNodes : [])
  const canGoUp = currentPath !== '/'
  const parentPath = canGoUp ? currentPath.slice(0, currentPath.lastIndexOf('/')) || '/' : '/'

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="directoryModal">
        <div className="directoryModalHead">
          <div>
            <strong>选择视频目录</strong>
            <span>容器路径：{currentPath}</span>
          </div>
          <button className="iconAction" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="directoryHint">
          这里浏览 Docker 容器文件系统。Windows 目录需要先在 compose 里挂载成容器路径，例如 `/video1`。
        </div>
        {currentValue && (
          <button className="currentPathButton" onClick={() => onPick(currentValue)}>
            当前已选：{currentValue}
          </button>
        )}
        <div className="directoryCrumbs">
          <button onClick={() => setCurrentPath('/')}>容器根 /</button>
          {canGoUp && <button onClick={() => setCurrentPath(parentPath)}>上一级</button>}
        </div>
        <div className="directoryBrowser">
          {directoryQuery.isFetching ? (
            <div className="directoryEmpty">正在读取目录...</div>
          ) : items.length ? (
            items.map((node) => (
              <button key={node.path} onClick={() => setCurrentPath(node.path)} disabled={!node.readable} title={node.path}>
                <FolderOpen size={16} />
                <span>{node.name}</span>
                <em>{node.path}</em>
                <small>{node.hasChildren ? '可展开' : '空目录'}</small>
              </button>
            ))
          ) : (
            <div className="directoryEmpty">当前目录没有子目录，可以直接使用当前目录。</div>
          )}
        </div>
        <div className="directoryModalActions">
          <button className="ghostAction" onClick={onClose}>取消</button>
          <button className="blueAction" onClick={() => onPick(currentPath)} disabled={!currentPath}>
            使用此容器路径
          </button>
        </div>
      </div>
    </div>
  )
}

function DirectoryList({
  root,
  nodes,
  value,
  onPick,
}: {
  root: string
  nodes: DirectoryNode[]
  value: string
  onPick: (path: string) => void
}) {
  const options = flattenDirectories(nodes)
  return (
    <div className="directoryList">
      {root && (
        <button className={value === root ? 'active' : ''} onClick={() => onPick(root)}>
          <FolderOpen size={14} />
          <span>{root}</span>
        </button>
      )}
      {options.slice(0, 12).map((node) => (
        <button className={value === node.path ? 'active' : ''} key={node.path} onClick={() => onPick(node.path)} disabled={!node.readable}>
          <FolderOpen size={14} />
          <span>{node.path}</span>
        </button>
      ))}
    </div>
  )
}

function TimeRail({
  date,
  segments,
  selectedId,
  playbackTimeMs,
  playbackRate,
  isPlaying,
  exportStart,
  exportEnd,
  exportRangeVisible,
  exportMode,
  exportStatus,
  exporting,
  onSelect,
  onPlaybackRateChange,
  onTogglePlayback,
  onExportRangeChange,
  onExportRangeActivate,
  onExportModeChange,
  onExport,
}: {
  date: string
  segments: DisplaySegment[]
  selectedId?: string
  playbackTimeMs: number | null
  playbackRate: number
  isPlaying: boolean
  exportStart: string
  exportEnd: string
  exportRangeVisible: boolean
  exportMode: 'fast' | 'accurate'
  exportStatus: string
  exporting: boolean
  onSelect: (segment: DisplaySegment) => void
  onPlaybackRateChange: (rate: number) => void
  onTogglePlayback: () => void
  onExportRangeChange: (start: string, end: string) => void
  onExportRangeActivate: () => void
  onExportModeChange: (value: 'fast' | 'accurate') => void
  onExport: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<
    | { kind: 'pan'; x: number; start: number; end: number; moved: boolean }
    | { kind: 'export-start' | 'export-end'; moved: boolean }
  >(null)
  const previousSelectedIdRef = useRef<string | undefined>(undefined)
  const trackInset = 14
  const orderedSegments = useMemo(
    () => [...segments].sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime()),
    [segments],
  )
  const firstStart = orderedSegments[0] ? new Date(orderedSegments[0].startTime).getTime() : Date.now()
  const lastEnd = orderedSegments[orderedSegments.length - 1]
    ? new Date(orderedSegments[orderedSegments.length - 1].endTime).getTime()
    : firstStart
  const selectedSegment = orderedSegments.find((segment) => segment.id === selectedId)
  const currentTimeMs = playbackTimeMs ?? (selectedSegment ? new Date(selectedSegment.startTime).getTime() : null)
  const exportStartMs = exportStart ? new Date(exportStart).getTime() : null
  const exportEndMs = exportEnd ? new Date(exportEnd).getTime() : null
  const [windowRange, setWindowRange] = useState(() => {
    const span = Math.max(lastEnd - firstStart, 30 * 60_000)
    return { start: lastEnd - span, end: lastEnd }
  })

  useEffect(() => {
    if (!orderedSegments.length) return
    const span = Math.max(lastEnd - firstStart, 30 * 60_000)
    setWindowRange({ start: lastEnd - span, end: lastEnd })
  }, [date, firstStart, lastEnd, orderedSegments.length])

  useEffect(() => {
    if (!selectedSegment || !selectedId) return
    if (previousSelectedIdRef.current === selectedId) return
    previousSelectedIdRef.current = selectedId
    const selectedStart = new Date(selectedSegment.startTime).getTime()
    const selectedEnd = new Date(selectedSegment.endTime).getTime()
    const segmentSpan = Math.max(selectedEnd - selectedStart, 1)
    const center =
      currentTimeMs !== null && currentTimeMs >= selectedStart && currentTimeMs <= selectedEnd
        ? currentTimeMs
        : selectedStart + segmentSpan / 2
    const span = Math.max(60_000, Math.min(10 * 60_000, Math.max(segmentSpan * 2, 2 * 60_000)))
    setWindowRange({ start: center - span / 2, end: center + span / 2 })
  }, [currentTimeMs, selectedId, selectedSegment])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    const width = Math.max(1, parent?.clientWidth ?? 800)
    const height = parent?.clientHeight ?? 94
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)

    const start = windowRange.start
    const end = windowRange.end
    const span = Math.max(end - start, 1)
    const bandTop = 34
    const bandHeight = 36
    const trackStart = trackInset
    const trackWidth = Math.max(1, width - trackInset * 2)
    const xForTime = (time: number) => trackStart + ((time - start) / span) * trackWidth
    const clampedXForTime = (time: number) => Math.min(width - trackInset, Math.max(trackInset, xForTime(time)))
    const shouldShowSegmentLabels = span <= 3 * 60 * 60_000

    context.clearRect(0, 0, width, height)
    context.fillStyle = '#151515'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#565656'
    context.fillRect(trackStart, bandTop, trackWidth, bandHeight)

    context.save()
    context.beginPath()
    context.rect(trackStart, bandTop, trackWidth, bandHeight)
    context.clip()
    context.strokeStyle = 'rgba(0,0,0,.18)'
    for (let x = trackStart - height; x < width - trackInset + height; x += 9) {
      context.beginPath()
      context.moveTo(x, bandTop + bandHeight)
      context.lineTo(x + bandHeight, bandTop)
      context.stroke()
    }
    context.restore()

    orderedSegments.forEach((segment) => {
      const segmentStart = new Date(segment.startTime).getTime()
      const segmentEnd = new Date(segment.endTime).getTime()
      if (segmentEnd < start || segmentStart > end) return
      const x = Math.max(trackInset, xForTime(segmentStart))
      const segmentWidth = Math.max(3, Math.min(width - trackInset, xForTime(segmentEnd)) - x)
      context.fillStyle = segment.id === selectedId ? '#8befff' : '#43d3ec'
      context.fillRect(x, bandTop, segmentWidth, bandHeight)
      context.strokeStyle = 'rgba(9, 54, 69, .55)'
      context.lineWidth = 1
      context.strokeRect(x + 0.5, bandTop + 0.5, Math.max(1, segmentWidth - 1), bandHeight - 1)
      if (shouldShowSegmentLabels && segmentWidth >= 54) {
        context.fillStyle = '#10708a'
        context.font = '11px Inter, sans-serif'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(formatTime(segment.startTime).slice(0, 5), x + segmentWidth / 2, bandTop + bandHeight / 2)
      }
    })

    if (exportRangeVisible && exportStartMs !== null && exportEndMs !== null && exportEndMs > exportStartMs && exportEndMs >= start && exportStartMs <= end) {
      const rangeX = clampedXForTime(exportStartMs)
      const rangeEndX = clampedXForTime(exportEndMs)
      const rangeWidth = Math.max(2, rangeEndX - rangeX)
      context.fillStyle = 'rgba(47, 109, 246, .28)'
      context.fillRect(rangeX, bandTop - 6, rangeWidth, bandHeight + 12)
      context.strokeStyle = '#2f6df6'
      context.lineWidth = 2
      context.strokeRect(rangeX + 1, bandTop - 5, Math.max(1, rangeWidth - 2), bandHeight + 10)

      ;[rangeX, rangeEndX].forEach((x) => {
        context.fillStyle = '#ffffff'
        context.strokeStyle = '#2f6df6'
        context.lineWidth = 2
        context.beginPath()
        context.roundRect(x - 5, bandTop - 11, 10, bandHeight + 22, 4)
        context.fill()
        context.stroke()
      })
    }

    const majorTicks = Math.max(2, Math.min(10, Math.floor(width / 110)))
    context.strokeStyle = '#d1d5db'
    context.fillStyle = '#9fb6c8'
    context.font = '12px Inter, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'alphabetic'
    for (let index = 0; index <= majorTicks; index += 1) {
      const x = trackStart + (trackWidth / majorTicks) * index
      const time = start + (span / majorTicks) * index
      context.beginPath()
      context.moveTo(x, 10)
      context.lineTo(x, bandTop + bandHeight + 14)
      context.stroke()
      context.fillText(formatTime(new Date(time).toISOString()).slice(0, 5), x, bandTop - 10)
    }

    if (currentTimeMs !== null && currentTimeMs >= start && currentTimeMs <= end) {
      const x = xForTime(currentTimeMs)
      context.strokeStyle = '#ffffff'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(x, 4)
      context.lineTo(x, bandTop + bandHeight + 18)
      context.stroke()
    }
  }, [orderedSegments, selectedId, currentTimeMs, exportRangeVisible, exportStartMs, exportEndMs, windowRange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const rect = canvas.getBoundingClientRect()
      const pointerRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      setWindowRange((currentRange) => {
        const span = currentRange.end - currentRange.start
        const nextSpan = Math.min(24 * 60 * 60_000, Math.max(60_000, span * (event.deltaY > 0 ? 1.25 : 0.8)))
        const anchor = currentRange.start + span * pointerRatio
        return {
          start: anchor - nextSpan * pointerRatio,
          end: anchor + nextSpan * (1 - pointerRatio),
        }
      })
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [])

  function timeAt(clientX: number) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const trackWidth = Math.max(1, rect.width - trackInset * 2)
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - trackInset) / trackWidth))
    return windowRange.start + ratio * (windowRange.end - windowRange.start)
  }

  function pickSegmentAt(clientX: number) {
    const target = timeAt(clientX)
    if (target === null) return
    const containing = orderedSegments.find((segment) => {
      const start = new Date(segment.startTime).getTime()
      const end = new Date(segment.endTime).getTime()
      return target >= start && target <= end
    })
    if (containing) {
      onSelect(containing)
      return
    }
    const nearest = orderedSegments.reduce<DisplaySegment | null>((best, segment) => {
      if (!best) return segment
      const bestDistance = Math.abs(new Date(best.startTime).getTime() - target)
      const distance = Math.abs(new Date(segment.startTime).getTime() - target)
      return distance < bestDistance ? segment : best
    }, null)
    if (nearest) onSelect(nearest)
  }

  function selectRelative(direction: 1 | -1) {
    if (!orderedSegments.length) return
    const currentIndex = Math.max(0, orderedSegments.findIndex((segment) => segment.id === selectedId))
    const next = orderedSegments[Math.min(orderedSegments.length - 1, Math.max(0, currentIndex + direction))]
    if (next) onSelect(next)
  }

  function moveWindow(multiplier: number) {
    const span = windowRange.end - windowRange.start
    const delta = span * multiplier
    setWindowRange({ start: windowRange.start + delta, end: windowRange.end + delta })
  }

  function focusCurrentPlayback() {
    const selectedStart = selectedSegment ? new Date(selectedSegment.startTime).getTime() : null
    const selectedEnd = selectedSegment ? new Date(selectedSegment.endTime).getTime() : null
    const center = currentTimeMs ?? selectedStart
    if (center === null) return
    const segmentSpan = selectedStart !== null && selectedEnd !== null ? selectedEnd - selectedStart : 0
    const span = Math.max(60_000, Math.min(10 * 60_000, Math.max(segmentSpan * 2, 2 * 60_000)))
    setWindowRange({ start: center - span / 2, end: center + span / 2 })
  }

  function cyclePlaybackRate() {
    const currentIndex = playbackRates.findIndex((rate) => rate === playbackRate)
    const nextRate = playbackRates[(currentIndex + 1) % playbackRates.length] ?? 1
    onPlaybackRateChange(nextRate)
  }

  function exportHandleAt(clientX: number) {
    if (!exportRangeVisible) return null
    if (exportStartMs === null || exportEndMs === null) return null
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const span = Math.max(windowRange.end - windowRange.start, 1)
    const trackWidth = Math.max(1, rect.width - trackInset * 2)
    const xForTime = (time: number) => trackInset + ((time - windowRange.start) / span) * trackWidth
    const x = clientX - rect.left
    const startDistance = Math.abs(x - xForTime(exportStartMs))
    const endDistance = Math.abs(x - xForTime(exportEndMs))
    if (startDistance <= 12 || endDistance <= 12) {
      return startDistance <= endDistance ? 'export-start' : 'export-end'
    }
    return null
  }

  function updateExportHandle(kind: 'export-start' | 'export-end', clientX: number) {
    if (exportStartMs === null || exportEndMs === null) return
    const target = timeAt(clientX)
    if (target === null) return
    const minDuration = 1000
    if (kind === 'export-start') {
      const nextStart = Math.min(target, exportEndMs - minDuration)
      onExportRangeChange(toLocalDateTimePrecise(new Date(nextStart)), toLocalDateTimePrecise(new Date(exportEndMs)))
      return
    }
    const nextEnd = Math.max(target, exportStartMs + minDuration)
    onExportRangeChange(toLocalDateTimePrecise(new Date(exportStartMs)), toLocalDateTimePrecise(new Date(nextEnd)))
  }

  return (
    <aside className="timeRail">
      <div className="timelineHead">
        <div className="timelineButtons">
          <button title={isPlaying ? '暂停播放' : '播放'} onClick={onTogglePlayback} disabled={!selectedSegment}>
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button title="切换播放倍速" onClick={cyclePlaybackRate}>{formatPlaybackRate(playbackRate)}</button>
        </div>
        <div className="timelineClock">{currentTimeMs !== null ? formatTime(new Date(currentTimeMs).toISOString()) : formatTime(orderedSegments[orderedSegments.length - 1]?.startTime)}</div>
        <div className="timelineExportTools">
          <button className="exportRangeLabel" onClick={onExportRangeActivate} title="在时间线上显示导出区间，然后拖动左右把手调整">
            <Download size={15} />
            <span>{exportRangeVisible && exportStart && exportEnd ? `${formatTime(toIsoWithOffset(exportStart))} - ${formatTime(toIsoWithOffset(exportEnd))}` : '选择导出区间'}</span>
          </button>
          <ExportMode value={exportMode} onChange={onExportModeChange} />
          <button
            className="exportButton timelineExportButton"
            onClick={onExport}
            disabled={exporting}
            title={exportRangeVisible ? '按当前时间线区间创建导出任务' : '先显示导出区间，确认后再导出'}
          >
            <Download size={16} />
            {exportRangeVisible ? '确认导出' : '导出'}
          </button>
        </div>
      </div>
      {exportStatus && <div className="timelineExportStatus">{exportStatus}</div>}
      <div className="recordingTimelineHost">
        <canvas
          ref={canvasRef}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            const handle = exportHandleAt(event.clientX)
            if (handle) {
              dragRef.current = { kind: handle, moved: false }
              return
            }
            dragRef.current = { kind: 'pan', x: event.clientX, start: windowRange.start, end: windowRange.end, moved: false }
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current
            if (!drag) return
            if (drag.kind !== 'pan') {
              drag.moved = true
              updateExportHandle(drag.kind, event.clientX)
              return
            }
            const canvas = canvasRef.current
            if (!canvas) return
            const rect = canvas.getBoundingClientRect()
            const span = drag.end - drag.start
            const delta = ((event.clientX - drag.x) / rect.width) * span
            if (Math.abs(event.clientX - drag.x) > 3) drag.moved = true
            setWindowRange({ start: drag.start - delta, end: drag.end - delta })
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current
            dragRef.current = null
            if (drag?.kind === 'export-start' || drag?.kind === 'export-end') {
              updateExportHandle(drag.kind, event.clientX)
              return
            }
            if (!drag?.moved) pickSegmentAt(event.clientX)
          }}
        />
      </div>
      <div className="timelineActions">
        <button onClick={() => selectRelative(-1)}><RotateCcw size={18} /><span>上一个事件</span></button>
        <button onClick={() => selectRelative(1)}><RotateCw size={18} /><span>下一个事件</span></button>
        <button onClick={focusCurrentPlayback} disabled={currentTimeMs === null && !selectedSegment}><RefreshCw size={18} /><span>定位当前</span></button>
        <button onClick={() => {
          const center = currentTimeMs ?? (windowRange.start + windowRange.end) / 2
          const span = Math.max(60_000, (windowRange.end - windowRange.start) * 0.5)
          setWindowRange({ start: center - span / 2, end: center + span / 2 })
        }}><Unlink size={18} /><span>放大时间刻度</span></button>
        <button title="把时间线往更早时间移动半屏" onClick={() => moveWindow(-0.5)}><RotateCcw size={18} /><span>左移时间线</span></button>
      </div>
    </aside>
  )
}

function ExportMode({
  value,
  onChange,
}: {
  value: 'fast' | 'accurate'
  onChange: (value: 'fast' | 'accurate') => void
}) {
  return (
    <ToggleGroup.Root
      className="toggleGroup"
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next === 'fast' || next === 'accurate') onChange(next)
      }}
    >
      <ToggleGroup.Item className="toggleItem" value="fast" title="快速：不重新编码，导出更快，边界可能贴近关键帧而不是逐帧精确">
        快速
      </ToggleGroup.Item>
      <ToggleGroup.Item className="toggleItem" value="accurate" title="精准：重新编码，起止时间更准，但导出更慢、文件可能重新压缩">
        精准
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  )
}

function ClipGrid({
  sourceName,
  sourceNames,
  segments,
  selectedId,
  hasMore,
  loadingMore,
  total,
  onLoadMore,
  onSelect,
}: {
  sourceName: string
  sourceNames?: Map<string, string>
  segments: DisplaySegment[]
  selectedId?: string
  hasMore?: boolean
  loadingMore?: boolean
  total?: number
  onLoadMore?: () => void
  onSelect: (segment: DisplaySegment) => void
}) {
  if (!segments.length) return <div className="emptyDock">暂无录像片段</div>

  return (
    <>
      <div className="clipGrid">
        {segments.map((segment) => (
          <button
            key={segment.id}
            className={segment.id === selectedId ? 'clipCard selected' : 'clipCard'}
            onClick={() => onSelect(segment)}
          >
            <div className="clipPoster">
              {segment.thumbnailUrl && <img src={segment.thumbnailUrl} loading="lazy" decoding="async" alt="" />}
              <Play size={22} />
            </div>
            <span className="clipLabel">
              {sourceNames?.get(segment.sourceId) ?? sourceName}
              <br />
              {formatClipDateTime(segment.startTime)}
            </span>
            <span className="confidence">{segment.playable ? '可播放' : '转码'}</span>
          </button>
        ))}
      </div>
      {hasMore && (
        <button className="clipGridMore" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? '加载中...' : `继续加载，已显示 ${segments.length}/${total ?? segments.length}`}
        </button>
      )}
    </>
  )
}

function FailurePill({ segments }: { segments: Segment[] }) {
  return (
    <div className="failurePill" title={segments[0]?.errorMessage ?? '扫描失败'}>
      <AlertTriangle size={15} />
      {segments.length} 个问题
    </div>
  )
}
