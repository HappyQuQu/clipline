const FALLBACK = '/assets/recording-placeholder.svg';
export function bytes(value) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}
export function sourceView(row) {
  return { ...row, real: true, count: row.segmentCount, size: bytes(row.totalBytes), interval: row.scanIntervalMinutes === null ? 'manual' : String(row.scanIntervalMinutes), color: 'blue', image: FALLBACK, lastScan: row.lastScanAt ? new Date(row.lastScanAt).toLocaleString('zh-CN', { timeZone: row.recordingTimezone }) : '尚未扫描', description: '本地录像目录 · 只读索引' };
}
export function dateInZone(at, timezone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}
export function clipView(row, dayStartAt, timezone = 'Asia/Shanghai') {
  const startAt = row.startAt ? Date.parse(row.startAt) : 0, endAt = row.endAt ? Date.parse(row.endAt) : 0;
  const dayStart = dayStartAt ? Date.parse(dayStartAt) : startAt - localSeconds(startAt, timezone) * 1000;
  return { ...row, real: true, image: row.thumbnailUrl || FALLBACK, media: null, start: (startAt - dayStart) / 1000, end: (endAt - dayStart) / 1000, duration: row.durationMs / 1000, date: row.startAt ? dateInZone(row.startAt, timezone) : '', startLabel: row.startAt ? new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(row.startAt)) : '—', endLabel: row.endAt ? new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(row.endAt)) : '—', endDate: row.endAt ? dateInZone(row.endAt, timezone) : '', codec: row.videoCodec === 'h264' ? 'H.264' : row.videoCodec === 'hevc' ? 'H.265' : row.videoCodec || '未知', resolution: row.width ? `${row.width} × ${row.height}` : '—', size: bytes(row.sizeBytes), dayStartAt, timezone };
}
export function localSeconds(at, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  const value = name => Number(parts.find(part => part.type === name)?.value || 0);
  return value('hour') * 3600 + value('minute') * 60 + value('second');
}
export function taskView(row, sources) {
  const labels = { scan: '目录扫描', reindex: '索引重建', prepare: '播放准备', export: '录像导出' };
  const crossDay = row.kind === 'export' && dateInZone(row.payload.startAt, row.payload.viewTimezone) !== dateInZone(row.payload.endAt, row.payload.viewTimezone);
  return { ...row, real: true, mode: row.payload?.mode, rangeLabel: row.kind === "export" ? `${new Date(row.payload.startAt).toLocaleString("zh-CN", {timeZone: row.payload.viewTimezone, hour12: false})} – ${new Date(row.payload.endAt)[crossDay ? 'toLocaleString' : 'toLocaleTimeString']("zh-CN", {timeZone: row.payload.viewTimezone, hour12: false})}` : "", title: row.kind === "export" ? row.payload.name : `${sources.find(source => source.id === row.sourceId)?.name || '录像源'} · ${labels[row.kind]}`, error: row.errorMessage, created: new Date(row.createdAt).toLocaleString('zh-CN'), demo: false };
}

export function reviewContext({ sourceId, date, generation = 0 }) {
  return `${sourceId}:${date}:${generation}`;
}

export function exportRequest(range, day, mode, name, timezone, endDay = day) {
  const left = Date.parse(day.dayStartAt), right = Date.parse(day.dayEndAt);
  const start = range.startAt ? Date.parse(range.startAt) : left + range.start * 1000;
  const crossDay = range.endDate && range.endDate !== range.date;
  const end = range.endAt ? Date.parse(range.endAt) : Date.parse(crossDay ? endDay.dayStartAt : day.dayStartAt) + range.end * 1000;
  const maximumEnd = crossDay ? Date.parse(endDay.dayEndAt) : right;
  return { sourceId: range.sourceId, date: range.date, viewTimezone: timezone, startAt: new Date(Math.max(left, start)).toISOString(), endAt: new Date(Math.min(maximumEnd, end)).toISOString(), ...(range.clipIds ? { segmentIds: range.clipIds } : {}), mode, name };
}
