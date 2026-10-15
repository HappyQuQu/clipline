import { useEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight, Minus, Plus, Scissors, CalendarBlank } from '@phosphor-icons/react';
import { clock } from '../domain';
import { ExtensionSlot, IconButton } from './UI';
import RecordingRangePicker from './RecordingRangePicker';
import { recordingTime, adjacentRecordingDate, recordedAt, recordingCoverage, nearestRecording, recordingRailStart, recordingRangeHandle, draggedRecordingTime } from '../recordingSelection';

// Like the original UniFi rail: later times are at the top, earlier times at the bottom.
export default function VerticalTimeline({ clips, clip, date, current, onDateChange, onSeek, managing, range, onRangeChange, onManage, coverage, dayRecordings, dates = [], source, timezone, reviewRange, onReviewRangeChange, real = false, bounds = { start: 0, end: 86400 } }) {
  const available = recordingCoverage(coverage || clips, bounds.start, bounds.end);
  const navigationDates = dates.filter(day => !reviewRange || day >= reviewRange.startDate && day <= reviewRange.endDate);
  const previousDate = adjacentRecordingDate(navigationDates, date, -1), nextDate = adjacentRecordingDate(navigationDates, date, 1);
  const hours = Array.from({ length: 24 }, (_, i) => i).filter(i => available.some(row => row.start < (i + 1) * 3600 && row.end > i * 3600));
  const ruler = useRef(null);
  const dragOrigin = useRef(null);
  const [span, setSpan] = useState(900);
  const [hour, setHour] = useState(Math.max(0, Math.min(23, Math.floor(current / 3600))));
  const [anchor, setAnchor] = useState(Math.max(0, current));
  const [focusedHandle, setFocusedHandle] = useState(null);
  useEffect(() => {
    setHour(Math.max(0, Math.min(23, Math.floor(current / 3600))));
    setAnchor(Math.max(0, current));
  }, [date, clips[0]?.sourceId]);
  useEffect(() => {
    if (managing && range) {
      setAnchor((range.start + range.end) / 2);
      setSpan(range.end - range.start > 900 ? 3600 : range.end - range.start > 300 ? 900 : 300);
      setHour(Math.max(0, Math.min(23, Math.floor(range.start / 3600))));
    }
  }, [managing]);
  const start = recordingRailStart(span, hour, anchor, managing);
  const end = start + span;
  const position = value => Math.max(0, Math.min(100, (end - value) / span * 100));
  const visible = clips.filter(item => item.start < end && item.end > start);
  const ticks = span === 300 ? 5 : 12;
  useEffect(() => {
    if (clip && !managing && (current < start || current > end)) {
      setHour(Math.max(0, Math.min(23, Math.floor(current / 3600))));
      setAnchor(Math.max(0, current));
    }
  }, [clip?.id, current]);

  function timeAt(clientY) {
    const rect = ruler.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return Math.min(86400, Math.max(0, Math.round(end - ratio * span)));
  }
  function moveHandle(key, value) {
    if (!range) return;
    const rows = recordingCoverage(available, key === 'end' ? range.start + .001 : bounds.start, key === 'start' ? range.end - .001 : bounds.end);
    const selected = nearestRecording(rows, value, key === 'end');
    if (selected !== null) onRangeChange({ ...range, [key]: selected });
  }
  return <section className="vertical-timeline panel" aria-label="录像时间轴">
    <div className="rail-date"><IconButton icon={CaretLeft} label="上一个录像日期" disabled={!previousDate} onClick={() => onDateChange(previousDate)} /><RecordingRangePicker date={date} dates={dates} source={source} timezone={timezone} range={reviewRange} onApply={onReviewRangeChange || (value => onDateChange(value.startDate))} onClear={() => onReviewRangeChange?.(null)} coverage={coverage || clips} dayRecordings={dayRecordings} real={real} /><IconButton icon={CaretRight} label="下一个录像日期" disabled={!nextDate} onClick={() => onDateChange(nextDate)} /></div>
    {reviewRange && <div className="rail-filter-summary"><span>已限定录像区间</span><button className="text-button" onClick={() => onReviewRangeChange(null)}>清除</button></div>}
    <div className="rail-heading"><h2>录像时间轴</h2><select aria-label="回看时段" disabled={!hours.length} value={hours.includes(hour) ? hour : hours[0] ?? ''} onChange={e => { const value = Number(e.target.value); const selectedTime = available.find(row => row.start < (value + 1) * 3600 && row.end > value * 3600); if (selectedTime) { const time = Math.max(value * 3600, selectedTime.start); setHour(value); setAnchor(time); onSeek(time); } }}>{!hours.length && <option value="">无录像</option>}{Array.from({ length: 24 }, (_, i) => <option key={i} value={i} disabled={!hours.includes(i)}>{String(i).padStart(2, '0')}:00</option>)}</select></div>
    <div className="rail-zoom"><IconButton icon={Minus} label="缩小时间轴" disabled={!available.length || span === 3600} onClick={() => setSpan(span === 300 ? 900 : 3600)} /><select aria-label="时间轴范围" disabled={!available.length} value={span} onChange={e => setSpan(Number(e.target.value))}><option value="300">5 分钟</option><option value="900">15 分钟</option><option value="3600">1 小时</option></select><IconButton icon={Plus} label="放大时间轴" disabled={!available.length || span === 300} onClick={() => setSpan(span === 3600 ? 900 : 300)} /></div>
    {!available.length && !clip ? <div className="rail-empty"><CalendarBlank size={25} weight="light" /><strong>暂无可用时段</strong><span>扫描后自动显示<br />有录像的日期和时间</span></div> : <div ref={ruler} className={`rail-ruler ${available.length ? '' : 'unavailable'}`} onClick={e => { const time = timeAt(e.clientY); if (recordedAt(available, time)) onSeek(time); }}>
      {Array.from({ length: ticks * 5 + 1 }, (_, i) => <i className={`rail-tick ${i % 5 === 0 ? 'major' : ''}`} key={i} style={{ top: `${i / (ticks * 5) * 100}%` }}>{i % 5 === 0 && <time>{end - i / (ticks * 5) * span === 86400 ? '24:00' : clock(end - i / (ticks * 5) * span).slice(0, 5)}</time>}</i>)}
      <div className="rail-coverage" />
      {available.filter(item => item.start < end && item.end > start).map((item, index) => <button key={item.id || index} className={`rail-recording ${item.id === clip?.id ? 'active' : ''}`} aria-label={`定位 ${recordingTime(item.start)} 至 ${recordingTime(item.end)}`} title={`${recordingTime(item.start)} – ${recordingTime(item.end)}`} style={{ top: `${position(item.end)}%`, height: `${Math.max(.2, position(item.start) - position(item.end))}%` }} onClick={e => {
        e.stopPropagation();
        onSeek(e.detail === 0 ? Math.max(start, item.start) : Math.max(item.start, Math.min(item.end - .1, timeAt(e.clientY))));
      }} />)}
      {managing && range && <>
        {range.start < end && range.end > start && <div className="rail-range" style={{ top: `${position(range.end)}%`, height: `${Math.max(0, position(range.start) - position(range.end))}%` }} />}
        {['end', 'start'].map(key => {
          const handle = recordingRangeHandle(range[key], start, end);
          const label = key === 'start' ? '开始' : '结束';
          return <button key={key} className={`rail-range-handle ${key} ${handle.outside ? 'outside' : ''} ${focusedHandle === key ? 'focused' : ''}`} role="slider" aria-label={key === 'start' ? '截取起点' : '截取终点'} aria-valuemin={available[0]?.start || 0} aria-valuemax={available.at(-1)?.end || 86400} aria-valuenow={range[key]} aria-valuetext={recordingTime(range[key])} aria-orientation="vertical" title={`${label} ${recordingTime(range[key])}${handle.outside ? '（超出当前显示范围，拖动此处调整）' : '（拖动调整）'}`} style={{ top: `${handle.position}%` }} onClick={e => e.stopPropagation()} onFocus={() => setFocusedHandle(key)} onBlur={() => setFocusedHandle(null)} onPointerDown={e => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation(); e.currentTarget.focus();
            dragOrigin.current = { key, time: handle.visibleTime, clientY: e.clientY, height: ruler.current.getBoundingClientRect().height, span };
            e.currentTarget.setPointerCapture(e.pointerId);
          }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId) && dragOrigin.current?.key === key) moveHandle(key, draggedRecordingTime(dragOrigin.current, e.clientY)); }} onPointerUp={e => { dragOrigin.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={e => { dragOrigin.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onLostPointerCapture={() => { dragOrigin.current = null; }} onKeyDown={e => {
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); moveHandle(key, range[key] + (['ArrowUp', 'ArrowRight'].includes(e.key) ? 1 : -1) * (e.shiftKey ? 10 : 1)); }
        }}><span>{label}{handle.outside && <small aria-hidden="true">{handle.outside === 'after' ? ' ↑' : ' ↓'}</small>}</span><time>{recordingTime(range[key])}</time></button>;
        })}
      </>}
      {clip && current >= start && current <= end && <div className="rail-playhead" style={{ top: `${position(current)}%` }}><time>{clock(current)}</time></div>}
      {!available.some(item => item.start < end && item.end > start) && <div className="rail-no-recordings">此时段无录像{available[0] && <button className="text-button" onClick={e => { e.stopPropagation(); onSeek(available[0].start); }}>跳到可用录像</button>}</div>}
    </div>}
    <ExtensionSlot name="timeline-track" showPlaceholder={false} context={{ clips: visible, current, seek: onSeek }} />
    <footer className="rail-footer"><span>时间轴内 {visible.length} 段 · 蓝色可回看</span><button className={managing ? 'active' : ''} onClick={onManage} disabled={!clip} aria-pressed={managing}><Scissors size={15} />{managing ? '结束管理' : '管理片段'}</button></footer>
  </section>;
}
