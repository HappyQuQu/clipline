import { useEffect, useRef, useState } from 'react';
import { Plus, FolderSimple, ArrowClockwise, Play, ArrowRight, CircleNotch, HardDrives, CheckCircle, PauseCircle, PencilSimple, Check } from '@phosphor-icons/react';
import { Badge, EmptyState, ExtensionSlot, Notice, PageHeading } from '../components/UI';
import { validateSourcePath } from '../domain';

export default function Sources({ sources, setSources, onScan, tasks, onAdd, onOpen, notify, real = false, onSave, onToggle }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editPanel = useRef(null);
  useEffect(() => { if (editing) editPanel.current?.scrollIntoView({ block: 'center' }); }, [editing]);
  const active = sources.filter(s => s.enabled).length;
  function edit(source) { setEditing(source.id); setDraft({ autoTranscribe: false, autoDetect: false, ...source }); setError(''); }
  async function save(e) {
    e.preventDefault();
    const { path, error: pathError } = validateSourcePath(draft.path, sources, editing);
    if (pathError) return setError(pathError);
    if (real) { setBusy(true); try { await onSave(sources.find(row => row.id === editing), { name: draft.name.trim(), path, scanIntervalMinutes: draft.interval === 'manual' ? null : Number(draft.interval) }); setEditing(null); notify('录像源配置已保存'); } catch (failure) { setError(failure.message); } finally { setBusy(false); } return; }
    setSources(previous => previous.map(s => s.id === editing ? { ...draft, name: draft.name.trim(), path } : s)); setEditing(null); notify('录像源配置已保存');
  }
  return <div className="sources-page"><PageHeading eyebrow="ONE PLACE FOR EVERY SOURCE" title="连接你的录像。" description="管理 NAS 与本地目录，让每一个录像源都有自己的时间线。"><button className="button primary" onClick={onAdd}><Plus size={18} />添加录像源</button></PageHeading>
    <div className="source-overview"><div><span className="status-dot" /><strong>{active} 个录像源已启用</strong><span className="muted"> / {sources.length} 个目录</span></div><span><FolderSimple size={17} />共 {sources.reduce((total, s) => total + s.count, 0)} 个{real ? '真实索引' : '示例索引'}</span></div>
    <div className="source-cards">{sources.map(s => {
      const scanning = tasks.some(t => t.kind === 'scan' && t.sourceId === s.id && ['queued', 'running', 'cancelling'].includes(t.status));
      return <article className={`source-card panel ${!s.enabled ? 'paused' : ''}`} key={s.id}><div className="source-cover">{s.count > 0 ? <img src={s.image} alt={`${s.name}录像示例`} /> : <div className="source-empty-cover"><FolderSimple size={34} /><strong>{scanning ? '首次扫描中' : '暂无录像'}</strong><span>{scanning ? '正在建立目录索引' : '扫描后在这里查看录像'}</span></div>}<Badge tone={s.enabled ? 'blue' : 'neutral'} dot>{s.enabled ? '已启用' : '已停用'}</Badge><button className="source-view" onClick={() => onOpen(s.id)}><Play size={17} weight="fill" />回看录像<ArrowRight size={15} /></button></div><div className="source-card-body"><div className="section-heading"><h2>{s.name}</h2><button className="icon-button" onClick={() => edit(s)} aria-label={`编辑${s.name}`}><PencilSimple size={18} /></button></div><p>{s.description}</p><div className="source-path"><FolderSimple size={16} /><code title={s.path}>{s.path}</code></div><div className="source-metrics"><div><strong>{s.count}</strong><span>录像片段</span></div><div><strong>{s.size}</strong><span>{real ? '文件占用' : '示例占用'}</span></div></div><dl className="source-info"><div><dt>扫描策略</dt><dd>{s.interval === 'manual' ? '手动扫描' : `每 ${s.interval} 分钟`}</dd></div><div><dt>最近扫描</dt><dd>{s.lastScan}</dd></div></dl><div className="source-card-actions"><button className="button secondary" disabled={!s.enabled || scanning} onClick={() => onScan(s.id)}>{scanning ? <CircleNotch size={17} className="spin" /> : <ArrowClockwise size={17} />}{scanning ? '扫描中' : '立即扫描'}</button><button className="button quiet" onClick={async () => { if (real) { try { await onToggle(s); notify(`${s.name}已${s.enabled ? '停用' : '启用'}`); } catch (failure) { notify(failure.message); } return; } setSources(previous => previous.map(item => item.id === s.id ? { ...item, enabled: !item.enabled, status: item.enabled ? 'paused' : 'online' } : item)); notify(`${s.name}已${s.enabled ? '停用' : '启用'}`); }}>{s.enabled ? '停用' : '启用'}</button></div></div></article>;
    })}<button className="add-source-card" onClick={onAdd}><span><Plus size={27} /></span><strong>添加另一个录像源</strong><p>NAS 目录、摄像机备份或本地硬盘</p></button></div>
    {editing && <section className="panel source-edit" ref={editPanel}><div className="section-heading"><h2>编辑录像源</h2><Badge>{real ? '服务端配置' : '本地配置'}</Badge></div><form onSubmit={save}><div className="field-row"><label className="field">名称<input required maxLength={30} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><label className="field">扫描策略<select value={draft.interval} onChange={e => setDraft({ ...draft, interval: e.target.value })}><option value="5">每 5 分钟</option><option value="10">每 10 分钟</option><option value="30">每 30 分钟</option><option value="manual">手动扫描</option></select></label></div><label className="field">录像目录<input required disabled={real && (draft.count > 0 || tasks.some(task => task.sourceId === draft.id && ['queued', 'running', 'cancelling'].includes(task.status)))} value={draft.path} onChange={e => setDraft({ ...draft, path: e.target.value })} /></label><ExtensionSlot name="source-settings" context={{ source: draft, update: patch => setDraft(previous => ({ ...previous, ...patch })) }} />{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><button type="button" className="button secondary" onClick={() => setEditing(null)}>取消</button><button className="button primary" disabled={busy || !draft.name.trim()}><Check size={17} />保存配置</button></div></form></section>}
    <div className="source-safety"><HardDrives size={24} /><div><strong>你的原始录像，始终留在原处。</strong><p>Clipline 仅读取视频目录并建立索引，所有导出都生成新文件，不改写、不移动、不删除原始录像。</p></div></div>
  </div>;
}
