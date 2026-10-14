import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Clock, DownloadSimple, ArrowsOut, Play, Pause, SpeakerHigh, SpeakerSlash, ArrowClockwise, CircleNotch, FilmStrip, Info, SidebarSimple, CalendarBlank } from '@phosphor-icons/react';
import { clock, duration, seconds, summarizeRange } from '../domain';
import { Badge, IconButton, Notice } from '../components/UI';
import VerticalTimeline from '../components/VerticalTimeline';
import PlaybackDetails from '../components/PlaybackDetails';
import usePlayback from '../hooks/usePlayback';
import useRangePlan from '../hooks/useRangePlan';
import { request, queryString } from '../api/client';
import { clipView } from '../api/adapters';
import { recordedAt, recordingCoverage, reviewDayBounds, recordingTime, selectedExportClip } from '../recordingSelection';

export default function Review({ source, clips, clip, setClipId, date, setDate, onScan, scanning, onExport, onLibrary, settings, notify, real = false, onSelect, initialOffset = 0, initialDetails = false, timeline, dates = [], onLoadMore, loadingMore = false, exportEnabled = true, reviewRange = null, onReviewRangeChange, allClips = clips }) {
  const video = useRef(null);
  const stage = useRef(null);
  const gallery = useRef(null);
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
  const bounds = reviewDayBounds(reviewRange, date, real && timeline ? (Date.parse(timeline.dayEndAt) - Date.parse(timeline.dayStartAt)) / 1000 : 86400);
  const coverage = recordingCoverage(real && timeline ? timeline.coverage.map(item => ({ start: (Date.parse(item.startAt) - Date.parse(timeline.dayStartAt)) / 1000, end: (Date.parse(item.endAt) - Date.parse(timeline.dayStartAt)) / 1000 })) : clips, bounds.start, bounds.end);
  const summary = summarizeRange(real ? coverage : clips, rangeStart, rangeEnd);
  const rangeBoundariesValid = recordedAt(coverage, rangeStart) && recordedAt(coverage, rangeEnd, true);
  const exportClipId = real ? selectedExportClip(clip, rangeStart, rangeEnd) : undefined;
  const rangePlan = useRangePlan({ enabled: real && managing && summary.valid && rangeBoundariesValid, sourceId: source.id, date, start: rangeStart, end: rangeEnd, timezone: settings.timezone, mode: settings.defaultMode, timeline, clipId: exportClipId });
  const canExportRange = summary.valid && rangeBoundariesValid && exportEnabled && (!real || !!rangePlan.plan);
  const current = (clip?.start || 0) + offset;
  const minimumOffset = clip ? Math.max(0, bounds.start - clip.start) : 0;
  const maximumOffset = clip ? Math.max(minimumOffset, Math.min(clipDuration, bounds.end - clip.start)) : clipDuration;


  useEffect(() => {
    setOffset(pendingSeek.current);
    if (!rangeDirty) { setRangeStart(real ? Math.max(bounds.start, clip?.start || 0) : clip?.start || 0); setRangeEnd(real ? Math.min(bounds.end, clip?.end || 0) : clip?.end || 0); }
    setMediaError(false);
    if (!mediaUrl && !real) setPlaying(false);
  }, [clip?.id]);
  useEffect(() => {
    pendingSeek.current = initialOffset; setOffset(initialOffset); setPlaying(false); setManaging(false); setDetailsOpen(initialDetails);
    setRangeDirty(false); setRangeStart(real ? Math.max(bounds.start, clip?.start || 0) : clip?.start || 0); setRangeEnd(real ? Math.min(bounds.end, clip?.end || 0) : clip?.end || 0);
  }, [source.id, date]);
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    player.playbackRate = Number(speed);
    if (playing) player.play().catch(() => setPlaying(false)); else player.pause();
  }, [playing, speed, clip?.id, mediaUrl]);
  useEffect(() => { if (real) { pendingSeek.current = initialOffset; setOffset(initialOffset); if (video.current?.readyState >= 1) video.current.currentTime = initialOffset; } }, [initialOffset, clip?.id, real]);

  useEffect(() => {
    const container = gallery.current;
    const card = container?.querySelector('.strip-card.selected');
    if (!card) return;
    if (card.offsetTop < container.scrollTop || card.offsetTop + card.offsetHeight > container.scrollTop + container.clientHeight) container.scrollTop = card.offsetTop;
  }, [clip?.id]);

  function select(target, seekOffset = 0, showDetails = false) {
    if (!target) return;
    seekOffset = Math.max(0, bounds.start - target.start, Math.min(seekOffset, bounds.end - target.start - .001));
    seekGeneration.current++;
    if (showDetails) openDetails();
    pendingSeek.current = seekOffset;
    if (target.id === clip?.id) { if (video.current) video.current.currentTime = seekOffset; setOffset(seekOffset); }
    else if (real) onSelect(target, seekOffset, showDetails); else setClipId(target.id);
  }
  async function seekAbsolute(value) {
    if (!recordedAt(coverage, value)) return;
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
    if (clip?.end >= bounds.end) return setPlaying(false);
    if (!settings.autoNext || !clip) return setPlaying(false);
    let next, nextOffset = 0;
    if (real && timeline) {
      const generation = ++seekGeneration.current;
      try {
        let result = await request(`/sources/${source.id}/resolve?${queryString({ at: clip.endAt })}`);
        if (generation !== seekGeneration.current) return;
        if (result.status === 'gap' && result.nextAt && Date.parse(result.nextAt) < Date.parse(timeline.dayStartAt) + bounds.end * 1000) {
          const gap = (Date.parse(result.nextAt) - Date.parse(clip.endAt)) / 1000;
          if (!settings.skipGaps) { notify(`下一片段前有 ${duration(gap)} 断档，点击蓝色区间继续。`); return setPlaying(false); }
          notify(`已跳过 ${gap < 1 ? '不足 1 秒' : duration(gap)} 断档，继续回看。`);
          result = await request(`/sources/${source.id}/resolve?${queryString({ at: result.nextAt })}`);
        }
        if (generation !== seekGeneration.current) return;
        if (!result.segment || Date.parse(result.segment.startAt) >= Date.parse(timeline.dayStartAt) + bounds.end * 1000) return setPlaying(false);
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
  function togglePlaying() {
    if (!playing && offset >= maximumOffset - .05) {
      if (video.current) video.current.currentTime = minimumOffset;
      setOffset(minimumOffset);
    }
    setPlaying(value => !value);
  }
  function openDetails() { setManaging(false); setDetailsOpen(true); }
  function toggleManaging() { setDetailsOpen(false); setManaging(value => !value); }
  function manageCurrentClip() {
    setDetailsOpen(false);
    setRangeStart(real ? Math.max(bounds.start, clip.start) : clip.start); setRangeEnd(real ? Math.min(bounds.end, clip.end) : clip.end); setRangeDirty(true);
    setManaging(true);
  }
  function requestExport() { if (!canExportRange) return; onExport({ sourceId: source.id, date, start: rangeStart, end: rangeEnd, ...(exportClipId ? { clipIds: [exportClipId] } : {}) }); }

  return <div className="review-page">
    {!source.enabled && <Notice warning>这个录像源已停用。仍可查看已索引片段，启用后可继续扫描。</Notice>}
    <h1 className="review-screen-reader">录像回看</h1>
      <div className={`unifi-review-layout ${managing ? 'managing' : ''} ${detailsOpen && clip ? 'with-details' : ''}`}>
        <VerticalTimeline clips={clips} clip={clip} date={date} current={current} onDateChange={setDate} onSeek={seekAbsolute} managing={managing} range={{ start: rangeStart, end: rangeEnd }} onRangeChange={range => { setRangeDirty(true); setRangeStart(range.start); setRangeEnd(range.end); }} onManage={toggleManaging} coverage={coverage} dayRecordings={!real ? Object.fromEntries(dates.map(day => [day, allClips.filter(row => row.date === day)])) : undefined} dates={dates} source={source} timezone={settings.timezone} reviewRange={reviewRange} onReviewRangeChange={onReviewRangeChange} real={real} bounds={bounds} />
        <div className="unifi-viewing-column">
          {reviewRange && <div className="review-range-banner"><CalendarBlank size={16} /><span>回看区间 <strong>{reviewRange.startDate} {recordingTime(reviewRange.start)} — {reviewRange.endDate} {recordingTime(reviewRange.end)}</strong></span><button className="text-button" onClick={() => onReviewRangeChange(null)}>查看全部录像</button></div>}
          <header className="unifi-camera-heading"><div className="source-select"><span className={`source-dot ${source.enabled ? 'blue' : 'neutral'}`} /><FilmStrip size={17} /><strong className="camera-source-name" title={source.name}>{source.name}</strong><span className="camera-resolution">{real ? clip?.resolution || '—' : '1920 × 1080'}</span></div><div><IconButton icon={SidebarSimple} label={detailsOpen ? '收起片段详情' : '打开片段详情'} aria-expanded={detailsOpen} disabled={!clip} onClick={() => detailsOpen ? setDetailsOpen(false) : openDetails()} />{clip && <button className="button quiet small" disabled={scanning || !source.enabled} onClick={onScan}>{scanning ? <CircleNotch className="spin" size={16} /> : <ArrowClockwise size={16} />}{scanning ? '扫描中' : '扫描新录像'}</button>}</div></header>
        {!clip ? <ReviewEmpty loading={real && !timeline} date={date} dates={dates} source={source} scanning={scanning} onScan={onScan} onSelectDate={day => { if (reviewRange) onReviewRangeChange(null); setDate(day); }} /> : <section className="player-panel" aria-label="录像播放器">
          <div className="video-stage" ref={stage} onClick={openDetails}>
            {mediaUrl && !mediaError ? <video key={`${clip.id}:${mediaUrl}`} ref={video} src={mediaUrl} poster={clip.image} muted={muted} playsInline preload="metadata" onLoadedMetadata={() => { if (!video.current) return; video.current.currentTime = pendingSeek.current; pendingSeek.current = 0; if (playing) video.current.play().catch(() => setPlaying(false)); }} onTimeUpdate={() => { const player = video.current; if (!player) return; if (player.currentTime > maximumOffset && maximumOffset < clipDuration) { player.pause(); player.currentTime = maximumOffset; setPlaying(false); } setOffset(player.currentTime); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={onEnded} onError={() => { setMediaError(true); setPlaying(false); }} onClick={togglePlaying} aria-label={`${source.name}${real ? '录像' : '示例录像'}`} /> : <img src={clip.image} alt={`${source.name}录像预览`} />}
            <div className="video-top"><Badge tone="video" dot>{source.name}</Badge><span>{date.replaceAll('-', '/')}<strong>{clock(current)}</strong></span></div>
            {!playing && mediaUrl && !mediaError && <button className="stage-play" onClick={event => { event.stopPropagation(); togglePlaying(); }} aria-label="播放录像"><Play size={30} weight="fill" /></button>}
            {(!mediaUrl || mediaError) && <div className="static-preview"><Info size={22} /><strong>{real ? mediaError ? '浏览器无法播放当前文件' : playback.status === 'preparing' ? '正在准备播放版本' : playback.status === 'loading' ? '读取播放状态…' : '播放暂不可用' : mediaError ? '示例视频加载失败' : '静态画面预览'}</strong><span>{real ? playback.status === 'preparing' ? `${playback.progress || 0}% · 后台处理，可以继续查看详情或切换录像。` : playback.message || '可重新生成兼容播放版本，原录像保持只读。' : '切换「工作室」体验示例视频。'}</span>{real && !['preparing', 'loading'].includes(playback.status) && <button className="button primary small" onClick={event => { event.stopPropagation(); setMediaError(false); playback.retry(); }}>重新准备播放</button>}</div>}
            <span className="video-demo">{real ? mediaUrl ? playback.proxy ? '兼容播放版本' : '原始录像 · 只读' : '后台播放准备' : '示例录像'}</span>
          </div>
          <div className="player-controls"><IconButton icon={playing ? Pause : Play} label={playing ? '暂停录像' : '播放录像'} disabled={!mediaUrl || mediaError} onClick={togglePlaying} /><span className="player-clock">{duration(Math.max(0, offset - minimumOffset))}<span> / {duration(maximumOffset - minimumOffset)}</span></span><input type="range" min={minimumOffset} max={maximumOffset} step="0.1" value={Math.max(minimumOffset, Math.min(offset, maximumOffset))} aria-label="片段播放进度" disabled={!mediaUrl || mediaError} onChange={e => { const value = Number(e.target.value); if (video.current) video.current.currentTime = value; setOffset(value); }} /><select className="speed-select" aria-label="播放速度" value={speed} onChange={e => setSpeed(e.target.value)}><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select><IconButton icon={muted ? SpeakerSlash : SpeakerHigh} label={muted ? '取消静音' : '静音'} onClick={() => setMuted(!muted)} /><IconButton icon={ArrowsOut} label="全屏播放" onClick={() => stage.current?.requestFullscreen?.().catch(() => notify('当前浏览器暂时无法进入全屏。'))} /></div>
          <div className="player-caption"><FilmStrip size={16} /><span title={clip.filename}>{clip.filename}</span><Badge>{clip.codec}</Badge><span>{real ? clip.resolution : '1080p'}</span></div>
        </section>}

        </div>
      {clip && <section className="clip-section" aria-label={reviewRange ? '区间内录像' : '当天全部录像'}><div className="section-heading"><h2>{reviewRange ? '区间内录像' : '当天全部录像'} <span className="count-label">{timeline?.nextCursor ? `已加载 ${clips.length}` : clips.length}</span></h2><button className="text-button" onClick={onLibrary}>在片段库中查看<ArrowUpRightIcon /></button></div><p className="review-gallery-hint">上下滚动浏览录像，点击片段回看。</p><div ref={gallery} className="clip-strip" aria-label={reviewRange ? '区间内录像列表' : '当天录像列表'}>{clips.map(c => <button className={`strip-card ${c.id === clip.id ? 'selected' : ''}`} key={c.id} onClick={() => select(c, Math.max(0, bounds.start - c.start), true)} aria-pressed={c.id === clip.id}><div className="clip-image"><img src={c.image} alt={`${source.name} ${clock(c.start)} 录像画面`} loading="lazy" /><span>{duration(Math.min(bounds.end, c.end) - Math.max(bounds.start, c.start))}</span>{c.id === clip.id && <span className="now-playing"><Play weight="fill" size={12} />当前片段</span>}</div><strong>{clock(c.start)}</strong><span>{recordingTime(Math.max(bounds.start, c.start))} – {recordingTime(Math.min(bounds.end, c.end))}</span></button>)}</div>{real && timeline?.nextCursor && <button className="button secondary small review-load-more" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? '正在加载…' : '加载更多录像'}</button>}</section>}
        {detailsOpen && clip && <PlaybackDetails exportDate={date} clip={clip} source={source} onClose={() => setDetailsOpen(false)} onManage={manageCurrentClip} onExport={onExport} exportEnabled={exportEnabled} />}
        {managing && clip && <>
        <aside className="range-panel panel"><div className="section-heading"><h2>管理片段</h2><button className="text-button" onClick={() => setManaging(false)}>关闭</button></div><p className="section-description">拖动边界或输入起止时间，只能选择有录像的位置。</p>
          <label className="field range-field">开始时间<div className="time-input"><Clock size={17} /><input type="time" step="1" min={recordingTime(Math.ceil(coverage[0]?.start || 0))} max={clock(coverage.at(-1)?.end || 0)} value={recordingTime(rangeStart)} aria-invalid={!recordedAt(coverage, rangeStart)} aria-label="导出开始时间" onInput={e => { if (e.currentTarget.value) { setRangeDirty(true); setRangeStart(seconds(e.currentTarget.value)); } }} onChange={e => { if (e.target.value) { setRangeDirty(true); setRangeStart(seconds(e.target.value)); } }} /><button className="text-button" onClick={() => { setRangeDirty(true); setRangeStart(Math.floor(current)); }}>设为当前</button></div></label>
          <label className="field range-field">结束时间<div className="time-input"><Clock size={17} /><input type="time" step="1" min={recordingTime(Math.ceil(coverage[0]?.start || 0))} max={clock(coverage.at(-1)?.end || 0)} aria-invalid={!recordedAt(coverage, rangeEnd, true)} value={rangeEnd === 86400 ? "" : recordingTime(rangeEnd)} aria-label="导出结束时间" onInput={e => { if (e.currentTarget.value) { setRangeDirty(true); setRangeEnd(seconds(e.currentTarget.value)); } }} onChange={e => { if (e.target.value) { setRangeDirty(true); setRangeEnd(seconds(e.target.value)); } }} /><button className="text-button" onClick={() => { setRangeDirty(true); setRangeEnd(Math.floor(current)); }}>设为当前</button></div></label>
          {real && <p className="range-hint">{rangeEnd === 86400 ? "结束：24:00:00（当天结束） · " : ""}<button className="text-button" onClick={() => { setRangeDirty(true); setRangeEnd(coverage.at(-1)?.end || rangeEnd); }}>设为录像末尾</button></p>}<div className="range-facts" aria-live="polite" aria-busy={rangePlan.loading}><div><span>实际录像</span><strong>{duration(rangePlan.plan ? rangePlan.plan.selectedCoverageMs / 1000 : summary.coverage)}</strong></div><div><span>包含片段</span><strong>{real ? rangePlan.plan?.pieceCount ?? '—' : summary.clips.length}<small> 个</small></strong></div></div>
          {rangePlan.loading && <p className="range-plan-status" role="status"><CircleNotch size={13} className="spin" />正在核对录像…</p>}
          {rangePlan.error && <p className="form-error range-plan-error" role="status">{rangePlan.error}<button className="text-button" onClick={rangePlan.retry}>重新核对</button></p>}
          {!rangeBoundariesValid && <p className="form-error" role="status">起止时间必须落在蓝色录像区间内。</p>}{!summary.valid && <p className="form-error" role="status">{summary.message}</p>}{summary.gap > 0 && <div className="gap-note"><Info size={15} />{duration(summary.gap)} 无录像，导出时自动跳过</div>}
          <button className="button primary full" onClick={requestExport} disabled={!canExportRange}><DownloadSimple size={18} />导出选定区间<ArrowRight size={16} /></button><p className="range-hint">{exportEnabled ? '后台处理，可以继续回看。' : '导出将在 D4 接入；区间选择已预留。'}</p>
        </aside>

        </>}
      </div>
  </div>;
}

function ArrowUpRightIcon() { return <ArrowRight size={15} />; }

function ReviewEmpty({ loading, date, dates, source, scanning, onScan, onSelectDate }) {
  const latest = dates[0];
  return <section className={`review-empty panel ${loading ? 'loading' : ''}`} aria-label={loading ? '正在加载录像' : '录像空状态'}>
    <div className="review-empty-heading"><span><FilmStrip size={16} />{loading ? '读取录像索引' : '等待可用录像'}</span><span>{date.replaceAll('-', '/')}</span></div>
    <div className="review-empty-content"><div className="review-empty-symbol">{loading ? <CircleNotch size={32} className="spin" /> : <FilmStrip size={32} weight="light" />}</div><h2>{loading ? '正在准备你的录像' : latest ? '这一天没有可回看的录像' : '录像就绪后，在这里回看'}</h2><p>{loading ? '正在读取日期和时间轴，请稍候。' : latest ? '选择带蓝点的日期，直接回到有录像的时刻。' : `扫描「${source.name}」的录像目录，建立时间轴后即可回看与截取。`}</p>{!loading && <div className="review-empty-actions">{latest && <button className="button primary" onClick={() => onSelectDate(latest)}><Play size={16} weight="fill" />回看最近录像<ArrowRight size={16} /></button>}<button className={`button ${latest ? 'secondary' : 'primary'}`} disabled={scanning || !source.enabled} onClick={onScan}>{scanning ? <CircleNotch className="spin" size={16} /> : <ArrowClockwise size={16} />}{scanning ? '正在扫描目录' : '扫描录像目录'}</button></div>}</div>
    <footer>{!loading && latest ? <><span>可用录像日期</span><div>{dates.slice(0, 4).map(day => <button key={day} onClick={() => onSelectDate(day)}><CalendarBlank size={15} />{day.replaceAll('-', '/')}<CaretIcon /></button>)}</div></> : <span>{loading ? '日期与时间以真实索引为准' : '支持本地录像文件 · 原始录像只读'}</span>}</footer>
  </section>;
}
function CaretIcon() { return <ArrowRight size={14} />; }
