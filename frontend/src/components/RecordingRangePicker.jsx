import { useEffect, useRef, useState } from 'react';
import { CalendarBlank, CaretLeft, CaretRight, Check, X } from '@phosphor-icons/react';
import { IconButton } from './UI';
import { request, queryString } from '../api/client';
import { monthDays, parseRecordingTime, recordingTime, recordedAt, recordingCoverage } from '../recordingSelection';

export default function RecordingRangePicker({ date, dates, source, timezone, range, onApply, onClear, coverage = [], dayRecordings, real }) {
  const trigger = useRef(null);
  const [open, setOpen] = useState(false);
  return <>
    <button ref={trigger} className="rail-date-trigger" aria-label="选择录像日期与时间区间" aria-haspopup="dialog" aria-expanded={open} disabled={!dates.length} onClick={() => setOpen(true)}><span>{date.replaceAll('-', '/')}</span><CalendarBlank size={15} /></button>
    {open && <RangeDialog date={date} dates={dates} source={source} timezone={timezone} range={range} coverage={coverage} dayRecordings={dayRecordings} real={real} trigger={trigger} onClose={() => setOpen(false)} onApply={value => { onApply(value); setOpen(false); }} onClear={() => { onClear(); setOpen(false); }} />}
  </>;
}
function RangeDialog({ date, dates, source, timezone, range, coverage, dayRecordings, real, trigger, onClose, onApply, onClear }) {
  const dialog = useRef(null);
  const [month, setMonth] = useState((dates.includes(date) ? date : dates[0]).slice(0, 7));
  const [draft, setDraft] = useState(range || { startDate: dates.includes(date) ? date : dates[0], endDate: dates.includes(date) ? date : dates[0] });
  const [edge, setEdge] = useState('start');
  const [times, setTimes] = useState({ start: range ? recordingTime(range.start) : '', end: range ? recordingTime(range.end) : '' });
  const [data, setData] = useState({}), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const earliest = [...dates].sort()[0].slice(0, 7), latest = [...dates].sort().at(-1).slice(0, 7);
  useEffect(() => {
    const element = dialog.current;
    const place = () => {
      const rect = trigger.current.getBoundingClientRect();
      element.style.setProperty('--picker-left', `${Math.max(12, Math.min(rect.left, window.innerWidth - 372))}px`);
      element.style.setProperty('--picker-top', `${Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - element.getBoundingClientRect().height - 12))}px`);
    };
    element.showModal();
    place(); window.addEventListener('resize', place);
    element.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
    return () => { window.removeEventListener('resize', place); element.close(); trigger.current?.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    Promise.all([...new Set([draft.startDate, draft.endDate])].map(async day => {
      if (!real) return [day, recordingCoverage(dayRecordings?.[day] || coverage)];
      const result = await request(`/timeline?${queryString({ sourceId: source.id, date: day, viewTimezone: timezone, startSeconds: 0, endSeconds: 90000, limit: 1 })}`, { signal: controller.signal });
      return [day, result.coverage.map(row => ({ start: (Date.parse(row.startAt) - Date.parse(result.dayStartAt)) / 1000, end: (Date.parse(row.endAt) - Date.parse(result.dayStartAt)) / 1000 }))];
    })).then(entries => {
      if (controller.signal.aborted) return;
      const next = Object.fromEntries(entries); setData(next); setLoading(false);
      setTimes(current => ({ start: current.start || recordingTime(Math.ceil(next[draft.startDate]?.[0]?.start)), end: current.end || recordingTime(Math.floor(next[draft.endDate]?.at(-1)?.end)) }));
    }).catch(failure => { if (failure.name !== 'AbortError') { setError(failure.message); setLoading(false); } });
    return () => controller.abort();
  }, [draft.startDate, draft.endDate, source.id, timezone, real]);
  const start = parseRecordingTime(times.start), end = parseRecordingTime(times.end);
  const startRows = data[draft.startDate] || [], endRows = data[draft.endDate] || [];
  const validStart = recordedAt(startRows, start), validEnd = recordedAt(endRows, end, true);
  const ordered = draft.startDate < draft.endDate || draft.startDate === draft.endDate && end > start;
  const valid = !loading && !error && validStart && validEnd && ordered;
  function pick(day) {
    if (edge === 'start') { setDraft(current => ({ startDate: day, endDate: day > current.endDate ? day : current.endDate })); setTimes(current => ({ start: recordingTime(Math.ceil(data[day]?.[0]?.start)), end: day > draft.endDate ? recordingTime(Math.floor(data[day]?.at(-1)?.end)) : current.end })); setEdge('end'); }
    else { setDraft(current => ({ startDate: day < current.startDate ? day : current.startDate, endDate: day })); setTimes(current => ({ start: day < draft.startDate ? recordingTime(Math.ceil(data[day]?.[0]?.start)) : current.start, end: recordingTime(Math.floor(data[day]?.at(-1)?.end)) })); }
  }
  function shiftMonth(delta) {
    const [year, number] = month.split('-').map(Number); setMonth(new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7));
  }
  return <dialog ref={dialog} className="recording-range-dialog" aria-labelledby="recording-range-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <header><div><h2 id="recording-range-title">选择录像区间</h2><p>仅可选择有录像的日期与时间</p></div><IconButton icon={X} label="关闭区间选择" onClick={onClose} /></header>
    <div className="range-picker-body"><div className="calendar-month"><IconButton icon={CaretLeft} label="上个月" disabled={month <= earliest} onClick={() => shiftMonth(-1)} /><strong>{Number(month.slice(0, 4))} 年 {Number(month.slice(5))} 月</strong><IconButton icon={CaretRight} label="下个月" disabled={month >= latest} onClick={() => shiftMonth(1)} /></div>
    <div className="recording-calendar" aria-label="录像日历"><div className="calendar-weekdays">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}</div><div className="calendar-days">{monthDays(month).map(day => <button key={day.date} disabled={!day.inMonth || !dates.includes(day.date)} aria-label={`${day.date}${dates.includes(day.date) ? ' 有录像' : ' 无录像'}`} aria-pressed={day.date === draft.startDate || day.date === draft.endDate} className={`${day.inMonth ? '' : 'outside'} ${day.date > draft.startDate && day.date < draft.endDate ? 'in-range' : ''}`} onClick={() => pick(day.date)}>{day.day}{day.inMonth && dates.includes(day.date) && <i />}</button>)}</div></div>
    <div className="calendar-legend"><i />有录像<span>灰色日期不可选择</span></div>
    <div className="recording-range-fields">{['start', 'end'].map(key => <div key={key} className={edge === key ? 'editing' : ''}><label htmlFor={`review-${key}-time`}>{key === 'start' ? '开始时间' : '结束时间'}</label><button className="range-date-value" aria-label={`选择${key === 'start' ? '开始' : '结束'}日期`} aria-pressed={edge === key} onClick={() => { setEdge(key); setMonth(draft[`${key}Date`].slice(0, 7)); }}>{draft[`${key}Date`].replaceAll('-', '/')}<CalendarBlank size={14} /></button><input id={`review-${key}-time`} aria-label={`回看${key === 'start' ? '开始' : '结束'}时间`} aria-invalid={!loading && !(key === 'start' ? validStart : validEnd)} value={times[key]} placeholder="HH:MM:SS" inputMode="text" onFocus={() => setEdge(key)} onChange={event => setTimes(current => ({ ...current, [key]: event.target.value }))} /></div>)}</div>
    <div className="available-recording-times"><strong>{edge === 'start' ? '开始日期' : '结束日期'}可用录像</strong>{loading ? <p role="status">正在读取可用时段…</p> : (data[draft[`${edge}Date`]] || []).length ? <div>{(data[draft[`${edge}Date`]] || []).map(row => <button key={row.start} onClick={() => setTimes(current => ({ ...current, [edge]: recordingTime(edge === 'start' ? Math.ceil(row.start) : Math.floor(row.end)) }))}>{recordingTime(row.start)} – {recordingTime(row.end)}</button>)}</div> : <p>索引已更新，这一天暂无可用录像。</p>}</div>
    <p className={`range-picker-feedback ${!loading && !valid ? 'invalid' : ''}`} role="status">{error || (loading ? '正在核对录像范围' : !validStart || !validEnd ? '起止时间需位于上方的可用录像时段内。' : !ordered ? '结束时间需要晚于开始时间。' : '区间内的断档置灰，回看时只定位有录像的位置。')}</p>
    </div><footer><button className="text-button" onClick={onClear}>恢复全部录像</button><div><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={!valid} onClick={() => onApply({ ...draft, start, end })}><Check size={16} />应用</button></div></footer>
  </dialog>;
}
