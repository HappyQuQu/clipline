import { CheckCircle, DownloadSimple, FileText, Pulse } from '@phosphor-icons/react'
import { useState } from 'react'
import { api } from '../../api'
import { queryMessage } from '../../utils'
import { useSettings } from './useSettings'

export function LogsTab() {
  const { settings, update } = useSettings()
  const logs = settings?.logs
  const [checking, setChecking] = useState(false)
  const [diagnostic, setDiagnostic] = useState('')
  const [logLines, setLogLines] = useState<string[]>([])

  async function runCheck() {
    setChecking(true)
    try {
      const status = await api.status()
      const healthy = status.database.available && status.recordingsRoot.readable && status.ffmpeg.available && status.ffprobe.available
      setDiagnostic(healthy ? '系统检查通过：数据库、录像目录、FFmpeg 与 ffprobe 均可用。' : '系统检查发现异常，请在概览中确认数据库、录像目录和媒体工具状态。')
    } catch (error) {
      setDiagnostic(queryMessage(error, '系统检查失败'))
    } finally {
      setChecking(false)
    }
  }

  async function loadLogs() {
    setChecking(true)
    try {
      const result = await api.systemLogs(200)
      setLogLines(result.lines)
      setDiagnostic(`已读取 ${result.lines.length} 行日志：${result.path}`)
    } catch (error) {
      setDiagnostic(queryMessage(error, '读取日志失败'))
    } finally {
      setChecking(false)
    }
  }

  function downloadLogs() {
    const url = URL.createObjectURL(new Blob([logLines.join('\n')], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `clipline-system-log-${new Date().toISOString().slice(0, 10)}.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="settingsSections">
      <section className="settingsSection">
        <div className="settingsSectionTitle">运行日志</div>
        <div className="settingsKV"><span>日志级别</span><select className="settingsSelect" value={logs?.log_level ?? 'INFO'} onChange={(event) => update({ log_level: event.target.value })}><option value="DEBUG">DEBUG · 调试</option><option value="INFO">INFO · 推荐</option><option value="WARNING">WARNING</option><option value="ERROR">ERROR</option></select></div>
        <div className="settingsKV"><span>日志格式</span><select className="settingsSelect" value={logs?.log_format ?? 'text'} onChange={(event) => update({ log_format: event.target.value })}><option value="text">文本</option><option value="json">JSON</option></select></div>
        <div className="settingsKV"><span>日志文件</span><strong title={logs?.log_file}>{logs?.log_file ?? '-'}</strong></div>
      </section>

      <section className="settingsSection">
        <div className="settingsSectionTitle">诊断工具</div>
        <div className="settingsDiagnosticActions">
          <button type="button" className="manageSecondary" disabled={checking} onClick={() => void runCheck()}><Pulse size={16} />运行系统检查</button>
          <button type="button" className="manageSecondary" disabled={checking} onClick={() => void loadLogs()}><FileText size={16} />读取最近日志</button>
          <button type="button" className="manageSecondary" disabled={!logLines.length} onClick={downloadLogs}><DownloadSimple size={16} />下载日志文本</button>
        </div>
        {diagnostic && <p className="settingsDiagnosticResult" aria-live="polite"><CheckCircle size={17} weight="fill" />{diagnostic}</p>}
        {logLines.length > 0 && <pre className="settingsLogPreview">{logLines.slice(-20).join('\n')}</pre>}
      </section>
    </div>
  )
}
