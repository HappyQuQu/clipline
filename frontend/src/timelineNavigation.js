import { nearestRecording, recordingCoverage } from './recordingSelection.js';

export const CURSOR_POSITION = .28;
export const MIN_SPAN = 120;
export const MAX_SPAN = 86400;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const zoomToSpan = value => MIN_SPAN * (MAX_SPAN / MIN_SPAN) ** (1 - clamp(value, 0, 100) / 100);
export const spanToZoom = span => 100 * (1 - Math.log(clamp(span, MIN_SPAN, MAX_SPAN) / MIN_SPAN) / Math.log(MAX_SPAN / MIN_SPAN));
export function timelineWindow(anchor, span) {
  const end = anchor + span * CURSOR_POSITION;
  return { start: end - span, end };
}
export function timelineTime(anchor, span, fraction) { return timelineWindow(anchor, span).end - fraction * span; }
export function panTime(anchor, pixels, height, span, bounds) { return clamp(anchor + pixels / Math.max(1, height) * span, bounds.start, bounds.end); }
export function defaultRecordingRange(rows, current, duration = 60) {
  const coverage = recordingCoverage(rows);
  const time = nearestRecording(coverage, current);
  if (time === null) return null;
  const row = coverage.find(item => time >= item.start && time < item.end);
  const length = Math.min(duration, row.end - row.start);
  const start = clamp(Math.floor(time) - length / 2, row.start, row.end - length);
  return { start, end: start + length };
}
export function fitTimelineRange(range) {
  const span = clamp((range.end - range.start) / .42, MIN_SPAN, MAX_SPAN);
  const anchor = clamp((range.start + range.end) / 2, range.end - span * CURSOR_POSITION, range.start + span * (1 - CURSOR_POSITION));
  return { anchor, span };
}
export function timelineTicks(start, end, span, bounds) {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600, 7200, 14400];
  const major = steps.find(step => step >= span / 7) || 14400;
  const minor = major / 5;
  const ticks = [];
  for (let index = Math.ceil(Math.max(start, bounds.start) / minor); index * minor <= Math.min(end, bounds.end); index++) {
    ticks.push({ time: index * minor, major: index % 5 === 0, seconds: major < 60 });
  }
  return ticks;
}
export function spanLabel(span) {
  if (span >= 3600) return `${+(span / 3600).toFixed(1)} 小时`;
  return `${Math.round(span / 60)} 分钟`;
}
