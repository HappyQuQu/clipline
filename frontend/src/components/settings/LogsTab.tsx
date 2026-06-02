import { useSettings } from './useSettings'

export function LogsTab() {
  const { settings, update, isPending, saveError } = useSettings()
  const logs = settings?.logs

  function handleSelectChange(key: string, value: string) {
    update({ [key]: value })
  }

  return (
    <div className="settingsSections">
      <div className="settingsSection">
        <div className="settingsSectionTitle">📝 日志配置</div>
        <div className="settingsKV">
          <span>日志级别</span>
          <select
            className="settingsSelect"
            value={logs?.log_level ?? 'INFO'}
            onChange={(e) => handleSelectChange('log_level', e.target.value)}
          >
            <option value="DEBUG">DEBUG</option>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="ERROR">ERROR</option>
          </select>
        </div>
        <div className="settingsKV">
          <span>日志格式</span>
          <select
            className="settingsSelect"
            value={logs?.log_format ?? 'text'}
            onChange={(e) => handleSelectChange('log_format', e.target.value)}
          >
            <option value="text">文本</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <div className="settingsKV">
          <span>日志文件</span>
          <strong>{logs?.log_file ?? '-'}</strong>
        </div>
        {isPending && <div className="settingsSaving">保存中...</div>}
        {saveError && <div className="settingsError">{saveError}</div>}
      </div>
    </div>
  )
}
