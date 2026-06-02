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

      <div className="settingsSection">
        <div className="settingsSectionTitle">💡 日志级别说明</div>
        <div className="settingsKV">
          <span>DEBUG</span>
          <strong>输出所有调试信息，适合开发排查问题。</strong>
        </div>
        <div className="settingsKV">
          <span>INFO</span>
          <strong>输出常规运行信息，推荐日常使用。</strong>
        </div>
        <div className="settingsKV">
          <span>WARNING</span>
          <strong>仅输出警告和错误信息。</strong>
        </div>
        <div className="settingsKV">
          <span>ERROR</span>
          <strong>仅输出错误信息，日志最少。</strong>
        </div>
      </div>
    </div>
  )
}
