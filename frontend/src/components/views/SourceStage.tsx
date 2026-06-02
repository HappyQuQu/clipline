import * as Switch from '@radix-ui/react-switch'
import { Camera, Check, FolderPlus, Pencil, RefreshCw, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { DirectoryNode, ScanJob, Source } from '../../types'
import { PathPicker } from '../shared/PathPicker'
import { ScanProgress } from '../shared/ScanProgress'

export function SourceStage({
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
  onDelete,
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
  onDelete: (id: string) => void
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
            <input className="field" placeholder="名称（可选，留空自动生成）" value={sourceName} onChange={(event) => onNameChange(event.target.value)} />
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
                      <button
                        className="iconAction danger"
                        title="删除"
                        onClick={() => {
                          if (confirm(`确定要删除录像源 "${source.name}" 吗？\n\n这将删除该源下的所有片段数据，此操作不可撤销。`)) {
                            onDelete(source.id)
                          }
                        }}
                      >
                        <X size={15} />
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
