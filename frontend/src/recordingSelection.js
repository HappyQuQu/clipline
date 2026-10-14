// Half-open playback intervals; export end boundaries may equal the recording end.
export function recordingCoverage(rows, start = 0, end = 86400) {
  const result = [];
  for (const row of rows.map(row => ({ start: Math.max(start, row.start), end: Math.min(end, row.end) })).filter(row => row.end > row.start).sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && row.start <= last.end) last.end = Math.max(last.end, row.end);
    else result.push({ ...row });
  }
  return result;
}
export function recordedAt(rows, value, endBoundary = false) {
  return Number.isFinite(value) && rows.some(row => endBoundary ? value > row.start && value <= row.end : value >= row.start && value < row.end);
}
export function nearestRecording(rows, value, endBoundary = false) {
  if (!rows.length) return null;
  if (recordedAt(rows, value, endBoundary)) return value;
  const points = rows.flatMap(row => endBoundary ? [row.start + Math.min(.001, (row.end - row.start) / 2), row.end] : [row.start, row.end - Math.min(.001, (row.end - row.start) / 2)]);
  return points.reduce((best, point) => Math.abs(point - value) < Math.abs(best - value) ? point : best);
}
export function adjacentRecordingDate(dates, date, direction) {
  return dates.filter(day => direction < 0 ? day < date : day > date).sort((a, b) => direction < 0 ? b.localeCompare(a) : a.localeCompare(b))[0] || null;
}
export function reviewDayBounds(range, date, dayLength = 86400) {
  return range ? { start: date === range.startDate ? range.start : 0, end: date === range.endDate ? Math.min(range.end, dayLength) : dayLength } : { start: 0, end: dayLength };
}
export function parseRecordingTime(text) {
  if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(text)) return NaN;
  const [h, m, s = 0] = text.split(':').map(Number);
  return m < 60 && s < 60 && (h < 24 || h === 24 && m === 0 && s === 0) ? h * 3600 + m * 60 + s : NaN;
}
export function recordingTime(value) {
  if (!Number.isFinite(value)) return '';
  const seconds = Math.floor(value);
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(part => String(part).padStart(2, '0')).join(':');
}
export function monthDays(month) {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, i) => {
    const day = new Date(Date.UTC(year, number - 1, 1 - offset + i));
    return { date: day.toISOString().slice(0, 10), day: day.getUTCDate(), inMonth: day.getUTCMonth() === number - 1 };
  });
}

// Clip browsing follows the selected day/range; rail zoom never filters this catalog.
export function reviewQueryRange(range, date) {
  const bounds = reviewDayBounds(range, date, 90000);
  return { startSeconds: bounds.start, endSeconds: bounds.end };
}

export function appendReviewPage(current, data, windowKey, cursor) {
  if (!current || current.windowKey !== windowKey || current.nextCursor !== cursor) return current;
  return { ...current, items: [...new Map([...current.items, ...data.items].map(row => [row.id, row])).values()], nextCursor: data.nextCursor };
}
