import * as Switch from '@radix-ui/react-switch'
import { Info } from '@phosphor-icons/react'
import { useSettings } from './useSettings'

export function RecordingsTab() {
  const { settings, update } = useSettings()
  const recordings = settings?.recordings

  function updateNumber(key: string, value: string, minimum = 0) {
    const number = Number.parseInt(value, 10)
    if (Number.isFinite(number) && number >= minimum) update({ [key]: number })
  }

  return (
    <div className="settingsSections">
      <section className="settingsSection">
        <div className="settingsSectionTitle">发现新文件</div>
        <div className="settingsKV"><span>录像根路径</span><strong title={recordings?.recordings_root}>{recordings?.recordings_root ?? '-'}</strong></div>
        <div className="settingsKV"><span>默认扫描间隔（秒）</span><input className="settingsInput" type="number" min={30} value={recordings?.scan_interval_seconds ?? 300} onChange={(event) => updateNumber('scan_interval_seconds', event.target.value, 30)} /></div>
        <div className="settingsKV"><span>跳过仍在写入的文件</span><label className="settingsInlineField"><input className="settingsInput" type="number" min={0} value={recordings?.skip_recent_seconds ?? 30} onChange={(event) => updateNumber('skip_recent_seconds', event.target.value)} /><small>最近修改秒数</small></label></div>
        <div className="settingsKV"><span>索引时区</span><input className="settingsInput" list="timezone-suggestions" value={recordings?.timezone ?? 'Asia/Shanghai'} onChange={(event) => update({ timezone: event.target.value })} /><datalist id="timezone-suggestions"><option value="Asia/Shanghai" /><option value="Asia/Tokyo" /><option value="UTC" /><option value="Europe/London" /><option value="America/Los_Angeles" /></datalist></div>
        <p className="settingsHint"><Info size={14} />单个录像源的扫描方式和间隔仍在“录像源”中覆盖；这里设置系统默认调度与文件稳定等待。</p>
      </section>

      <section className="settingsSection">
        <div className="settingsSectionTitle">索引性能与清理</div>
        <div className="settingsKV"><span>每源扫描 worker</span><input className="settingsInput" type="number" min={1} max={8} value={recordings?.scan_workers_per_source ?? 1} onChange={(event) => updateNumber('scan_workers_per_source', event.target.value, 1)} /></div>
        <div className="settingsKV"><span>全局 ffprobe 并发</span><input className="settingsInput" type="number" min={1} max={16} value={recordings?.global_ffprobe_concurrency ?? 4} onChange={(event) => updateNumber('global_ffprobe_concurrency', event.target.value, 1)} /></div>
        <div className="settingsKV"><span>自动清理索引（天）</span><input className="settingsInput" type="number" min={0} value={recordings?.auto_cleanup_days ?? 0} onChange={(event) => updateNumber('auto_cleanup_days', event.target.value)} /></div>
        <div className="settingsKV"><span>闲时扫描</span><Switch.Root className="switchRoot" checked={recordings?.idle_scan_enabled ?? false} onCheckedChange={(checked) => update({ idle_scan_enabled: checked })}><Switch.Thumb className="switchThumb" /></Switch.Root></div>
        {recordings?.idle_scan_enabled && <><div className="settingsKV"><span>闲时开始</span><input className="settingsInput" type="number" min={0} max={23} value={recordings?.idle_scan_start_hour ?? 2} onChange={(event) => updateNumber('idle_scan_start_hour', event.target.value)} /></div><div className="settingsKV"><span>闲时结束</span><input className="settingsInput" type="number" min={0} max={23} value={recordings?.idle_scan_end_hour ?? 6} onChange={(event) => updateNumber('idle_scan_end_hour', event.target.value)} /></div></>}
        <p className="settingsHint"><Info size={14} />自动清理只清理索引和缓存，不会删除原始录像文件；设为 0 表示不自动清理。</p>
      </section>
    </div>
  )
}
