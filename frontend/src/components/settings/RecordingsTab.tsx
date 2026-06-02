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

  return (
    <div className="settingsSections">
      <div className="settingsSection">
        <div className="settingsSectionTitle">📁 录制源配置</div>
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
          <span>录像根路径</span>
          <strong>录像根路径在录像源页面中管理，此处仅显示当前值。</strong>
        </div>
      </div>
    </div>
  )
}
