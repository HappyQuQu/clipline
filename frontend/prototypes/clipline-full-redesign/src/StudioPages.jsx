import { useMemo, useState } from "react";
import {
  Archive, ArrowRight, CalendarBlank, CaretDown, Check, CheckCircle,
  Clock, DownloadSimple, Eye, FileText, FilmStrip, ListBullets,
  MagnifyingGlass, Microphone, Play, Rows, Sparkle, SquaresFour,
  Trash, WarningCircle, X, ArrowClockwise,
} from "@phosphor-icons/react";

const demoDate = "2026-06-02";
const clipSource = (clip) => clip.source || "工作室";
const clipDate = (clip) => clip.date || demoDate;
const labelNames = { chair: "椅子", laptop: "笔记本电脑", person: "人物", car: "车辆" };
const labelText = (label) => labelNames[label] || label;
const isRecognized = (clip) => /已识别|已完成|完成/.test(clip.status || "");

function Pill({ children, status, tone }) {
  const appearance = tone || (status === "已完成" ? "success" : status === "失败" ? "danger" : status === "进行中" ? "active" : "neutral");
  return <span className={`sp-status sp-status-${appearance}`}><span />{children}</span>;
}

function EmptyState({ icon: Icon = Archive, title, body, children }) {
  return <div className="sp-empty"><span className="sp-empty-icon"><Icon size={27} /></span><h2>{title}</h2><p>{body}</p>{children}</div>;
}

export function StudioLibrary({ clips = [], onOpen, onExport, onRecognize }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [recognition, setRecognition] = useState("all");
  const [date, setDate] = useState("");
  const [tag, setTag] = useState("");
  const [view, setView] = useState("grid");
  const [activeId, setActiveId] = useState(clips[0]?.id ?? null);
  const [selected, setSelected] = useState([]);
  const sources = [...new Set(clips.map(clipSource))];
  const labels = [...new Set(clips.flatMap((clip) => clip.labels || []))];
  const filtered = useMemo(() => clips.filter((clip) => {
    const searchText = [clipSource(clip), clip.time, clip.range, clip.status, clip.name, clip.filename, clip.transcript,
      ...(clip.labels || []).flatMap((label) => [label, labelText(label)])].filter(Boolean).join(" ").toLowerCase();
    return (!query.trim() || searchText.includes(query.trim().toLowerCase()))
      && (source === "all" || clipSource(clip) === source)
      && (!date || clipDate(clip) === date)
      && (!tag || clip.labels?.includes(tag))
      && (recognition === "all" || (recognition === "recognized" ? isRecognized(clip) : recognition === "unrecognized" ? clip.status === "未识别" : clip.status?.includes("失败")));
  }), [clips, query, source, date, tag, recognition]);
  const detail = filtered.find((clip) => clip.id === activeId) || filtered[0];
  const selectedClips = clips.filter((clip) => selected.includes(clip.id));
  const allSelected = filtered.length > 0 && filtered.every((clip) => selected.includes(clip.id));
  const hasFilters = query || source !== "all" || date || tag || recognition !== "all";
  const toggleSelection = (id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const selectVisible = () => setSelected((current) => allSelected
    ? current.filter((id) => !filtered.some((clip) => clip.id === id))
    : [...new Set([...current, ...filtered.map((clip) => clip.id)])]);
  const resetFilters = () => { setQuery(""); setSource("all"); setDate(""); setTag(""); setRecognition("all"); };

  return <div className="sp-page sp-library-page">
    <header className="sp-page-heading">
      <div><div className="sp-heading-kicker">你的录像，井然有序</div><h1>片段库</h1><p>浏览画面，找到需要留存的那一段。</p></div>
      <div className="sp-heading-count"><FilmStrip size={19} /><strong>{clips.length}</strong><span>个已索引片段</span></div>
    </header>

    <section className="sp-filters" aria-label="片段筛选">
      <label className="sp-search"><MagnifyingGlass size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索时间、标签或字幕…" aria-label="搜索片段" />{query && <button className="sp-input-clear" onClick={() => setQuery("")} aria-label="清空搜索"><X size={14} /></button>}</label>
      <label className="sp-select-wrap"><FilmStrip size={16} /><select value={source} onChange={(event) => setSource(event.target.value)} aria-label="按录像源筛选"><option value="all">全部录像源</option>{sources.map((item) => <option value={item} key={item}>{item}</option>)}</select><CaretDown size={12} /></label>
      <label className="sp-select-wrap"><Sparkle size={16} /><select value={recognition} onChange={(event) => setRecognition(event.target.value)} aria-label="按识别状态筛选"><option value="all">全部识别状态</option><option value="recognized">已有识别结果</option><option value="unrecognized">未识别</option><option value="failed">识别失败</option></select><CaretDown size={12} /></label>
      <label className={`sp-date-filter ${date ? "sp-date-active" : ""}`}><CalendarBlank size={16} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="按日期筛选" /></label>
    </section>

    <div className="sp-library-meta">
      <div className="sp-label-filters"><span>画面标签</span><button className={!tag ? "sp-tag-filter sp-tag-active" : "sp-tag-filter"} onClick={() => setTag("")}>全部</button>{labels.map((label) => <button key={label} className={tag === label ? "sp-tag-filter sp-tag-active" : "sp-tag-filter"} onClick={() => setTag(tag === label ? "" : label)}>{labelText(label)}</button>)}</div>
      <div className="sp-view-tools"><span>{filtered.length} 个片段</span><div className="sp-view-switch" aria-label="显示方式"><button onClick={() => setView("grid")} className={view === "grid" ? "sp-view-active" : ""} aria-label="网格视图" aria-pressed={view === "grid"}><SquaresFour size={17} /></button><button onClick={() => setView("list")} className={view === "list" ? "sp-view-active" : ""} aria-label="列表视图" aria-pressed={view === "list"}><Rows size={17} /></button></div></div>
    </div>

    {filtered.length ? <div className="sp-library-layout">
      <section className="sp-library-results" aria-label="录像片段">
        <div className="sp-results-caption"><span><CalendarBlank size={15} />{date ? date.replaceAll("-", ".") : "全部日期"}</span><button onClick={selectVisible}>{allSelected ? "取消选择当前结果" : "选择当前结果"}</button></div>
        <div className={view === "grid" ? "sp-clip-grid" : "sp-clip-list"}>
          {filtered.map((clip) => <article key={clip.id} className={`sp-clip-card ${detail?.id === clip.id ? "sp-clip-focused" : ""} ${selected.includes(clip.id) ? "sp-clip-selected" : ""}`}>
            <button className="sp-card-content" onClick={() => setActiveId(clip.id)} aria-label={`查看 ${clipSource(clip)} ${clip.time} 的片段详情`} aria-pressed={detail?.id === clip.id}>
              <div className="sp-clip-image"><img src={clip.asset} alt={`${clipSource(clip)} ${clip.time} 录像画面`} loading="lazy" /><span className="sp-clip-duration">{clip.duration}</span><span className="sp-clip-preview"><Eye size={17} />查看片段</span></div>
              <div className="sp-clip-copy"><div className="sp-clip-title"><strong>{clip.time}</strong><span>{clipSource(clip)}</span></div><p>{clip.range}</p><div className="sp-clip-bottom"><Pill tone={clip.status === "未识别" ? "neutral" : clip.status?.includes("失败") ? "danger" : "success"}>{clip.status}</Pill><span>{clipDate(clip).slice(5).replace("-", "月")}日</span></div></div>
            </button>
            <button className={`sp-select-clip ${selected.includes(clip.id) ? "sp-select-checked" : ""}`} aria-label={`${selected.includes(clip.id) ? "取消选择" : "选择"} ${clip.time} 片段`} aria-pressed={selected.includes(clip.id)} onClick={() => toggleSelection(clip.id)}>{selected.includes(clip.id) && <Check size={13} weight="bold" />}</button>
          </article>)}
        </div>
      </section>

      {detail && <aside className="sp-detail" aria-label="当前片段详情">
        <div className="sp-detail-heading"><span>片段详情</span><span className="sp-detail-index">{filtered.indexOf(detail) + 1} / {filtered.length}</span></div>
        <button className="sp-detail-preview" onClick={() => onOpen?.(detail)} aria-label="打开当前片段回看"><img src={detail.asset} alt={`${clipSource(detail)}录像预览`} /><span><Play size={22} weight="fill" /></span><small>打开回看</small></button>
        <div className="sp-detail-body"><div className="sp-detail-title"><div><h2>{detail.time} 的录像</h2><p>{clipSource(detail)} · {clipDate(detail).replaceAll("-", ".")}</p></div><Pill tone="neutral">{detail.duration}</Pill></div>
          <dl className="sp-detail-facts"><div><dt>时间范围</dt><dd>{detail.range}</dd></div><div><dt>录像源</dt><dd>{clipSource(detail)}</dd></div><div><dt>识别状态</dt><dd>{detail.status}</dd></div></dl>
          <section className="sp-detail-section"><h3><Eye size={16} />画面标签</h3>{detail.labels?.length ? <div className="sp-detail-tags">{detail.labels.map((label) => <button onClick={() => setTag(label)} key={label}>{labelText(label)}</button>)}</div> : <p className="sp-detail-empty-copy">还没有画面标签，识别后可按内容查找。</p>}</section>
          {detail.transcript && <section className="sp-detail-section"><h3><FileText size={16} />字幕摘要</h3><p className="sp-transcript">{detail.transcript}</p></section>}
          <section className="sp-detail-section"><h3><Sparkle size={16} />识别内容</h3><div className="sp-recognition-buttons"><button className="s-button" onClick={() => onRecognize?.([detail], "语音识别")}><Microphone size={16} />生成字幕</button><button className="s-button" onClick={() => onRecognize?.([detail], "视觉识别")}><Eye size={16} />识别画面</button></div></section>
          <button className="s-button primary sp-detail-export" onClick={() => onExport?.([detail])}><DownloadSimple size={17} />导出这个片段</button><p className="sp-original-note">导出副本，原始录像保持不变</p>
        </div>
      </aside>}
    </div> : <EmptyState title={clips.length ? "没有找到匹配的片段" : "这里还没有录像片段"} body={clips.length ? "试试其他日期、标签，或减少筛选条件。" : "添加录像源并完成扫描后，片段会显示在这里。"}>{hasFilters && <button className="s-button" onClick={resetFilters}>清除筛选</button>}</EmptyState>}

    {selectedClips.length > 0 && <div className="sp-batch-bar" role="region" aria-label="批量操作"><span className="sp-batch-count"><CheckCircle size={20} weight="fill" />已选 <strong>{selectedClips.length}</strong> 个片段</span><button className="sp-batch-cancel" onClick={() => setSelected([])}>取消选择</button><div className="sp-batch-actions"><button className="s-button" onClick={() => onRecognize?.(selectedClips, "视觉识别")}><Eye size={17} />识别画面</button><button className="s-button primary" onClick={() => onExport?.(selectedClips)}><DownloadSimple size={17} />{selectedClips.length > 1 ? "合并导出" : "导出片段"}</button></div></div>}
  </div>;
}

function TaskIcon({ kind, status }) {
  const Icon = status === "失败" ? WarningCircle : kind?.includes("语音") ? Microphone : kind?.includes("视觉") ? Eye : DownloadSimple;
  return <span className={`sp-task-icon ${status === "失败" ? "sp-task-icon-danger" : kind?.includes("识别") ? "sp-task-icon-purple" : ""}`}><Icon size={20} /></span>;
}

export function StudioTasks({ tasks = [], onRetry, onDownload, onClear, onOpen }) {
  const [status, setStatus] = useState("全部");
  const [kind, setKind] = useState("all");
  const [query, setQuery] = useState("");
  const tabs = ["全部", "进行中", "待处理", "已完成", "失败"];
  const completed = tasks.filter((task) => task.status === "已完成").length;
  const running = tasks.filter((task) => task.status === "进行中").length;
  const failed = tasks.filter((task) => task.status === "失败").length;
  const filtered = tasks.filter((task) => (status === "全部" || status === task.status)
    && (kind === "all" || (kind === "export" ? task.kind?.includes("导出") : task.kind?.includes(kind)))
    && (!query.trim() || [task.title, task.range, task.kind, task.result].join(" ").toLowerCase().includes(query.trim().toLowerCase())));

  return <div className="sp-page sp-tasks-page">
    <header className="sp-page-heading"><div><div className="sp-heading-kicker">后台处理，随时掌握</div><h1>任务</h1><p>导出与识别进度都在这里，完成后即可查看结果。</p></div><button className="s-button" onClick={() => onClear?.()} disabled={!completed}><Trash size={16} />清理已完成</button></header>

    <div className="sp-task-overview"><div><span className="sp-overview-dot sp-overview-blue" /><strong>{running}</strong><span>正在处理</span></div><div><span className="sp-overview-dot sp-overview-green" /><strong>{completed}</strong><span>已完成</span></div><div><span className={`sp-overview-dot ${failed ? "sp-overview-red" : ""}`} /><strong>{failed}</strong><span>需要关注</span></div><span className="sp-overview-note"><Clock size={15} />可继续回看，任务会在后台运行</span></div>

    <section className="sp-task-content">
      <div className="sp-task-toolbar"><div className="sp-task-tabs" aria-label="按任务状态筛选">{tabs.map((tab) => <button key={tab} onClick={() => setStatus(tab)} className={status === tab ? "sp-task-tab-active" : ""} aria-pressed={status === tab}>{tab}<span>{tab === "全部" ? tasks.length : tasks.filter((task) => task.status === tab).length}</span></button>)}</div><div className="sp-task-searches"><label className="sp-select-wrap"><select aria-label="按任务类型筛选" value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">全部类型</option><option value="export">视频导出</option><option value="语音">语音识别</option><option value="视觉">视觉识别</option></select><CaretDown size={12} /></label><label className="sp-search sp-task-search"><MagnifyingGlass size={17} /><input aria-label="搜索任务" placeholder="搜索任务…" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div></div>
      {filtered.length ? <div className="sp-task-table-wrap"><table className="sp-task-table"><thead><tr><th>任务内容</th><th>类型</th><th>状态</th><th>进度 / 结果</th><th className="sp-task-action-heading">操作</th></tr></thead><tbody>{filtered.map((task, index) => {
        const exportTask = task.kind?.includes("导出");
        const progress = Math.max(0, Math.min(100, Number(task.progress) || 0));
        return <tr key={task.id ?? `${task.title}-${task.kind}-${index}`}><td><div className="sp-task-name"><TaskIcon kind={task.kind} status={task.status} /><div><strong>{task.title || `${task.range || "工作室录像"} · ${task.kind}`}</strong><p>{task.range && <span>{task.range}</span>}<span>{task.created}</span></p></div></div></td><td><span className="sp-task-kind">{task.kind}</span></td><td><Pill status={task.status}>{task.status}</Pill></td><td><div className="sp-task-result">{task.status === "进行中" ? <><div className="sp-progress-heading"><span>{task.result || "正在处理"}</span><strong>{progress}%</strong></div><div className="sp-progress" role="progressbar" aria-label={`${task.title} 处理进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div></> : <span className={task.status === "失败" ? "sp-task-error" : task.status === "已完成" ? "sp-task-success" : "sp-task-waiting"}>{task.status === "失败" ? <WarningCircle size={15} /> : task.status === "已完成" ? <CheckCircle size={15} /> : <Clock size={15} />}{task.result || (task.status === "待处理" ? "等待处理" : "处理完成")}</span>}</div></td><td className="sp-task-actions">{task.status === "失败" ? <button className="s-button sp-table-action" onClick={() => onRetry?.(task)}><ArrowClockwise size={15} />重试</button> : task.status === "已完成" ? <button className={`s-button sp-table-action ${exportTask ? "sp-download-action" : ""}`} onClick={() => exportTask ? onDownload?.(task) : onOpen?.(task)}>{exportTask ? <DownloadSimple size={15} /> : <ArrowRight size={15} />}{exportTask ? "下载" : "查看结果"}</button> : <span className="sp-task-no-action">—</span>}</td></tr>;
      })}</tbody></table></div> : <EmptyState icon={ListBullets} title={tasks.length ? "这里暂时没有任务" : "还没有创建任务"} body={tasks.length ? "尝试切换状态或类型，查看其他任务。" : "从回看或片段库导出录像、识别内容后，就能在这里查看进度。"}>{(status !== "全部" || kind !== "all" || query) && <button className="s-button" onClick={() => { setStatus("全部"); setKind("all"); setQuery(""); }}>查看全部任务</button>}</EmptyState>}
      <footer className="sp-task-footer"><span>显示 {filtered.length} 个任务</span><span>交互原型 · 进度为模拟，实际视频下载待接入后端</span></footer>
    </section>
  </div>;
}
