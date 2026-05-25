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
import type { DirectoryNode, ExportJob, ScanJob, Segment, Source, TimelineSegment } from './types'

const today = new Date().toISOString().slice(0, 10)
const recordingsRoot = '/recordings'
const hostRecordingsRoot = 'C:\\Users\\EvanQ\\Desktop'
type ViewKey = 'playback' | 'clips' | 'sources' | 'settings'
type DisplaySegment = TimelineSegment & { sourceId: string; filename?: string }

const navItems: Array<{ key: ViewKey; label: string; icon: typeof Play }> = [
  { key: 'playback', label: '录像回放', icon: Play },
  { key: 'clips', label: '片段墙', icon: Grid3X3 },
  { key: 'sources', label: '录像源', icon: Camera },
  { key: 'settings', label: '设置', icon: Settings },
]

const viewTitles: Record<ViewKey, string> = {
  playback: '录像回放',
  clips: '片段墙',
  sources: '录像源',
  settings: '设置',
}

function toLocalInputValue(value: string) {
  return value.slice(0, 16)
}

function toIsoWithOffset(value: string) {
  const date = new Date(value)
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const hours = String(Math.floor(abs / 60)).padStart(2, '0')
  const minutes = String(abs % 60).padStart(2, '0')
  return `${value}:00${sign}${hours}:${minutes}`
}

function formatTime(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function toLocalDateTimeInput(dateValue: Date) {
  const offsetMs = dateValue.getTimezoneOffset() * 60_000
  return new Date(dateValue.getTime() - offsetMs).toISOString().slice(0, 16)
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

function displayPath(path: string | null | undefined) {
  if (!path) return ''
  if (path === recordingsRoot) return hostRecordingsRoot
  if (path.startsWith(`${recordingsRoot}/`)) {
    return `${hostRecordingsRoot}\\${path.slice(recordingsRoot.length + 1).replaceAll('/', '\\')}`
  }
  return path
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

function queryMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function App() {
  const queryClient = useQueryClient()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [date, setDate] = useState(today)
  const [selectedSegment, setSelectedSegment] = useState<DisplaySegment | null>(null)
  const [previewSegment, setPreviewSegment] = useState<DisplaySegment | null>(null)
  const [autoPlayNext, setAutoPlayNext] = useState(false)
  const [sourceName, setSourceName] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [sourceScanInterval, setSourceScanInterval] = useState(0)
  const [exportStart, setExportStart] = useState('')
  const [exportEnd, setExportEnd] = useState('')
  const [clipRangeStart, setClipRangeStart] = useState(() => getDefaultRange(7).start)
  const [clipRangeEnd, setClipRangeEnd] = useState(() => getDefaultRange(7).end)
  const [exportMode, setExportMode] = useState<'fast' | 'accurate'>('fast')
  const [message, setMessage] = useState('')
  const [toastOpen, setToastOpen] = useState(false)
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
  const scanJobsQuery = useQuery({
    queryKey: ['scanJobs', sourceId || 'all'],
    queryFn: () => api.scanJobs(sourceId || undefined),
    refetchInterval: 2500,
  })
  const failedSegmentsQuery = useQuery({
    queryKey: ['segments', sourceId || 'all', 'failed'],
    queryFn: () => api.segments({ sourceId: sourceId || undefined, scanStatus: 'failed', limit: 8 }),
    refetchInterval: 5000,
  })
  const segmentsQuery = useInfiniteQuery({
    queryKey: ['segments', sourceId || 'all', 'indexed'],
    queryFn: ({ pageParam }) =>
      api.segments({
        sourceId: sourceId || undefined,
        scanStatus: 'indexed',
        limit: segmentPageSize,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.offset + lastPage.items.length < lastPage.total ? lastPage.offset + lastPage.items.length : undefined),
    refetchInterval: 5000,
  })

  const sources = sourcesQuery.data?.items ?? []
  const directories = directoriesQuery.data?.items ?? []
  const directoryRoot = directoriesQuery.data?.root ?? ''
  const timeline = timelineQuery.data ?? null
  const exports = exportsQuery.data?.items ?? []
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
  const latestScan = scanJobs[0]
  const totalSegmentCount = useMemo(
    () => (sourceId ? selectedSource?.segmentCount ?? allSegments.length : sources.reduce((sum, source) => sum + source.segmentCount, 0)),
    [allSegments.length, selectedSource?.segmentCount, sourceId, sources],
  )
  const totalRecordedSeconds = useMemo(
    () => allSegments.reduce((sum, segment) => sum + segment.durationSeconds, 0),
    [allSegments],
  )

  function notify(text: string) {
    setMessage(text)
    setToastOpen(false)
    window.setTimeout(() => setToastOpen(true), 0)
  }

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sources'] }),
      queryClient.invalidateQueries({ queryKey: ['exports'] }),
      queryClient.invalidateQueries({ queryKey: ['scanJobs'] }),
      queryClient.invalidateQueries({ queryKey: ['segments'] }),
      queryClient.invalidateQueries({ queryKey: ['timeline'] }),
    ])
  }

  useEffect(() => {
    if (!sourcePath && directories[0]) setSourcePath(directories[0].path)
  }, [directories, sourcePath])

  useEffect(() => {
    if (!rangeSegments.length) {
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

  const createSourceMutation = useMutation({
    mutationFn: api.createSource,
    onSuccess: async (created) => {
      notify(`已创建源 ${created.name}`)
      setSourceName('')
      setSourceScanInterval(0)
      setSourceId(created.id)
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
    onSuccess: async () => {
      notify('导出任务已创建')
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
    sources.filter((source) => source.enabled).forEach((source) => scanMutation.mutate(source.id))
  }

  function selectSegment(segment: DisplaySegment, play = false) {
    setSelectedSegment(segment)
    setAutoPlayNext(play)
    setDate(segmentDate(segment.startTime))
    setExportStart(toLocalInputValue(segment.startTime))
    setExportEnd(toLocalInputValue(segment.endTime))
  }

  function openClipPreview(segment: DisplaySegment) {
    setSelectedSegment(segment)
    setDate(segmentDate(segment.startTime))
    setExportStart(toLocalInputValue(segment.startTime))
    setExportEnd(toLocalInputValue(segment.endTime))
    setPreviewSegment(segment)
  }

  function handleSegmentEnded() {
    if (!selectedSegment) return
    const currentIndex = playbackQueue.findIndex((segment) => segment.id === selectedSegment.id)
    const nextSegment = currentIndex >= 0 ? playbackQueue[currentIndex + 1] : null
    if (!nextSegment) {
      setAutoPlayNext(false)
      return
    }
    setSelectedSegment(nextSegment)
    setAutoPlayNext(true)
    setDate(segmentDate(nextSegment.startTime))
    setExportStart(toLocalInputValue(nextSegment.startTime))
    setExportEnd(toLocalInputValue(nextSegment.endTime))
  }

  function handleExport() {
    const exportSourceId = selectedSegment?.sourceId ?? sourceId
    if (!exportSourceId || !exportStart || !exportEnd) return
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
    scanJobsQuery.isFetching ||
    failedSegmentsQuery.isFetching ||
    segmentsQuery.isFetching

  const filterPane = showFilterPane ? (
    <aside className="controlPane">
      <div className="filterTitle">筛选</div>
      <div className="filterSectionLabel">时间</div>
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
          清除时间
        </button>
      </div>
      <div className="filterDivider" />
      <div className="filterSectionLabel">当前源</div>
      <div className="filterMeta">
        <strong>{selectedSource?.name ?? '全部源'}</strong>
        <small>{rangeSegments.length} 个片段</small>
      </div>
      <div className="filterCount">
        <strong>{rangeSegments.length}</strong>
        <span>当前片段</span>
      </div>
    </aside>
  ) : null

  return (
    <Toast.Provider swipeDirection="right">
      <div className="protectShell compactShell">
        <aside className="rail">
          <div className="railDot" />
          {navItems.slice(0, 4).map((item) => {
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
          {navItems.slice(4).map((item) => {
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
                {formatRangeLabel(clipRangeStart, clipRangeEnd)} · {totalSegmentCount} 个片段 · {Math.round(totalRecordedSeconds)} 秒
              </div>
            </div>
            <div className="stageTools">
              <SourceSelect sources={sources} value={sourceId} onChange={setSourceId} />
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
              onSelect={setSourceId}
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
                  <TimeRail
                    date={`${clipRangeStart}-${clipRangeEnd}`}
                    segments={rangeSegments}
                    selectedId={selectedSegment?.id}
                    onSelect={(segment) => selectSegment(segment, true)}
                  />
                  <div className="viewer">
                    {selectedSegment ? (
                      <>
                        <video
                          key={selectedSegment.id}
                          ref={videoRef}
                          className="viewerVideo"
                          controls
                          src={`/api/segments/${selectedSegment.id}/stream`}
                          onEnded={handleSegmentEnded}
                          onPlay={() => setAutoPlayNext(true)}
                          onPause={() => setAutoPlayNext(false)}
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
                </section>

                <section className="playbackBar">
                  <div className="nowPill">
                    <Play size={16} />
                    {formatTime(selectedSegment?.startTime)}
                  </div>
                  <input type="datetime-local" value={exportStart} onChange={(event) => setExportStart(event.target.value)} />
                  <input type="datetime-local" value={exportEnd} onChange={(event) => setExportEnd(event.target.value)} />
                  <ExportMode value={exportMode} onChange={setExportMode} />
                  <button className="exportButton" onClick={handleExport} disabled={exportMutation.isPending}>
                    <Download size={16} />
                    导出
                  </button>
                  {latestExport && <div className="exportHint">{latestExport.status} · {formatBytes(latestExport.outputSizeBytes)}</div>}
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
                      <small>{displayPath(source.path)}</small>
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
  const latestScan = scanJobs[0]
  const latestExport = exports[0]
  return (
    <section className="modulePanel">
      <div className="moduleHead">
        <div>
          <div className="moduleTitle">系统概览</div>
          <div className="moduleMeta">运行状态和任务摘要</div>
        </div>
        <button className="refreshButton" onClick={onRefresh}>
          <RefreshCw size={18} className={busy ? 'spin' : ''} />
        </button>
      </div>

      <div className="settingsGrid">
        <div className="settingsCard">
          <LayoutDashboard size={20} />
          <strong>{sources.length}</strong>
          <span>录像源</span>
        </div>
        <div className="settingsCard">
          <Activity size={20} />
          <strong>{latestScan?.status ?? '-'}</strong>
          <span>最近扫描</span>
        </div>
        <div className="settingsCard">
          <Download size={20} />
          <strong>{latestExport?.status ?? '-'}</strong>
          <span>最近导出</span>
        </div>
        <div className="settingsCard warning">
          <AlertTriangle size={20} />
          <strong>{failedSegments.length}</strong>
          <span>扫描问题</span>
        </div>
      </div>

      <div className="settingsList">
        {scanJobs.slice(0, 5).map((job) => (
          <div className="settingsRow" key={job.id}>
            <span>{job.status}</span>
            <span>{formatTime(job.finishedAt ?? job.startedAt ?? job.createdAt)}</span>
            <span>{job.scannedFiles} 文件</span>
            <span>{job.failedFiles} 错误</span>
          </div>
        ))}
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
    <Select.Root value={value || 'all'} onValueChange={(next) => onChange(next === 'all' ? '' : next)} disabled={!sources.length}>
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
            <Select.Item className="selectItem" value="all">
              <Select.ItemText>全部源</Select.ItemText>
            </Select.Item>
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
      <input className="field" value={displayPath(value)} placeholder="选择 Windows 视频目录" readOnly />
      <button className="pathBrowseButton" type="button" onClick={() => setOpen(true)}>
        <FolderOpen size={15} />
        选择目录
      </button>
      {open && (
        <DirectoryPickerModal
          initialPath={value || root}
          root={root}
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
  initialPath,
  root,
  fallbackNodes,
  onClose,
  onPick,
}: {
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
  const canGoUp = root && currentPath !== root && currentPath.startsWith(root)
  const parentPath = canGoUp ? currentPath.slice(0, currentPath.lastIndexOf('/')) || root : root

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="directoryModal">
        <div className="directoryModalHead">
          <div>
            <strong>选择视频目录</strong>
            <span>{displayPath(currentPath)}</span>
          </div>
          <button className="iconAction" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="directoryCrumbs">
          <button onClick={() => setCurrentPath(root)} disabled={!root}>根目录</button>
          {canGoUp && <button onClick={() => setCurrentPath(parentPath)}>上一级</button>}
        </div>
        <div className="directoryBrowser">
          {directoryQuery.isFetching ? (
            <div className="directoryEmpty">正在读取目录...</div>
          ) : items.length ? (
            items.map((node) => (
              <button key={node.path} onClick={() => setCurrentPath(node.path)} disabled={!node.readable}>
                <FolderOpen size={16} />
                <span>{node.name}</span>
                <em>{displayPath(node.path)}</em>
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
            使用当前目录
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
          <span>{displayPath(root)}</span>
        </button>
      )}
      {options.slice(0, 12).map((node) => (
        <button className={value === node.path ? 'active' : ''} key={node.path} onClick={() => onPick(node.path)} disabled={!node.readable}>
          <FolderOpen size={14} />
          <span>{displayPath(node.path)}</span>
        </button>
      ))}
    </div>
  )
}

function TimeRail({
  date,
  segments,
  selectedId,
  onSelect,
}: {
  date: string
  segments: DisplaySegment[]
  selectedId?: string
  onSelect: (segment: DisplaySegment) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<{ x: number; start: number; end: number; moved: boolean } | null>(null)
  const orderedSegments = useMemo(
    () => [...segments].sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime()),
    [segments],
  )
  const firstStart = orderedSegments[0] ? new Date(orderedSegments[0].startTime).getTime() : Date.now()
  const lastEnd = orderedSegments[orderedSegments.length - 1]
    ? new Date(orderedSegments[orderedSegments.length - 1].endTime).getTime()
    : firstStart
  const selectedSegment = orderedSegments.find((segment) => segment.id === selectedId)
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
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    const width = parent?.clientWidth ?? 800
    const height = 94
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
    const xForTime = (time: number) => ((time - start) / span) * width
    const shouldShowSegmentLabels = span <= 3 * 60 * 60_000

    context.clearRect(0, 0, width, height)
    context.fillStyle = '#151515'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#565656'
    context.fillRect(0, bandTop, width, bandHeight)

    context.save()
    context.beginPath()
    context.rect(0, bandTop, width, bandHeight)
    context.clip()
    context.strokeStyle = 'rgba(0,0,0,.18)'
    for (let x = -height; x < width + height; x += 9) {
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
      const x = Math.max(0, xForTime(segmentStart))
      const segmentWidth = Math.max(3, Math.min(width, xForTime(segmentEnd)) - x)
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

    const majorTicks = Math.max(2, Math.min(10, Math.floor(width / 110)))
    context.strokeStyle = '#d1d5db'
    context.fillStyle = '#9fb6c8'
    context.font = '12px Inter, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'alphabetic'
    for (let index = 0; index <= majorTicks; index += 1) {
      const x = (width / majorTicks) * index
      const time = start + (span / majorTicks) * index
      context.beginPath()
      context.moveTo(x, 10)
      context.lineTo(x, bandTop + bandHeight + 14)
      context.stroke()
      context.fillText(formatTime(new Date(time).toISOString()).slice(0, 5), x, bandTop - 10)
    }

    const current = selectedSegment ? new Date(selectedSegment.startTime).getTime() : null
    if (current !== null && current >= start && current <= end) {
      const x = xForTime(current)
      context.strokeStyle = '#ffffff'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(x, 4)
      context.lineTo(x, bandTop + bandHeight + 18)
      context.stroke()
    }
  }, [orderedSegments, selectedId, selectedSegment, windowRange])

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

  function pickSegmentAt(clientX: number) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const ratio = (clientX - rect.left) / rect.width
    const target = windowRange.start + ratio * (windowRange.end - windowRange.start)
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

  return (
    <aside className="timeRail">
      <div className="timelineHead">
        <div className="timelineButtons">
          <button title="暂停"><Pause size={16} /></button>
          <button>1.0x</button>
        </div>
        <div className="timelineClock">{formatTime(selectedSegment?.startTime ?? orderedSegments[orderedSegments.length - 1]?.startTime)}</div>
        <div className="timelineButtons right">
          <button title="回退" onClick={() => moveWindow(-0.5)}><RotateCcw size={16} /></button>
          <button className="liveButton">LIVE</button>
        </div>
      </div>
      <div className="recordingTimelineHost">
        <canvas
          ref={canvasRef}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            dragRef.current = { x: event.clientX, start: windowRange.start, end: windowRange.end, moved: false }
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current
            if (!drag) return
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
            if (!drag?.moved) pickSegmentAt(event.clientX)
          }}
        />
      </div>
      <div className="timelineActions">
        <button onClick={() => selectRelative(-1)}><RotateCcw size={18} /><span>上一个事件</span></button>
        <button onClick={() => selectRelative(1)}><RotateCw size={18} /><span>下一个事件</span></button>
        <button onClick={() => selectRelative(1)}><RefreshCw size={18} /><span>快速</span></button>
        <button onClick={() => {
          const center = selectedSegment ? new Date(selectedSegment.startTime).getTime() : (windowRange.start + windowRange.end) / 2
          const span = Math.max(60_000, (windowRange.end - windowRange.start) * 0.5)
          setWindowRange({ start: center - span / 2, end: center + span / 2 })
        }}><Unlink size={18} /><span>放大时间刻度</span></button>
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
      <ToggleGroup.Item className="toggleItem" value="fast">
        快速
      </ToggleGroup.Item>
      <ToggleGroup.Item className="toggleItem" value="accurate">
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
