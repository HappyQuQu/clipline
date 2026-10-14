import { Check, CheckCircle, FilmStrip, HardDrives, Info, WarningCircle } from '@phosphor-icons/react'
import type { Source, SystemStatus } from '../../types'
import { formatBytes } from '../../utils'

export function OverviewTab({
  sources, status, onOpenSources,
}: {
  sources: Source[]
  status: SystemStatus | null
  onOpenSources?: () => void
}) {
  const totalSegments = sources.reduce((sum, source) => sum + source.segmentCount, 0)
  const failedCount = sources.reduce((sum, source) => sum + source.failedCount, 0)
  const systemHealthy = Boolean(status?.database.available && status?.recordingsRoot.readable)

  return (
    <div className="redesignSettingsOverview">
      <section className="settingsHealthStrip">
        <div><span className={systemHealthy ? 'green' : 'red'}>{systemHealthy ? <CheckCircle size={20} weight="fill" /> : <WarningCircle size={20} weight="fill" />}</span><p><small>系统状态</small><strong>{systemHealthy ? '运行正常' : '需要检查'}</strong></p></div>
        <div><span className="blue"><FilmStrip size={20} /></span><p><small>索引内容</small><strong>{sources.length} 个源 · {totalSegments} 个片段</strong></p></div>
        <div><span className={status?.ffmpeg.available ? 'green' : 'red'}><Check size={20} /></span><p><small>媒体工具</small><strong>FFmpeg {status?.ffmpeg.available ? '可用' : '不可用'}</strong></p></div>
        <div><span className="neutral"><HardDrives size={20} /></span><p><small>后台任务</small><strong>{failedCount ? `${failedCount} 个失败` : '运行正常'}</strong></p></div>
      </section>

      <div className="settingsOverviewCards">
        <section><h2>存储路径</h2><dl><div><dt>数据库</dt><dd>{status?.database.path ?? '-'}</dd></div><div><dt>录像根路径</dt><dd>{status?.recordingsRoot.path ?? '-'}</dd></div><div><dt>日志文件</dt><dd>{status?.logging.file ?? '-'}</dd></div><div><dt>模型目录</dt><dd>{status?.paths?.models ?? '-'}</dd></div></dl></section>
        <section><h2>缓存占用</h2><dl><div><dt>缩略图缓存</dt><dd>{formatBytes(status?.cache.thumbnailBytes)}</dd></div><div><dt>导出缓存</dt><dd>{formatBytes(status?.cache.exportBytes)}</dd></div><div><dt>数据库状态</dt><dd>{status?.database.available ? '可用' : '不可用'}</dd></div><div><dt>服务版本</dt><dd>{status?.version ?? '-'}</dd></div></dl></section>
      </div>

      <section className="settingsScopeCallout"><Info size={19} /><div><strong>设置作用范围</strong><p>这里修改系统默认值；单个录像源的覆盖项仍在“录像源”中设置。</p></div><button type="button" className="manageSecondary" onClick={onOpenSources}>打开录像源</button></section>
    </div>
  )
}
