import { DownloadSimple, HardDrives, Info } from '@phosphor-icons/react'
import { useSettings } from './useSettings'

export function ExportTab() {
  const { settings, update } = useSettings()
  const exp = settings?.export

  function updateNumber(key: string, value: string) {
    const number = Number.parseInt(value, 10)
    if (Number.isFinite(number) && number >= 0) update({ [key]: number })
  }

  return (
    <div className="exportSettingsStack">
      <section className="exportSettingsGroup">
        <header><h2>默认导出行为</h2><p>创建新导出任务时使用的限制与缩略图规则</p></header>
        <div className="exportSettingsBody">
          <div className="exportSettingsGrid">
            <label><span>默认模式</span><select disabled aria-label="默认导出模式"><option>创建任务时选择</option></select><small>支持快速关键帧切割与精准转码</small></label>
            <label><span>最长导出时长</span><div className="settingsInlineField"><input className="settingsInput" type="number" min={1} value={exp?.max_export_minutes ?? 30} onChange={(event) => updateNumber('max_export_minutes', event.target.value)} /><small>分钟</small></div></label>
            <label><span>最大并发任务</span><select className="settingsSelect" value={exp?.max_concurrent_exports ?? 1} onChange={(event) => updateNumber('max_concurrent_exports', event.target.value)}><option value={1}>1 个任务</option><option value={2}>2 个任务</option><option value={3}>3 个任务</option><option value={4}>4 个任务</option></select></label>
            <label><span>缩略图取帧位置</span><select className="settingsSelect" value={exp?.thumbnail_mode ?? 'middle'} onChange={(event) => update({ thumbnail_mode: event.target.value })}><option value="middle">中间帧</option><option value="first">首帧</option><option value="random">随机帧</option></select></label>
          </div>
          <p className="settingsHint"><Info size={14} />快速或精准模式由每次导出任务选择；系统不会用全局默认值覆盖任务选择。</p>
        </div>
      </section>

      <section className="exportSettingsGroup">
        <header><h2>服务端暂存与清理</h2><p>导出任务先在服务器生成文件，完成后由浏览器下载</p></header>
        <div className="exportSettingsBody">
          <div className="serverStorageRow"><span><HardDrives size={20} /></span><div><small>服务器暂存目录</small><strong>data/exports</strong><p>仅供 Clipline 生成和提供下载，不是用户电脑的保存位置。</p></div><em>只读</em></div>
          <div className="exportRetentionRow"><label><span>完成后保留</span><div className="settingsInlineField"><input className="settingsInput" type="number" min={1} value={exp?.export_ttl_hours ?? 24} onChange={(event) => updateNumber('export_ttl_hours', event.target.value)} /><small>小时</small></div></label><p>超过保留时间后，服务端暂存文件会在后续清理中移除。</p></div>
          <p className="browserDownloadNote"><DownloadSimple size={18} /><span><strong>下载位置由浏览器决定</strong><br />任务完成后在“任务”中点击下载，浏览器会保存到默认下载目录或询问保存位置。</span></p>
        </div>
      </section>
    </div>
  )
}
