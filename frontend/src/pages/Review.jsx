import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Clock, DownloadSimple, ArrowsOut, Play, Pause, SpeakerHigh, SpeakerSlash, ArrowClockwise, CircleNotch, FilmStrip, Info, SidebarSimple } from '@phosphor-icons/react';
import { clock, duration, seconds, summarizeRange } from '../domain';
import { Badge, EmptyState, IconButton, Notice } from '../components/UI';
import VerticalTimeline from '../components/VerticalTimeline';
import PlaybackDetails from '../components/PlaybackDetails';
import usePlayback from '../hooks/usePlayback';
import { request, queryString } from '../api/client';
import { clipView } from '../api/adapters';

export default function Review({ source, clips, clip, setClipId, date, setDate, onScan, scanning, onExport, onLibrary, settings, notify, real = false, onSelect, initialOffset = 0, initialDetails = false, timeline, dates = [], onWindow, onLoadMore, exportEnabled = true }) {
  const video = useRef(null);
  const stage = useRef(null);
  const pendingSeek = useRef(initialOffset);
  const [playing, setPlaying] = useState(false);
  const [offset, setOffset] = useState(0);
  const [muted, setMuted] = useState(true);
  const [speed, setSpeed] = useState('1');
  const [rangeStart, setRangeStart] = useState(clip?.start || 0);
  const [rangeEnd, setRangeEnd] = useState(clip?.end || 0);
  const [managing, setManaging] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(initialDetails);
  const [mediaError, setMediaError] = useState(false);
  const [rangeDirty, setRangeDirty] = useState(false);
  const playback = usePlayback(clip, real);
  const mediaUrl = real ? playback.mediaUrl : clip?.media;
  const clipDuration = real ? (clip?.duration || 0) : 60;
  const seekGeneration = useRef(0);
  const summary = summarizeRange(real && timeline ? timeline.coverage.map(item => ({ start: (Date.parse(item.startAt) - Date.parse(timeline.dayStartAt)) / 1000, end: (Date.parse(item.endAt) - Date.parse(timeline.dayStartAt)) / 1000 })) : clips, rangeStart, rangeEnd);
  const current = (clip?.start || 0) + offset;


  useEffect(() => {
    setOffset(pendingSeek.current);
    if (!rangeDirty) { setRangeStart(real ? Math.max(0, clip?.start || 0) : clip?.start || 0); setRangeEnd(real ? Math.min(86400, clip?.end || 0) : clip?.end || 0); }
    setMediaError(false);
    if (!mediaUrl && !real) setPlaying(false);
  }, [clip?.id]);
  useEffect(() => {
    pendingSeek.current = initialOffset; setOffset(initialOffset); setPlaying(false); setManaging(false); setDetailsOpen(initialDetails);
    setRangeDirty(false); setRangeStart(real ? Math.max(0, clip?.start || 0) : clip?.start || 0); setRangeEnd(real ? Math.min(86400, clip?.end || 0) : clip?.end || 0);
  }, [source.id, date]);
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    player.playbackRate = Number(speed);
    if (playing) player.play().catch(() => setPlaying(false)); else player.pause();
  }, [playing, speed, clip?.id, mediaUrl]);
  useEffect(() => { if (real) { pendingSeek.current = initialOffset; setOffset(initialOffset); if (video.current?.readyState >= 1) video.current.currentTime = initialOffset; } }, [initialOffset, clip?.id, real]);

  function select(target, seekOffset = 0, showDetails = false) {
    if (!target) return;
    seekGeneration.current++;
    if (showDetails) openDetails();
    pendingSeek.current = seekOffset;
    if (target.id === clip?.id) { if (video.current) video.current.currentTime = seekOffset; setOffset(seekOffset); }
    else if (real) onSelect(target, seekOffset, showDetails); else setClipId(target.id);
  }
  async function seekAbsolute(value) {
    if (!real) { const found = clips.find(c => value >= c.start && value < c.end); if (found) select(found, value - found.start, true); else notify('这个时间点没有录像，点击蓝色区间查看已有录像。'); return; }
    if (!timeline) return;
    const generation = ++seekGeneration.current;
    try {
      const result = await request(`/sources/${source.id}/resolve?${queryString({ at: new Date(Date.parse(timeline.dayStartAt) + value * 1000).toISOString() })}`);
      if (generation !== seekGeneration.current) return;
      if (result.status === 'gap') return notify('这个时间点没有录像，点击蓝色区间查看已有录像。');
      select(clipView(result.segment, timeline.dayStartAt, settings.timezone), result.offsetMs / 1000, true);
    } catch (failure) { if (generation === seekGeneration.current) notify(failure.message); }
  }
  useEffect(() => () => { seekGeneration.current++; }, []);
  async function onEnded() {
    if (!settings.autoNext || !clip) return setPlaying(false);
    let next, nextOffset = 0;
    if (real && timeline) {
      const generation = ++seekGeneration.current;
      try {
                let result = await request(`/sources/${source.id}/resolve?${queryString({ at: clip.endAt })}`);
        if (generation !== seekGeneration.current) return;
        if (result.status === 'gap' && result.nextAt && Date.parse(result.nextAt) < Date.parse(timeline.dayEndAt)) {
          const gap = (Date.parse(result.nextAt) - Date.parse(clip.endAt)) / 1000;
          if (!settings.skipGaps) { notify(`下一片段前有 ${duration(gap)} 断档，点击蓝色区间继续。`); return setPlaying(false); }
          notify(`已跳过 ${gap < 1 ? '不足 1 秒' : duration(gap)} 断档，继续回看。`);
          result = await request(`/sources/${source.id}/resolve?${queryString({ at: result.nextAt })}`);
        }
        if (generation !== seekGeneration.current) return;
        if (!result.segment || Date.parse(result.segment.startAt) >= Date.parse(timeline.dayEndAt)) return setPlaying(false);
        next = clipView(result.segment, timeline.dayStartAt, settings.timezone); nextOffset = result.offsetMs / 1000;
      } catch (failure) { notify(failure.message); return setPlaying(false); }
    } else {
      next = clips[clips.findIndex(c => c.id === clip.id) + 1];
      if (!next) return setPlaying(false);
      const gap = next.start - clip.end;
      if (gap > 0 && !settings.skipGaps) { notify(`下一片段前有 ${gap} 秒断档，点击蓝色区间继续。`); return setPlaying(false); }
      if (gap > 0) notify(`已跳过 ${gap} 秒断档，继续播放下一片段`);
    }
    select(next, nextOffset); setPlaying(true);
  }
  function shiftDate(delta) {
    const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + delta); setDate(next.toISOString().slice(0, 10));
  }
  function openDetails() { setManaging(false); setDetailsOpen(true); }
  function toggleManaging() { setDetailsOpen(false); setManaging(value => !value); }
  function manageCurrentClip() {
    setDetailsOpen(false);
    setRangeStart(real ? Math.max(0, clip.start) : clip.start); setRangeEnd(real ? Math.min(86400, clip.end) : clip.end); setRangeDirty(true);
    setManaging(true);
  }
  function requestExport() { onExport({ sourceId: source.id, date, start: rangeStart, end: rangeEnd }); }

  return <div className="review-page">
    {!source.enabled && <Notice warning>这个录像源已停用。仍可查看已索引片段，启用后可继续扫描。</Notice>}
    <h1 className="review-screen-reader">录像回看</h1>
      <div className={`unifi-review-layout ${managing ? 'managing' : ''} ${detailsOpen && clip ? 'with-details' : ''}`}>
        <VerticalTimeline clips={clips} clip={clip} date={date} current={current} onDateChange={setDate} onShiftDate={shiftDate} onSeek={seekAbsolute} managing={managing} range={{ start: rangeStart, end: rangeEnd }} onRangeChange={range => { setRangeDirty(true); setRangeStart(range.start); setRangeEnd(range.end); }} onManage={toggleManaging} coverage={real && timeline ? timeline.coverage.map(item => ({ start: (Date.parse(item.startAt) - Date.parse(timeline.dayStartAt)) / 1000, end: (Date.parse(item.endAt) - Date.parse(timeline.dayStartAt)) / 1000 })) : undefined} onWindow={onWindow} dates={dates} />
        <div className="unifi-viewing-column">
          <header className="unifi-camera-heading"><div className="source-select"><span className={`source-dot ${source.enabled ? 'blue' : 'neutral'}`} /><FilmStrip size={17} /><strong className="camera-source-name" title={source.name}>{source.name}</strong><span className="camera-resolution">{real ? clip?.resolution || '—' : '1920 × 1080'}</span></div><div><IconButton icon={SidebarSimple} label={detailsOpen ? '收起片段详情' : '打开片段详情'} aria-expanded={detailsOpen} disabled={!clip} onClick={() => detailsOpen ? setDetailsOpen(false) : openDetails()} /><button className="button quiet small" disabled={scanning || !source.enabled} onClick={onScan}>{scanning ? <CircleNotch className="spin" size={16} /> : <ArrowClockwise size={16} />}{scanning ? '扫描中' : '扫描新录像'}</button></div></header>
        {!clip ? <div className="panel"><EmptyState title={real && !timeline ? '正在加载录像…' : '这一天还没有录像'} description={real ? (timeline ? `选择有录像的日期${dates[0] ? `，最近为 ${dates[0]}` : '，或扫描当前目录'}。` : '正在加载真实时间索引…') : '可以切换到 2026 年 10 月 12 日或 13 日查看示例，或尝试扫描当前目录。'} action={onScan} actionLabel="扫描目录" /></div> : <section className="player-panel" aria-label="录像播放器">
          <div className="video-stage" ref={stage} onClick={openDetails}>
            {mediaUrl && !mediaError ? <video key={`${clip.id}:${mediaUrl}`} ref={video} src={mediaUrl} poster={clip.image} muted={muted} playsInline preload="metadata" onLoadedMetadata={() => { if (!video.current) return; video.current.currentTime = pendingSeek.current; pendingSeek.current = 0; if (playing) video.current.play().catch(() => setPlaying(false)); }} onTimeUpdate={() => setOffset(video.current?.currentTime || 0)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={onEnded} onError={() => { setMediaError(true); setPlaying(false); }} onClick={() => setPlaying(!playing)} aria-label={`${source.name}${real ? '录像' : '示例录像'}`} /> : <img src={clip.image} alt={`${source.name}录像预览`} />}
            <div className="video-top"><Badge tone="video" dot>{source.name}</Badge><span>{date.replaceAll('-', '/')}<strong>{clock(current)}</strong></span></div>
            {!playing && mediaUrl && !mediaError && <button className="stage-play" onClick={() => setPlaying(true)} aria-label="播放录像"><Play size={30} weight="fill" /></button>}
            {(!mediaUrl || mediaError) && <div className="static-preview"><Info size={22} /><strong>{real ? mediaError ? '浏览器无法播放当前文件' : playback.status === 'preparing' ? '正在准备播放版本' : playback.status === 'loading' ? '读取播放状态…' : '播放暂不可用' : mediaError ? '示例视频加载失败' : '静态画面预览'}</strong><span>{real ? playback.status === 'preparing' ? `${playback.progress || 0}% · 后台处理，可以继续查看详情或切换录像。` : playback.message || '可重新生成兼容播放版本，原录像保持只读。' : '切换「工作室」体验示例视频。'}</span>{real && !['preparing', 'loading'].includes(playback.status) && <button className="button primary small" onClick={event => { event.stopPropagation(); setMediaError(false); playback.retry(); }}>重新准备播放</button>}</div>}
            <span className="video-demo">{real ? mediaUrl ? playback.proxy ? '兼容播放版本' : '原始录像 · 只读' : '后台播放准备' : '示例录像'}</span>
          </div>
          <div className="player-controls"><IconButton icon={playing ? Pause : Play} label={playing ? '暂停录像' : '播放录像'} disabled={!mediaUrl || mediaError} onClick={() => setPlaying(!playing)} /><span className="player-clock">{duration(offset)}<span> / {duration(clipDuration)}</span></span><input type="range" min="0" max={clipDuration} step="0.1" value={Math.min(offset, clipDuration)} aria-label="片段播放进度" disabled={!mediaUrl || mediaError} onChange={e => { const value = Number(e.target.value); if (video.current) video.current.currentTime = value; setOffset(value); }} /><select className="speed-select" aria-label="播放速度" value={speed} onChange={e => setSpeed(e.target.value)}><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select><IconButton icon={muted ? SpeakerSlash : SpeakerHigh} label={muted ? '取消静音' : '静音'} onClick={() => setMuted(!muted)} /><IconButton icon={ArrowsOut} label="全屏播放" onClick={() => stage.current?.requestFullscreen?.().catch(() => notify('当前浏览器暂时无法进入全屏。'))} /></div>
          <div className="player-caption"><FilmStrip size={16} /><span title={clip.filename}>{clip.filename}</span><Badge>{clip.codec}</Badge><span>{real ? clip.resolution : '1080p'}</span></div>
        </section>}
      {clip && <section className="clip-section"><div className="section-heading"><h2>当前时段片段 <span className="count-label">{clips.length}</span></h2><button className="text-button" onClick={onLibrary}>在片段库中查看<ArrowUpRightIcon /></button></div><div className="clip-strip">{clips.map(c => <button className={`strip-card ${c.id === clip.id ? 'selected' : ''}`} key={c.id} onClick={() => select(c, 0, true)} aria-pressed={c.id === clip.id}><div className="clip-image"><img src={c.image} alt={`${source.name} ${clock(c.start)} 录像画面`} loading="lazy" /><span>{duration(c.duration || c.end - c.start)}</span>{c.id === clip.id && <span className="now-playing"><Play weight="fill" size={12} />当前片段</span>}</div><strong>{clock(c.start)}</strong><span>{clock(c.start)} – {clock(c.end)}</span></button>)}</div>{real && timeline?.nextCursor && <button className="text-button" onClick={onLoadMore}>加载更多本时段片段</button>}</section>}
        </div>
        {detailsOpen && clip && <PlaybackDetails exportDate={date} clip={clip} source={source} onClose={() => setDetailsOpen(false)} onManage={manageCurrentClip} onExport={onExport} exportEnabled={exportEnabled} />}
        {managing && clip && <>
        <aside className="range-panel panel"><div className="section-heading"><h2>管理片段</h2><button className="text-button" onClick={() => setManaging(false)}>关闭</button></div><p className="section-description">拖动时间轴上的边界，或输入起止时间。</p>
          <label className="field range-field">开始时间<div className="time-input"><Clock size={17} /><input type="time" step="1" value={clock(rangeStart)} aria-label="导出开始时间" onInput={e => { if (e.currentTarget.value) { setRangeDirty(true); setRangeStart(seconds(e.currentTarget.value)); } }} onChange={e => { if (e.target.value) { setRangeDirty(true); setRangeStart(seconds(e.target.value)); } }} /><button className="text-button" onClick={() => { setRangeDirty(true); setRangeStart(Math.floor(current)); }}>设为当前</button></div></label>
          <label className="field range-field">结束时间<div className="time-input"><Clock size={17} /><input type="time" step="1" value={rangeEnd === 86400 ? "" : clock(rangeEnd)} aria-label="导出结束时间" onInput={e => { if (e.currentTarget.value) { setRangeDirty(true); setRangeEnd(seconds(e.currentTarget.value)); } }} onChange={e => { if (e.target.value) { setRangeDirty(true); setRangeEnd(seconds(e.target.value)); } }} /><button className="text-button" onClick={() => { setRangeDirty(true); setRangeEnd(Math.floor(current)); }}>设为当前</button></div></label>
          {real && <p className="range-hint">{rangeEnd === 86400 ? "结束：24:00:00（当天结束） · " : ""}<button className="text-button" onClick={() => { setRangeDirty(true); setRangeEnd((Date.parse(timeline.dayEndAt) - Date.parse(timeline.dayStartAt)) / 1000); }}>设为当天结束</button></p>}<div className="range-facts"><div><span>实际录像</span><strong>{duration(summary.coverage)}</strong></div><div><span>包含片段</span><strong>{real ? "提交前核对" : summary.clips.length}<small>{real ? "" : " 个"}</small></strong></div></div>
          {!summary.valid && <p className="form-error" role="status">{summary.message}</p>}{summary.gap > 0 && <div className="gap-note"><Info size={15} />{duration(summary.gap)} 无录像，导出时自动跳过</div>}
          <button className="button primary full" onClick={requestExport} disabled={!summary.valid || !exportEnabled}><DownloadSimple size={18} />导出选定区间<ArrowRight size={16} /></button><p className="range-hint">{exportEnabled ? '后台处理，可以继续回看。' : '导出将在 D4 接入；区间选择已预留。'}</p>
        </aside>

        </>}
      </div>
  </div>;
}

function ArrowUpRightIcon() { return <ArrowRight size={15} />; }
