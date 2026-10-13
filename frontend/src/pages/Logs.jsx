import { useState } from 'react';
import { ArrowRight, DownloadSimple, FileText, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import { TASK_TYPES } from '../domain';
import { Badge, EmptyState, Modal, PageHeading } from '../components/UI';

const levels = { info: ['信息', 'blue'], warning: ['警告', 'amber'], error: ['错误', 'red'] };
const kinds = { ...Object.fromEntries(Object.entries(TASK_TYPES).map(([id, config]) => [id, config.label])), source: '录像源配置', settings: '系统设置', system: '系统运行' };
const logTime = log => log.createdAt ? new Date(log.createdAt).toLocaleString('zh-CN', { hour12: false }) : log.time;

export default function Logs({ logs, sources, settings, taskId, onClearTask, onOpenTask, notify }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [level, setLevel] = useState('all');
  const [sourceId, setSourceId] = useState('all');
  const [selected, setSelected] = useState(null);
  const sourceName = id => sources.find(source => source.id === id)?.name || (id ? '未知录像源' : '工作空间');
  const filtered = logs.filter(log => (!taskId || log.taskId === taskId) && (kind === 'all' || log.kind === kind) && (level === 'all' || (log.level || 'info') === level) && (sourceId === 'all' || log.sourceId === sourceId) && `${log.title} ${log.detail} ${sourceName(log.sourceId)} ${logTime(log)} ${log.taskId || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const hasFilters = query || kind !== 'all' || level !== 'all' || sourceId !== 'all' || taskId;
  function clearFilters() { setQuery(''); setKind('all'); setLevel('all'); setSourceId('all'); onClearTask(); }
  function download(data, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); notify('日志文件已下载');
  }
  return <div className="logs-page">
    <PageHeading eyebrow="EVERY OPERATION LEAVES A TRACE" title="日志中心" description="查看任务过程、配置变更与异常，找到每一步发生了什么。">
      <button className="button secondary" onClick={() => download({ version: '0.1.0-prototype', settings, sources, logs }, 'clipline-prototype-diagnostics.json')}><DownloadSimple size={17} />下载诊断</button>
      <button className="button primary" disabled={!filtered.length} onClick={() => download(filtered, 'clipline-logs.json')}><DownloadSimple size={17} />导出日志</button>
    </PageHeading>
    <div className="log-summary"><span>共 <strong>{logs.length}</strong> 条记录</span><span>警告 <strong>{logs.filter(log => log.level === 'warning').length}</strong></span><span>错误 <strong>{logs.filter(log => log.level === 'error').length}</strong></span><Badge>本地原型记录</Badge></div>
    <section className="panel log-center-panel">
      <div className="log-center-toolbar">
        <div className="search-field"><MagnifyingGlass size={18} /><input value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索日志" placeholder="搜索事件、录像源或任务 ID…" /></div>
        <select aria-label="筛选日志类型" value={kind} onChange={event => setKind(event.target.value)}><option value="all">全部类型</option>{Object.entries(kinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        <select aria-label="筛选日志级别" value={level} onChange={event => setLevel(event.target.value)}><option value="all">全部级别</option>{Object.entries(levels).map(([id, [label]]) => <option key={id} value={id}>{label}</option>)}</select>
        <select aria-label="筛选日志录像源" value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="all">全部录像源</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select>
      </div>
      <div className="log-results-heading"><span>{filtered.length} 条匹配记录</span>{hasFilters && <button className="text-button" onClick={clearFilters}>清除筛选</button>}</div>
      {taskId && <div className="log-task-filter"><FileText size={16} /><span>仅查看关联任务 <code>{taskId}</code></span><button className="text-button" onClick={onClearTask}>查看全部日志</button></div>}
      {!filtered.length ? <EmptyState title="没有匹配的日志" description="调整筛选条件，或提交一个后台任务查看运行记录。" action={clearFilters} actionLabel="清除筛选" /> : <div className="log-entries">{filtered.map(log => <button className="log-entry" key={log.id} aria-label={`查看日志：${log.title}`} onClick={() => setSelected(log)}>
        <span className={`log-entry-icon ${log.level || 'info'}`}>{log.level === 'error' || log.level === 'warning' ? <WarningCircle size={19} /> : <FileText size={19} />}</span>
        <div className="log-entry-text"><div><strong>{log.title}</strong><Badge tone={levels[log.level || 'info']?.[1]}>{levels[log.level || 'info']?.[0] || '信息'}</Badge></div><p>{log.detail}</p><span>{kinds[log.kind] || '系统运行'} · {sourceName(log.sourceId)}{log.taskId && ' · 关联任务'}</span></div>
        <time>{logTime(log)}</time><ArrowRight size={15} />
      </button>)}</div>}
    </section>
    <p className="task-bottom-note">日志保存在当前浏览器；真实服务端日志将在正式版接入。</p>
    {selected && <Modal title="日志详情" onClose={() => setSelected(null)}><div className="log-detail"><h3>{selected.title}</h3><Badge tone={levels[selected.level || 'info']?.[1]}>{levels[selected.level || 'info']?.[0] || '信息'}</Badge><p>{selected.detail}</p><dl><div><dt>时间</dt><dd>{logTime(selected)}</dd></div><div><dt>类型</dt><dd>{kinds[selected.kind] || '系统运行'}</dd></div><div><dt>录像源</dt><dd>{sourceName(selected.sourceId)}</dd></div>{selected.taskId && <div><dt>关联任务</dt><dd><code>{selected.taskId}</code></dd></div>}</dl>{selected.taskId && <button className="button primary full" onClick={() => { setSelected(null); onOpenTask(selected.taskId); }}>查看关联任务<ArrowRight size={16} /></button>}</div></Modal>}
  </div>;
}
