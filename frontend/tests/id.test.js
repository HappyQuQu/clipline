import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createId } from '../src/id.js';

test('安全上下文继续使用浏览器原生 UUID 方法，保留接收者绑定', () => {
  const native = { randomUUID() { assert.equal(this, native); return 'native-request-id'; } };
  assert.equal(createId(native), 'native-request-id');
});

test('局域网 HTTP 缺少 randomUUID 时仍可生成独立的 UUIDv4 请求和播放租约标识', () => {
  const httpCrypto = { getRandomValues: array => webcrypto.getRandomValues(array) };
  const ids = Array.from({ length: 1000 }, () => createId(httpCrypto));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
