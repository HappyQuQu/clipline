import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingDateLabel, recordingMoment } from '../src/recordingDates.js';

test('录像日期直接显示完整年月日', () => {
  assert.equal(recordingDateLabel('2026-10-15'), '2026年10月15日');
  assert.equal(recordingDateLabel('2026-06-02'), '2026年6月2日');
  assert.equal(recordingDateLabel(null), '日期未知');
});

test('跨午夜播放按录像真实时间与显示时区计算日期', () => {
  const clip = { startAt: '2026-10-14T15:59:58Z' };
  assert.deepEqual(recordingMoment(clip, 1, '', 'Asia/Shanghai'), { date: '2026-10-14', time: '23:59:59' });
  assert.deepEqual(recordingMoment(clip, 3, '', 'Asia/Shanghai'), { date: '2026-10-15', time: '00:00:01' });
  assert.deepEqual(recordingMoment(clip, 3, '', 'UTC'), { date: '2026-10-14', time: '16:00:01' });
});
