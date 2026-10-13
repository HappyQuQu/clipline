import { useMemo, useState } from "react";
import {
  ArrowClockwise,
  Camera,
  CaretDown,
  Check,
  ClockCounterClockwise,
  DownloadSimple,
  Gauge,
  GearSix,
  GridFour,
  MagnifyingGlass,
  Microphone,
  Moon,
  Pause,
  Play,
  Pulse,
  Scan,
  SkipBack,
  SkipForward,
  Sun,
  X,
} from "@phosphor-icons/react";

const navItems = [
  { id: "playback", label: "录像回放", icon: Play },
  { id: "clips", label: "片段墙", icon: GridFour },
  { id: "tasks", label: "任务中心", icon: Pulse },
  { id: "sources", label: "录像源", icon: Camera },
  { id: "logs", label: "日志", icon: ClockCounterClockwise },
  { id: "settings", label: "设置", icon: GearSix },
];

const viewTitles = {
  playback: "录像回放",
  clips: "片段墙",
  tasks: "任务中心",
  sources: "录像源",
  logs: "日志",
  settings: "设置",
};

const clips = [
  { id: 1, time: "09:12:04", end: "09:13:34", duration: "1:30", event: "无人经过", pos: "16% 50%" },
  { id: 2, time: "10:48:17", end: "10:49:49", duration: "1:32", event: "快递送达", pos: "40% 52%" },
  { id: 3, time: "14:23:07", end: "14:24:37", duration: "1:30", event: "检测到人员", pos: "64% 50%" },
  { id: 4, time: "16:05:42", end: "16:07:10", duration: "1:28", event: "门口活动", pos: "76% 44%" },
  { id: 5, time: "18:31:20", end: "18:32:52", duration: "1:32", event: "光线变化", pos: "88% 42%" },
  { id: 6, time: "20:14:06", end: "20:15:34", duration: "1:28", event: "夜间片段", pos: "92% 40%" },
];

function Rail({ activeView, setActiveView }) {
  return (
    <aside className="rail">
      <button className="rail-logo" title="Clipline" aria-label="Clipline 录像回放" onClick={() => setActiveView("playback")}>
        <img src="/assets/clipline-logo.svg" alt="" />
        <span />
      </button>
      {navItems.slice(0, 4).map(({ id, label, icon: Icon }) => (
        <button
          className={`rail-button ${activeView === id ? "active" : ""}`}
          key={id}
          title={label}
          aria-label={label}
          onClick={() => setActiveView(id)}
        >
          <Icon size={20} weight={activeView === id ? "fill" : "regular"} />
        </button>
      ))}
      <div className="rail-spacer" />
      {navItems.slice(4).map(({ id, label, icon: Icon }) => (
        <button
          className={`rail-button ${activeView === id ? "active" : ""}`}
          key={id}
          title={label}
          aria-label={label}
          onClick={() => setActiveView(id)}
        >
          <Icon size={20} weight={activeView === id ? "fill" : "regular"} />
        </button>
      ))}
    </aside>
  );
}

function StageTop({ activeView, dark, setDark }) {
  const title = activeView === "playback" ? "门口摄像头" : viewTitles[activeView];
  const meta = activeView === "playback"
    ? "2026/07/31 · 48 个片段 · 4320 秒"
    : activeView === "clips"
      ? "3 个录像源 · 370 个片段"
      : activeView === "tasks"
        ? "2 条导出 · 1 个识别进行中"
        : activeView === "sources"
          ? "3 个源 · 370 个片段"
          : activeView === "logs"
            ? "12 条扫描 · 2 条导出 · 0 个错误"
            : "版本 0.1.0 · 数据库 /app/data/clipline.db";

  return (
    <header className="stage-top">
      <div className="stage-heading">
        <strong>{title}</strong>
        <span>{meta}</span>
      </div>
      <div className="stage-tools">
        <label className="search-bar">
          <MagnifyingGlass size={16} />
          <input aria-label="搜索对话内容" placeholder="搜索对话内容... (Ctrl+K)" />
          <button aria-label="搜索"><MagnifyingGlass size={14} /></button>
        </label>
        {["playback", "clips", "tasks", "sources"].includes(activeView) && (
          <button className="source-select">
            <Camera size={17} />
            <span>门口摄像头</span>
            <CaretDown size={13} weight="bold" />
          </button>
        )}
        <button className="top-icon" aria-label="切换主题" onClick={() => setDark((value) => !value)}>
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="top-icon" aria-label="刷新"><ArrowClockwise size={18} /></button>
      </div>
    </header>
  );
}

function TimeRail({ selected, playing, setPlaying, manageOpen, setManageOpen }) {
  return (
    <section className="time-rail" aria-label="时间轴">
      <div className="timeline-head">
        <div className="timeline-buttons">
          <button onClick={() => setPlaying((value) => !value)} aria-label={playing ? "暂停" : "播放"}>
            {playing ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
          </button>
          <button>1×</button>
        </div>
        <strong>{selected.time}</strong>
      </div>
      <div className="timeline-date-zoom">
        <div className="timeline-date-range">
          <button>2026/07/31</button>
          <span>→</span>
          <button>2026/07/31</button>
        </div>
        <label className="timeline-zoom">
          <span>−</span>
          <input type="range" defaultValue="42" />
          <span>＋</span>
        </label>
      </div>
      <div className="timeline-canvas">
        {["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"].map((time, index) => (
          <div className="timeline-hour" key={time}>
            <time>{time}</time>
            <i />
            {index === 1 && <b className="timeline-segment segment-one" />}
            {index === 3 && <b className="timeline-segment segment-active" />}
            {index === 5 && <b className="timeline-segment segment-three" />}
          </div>
        ))}
        <div className="timeline-current"><span />{selected.time}</div>
      </div>
      <div className="timeline-actions">
        <button><SkipBack size={17} /><span>上一个</span></button>
        <button><SkipForward size={17} /><span>下一个</span></button>
        <button><Scan size={17} /><span>定位当前</span></button>
        <button className={manageOpen ? "active" : ""} onClick={() => setManageOpen((value) => !value)}>
          <Gauge size={17} /><span>管理</span>
        </button>
      </div>
    </section>
  );
}

function ManagePanel({ selected, onClose }) {
  return (
    <aside className="manage-panel">
      <div className="manage-head"><strong>管理片段</strong><button onClick={onClose} aria-label="关闭"><X size={18} /></button></div>
      <div className="manage-body">
        <label><span>开始时间</span><input defaultValue={`2026-07-31 ${selected.time}`} /></label>
        <label><span>结束时间</span><input defaultValue={`2026-07-31 ${selected.end}`} /></label>
        <div className="range-ok"><Check size={15} weight="bold" /> 该范围内有 1 个片段</div>
        <h3>导出方式</h3>
        <button className="manage-option active"><DownloadSimple size={18} /><span><strong>下载</strong><small>合并并导出 MP4 文件</small></span><Check size={16} weight="bold" /></button>
        <button className="manage-option"><Pulse size={18} /><span><strong>延时视频</strong><small>加速查看较长时间范围</small></span></button>
        <div className="manage-summary"><span>预计时长</span><strong>{selected.duration}</strong><span>预计大小</span><strong>38.6 MB</strong></div>
      </div>
      <div className="manage-footer"><button className="primary-button"><DownloadSimple size={17} /> 创建导出任务</button></div>
    </aside>
  );
}

function Viewer({ selected, setSelected, playing, setPlaying }) {
  return (
    <div className="viewer-right">
      <div className="viewer" role="img" aria-label="门口摄像头画面">
        <div className="video-badge">{selected.time} | 门口摄像头</div>
        <div className="floating-tools">
          <button aria-label="刷新"><ArrowClockwise size={17} /></button>
          <button aria-label="导出"><DownloadSimple size={17} /></button>
          <button aria-label="扫描"><Pulse size={17} /></button>
          <button><Microphone size={15} /><span>字幕</span></button>
        </div>
        <button className="viewer-play" aria-label={playing ? "暂停" : "播放"} onClick={() => setPlaying((value) => !value)}>
          {playing ? <Pause size={27} weight="fill" /> : <Play size={27} weight="fill" />}
        </button>
        <div className="viewer-controls">
          <button onClick={() => setPlaying((value) => !value)}>
            {playing ? <Pause size={17} weight="fill" /> : <Play size={17} weight="fill" />}
          </button>
          <strong>{selected.time}</strong>
          <div><span style={{ width: playing ? "61%" : "37%" }} /></div>
          <span>1×</span>
        </div>
      </div>
      <button className="viewer-resize" aria-label="调整播放器和录像片段高度"><span /></button>
      <section className="clip-dock">
        <div className="dock-head"><div><strong>录像片段</strong><span>2 个断档</span></div><small>今天 · 48 个片段</small></div>
        <div className="clip-grid">
          {clips.map((clip) => (
            <button key={clip.id} className={`clip-card ${clip.id === selected.id ? "selected" : ""}`} onClick={() => setSelected(clip)}>
              <span className="clip-thumb">
                <img src="/assets/front-door-frame.png" alt="" style={{ objectPosition: clip.pos }} />
                <b>{clip.duration}</b>
                {clip.id === selected.id && <i><Check size={12} weight="bold" /></i>}
              </span>
              <strong>{clip.time}</strong>
              <small>{clip.event}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function PlaybackView() {
  const [selected, setSelected] = useState(clips[2]);
  const [playing, setPlaying] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  return (
    <div className={`viewer-band ${manageOpen ? "with-manage" : ""}`}>
      <TimeRail selected={selected} playing={playing} setPlaying={setPlaying} manageOpen={manageOpen} setManageOpen={setManageOpen} />
      {manageOpen && <ManagePanel selected={selected} onClose={() => setManageOpen(false)} />}
      <Viewer selected={selected} setSelected={setSelected} playing={playing} setPlaying={setPlaying} />
    </div>
  );
}

function GenericView({ activeView }) {
  const cards = useMemo(() => {
    if (activeView === "clips") return [["今日片段", "48"], ["识别到人员", "12"], ["已有字幕", "31"]];
    if (activeView === "tasks") return [["进行中", "1"], ["等待中", "2"], ["已完成", "18"]];
    if (activeView === "sources") return [["录像源", "3"], ["已启用", "3"], ["索引片段", "370"]];
    if (activeView === "logs") return [["扫描记录", "12"], ["导出记录", "2"], ["错误", "0"]];
    return [["数据库", "正常"], ["缓存", "12.8 GB"], ["版本", "0.1.0"]];
  }, [activeView]);
  return (
    <div className="generic-page">
      <div className="generic-summary">{cards.map(([label, value]) => <section key={label}><span>{label}</span><strong>{value}</strong></section>)}</div>
      <section className="generic-content">
        <div className="generic-content-head"><strong>{viewTitles[activeView]}</strong><button className="secondary-button"><ArrowClockwise size={17} /> 刷新</button></div>
        {clips.slice(0, 4).map((clip) => <article key={clip.id}><span className="generic-icon"><Camera size={18} /></span><div><strong>{activeView === "sources" ? `录像源 ${clip.id}` : `${clip.time} · 门口摄像头`}</strong><small>/recordings/front-door · {clip.event}</small></div><span className="state-pill">正常</span></article>)}
      </section>
    </div>
  );
}

export function App() {
  const [activeView, setActiveView] = useState("playback");
  const [dark, setDark] = useState(false);
  return (
    <div className={dark ? "protect-shell dark" : "protect-shell"}>
      <Rail activeView={activeView} setActiveView={setActiveView} />
      <main className="stage">
        <StageTop activeView={activeView} dark={dark} setDark={setDark} />
        {activeView === "playback" ? <PlaybackView /> : <GenericView activeView={activeView} />}
      </main>
    </div>
  );
}
