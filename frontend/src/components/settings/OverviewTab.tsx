import { Camera, Check, Cpu, HardDrive, RefreshCw, XCircle } from 'lucide-react'
import type { Source, SystemStatus } from '../../types'
import { formatBytes } from '../../utils'

export function OverviewTab({
  sources, status, onRefresh, busy,
}: {
  sources: Source[]; status: SystemStatus | null; onRefresh: () => void; busy: boolean
}) {
  const totalSegments = sources.reduce((sum, s) => sum + s.segmentCount, 0)
  const failedCount = sources.reduce((sum, s) => sum + s.failedCount, 0)

  return (
    <div className="settingsOverview">
      <div className="settingsGrid">
        <div className="settingsCard">
          <Camera size={20} />
          <strong>{sources.length}</strong>
          <span>录像源</span>
        </div>
        <div className="settingsCard">
          <HardDrive size={20} />
          <strong>{totalSegments.toLocaleString()}</strong>
          <span>总片段数</span>
        </div>
        <div className="settingsCard">
          {status?.ffmpeg.available ? <Check size={20} /> : <XCircle size={20} />}
          <strong>{status?.ffmpeg.available ? '可用' : '不可用'}</strong>
          <span>FFmpeg</span>
        </div>
        <div className="settingsCard">
          <Cpu size={20} />
          <strong>{failedCount > 0 ? `${failedCount} 个失败` : '正常'}</strong>
          <span>扫描状态</span>
        </div>
      </div>

      <div className="settingsSections">
        <div className="settingsSection">
          <div className="settingsSectionTitle">存储路径</div>
          <div className="settingsKV">
            <span>数据库</span>
            <strong>{status?.database.path ?? '-'}</strong>
          </div>
          <div className="settingsKV">
            <span>录像根路径</span>
            <strong>{status?.recordingsRoot.path ?? '-'}</strong>
          </div>
        </div>

        <div className="settingsSection">
          <div className="settingsSectionTitle">缓存占用</div>
          <div className="settingsKV">
            <span>导出缓存</span>
            <strong>{formatBytes(status?.cache.exportBytes)}</strong>
          </div>
          <div className="settingsKV">
            <span>缩略图缓存</span>
            <strong>{formatBytes(status?.cache.thumbnailBytes)}</strong>
          </div>
        </div>

        <div className="settingsSection">
          <div className="settingsSectionTitle">版本</div>
          <div className="settingsKV">
            <span>Clipline</span>
            <strong>{status?.version ?? '-'}</strong>
          </div>
        </div>
      </div>

      <div className="settingsFooter">
        <button className="settingsActionBtn" onClick={onRefresh} disabled={busy}>
          <RefreshCw size={14} className={busy ? 'spin' : ''} />
          刷新状态
        </button>
      </div>
    </div>
  )
}
