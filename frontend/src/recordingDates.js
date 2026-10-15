export function recordingDateLabel(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : '日期未知';
}

export function recordingMoment(clip, offset, fallbackDate, timezone = 'Asia/Shanghai') {
  if (!clip?.startAt) return { date: fallbackDate, time: null };
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.parse(clip.startAt) + Math.max(0, offset) * 1000));
  const get = key => parts.find(part => part.type === key)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}:${get('second')}` };
}
