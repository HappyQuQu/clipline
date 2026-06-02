import { useSettings } from './useSettings'

export function ExportTab() {
  const { settings, update, isPending, saveError } = useSettings()
  const exp = settings?.export

  function handleNumberChange(key: string, value: string) {
    const num = parseInt(value, 10)
    if (!isNaN(num) && num >= 0) {
      update({ [key]: num })
    }
  }

  function handleSelectChange(key: string, value: string) {
    update({ [key]: value })
  }

  return (
    <div className="settingsSections">
      <div className="settingsSection">
        <div className="settingsSectionTitle">📦 导出配置</div>
        <div className="settingsKV">
          <span>缓存保留 (小时)</span>
          <input
            className="settingsInput"
            type="number"
            min={1}
            value={exp?.export_ttl_hours ?? 24}
            onChange={(e) => handleNumberChange('export_ttl_hours', e.target.value)}
          />
        </div>
        <div className="settingsKV">
          <span>最大时长 (分钟)</span>
          <input
            className="settingsInput"
            type="number"
            min={1}
            value={exp?.max_export_minutes ?? 30}
            onChange={(e) => handleNumberChange('max_export_minutes', e.target.value)}
          />
        </div>
        <div className="settingsKV">
          <span>最大并发数</span>
          <input
            className="settingsInput"
            type="number"
            min={1}
            max={10}
            value={exp?.max_concurrent_exports ?? 1}
            onChange={(e) => handleNumberChange('max_concurrent_exports', e.target.value)}
          />
        </div>
        <div className="settingsKV">
          <span>缩略图模式</span>
          <select
            className="settingsSelect"
            value={exp?.thumbnail_mode ?? 'middle'}
            onChange={(e) => handleSelectChange('thumbnail_mode', e.target.value)}
          >
            <option value="middle">中间帧</option>
            <option value="first">首帧</option>
            <option value="random">随机帧</option>
          </select>
        </div>
        {isPending && <div className="settingsSaving">保存中...</div>}
        {saveError && <div className="settingsError">{saveError}</div>}
      </div>

      <div className="settingsSection">
        <div className="settingsSectionTitle">说明</div>
        <div className="settingsKV">
          <span>缓存保留</span>
          <strong>导出文件在此时间后自动清理。设为 0 则不自动清理。</strong>
        </div>
        <div className="settingsKV">
          <span>最大时长</span>
          <strong>单次导出的最大时间范围，超过此限制将被拒绝。</strong>
        </div>
        <div className="settingsKV">
          <span>最大并发</span>
          <strong>同时进行的导出任务数量。设为 1 则排队执行。</strong>
        </div>
        <div className="settingsKV">
          <span>缩略图模式</span>
          <strong>生成缩略图时选取的帧位置。</strong>
        </div>
      </div>
    </div>
  )
}
