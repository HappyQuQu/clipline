import { Camera, Check, LayoutDashboard, RefreshCw } from 'lucide-react'
import type { Source, SystemStatus } from '../../types'
import { formatBytes } from '../../utils'

export function OverviewTab({
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
    <>
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
            <span>录像根路径</span>
            <strong>{status?.recordingsRoot.path ?? '-'}</strong>
          </div>
        </div>
        <div className="settingsSection">
          <div className="settingsSectionTitle">缓存</div>
          <div className="settingsKV">
            <span>导出缓存</span>
            <strong>{formatBytes(status?.cache.exportBytes)}</strong>
          </div>
          <div className="settingsKV">
            <span>缩略图缓存</span>
            <strong>{formatBytes(status?.cache.thumbnailBytes)}</strong>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="refreshButton" onClick={onRefresh} disabled={busy}>
          <RefreshCw size={16} className={busy ? 'spin' : ''} />
          <span>刷新状态</span>
        </button>
      </div>
    </>
  )
}
