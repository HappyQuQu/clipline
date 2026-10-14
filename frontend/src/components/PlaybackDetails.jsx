import { useEffect, useRef, useState } from 'react';
import { DownloadSimple, FilmStrip, FolderSimple, Scissors, X } from '@phosphor-icons/react';
import { clock, duration } from '../domain';
import { Badge, ExtensionSlot, IconButton, Modal } from './UI';

export default function PlaybackDetails({ clip, source, onClose, onManage, onExport, exportEnabled = true, forceDrawer = false, exportDate, onWatch }) {
  const [drawer, setDrawer] = useState(() => forceDrawer || window.matchMedia('(max-width: 1180px)').matches);
  const closeRef = useRef(onClose);
  const scrollRef = useRef(null);
  closeRef.current = onClose;
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1180px)');
    const update = () => setDrawer(forceDrawer || query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [forceDrawer]);
  useEffect(() => {
    if (drawer) return;
    const closeOnEscape = e => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) closeRef.current();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [drawer]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [clip.id, drawer]);

  const content = <>
    <div className="inspector-preview"><img src={clip.image} alt={`${source.name} ${clip.real ? clip.startLabel : clock(clip.start)} 片段预览`} /><span>{duration(clip.end - clip.start)}</span></div>
    <div className="inspector-source"><div><span className={`source-dot ${source.enabled ? source.color : 'neutral'}`} /><h3>{source.name}</h3></div><Badge>{clip.codec}</Badge></div>
    <p className="inspector-recorded-date">{clip.date} · {clip.real ? clip.startLabel : clock(clip.start)} – {clip.real ? `${clip.endDate !== clip.date ? clip.endDate + ' ' : ''}${clip.endLabel}` : clock(clip.end)}</p>
    <section className="inspector-section"><h3>录像信息</h3><dl><div><dt>开始时间</dt><dd>{clip.real ? clip.startLabel : clock(clip.start)}</dd></div><div><dt>结束时间</dt><dd>{clip.real ? `${clip.endDate !== clip.date ? clip.endDate + ' ' : ''}${clip.endLabel}` : clock(clip.end)}</dd></div><div><dt>录像时长</dt><dd>{duration(clip.end - clip.start)}</dd></div><div><dt>分辨率</dt><dd>{clip.resolution}</dd></div><div><dt>视频编码</dt><dd>{clip.codec}</dd></div><div><dt>文件大小</dt><dd>{clip.size}</dd></div><div><dt>{clip.real ? '文件状态' : '示例内容'}</dt><dd>{clip.real ? ({ available: '可用', missing: '文件缺失', pending: '持续写入', invalid: '文件异常' }[clip.availability] || clip.availability) : clip.media ? '可播放视频' : '静态画面'}</dd></div>{clip.real && <><div><dt>音频编码</dt><dd>{clip.audioCodec || '无音轨'}</dd></div><div><dt>时间来源</dt><dd>{clip.timeSource === 'mtime' ? '文件修改时间 · 估算' : clip.timeSource === 'filename' ? '文件名' : '目录时间'}</dd></div><div><dt>播放方式</dt><dd>{clip.playbackStatus === 'direct' ? '原始文件' : '兼容播放版本'}</dd></div></>}</dl></section>
    <section className="inspector-section"><h3>文件与来源</h3><label className="inspector-file">文件名称<code>{clip.filename}</code></label><label className="inspector-file">源目录<code><FolderSimple size={13} />{source.path}</code></label></section>
    <ExtensionSlot name="clip-detail" context={{ clip, source }} />
  </>;
  const actions = <div className="inspector-actions"><button className="button primary full" disabled={!exportEnabled} onClick={() => onExport({ sourceId: source.id, date: exportDate || clip.date, ...(clip.real ? { startAt: clip.startAt, endAt: clip.endAt } : { start: clip.start, end: clip.end }), clipIds: [clip.id] })}><DownloadSimple size={17} />导出这个片段</button><button className="button secondary full" onClick={onWatch || onManage}><Scissors size={17} />{onWatch ? '在时间线中回看' : '在时间轴中截取'}</button><p>{clip.real ? '文件信息来自真实索引，原始录像只读，导出在后台处理。' : '文件信息为示例数据，原始录像只读。'}</p></div>;
  const scrollContent = <div className="inspector-scroll" ref={scrollRef} role="region" aria-label="片段详情内容" tabIndex={0}>{content}</div>;

  if (drawer) return <Modal title="片段详情" className="playback-details-drawer" onClose={onClose}>{scrollContent}{actions}</Modal>;
  return <aside className="review-inspector panel" aria-label="片段详情"><header className="inspector-heading"><h2><FilmStrip size={18} />片段详情</h2><IconButton icon={X} label="关闭片段详情" onClick={onClose} /></header>{scrollContent}{actions}</aside>;
}
