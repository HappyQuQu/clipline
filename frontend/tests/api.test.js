import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, pages, queryString, request } from '../src/api/client.js';
import { clipView, sourceView, reviewContext } from '../src/api/adapters.js';

test('跨日片段保留原始 UTC 与定位偏移，不把前一天误当零点', () => {
  const row = { id: 'clip', sourceId: 'one', startAt: '2026-06-01T15:42:00Z', endAt: '2026-06-01T16:04:56Z', durationMs: 1376000, sizeBytes: 1024, videoCodec: 'hevc', availability: 'available' };
  const clip = clipView(row, '2026-06-01T16:00:00Z');
  assert.equal(clip.start, -1080); assert.equal(clip.end, 296);
  assert.equal(clip.startLabel, '23:42:00'); assert.equal(clip.date, '2026-06-01'); assert.equal(clip.endDate, '2026-06-02');
  assert.equal(clip.media, null); assert.equal(clip.codec, 'H.265'); assert.equal(clip.real, true);
});
test('空源和异常文件不会引入任何示例画面或播放地址', () => {
  const source = sourceView({ id: 'empty', segmentCount: 0, totalBytes: 0, scanIntervalMinutes: null });
  assert.equal(source.count, 0); assert.equal(source.interval, 'manual'); assert.match(source.image, /placeholder/);
  const invalid = clipView({ id: 'bad', startAt: null, endAt: null, durationMs: null, sizeBytes: 0 });
  assert.equal(invalid.startLabel, '—'); assert.equal(invalid.date, ''); assert.equal(invalid.media, null);
});
test('API 错误保留请求标识，网络失败不会返回演示数据', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: { code: 'RECORDING_CHANGED', message: '录像已变化', requestId: 'trace' } }) });
    await assert.rejects(request('/test'), error => error instanceof ApiError && error.code === 'RECORDING_CHANGED' && error.requestId === 'trace');
    globalThis.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(request('/test'), error => error.code === 'CONNECTION_FAILED');
    globalThis.fetch = async () => { const error = new Error(); error.name = 'AbortError'; throw error; };
    await assert.rejects(request('/test'), { name: 'AbortError' });
  } finally { globalThis.fetch = original; }
});
test('列表沿服务器游标读取，查询字符安全编码', async () => {
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async url => { calls++; if (calls === 2) assert.match(url, /cursor=next/); return { ok: true, json: async () => ({ items: [calls], nextCursor: calls === 1 ? 'next' : null }) }; };
    assert.deepEqual(await pages('/segments', { q: '09：15 &入口' }), [1, 2]);
    assert.equal(new URLSearchParams(queryString({ q: '09：15 &入口', sourceId: undefined })).get('q'), '09：15 &入口');
  } finally { globalThis.fetch = original; }
});

test('响应正文读取中止不误报连接异常，真正无效 JSON 仍报告错误', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => { throw new DOMException('Aborted', 'AbortError'); } });
    await assert.rejects(request('/tasks'), { name: 'AbortError' });
    const controller = new AbortController();
    globalThis.fetch = async () => ({ ok: true, json: async () => { controller.abort(); throw new SyntaxError('Partial JSON'); } });
    await assert.rejects(request('/tasks', { signal: controller.signal }), { name: 'AbortError' });
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Bad JSON'); } });
    await assert.rejects(request('/tasks'), error => error.code === 'INVALID_RESPONSE');
  } finally { globalThis.fetch = original; }
});

test('快速切换后返回相同源与日期，也使用新的回看上下文隔离旧请求', () => {
  const first = { sourceId: 'one', date: '2026-06-02', generation: 1, offset: 0 };
  assert.notEqual(reviewContext(first), reviewContext({ ...first, generation: 3 }));
  assert.equal(reviewContext(first), reviewContext({ ...first, offset: 120 }));
});

// Server day boundaries also handle cross-midnight files and daylight-saving days.
test('导出区间按服务端日期边界裁剪，选中 ID 和 UTC 精度保留', async () => {
  const { exportRequest } = await import('../src/api/adapters.js');
  const day = { dayStartAt: '2026-06-01T16:00:00Z', dayEndAt: '2026-06-02T16:00:00Z' };
  const result = exportRequest({ sourceId: 'one', date: '2026-06-02', startAt: '2026-06-01T15:42:00Z', endAt: '2026-06-01T16:04:56.123Z', clipIds: ['a'] }, day, 'precise', 'file', 'Asia/Shanghai');
  assert.equal(result.startAt, '2026-06-01T16:00:00.000Z');
  assert.equal(result.endAt, '2026-06-01T16:04:56.123Z');
  assert.deepEqual(result.segmentIds, ['a']);
  const fall = exportRequest({ sourceId: 'one', date: '2026-11-01', start: 89000, end: 91000 }, { dayStartAt: '2026-11-01T04:00:00Z', dayEndAt: '2026-11-02T05:00:00Z' }, 'fast', 'file', 'America/New_York');
  assert.equal(fall.endAt, '2026-11-02T05:00:00.000Z');
});
