import { useState } from 'react'
import type { Source, SystemStatus } from '../../types'
import { AboutTab } from './AboutTab'
import { ASRTab } from './ASRTab'
import { ExportTab } from './ExportTab'
import { LogsTab } from './LogsTab'
import { OverviewTab } from './OverviewTab'
import { RecordingsTab } from './RecordingsTab'

type SettingsTab = 'overview' | 'recordings' | 'export' | 'asr' | 'logs' | 'about'

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'recordings', label: '录制源' },
  { key: 'export', label: '导出' },
  { key: 'asr', label: '语音识别' },
  { key: 'logs', label: '日志' },
  { key: 'about', label: '关于' },
]

export function SettingsPage({
  sources,
  status,
  onRefresh,
  busy,
}: {
  sources: Source[]
  status: SystemStatus | null
  onRefresh: () => void
  busy: boolean
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('overview')

  return (
    <section className="modulePanel">
      <div className="moduleHead">
        <div>
          <div className="moduleTitle">系统设置</div>
          <div className="moduleMeta">管理运行配置、导出策略和语音识别。</div>
        </div>
      </div>

      <div className="settingsTabBar">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`settingsTabItem${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <OverviewTab sources={sources} status={status} onRefresh={onRefresh} busy={busy} />
      )}
      {activeTab === 'recordings' && <RecordingsTab />}
      {activeTab === 'export' && <ExportTab />}
      {activeTab === 'asr' && <ASRTab />}
      {activeTab === 'logs' && <LogsTab />}
      {activeTab === 'about' && <AboutTab />}
    </section>
  )
}
