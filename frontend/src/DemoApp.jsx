import { useCallback, useEffect, useRef, useState } from 'react';
import { PlayCircle, SquaresFour, Stack, FolderSimple, GearSix, MagnifyingGlass, ArrowUpRight, Check, Plus, HardDrives, CaretRight, List, X, ArrowRight, DownloadSimple, Scissors, CircleNotch, FileText } from '@phosphor-icons/react';
import { DEMO_DATE, demoClips, initialSources, initialTasks, initialLogs, readSaved, nowLabel, clock, seconds, duration, summarizeRange, TASK_TYPES, taskStage } from './domain';
import { Badge, IconButton, Modal, Notice, Toast, ExtensionSlot, EmptyState } from './components/UI';
import Review from './pages/Review';
import Library from './pages/Library';
import Tasks from './pages/Tasks';
import Sources from './pages/Sources';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import SourceDialog from './components/SourceDialog';

const nav = [
  ['review', '录像回看', PlayCircle], ['library', '片段库', SquaresFour], ['tasks', '任务中心', Stack],
  ['logs', '日志中心', FileText], ['sources', '录像源', FolderSimple], ['settings', '设置', GearSix],
];
const initialSettings = { interval: '5', timezone: 'Asia/Shanghai', skipRecent: '30', defaultMode: 'fast', maxDuration: '30', concurrency: '2', autoNext: true, skipGaps: true };

export default function App() {
  const [page, setPage] = useState('review');
  const [sources, setSources] = useState(() => readSaved('sources', initialSources));
  const [tasks, setTasks] = useState(() => readSaved('tasks', initialTasks));
  const [logs, setLogs] = useState(() => readSaved('logs', initialLogs));
  const [settings, setSettings] = useState(() => readSaved('settings', initialSettings));
  const [settingsDraft, setSettingsDraft] = useState(() => ({ ...settings }));
  const [sourceId, setSourceId] = useState('studio');
  const [date, setDate] = useState(DEMO_DATE);
  const [clipId, setClipId] = useState(`studio-${DEMO_DATE}-2`);
  const [toast, setToast] = useState('');
  const [exportRange, setExportRange] = useState(null);
  const [sourceDialog, setSourceDialog] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [backgroundDialog, setBackgroundDialog] = useState(false);
  const [logTaskId, setLogTaskId] = useState(null);
  const [taskFocusId, setTaskFocusId] = useState(null);
  const taskStates = useRef(new Map(tasks.map(task => [task.id, { status: task.status, stage: taskStage(task) }])));
  const sourceSnapshots = useRef(new Map(sources.map(item => [item.id, JSON.stringify([item.name, item.path, item.enabled, item.interval])])));
  const settingsSnapshot = useRef(JSON.stringify(settings));
  const searchRef = useRef(null);
  const notify = useCallback(message => setToast(message), []);
  const closeToast = useCallback(() => setToast(''), []);
  const appendLog = useCallback(event => {
    setLogs(previous => [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), time: `今天 ${nowLabel()}`, level: 'info', ...event }, ...previous]);
  }, []);
  const source = sources.find(s => s.id === sourceId) || sources[0];
  const clips = demoClips.filter(c => c.sourceId === source?.id && c.date === date);
  const activeClip = clips.find(c => c.id === clipId) || clips[2] || clips[0];
  const activeTasks = tasks.filter(t => ['queued', 'running'].includes(t.status)).length;

  useEffect(() => {
    for (const [key, value] of Object.entries({ sources, tasks, logs, settings })) {
      try { localStorage.setItem(`clipline-v1-${key}`, JSON.stringify(value)); } catch { /* Storage is optional for a prototype. */ }
    }
  }, [sources, tasks, logs, settings]);
  useEffect(() => {
    const timer = setInterval(() => setTasks(previous => {
      if (!previous.some(task => ['queued', 'running'].includes(task.status))) return previous;
      let occupied = previous.filter(task => task.status === 'running').length;
      return previous.map(task => {
        if (task.status === 'queued' && occupied < Number(settings.concurrency)) { occupied++; return { ...task, status: 'running', progress: 8 }; }
        if (task.status === 'running') return { ...task, progress: Math.min(task.progress + 16, 100), status: task.progress + 16 >= 100 ? 'completed' : 'running' };
        return task;
      });
    }), 900);
    return () => clearInterval(timer);
  }, [settings.concurrency]);
  useEffect(() => {
    for (const task of tasks) {
      const previous = taskStates.current.get(task.id);
      const stage = taskStage(task);
      if (previous?.status === task.status && previous?.stage === stage) continue;
      taskStates.current.set(task.id, { status: task.status, stage });
      const name = sources.find(item => item.id === task.sourceId)?.name || '录像源';
      const label = TASK_TYPES[task.kind]?.label || '后台任务';
      const events = {
        queued: [previous ? '重新排队' : '已加入队列', '等待处理资源，可以继续回看或离开当前页面。', 'info'],
        running: ['处理中', stage, 'info'],
        completed: ['演示完成', TASK_TYPES[task.kind]?.complete || '任务演示完成', 'info'],
        cancelled: ['已取消', '任务停止处理，原始录像文件未修改。', 'warning'],
        failed: ['失败', task.error || '任务处理失败，请查看任务详情。', 'error'],
      };
      const event = events[task.status];
      if (event) appendLog({ kind: task.kind, sourceId: task.sourceId, taskId: task.id, title: `${name} · ${label}${event[0]}`, detail: `${task.title}：${event[1]}`, level: event[2] });
      if (task.status === 'completed') {
        if (task.kind === 'scan') setSources(items => items.map(item => item.id === task.sourceId ? { ...item, lastScan: `今天 ${nowLabel()}` } : item));
        notify(`${label}演示已完成${task.kind === 'export' ? '，可到任务中心下载示例' : ''}`);
      }
    }
  }, [tasks, sources, appendLog, notify]);
  useEffect(() => {
    for (const item of sources) {
      const snapshot = JSON.stringify([item.name, item.path, item.enabled, item.interval]);
      const previous = sourceSnapshots.current.get(item.id);
      if (snapshot === previous) continue;
      sourceSnapshots.current.set(item.id, snapshot);
      appendLog({ kind: 'source', sourceId: item.id, title: `${item.name} · ${previous ? '录像源配置已更新' : '录像源已添加'}`, detail: `目录 ${item.path}；${item.enabled ? '已启用' : '已停用'}；扫描策略 ${item.interval === 'manual' ? '手动扫描' : `每 ${item.interval} 分钟`}`, level: item.enabled ? 'info' : 'warning' });
    }
  }, [sources, appendLog]);
  useEffect(() => {
    const snapshot = JSON.stringify(settings);
    if (snapshot === settingsSnapshot.current) return;
    const previous = JSON.parse(settingsSnapshot.current);
    const labels = { interval: '默认扫描间隔', skipRecent: '文件写入保护', autoNext: '自动连续回看', skipGaps: '自动跳过断档', defaultMode: '默认导出模式', maxDuration: '最长导出范围', concurrency: '后台并行任务数', timezone: '录像时区' };
    const changed = Object.keys(settings).filter(key => settings[key] !== previous[key]).map(key => labels[key] || key);
    settingsSnapshot.current = snapshot;
    appendLog({ kind: 'settings', title: '系统设置已保存', detail: `已更新：${changed.join('、')}。配置已保存到本地原型。` });
  }, [settings, appendLog]);
  useEffect(() => {
    const handler = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
      if (e.key === 'Escape') setMobileNav(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const navigate = target => { setPage(target); setMobileNav(false); };
  const openClip = clip => { setSourceId(clip.sourceId); setDate(clip.date); setClipId(clip.id); setSearchOpen(false); navigate('review'); };
  const scan = id => {
    const target = sources.find(s => s.id === id);
    if (!target?.enabled) return notify('请先启用这个录像源。');
    if (tasks.some(t => t.sourceId === id && t.kind === 'scan' && ['queued', 'running'].includes(t.status))) return notify('这个录像源正在扫描。');
    setTasks(previous => [{ id: crypto.randomUUID(), sourceId: id, title: `${target.name} · 目录扫描`, kind: 'scan', status: 'queued', progress: 0, created: `今天 ${nowLabel()}`, demo: true }, ...previous]);
    notify('扫描演示已开始，可在任务中心查看进度');
  };
  const createBackgroundTask = ({ kind, sourceId: id }) => {
    const target = sources.find(item => item.id === id);
    if (!target?.enabled) return notify('请先启用这个录像源。');
    if (tasks.some(task => task.kind === kind && task.sourceId === id && ['queued', 'running'].includes(task.status))) return notify('同一录像源已有此类任务在处理中。');
    setBackgroundDialog(false);
    if (kind === 'scan') return scan(id);
    setTasks(previous => [{ id: crypto.randomUUID(), sourceId: id, kind, title: `${target.name} · ${TASK_TYPES[kind].label}`, status: 'queued', progress: 0, created: `今天 ${nowLabel()}`, demo: true }, ...previous]);
    notify('后台演示任务已加入队列，可以继续回看');
  };
  const requestExport = range => setExportRange({ ...range, mode: settings.defaultMode });
  const createExport = range => {
    setTasks(previous => [{ ...range, id: crypto.randomUUID(), kind: 'export', title: range.name, status: 'queued', progress: 0, created: `今天 ${nowLabel()}`, demo: true }, ...previous]);
    setExportRange(null);
    notify('导出演示已加入队列，可继续回看录像');
  };
  const download = task => {
    const link = document.createElement('a');
    link.href = '/assets/studio-demo.mp4'; link.download = `Clipline_演示视频_${task.id.slice(0, 8)}.mp4`; link.click();
    notify('已下载 60 秒示例视频；原型不会拼接原始录像');
  };
  const searchResults = demoClips.filter(c => query && `${c.filename} ${sources.find(s => s.id === c.sourceId)?.name} ${clock(c.start)}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8);

  return <div className="app-shell">
    {mobileNav && <button className="nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <button className="brand" onClick={() => navigate('review')}><img src="/assets/clipline-logo.svg" alt="" /><span>Clipline<span className="brand-caption">你的录像，有迹可循。</span></span></button>
      <div className="sidebar-source-picker">
        <div className="source-picker-label"><label htmlFor="workspace-source">录像源</label><IconButton icon={Plus} label="添加录像源" onClick={() => setSourceDialog(true)} /></div>
        <div className="source-picker-control"><span className={`source-dot ${source.enabled ? source.color : 'neutral'}`} /><select id="workspace-source" aria-label="当前录像源" aria-describedby="workspace-source-summary" value={source.id} onChange={e => { setSourceId(e.target.value); navigate('review'); }}>{sources.map(item => <option key={item.id} value={item.id}>{item.name}{!item.enabled ? ' · 已停用' : ''}</option>)}</select></div>
        <p id="workspace-source-summary" className="source-picker-summary"><span>{source.count} 个片段</span><span>{source.enabled ? '已启用' : '已停用'}</span></p>
      </div>
      <nav aria-label="主导航">{nav.map(([id, label, Icon]) => <button key={id} aria-label={label} className={`nav-item ${page === id ? 'active' : ''} ${id === 'sources' ? 'nav-divider' : ''}`} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined}><Icon size={21} weight={page === id ? 'fill' : 'regular'} /><span>{label}</span>{id === 'tasks' && activeTasks > 0 && <span className="nav-count">{activeTasks}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="storage-card"><HardDrives size={20} /><div><strong>NAS 录像目录</strong><span>{sources.length} 个示例目录 · {sources.reduce((total, s) => total + parseFloat(s.size), 0).toFixed(1)} GB</span></div><Badge tone="blue" dot>只读</Badge></div><div className="prototype-label"><span className="status-dot" />一期交互原型<span>v0.1</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="topbar-context"><span className="mobile-menu"><IconButton icon={mobileNav ? X : List} label="切换导航" onClick={() => setMobileNav(!mobileNav)} /></span><span className="muted">工作空间</span><CaretRight size={12} /><strong>{nav.find(n => n[0] === page)?.[1]}</strong></div><div className="topbar-right"><button className="search-trigger" aria-label="搜索录像文件" onClick={() => setSearchOpen(true)}><MagnifyingGlass size={17} /><span>搜索录像文件</span><kbd>⌘ K</kbd></button><Badge tone="blue" dot>本地演示</Badge><div className="avatar" title="本地工作空间">Q</div></div></header>
      <main className="content">
        {page === 'review' && <Review source={source} clips={clips} clip={activeClip} setClipId={setClipId} date={date} setDate={setDate} onScan={() => scan(source.id)} scanning={tasks.some(t => t.kind === 'scan' && t.sourceId === source.id && ['running', 'queued'].includes(t.status))} onExport={requestExport} onLibrary={() => navigate('library')} settings={settings} notify={notify} />}
        {page === 'library' && <Library sources={sources} clips={demoClips} onOpen={openClip} onExport={requestExport} />}
        {page === 'tasks' && <Tasks tasks={tasks} sources={sources} onDownload={download} onCreate={() => setBackgroundDialog(true)} focusId={taskFocusId} onClearFocus={() => setTaskFocusId(null)} onViewLogs={id => { setLogTaskId(id); navigate('logs'); }} onCancel={id => { setTasks(previous => previous.map(task => task.id === id ? { ...task, status: 'cancelled' } : task)); notify('任务已取消'); }} onRetry={id => { setTasks(previous => previous.map(task => task.id === id ? { ...task, status: 'queued', progress: 0, ...(task.kind === 'export' ? { mode: 'precise' } : {}), error: null } : task)); notify('任务已重新加入队列'); }} />}
        {page === 'logs' && <Logs logs={logs} sources={sources} settings={settings} taskId={logTaskId} onClearTask={() => setLogTaskId(null)} onOpenTask={id => { setTaskFocusId(id); navigate('tasks'); }} notify={notify} />}
        {page === 'sources' && <Sources sources={sources} setSources={setSources} onScan={scan} tasks={tasks} onAdd={() => setSourceDialog(true)} onOpen={id => { setSourceId(id); navigate('review'); }} notify={notify} />}
        {page === 'settings' && <Settings settings={settings} setSettings={setSettings} draft={settingsDraft} setDraft={setSettingsDraft} defaults={initialSettings} notify={notify} />}
      </main>
      <footer className="app-footer"><span>Clipline · 为本地录像而生</span><span>示例数据与任务模拟 · 录像源文件只读</span></footer>
    </div>
    <Toast message={toast} onClose={closeToast} />
    {backgroundDialog && <BackgroundTaskDialog sources={sources} onClose={() => setBackgroundDialog(false)} onSubmit={createBackgroundTask} />}
    {exportRange && <ExportDialog range={exportRange} sources={sources} onClose={() => setExportRange(null)} onSubmit={createExport} maxDuration={Number(settings.maxDuration) * 60} />}
    {sourceDialog && <SourceDialog sources={sources} defaultInterval={settings.interval} onClose={() => setSourceDialog(false)} onSubmit={(newSource, { scanAfterAdd }) => { setSources(previous => [...previous, newSource]); setSourceId(newSource.id); setSourceDialog(false); if (scanAfterAdd) setTasks(previous => [{ id: crypto.randomUUID(), sourceId: newSource.id, title: `${newSource.name} · 首次目录扫描`, kind: 'scan', status: 'queued', progress: 0, created: `今天 ${nowLabel()}`, demo: true }, ...previous]); notify(scanAfterAdd ? '录像源已添加，首次扫描已加入后台队列' : '录像源已添加，可在需要时手动扫描'); navigate('sources'); }} />}
    {searchOpen && <Modal title="查找录像" description="按文件名、录像源名称或录制时间搜索示例数据。" onClose={() => { setSearchOpen(false); setQuery(''); }}><div className="search-field large"><MagnifyingGlass size={21} /><input ref={searchRef} autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="试试「工作室」或「09:16」" aria-label="搜索录像" /></div><div className="search-results">{!query ? <div className="search-help">搜索只基于文件信息。选择结果即可定位到回看时间线。</div> : searchResults.length ? searchResults.map(c => <button key={c.id} onClick={() => openClip(c)}><img src={c.image} alt="" /><div><strong>{sources.find(s => s.id === c.sourceId)?.name} · {clock(c.start)}</strong><span>{c.filename}</span></div><ArrowUpRight size={18} /></button>) : <EmptyState title="没有匹配的文件" description="换个文件名或录像源名称试试。" />}</div><ExtensionSlot name="search-provider" context={{ query, onOpen: openClip }} /></Modal>}
  </div>;
}

function ExportDialog({ range, sources, onClose, onSubmit, maxDuration }) {
  const source = sources.find(s => s.id === range.sourceId);
  const [start, setStart] = useState(clock(range.start));
  const [end, setEnd] = useState(clock(range.end));
  const [mode, setMode] = useState(range.mode);
  const [name, setName] = useState(`${source?.name || '录像'}_${range.date}_${clock(range.start).replaceAll(':', '')}`);
  const relevant = demoClips.filter(c => c.sourceId === range.sourceId && c.date === range.date && (!range.clipIds || range.clipIds.includes(c.id)));
  const summary = summarizeRange(relevant, seconds(start), seconds(end));
  const withinLimit = seconds(end) - seconds(start) <= maxDuration;
  return <Modal title="导出录像区间" description="确认时间范围，创建一个后台导出任务。" onClose={onClose}><form onSubmit={e => { e.preventDefault(); if (summary.valid && withinLimit) onSubmit({ ...range, name: name.trim(), start: seconds(start), end: seconds(end), mode }); }}>
    <div className="export-source"><img src={source?.image} alt="" /><div><strong>{source?.name}</strong><span>{range.date} · {summary.clips.length} 个片段</span></div><Badge>MP4</Badge></div>
    <label className="field">文件名称<input value={name} onChange={e => setName(e.target.value)} required maxLength={100} /><small>下载示例视频时会使用演示文件名。</small></label>
    <div className="field-row"><label className="field">开始时间<input type="time" step="1" required value={start} onInput={e => setStart(e.currentTarget.value)} onChange={e => setStart(e.target.value)} /></label><label className="field">结束时间<input type="time" step="1" required value={end} onInput={e => setEnd(e.currentTarget.value)} onChange={e => setEnd(e.target.value)} /></label></div>
    <div className="mode-options">{[['fast', '快速导出', '直接拼接，速度更快'], ['precise', '精准导出', '重新编码，精确到选定时间']].map(([id, label, hint]) => <label className={`mode-option ${mode === id ? 'selected' : ''}`} key={id}><input type="radio" name="export-mode" checked={mode === id} onChange={() => setMode(id)} /><span><strong>{label}</strong><small>{hint}</small></span>{mode === id && <Check size={18} />}</label>)}</div>
    <div className="export-summary"><span>预计录像时长</span><strong>{duration(summary.coverage)}</strong></div>
    {summary.gap > 0 && <Notice warning>所选区间有 {duration(summary.gap)} 无录像，导出将跳过这些时间。</Notice>}
    {(!summary.valid || !withinLimit) && <Notice warning>{!withinLimit ? `单次导出范围不能超过 ${maxDuration / 60} 分钟。` : summary.message}</Notice>}
    <p className="demo-note">原型模拟任务进度，下载为 60 秒示例视频；正式版将接入 FFmpeg 区间拼接。</p>
    <div className="modal-footer"><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" disabled={!summary.valid || !withinLimit || !name.trim()}><DownloadSimple size={17} />创建导出任务</button></div>
  </form></Modal>;
}

function BackgroundTaskDialog({ sources, onClose, onSubmit }) {
  const [kind, setKind] = useState('scan');
  const [sourceId, setSourceId] = useState(sources.find(source => source.enabled)?.id || '');
  return <Modal title="新建后台任务" description="提交后可以继续操作，在任务中心查看结果。" onClose={onClose}><form onSubmit={event => { event.preventDefault(); onSubmit({ kind, sourceId }); }}>
    <label className="field">任务类型<select aria-label="后台任务类型" value={kind} onChange={event => setKind(event.target.value)}>{Object.entries(TASK_TYPES).filter(([id]) => id !== 'export').map(([id, config]) => <option key={id} value={id}>{config.label}</option>)}</select></label>
    <p className="background-task-description">{TASK_TYPES[kind].description}</p>
    <label className="field">录像源<select aria-label="后台任务录像源" value={sourceId} onChange={event => setSourceId(event.target.value)}>{!sourceId && <option value="">暂无启用的录像源</option>}{sources.map(source => <option key={source.id} value={source.id} disabled={!source.enabled}>{source.name}{!source.enabled ? ' · 已停用' : ''}</option>)}</select></label>
    <p className="demo-note">原型演示排队、进度与日志，不读取真实目录或执行转码。录像导出请在回看或片段库中选定时间范围后提交。</p>
    <div className="modal-footer"><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" disabled={!sourceId}><Plus size={17} />加入后台队列</button></div>
  </form></Modal>;
}
