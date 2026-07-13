import { FolderCog, ScanSearch } from 'lucide-react'
import { useSettings } from './useSettings'

export function RecordingsTab() {
  const { settings, update, isPending, saveError } = useSettings()
  const rec = settings?.recordings

  function handleNumberChange(key: string, value: string) {
    const num = parseInt(value, 10)
    if (!isNaN(num) && num >= 0) {
      update({ [key]: num })
    }
  }

  function handleTextBlur(key: string, value: string) {
    if (value.trim()) {
      update({ [key]: value.trim() })
    }
  }

  function handleBoolChange(key: string, value: boolean) {
    update({ [key]: value })
  }

  return (
    <div className="settingsSections">
      <div className="settingsSection">
        <div className="settingsSectionTitle"><FolderCog size={16} />录制源配置</div>
        <div className="settingsKV">
          <span>录像根路径</span>
          <strong>{rec?.recordings_root ?? '-'}</strong>
        </div>
        <div className="settingsKV">
          <span>扫描间隔 (秒)</span>
          <input
            className="settingsInput"
            type="number"
            min={30}
            value={rec?.scan_interval_seconds ?? 300}
            onChange={(e) => handleNumberChange('scan_interval_seconds', e.target.value)}
          />
        </div>
        <div className="settingsKV">
          <span>跳过最近 (秒)</span>
          <input
            className="settingsInput"
            type="number"
            min={0}
            value={rec?.skip_recent_seconds ?? 30}
            onChange={(e) => handleNumberChange('skip_recent_seconds', e.target.value)}
          />
        </div>
        <div className="settingsKV">
          <span>时区</span>
          <input
            className="settingsInput"
            type="text"
            list="timezone-suggestions"
            defaultValue={rec?.timezone ?? 'Asia/Shanghai'}
            onBlur={(e) => handleTextBlur('timezone', e.target.value)}
          />
          <datalist id="timezone-suggestions">
            <option value="Asia/Shanghai" />
            <option value="Asia/Tokyo" />
            <option value="America/New_York" />
            <option value="America/Los_Angeles" />
            <option value="Europe/London" />
            <option value="Europe/Berlin" />
            <option value="UTC" />
          </datalist>
        </div>
        {isPending && <div className="settingsSaving">保存中...</div>}
        {saveError && <div className="settingsError">{saveError}</div>}
      </div>

      <div className="settingsSection">
        <div className="settingsSectionTitle"><ScanSearch size={16} />扫描性能</div>
        <div className="settingsKV">
          <span>全局 ffprobe 并发</span>
          <input
            className="settingsInput"
            type="number"
            min={1}
            max={16}
            value={rec?.global_ffprobe_concurrency ?? 4}
            onChange={(e) => handleNumberChange('global_ffprobe_concurrency', e.target.value)}
          />
        </div>
        <div className="settingsKV">
          <span>自动清理 (天)</span>
          <input
            className="settingsInput"
            type="number"
            min={0}
            value={rec?.auto_cleanup_days ?? 0}
            onChange={(e) => handleNumberChange('auto_cleanup_days', e.target.value)}
          />
        </div>
        <div className="settingsKV">
          <span>闲时扫描</span>
          <select
            className="settingsSelect"
            value={rec?.idle_scan_enabled ? 'on' : 'off'}
            onChange={(e) => handleBoolChange('idle_scan_enabled', e.target.value === 'on')}
          >
            <option value="off">关闭</option>
            <option value="on">开启</option>
          </select>
        </div>
        {rec?.idle_scan_enabled && (
          <>
            <div className="settingsKV">
              <span>闲时开始</span>
              <input
                className="settingsInput"
                type="number"
                min={0}
                max={23}
                value={rec?.idle_scan_start_hour ?? 2}
                onChange={(e) => handleNumberChange('idle_scan_start_hour', e.target.value)}
              />
            </div>
            <div className="settingsKV">
              <span>闲时结束</span>
              <input
                className="settingsInput"
                type="number"
                min={0}
                max={23}
                value={rec?.idle_scan_end_hour ?? 6}
                onChange={(e) => handleNumberChange('idle_scan_end_hour', e.target.value)}
              />
            </div>
          </>
        )}
        {isPending && <div className="settingsSaving">保存中...</div>}
        {saveError && <div className="settingsError">{saveError}</div>}
      </div>

      <div className="settingsSection">
        <div className="settingsSectionTitle">说明</div>
        <div className="settingsKV">
          <span>扫描间隔</span>
          <strong>系统每隔此秒数自动扫描录像源目录，最小 30 秒。</strong>
        </div>
        <div className="settingsKV">
          <span>跳过最近</span>
          <strong>跳过最近 N 秒内修改的文件（可能正在写入中）。</strong>
        </div>
        <div className="settingsKV">
          <span>ffprobe 并发</span>
          <strong>同时执行 ffprobe 的最大数量。数值越大扫描越快，但 CPU 占用越高。建议 2-8。</strong>
        </div>
        <div className="settingsKV">
          <span>自动清理</span>
          <strong>自动移除超过 N 天的片段索引（原始文件保留）。设为 0 表示不清理。</strong>
        </div>
        <div className="settingsKV">
          <span>闲时扫描</span>
          <strong>开启后，定时扫描只在指定时段内执行，手动扫描不受限制。避免白天 CPU 占用过高。</strong>
        </div>
        <div className="settingsKV">
          <span>录像根路径</span>
          <strong>录像根路径在录像源页面中管理，此处仅显示当前值。</strong>
        </div>
      </div>
    </div>
  )
}
