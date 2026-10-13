import { useCallback, useEffect, useState } from 'react';
import { PlayCircle, SquaresFour, Stack, FolderSimple, GearSix, MagnifyingGlass, CaretRight, Plus, HardDrives, FileText, List, X, ArrowRight } from '@phosphor-icons/react';
import { Badge, EmptyState, ExtensionSlot, IconButton, Modal, Notice, Toast } from './components/UI';
import Review from './pages/Review';
import Library from './pages/Library';
import Sources from './pages/Sources';
import Tasks from './pages/Tasks';
import Logs from './pages/Logs';
import ExportDialog from './components/ExportDialog';
import SourceDialog from './components/SourceDialog';
import { pages, queryString, request } from './api/client';
import { bytes, clipView, dateInZone, sourceView, taskView, reviewContext } from './api/adapters';
import { clock } from './domain';
const nav = [['review', '录像回看', PlayCircle], ['library', '片段库', SquaresFour], ['tasks', '任务中心', Stack], ['logs', '日志中心', FileText], ['sources', '录像源', FolderSimple], ['settings', '设置', GearSix]];
const defaults = { autoNext: true, skipGaps: true, interval: '5', timezone: 'Asia/Shanghai' };

export default function App() {
  const [exportRange, setExportRange] = useState(null);
  const [page, setPage] = useState('review');
  const [sources, setSources] = useState([]), [tasks, setTasks] = useState([]), [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState(defaults), [caps, setCaps] = useState(null);
  const [selection, setSelection] = useState({ sourceId: '', date: '', clipId: '', offset: 0, details: false, dateAuto: true, generation: 0 });
  const [timeline, setTimeline] = useState(null), [active, setActive] = useState(null);
  const [windowRange, setWindowRange] = useState(null), [dates, setDates] = useState([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [timelineError, setTimelineError] = useState('');
  const [refresh, setRefresh] = useState(0), [toast, setToast] = useState(''), [dialog, setDialog] = useState(false);
  const [mobileNav, setMobileNav] = useState(false), [searchOpen, setSearchOpen] = useState(false), [query, setQuery] = useState(''), [results, setResults] = useState([]), [searchError, setSearchError] = useState(''), [searchLoading, setSearchLoading] = useState(false);
  const [taskDialog, setTaskDialog] = useState(false), [taskKind, setTaskKind] = useState('scan');
  const [logTask, setLogTask] = useState(null), [taskFocus, setTaskFocus] = useState(null);
  const notify = useCallback(message => setToast(message), []), closeToast = useCallback(() => setToast(''), []);
  const source = sources.find(row => row.id === selection.sourceId);
  const context = reviewContext(selection);
  const visibleTimeline = timeline?.context === context ? timeline : null;
  const clip = active?.context === context ? active.clip : null;
  const clips = visibleTimeline?.items.map(row => clipView(row, visibleTimeline.dayStartAt, settings.timezone)) || [];
  const timezone = settings.timezone;
  const indexStamp = source?.lastScanAt;
  const activeTasks = tasks.filter(task => ['queued', 'running', 'cancelling'].includes(task.status)).length;

  useEffect(() => {
    const controller = new AbortController(); let running = false;
    async function sync() {
      if (running) return; running = true;
      try {
        const [flags, sourceData, taskData, configured] = await Promise.all([request('/capabilities', { signal: controller.signal }), request('/sources', { signal: controller.signal }), pages('/tasks', {}, controller.signal), request('/settings', { signal: controller.signal })]);
        if (controller.signal.aborted) return;
        setCaps(flags); setSources(sourceData.items.map(sourceView)); setTasks(taskData);
        setSettings({ ...defaults, ...configured.groups.playback?.values, interval: String(configured.groups.scan?.values.interval || 5), timezone: configured.deployment.timezone });
        setSelection(current => current.sourceId || !sourceData.items.length ? current : { ...current, sourceId: sourceData.items[0].id });
        setError(''); setLoading(false);
      } catch (failure) { if (failure.name !== 'AbortError') { setError(failure.message); setLoading(false); } }
      finally { running = false; }
    }
    sync(); const timer = setInterval(sync, 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh]);
  // Source/date changes are explicit context boundaries. Old requests never publish into the new context.
  useEffect(() => {
    if (!selection.sourceId) return;
    const controller = new AbortController();
    request(`/sources/${selection.sourceId}/dates?${queryString({ viewTimezone: timezone })}`, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return; setDates(data.items);
      setSelection(current => current.sourceId === selection.sourceId && (!current.date || (current.dateAuto && data.items.length && !data.items.includes(current.date))) ? { ...current, date: data.items[0] || dateInZone(Date.now(), timezone), generation: (current.generation || 0) + 1 } : current);
    }).catch(failure => { if (failure.name !== 'AbortError') setTimelineError(failure.message); });
    return () => controller.abort();
  }, [selection.sourceId, refresh, timezone, indexStamp]);
  const startSeconds = windowRange?.context === context ? windowRange.start : 0;
  const endSeconds = windowRange?.context === context ? windowRange.end : 90000;
  useEffect(() => {
    if (!selection.sourceId || !selection.date) return;
    const controller = new AbortController(); setTimelineError('');
    request(`/timeline?${queryString({ sourceId: selection.sourceId, date: selection.date, viewTimezone: timezone, startSeconds, endSeconds, limit: 200 })}`, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      setTimeline({ ...data, context, windowKey: `${context}:${startSeconds}:${endSeconds}` });
      setActive(current => { const row = data.items.find(item => item.id === (selection.clipId || current?.clip?.id)) || (!selection.clipId && current?.context !== context ? data.items[0] : null); return row ? { context, clip: clipView(row, data.dayStartAt, timezone) } : current?.context === context ? current : null; });
      if (!selection.clipId && data.items[0] && active?.context !== context) { const first = clipView(data.items[0], data.dayStartAt, timezone); setSelection(current => current.sourceId === selection.sourceId && current.date === selection.date ? { ...current, offset: Math.max(0, -first.start) } : current); }
    }).catch(failure => { if (failure.name !== 'AbortError') { setTimelineError(failure.message); setTimeline(null); } });
    return () => controller.abort();
  }, [context, startSeconds, endSeconds, refresh, timezone, indexStamp]);
  useEffect(() => {
    if (!selection.clipId || !visibleTimeline?.dayStartAt) return;
    const controller = new AbortController();
    request(`/segments/${selection.clipId}`, { signal: controller.signal }).then(row => {
      if (!controller.signal.aborted && row.sourceId === selection.sourceId) setActive({ context, clip: clipView(row, visibleTimeline.dayStartAt, timezone) });
    }).catch(failure => { if (failure.name !== 'AbortError') notify(failure.message); });
    return () => controller.abort();
  }, [selection.clipId, context, visibleTimeline?.dayStartAt, timezone, indexStamp, notify]);
  useEffect(() => {
    if (!searchOpen || !query.trim()) { setResults([]); setSearchLoading(false); return; }
    const controller = new AbortController(); setResults([]); setSearchError(''); setSearchLoading(true);
    const timer = setTimeout(() => request(`/segments?${queryString({ q: query, limit: 30, viewTimezone: timezone })}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setResults(data.items.map(row => clipView(row, null, timezone))); setSearchLoading(false); } }).catch(failure => { if (failure.name !== 'AbortError') { setSearchError(failure.message); setSearchLoading(false); } }), 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, searchOpen, timezone]);
  useEffect(() => {
    if (page !== 'logs') return;
    const controller = new AbortController();
    pages('/logs', { taskId: logTask }, controller.signal).then(rows => { if (!controller.signal.aborted) setLogs(rows.map(row => ({ ...row, detail: JSON.stringify(row.detail) }))); }).catch(failure => { if (failure.name !== 'AbortError') notify(failure.message); });
    return () => controller.abort();
  }, [page, logTask, tasks, notify]);
  useEffect(() => {
    const handler = event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); } if (event.key === 'Escape') setMobileNav(false); };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);
  function navigate(value) { setPage(value); setMobileNav(false); }
  function changeSource(id) { setActive(null); setTimeline(null); setSelection(current => ({ sourceId: id, date: '', clipId: '', offset: 0, details: false, dateAuto: true, generation: (current.generation || 0) + 1 })); setDates([]); setWindowRange(null); navigate('review'); }
  function changeDate(date) { setActive(null); setTimeline(null); setSelection(current => ({ ...current, date, clipId: '', offset: 0, details: false, dateAuto: false, generation: (current.generation || 0) + 1 })); setWindowRange(null); }
  function selectClip(target, offset = 0, details = true) {
    setActive({ context, clip: target }); setSelection(current => ({ ...current, clipId: target.id, offset, details }));
  }
  function openClip(target) { setActive(null); setSelection(current => ({ sourceId: target.sourceId, date: target.date, clipId: target.id, offset: 0, details: true, dateAuto: false, generation: (current.generation || 0) + 1 })); setWindowRange(null); setSearchOpen(false); navigate('review'); }
  async function action(path, body = {}) { try { const result = await request(path, { method: 'POST', body, key: crypto.randomUUID() }); setRefresh(value => value + 1); return result; } catch (failure) { notify(failure.message); return null; } }
  async function scan(id) { const result = await action(`/sources/${id}/scan`); if (result) notify(result.reused ? '这个源已有扫描任务，已定位现有任务。' : '扫描已加入后台队列，可继续回看。'); }
  async function patchSource(row, patch) { await request(`/sources/${row.id}`, { method: 'PATCH', body: { ...patch, revision: row.revision } }); setRefresh(value => value + 1); }
  const onWindow = useCallback((start, end) => setWindowRange(current => current?.context === context && current.start === start && current.end === end ? current : { context, start, end }), [context]);
  async function loadMore() {
    const captured = `${context}:${startSeconds}:${endSeconds}`;
    try { const data = await request(`/timeline?${queryString({ sourceId: selection.sourceId, date: selection.date, viewTimezone: timezone, startSeconds, endSeconds, cursor: visibleTimeline.nextCursor, limit: 200 })}`); setTimeline(current => current?.windowKey === captured ? { ...current, items: [...current.items, ...data.items], nextCursor: data.nextCursor } : current); } catch (failure) { notify(failure.message); }
  }
  async function followTask(path, body = {}) { const result = await action(path, body); if (result?.taskId) { setTaskFocus(result.taskId); notify("已重新加入后台队列，原任务记录保留。"); } }
  const beginExport = range => setExportRange(range);
  async function download(task) {
    try {
      const response = await fetch(task.result.downloadUrl, { method: 'HEAD' });
      if (!response.ok) { const data = await request(`/exports/${task.id}/download`); return data; }
      const anchor = document.createElement('a'); anchor.href = task.result.downloadUrl; anchor.download = task.result.name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    } catch (failure) { notify(failure.message); }
  }
  return <div className="app-shell">
    {mobileNav && <button className="nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <button className="brand" onClick={() => navigate('review')}><img src="/assets/clipline-logo.svg" alt="" /><span>Clipline<span className="brand-caption">你的录像，有迹可循。</span></span></button>
      <div className="sidebar-source-picker"><div className="source-picker-label"><label htmlFor="workspace-source">录像源</label><IconButton icon={Plus} label="添加录像源" onClick={() => setDialog(true)} /></div><div className="source-picker-control"><span className="source-dot blue" /><select id="workspace-source" aria-label="当前录像源" value={source?.id || ''} onChange={event => changeSource(event.target.value)}>{!source && <option value="">{loading ? '加载录像源…' : '暂无录像源'}</option>}{sources.map(row => <option key={row.id} value={row.id}>{row.name}{row.enabled ? '' : ' · 已停用'}</option>)}</select></div><p className="source-picker-summary"><span>{source?.count || 0} 个片段</span><span>{source ? source.enabled ? '已启用' : '已停用' : '添加目录开始'}</span></p></div>
      <nav aria-label="主导航">{nav.map(([id, label, Icon]) => <button key={id} aria-label={label} className={`nav-item ${page === id ? 'active' : ''} ${id === 'sources' ? 'nav-divider' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={21} weight={page === id ? 'fill' : 'regular'} /><span>{label}</span>{id === 'tasks' && activeTasks > 0 && <span className="nav-count">{activeTasks}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="storage-card"><HardDrives size={20} /><div><strong>NAS 录像目录</strong><span>{sources.length} 个目录 · {bytes(sources.reduce((sum, row) => sum + row.totalBytes, 0))}</span></div><Badge tone="blue" dot>只读</Badge></div><div className="prototype-label"><span className="status-dot" />本地录像工作台<span>v0.5</span></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="topbar-context"><span className="mobile-menu"><IconButton icon={mobileNav ? X : List} label="切换导航" onClick={() => setMobileNav(!mobileNav)} /></span><span className="muted">工作空间</span><CaretRight size={12} /><strong>{nav.find(row => row[0] === page)?.[1]}</strong></div><div className="topbar-right"><button className="search-trigger" aria-label="搜索录像文件" onClick={() => setSearchOpen(true)}><MagnifyingGlass size={17} /><span>搜索录像文件</span><kbd>⌘ K</kbd></button><Badge tone="blue" dot>真实录像</Badge></div></header>
      <main className="content">
        {error && <Notice warning>{error}<button className="text-button" onClick={() => setRefresh(value => value + 1)}>重新连接</button></Notice>}
        {loading ? <div className="panel"><EmptyState title="正在连接本地录像服务" description="读取录像源和索引…" /></div> : <>
          {page === 'review' && (source ? <>{timelineError && <Notice warning>{timelineError}</Notice>}<Review key={context} real source={source} clips={clips} clip={clip} setClipId={id => { const target = clips.find(row => row.id === id); if (target) selectClip(target); }} onSelect={selectClip} initialOffset={selection.offset} initialDetails={selection.details} timeline={visibleTimeline} onWindow={onWindow} onLoadMore={loadMore} dates={dates} date={selection.date || dateInZone(Date.now(), timezone)} setDate={changeDate} onScan={() => scan(source.id)} scanning={tasks.some(row => row.kind === 'scan' && row.sourceId === source.id && ['queued', 'running', 'cancelling'].includes(row.status))} onExport={beginExport} exportEnabled={!!caps?.export} onLibrary={() => navigate('library')} settings={settings} notify={notify} />{!selection.date && <p role="status">正在读取录像日期…</p>}</> : <div className="panel"><EmptyState title="添加你的第一个录像源" description="从只读挂载的录像目录开始建立时间索引。" action={() => setDialog(true)} actionLabel="添加录像源" /></div>)}
          {page === 'library' && <Library real sources={sources} clips={[]} onOpen={openClip} onExport={beginExport} defaultDate={selection.date} timezone={timezone} exportEnabled={!!caps?.export} />}
          {page === 'sources' && <Sources real sources={sources} tasks={tasks} onScan={scan} onAdd={() => setDialog(true)} onOpen={changeSource} notify={notify} onSave={patchSource} onToggle={row => patchSource(row, { enabled: !row.enabled })} />}
          {page === 'tasks' && <Tasks key={taskFocus || "all"} real tasks={tasks.map(row => taskView(row, sources))} sources={sources} onDownload={download} onResubmit={id => followTask(`/exports/${id}/resubmit`)} onCreate={() => setTaskDialog(true)} onCancel={id => action(`/tasks/${id}/cancel`)} onRetry={(id, mode) => followTask(`/tasks/${id}/retry`, mode ? { mode } : {})} onViewLogs={id => { setLogTask(id); navigate('logs'); }} focusId={taskFocus} onClearFocus={() => setTaskFocus(null)} />}
          {page === 'logs' && <Logs real logs={logs} sources={sources} settings={settings} taskId={logTask} onClearTask={() => setLogTask(null)} onOpenTask={id => { setTaskFocus(id); navigate('tasks'); }} notify={notify} />}
          {page === 'settings' && <section className="panel real-settings"><h1>设置</h1><p>当前读取服务端配置；分类保存将在 D5 接入。</p><dl><div><dt>录像时区</dt><dd>{timezone}</dd></div><div><dt>默认扫描间隔</dt><dd>{settings.interval} 分钟</dd></div><div><dt>自动续播</dt><dd>{settings.autoNext ? '开启' : '关闭'}</dd></div><div><dt>跳过断档</dt><dd>{settings.skipGaps ? '开启' : '关闭'}</dd></div></dl><ExtensionSlot name="settings-section" context={{ settings }} /></section>}
        </>}
      </main><footer className="app-footer"><span>Clipline · 为本地录像而生</span><span>真实索引与后台播放准备 · 录像源文件只读</span></footer>
    </div><Toast message={toast} onClose={closeToast} />
    {exportRange && <ExportDialog range={exportRange} timezone={timezone} source={sources.find(row => row.id === exportRange.sourceId)} onClose={() => setExportRange(null)} onSubmitted={id => { setExportRange(null); setTaskFocus(id); navigate("tasks"); setRefresh(value => value + 1); notify("导出已加入后台队列，可离开页面继续处理。"); }} />}
    {dialog && <SourceDialog real sources={sources} defaultInterval={settings.interval} onClose={() => setDialog(false)} onSubmit={async (row, { scanAfterAdd, key }) => { const result = await request('/sources', { method: 'POST', key, body: { name: row.name, path: row.path, scanIntervalMinutes: row.interval === 'manual' ? null : Number(row.interval), scanOnCreate: scanAfterAdd, autoTranscribe: false, autoDetect: false } }); setDialog(false); changeSource(result.source.id); setRefresh(value => value + 1); notify(result.firstTaskId ? '录像源已添加，首次扫描已加入后台队列。' : '录像源已添加。'); }} />}
    {taskDialog && <Modal title="新建后台任务" description="扫描与索引重建在后台持续执行。播放准备从回看自动提交，导出从回看或片段库提交。" onClose={() => setTaskDialog(false)}><form onSubmit={async event => { event.preventDefault(); const result = await action('/tasks', { sourceId: source?.id, kind: taskKind }); if (result) { setTaskDialog(false); notify('任务已加入后台队列。'); } }}><label className="field">任务类型<select value={taskKind} onChange={event => setTaskKind(event.target.value)}><option value="scan">目录扫描</option><option value="reindex">索引重建</option></select></label><p>当前录像源：{source?.name || '请先选择录像源'}</p><button className="button primary" disabled={!source?.enabled}>加入后台队列</button></form></Modal>}
    {searchOpen && <Modal title="查找录像" description="按文件名或起止时间搜索真实索引。" onClose={() => { setSearchOpen(false); setQuery(''); }}><div className="search-field large"><MagnifyingGlass size={21} /><input autoFocus aria-label="搜索录像" value={query} onChange={event => setQuery(event.target.value)} placeholder="输入文件名或 08:25…" /></div>{searchError && <Notice warning>{searchError}</Notice>}<div className="search-results">{searchLoading && <p role="status">正在查询真实录像…</p>}{results.map(row => <button key={row.id} onClick={() => openClip(row)}><img src={row.image} alt="" /><div><strong>{sources.find(item => item.id === row.sourceId)?.name} · {row.date} {clock(row.start)}</strong><span>{row.filename}</span></div><ArrowRight size={18} /></button>)}{query && !searchLoading && !results.length && !searchError && <EmptyState title="没有匹配的录像" description="调整文件名或时间后重试。" />}</div><ExtensionSlot name="search-provider" context={{ query }} /></Modal>}
  </div>;
}
