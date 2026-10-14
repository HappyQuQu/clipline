import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingCoverage, recordedAt, nearestRecording, adjacentRecordingDate, reviewDayBounds, parseRecordingTime, recordingTime, monthDays, selectedExportClip, recordingRailStart } from '../src/recordingSelection.js';

const recordings = [{ start: -100, end: 100 }, { start: 300, end: 600 }, { start: 500, end: 700 }, { start: 86300, end: 86500 }];
test('跨整点截取居中显示两个边界，日初和日末保持在当天内', () => {
  const left = 21540, right = 21859.103;
  const start = recordingRailStart(900, 5, (left + right) / 2, true);
  assert.ok(start <= left && start + 900 >= right);
  assert.equal(recordingRailStart(300, 0, 30, true), 0);
  assert.equal(recordingRailStart(300, 23, 86390, true), 86100);
  assert.equal(recordingRailStart(900, 5, 21540), 20700);
  assert.equal(recordingRailStart(3600, 5, 21540), 18000);
});
test('单片段截取保留当前文件及毫秒边界，不混入相邻重叠文件', () => {
  const clip = { id: 'selected', start: 21540, end: 21859.103 };
  assert.equal(selectedExportClip(clip, clip.start, clip.end), 'selected');
  assert.equal(selectedExportClip(clip, 21541, 21859), 'selected');
  assert.equal(selectedExportClip(clip, 21539.999, clip.end), undefined);
  assert.equal(selectedExportClip(clip, clip.start, 21859.104), undefined);
  assert.equal(selectedExportClip(clip, clip.end, clip.start), undefined);
  assert.equal(selectedExportClip(null, clip.start, clip.end), undefined);
});
test('按日期与回看范围裁剪覆盖，合并重叠文件而保留断档', () => {
  assert.deepEqual(recordingCoverage(recordings, 50, 86400), [{ start: 50, end: 100 }, { start: 300, end: 700 }, { start: 86300, end: 86400 }]);
});
test('播放起点不可落在断档或右边界，导出终点可落在录像末尾', () => {
  const rows = recordingCoverage(recordings);
  assert.equal(recordedAt(rows, 100), false); assert.equal(recordedAt(rows, 100, true), true);
  assert.equal(recordedAt(rows, 300), true); assert.equal(recordedAt(rows, 300, true), false);
  assert.equal(recordedAt(rows, 200), false); assert.equal(recordedAt(rows, NaN), false);
  assert.equal(recordedAt(rows, 86400, true), true);
});
test('拖动边界吸附到录像，开始和结束保持半开区间语义', () => {
  const rows = recordingCoverage(recordings);
  assert.equal(nearestRecording(rows, 250), 300);
  assert.equal(nearestRecording(rows, 150, true), 100);
  assert.equal(nearestRecording(rows, 410), 410);
  assert.equal(nearestRecording([], 100), null);
  assert.ok(recordedAt(rows, nearestRecording(rows, 100)));
});
test('日期导航跨越无录像日期，边界不再跳向空白日期', () => {
  const dates = ['2026-06-12', '2026-06-02', '2026-06-01'];
  assert.equal(adjacentRecordingDate(dates, '2026-06-02', 1), '2026-06-12');
  assert.equal(adjacentRecordingDate(dates, '2026-06-02', -1), '2026-06-01');
  assert.equal(adjacentRecordingDate(dates, '2026-06-01', -1), null);
});
test('跨日回看区间只约束首尾，保留中间有录像的日期', () => {
  const range = { startDate: '2026-06-01', endDate: '2026-06-03', start: 30000, end: 600 };
  assert.deepEqual(reviewDayBounds(range, '2026-06-01'), { start: 30000, end: 86400 });
  assert.deepEqual(reviewDayBounds(range, '2026-06-02'), { start: 0, end: 86400 });
  assert.deepEqual(reviewDayBounds(range, '2026-06-03'), { start: 0, end: 600 });
  assert.deepEqual(reviewDayBounds({ ...range, endDate: range.startDate, end: 35000 }, range.startDate), { start: 30000, end: 35000 });
});
test('时间输入拒绝无效数值并支持午夜结束，日历按周一排列且覆盖闰年', () => {
  for (const value of ['25:00', '12:60', '12:30:60', '24:01', '', '-1:00']) assert.ok(Number.isNaN(parseRecordingTime(value)), value);
  assert.equal(parseRecordingTime('07:34:41'), 27281);
  assert.equal(parseRecordingTime('24:00:00'), 86400);
  assert.equal(recordingTime(86400), '24:00:00');
  assert.equal(monthDays('2026-06')[0].date, '2026-06-01');
  assert.equal(monthDays('2024-02').filter(day => day.inMonth).length, 29);
});

test('回看片段查询覆盖整天，时间轴的五分钟或十五分钟缩放不限制片段列表', async () => {
  const { reviewQueryRange } = await import('../src/recordingSelection.js');
  assert.deepEqual(reviewQueryRange(null, '2026-06-02'), { startSeconds: 0, endSeconds: 90000 });
  const range = { startDate: '2026-06-01', endDate: '2026-06-02', start: 86340, end: 60 };
  assert.deepEqual(reviewQueryRange(range, '2026-06-01'), { startSeconds: 86340, endSeconds: 90000 });
  assert.deepEqual(reviewQueryRange(range, '2026-06-02'), { startSeconds: 0, endSeconds: 60 });
});

test('全天列表分页不重复追加同一回复，切换日期后旧分页不覆盖新列表', async () => {
  const { appendReviewPage } = await import('../src/recordingSelection.js');
  const current = { windowKey: 'one:day', items: [{ id: 'a' }], nextCursor: 'page2' };
  const data = { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'page3' };
  const next = appendReviewPage(current, data, 'one:day', 'page2');
  assert.deepEqual(next.items.map(row => row.id), ['a', 'b']);
  assert.equal(appendReviewPage(next, data, 'one:day', 'page2'), next);
  assert.equal(appendReviewPage(current, data, 'two:day', 'page2'), current);
});
