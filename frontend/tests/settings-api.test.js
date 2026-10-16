import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSettings, reconcileSettings, acceptSettings, groupValues } from '../src/api/settings.js';
const response = revision => ({ deployment: { timezone: 'Asia/Shanghai' }, defaults: { scan: { interval: 5, skipRecent: 30 }, playback: { autoNext: true, skipGaps: true }, export: { defaultMode: 'fast', maxDuration: 30 }, tasks: { concurrency: 2 } }, groups: { scan: { values: { interval: null, skipRecent: 60 }, revision }, playback: { values: { autoNext: false, skipGaps: true }, revision }, export: { values: { defaultMode: 'precise', maxDuration: 60 }, revision }, tasks: { values: { concurrency: 1 }, revision } } });
const state = () => ({ saved: initialSettings, draft: initialSettings, revisions: {}, draftRevisions: {} });
test('加载真实设置并转换仅手动扫描，保存仅序列化当前分类', () => {
  const next = reconcileSettings(state(), response(1));
  assert.equal(next.saved.interval, 'manual'); assert.equal(next.draft.defaultMode, 'precise');
  assert.deepEqual(groupValues('scan', next.draft), { interval: null, skipRecent: 60 });
  assert.deepEqual(groupValues('playback', next.draft), { autoNext: false, skipGaps: true, playbackMaxWidth: 1920 });
});
test('刷新服务端设置保留脏分类和原版本，干净分类随最新值更新', () => {
  const loaded = reconcileSettings(state(), response(1));
  loaded.draft = { ...loaded.draft, interval: '10', defaultMode: 'fast' };
  const changed = response(2); changed.groups.scan.values = { interval: 30, skipRecent: 120 };
  changed.groups.tasks.values.concurrency = 3;
  const next = reconcileSettings(loaded, changed);
  assert.equal(next.draft.interval, '10'); assert.equal(next.draft.skipRecent, '60');
  assert.equal(next.draftRevisions.scan, 1); assert.equal(next.saved.skipRecent, '120');
  assert.equal(next.draft.concurrency, '3'); assert.equal(next.draftRevisions.tasks, 2);
  assert.equal(next.draft.defaultMode, 'fast');
});
test('分类保存保留其他草稿，过时轮询响应不能覆盖保存结果', () => {
  const loaded = reconcileSettings(state(), response(1));
  loaded.draft = { ...loaded.draft, interval: '10', concurrency: '3' };
  const saved = acceptSettings(loaded, 'scan', { values: { interval: 10, skipRecent: 60 }, revision: 2 });
  assert.equal(saved.draft.concurrency, '3'); assert.equal(saved.saved.concurrency, '1');
  const stale = reconcileSettings(saved, response(1));
  assert.equal(stale.saved.interval, '10'); assert.equal(stale.draft.interval, '10');
  assert.equal(stale.revisions.scan, 2);
});
test('过时的保存回复不会覆盖更新版本的服务端值', () => {
  const loaded = reconcileSettings(state(), response(3));
  loaded.draft = { ...loaded.draft, interval: '10' };
  const saved = acceptSettings(loaded, 'scan', { values: { interval: 10, skipRecent: 60 }, revision: 2 });
  assert.equal(saved.saved.interval, 'manual'); assert.equal(saved.revisions.scan, 3);
  assert.equal(saved.draft.interval, '10'); assert.equal(saved.draftRevisions.scan, 2);
});

test('八项运行参数按分类序列化，时区草稿不会被轮询覆盖', () => {
  const reply = response(1);
  reply.groups.general = { values: { timezone: 'UTC', logRetentionDays: 7, playbackCacheMaxBytes: 1073741824 }, revision: 1 };
  const loaded = reconcileSettings(state(), reply);
  assert.equal(loaded.saved.timezone, 'UTC');
  loaded.draft = { ...loaded.draft, timezone: 'Asia/Tokyo', playbackMaxWidth: '1280', mediaThreads: '1', maxConcurrentTranscodes: '2', exportMaxWidth: '1920', exportTtlHours: '48' };
  const updated = { ...reply, deployment: { timezone: 'UTC' } };
  const next = reconcileSettings(loaded, updated);
  assert.equal(next.draft.timezone, 'Asia/Tokyo');
  assert.deepEqual(groupValues('general', next.draft), { timezone: 'Asia/Tokyo', logRetentionDays: 7, playbackCacheMaxBytes: 1073741824 });
  assert.deepEqual(groupValues('tasks', next.draft), { concurrency: 1, mediaThreads: 1, maxConcurrentTranscodes: 2 });
  assert.equal(groupValues('export', next.draft).exportTtlHours, 48);
  assert.equal(groupValues('export', next.draft).exportMaxWidth, 1920);
  assert.equal(groupValues('playback', next.draft).playbackMaxWidth, 1280);
  assert.equal(groupValues('tasks', { ...next.draft, mediaThreads: '' }).mediaThreads, null);
});
