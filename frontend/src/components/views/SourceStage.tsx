import {
  CheckCircle,
  DotsThree,
  FilmStrip,
  FolderOpen,
  Info,
  MagnifyingGlass,
  Plus,
  Scan,
  VideoCamera,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import type { DirectoryNode, ScanJob, Source } from '../../types'
import type { DisplaySegment } from '../../utils'
import { PathPicker } from '../shared/PathPicker'
import { ScanProgress } from '../shared/ScanProgress'

function formatScanTime(value?: string | null) {
  if (!value) return '尚未扫描'
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function scheduleLabel(minutes: number) {
  if (!minutes) return '手动扫描'
  if (minutes < 60) return `每 ${minutes} 分钟`
  return `每 ${minutes / 60} 小时`
}

type SourceDraft = {
  name: string
  path: string
  scanIntervalMinutes: number
  autoTranscribe: boolean
  autoDetect: boolean
}

export function SourceStage({
  sources,
  segments,
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
  onRecognitionChange,
  onSave,
  onDelete,
}: {
  sources: Source[]
  segments: DisplaySegment[]
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
  onRecognitionChange: (id: string, payload: Partial<Pick<Source, 'autoTranscribe' | 'autoDetect'>>) => void
  onSave: (id: string, payload: { name: string; path: string }) => void
  onDelete: (id: string) => void
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled' | 'error'>('all')

  const latestJobBySource = useMemo(() => {
    const map = new Map<string, ScanJob>()
    scanJobs.forEach((job) => {
      if (job.sourceId && !map.has(job.sourceId)) map.set(job.sourceId, job)
    })
    return map
  }, [scanJobs])

  const selectedSource = sources.find((source) => source.id === selectedId) ?? sources[0] ?? null
  const selectedJob = selectedSource ? latestJobBySource.get(selectedSource.id) : undefined
  const latestSegment = selectedSource
    ? segments
      .filter((segment) => segment.sourceId === selectedSource.id)
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0]
    : undefined

  const [draft, setDraft] = useState<SourceDraft>({
    name: selectedSource?.name ?? '',
    path: selectedSource?.path ?? '',
    scanIntervalMinutes: selectedSource?.scanIntervalMinutes ?? 0,
    autoTranscribe: selectedSource?.autoTranscribe ?? false,
    autoDetect: selectedSource?.autoDetect ?? false,
  })

  useEffect(() => {
    if (!selectedSource) return
    setDraft({
      name: selectedSource.name,
      path: selectedSource.path,
      scanIntervalMinutes: selectedSource.scanIntervalMinutes,
      autoTranscribe: selectedSource.autoTranscribe,
      autoDetect: selectedSource.autoDetect,
    })
  }, [selectedSource])

  const filteredSources = sources.filter((source) => {
    const query = search.trim().toLowerCase()
    const matchesSearch = !query || source.name.toLowerCase().includes(query) || source.path.toLowerCase().includes(query)
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'enabled' && source.enabled)
      || (statusFilter === 'disabled' && !source.enabled)
      || (statusFilter === 'error' && source.failedCount > 0)
    return matchesSearch && matchesStatus
  })

  function submitCreate() {
    onCreate()
    setCreateOpen(false)
  }

  function saveSelected() {
    if (!selectedSource || !draft.name.trim() || !draft.path.trim()) return
    onSave(selectedSource.id, { name: draft.name.trim(), path: draft.path.trim() })
    if (draft.scanIntervalMinutes !== selectedSource.scanIntervalMinutes) onScheduleChange(selectedSource.id, draft.scanIntervalMinutes)
    if (draft.autoTranscribe !== selectedSource.autoTranscribe || draft.autoDetect !== selectedSource.autoDetect) {
      onRecognitionChange(selectedSource.id, { autoTranscribe: draft.autoTranscribe, autoDetect: draft.autoDetect })
    }
  }

  return (
    <section className="redesignSourcesPage">
      <header className="redesignManagePageHeader">
        <div><small>管理 / 录像源</small><h1>录像源</h1><p>管理已挂载视频目录、扫描规则与识别配置</p></div>
        <button type="button" className="managePrimary" onClick={() => setCreateOpen((value) => !value)}><Plus size={16} />添加目录</button>
      </header>

      <div className="redesignSourcesToolbar">
        <label><MagnifyingGlass size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称或目录路径" /></label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
          <option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option><option value="error">存在错误</option>
        </select>
        <button type="button" className="manageSecondary" disabled={scanning || !sources.length} onClick={() => sources.filter((source) => source.enabled).forEach((source) => onScan(source.id))}><Scan size={16} />扫描全部</button>
      </div>

      {createOpen && (
        <section className="redesignSourceCreate">
          <header><div><strong>添加录像目录</strong><p>选择一个只读目录，Clipline 将建立视频索引。</p></div><button type="button" onClick={() => setCreateOpen(false)}>取消</button></header>
          <div>
            <label>显示名称<input value={sourceName} onChange={(event) => onNameChange(event.target.value)} placeholder="留空则使用目录名称" /></label>
            <label>目录路径<PathPicker value={sourcePath} root={directoryRoot} nodes={directories} onChange={onPathChange} /></label>
            <label>扫描方式<select value={sourceScanInterval} onChange={(event) => onIntervalChange(Number(event.target.value))}><option value={0}>手动扫描</option><option value={5}>每 5 分钟</option><option value={15}>每 15 分钟</option><option value={30}>每 30 分钟</option><option value={60}>每 1 小时</option></select></label>
            <button type="button" className="managePrimary" disabled={creating || !sourcePath} onClick={submitCreate}><FolderOpen size={16} />创建并扫描</button>
          </div>
        </section>
      )}

      <section className="redesignSourcesTable" aria-label="录像源列表">
        <div className="redesignSourcesHead" aria-hidden="true"><span>录像源</span><span>目录路径</span><span>状态</span><span>片段 / 错误</span><span>最后扫描</span><span /></div>
        {filteredSources.map((source) => {
          const scanJob = latestJobBySource.get(source.id)
          return (
            <button type="button" aria-pressed={source.id === selectedSource?.id} className={source.id === selectedSource?.id ? 'redesignSourceRow selected' : 'redesignSourceRow'} key={source.id} onClick={() => onSelect(source.id)}>
              <span className="redesignSourceName"><span><FolderOpen size={18} /></span><span><strong>{source.name}</strong><small>{scheduleLabel(source.scanIntervalMinutes)}</small></span></span>
              <span className="redesignSourcePath" title={source.path}>{source.path}</span>
              <span className={`redesignSourceStatus ${source.enabled ? 'enabled' : 'disabled'}`}><i />{source.enabled ? (scanJob?.status === 'running' ? '扫描中' : '已启用') : '已停用'}</span>
              <span>{source.segmentCount} / {source.failedCount}</span>
              <span>{formatScanTime(source.lastScanAt)}</span>
              <DotsThree size={18} weight="bold" />
            </button>
          )
        })}
        {!filteredSources.length && <div className="redesignSourcesEmpty"><VideoCamera size={30} /><strong>没有匹配的录像源</strong><span>调整筛选条件或添加一个录像目录。</span></div>}
      </section>

      {selectedSource && (
        <section className="redesignSourceDetail">
          <div className="redesignSourcePreview">
            {latestSegment?.thumbnailUrl ? <img src={latestSegment.thumbnailUrl} alt="最近索引片段" /> : <FilmStrip size={38} />}
            <span><FilmStrip size={14} />最近索引片段{latestSegment ? ` · ${new Date(latestSegment.startTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</span>
          </div>
          <div className="redesignSourceConfig">
            <small>当前选择</small><h2>{selectedSource.name}</h2><p>{selectedSource.path}</p>
            <div className="redesignSourceConfigGrid">
              <label>显示名称<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>扫描方式<select value={draft.scanIntervalMinutes} onChange={(event) => setDraft((current) => ({ ...current, scanIntervalMinutes: Number(event.target.value) }))}><option value={0}>手动扫描</option><option value={5}>每 5 分钟</option><option value={15}>每 15 分钟</option><option value={30}>每 30 分钟</option><option value={60}>每 1 小时</option></select></label>
              <label className="wide">目录路径<input value={draft.path} onChange={(event) => setDraft((current) => ({ ...current, path: event.target.value }))} /></label>
              <label>语音识别<select value={draft.autoTranscribe ? 'auto' : 'manual'} onChange={(event) => setDraft((current) => ({ ...current, autoTranscribe: event.target.value === 'auto' }))}><option value="manual">按需运行</option><option value="auto">扫描后自动运行</option></select></label>
              <label>视觉识别<select value={draft.autoDetect ? 'auto' : 'manual'} onChange={(event) => setDraft((current) => ({ ...current, autoDetect: event.target.value === 'auto' }))}><option value="manual">按需运行</option><option value="auto">扫描后自动运行</option></select></label>
            </div>
            <p className="redesignSourceSafe"><Info size={15} />Clipline 仅读取目录并建立索引，不会改写或删除源视频。</p>
            <ScanProgress job={selectedJob} />
            <div className="redesignSourceActions">
              <button type="button" className="danger" onClick={() => onToggle(selectedSource.id, !selectedSource.enabled)}>{selectedSource.enabled ? '停用录像源' : '启用录像源'}</button>
              <span />
              <button type="button" className="manageSecondary" disabled={scanning} onClick={() => onScan(selectedSource.id)}><Scan size={15} />立即扫描</button>
              <button type="button" className="managePrimary" onClick={saveSelected}><CheckCircle size={15} />保存更改</button>
              <button type="button" className="sourceDeleteLink" onClick={() => { if (confirm(`确定删除录像源“${selectedSource.name}”吗？`)) onDelete(selectedSource.id) }}>删除</button>
            </div>
          </div>
        </section>
      )}
    </section>
  )
}
