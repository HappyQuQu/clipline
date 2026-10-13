import { useEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight, Minus, Plus, Scissors } from '@phosphor-icons/react';
import { clock } from '../domain';
import { ExtensionSlot, IconButton } from './UI';

// Like the original UniFi rail: later times are at the top, earlier times at the bottom.
export default function VerticalTimeline({ clips, clip, date, current, onDateChange, onShiftDate, onSeek, managing, range, onRangeChange, onManage }) {
  const ruler = useRef(null);
  const dragOrigin = useRef(null);
  const [span, setSpan] = useState(900);
  const [hour, setHour] = useState(Math.floor((clip?.start || 0) / 3600));
  const [anchor, setAnchor] = useState(clip?.start || 0);
  const [focusedHandle, setFocusedHandle] = useState(null);
  useEffect(() => {
    setHour(Math.floor((clip?.start || 0) / 3600));
    setAnchor(clip?.start || 0);
  }, [date, clips[0]?.sourceId]);
  useEffect(() => {
    if (managing && range) {
      setAnchor((range.start + range.end) / 2);
      setSpan(300);
      setHour(Math.floor(range.start / 3600));
    }
  }, [managing]);
  const start = span === 3600 ? hour * 3600 : Math.max(hour * 3600, Math.min((hour + 1) * 3600 - span, Math.floor((anchor - span / 2) / 60) * 60));
  const end = start + span;
  const position = value => Math.max(0, Math.min(100, (end - value) / span * 100));
  const visible = clips.filter(item => item.start < end && item.end > start);
  const ticks = span === 300 ? 5 : 12;
  useEffect(() => {
    if (clip && !managing && (clip.start < start || clip.end > end)) {
      setHour(Math.floor(clip.start / 3600));
      setAnchor(clip.start);
    }
  }, [clip?.id]);

  function timeAt(clientY) {
    const rect = ruler.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return Math.min(86399, Math.max(0, Math.round(end - ratio * span)));
  }
  function moveHandle(key, value) {
    if (!range) return;
    onRangeChange(key === 'start' ? { ...range, start: Math.min(value, range.end - 1) } : { ...range, end: Math.max(value, range.start + 1) });
  }
  const updateDate = e => { if (e.currentTarget.value) onDateChange(e.currentTarget.value); };
  return <section className="vertical-timeline panel" aria-label="录像时间轴">
    <div className="rail-date"><IconButton icon={CaretLeft} label="前一天" onClick={() => onShiftDate(-1)} /><input type="date" aria-label="录像日期" value={date} onInput={updateDate} onChange={updateDate} /><IconButton icon={CaretRight} label="后一天" onClick={() => onShiftDate(1)} /></div>
    <div className="rail-heading"><h2>录像时间轴</h2><select aria-label="回看时段" value={hour} onChange={e => { const value = Number(e.target.value); setHour(value); const selectedTime = clip && Math.floor(clip.start / 3600) === value ? clip.start : clips.find(item => Math.floor(item.start / 3600) === value)?.start; setAnchor(selectedTime ?? value * 3600 + span / 2); }}>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>)}</select></div>
    <div className="rail-zoom"><IconButton icon={Minus} label="缩小时间轴" disabled={span === 3600} onClick={() => setSpan(span === 300 ? 900 : 3600)} /><select aria-label="时间轴范围" value={span} onChange={e => setSpan(Number(e.target.value))}><option value="300">5 分钟</option><option value="900">15 分钟</option><option value="3600">1 小时</option></select><IconButton icon={Plus} label="放大时间轴" disabled={span === 300} onClick={() => setSpan(span === 3600 ? 900 : 300)} /></div>
    <div ref={ruler} className="rail-ruler" onClick={e => onSeek(timeAt(e.clientY))}>
      {Array.from({ length: ticks * 5 + 1 }, (_, i) => <i className={`rail-tick ${i % 5 === 0 ? 'major' : ''}`} key={i} style={{ top: `${i / (ticks * 5) * 100}%` }}>{i % 5 === 0 && <time>{end - i / (ticks * 5) * span === 86400 ? '24:00' : clock(end - i / (ticks * 5) * span).slice(0, 5)}</time>}</i>)}
      <div className="rail-coverage" />
      {visible.map(item => <button key={item.id} className={`rail-recording ${item.id === clip?.id ? 'active' : ''}`} aria-label={`定位 ${clock(item.start)} 至 ${clock(item.end)}`} title={`${clock(item.start)} – ${clock(item.end)}`} style={{ top: `${position(item.end)}%`, height: `${Math.max(.2, position(item.start) - position(item.end))}%` }} onClick={e => {
        e.stopPropagation();
        onSeek(e.detail === 0 ? item.start : Math.max(item.start, Math.min(item.end - .1, timeAt(e.clientY))));
      }} />)}
      {managing && range && range.start < end && range.end > start && <>
        <div className="rail-range" style={{ top: `${position(range.end)}%`, height: `${Math.max(0, position(range.start) - position(range.end))}%` }} />
        {['end', 'start'].map(key => range[key] >= start && range[key] <= end && <button key={key} className={`rail-range-handle ${key} ${focusedHandle === key ? 'focused' : ''}`} role="slider" aria-label={key === 'start' ? '截取起点' : '截取终点'} aria-valuemin={0} aria-valuemax={86399} aria-valuenow={range[key]} aria-valuetext={clock(range[key])} aria-orientation="vertical" style={{ top: `${position(range[key])}%` }} onClick={e => e.stopPropagation()} onFocus={() => setFocusedHandle(key)} onBlur={() => setFocusedHandle(null)} onPointerDown={e => { e.stopPropagation(); dragOrigin.current = { key, time: range[key], clientY: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId) && dragOrigin.current?.key === key) moveHandle(key, Math.max(0, Math.min(86399, dragOrigin.current.time + timeAt(e.clientY) - timeAt(dragOrigin.current.clientY)))); }} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onKeyDown={e => {
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); moveHandle(key, range[key] + (['ArrowUp', 'ArrowRight'].includes(e.key) ? 1 : -1) * (e.shiftKey ? 10 : 1)); }
        }}><span>{key === 'start' ? '开始' : '结束'}</span><time>{clock(range[key])}</time></button>)}
      </>}
      {current >= start && current <= end && <div className="rail-playhead" style={{ top: `${position(current)}%` }}><time>{clock(current)}</time></div>}
      {!visible.length && <div className="rail-no-recordings">此时段无录像</div>}
    </div>
    <ExtensionSlot name="timeline-track" showPlaceholder={false} context={{ clips: visible, current, seek: onSeek }} />
    <footer className="rail-footer"><span>当前范围 {visible.length} 段 · 蓝色为录像</span><button className={managing ? 'active' : ''} onClick={onManage} disabled={!clip} aria-pressed={managing}><Scissors size={15} />{managing ? '结束管理' : '管理片段'}</button></footer>
  </section>;
}
