import { createId } from '../id';
import { useRef, useState } from 'react';
import { ArrowRight, Check, Clock, FolderSimple, HardDrives, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { validateSourcePath } from '../domain';
import { Badge, EmptyState, ExtensionSlot, Modal } from './UI';
import DirectoryBrowser from './DirectoryBrowser';

const exampleDirectories = [
  { path: '/recordings/studio', name: '工作室' },
  { path: '/recordings/front-door', name: '家门口' },
  { path: '/recordings/garage', name: '车库' },
  { path: '/recordings/living-room', name: '客厅' },
  { path: '/recordings/entrance', name: '入口' },
  { path: '/recordings/terrace', name: '阳台' },
];

export default function SourceDialog({ sources, defaultInterval, onClose, onSubmit, real = false }) {
  const submitKey = useRef({});
  const pending = useRef(false), pathInput = useRef(null), nameInput = useRef(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [interval, setScanInterval] = useState(defaultInterval);
  const [scanAfterAdd, setScanAfterAdd] = useState(true);
  const [recognition, setRecognition] = useState({ autoTranscribe: false, autoDetect: false });
  const [browsing, setBrowsing] = useState(false);
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [pathTouched, setPathTouched] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const validation = validateSourcePath(path, sources);
  const nameError = nameTouched && !name.trim() ? '请为录像源填写一个名称。' : '';
  const directories = [...exampleDirectories, ...sources.filter(source => !exampleDirectories.some(directory => directory.path === source.path)).map(source => ({ name: source.name, path: source.path }))];
  const visibleDirectories = directories.filter(directory => `${directory.name} ${directory.path}`.toLowerCase().includes(directoryQuery.trim().toLowerCase())).sort((left, right) => Number(sources.some(source => source.path === left.path)) - Number(sources.some(source => source.path === right.path)));
  function updatePath(value, suggestion) {
    setPath(value);
    if (!nameEdited) {
      const normalized = validateSourcePath(value, []).path;
      const suggested = suggestion || exampleDirectories.find(directory => directory.path === normalized)?.name || normalized.split('/').at(-1);
      setName((suggested && suggested !== 'recordings' ? suggested : '').slice(0, 30));
    }
  }
  function selectDirectory(directory) { updatePath(directory.path, directory.name); setPathTouched(true); setBrowsing(false); setDirectoryQuery(''); }
  async function submit(event) {
    event.preventDefault(); if (pending.current) return; setPathTouched(true); setNameTouched(true);
    if (validation.error || !name.trim()) { (validation.error ? pathInput : nameInput).current?.focus(); return; }
    const source = { id: createId(), name: name.trim(), path: validation.path, enabled: true, status: 'configured', description: '自定义录像目录', image: '/assets/studio.jpg', count: 0, size: '0 GB', lastScan: '尚未扫描', interval, color: 'blue', ...recognition };
    const signature = JSON.stringify([source.name, source.path, interval, scanAfterAdd]);
    if (submitKey.current.signature !== signature) submitKey.current = { signature, key: createId() };
    pending.current = true; setBusy(true); setError('');
    try { await onSubmit(source, { scanAfterAdd, key: submitKey.current.key }); } catch (failure) { setError(failure.message); } finally { pending.current = false; setBusy(false); }
  }
  return <Modal title="添加录像源" description="选择录像目录，给它一个容易识别的名字。" className="source-dialog" onClose={onClose} busy={busy} form={{ onSubmit: submit, noValidate: true }} footer={<><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy || !path.trim()}><Plus size={17} />{busy ? '正在添加…' : scanAfterAdd ? '添加并扫描' : '添加录像源'}</button></>}>
      <div className="source-setup-context"><span><HardDrives size={20} /></span><div><strong>本地与 NAS 录像目录</strong><p>从录像根目录中选择文件夹，也可以手动填写。</p></div><Badge>只读接入</Badge></div>
      <div className="field source-directory-field"><label htmlFor="new-source-path">录像目录 <span className="required-mark">必填</span></label><div className={`source-path-input ${pathTouched && validation.error ? 'invalid' : ''}`}><FolderSimple size={18} /><input id="new-source-path" ref={pathInput} value={path} onChange={event => updatePath(event.target.value)} onBlur={() => { if (path.trim()) setPathTouched(true); }} aria-invalid={pathTouched && !!validation.error} aria-describedby={`source-path-help${pathTouched && validation.error ? ' new-source-path-error' : ''}`} placeholder="/recordings/living-room" autoComplete="off" /><button type="button" className={browsing ? 'active' : ''} aria-expanded={browsing} aria-controls="source-directory-browser" onClick={() => setBrowsing(value => !value)}>浏览目录</button></div><small id="source-path-help">录像根目录：<code>/recordings</code> · 支持子文件夹</small>{pathTouched && validation.error && <p id="new-source-path-error" className="form-error" role="alert">{validation.error}</p>}</div>
      {browsing && real && <DirectoryBrowser sources={sources} onSelect={selectDirectory} />}
      {browsing && !real && <section className="source-directory-browser" id="source-directory-browser" aria-label="选择示例录像目录"><header><strong><FolderSimple size={15} />/recordings</strong><Badge>示例目录</Badge><button className="icon-button" type="button" aria-label="收起目录浏览" onClick={() => setBrowsing(false)}><X size={15} /></button></header><div className="search-field"><MagnifyingGlass size={16} /><input aria-label="搜索示例目录" onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} placeholder="查找目录名称…" value={directoryQuery} onChange={event => setDirectoryQuery(event.target.value)} /></div><div className="source-directory-list">{visibleDirectories.length ? visibleDirectories.map(directory => {
        const added = sources.find(source => source.path === directory.path);
        return <button type="button" key={directory.path} disabled={!!added} aria-pressed={validation.path === directory.path} onClick={() => selectDirectory(directory)} aria-label={`选择目录 ${directory.name}${added ? '，已添加' : ''}`}><FolderSimple size={20} /><span><strong>{directory.name}</strong><code>{directory.path}</code></span>{added ? <span className="directory-added"><Check size={12} />已添加</span> : validation.path === directory.path ? <Check size={15} /> : <ArrowRight size={15} />}</button>;
      }) : <EmptyState title="没有匹配的示例目录" description="也可以收起浏览列表，手动填写目录路径。" />}</div><p className="source-directory-note">此列表用于原型演示，不代表真实 NAS 上的目录。</p></section>}
      <div className="field-row source-setup-fields"><label className="field">录像源名称<input aria-label="录像源名称" ref={nameInput} value={name} onChange={event => { setName(event.target.value); setNameEdited(true); }} onBlur={() => setNameTouched(true)} placeholder="选目录后自动建议名称" maxLength={30} aria-invalid={!!nameError} /><small>可修改为「客厅」「入口」等名称。</small>{nameError && <p className="form-error" role="alert">{nameError}</p>}</label><label className="field">扫描频率<select aria-label="新录像源扫描频率" value={interval} onChange={event => setScanInterval(event.target.value)}><option value="5">每 5 分钟</option><option value="10">每 10 分钟</option><option value="30">每 30 分钟</option><option value="manual">仅手动扫描</option></select><small>后续可在录像源设置中调整。</small></label></div>
      <label className="source-first-scan"><input type="checkbox" checked={scanAfterAdd} onChange={event => setScanAfterAdd(event.target.checked)} aria-label="添加后立即扫描" /><span><strong>添加后立即扫描</strong><small>首次扫描加入后台队列，你可以继续回看。</small></span><Clock size={18} /></label>
      <ExtensionSlot name="source-settings" context={{ source: { name, path: validation.path, interval, ...recognition }, update: patch => setRecognition(previous => ({ ...previous, ...patch })) }} />
      <p className="source-setup-note">仅读取目录，不改动原始录像。{real ? '真实目录与读取权限在保存时检查，扫描由服务端持续处理。' : '原型保存配置并演示扫描；真实目录与读取权限将在正式版检查。'}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
  </Modal>;
}
