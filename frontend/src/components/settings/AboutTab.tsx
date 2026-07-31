import { BookOpen, Code, HardDrives, Info } from '@phosphor-icons/react'
import type { SystemStatus } from '../../types'

export function AboutTab({ status }: { status: SystemStatus | null }) {
  return (
    <div className="redesignAboutLayout">
      <section className="aboutProductCard"><img src="/clipline-logo.svg" alt="Clipline" /><div><h2>Clipline</h2><p>本地视频片段的扫描、回放、识别和导出工作台。</p><span>版本 {status?.version ?? '0.1.0'}</span></div></section>
      <section className="settingsSection aboutRuntime"><div className="settingsSectionTitle">运行环境</div><div className="settingsKV"><span>前端</span><strong>React · Vite</strong></div><div className="settingsKV"><span>后端</span><strong>FastAPI · Python</strong></div><div className="settingsKV"><span>数据库</span><strong>{status?.database.available ? 'SQLite · 可用' : 'SQLite · 未连接'}</strong></div><div className="settingsKV"><span>媒体工具</span><strong>FFmpeg {status?.ffmpeg.available ? '可用' : '不可用'} · ffprobe {status?.ffprobe.available ? '可用' : '不可用'}</strong></div></section>
      <section className="aboutLinksCard">
        <a href="https://github.com/HappyQuQu/clipline" target="_blank" rel="noreferrer"><Code size={17} />项目仓库</a>
        <a href="https://github.com/HappyQuQu/clipline/blob/main/docs/API_AND_DB.md" target="_blank" rel="noreferrer"><BookOpen size={17} />接口与数据文档</a>
        <span><Info size={17} />当前仓库未声明独立许可证</span>
        <span><HardDrives size={17} />数据默认保存在本地服务目录</span>
      </section>
    </div>
  )
}
