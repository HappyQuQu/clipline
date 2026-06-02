export function AboutTab() {
  return (
    <div className="settingsSections">
      <div className="settingsSection">
        <div className="settingsSectionTitle">关于 Clipline</div>
        <div className="settingsKV">
          <span>版本</span>
          <strong>0.1.0</strong>
        </div>
        <div className="settingsKV">
          <span>项目</span>
          <strong>行车记录仪 / 安防录像 / NAS 备份的工作站</strong>
        </div>
        <div className="settingsKV">
          <span>技术栈</span>
          <strong>React + FastAPI + FFmpeg + SQLite</strong>
        </div>
        <div className="settingsKV">
          <span>部署</span>
          <strong>Docker Compose</strong>
        </div>
      </div>

      <div className="settingsSection">
        <div className="settingsSectionTitle">🚀 项目简介</div>
        <div className="settingsKV">
          <span>功能</span>
          <strong>自动扫描、时间轴浏览、智能导出、语音识别。</strong>
        </div>
        <div className="settingsKV">
          <span>优势</span>
          <strong>高性能、低资源占用、易于扩展。</strong>
        </div>
        <div className="settingsKV">
          <span>适用场景</span>
          <strong>行车记录仪、安防监控、NAS 存储管理。</strong>
        </div>
      </div>
    </div>
  )
}
