import { useEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight, Minus, Plus, Scissors, CalendarBlank, CrosshairSimple, ArrowsOutSimple } from '@phosphor-icons/react';
import { ExtensionSlot, IconButton } from './UI';
import RecordingRangePicker from './RecordingRangePicker';
import { recordingTime, adjacentRecordingDate, recordedAt, recordingCoverage, nearestRecording } from '../recordingSelection';
import { clamp, timelineWindow, timelineTime, panTime, spanToZoom, zoomToSpan, fitTimelineRange, timelineTicks, spanLabel } from '../timelineNavigation';

// The time under the fixed cursor is the anchor. Later times run upward.
export default function VerticalTimeline({ clips, clip, date, current, onDateChange, onSeek, onScrubStart, managing, range, onRangeChange, onManage, coverage, dayRecordings, dates = [], source, timezone, reviewRange, onReviewRangeChange, real = false, bounds = { start: 0, end: 86400 } }) {
  const available = recordingCoverage(coverage || clips, bounds.start, bounds.end);
  const navigationDates = dates.filter(day => !reviewRange || day >= reviewRange.startDate && day <= reviewRange.endDate);
  const previousDate = adjacentRecordingDate(navigationDates, date, -1), nextDate = adjacentRecordingDate(navigationDates, date, 1);
  const ruler = useRef(null), drag = useRef(null), wheelTimer = useRef(null), frame = useRef(null), generation = useRef(0);
  const [view, setView] = useState({ anchor: clamp(current, bounds.start, bounds.end), span: 900 });
  const [scrubbing, setScrubbing] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const latest = useRef(null);
  latest.current = { view, available, range, bounds, current, onSeek, onRangeChange, onScrubStart };
  const { start, end } = timelineWindow(view.anchor, view.span);
  const position = value => (end - value) / view.span * 100;
  const clippedPosition = value => clamp(position(value), 0, 100);
  const visible = clips.filter(item => item.start < end && item.end > start);
  const outsideRange = managing && range && (range.start < start || range.end > end);
  const ticks = timelineTicks(start, end, view.span, bounds);

  function updateView(next) { latest.current.view = next; setView(next); }
  function stopWheel() { clearTimeout(wheelTimer.current); wheelTimer.current = null; }
  function fitSelection() { if (range) { stopWheel(); generation.current++; setScrubbing(false); setBrowsing(true); updateView(fitTimelineRange(range)); } }
  function returnToPlayback() { stopWheel(); generation.current++; setScrubbing(false); setBrowsing(false); updateView({ ...latest.current.view, anchor: latest.current.current }); }
  useEffect(() => {
    if (!drag.current && !wheelTimer.current && !managing && !browsing && !scrubbing) updateView({ ...latest.current.view, anchor: clamp(current, bounds.start, bounds.end) });
  }, [current, managing, browsing, scrubbing]);
  useEffect(() => { if (managing && range) fitSelection(); else setBrowsing(false); }, [managing]);
  useEffect(() => () => { generation.current++; clearTimeout(wheelTimer.current); cancelAnimationFrame(frame.current); }, []);

  async function commit(time) {
    const state = latest.current;
    const selected = nearestRecording(state.available, time);
    if (selected === null) { setScrubbing(false); return; }
    const token = ++generation.current;
    updateView({ ...state.view, anchor: selected });
    const success = await state.onSeek(selected);
    if (token !== generation.current) return;
    setScrubbing(false); setBrowsing(false);
    if (success === false) updateView({ ...latest.current.view, anchor: latest.current.current });
  }
  useEffect(() => {
    const element = ruler.current;
    if (!element) return;
    function wheel(event) {
      event.preventDefault();
      if (drag.current) return;
      const state = latest.current;
      if (!state.available.length) return;
      if (event.ctrlKey || event.metaKey) {
        updateView({ ...state.view, span: zoomToSpan(spanToZoom(state.view.span) - event.deltaY * .08) });
        return;
      }
      if (!wheelTimer.current) { generation.current++; state.onScrubStart?.(); }
      setScrubbing(true); setBrowsing(true);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      updateView({ ...state.view, anchor: panTime(state.view.anchor, -delta, element.clientHeight, state.view.span, state.bounds) });
      stopWheel();
      wheelTimer.current = setTimeout(() => { wheelTimer.current = null; commit(latest.current.view.anchor); }, 220);
    }
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [!!available.length]);

  function timeAt(clientY) {
    const rect = ruler.current.getBoundingClientRect(), state = latest.current;
    return clamp(timelineTime(state.view.anchor, state.view.span, (clientY - rect.top) / rect.height), state.bounds.start, state.bounds.end);
  }
  function moveHandle(key, value) {
    const state = latest.current;
    const rows = recordingCoverage(state.available, key === 'end' ? state.range.start + .001 : state.bounds.start, key === 'start' ? state.range.end - .001 : state.bounds.end);
    const selected = nearestRecording(rows, value, key === 'end');
    if (selected !== null) {
      const next = { ...state.range, [key]: Math.round(selected * 1000) / 1000 };
      latest.current.range = next;
      state.onRangeChange(next);
    }
  }
  function autoPan(now) {
    const gesture = drag.current;
    if (gesture?.key) {
      const rect = ruler.current.getBoundingClientRect(), state = latest.current;
      const edge = Math.min(40, rect.height * .15);
      const velocity = gesture.y < rect.top + edge ? clamp((rect.top + edge - gesture.y) / edge, 0, 1) : gesture.y > rect.bottom - edge ? -clamp((gesture.y - rect.bottom + edge) / edge, 0, 1) : 0;
      const elapsed = Math.min(50, now - (gesture.lastFrame || now));
      gesture.lastFrame = now;
      const minimum = gesture.key === 'end' ? state.range.start + .001 : state.available[0].start;
      const maximum = gesture.key === 'start' ? state.range.end - .001 : state.available.at(-1).end;
      const atLimit = velocity > 0 ? state.range[gesture.key] >= maximum - .002 : state.range[gesture.key] <= minimum + .002;
      if (velocity && gesture.moved && !atLimit) {
        updateView({ ...state.view, anchor: clamp(state.view.anchor + velocity * state.view.span * elapsed / 1800, state.bounds.start, state.bounds.end) });
        moveHandle(gesture.key, timeAt(gesture.y) + gesture.offset);
      }
      frame.current = requestAnimationFrame(autoPan);
    }
  }
  function pointerDown(event, key = null) {
    if (event.button !== 0 || !available.length) return;
    event.preventDefault(); event.stopPropagation(); stopWheel(); generation.current++;
    latest.current.onScrubStart?.();
    drag.current = { key, y: event.clientY, originY: event.clientY, anchor: latest.current.view.anchor, offset: key ? latest.current.range[key] - timeAt(event.clientY) : 0, moved: false };
    ruler.current.focus({ preventScroll: true });
    ruler.current.setPointerCapture(event.pointerId);
    if (key) frame.current = requestAnimationFrame(autoPan);
    else { setScrubbing(true); setBrowsing(true); }
  }
  function pointerMove(event) {
    const gesture = drag.current;
    if (!gesture) return;
    gesture.y = event.clientY;
    if (gesture.key) { if (Math.abs(event.clientY - gesture.originY) > 2) gesture.moved = true; if (gesture.moved) moveHandle(gesture.key, timeAt(event.clientY) + gesture.offset); return; }
    if (Math.abs(event.clientY - gesture.originY) > 4) gesture.moved = true;
    if (gesture.moved) {
      const state = latest.current;
      updateView({ ...state.view, anchor: panTime(gesture.anchor, event.clientY - gesture.originY, ruler.current.clientHeight, state.view.span, state.bounds) });
    }
  }
  function pointerEnd(event, cancelled = false) {
    const gesture = drag.current;
    if (!gesture) return;
    drag.current = null; cancelAnimationFrame(frame.current);
    if (ruler.current.hasPointerCapture(event.pointerId)) ruler.current.releasePointerCapture(event.pointerId);
    if (!gesture.key) {
      if (cancelled) { setScrubbing(false); returnToPlayback(); }
      else commit(gesture.moved ? latest.current.view.anchor : timeAt(event.clientY));
    }
  }
  function zoom(value) { updateView({ ...latest.current.view, span: zoomToSpan(value) }); }
  return <section className="vertical-timeline continuous-timeline panel" aria-label="录像时间轴">
    <div className="rail-date"><IconButton icon={CaretLeft} label="上一个录像日期" disabled={!previousDate} onClick={() => onDateChange(previousDate)} /><RecordingRangePicker date={date} dates={dates} source={source} timezone={timezone} range={reviewRange} onApply={onReviewRangeChange || (value => onDateChange(value.startDate))} onClear={() => onReviewRangeChange?.(null)} coverage={coverage || clips} dayRecordings={dayRecordings} real={real} /><IconButton icon={CaretRight} label="下一个录像日期" disabled={!nextDate} onClick={() => onDateChange(nextDate)} /></div>
    {reviewRange && <div className="rail-filter-summary"><span>已限定录像区间</span><button className="text-button" onClick={() => onReviewRangeChange(null)}>清除</button></div>}
    <div className="rail-heading"><h2>录像时间轴</h2><output aria-label="时间轴显示跨度">{spanLabel(view.span)}</output></div>
    <div className="rail-zoom" title="滑杆缩放，滚轮或上下拖动浏览时间"><IconButton icon={Minus} label="缩小时间轴" disabled={!available.length || view.span >= 86400} onClick={() => zoom(spanToZoom(view.span) - 10)} /><input className="timeline-zoom-slider" type="range" min="0" max="100" step=".1" aria-label="时间轴缩放" aria-valuetext={spanLabel(view.span)} value={spanToZoom(view.span)} disabled={!available.length} onChange={event => zoom(Number(event.target.value))} /><IconButton icon={Plus} label="放大时间轴" disabled={!available.length || view.span <= 120} onClick={() => zoom(spanToZoom(view.span) + 10)} /></div>
    {!available.length && !clip ? <div className="rail-empty"><CalendarBlank size={25} weight="light" /><strong>暂无可用时段</strong><span>扫描后自动显示<br />有录像的日期和时间</span></div> : <div ref={ruler} className={`rail-ruler ${scrubbing ? 'scrubbing' : ''}`} tabIndex={0} role="group" aria-label="录像时间定位" aria-description={`当前定位 ${recordingTime(view.anchor)}；上下方向键移动，Shift 加速，PageUp / PageDown 翻页，Home / End 跳至录像首尾`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => pointerEnd(event)} onPointerCancel={event => pointerEnd(event, true)} onLostPointerCapture={event => pointerEnd(event, true)} onKeyDown={event => {
      if (event.target !== event.currentTarget || !available.length) return;
      const step = event.shiftKey ? 10 : 1;
      const delta = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: view.span / 2, PageDown: -view.span / 2 }[event.key];
      if (delta !== undefined || ['Home', 'End'].includes(event.key)) { event.preventDefault(); onScrubStart?.(); commit(event.key === 'Home' ? available[0].start : event.key === 'End' ? available.at(-1).end - .001 : clamp(view.anchor + delta, bounds.start, bounds.end)); }
    }}>
      {ticks.map(tick => <i className={`rail-tick ${tick.major ? 'major' : ''}`} key={tick.time} style={{ top: `${position(tick.time)}%` }}>{tick.major && <time>{recordingTime(tick.time).slice(0, tick.seconds ? 8 : 5)}</time>}</i>)}
      <div className="rail-coverage" style={{ top: `${clippedPosition(bounds.end)}%`, bottom: `${100 - clippedPosition(bounds.start)}%` }} />
      {available.filter(item => item.start < end && item.end > start).map(item => <button key={item.start} className="rail-recording" aria-label={`定位 ${recordingTime(item.start)} 至 ${recordingTime(item.end)}`} title={`${recordingTime(item.start)} – ${recordingTime(item.end)}`} style={{ top: `${clippedPosition(item.end)}%`, height: `${Math.max(.2, clippedPosition(item.start) - clippedPosition(item.end))}%` }} onClick={event => { if (event.detail === 0) { onScrubStart?.(); commit(Math.max(start, item.start)); } }} />)}
      {[bounds.start, bounds.end].filter(time => time > start && time < end).map(time => <span className="rail-day-boundary" key={time} style={{ top: `${position(time)}%` }}>{recordingTime(time).slice(0, 5)}</span>)}
      {managing && range && <>
        {range.start < end && range.end > start && <div className="rail-range" style={{ top: `${clippedPosition(range.end)}%`, height: `${Math.max(0, clippedPosition(range.start) - clippedPosition(range.end))}%` }} />}
        {['end', 'start'].map(key => <button key={key} className={`rail-range-handle ${key}`} role="slider" aria-label={key === 'start' ? '截取起点' : '截取终点'} aria-valuemin={bounds.start} aria-valuemax={bounds.end} aria-valuenow={range[key]} aria-valuetext={recordingTime(range[key])} aria-orientation="vertical" style={{ top: `${position(range[key])}%`, visibility: range[key] < start || range[key] > end ? 'hidden' : 'visible' }} onPointerDown={event => pointerDown(event, key)} onClick={event => event.stopPropagation()} onKeyDown={event => {
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); moveHandle(key, range[key] + (['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1) * (event.shiftKey ? 10 : 1)); }
        }}><span>{key === 'start' ? '开始' : '结束'}</span><time>{recordingTime(range[key])}</time></button>)}
      </>}
      {(scrubbing || current >= start && current <= end) && <div className={`rail-playhead ${scrubbing ? 'preview' : ''}`} style={{ top: `${position(scrubbing ? view.anchor : current)}%` }}><time>{recordingTime(scrubbing ? view.anchor : current)}</time></div>}
      {!available.some(item => item.start < end && item.end > start) && <div className="rail-no-recordings">此时段无录像<button className="text-button" onPointerDown={event => event.stopPropagation()} onClick={() => commit(view.anchor)}>定位最近录像</button></div>}
    </div>}
    <ExtensionSlot name="timeline-track" showPlaceholder={false} context={{ clips: visible, current, seek: onSeek }} />
    <footer className="rail-footer">
      <span className="timeline-gesture-hint" role="status">{scrubbing ? recordedAt(available, view.anchor) ? '松开后定位录像' : '松开吸附最近录像' : '滚轮 / 上下拖动浏览'}</span>
      {managing ? <button className={`timeline-fit ${outsideRange ? 'needs-fit' : ''}`} onClick={fitSelection}><ArrowsOutSimple size={14} />显示完整选区</button> : browsing && <button className="timeline-fit" onClick={returnToPlayback}><CrosshairSimple size={14} />回到播放位置</button>}
      <span>蓝色可回看 · {visible.length} 段</span><button className={managing ? 'active' : ''} onClick={onManage} disabled={!clip || !available.length} aria-pressed={managing}><Scissors size={15} />{managing ? '结束截取' : '截取片段'}</button>
    </footer>
  </section>;
}
