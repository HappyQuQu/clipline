import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Clock, DownloadSimple, ArrowsOut, Play, Pause, SpeakerHigh, SpeakerSlash, ArrowClockwise, CircleNotch, FilmStrip, Info, SidebarSimple } from '@phosphor-icons/react';
import { clock, duration, seconds, summarizeRange } from '../domain';
import { Badge, EmptyState, IconButton, Notice } from '../components/UI';
import VerticalTimeline from '../components/VerticalTimeline';
import PlaybackDetails from '../components/PlaybackDetails';

export default function Review({ source, clips, clip, setClipId, date, setDate, onScan, scanning, onExport, onLibrary, settings, notify }) {
  const video = useRef(null);
  const stage = useRef(null);
  const pendingSeek = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [offset, setOffset] = useState(0);
  const [muted, setMuted] = useState(true);
  const [speed, setSpeed] = useState('1');
  const [rangeStart, setRangeStart] = useState(clip?.start || 0);
  const [rangeEnd, setRangeEnd] = useState(clip?.end || 0);
  const [managing, setManaging] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [rangeDirty, setRangeDirty] = useState(false);
  const summary = summarizeRange(clips, rangeStart, rangeEnd);
  const current = (clip?.start || 0) + offset;


  useEffect(() => {
    setOffset(pendingSeek.current);
    if (!rangeDirty) { setRangeStart(clip?.start || 0); setRangeEnd(clip?.end || 0); }
    setMediaError(false);
    if (!clip?.media) setPlaying(false);
  }, [clip?.id]);
  useEffect(() => {
    pendingSeek.current = 0; setOffset(0); setPlaying(false); setManaging(false); setDetailsOpen(false);
    setRangeDirty(false); setRangeStart(clip?.start || 0); setRangeEnd(clip?.end || 0);
  }, [source.id, date]);
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    player.playbackRate = Number(speed);
    if (playing) player.play().catch(() => setPlaying(false)); else player.pause();
  }, [playing, speed, clip?.id]);

  function select(target, seekOffset = 0, showDetails = false) {
    if (!target) return;
    if (showDetails) openDetails();
    pendingSeek.current = seekOffset;
    if (target.id === clip?.id) { if (video.current) video.current.currentTime = seekOffset; setOffset(seekOffset); }
    else setClipId(target.id);
  }
  function seekAbsolute(value) {
    const found = clips.find(c => value >= c.start && value < c.end);
    if (found) select(found, value - found.start, true);
    else notify('这个时间点没有录像，点击蓝色区间查看已有录像。');
  }
  function step(direction) {
    const index = clips.findIndex(c => c.id === clip?.id);
    select(clips[index + direction]);
  }
  function onEnded() {
    const next = clips[clips.findIndex(c => c.id === clip.id) + 1];
    if (!settings.autoNext || !next) return setPlaying(false);
    const gap = next.start - clip.end;
    if (gap > 0) {
      if (!settings.skipGaps) { notify(`下一片段前有 ${gap} 秒断档，点击下一段继续。`); return setPlaying(false); }
      notify(`已跳过 ${gap} 秒断档，继续播放下一片段`);
    }
    select(next);
    setPlaying(true);
  }
  function shiftDate(delta) {
    const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + delta); setDate(next.toISOString().slice(0, 10));
  }
  function openDetails() { setManaging(false); setDetailsOpen(true); }
  function toggleManaging() { setDetailsOpen(false); setManaging(value => !value); }
  function manageCurrentClip() {
    setDetailsOpen(false);
    setRangeStart(clip.start); setRangeEnd(clip.end); setRangeDirty(true);
    setManaging(true);
  }
  function requestExport() { onExport({ sourceId: source.id, date, start: rangeStart, end: rangeEnd }); }

  return <div className="review-page">
    {!source.enabled && <Notice warning>这个录像源已停用。仍可查看已索引片段，启用后可继续扫描。</Notice>}
    <h1 className="review-screen-reader">录像回看</h1>
      <div className={`unifi-review-layout ${managing ? 'managing' : ''} ${detailsOpen && clip ? 'with-details' : ''}`}>
        <VerticalTimeline clips={clips} clip={clip} date={date} current={current} onDateChange={setDate} onShiftDate={shiftDate} onSeek={seekAbsolute} managing={managing} range={{ start: rangeStart, end: rangeEnd }} onRangeChange={range => { setRangeDirty(true); setRangeStart(range.start); setRangeEnd(range.end); }} onManage={toggleManaging} />
        <div className="unifi-viewing-column">
          <header className="unifi-camera-heading"><div className="source-select"><span className={`source-dot ${source.enabled ? 'blue' : 'neutral'}`} /><FilmStrip size={17} /><strong className="camera-source-name" title={source.name}>{source.name}</strong><span className="camera-resolution">1920 × 1080</span></div><div><IconButton icon={SidebarSimple} label={detailsOpen ? '收起片段详情' : '打开片段详情'} aria-expanded={detailsOpen} disabled={!clip} onClick={() => detailsOpen ? setDetailsOpen(false) : openDetails()} /><button className="button quiet small" disabled={scanning || !source.enabled} onClick={onScan}>{scanning ? <CircleNotch className="spin" size={16} /> : <ArrowClockwise size={16} />}{scanning ? '扫描中' : '扫描新录像'}</button></div></header>
        {!clip ? <div className="panel"><EmptyState title="这一天还没有录像" description="可以切换到 2026 年 10 月 12 日或 13 日查看示例，或尝试扫描当前目录。" action={onScan} actionLabel="扫描目录" /></div> : <section className="player-panel" aria-label="录像播放器">
          <div className="video-stage" ref={stage} onClick={openDetails}>
            {clip.media && !mediaError ? <video key={clip.id} ref={video} src={clip.media} poster={clip.image} muted={muted} playsInline preload="metadata" onLoadedMetadata={() => { if (!video.current) return; video.current.currentTime = pendingSeek.current; pendingSeek.current = 0; if (playing) video.current.play().catch(() => setPlaying(false)); }} onTimeUpdate={() => setOffset(video.current?.currentTime || 0)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={onEnded} onError={() => { setMediaError(true); setPlaying(false); }} onClick={() => setPlaying(!playing)} aria-label={`${source.name}示例录像`} /> : <img src={clip.image} alt={`${source.name}录像示例画面`} />}
            <div className="video-top"><Badge tone="video" dot>{source.name}</Badge><span>{date.replaceAll('-', '/')}<strong>{clock(current)}</strong></span></div>
            {!playing && clip.media && !mediaError && <button className="stage-play" onClick={() => setPlaying(true)} aria-label="播放录像"><Play size={30} weight="fill" /></button>}
            {(!clip.media || mediaError) && <div className="static-preview"><Info size={22} /><strong>{mediaError ? '示例视频加载失败' : '静态画面预览'}</strong><span>{mediaError ? '可以刷新页面重新尝试。' : '此源提供示例截图，切换「工作室」体验视频播放。'}</span></div>}
            <span className="video-demo">{clip.media ? '示例录像 · 60 秒' : '示例截图'}</span>
          </div>
          <div className="player-controls"><IconButton icon={playing ? Pause : Play} label={playing ? '暂停录像' : '播放录像'} disabled={!clip.media || mediaError} onClick={() => setPlaying(!playing)} /><span className="player-clock">{duration(offset)}<span> / 01:00</span></span><input type="range" min="0" max="60" step="0.1" value={offset} aria-label="片段播放进度" disabled={!clip.media || mediaError} onChange={e => { const value = Number(e.target.value); if (video.current) video.current.currentTime = value; setOffset(value); }} /><select className="speed-select" aria-label="播放速度" value={speed} onChange={e => setSpeed(e.target.value)}><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select><IconButton icon={muted ? SpeakerSlash : SpeakerHigh} label={muted ? '取消静音' : '静音'} onClick={() => setMuted(!muted)} /><IconButton icon={ArrowsOut} label="全屏播放" onClick={() => stage.current?.requestFullscreen?.().catch(() => notify('当前浏览器暂时无法进入全屏。'))} /></div>
          <div className="player-caption"><FilmStrip size={16} /><span title={clip.filename}>{clip.filename}</span><Badge>{clip.codec}</Badge><span>1080p</span></div>
        </section>}
      {clip && <section className="clip-section"><div className="section-heading"><h2>当前时段片段 <span className="count-label">{clips.length}</span></h2><button className="text-button" onClick={onLibrary}>在片段库中查看<ArrowUpRightIcon /></button></div><div className="clip-strip">{clips.map(c => <button className={`strip-card ${c.id === clip.id ? 'selected' : ''}`} key={c.id} onClick={() => select(c, 0, true)} aria-pressed={c.id === clip.id}><div className="clip-image"><img src={c.image} alt={`${source.name} ${clock(c.start)} 录像画面`} loading="lazy" /><span>01:00</span>{c.id === clip.id && <span className="now-playing"><Play weight="fill" size={12} />当前片段</span>}</div><strong>{clock(c.start)}</strong><span>{clock(c.start)} – {clock(c.end)}</span></button>)}</div></section>}
        </div>
        {detailsOpen && clip && <PlaybackDetails clip={clip} source={source} onClose={() => setDetailsOpen(false)} onManage={manageCurrentClip} onExport={onExport} />}
        {managing && clip && <>
        <aside className="range-panel panel"><div className="section-heading"><h2>管理片段</h2><button className="text-button" onClick={() => setManaging(false)}>关闭</button></div><p className="section-description">拖动时间轴上的边界，或输入起止时间。</p>
          <label className="field range-field">开始时间<div className="time-input"><Clock size={17} /><input type="time" step="1" value={clock(rangeStart)} aria-label="导出开始时间" onInput={e => { if (e.currentTarget.value) { setRangeDirty(true); setRangeStart(seconds(e.currentTarget.value)); } }} onChange={e => { if (e.target.value) { setRangeDirty(true); setRangeStart(seconds(e.target.value)); } }} /><button className="text-button" onClick={() => { setRangeDirty(true); setRangeStart(Math.floor(current)); }}>设为当前</button></div></label>
          <label className="field range-field">结束时间<div className="time-input"><Clock size={17} /><input type="time" step="1" value={clock(rangeEnd)} aria-label="导出结束时间" onInput={e => { if (e.currentTarget.value) { setRangeDirty(true); setRangeEnd(seconds(e.currentTarget.value)); } }} onChange={e => { if (e.target.value) { setRangeDirty(true); setRangeEnd(seconds(e.target.value)); } }} /><button className="text-button" onClick={() => { setRangeDirty(true); setRangeEnd(Math.floor(current)); }}>设为当前</button></div></label>
          <div className="range-facts"><div><span>实际录像</span><strong>{duration(summary.coverage)}</strong></div><div><span>包含片段</span><strong>{summary.clips.length}<small> 个</small></strong></div></div>
          {!summary.valid && <p className="form-error" role="status">{summary.message}</p>}{summary.gap > 0 && <div className="gap-note"><Info size={15} />{duration(summary.gap)} 无录像，导出时自动跳过</div>}
          <button className="button primary full" onClick={requestExport} disabled={!summary.valid}><DownloadSimple size={18} />导出选定区间<ArrowRight size={16} /></button><p className="range-hint">后台处理，可以继续回看。</p>
        </aside>

        </>}
      </div>
  </div>;
}

function ArrowUpRightIcon() { return <ArrowRight size={15} />; }
