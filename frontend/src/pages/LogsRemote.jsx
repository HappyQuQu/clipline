import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowClockwise, DownloadSimple, FileText, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import { logSummary } from '../api/logs';
import { TASK_TYPES } from '../domain';
import { queryString, request, downloadJson } from '../api/client';
import { Badge, EmptyState, Modal, Notice, PageHeading } from '../components/UI';
const levels = { info: ['信息', 'blue'], warning: ['警告', 'amber'], error: ['错误', 'red'] };
const kinds = { ...Object.fromEntries(Object.entries(TASK_TYPES).map(([id, config]) => [id, config.label])), source: '录像源配置', settings: '系统设置', system: '系统运行' };
export default function LogsRemote({ sources, taskId, onClearTask, onOpenTask, notify, refresh, retentionDays }) {
  const [query, setQuery] = useState(''), [kind, setKind] = useState(''), [level, setLevel] = useState(''), [sourceId, setSourceId] = useState('');
  const [page, setPage] = useState({ items: [], summary: {} }), [error, setError] = useState(''), [loading, setLoading] = useState(false), [moreLoading, setMoreLoading] = useState(false);
  const [selected, setSelected] = useState(null), [reload, setReload] = useState(0), [hasUpdate, setHasUpdate] = useState(false);
  const params = { q: query.trim(), kind: kind || undefined, level: level || undefined, sourceId: sourceId || undefined, taskId: taskId || undefined };
  const context = queryString(params), current = useRef(context), firstRefresh = useRef(refresh), controller = useRef(null);
  current.current = context;
  useEffect(() => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setLoading(true); setError(''); setSelected(null); setPage({ items: [], summary: {} }); setHasUpdate(false);
    const timer = setTimeout(() => request(`/logs?${context}&limit=50`, { signal: abort.signal }).then(data => { if (!abort.signal.aborted) { setPage({ ...data, summary: data.summary || { total: data.items.length } }); setLoading(false); } }).catch(failure => { if (failure.name !== 'AbortError') { setError(failure.message); setLoading(false); } }), 180);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [context, reload]);
  useEffect(() => { if (refresh !== firstRefresh.current) { firstRefresh.current = refresh; setHasUpdate(true); } }, [refresh]);
  async function more() {
    const cursor = page.nextCursor, captured = context; setMoreLoading(true);
    try { const data = await request(`/logs?${captured}&limit=50&${queryString({ cursor })}`, { signal: controller.current.signal }); if (current.current === captured) setPage(old => old.nextCursor === cursor ? { ...data, items: [...old.items, ...data.items] } : old); }
    catch (failure) { if (failure.name !== 'AbortError' && current.current === captured) setError(failure.message); }
    finally { if (current.current === captured) setMoreLoading(false); }
  }
  async function detail(row) {
    try { const data = await request(`/logs/${row.id}`); if (current.current === context) setSelected(data); }
    catch (failure) { notify(failure.message); }
  }
  async function download(diagnostic) {
    try { await downloadJson(diagnostic ? '/system/diagnostics' : '/logs/export', { ...params, snapshot: page.snapshot }, diagnostic ? 'clipline-diagnostics.json' : 'clipline-logs.json'); notify('已开始下载当前筛选的完整记录。'); }
    catch (failure) { notify(failure.message || '服务暂时无法下载，请稍后重试。'); }
  }
  function clear() { setQuery(''); setKind(''); setLevel(''); setSourceId(''); onClearTask(); }
  const sourceName = id => sources.find(source => source.id === id)?.name || (id ? '未知录像源' : '工作空间');
  const time = row => new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false });
  return <div className="logs-page">
    <PageHeading eyebrow="EVERY OPERATION LEAVES A TRACE" title="日志中心" description="查看任务过程、配置变更与异常，找到每一步发生了什么。"><button className="button secondary" disabled={loading || page.snapshot == null} onClick={() => download(true)}><DownloadSimple size={17} />下载诊断</button><button className="button primary" disabled={loading || !page.summary.total} onClick={() => download(false)}><DownloadSimple size={17} />导出日志</button></PageHeading>
    <div className="log-summary"><span>匹配 <strong>{page.summary.total || 0}</strong> 条</span><span>警告 <strong>{page.summary.warning || 0}</strong></span><span>错误 <strong>{page.summary.error || 0}</strong></span><Badge>服务端记录</Badge><button className="text-button" onClick={() => setReload(value => value + 1)}><ArrowClockwise size={15} />{hasUpdate ? '有新记录 · 刷新' : '刷新日志'}</button></div>
    {error && <Notice warning>{error}</Notice>}
    <section className="panel log-center-panel"><div className="log-center-toolbar"><div className="search-field"><MagnifyingGlass size={18} /><input value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索日志" placeholder="搜索事件、录像源或任务 ID…" /></div><select aria-label="筛选日志类型" value={kind} onChange={event => setKind(event.target.value)}><option value="">全部类型</option>{Object.entries(kinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><select aria-label="筛选日志级别" value={level} onChange={event => setLevel(event.target.value)}><option value="">全部级别</option>{Object.entries(levels).map(([id, [label]]) => <option key={id} value={id}>{label}</option>)}</select><select aria-label="筛选日志录像源" value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">全部录像源</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></div>
      <div className="log-results-heading"><span>已加载 {page.items.length} / {page.summary.total || 0} 条</span><button className="text-button" onClick={clear}>清除筛选</button></div>
      {taskId && <div className="log-task-filter"><FileText size={16} /><span>仅查看关联任务 <code>{taskId}</code></span><button className="text-button" onClick={onClearTask}>查看全部日志</button></div>}
      {loading ? <p className="log-loading" role="status">正在查询服务端记录…</p> : !page.items.length ? <EmptyState title="没有匹配的日志" description="调整筛选条件，或提交一个后台任务查看运行记录。" action={clear} actionLabel="清除筛选" /> : <div className="log-entries">{page.items.map(row => <button className="log-entry" key={row.id} aria-label={`查看日志：${row.title}`} onClick={() => detail(row)}><span className={`log-entry-icon ${row.level}`}>{row.level !== 'info' ? <WarningCircle size={19} /> : <FileText size={19} />}</span><div className="log-entry-text"><div><strong>{row.title}</strong><Badge tone={levels[row.level]?.[1]}>{levels[row.level]?.[0]}</Badge></div><p>{logSummary(row)}</p><span>{kinds[row.kind]} · {sourceName(row.sourceId)}{row.taskId && ' · 关联任务'}</span></div><time>{time(row)}</time><ArrowRight size={15} /></button>)}</div>}
      {page.nextCursor && <div className="log-more"><button className="button secondary" disabled={moreLoading} onClick={more}>{moreLoading ? '正在加载…' : '加载更多记录'}</button></div>}
    </section><p className="task-bottom-note">业务日志保留 {retentionDays || 30} 天。筛选与分页由服务端执行，导出包含当前快照的全部匹配记录。</p>
    {selected && <Modal title="日志详情" onClose={() => setSelected(null)} footer={<><button type="button" className="button secondary" onClick={() => setSelected(null)}>关闭</button>{selected.taskId && <button type="button" className="button primary" onClick={() => { setSelected(null); onOpenTask(selected.taskId); }}>查看关联任务<ArrowRight size={16} /></button>}</>}><div className="log-detail"><h3>{selected.title}</h3><Badge tone={levels[selected.level]?.[1]}>{levels[selected.level]?.[0]}</Badge><dl><div><dt>时间</dt><dd>{time(selected)}</dd></div><div><dt>类型</dt><dd>{kinds[selected.kind]}</dd></div><div><dt>录像源</dt><dd>{sourceName(selected.sourceId)}</dd></div><div><dt>事件</dt><dd><code>{selected.eventCode}</code></dd></div>{selected.taskId && <div><dt>关联任务</dt><dd><code>{selected.taskId}</code></dd></div>}</dl><pre className="log-json">{JSON.stringify(selected.detail, null, 2)}</pre></div></Modal>}
  </div>;
}
