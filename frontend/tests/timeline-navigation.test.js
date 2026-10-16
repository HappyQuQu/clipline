import test from 'node:test';
import assert from 'node:assert/strict';
import { CURSOR_POSITION, zoomToSpan, spanToZoom, timelineWindow, timelineTime, panTime, defaultRecordingRange, fitTimelineRange, timelineTicks } from '../src/timelineNavigation.js';
import { recordedAt } from '../src/recordingSelection.js';

test('滑杆连续缩放，跨整点和午夜仍保持当前时间线固定位置', () => {
  for (const anchor of [0, 3599, 3600, 21540, 86399]) {
    for (const value of [0, 10, 37.5, 69.4, 100]) {
      const span = zoomToSpan(value), window = timelineWindow(anchor, span);
      assert.ok(Math.abs((window.end - anchor) / span - CURSOR_POSITION) < 1e-10);
      assert.ok(Math.abs(timelineTime(anchor, span, CURSOR_POSITION) - anchor) < 1e-8);
      assert.ok(Math.abs(spanToZoom(span) - value) < 1e-8);
    }
  }
});
test('拖动向下浏览较晚录像，滚轮反向平移，边界停在限定日期范围', () => {
  const bounds = { start: 100, end: 86400 };
  assert.equal(panTime(3600, 100, 400, 900, bounds), 3825);
  assert.equal(panTime(3600, -100, 400, 900, bounds), 3375);
  assert.equal(panTime(120, -1000, 400, 900, bounds), 100);
  assert.equal(panTime(86399, 1000, 400, 900, bounds), 86400);
});
test('默认一分钟可跨相邻文件，临近日初日末自动平移而不延长', () => {
  const rows = [{ start: 0, end: 20 }, { start: 20, end: 300 }, { start: 86300, end: 86400 }];
  assert.deepEqual(defaultRecordingRange(rows, 5), { start: 0, end: 60 });
  assert.deepEqual(defaultRecordingRange(rows, 60), { start: 30, end: 90 });
  assert.deepEqual(defaultRecordingRange(rows, 86399), { start: 86340, end: 86400 });
  assert.deepEqual(defaultRecordingRange(rows, 86400), { start: 86340, end: 86400 });
});
test('短录像不足一分钟取实际长度，默认选区不跨断档，空源不创建范围', () => {
  const rows = [{ start: 200, end: 230 }, { start: 300, end: 500 }];
  assert.deepEqual(defaultRecordingRange(rows, 220), { start: 200, end: 230 });
  const range = defaultRecordingRange(rows, 290);
  assert.deepEqual(range, { start: 300, end: 360 });
  assert.ok(recordedAt(rows, range.start) && recordedAt(rows, range.end, true));
  assert.equal(defaultRecordingRange([], 0), null);
});
test('显示完整选区不改变导出范围，日初午夜以及长区间都可看到真实边界', () => {
  for (const range of [{ start: 0, end: 60 }, { start: 21540, end: 21859.103 }, { start: 86340, end: 86400 }, { start: 0, end: 86400 }]) {
    const snapshot = { ...range }, view = fitTimelineRange(range);
    const window = timelineWindow(view.anchor, view.span);
    assert.ok(window.start <= range.start && window.end >= range.end);
    assert.deepEqual(range, snapshot);
  }
});
test('刻度对齐真实时钟，缩放到秒和全天不会显示负时间或隔日假刻度', () => {
  for (const span of [120, 143, 900, 3600, 86400]) {
    const { start, end } = timelineWindow(3600, span);
    const ticks = timelineTicks(start, end, span, { start: 0, end: 86400 });
    assert.ok(ticks.length > 0 && ticks.length <= 80);
    assert.ok(ticks.every(tick => tick.time >= 0 && tick.time <= 86400));
    assert.ok(ticks.some(tick => tick.major));
  }
});
