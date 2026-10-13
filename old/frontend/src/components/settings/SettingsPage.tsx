import { Archive, ChartBar, DownloadSimple, FileText, Gear, Info, Scan, Sparkle, SpinnerGap } from '@phosphor-icons/react'
import { useState } from 'react'
import type { Source, SystemStatus } from '../../types'
import { AboutTab } from './AboutTab'
import { ASRTab } from './ASRTab'
import { ExportTab } from './ExportTab'
import { LogsTab } from './LogsTab'
import { OverviewTab } from './OverviewTab'
import { RecordingsTab } from './RecordingsTab'
import { SettingsDraftProvider, SettingsSaveBar } from './useSettings'

export type SettingsTab = 'overview' | 'recordings' | 'export' | 'asr' | 'models' | 'logs' | 'about'

export const SETTINGS_TABS = [
  { key: 'overview' as const, label: '概览', icon: ChartBar, desc: '快速确认 Clipline 的运行状态、存储路径和缓存占用' },
  { key: 'recordings' as const, label: '扫描与索引', icon: Scan, desc: '设置新文件发现、索引校验和缩略图生成规则' },
  { key: 'export' as const, label: '导出', icon: DownloadSimple, desc: '配置默认导出模式、时长限制与缓存清理' },
  { key: 'asr' as const, label: '识别与任务', icon: Sparkle, desc: '管理语音、视觉模型和后台任务并发' },
  { key: 'models' as const, label: '模型管理', icon: Archive, desc: '下载、查看和清理本地语音模型，并检查视觉模型加载状态' },
  { key: 'logs' as const, label: '日志与诊断', icon: FileText, desc: '设置运行日志、保留周期和故障诊断' },
  { key: 'about' as const, label: '关于', icon: Info, desc: '查看版本、运行环境和开源组件信息' },
]

export function SettingsPage({
  sources, status, onRefresh, busy, activeTab: controlledTab, onTabChange, onOpenSources, embedded = false,
}: {
  sources: Source[]
  status: SystemStatus | null
  onRefresh: () => void
  busy: boolean
  activeTab?: SettingsTab
  onTabChange?: (tab: SettingsTab) => void
  onOpenSources?: () => void
  embedded?: boolean
}) {
  const [internalTab, setInternalTab] = useState<SettingsTab>('overview')
  const activeTab = controlledTab ?? internalTab
  const setActiveTab = onTabChange ?? setInternalTab
  const currentTab = SETTINGS_TABS.find((t) => t.key === activeTab)!

  return (
    <div className={`settingsLayout${embedded ? ' settingsLayoutEmbedded' : ''}`}>
      {!embedded && <nav className="settingsNav">
        <div className="settingsNavTitle">
          <Gear size={16} />
          <span>全局设置</span>
        </div>
        <p className="settingsNavHint">这里管理系统默认值；单个摄像头的覆盖项放在录像源管理里。</p>
        <div className="settingsNavContent">
          {SETTINGS_TABS.map((tab) => {
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
      </nav>}

      <SettingsDraftProvider>
        <main className="settingsContent">
          <header className="redesignManagePageHeader settingsPageHeader">
            <div><small>管理 / 设置 / {currentTab.label}</small><h1>{currentTab.label}</h1><p>{currentTab.desc}</p></div>
            {activeTab === 'overview' && <button type="button" className="manageSecondary" onClick={onRefresh} disabled={busy}><SpinnerGap size={16} className={busy ? 'spinning' : ''} />刷新状态</button>}
          </header>
          <div className="settingsContentBody">
            {activeTab === 'overview' && <OverviewTab sources={sources} status={status} onOpenSources={onOpenSources} />}
            {activeTab === 'recordings' && <RecordingsTab />}
            {activeTab === 'export' && <ExportTab />}
            {activeTab === 'asr' && <ASRTab mode="settings" />}
            {activeTab === 'models' && <ASRTab mode="models" />}
            {activeTab === 'logs' && <LogsTab />}
            {activeTab === 'about' && <AboutTab status={status} />}
          </div>
          <SettingsSaveBar editable={!['overview', 'models', 'about'].includes(activeTab)} />
        </main>
      </SettingsDraftProvider>
    </div>
  )
}
