import * as Select from '@radix-ui/react-select'
import * as Switch from '@radix-ui/react-switch'
import * as Toast from '@radix-ui/react-toast'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Camera,
  ChevronDown,
  Download,
  FolderPlus,
  Grid3X3,
  LayoutDashboard,
  Play,
  RefreshCw,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import type { DirectoryNode, ExportJob, ScanJob, Segment, Source, TimelineSegment } from './types'

const today = new Date().toISOString().slice(0, 10)
type ViewKey = 'protect' | 'playback' | 'clips' | 'sources' | 'settings'

const navItems: Array<{ key: ViewKey; label: string; icon: typeof ShieldCheck }> = [
  { key: 'protect', label: 'Protect', icon: ShieldCheck },
  { key: 'playback', label: '录像回放', icon: Play },
  { key: 'clips', label: '片段墙', icon: Grid3X3 },
  { key: 'sources', label: '录像源', icon: Camera },
  { key: 'settings', label: '设置', icon: Settings },
]

const viewTitles: Record<ViewKey, string> = {
  protect: 'Protect',
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

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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
  const [sourceId, setSourceId] = useState('')
  const [date, setDate] = useState(today)
  const [selectedSegment, setSelectedSegment] = useState<TimelineSegment | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [exportStart, setExportStart] = useState('')
  const [exportEnd, setExportEnd] = useState('')
  const [exportMode, setExportMode] = useState<'fast' | 'accurate'>('fast')
  const [message, setMessage] = useState('')
  const [toastOpen, setToastOpen] = useState(false)
  const [activeView, setActiveView] = useState<ViewKey>('protect')

  const sourcesQuery = useQuery({
    queryKey: ['sources'],
    queryFn: api.sources,
    refetchInterval: 5000,
  })
  const directoriesQuery = useQuery({
    queryKey: ['directories'],
    queryFn: api.directories,
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
    queryKey: ['scanJobs', sourceId],
    queryFn: () => api.scanJobs(sourceId),
    enabled: Boolean(sourceId),
    refetchInterval: 2500,
  })
  const failedSegmentsQuery = useQuery({
    queryKey: ['segments', sourceId, 'failed'],
    queryFn: () => api.segments({ sourceId, scanStatus: 'failed', limit: 8 }),
    enabled: Boolean(sourceId),
    refetchInterval: 5000,
  })

  const sources = sourcesQuery.data?.items ?? []
  const directories = directoriesQuery.data?.items ?? []
  const timeline = timelineQuery.data ?? null
  const exports = exportsQuery.data?.items ?? []
  const scanJobs = scanJobsQuery.data?.items ?? []
  const failedSegments = failedSegmentsQuery.data?.items ?? []
  const selectedSource = sources.find((source) => source.id === sourceId)
  const daySegments = timeline?.segments ?? []

  const latestExport = exports[0]
  const latestScan = scanJobs[0]
  const totalRecordedSeconds = useMemo(
    () => daySegments.reduce((sum, segment) => sum + segment.durationSeconds, 0),
    [daySegments],
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
    if (!sourceId && sources[0]) setSourceId(sources[0].id)
  }, [sourceId, sources])

  useEffect(() => {
    if (!sourcePath && directories[0]) setSourcePath(directories[0].path)
  }, [directories, sourcePath])

  useEffect(() => {
    if (!daySegments.length) {
      setSelectedSegment(null)
      return
    }
    if (!selectedSegment || !daySegments.some((segment) => segment.id === selectedSegment.id)) {
      selectSegment(daySegments[0])
    }
  }, [daySegments, selectedSegment])

  const createSourceMutation = useMutation({
    mutationFn: api.createSource,
    onSuccess: async (created) => {
      notify(`已创建源 ${created.name}`)
      setSourceName('')
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
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.updateSource(id, { enabled }),
    onSuccess: async () => {
      notify('源状态已更新')
      await queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
    onError: (error) => notify(queryMessage(error, '更新源失败')),
  })

  function handleCreateSource() {
    if (!sourceName.trim() || !sourcePath.trim()) return
    createSourceMutation.mutate({ name: sourceName.trim(), path: sourcePath.trim() })
  }

  function handleScan() {
    if (!sourceId) return
    scanMutation.mutate(sourceId)
  }

  function selectSegment(segment: TimelineSegment) {
    setSelectedSegment(segment)
    setExportStart(toLocalInputValue(segment.startTime))
    setExportEnd(toLocalInputValue(segment.endTime))
  }

  function handleExport() {
    if (!sourceId || !exportStart || !exportEnd) return
    exportMutation.mutate({
      sourceId,
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
    scanJobsQuery.isFetching ||
    failedSegmentsQuery.isFetching

  return (
    <Toast.Provider swipeDirection="right">
      <div className="protectShell">
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

        <aside className="controlPane">
          <div className="siteBlock">
            <div className="siteStatus" />
            <div>
              <div className="siteName">Clipline</div>
              <div className="siteSub">{viewTitles[activeView]}</div>
            </div>
          </div>

          <div className="paneSection">
            <div className="sectionLabel">源</div>
            <SourceSelect sources={sources} value={sourceId} onChange={setSourceId} />
            <label className="dateControl">
              <CalendarDays size={15} />
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
          </div>

          <div className="paneSection">
            <div className="sectionLabel">新建</div>
            <input className="field" placeholder="源名称" value={sourceName} onChange={(event) => setSourceName(event.target.value)} />
            <input className="field" placeholder="视频目录" value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} />
            <DirectoryList nodes={directories} onPick={setSourcePath} />
            <button className="blueAction" onClick={handleCreateSource} disabled={createSourceMutation.isPending}>
              <FolderPlus size={16} />
              新建源
            </button>
          </div>

          <div className="paneSection">
            <div className="sectionLabel">当前</div>
            {selectedSource ? (
              <SourceSummary
                source={selectedSource}
                latestScan={latestScan}
                failedCount={failedSegments.length}
                onScan={handleScan}
                onToggle={(enabled) => updateSourceMutation.mutate({ id: selectedSource.id, enabled })}
                scanning={scanMutation.isPending}
              />
            ) : (
              <div className="muted">暂无源</div>
            )}
          </div>
        </aside>

        <main className="stage">
          <header className="stageTop">
            <div>
              <div className="stageTitle">
                {activeView === 'protect' || activeView === 'playback'
                  ? selectedSource?.name ?? viewTitles[activeView]
                  : viewTitles[activeView]}
              </div>
              <div className="stageMeta">
                {formatDate(date)} · {daySegments.length} 个片段 · {Math.round(totalRecordedSeconds)} 秒
              </div>
            </div>
            <button className="refreshButton" onClick={() => void refreshAll()}>
              <RefreshCw size={18} className={busy ? 'spin' : ''} />
            </button>
          </header>

          {activeView === 'sources' ? (
            <SourceStage
              sources={sources}
              selectedId={sourceId}
              onSelect={setSourceId}
              onScan={(id) => scanMutation.mutate(id)}
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
            <section className="clipDock fullDock">
              <div className="dockHead">
                <div>
                  <div className="dockTitle">全部片段</div>
                  <div className="dockMeta">{timeline?.gaps.length ?? 0} 个断档</div>
                </div>
                {failedSegments.length > 0 && <FailurePill segments={failedSegments} />}
              </div>
              <ClipGrid
                sourceName={selectedSource?.name ?? 'Camera'}
                segments={daySegments}
                selectedId={selectedSegment?.id}
                onSelect={selectSegment}
              />
            </section>
          ) : (
            <>
              <section className="viewerBand">
                <TimeRail date={date} segments={daySegments} selectedId={selectedSegment?.id} onSelect={selectSegment} />
                <div className="viewer">
                  {selectedSegment ? (
                    <>
                      <video className="viewerVideo" controls src={`/api/segments/${selectedSegment.id}/stream`} />
                      <div className="videoBadge">
                        {formatTime(selectedSegment.startTime)} | {selectedSource?.name ?? 'Camera'}
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
                    <div className="dockMeta">{timeline?.gaps.length ?? 0} 个断档</div>
                  </div>
                  {failedSegments.length > 0 && <FailurePill segments={failedSegments} />}
                </div>
                <ClipGrid
                  sourceName={selectedSource?.name ?? 'Camera'}
                  segments={daySegments}
                  selectedId={selectedSegment?.id}
                  onSelect={selectSegment}
                />
              </section>
            </>
          )}
        </main>
      </div>

      <Toast.Root className="toastRoot" open={toastOpen} onOpenChange={setToastOpen}>
        <Toast.Description>{message}</Toast.Description>
      </Toast.Root>
      <Toast.Viewport className="toastViewport" />
    </Toast.Provider>
  )
}

function SourceStage({
  sources,
  selectedId,
  onSelect,
  onScan,
}: {
  sources: Source[]
  selectedId: string
  onSelect: (id: string) => void
  onScan: (id: string) => void
}) {
  if (!sources.length) {
    return (
      <section className="modulePanel">
        <div className="moduleEmpty">左侧新建一个源后，这里会显示摄像头列表。</div>
      </section>
    )
  }

  return (
    <section className="modulePanel">
      <div className="moduleHead">
        <div>
          <div className="moduleTitle">录像源</div>
          <div className="moduleMeta">{sources.length} 个源</div>
        </div>
      </div>
      <div className="sourceCardGrid">
        {sources.map((source) => (
          <button
            className={source.id === selectedId ? 'sourceCard selected' : 'sourceCard'}
            key={source.id}
            onClick={() => onSelect(source.id)}
          >
            <span className="sourceCardIcon">
              <Camera size={20} />
            </span>
            <span className="sourceCardBody">
              <strong>{source.name}</strong>
              <small>{source.path}</small>
              <span>{source.segmentCount} 片段 · {source.failedCount} 错误</span>
            </span>
            <span className={source.enabled ? 'sourceState on' : 'sourceState'}>{source.enabled ? '启用' : '停用'}</span>
            <span
              className="sourceScan"
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation()
                onScan(source.id)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  onScan(source.id)
                }
              }}
            >
              扫描
            </span>
          </button>
        ))}
      </div>
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
    <Select.Root value={value} onValueChange={onChange} disabled={!sources.length}>
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

function DirectoryList({ nodes, onPick }: { nodes: DirectoryNode[]; onPick: (path: string) => void }) {
  return (
    <div className="directoryList">
      {nodes.slice(0, 6).map((node) => (
        <button key={node.path} onClick={() => onPick(node.path)} disabled={!node.readable}>
          <span>{node.name}</span>
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
  segments: TimelineSegment[]
  selectedId?: string
  onSelect: (segment: TimelineSegment) => void
}) {
  const visible = segments.slice(0, 10)
  return (
    <aside className="timeRail">
      <div className="railDate">{formatDate(date)}</div>
      <div className="railScale">
        <div className="railLine" />
        {visible.map((segment) => {
          const start = new Date(segment.startTime)
          const seconds = start.getHours() * 3600 + start.getMinutes() * 60 + start.getSeconds()
          const top = Math.min(Math.max((seconds / 86400) * 100, 3), 94)
          return (
            <button
              key={segment.id}
              className={segment.id === selectedId ? 'railMoment active' : 'railMoment'}
              style={{ top: `${top}%` }}
              onClick={() => onSelect(segment)}
              title={formatTime(segment.startTime)}
            >
              <span>{formatTime(segment.startTime).slice(0, 5)}</span>
            </button>
          )
        })}
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
  segments,
  selectedId,
  onSelect,
}: {
  sourceName: string
  segments: TimelineSegment[]
  selectedId?: string
  onSelect: (segment: TimelineSegment) => void
}) {
  if (!segments.length) return <div className="emptyDock">这一天没有录像</div>

  return (
    <div className="clipGrid">
      {segments.map((segment) => (
        <button
          key={segment.id}
          className={segment.id === selectedId ? 'clipCard selected' : 'clipCard'}
          onClick={() => onSelect(segment)}
        >
          <video muted preload="metadata" src={`/api/segments/${segment.id}/stream`} />
          <span className="clipLabel">
            {sourceName}
            <br />
            {formatTime(segment.startTime)}
          </span>
          <span className="confidence">{segment.playable ? '100%' : '转码'}</span>
        </button>
      ))}
    </div>
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
