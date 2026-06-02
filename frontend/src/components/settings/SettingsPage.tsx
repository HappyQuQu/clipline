import { BarChart3, BookOpen, Camera, Clock, Download, Info, Mic, Settings as SettingsIcon } from 'lucide-react'
import { useState } from 'react'
import type { Source, SystemStatus } from '../../types'
import { AboutTab } from './AboutTab'
import { ASRTab } from './ASRTab'
import { ExportTab } from './ExportTab'
import { LogsTab } from './LogsTab'
import { OverviewTab } from './OverviewTab'
import { RecordingsTab } from './RecordingsTab'

type SettingsTab = 'overview' | 'recordings' | 'export' | 'asr' | 'logs' | 'about'

const TABS: { key: SettingsTab; label: string; icon: typeof SettingsIcon; desc: string }[] = [
  { key: 'overview', label: '概览', icon: BarChart3, desc: '系统状态和缓存' },
  { key: 'recordings', label: '录像源', icon: Camera, desc: '扫描和录制配置' },
  { key: 'export', label: '导出', icon: Download, desc: '导出策略和缓存' },
  { key: 'asr', label: '语音识别', icon: Mic, desc: '识别引擎和模型' },
  { key: 'logs', label: '日志', icon: Clock, desc: '运行日志查看' },
  { key: 'about', label: '关于', icon: Info, desc: '版本和系统信息' },
]

export function SettingsPage({
  sources, status, onRefresh, busy,
}: {
  sources: Source[]; status: SystemStatus | null; onRefresh: () => void; busy: boolean
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('overview')
  const currentTab = TABS.find((t) => t.key === activeTab)!

  return (
    <div className="settingsLayout">
      <nav className="settingsNav">
        <div className="settingsNavTitle">
          <SettingsIcon size={16} />
          <span>系统设置</span>
        </div>
        <div className="settingsNavContent">
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                className={`settingsNavItem${activeTab === tab.key ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <Icon size={18} />
                <div className="settingsNavItemText">
                  <span>{tab.label}</span>
                  <small>{tab.desc}</small>
                </div>
              </button>
            )
          })}
        </div>
      </nav>

      <main className="settingsContent">
        <div className="settingsContentHeader">
          <div className="settingsHeaderIcon">
            <currentTab.icon size={24} />
          </div>
          <div>
            <h2>{currentTab.label}</h2>
            <p>{currentTab.desc}</p>
          </div>
        </div>
        <div className="settingsContentBody">
          {activeTab === 'overview' && <OverviewTab sources={sources} status={status} onRefresh={onRefresh} busy={busy} />}
          {activeTab === 'recordings' && <RecordingsTab />}
          {activeTab === 'export' && <ExportTab />}
          {activeTab === 'asr' && <ASRTab />}
          {activeTab === 'logs' && <LogsTab />}
          {activeTab === 'about' && <AboutTab />}
        </div>
      </main>
    </div>
  )
}
