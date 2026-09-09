import { useMemo, useState } from "react";
import {
  Archive,
  Bell,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  Clock,
  DownloadSimple,
  Eye,
  FileText,
  FilmStrip,
  FolderOpen,
  Funnel,
  Gear,
  HardDrives,
  Info,
  ListChecks,
  MagnifyingGlass,
  Microphone,
  Pause,
  Play,
  Plus,
  Scan,
  SlidersHorizontal,
  Sparkle,
  SpinnerGap,
  SquaresFour,
  Trash,
  User,
  VideoCamera,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

const navItems = [
  { id: "review", label: "回看", icon: Play },
  { id: "library", label: "片段库", icon: Archive },
  { id: "tasks", label: "任务", icon: ListChecks },
  { id: "manage", label: "管理", icon: Gear },
];

const clips = [
  { id: 1, time: "09:35", range: "09:35:48 – 09:41:10", duration: "05:22", status: "已识别", tone: "green", asset: "/assets/printer-0935.jpg", labels: ["chair", "laptop"] },
  { id: 2, time: "09:30", range: "09:30:20 – 09:35:48", duration: "05:28", status: "未识别", tone: "neutral", asset: "/assets/printer-0930.jpg", labels: [] },
  { id: 3, time: "09:24", range: "09:24:58 – 09:30:20", duration: "05:22", status: "视觉完成", tone: "blue", asset: "/assets/printer-0924.jpg", labels: ["chair"] },
  { id: 4, time: "09:19", range: "09:19:38 – 09:24:57", duration: "05:19", status: "视觉完成", tone: "blue", asset: "/assets/printer-0919.jpg", labels: ["laptop"] },
  { id: 5, time: "09:14", range: "09:14:12 – 09:19:37", duration: "05:25", status: "未识别", tone: "neutral", asset: "/assets/printer-0914.jpg", labels: [] },
  { id: 6, time: "09:08", range: "09:08:28 – 09:14:12", duration: "05:44", status: "未识别", tone: "neutral", asset: "/assets/printer-0914.jpg", labels: [] },
];

const taskRows = [
  { name: "00_20260602093548_20260602094110.mp4", source: "xiaomi · 09:35", kind: "语音识别", created: "6月2日 12:18", status: "已完成", progress: 100, result: "可查看字幕" },
  { name: "00_20260602093548_20260602094110.mp4", source: "xiaomi · 09:35", kind: "视觉识别", created: "6月2日 12:19", status: "已完成", progress: 100, result: "17 个标注" },
  { name: "xiaomi_20260602_093548-094110.mp4", source: "xiaomi · 09:35–09:41", kind: "精准导出", created: "6月2日 12:24", status: "进行中", progress: 68, result: "正在转码" },
  { name: "xiaomi_20260602_083112-083645.mp4", source: "xiaomi · 08:31–08:36", kind: "快速导出", created: "6月2日 11:42", status: "已完成", progress: 100, result: "下载 · 61 MB", downloadable: true },
  { name: "00_20260602093020_20260602093548.mp4", source: "xiaomi · 09:30", kind: "语音识别", created: "尚未创建", status: "待处理", progress: 0, result: "未创建" },
  { name: "00_20260602092458_20260602093020.mp4", source: "xiaomi · 09:24", kind: "视觉识别", created: "6月2日 12:20", status: "失败", progress: 41, result: "模型不可用" },
];

const sourceRows = [
  { name: "工作室", path: "/recordings/xiaomi-nas", status: "已启用", scan: "手动扫描", segments: 123, failed: 0, updated: "6月2日 12:07" },
];

const logs = [
  { time: "6月2日 12:24", level: "导出", event: "创建精准导出任务", source: "工作室", detail: "09:35:48 – 09:41:10 · 转码中" },
  { time: "6月2日 12:20", level: "识别", event: "视觉识别任务失败", source: "工作室", detail: "00_20260602092458… · 模型不可用" },
  { time: "6月2日 12:19", level: "识别", event: "视觉识别完成", source: "工作室", detail: "画面标签 · 3D 打印机、工作台" },
  { time: "6月2日 12:18", level: "识别", event: "语音识别完成", source: "工作室", detail: "生成字幕 6 条" },
  { time: "6月2日 12:07", level: "扫描", event: "手动扫描已完成", source: "工作室", detail: "123/123 文件 · 123 入库 · 0 错误" },
];

function AppShell({ page, setPage, children }) {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPage("review")} aria-label="返回回看">
          <img src="/assets/clipline-logo-v2.png" alt="" />
          <span>Clipline</span>
        </button>
        <div className={`global-search ${searchOpen ? "is-open" : ""}`}>
          <MagnifyingGlass size={19} />
          <input
            aria-label="全局搜索"
            placeholder="搜索字幕内容"
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
          />
          <kbd>⌘ K</kbd>
          {searchOpen && (
            <div className="search-results">
              <p>字幕与片段结果</p>
              <button onMouseDown={() => setPage("review")}><Play />“打印完成后先不要取下”<span>09:36:14</span></button>
              <button onMouseDown={() => setPage("library")}><Archive />xiaomi · 6月2日 09:35<span>片段</span></button>
              <button onMouseDown={() => setPage("tasks")}><Microphone />语音识别任务<span>已完成</span></button>
            </div>
          )}
        </div>
        <div className="top-actions">
          <button className="icon-button notification" aria-label="通知"><Bell size={20} /><span /></button>
          <button className="account-button"><span className="avatar">管</span><span>管理员</span><CaretDown size={14} /></button>
        </div>
      </header>
      <aside className="nav-rail" aria-label="主导航">
        <div className="nav-stack">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={page === item.id ? "nav-item active" : "nav-item"}
                key={item.id}
                onClick={() => setPage(item.id)}
              >
                <Icon size={23} weight={page === item.id ? "fill" : "regular"} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
        <button className="nav-collapse" aria-label="收起导航"><CaretLeft size={17} /></button>
      </aside>
      <main className="page-stage">{children}</main>
    </div>
  );
}

function SelectButton({ children, icon: Icon, options, value, onChange, label, disabled = false }) {
  const optionSets = {
    "全部状态": ["全部状态", "已启用", "已停用"],
    "全部类型": ["全部类型", "扫描", "识别", "导出"],
    "手动扫描": ["手动扫描", "定时扫描", "自动监听"],
    "按需运行": ["按需运行", "扫描后自动运行", "关闭"],
    "每 30 分钟": ["每 15 分钟", "每 30 分钟", "每 60 分钟"],
    "片段 30% 位置": ["片段开头", "片段 30% 位置", "片段中间"],
    "最多 2 次": ["不重试", "最多 2 次", "最多 3 次"],
    "快速 · 关键帧切割": ["快速 · 关键帧切割", "精准 · 重新编码"],
    "30 分钟": ["15 分钟", "30 分钟", "60 分钟", "不限制"],
    "10 GB": ["5 GB", "10 GB", "20 GB"],
    "24 小时": ["6 小时", "24 小时", "7 天"],
    "Whisper · small": ["Whisper · tiny", "Whisper · small", "FunASR · paraformer-zh"],
    "自动检测": ["自动检测", "中文", "英语"],
    "1 个任务": ["1 个任务", "2 个任务", "4 个任务"],
    "SRT + TXT": ["SRT + TXT", "SRT", "VTT"],
    "本地模型 · 默认": ["本地模型 · 默认", "YOLOv8n"],
    "INFO · 推荐": ["DEBUG · 调试", "INFO · 推荐", "WARNING · 警告", "ERROR · 错误"],
    "30 天": ["7 天", "30 天", "90 天"],
  };
  const available = options || optionSets[String(children)] || [String(children)];
  return <span className={`select-button native-select${disabled ? " is-disabled" : ""}`}>{Icon && <Icon size={18} />}<select aria-label={label || String(children)} value={value} defaultValue={value === undefined ? String(children) : undefined} disabled={disabled} onChange={(event) => onChange?.(event.target.value)}>{available.map((option) => <option key={option} value={option}>{option}</option>)}</select><CaretDown size={15} /></span>;
}

function ReviewPage({ onExport }) {
  const [playing, setPlaying] = useState(false);
  const [selectedClip, setSelectedClip] = useState(1);
  const [inspector, setInspector] = useState(false);
  const [notice, setNotice] = useState("");

  const runScan = () => {
    setNotice("扫描任务已创建：xiaomi");
    window.setTimeout(() => setNotice(""), 2200);
  };

  return (
    <div className="review-page">
      <aside className="context-panel">
        <section className="source-context">
          <div className="source-context-title"><strong>xiaomi</strong><span>已启用</span></div>
          <p className="muted-path">/Users/qu/Desktop/<br />XiaomiCamera_00_B88880972E7E</p>
          <div className="source-facts">
            <span><FilmStrip size={17} />123 个片段</span>
            <span><Clock size={17} />最近扫描 6月2日 12:07</span>
          </div>
        </section>
        <section>
          <label>日期</label>
          <button className="field-button"><span>2026年6月2日</span><CalendarBlank size={18} /></button>
        </section>
        <section>
          <label>显示范围</label>
          <SelectButton>09:00 – 10:00</SelectButton>
        </section>
        <button className="secondary scan-button" onClick={runScan}><Scan size={18} />立即扫描</button>
        <p className="context-note"><Info size={15} />录像源是已挂载的视频目录。扫描只建立索引，不修改源文件。</p>
      </aside>

      <section className="review-workspace">
        <div className="video-frame">
          <img src="/assets/printer-main.png" alt="xiaomi 录像片段中的 3D 打印机画面" />
          <div className="video-meta"><span>xiaomi · 00_20260602093548…mp4</span><span>2026-06-02&nbsp; 09:35:48</span></div>
          <div className="playback-controls">
            <button onClick={() => setPlaying(!playing)} aria-label={playing ? "暂停" : "播放"}>
              {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
            </button>
            <span className="skip">↶10</span><span className="skip">↷10</span>
            <strong>09:35:48</strong><span>/ 09:41:10</span>
            <div className="control-spacer" />
            <span>1.0×</span><SlidersHorizontal size={20} />
          </div>
        </div>

        <RecordingTimeline onExport={onExport} />

        <div className="clips-header">
          <div><h2>录像片段 <span>123</span></h2><p>选择片段会同步定位到真实时间</p></div>
          <div className="header-actions">
            <button className="secondary"><Microphone size={18} />识别字幕</button>
            <button className="primary" onClick={onExport}><DownloadSimple size={18} />导出区间</button>
          </div>
        </div>
        <div className="clip-strip">
          {clips.slice(0, 5).map((clip) => (
            <button key={clip.id} className={selectedClip === clip.id ? "clip-card selected" : "clip-card"} onClick={() => { setSelectedClip(clip.id); setInspector(true); }}>
              <div className="clip-image" style={{ backgroundImage: `url('${clip.asset}')` }}><span>{clip.time}</span></div>
              <strong>{clip.range}</strong>
              <div className="clip-meta"><small className={clip.tone}>{clip.status}</small><em>{clip.duration}</em></div>
            </button>
          ))}
          <button className="strip-next" aria-label="更多片段"><CaretRight /></button>
        </div>
      </section>

      <button className="inspector-handle" onClick={() => setInspector(true)} aria-label="打开片段详情"><CaretLeft /></button>
      {inspector && <ClipInspector clip={clips.find((item) => item.id === selectedClip)} onClose={() => setInspector(false)} onExport={onExport} />}
      {notice && <div className="toast"><CheckCircle size={20} weight="fill" />{notice}</div>}
    </div>
  );
}

function RecordingTimeline({ onExport }) {
  const segments = ["0/6", "7/12", "13/18", "18.5/25", "26/31", "32/39", "40/47", "48/54", "55/61", "62/68", "70/76", "77/84", "85/91", "92/98"];
  return (
    <div className="timeline-panel recording-timeline">
      <div className="timeline-toolbar">
        <button className="secondary compact"><CaretLeft />上一片段</button>
        <button className="secondary compact">下一片段<CaretRight /></button>
        <span>缩放</span><button>−</button><input type="range" min="0" max="100" defaultValue="35" /><button>＋</button>
        <div className="timeline-date"><CalendarBlank />2026年6月2日</div>
        <div className="shortcuts">27 个断档 <span className="legend-recorded" />有录像 <span className="legend-gap" />断档</div>
      </div>
      <div className="time-ruler compact-ruler"><span>09:00</span><span>09:10</span><span>09:20</span><span>09:30</span><span>09:40</span><span>09:50</span><span>10:00</span></div>
      <div className="tracks">
        <Track label="录像片段" tone="blue" segments={segments} />
        <div className="playhead"><span>09:35:48</span></div>
      </div>
      <div className="export-row">
        <div className="range-selection"><span className="range-handle">Ⅱ</span><Clock size={16} /><strong>09:35:48&nbsp;&nbsp; – &nbsp;&nbsp;09:41:10</strong><em>(05:22)</em><span className="range-handle">Ⅱ</span></div>
        <div className="gap-warning"><WarningCircle weight="fill" />包含 18 秒未索引片段</div>
        <div className="mode-switch"><span>导出模式</span><button className="active">快速</button><button>精准</button></div>
        <button className="primary" onClick={onExport}><DownloadSimple />导出区间</button>
      </div>
    </div>
  );
}

function Track({ label, tone, segments }) {
  return (
    <div className={`track-row track-${tone}`}>
      <strong>{label}</strong>
      <div className="track-line">
        {segments.map((segment) => {
          const [left, right] = segment.split("/").map(Number);
          return <span key={segment} className="track-segment" style={{ left: `${left}%`, width: `${right - left}%` }} />;
        })}
      </div>
    </div>
  );
}

function ClipInspector({ clip, onClose, onExport }) {
  return (
    <aside className="inspector">
      <div className="inspector-title"><div><small>片段详情</small><h2>{clip?.time} 录像片段</h2></div><button className="icon-button" onClick={onClose}><X /></button></div>
      <div className="inspector-preview" style={{ backgroundImage: `url('${clip?.asset}')` }}><span><Play weight="fill" />{clip?.duration}</span></div>
      <dl>
        <div><dt>时间</dt><dd>{clip?.range}</dd></div>
        <div><dt>录像源</dt><dd>xiaomi</dd></div>
        <div><dt>时长</dt><dd>{clip?.duration}</dd></div>
        <div><dt>识别状态</dt><dd>{clip?.status}</dd></div>
        <div><dt>标签</dt><dd>{clip?.labels.length ? clip.labels.map((label) => <span className="tag" key={label}>{label}</span>) : "暂无标签"}</dd></div>
      </dl>
      <div className="recognition-actions"><button className="secondary"><Microphone />识别字幕</button><button className="secondary"><Eye />视觉识别</button></div>
      <div className="inspector-actions"><button className="secondary"><Play />打开回看</button><button className="primary" onClick={onExport}><DownloadSimple />导出片段</button></div>
    </aside>
  );
}

function LibraryPage({ onExport }) {
  const [selected, setSelected] = useState([2]);
  const [detail, setDetail] = useState(2);
  const [view, setView] = useState("grid");
  const toggle = (id) => setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  return (
    <div className="standard-page library-page">
      <PageHeader eyebrow="内容" title="片段库" subtitle="按日期、识别状态、视觉标签与字幕内容筛选已索引片段">
        <button className="secondary"><Microphone />批量识别</button>
        <button className="primary" onClick={onExport}><DownloadSimple />导出所选</button>
      </PageHeader>
      <div className="page-toolbar">
        <div className="inline-search"><MagnifyingGlass /><input placeholder="搜索文件名、标签或字幕" /></div>
        <SelectButton>xiaomi</SelectButton><SelectButton>全部识别状态</SelectButton><button className="filter-button"><CalendarBlank />2026年6月2日</button>
        <div className="toolbar-spacer" />
        <div className="view-switch"><button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><SquaresFour /></button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}><ListChecks /></button></div>
      </div>
      <div className="library-content">
        <section className={view === "grid" ? "library-grid" : "library-list"}>
          {clips.map((clip) => (
            <article key={clip.id} className={detail === clip.id ? "library-card selected" : "library-card"} onClick={() => setDetail(clip.id)}>
              <div className="library-image" style={{ backgroundImage: `url('${clip.asset}')` }}>
                <button className={selected.includes(clip.id) ? "select-check checked" : "select-check"} onClick={(event) => { event.stopPropagation(); toggle(clip.id); }}>{selected.includes(clip.id) && <Check weight="bold" />}</button>
                <span>{clip.time}</span>
              </div>
              <div className="library-card-copy"><div><strong>xiaomi · {clip.time}</strong><p>{clip.range} · {clip.duration}</p></div><small className={clip.tone}>{clip.status}</small></div>
            </article>
          ))}
        </section>
        <aside className="library-inspector">
          <div className="detail-heading"><div><small>片段详情</small><h2>xiaomi · {clips.find((c) => c.id === detail)?.time}</h2></div><button className="icon-button"><DotsIcon /></button></div>
          <div className="detail-preview" style={{ backgroundImage: `url('${clips.find((c) => c.id === detail)?.asset}')` }}><button><Play weight="fill" /></button></div>
          <dl><div><dt>录像源</dt><dd>xiaomi</dd></div><div><dt>日期</dt><dd>2026年6月2日</dd></div><div><dt>时长</dt><dd>{clips.find((c) => c.id === detail)?.duration}</dd></div><div><dt>状态</dt><dd>{clips.find((c) => c.id === detail)?.status}</dd></div><div><dt>标签</dt><dd>{clips.find((c) => c.id === detail)?.labels.length ? clips.find((c) => c.id === detail)?.labels.map((label) => <span className="tag" key={label}>{label}</span>) : "暂无标签"}</dd></div></dl>
          <div className="recognition-actions"><button className="secondary"><Microphone />识别字幕</button><button className="secondary"><Eye />视觉识别</button></div>
          <button className="primary full-width" onClick={onExport}><DownloadSimple />导出当前片段</button>
        </aside>
      </div>
      {selected.length > 0 && <div className="selection-bar"><span><CheckCircle weight="fill" />已选 {selected.length} 个片段</span><button onClick={() => setSelected([])}>取消选择</button><button className="secondary"><Eye />视觉识别</button><button className="primary" onClick={onExport}><DownloadSimple />合并导出</button></div>}
    </div>
  );
}

function TasksPage() {
  const [tab, setTab] = useState("全部");
  const filtered = tab === "全部" ? taskRows : taskRows.filter((task) => task.status === tab);
  return (
    <div className="standard-page">
      <PageHeader eyebrow="处理" title="任务" subtitle="集中查看导出、语音识别与视觉识别任务">
        <button className="secondary"><Trash />清理已完成</button>
      </PageHeader>
      <div className="segmented-tabs">
        {["全部", "进行中", "待处理", "已完成", "失败"].map((item) => <button key={item} onClick={() => setTab(item)} className={tab === item ? "active" : ""}>{item}<span>{item === "全部" ? taskRows.length : taskRows.filter((t) => t.status === item).length}</span></button>)}
      </div>
      <section className="task-table">
        <div className="table-head"><span>任务</span><span>类型</span><span>来源</span><span>状态</span><span>结果 / 进度</span><span /></div>
        {filtered.map((task) => (
          <div className="task-row" key={`${task.name}-${task.kind}`}>
            <div className="task-name"><span className={`task-icon ${task.status}`} >{task.status === "已完成" ? <CheckCircle weight="fill" /> : task.status === "失败" ? <WarningCircle weight="fill" /> : task.kind.includes("识别") ? <Sparkle /> : <DownloadSimple />}</span><span><strong>{task.name}</strong><small>{task.created}</small></span></div>
            <span>{task.kind}</span><span>{task.source}</span><span className={`status-pill ${task.status}`}>{task.status}</span>
            <div className="progress-cell"><div><span style={{ width: `${task.progress}%` }} /></div>{task.downloadable ? <button className="task-download"><DownloadSimple />下载 · 61 MB</button> : <em>{task.result}</em>}</div>
            <button className="icon-button"><DotsIcon /></button>
          </div>
        ))}
      </section>
      <div className="task-summary">
        <section><div className="summary-icon blue"><SpinnerGap /></div><div><small>处理中</small><strong>1 个导出</strong><p>精准模式正在转码</p></div></section>
        <section><div className="summary-icon green"><CheckCircle /></div><div><small>识别完成</small><strong>2 个任务</strong><p>字幕 36 条 · 标注 17 个</p></div></section>
        <section><div className="summary-icon purple"><WarningCircle /></div><div><small>需要处理</small><strong>1 个失败</strong><p>视觉模型当前不可用</p></div></section>
      </div>
    </div>
  );
}

export function ManagePage() {
  const [section, setSection] = useState("sources");
  const [settingsSection, setSettingsSection] = useState("overview");
  const settingsNav = [
    ["overview", "概览", HardDrives],
    ["scan", "扫描与索引", Scan],
    ["export", "导出", DownloadSimple],
    ["recognition", "识别与任务", Sparkle],
    ["models", "模型管理", Archive],
    ["diagnostics", "日志与诊断", FileText],
    ["about", "关于", Info],
  ];
  return (
    <div className="manage-page">
      <aside className="manage-sidebar">
        <div><small>工作区</small><h1>管理</h1></div>
        <nav>
          <button className={section === "sources" ? "active" : ""} onClick={() => setSection("sources")}><VideoCamera />录像源<CaretRight /></button>
          <button className={section === "logs" ? "active" : ""} onClick={() => setSection("logs")}><FileText />日志<CaretRight /></button>
          <button className={section === "settings" ? "active" : ""} onClick={() => setSection("settings")}><Gear />设置<CaretRight /></button>
        </nav>
        {section === "settings" && (
          <div className="settings-subnav" aria-label="设置分类">
            <span>设置分类</span>
            {settingsNav.map(([id, label, Icon]) => (
              <button key={id} className={settingsSection === id ? "active" : ""} onClick={() => setSettingsSection(id)}>
                <Icon />{label}
              </button>
            ))}
          </div>
        )}
        <div className="manage-help"><span className="manage-system-dot" /><strong>原型工作区</strong><p>使用示例数据体验管理流程</p><button onClick={() => { setSection("settings"); setSettingsSection("overview"); }}>查看系统概览<CaretRight size={14} /></button></div>
      </aside>
      <section className="manage-content">
        {section === "sources" && <SourcesPanel />}
        {section === "logs" && <LogsPanel />}
        {section === "settings" && <SettingsPanel activeSection={settingsSection} onOpenSources={() => setSection("sources")} onOpenLogs={() => setSection("logs")} />}
      </section>
    </div>
  );
}

function SourcesPanel() {
  const [sources, setSources] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("clipline-prototype-sources"));
      if (stored) return stored.map((source) => source.name === "xiaomi" && source.path === "/Users/qu/Desktop/XiaomiCamera_00_B88880972E7E" ? { ...source, name: "工作室", path: "/recordings/xiaomi-nas" } : source);
      return sourceRows.map((source, index) => ({ ...source, id: index + 1, asr: "按需运行", vision: "按需运行" }));
    }
    catch { return sourceRows.map((source, index) => ({ ...source, id: index + 1, asr: "按需运行", vision: "按需运行" })); }
  });
  const [selected, setSelected] = useState(sources[0]?.id);
  const [draft, setDraft] = useState(sources[0]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("全部状态");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState([]);
  const [notice, setNotice] = useState("");
  const notify = (message) => { setNotice(message); window.setTimeout(() => setNotice(""), 3000); };
  const persist = (items) => { setSources(items); localStorage.setItem("clipline-prototype-sources", JSON.stringify(items)); };
  const visible = sources.filter((source) => (status === "全部状态" || source.status === status) && `${source.name} ${source.path}`.toLowerCase().includes(query.toLowerCase()));
  const updateDraft = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const scan = (ids) => {
    const enabled = sources.filter((source) => ids.includes(source.id) && source.status === "已启用");
    if (!enabled.length) { notify("请先启用一个录像源"); return; }
    const scanIds = enabled.map((source) => source.id);
    setScanning((current) => [...new Set([...current, ...scanIds])]);
    notify(`正在扫描 ${enabled.length} 个录像源…`);
    window.setTimeout(() => {
      setScanning((current) => current.filter((id) => !scanIds.includes(id)));
      setSources((current) => {
        const next = current.map((source) => scanIds.includes(source.id) ? { ...source, updated: "刚刚", segments: source.segments || 12 } : source);
        localStorage.setItem("clipline-prototype-sources", JSON.stringify(next));
        return next;
      });
      notify("模拟扫描完成，录像索引已更新");
    }, 1400);
  };
  const save = () => {
    if (!draft.name.trim() || !draft.path.trim().startsWith("/")) { notify("请填写名称和以 / 开头的目录路径"); return; }
    if (sources.some((source) => source.id !== selected && source.name === draft.name.trim())) { notify("录像源名称已存在，请使用其他名称"); return; }
    persist(sources.map((source) => source.id === selected ? { ...source, ...draft, name: draft.name.trim(), path: draft.path.trim(), segments: source.segments, updated: source.updated } : source));
    notify("录像源配置已保存到此浏览器");
  };
  const addSource = (event) => {
    event.preventDefault();
    if (!newPath.trim().startsWith("/")) { setError("目录路径需要以 / 开头，例如 /recordings/living-room"); return; }
    if (sources.some((source) => source.name === newName.trim())) { setError("此名称已存在，请换一个名称"); return; }
    const source = { id: Date.now(), name: newName.trim(), path: newPath.trim(), status: "已启用", scan: "手动扫描", segments: 0, failed: 0, updated: "尚未扫描", asr: "按需运行", vision: "按需运行" };
    persist([...sources, source]); setSelected(source.id); setDraft(source); setAdding(false); setNewName(""); setNewPath(""); setQuery(""); setStatus("全部状态");
    notify("录像源已添加，可以开始模拟扫描");
  };
  const setEnabled = () => {
    const nextStatus = draft.status === "已启用" ? "已停用" : "已启用";
    updateDraft("status", nextStatus);
    persist(sources.map((source) => source.id === selected ? { ...source, status: nextStatus } : source));
    notify(`录像源${nextStatus}`);
  };
  return (
    <>
      <PageHeader eyebrow="工作区 / 管理" title="录像源" subtitle="连接录像目录，管理扫描与识别方式。"><button className="primary" onClick={() => { setAdding(true); setError(""); }}><Plus />添加录像源</button></PageHeader>
      <div className="manage-metrics"><div><span>录像源</span><strong>{sources.length}<small>个目录</small></strong></div><div><span>已索引</span><strong>{sources.reduce((total, source) => total + source.segments, 0)}<small>个片段</small></strong></div><div><span>可用状态</span><strong><i />{sources.filter((source) => source.status === "已启用").length}<small>个已启用</small></strong></div></div>
      <div className="page-toolbar"><div className="inline-search"><MagnifyingGlass /><input aria-label="搜索录像源" placeholder="搜索名称或目录路径" value={query} onChange={(event) => setQuery(event.target.value)} /></div><SelectButton value={status} onChange={setStatus}>全部状态</SelectButton><div className="toolbar-spacer" /><button className="secondary" disabled={scanning.length > 0} onClick={() => scan(sources.map((source) => source.id))}><Scan className={scanning.length ? "manage-scanning" : ""} />{scanning.length ? "扫描中…" : "扫描全部"}</button></div>
      <section className="sources-table">
        <div className="source-head"><span>录像源</span><span>目录路径</span><span>状态</span><span>已索引</span><span>最后扫描</span><span /></div>
        {visible.map((source) => (
          <button key={source.id} className={selected === source.id ? "source-row selected" : "source-row"} onClick={() => { setSelected(source.id); setDraft(source); }}>
            <span className="source-name"><span className="camera-tile"><FolderOpen /></span><span><strong>{source.name}</strong><small>{source.scan}</small></span></span>
            <span className="source-path" title={source.path}>{source.path}</span><span className={`source-status ${source.status}`}><i />{source.status}</span><span>{source.segments} 个片段</span><span>{scanning.includes(source.id) ? "扫描中…" : source.updated}</span><CaretRight size={16} />
          </button>
        ))}
        {!visible.length && <div className="manage-empty"><MagnifyingGlass size={28} /><strong>没有找到录像源</strong><p>试试其他名称，或调整状态筛选。</p><button className="secondary" onClick={() => { setQuery(""); setStatus("全部状态"); }}>清除筛选</button></div>}
      </section>
      {draft && <div className="source-detail">
        <div className="source-detail-heading"><span className="camera-tile"><VideoCamera size={23} /></span><div><small>录像源配置</small><h2>{sources.find((source) => source.id === selected)?.name}</h2></div><span className={`source-status ${draft.status}`}><i />{draft.status}</span></div>
        <div className="source-config"><div className="config-grid"><label>显示名称<input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} /></label><label>扫描方式<SelectButton value={draft.scan} onChange={(value) => updateDraft("scan", value)}>手动扫描</SelectButton></label><label className="wide">目录路径<input value={draft.path} onChange={(event) => updateDraft("path", event.target.value)} /></label><label>语音识别<SelectButton value={draft.asr || "按需运行"} onChange={(value) => updateDraft("asr", value)}>按需运行</SelectButton></label><label>视觉识别<SelectButton value={draft.vision || "按需运行"} onChange={(value) => updateDraft("vision", value)}>按需运行</SelectButton></label></div><p className="safe-note"><Info size={17} />只读取目录并建立索引，源视频始终保留。</p><div className="config-actions"><button className={draft.status === "已启用" ? "danger" : "secondary"} onClick={setEnabled}>{draft.status === "已启用" ? "停用录像源" : "启用录像源"}</button><div /><button className="secondary" disabled={scanning.includes(selected) || draft.status !== "已启用"} onClick={() => scan([selected])}><Scan />{scanning.includes(selected) ? "扫描中…" : "立即扫描"}</button><button className="primary" onClick={save}>保存更改</button></div></div>
        <aside className="source-detail-aside"><div className="source-preview" style={{ backgroundImage: "url('/assets/printer-main.png')" }}><span><FilmStrip />示例画面</span></div><h3>让录像可以被找到</h3><p>添加目录后，扫描会读取视频的时间与信息，生成可回看的录像索引。</p><span className="manage-prototype-note">原型演示 · 配置仅保存在此浏览器</span></aside>
      </div>}
      {adding && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setAdding(false)} onKeyDown={(event) => event.key === "Escape" && setAdding(false)}><form className="manage-source-modal" onSubmit={addSource} role="dialog" aria-modal="true" aria-labelledby="add-source-title"><div className="modal-heading"><div><small>连接一个新目录</small><h2 id="add-source-title">添加录像源</h2></div><button type="button" className="icon-button" aria-label="关闭添加录像源" onClick={() => setAdding(false)}><X /></button></div><p>为录像目录设置一个容易辨认的名称。</p><label>显示名称<input autoFocus required maxLength={40} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="例如：工作室" /></label><label>目录路径<input required value={newPath} onChange={(event) => setNewPath(event.target.value)} placeholder="/recordings/studio" /></label><p className="manage-prototype-note"><Info size={16} />原型演示不会访问或更改本地目录。</p>{error && <p className="manage-form-error" role="alert">{error}</p>}<div className="modal-footer"><button type="button" className="secondary" onClick={() => setAdding(false)}>取消</button><button type="submit" className="primary"><Plus size={17} />添加录像源</button></div></form></div>}
      {notice && <div className="toast" role="status"><CheckCircle weight="fill" />{notice}</div>}
    </>
  );
}

function LogsPanel() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("全部类型");
  const [source, setSource] = useState("全部录像源");
  const [date, setDate] = useState("2026-06-02");
  const [notice, setNotice] = useState("");
  const visible = logs.filter((log) => (type === "全部类型" || log.level === type) && (source === "全部录像源" || log.source === source) && (!date || date === "2026-06-02") && `${log.event} ${log.detail} ${log.source}`.toLowerCase().includes(query.toLowerCase()));
  const exportLogs = () => {
    const csv = ["时间,类型,事件,录像源,详情", ...visible.map((log) => [log.time, log.level, log.event, log.source, log.detail].map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "clipline-demo-logs.csv"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`已导出 ${visible.length} 条示例日志`); window.setTimeout(() => setNotice(""), 3000);
  };
  return (
    <>
      <PageHeader eyebrow="工作区 / 管理" title="活动日志" subtitle="每一次扫描、识别和导出，都有迹可循。"><button className="secondary" onClick={exportLogs}><DownloadSimple />导出日志</button></PageHeader>
      <div className="page-toolbar"><div className="inline-search"><MagnifyingGlass /><input aria-label="搜索活动日志" placeholder="搜索事件、文件或详情" value={query} onChange={(event) => setQuery(event.target.value)} /></div><SelectButton value={type} onChange={setType}>全部类型</SelectButton><SelectButton options={["全部录像源", "工作室"]} value={source} onChange={setSource}>全部录像源</SelectButton><label className="filter-button manage-date-filter"><CalendarBlank /><input aria-label="日志日期" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
      <section className="logs-table"><div className="log-head"><span>时间</span><span>类型</span><span>事件</span><span>录像源</span><span>详情</span></div>
        {visible.map((log) => <div className="log-row" key={`${log.time}-${log.event}`}><span>{log.time}</span><span className={`log-level ${log.level}`}>{log.level}</span><strong>{log.event}</strong><span>{log.source}</span><span>{log.detail}</span></div>)}
        {!visible.length && <div className="manage-empty"><FileText size={28} /><strong>没有符合条件的活动</strong><p>调整筛选条件，查看其他活动记录。</p><button className="secondary" onClick={() => { setQuery(""); setType("全部类型"); setSource("全部录像源"); setDate("2026-06-02"); }}>重置筛选</button></div>}
      </section>
      <div className="pagination"><span>共 {visible.length} 条活动 · 原型示例数据</span><button disabled aria-label="上一页"><CaretLeft /></button><button className="active" aria-current="page">1</button><button disabled aria-label="下一页"><CaretRight /></button></div>
      {notice && <div className="toast" role="status"><CheckCircle weight="fill" />{notice}</div>}
    </>
  );
}

const settingCopy = {
  overview: ["概览", "快速确认 Clipline 的运行状态、存储路径和缓存占用"],
  scan: ["扫描与索引", "设置新文件发现、索引校验和缩略图生成规则"],
  export: ["导出", "配置默认导出模式、时长限制与缓存清理"],
  recognition: ["识别与任务", "管理语音、视觉模型和后台任务并发"],
  models: ["模型管理", "下载、查看和清理本地语音模型，并检查视觉模型加载状态"],
  diagnostics: ["日志与诊断", "设置运行日志、保留周期和故障诊断"],
  about: ["关于", "查看版本、运行环境和开源组件信息"],
};

function SettingsPanel({ activeSection, onOpenSources, onOpenLogs }) {
  const [saved, setSaved] = useState(false);
  const defaults = {
    autoThumb: true,
    verifyProbe: true,
    skipRecent: true,
    cleanupExport: true,
    autoTranscript: false,
    autoVision: false,
    detailedLogs: false,
    anonymizePaths: true,
  };
  const [toggles, setToggles] = useState(() => {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem("clipline-prototype-settings") || "{}").toggles }; } catch { return defaults; }
  });
  const [values, setValues] = useState(() => {
    try { return JSON.parse(localStorage.getItem("clipline-prototype-settings") || "{}").values || {}; } catch { return {}; }
  });
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);
  const [dialog, setDialog] = useState(null);
  const notify = (message) => { setNotice(message); window.setTimeout(() => setNotice(""), 3200); };
  const toggle = (id) => { setToggles((current) => ({ ...current, [id]: !current[id] })); setSaved(false); };
  const choice = (initial, field = initial) => <SelectButton value={values[`${activeSection}:${field}`] || initial} onChange={(value) => { setValues((current) => ({ ...current, [`${activeSection}:${field}`]: value })); setSaved(false); }}>{initial}</SelectButton>;
  const save = () => { localStorage.setItem("clipline-prototype-settings", JSON.stringify({ toggles, values })); setSaved(true); notify("设置已保存到此浏览器"); };
  const restore = () => {
    const keys = { scan: ["autoThumb", "verifyProbe", "skipRecent"], export: ["cleanupExport"], recognition: ["autoTranscript", "autoVision"], diagnostics: ["detailedLogs", "anonymizePaths"] }[activeSection] || [];
    setToggles((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, defaults[key]])) }));
    setValues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${activeSection}:`))));
    setSaved(false); notify("本页已恢复默认值，保存后生效");
  };
  const runCheck = () => { setChecking(true); window.setTimeout(() => { setChecking(false); notify("模拟检查完成：所有组件状态正常"); }, 900); };
  const downloadDiagnostics = () => {
    const content = JSON.stringify({ prototype: true, checkedAt: new Date().toISOString(), status: "healthy", checks: ["ffmpeg", "ffprobe", "database", "recordings"], settings: { toggles, values } }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "clipline-demo-diagnostics.json"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); notify("示例诊断报告已下载");
  };
  const [title, subtitle] = settingCopy[activeSection];
  const editable = !["overview", "models", "about"].includes(activeSection);

  return (
    <>
      <PageHeader eyebrow="工作区 / 设置" title={title} subtitle={subtitle}>
        {activeSection === "overview" && <button className="secondary" disabled={checking} onClick={runCheck}><SpinnerGap className={checking ? "manage-scanning" : ""} />{checking ? "检查中…" : "刷新状态"}</button>}
      </PageHeader>
      <div className="manage-settings-note"><Info size={16} />原型工作区 · 以下为示例配置，保存仅影响此浏览器。</div>

      {activeSection === "overview" && (
        <div className="settings-overview">
          <section className="health-strip">
            <div><span className="health-icon green"><CheckCircle weight="fill" /></span><p><small>系统状态</small><strong>运行正常</strong></p></div>
            <div><span className="health-icon blue"><FilmStrip /></span><p><small>索引内容</small><strong>1 个源 · 123 个片段</strong></p></div>
            <div><span className="health-icon green"><Check /></span><p><small>媒体工具</small><strong>FFmpeg 可用</strong></p></div>
            <div><span className="health-icon neutral"><HardDrives /></span><p><small>后台任务</small><strong>1 进行中 · 1 失败</strong></p></div>
          </section>
          <div className="settings-card-grid">
            <InfoCard title="存储路径" rows={[
              ["数据库", "data/clipline.db"],
              ["录像根路径", "recordings"],
              ["日志文件", "data/logs/clipline.log"],
              ["模型目录", "data/models"],
            ]} />
            <InfoCard title="缓存占用" rows={[
              ["缩略图缓存", "286 MB"],
              ["导出缓存", "1.8 GB"],
              ["最近清理", "2026年6月2日 12:04"],
              ["可用空间", "178 GB"],
            ]} />
          </div>
          <section className="overview-callout"><Info /><div><strong>设置作用范围</strong><p>这里修改系统默认值；单个录像源的覆盖项仍在“录像源”中设置。</p></div><button className="secondary" onClick={onOpenSources}>打开录像源</button></section>
        </div>
      )}

      {activeSection === "scan" && (
        <SettingsForm>
          <SettingsGroup title="发现新文件" description="控制 Clipline 什么时候扫描已挂载目录">
            <div className="field-grid"><Field label="默认扫描方式">{choice("手动扫描")}</Field><Field label="定时扫描间隔" help="只对启用了定时扫描的录像源生效">{choice("每 30 分钟")}</Field></div>
            <ToggleRow value={toggles.skipRecent} onClick={() => toggle("skipRecent")} title="跳过仍在写入的文件" body="忽略最近 30 秒内仍有变化的视频，避免索引不完整片段" />
          </SettingsGroup>
          <SettingsGroup title="索引与缩略图" description="新片段入库时执行的处理步骤">
            <ToggleRow value={toggles.verifyProbe} onClick={() => toggle("verifyProbe")} title="使用 ffprobe 校验片段" body="读取时长、编码和分辨率，并记录无法解析的文件" />
            <ToggleRow value={toggles.autoThumb} onClick={() => toggle("autoThumb")} title="自动生成缩略图" body="为片段墙和时间线生成预览图" />
            <div className="field-grid"><Field label="缩略图时间点">{choice("片段 30% 位置")}</Field><Field label="失败重试">{choice("最多 2 次")}</Field></div>
          </SettingsGroup>
        </SettingsForm>
      )}

      {activeSection === "export" && (
        <SettingsForm>
          <SettingsGroup title="默认导出行为" description="创建新导出任务时预先选择的选项">
            <div className="field-grid"><Field label="默认模式">{choice("快速 · 关键帧切割")}</Field><Field label="最长导出时长">{choice("30 分钟")}</Field></div>
            <p className="settings-note"><Info />快速模式速度更快，但起止时间会贴近关键帧；精准模式会重新编码。</p>
          </SettingsGroup>
          <SettingsGroup title="服务端暂存与清理" description="导出任务先在服务器生成文件，完成后由浏览器下载">
            <div className="server-storage-row"><span className="summary-icon blue"><HardDrives /></span><div><small>服务器暂存目录</small><strong>data/exports</strong><p>仅供 Clipline 生成和提供下载，不是用户电脑的保存位置。</p></div><span className="readonly-badge">只读</span></div>
            <div className="field-grid"><Field label="暂存缓存上限">{choice("10 GB")}</Field><Field label="完成后保留">{choice("24 小时")}</Field></div>
            <ToggleRow value={toggles.cleanupExport} onClick={() => toggle("cleanupExport")} title="自动清理已完成的导出" body="超过保留时间后删除服务器暂存文件；已经下载到用户电脑的文件不受影响" />
            <p className="browser-download-note"><DownloadSimple /><span><strong>下载位置由浏览器决定</strong><br />任务完成后在“任务”中点击下载，浏览器会保存到默认下载目录或询问保存位置。</span></p>
          </SettingsGroup>
        </SettingsForm>
      )}

      {activeSection === "recognition" && (
        <SettingsForm>
          <SettingsGroup title="语音识别" description="控制字幕生成模型与默认运行方式">
            <div className="field-grid"><Field label="ASR 模型">{choice("Whisper · small")}</Field><Field label="语言">{choice("自动检测")}</Field><Field label="最大并发">{choice("1 个任务", "asrConcurrency")}</Field><Field label="字幕格式">{choice("SRT + TXT")}</Field></div>
            <ToggleRow value={toggles.autoTranscript} onClick={() => toggle("autoTranscript")} title="扫描后自动识别字幕" body="新片段入库后自动创建语音识别任务，会持续占用计算资源" />
          </SettingsGroup>
          <SettingsGroup title="视觉识别" description="为片段生成可搜索的画面标签">
            <div className="field-grid"><Field label="视觉模型">{choice("本地模型 · 默认")}</Field><Field label="最大并发">{choice("1 个任务", "visionConcurrency")}</Field></div>
            <ToggleRow value={toggles.autoVision} onClick={() => toggle("autoVision")} title="扫描后自动运行视觉识别" body="默认关闭；可在片段库中按需批量创建任务" />
            <p className="restart-note"><WarningCircle weight="fill" /><span><strong>修改并发数量后需要重启后台服务</strong><br />当前运行中的任务不会被中断。</span></p>
          </SettingsGroup>
        </SettingsForm>
      )}

      {activeSection === "models" && <ModelManagement />}

      {activeSection === "diagnostics" && (
        <SettingsForm>
          <SettingsGroup title="运行日志" description="控制日志详细程度和保留周期">
            <div className="field-grid"><Field label="日志级别">{choice("INFO · 推荐")}</Field><Field label="保留周期">{choice("30 天")}</Field></div>
            <ToggleRow value={toggles.detailedLogs} onClick={() => toggle("detailedLogs")} title="记录详细识别日志" body="用于排查本地模型加载与任务失败，可能显著增加日志体积" />
            <ToggleRow value={toggles.anonymizePaths} onClick={() => toggle("anonymizePaths")} title="导出诊断时隐藏绝对路径" body="生成诊断包时仅保留目录末级名称" />
          </SettingsGroup>
          <SettingsGroup title="诊断工具" description="用于排查扫描、媒体工具和数据库问题">
            <div className="diagnostic-actions"><button className="secondary" disabled={checking} onClick={runCheck}><CheckCircle />{checking ? "检查中…" : "运行系统检查"}</button><button className="secondary" onClick={downloadDiagnostics}><DownloadSimple />下载诊断报告</button><button className="secondary" onClick={onOpenLogs}><FileText />查看活动日志</button></div>
            <div className="diagnostic-result"><CheckCircle weight="fill" /><span><strong>最近检查通过</strong><small>FFmpeg、ffprobe、数据库和录像根路径均可用 · 6月2日 12:07</small></span></div>
          </SettingsGroup>
        </SettingsForm>
      )}

      {activeSection === "about" && (
        <div className="about-layout">
          <section className="about-card"><img src="/assets/clipline-logo-v2.png" alt="Clipline" /><div><h2>Clipline</h2><p>小米 NAS 与本地视频片段的扫描、回放、识别和导出工作台。</p><span>版本 0.1.0</span></div></section>
          <InfoCard title="运行环境" rows={[
            ["前端", "React · Vite"],
            ["后端", "FastAPI · Python"],
            ["数据库", "SQLite"],
            ["媒体工具", "FFmpeg / ffprobe"],
          ]} />
          <section className="about-links"><button className="secondary" onClick={() => setDialog({ title: "Clipline 使用说明", body: "从“录像源”添加一个视频目录，扫描生成索引后，即可在“回看”中定位录像、选择时间范围并导出。片段库支持搜索、筛选和批量创建识别任务。“任务”集中展示处理进度与结果。本工作区为交互原型，使用示例数据。" })}>查看使用说明</button><button className="secondary" onClick={() => setDialog({ title: "开源组件", body: "此原型使用 React、Vite 与 Phosphor Icons 构建。实际项目的完整开源许可请以各组件的 LICENSE 文件为准。" })}>开源组件</button><button className="secondary" onClick={() => notify("当前为交互原型 v0.1.0，无在线更新服务")}>检查更新</button></section>
        </div>
      )}

      {editable && <div className="settings-footer sticky">{saved && <span><CheckCircle weight="fill" />设置已保存</span>}<button className="secondary" onClick={restore}>恢复本页默认值</button><button className="primary" onClick={save}>保存更改</button></div>}
      {notice && <div className="toast" role="status"><CheckCircle weight="fill" />{notice}</div>}
      {dialog && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}><section className="manage-source-modal" role="dialog" aria-modal="true" aria-label={dialog.title}><div className="modal-heading"><h2>{dialog.title}</h2><button className="icon-button" aria-label="关闭" onClick={() => setDialog(null)}><X /></button></div><p>{dialog.body}</p><div className="modal-footer"><button className="primary" onClick={() => setDialog(null)}>知道了</button></div></section></div>}
    </>
  );
}

const initialModels = [
  { id: "funasr:medium", engine: "FunASR", name: "paraformer-zh", size: "1.24 GB", installed: true, active: true, description: "中文场景推荐 · 含 VAD 与标点模型" },
  { id: "funasr:large", engine: "FunASR", name: "paraformer-large-zh", size: "2.41 GB", installed: false, description: "更高准确率 · 需要更多内存" },
  { id: "sensevoice:small", engine: "SenseVoice", name: "SenseVoiceSmall", size: "891 MB", installed: false, description: "多语言、情感与音频事件识别" },
  { id: "whisper:tiny", engine: "Whisper", name: "tiny", size: "75 MB", installed: true, description: "速度最快 · 适合低功耗设备" },
  { id: "whisper:base", engine: "Whisper", name: "base", size: "142 MB", installed: false, description: "通用多语言基础模型" },
  { id: "whisper:medium", engine: "Whisper", name: "medium", size: "1.53 GB", installed: false, description: "更高多语言准确率" },
  { id: "whisper:large", engine: "Whisper", name: "large-v3", size: "2.88 GB", installed: false, description: "准确率最高 · 资源占用较大" },
];

function ModelManagement() {
  const [models, setModels] = useState(initialModels);
  const [filter, setFilter] = useState("全部");
  const [notice, setNotice] = useState("");
  const [reloading, setReloading] = useState(false);
  const visibleModels = models.filter((model) => filter === "全部" || (filter === "已下载" ? model.installed : !model.installed));

  const download = (id) => {
    setModels((items) => items.map((model) => model.id === id ? { ...model, downloading: true, progress: 18 } : model));
    window.setTimeout(() => setModels((items) => items.map((model) => model.id === id ? { ...model, progress: 64 } : model)), 650);
    window.setTimeout(() => {
      setModels((items) => items.map((model) => model.id === id ? { ...model, downloading: false, installed: true, progress: 100 } : model));
      setNotice("演示下载完成，示例模型已标记为可用");
      window.setTimeout(() => setNotice(""), 2200);
    }, 1400);
  };

  const remove = (id) => {
    setModels((items) => items.map((model) => model.id === id ? { ...model, installed: false, active: false } : model));
    setNotice("演示删除完成，未改动本地模型文件");
    window.setTimeout(() => setNotice(""), 2200);
  };
  const reload = () => {
    setReloading(true);
    window.setTimeout(() => {
      setReloading(false);
      setNotice("演示加载完成，视觉模型状态已更新");
      window.setTimeout(() => setNotice(""), 2600);
    }, 1100);
  };

  return (
    <div className="model-management">
      <section className="model-summary">
        <div><span className="summary-icon blue"><Archive /></span><p><small>模型缓存</small><strong>1.32 GB 已使用</strong><em>data/models</em></p></div>
        <div><span className="summary-icon green"><CheckCircle /></span><p><small>已下载</small><strong>{models.filter((model) => model.installed).length} 个语音模型</strong><em>1 个正在使用</em></p></div>
        <div><span className="summary-icon purple"><Eye /></span><p><small>视觉模型</small><strong>YOLOv8n 可用</strong><em>CPU · 已加载</em></p></div>
      </section>

      <section className="model-panel">
        <header className="model-panel-head"><div><h2>语音识别模型</h2><p>模型下载到 Clipline 的本地缓存，删除不会影响已有字幕结果。</p></div><div className="model-filters">{["全部", "已下载", "未下载"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div></header>
        <div className="model-table-head"><span>引擎与模型</span><span>状态</span><span>缓存大小</span><span /></div>
        <div className="model-list">
          {visibleModels.map((model) => (
            <div className="model-row" key={model.id}>
              <div className="model-identity"><span className="model-engine">{model.engine.slice(0, 1)}</span><div><strong>{model.engine} · {model.name}</strong><small>{model.description}</small>{model.downloading && <div className="model-progress"><i style={{ width: `${model.progress}%` }} /></div>}</div></div>
              <span className={model.active ? "model-status active" : model.downloading ? "model-status downloading" : model.installed ? "model-status installed" : "model-status"}>{model.active ? "使用中" : model.downloading ? `下载中 ${model.progress}%` : model.installed ? "已下载" : "未下载"}</span>
              <span className="model-size">{model.size}</span>
              {model.installed ? <button className="secondary model-action danger-text" disabled={model.active} onClick={() => remove(model.id)}>{model.active ? "当前模型" : <><Trash />删除</>}</button> : <button className="secondary model-action" disabled={model.downloading} onClick={() => download(model.id)}>{model.downloading ? <SpinnerGap /> : <DownloadSimple />}{model.downloading ? "下载中" : "下载"}</button>}
            </div>
          ))}
        </div>
      </section>

      <section className="vision-model-card">
        <div className="vision-model-icon"><Eye /></div>
        <div><small>视觉识别模型</small><h2>YOLOv8n</h2><p>data/models/vision/yolov8n.pt</p></div>
        <dl><div><dt>状态</dt><dd><span className="status-dot green" />{reloading ? "加载中" : "可用"}</dd></div><div><dt>设备</dt><dd>CPU</dd></div><div><dt>输入尺寸</dt><dd>416 px</dd></div></dl>
        <button className="secondary" disabled={reloading} onClick={reload}><SpinnerGap />{reloading ? "加载中…" : "重新加载"}</button>
      </section>
      <p className="model-boundary"><Info />模型在本地处理语音与画面，录像无需上传。此页面为原型演示，下载、删除和重新加载仅模拟状态变化。</p>
      {notice && <div className="toast"><CheckCircle weight="fill" />{notice}</div>}
    </div>
  );
}

function SettingsForm({ children }) {
  return <div className="settings-form-stack">{children}</div>;
}

function SettingsGroup({ title, description, children }) {
  return <section className="settings-group"><header><h2>{title}</h2><p>{description}</p></header><div className="settings-group-body">{children}</div></section>;
}

function Field({ label, help, children }) {
  return <label className="settings-field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>;
}

function ToggleRow({ value, onClick, title, body }) {
  return <button className="settings-toggle-row" onClick={onClick}><span><strong>{title}</strong><small>{body}</small></span><i className={value ? "toggle on" : "toggle"}><b /></i></button>;
}

function InfoCard({ title, rows }) {
  return <section className="info-card"><h2>{title}</h2><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>;
}

function ExportModal({ onClose, onConfirm }) {
  const [step, setStep] = useState("form");
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="export-modal">
        {step === "form" ? <>
          <div className="modal-heading"><div><small>导出片段</small><h2>创建导出任务</h2></div><button className="icon-button" onClick={onClose}><X /></button></div>
          <div className="export-preview" style={{ backgroundImage: "url('/assets/printer-main.png')" }}><span>xiaomi · 09:35:48 – 09:41:10</span></div>
          <div className="export-form"><label>文件名称<input defaultValue="xiaomi_20260602_093548-094110.mp4" /></label><div><label>导出模式<SelectButton>快速 · 关键帧切割</SelectButton></label><label>时间范围<SelectButton>05:22 · 已选择区间</SelectButton></label></div><p className="export-note"><WarningCircle weight="fill" />选择范围包含 18 秒未索引片段，导出结果会保留时间断档。</p></div>
          <div className="modal-footer"><span>预计大小 84 MB · 不修改源文件</span><button className="secondary" onClick={onClose}>取消</button><button className="primary" onClick={() => setStep("done")}><DownloadSimple />创建任务</button></div>
        </> : <div className="success-state"><span><CheckCircle weight="fill" /></span><h2>导出任务已创建</h2><p>可前往“任务”查看处理进度。</p><button className="primary" onClick={onConfirm}>查看任务</button><button className="secondary" onClick={onClose}>继续浏览</button></div>}
      </section>
    </div>
  );
}

function PageHeader({ eyebrow, title, subtitle, children }) {
  return <header className="page-header"><div><small>{eyebrow}</small><h1>{title}</h1><p>{subtitle}</p></div>{children && <div className="page-header-actions">{children}</div>}</header>;
}

function DotsIcon() {
  return <span className="dots-icon" aria-hidden="true">•••</span>;
}

export function App() {
  const [page, setPage] = useState("review");
  const [exportOpen, setExportOpen] = useState(false);
  const content = useMemo(() => {
    if (page === "review") return <ReviewPage onExport={() => setExportOpen(true)} />;
    if (page === "library") return <LibraryPage onExport={() => setExportOpen(true)} />;
    if (page === "tasks") return <TasksPage />;
    return <ManagePage />;
  }, [page]);
  return (
    <AppShell page={page} setPage={setPage}>
      {content}
      {exportOpen && <ExportModal onClose={() => setExportOpen(false)} onConfirm={() => { setExportOpen(false); setPage("tasks"); }} />}
    </AppShell>
  );
}
