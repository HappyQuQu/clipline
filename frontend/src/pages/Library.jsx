import { useMemo, useState } from 'react';
import { MagnifyingGlass, SquaresFour, ListBullets, Play, DownloadSimple, Check, X, ArrowRight, FilmStrip, Clock, HardDrive, CalendarBlank } from '@phosphor-icons/react';
import { clock, duration, DEMO_DATE } from '../domain';
import { Badge, EmptyState, ExtensionSlot, IconButton, PageHeading } from '../components/UI';

export default function Library({ sources, clips, onOpen, onExport }) {
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [date, setDate] = useState(DEMO_DATE);
  const [view, setView] = useState('grid');
  const [selected, setSelected] = useState([]);
  const [focusedId, setFocusedId] = useState(clips[0].id);
  const searchQuery = query.trim().replaceAll('：', ':').toLowerCase();
  const filtered = useMemo(() => clips.filter(c => (sourceFilter === 'all' || c.sourceId === sourceFilter) && (!date || c.date === date) && `${c.filename} ${clock(c.start)} ${clock(c.end)}`.toLowerCase().includes(searchQuery)), [clips, searchQuery, sourceFilter, date]);
  const focused = filtered.find(c => c.id === focusedId) || filtered[0];
  const focusedSource = sources.find(s => s.id === focused?.sourceId);
  const chosen = clips.filter(c => selected.includes(c.id));
  const compatible = chosen.every(c => c.sourceId === chosen[0]?.sourceId && c.date === chosen[0]?.date);
  function toggle(c) { setFocusedId(c.id); setSelected(previous => previous.includes(c.id) ? previous.filter(id => id !== c.id) : [...previous, c.id]); }
  function filter(setter, value) { setter(value); setSelected([]); }
  function exportClips(items) {
    onExport({ sourceId: items[0].sourceId, date: items[0].date, start: Math.min(...items.map(c => c.start)), end: Math.max(...items.map(c => c.end)), clipIds: items.map(c => c.id) });
  }
  return <div className="library-page"><PageHeading eyebrow="YOUR RECORDING ARCHIVE" title="片段库" description="所有录像，井然有序。按文件信息找到你需要的片段。"><button className="button primary" disabled={!selected.length || !compatible} onClick={() => exportClips(chosen)}><DownloadSimple size={18} />导出选中片段</button></PageHeading>
    <div className="library-toolbar"><div className="search-field"><MagnifyingGlass size={18} /><input value={query} onChange={e => filter(setQuery, e.target.value)} placeholder="搜索文件名或时间，如 09:16…" aria-label="搜索文件名或时间" /></div><select aria-label="筛选录像源" value={sourceFilter} onChange={e => filter(setSourceFilter, e.target.value)}><option value="all">全部录像源</option>{sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><input type="date" aria-label="筛选片段日期" value={date} onInput={e => filter(setDate, e.currentTarget.value)} onChange={e => filter(setDate, e.target.value)} /><div className="view-switch"><IconButton icon={SquaresFour} label="网格视图" aria-pressed={view === 'grid'} onClick={() => setView('grid')} /><IconButton icon={ListBullets} label="列表视图" aria-pressed={view === 'list'} onClick={() => setView('list')} /></div></div>
    <ExtensionSlot name="library-filters" context={{ sourceFilter, date, query, onQueryChange: value => filter(setQuery, value) }} />
    <div className="library-meta"><span>共 <strong>{filtered.length}</strong> 个示例片段</span><button className="text-button" onClick={() => setSelected(selected.length === filtered.length ? [] : filtered.map(c => c.id))}>{selected.length === filtered.length && filtered.length ? '取消全选' : '全选当前结果'}</button></div>
    <div className="library-layout"><div>{!filtered.length ? <div className="panel"><EmptyState title="没有匹配的片段" description="调整录像源、日期、文件名或时间，重新查看结果。" action={() => { setQuery(''); setSourceFilter('all'); setDate(DEMO_DATE); }} actionLabel="清除筛选" /></div> : <div className={`library-clips ${view}`}>{filtered.map(c => <article className={`library-card ${focused?.id === c.id ? 'focused' : ''} ${selected.includes(c.id) ? 'selected' : ''}`} key={c.id}><div className="library-image"><button className="card-preview" onClick={() => setFocusedId(c.id)} aria-label={`查看 ${sources.find(s => s.id === c.sourceId)?.name} ${clock(c.start)} 片段详情`}><img src={c.image} alt={`${sources.find(s => s.id === c.sourceId)?.name} ${clock(c.start)} 录像画面`} loading="lazy" /></button><input className="clip-checkbox" type="checkbox" aria-label={`选择 ${c.filename}`} checked={selected.includes(c.id)} onChange={() => toggle(c)} /><span className="image-duration">01:00</span><button className="card-play" onClick={() => onOpen(c)} aria-label={`回看 ${c.filename}`}><Play size={22} weight="fill" /></button></div><button className="library-card-info" onClick={() => setFocusedId(c.id)}><div><strong>{sources.find(s => s.id === c.sourceId)?.name}</strong><Badge>{c.codec}</Badge></div><span className="clip-time">{clock(c.start)} – {clock(c.end)}</span><span className="clip-filename" title={c.filename}>{c.filename}</span><span className="clip-file-meta">{c.date} <span>·</span> {c.size}</span></button></article>)}</div>}</div>
      {focused && <aside className="clip-detail panel"><div className="section-heading"><h2>片段详情</h2><FilmStrip size={19} /></div><img className="detail-image" src={focused.image} alt={`${focusedSource?.name}片段预览`} /><h3>{focusedSource?.name}</h3><span className="detail-date"><CalendarBlank size={14} />{focused.date} · {clock(focused.start)}</span><dl><div><dt>录像时长</dt><dd>01:00</dd></div><div><dt>分辨率</dt><dd>{focused.resolution}</dd></div><div><dt>视频编码</dt><dd>{focused.codec}</dd></div><div><dt>文件大小</dt><dd>{focused.size}</dd></div><div><dt>示例内容</dt><dd>{focused.media ? '可播放视频' : '静态画面'}</dd></div></dl><div className="detail-file"><span>文件名称</span><code>{focused.filename}</code></div><ExtensionSlot name="clip-detail" context={{ clip: focused, source: focusedSource }} /><button className="button primary full" onClick={() => onOpen(focused)}><Play size={17} weight="fill" />在时间线中回看<ArrowRight size={16} /></button><button className="button secondary full" onClick={() => exportClips([focused])}><DownloadSimple size={17} />导出这个片段</button><p className="range-hint">仅浏览索引，不修改录像源文件。</p></aside>}
    </div>
    {selected.length > 0 && <div className="batch-bar" role="status"><span className="batch-count"><Check size={18} />已选择 {selected.length} 个片段</span><span className="batch-hint">{compatible ? `共 ${duration(chosen.reduce((sum, c) => sum + c.end - c.start, 0))} 录像` : '请选取同一录像源、同一天的片段进行合并'}</span><button className="button quiet" onClick={() => setSelected([])}>取消选择</button><button className="button primary" disabled={!compatible} onClick={() => exportClips(chosen)}><DownloadSimple size={17} />合并导出</button></div>}
  </div>;
}
