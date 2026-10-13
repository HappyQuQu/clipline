export class ApiError extends Error {
  constructor(message, code, requestId, status, details) { super(message); this.code = code; this.requestId = requestId; this.status = status; this.details = details; }
}
export function queryString(values) {
  return new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== '')).toString();
}
export async function request(path, { method = 'GET', body, signal, key } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, { method, signal, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('无法连接服务，请检查后端是否启动。', 'CONNECTION_FAILED');
  }
  let data;
  try { data = await response.json(); } catch { throw new ApiError('服务返回了无效响应，请检查服务连接。', 'INVALID_RESPONSE', response.headers?.get?.('X-Request-ID'), response.status); }
  if (!response.ok) throw new ApiError(data.error?.message || '请求失败，请重新尝试。', data.error?.code, data.error?.requestId, response.status, data.error?.details);
  return data;
}
export async function pages(path, params = {}, signal) {
  const items = []; let cursor;
  do {
    const page = await request(`${path}?${queryString({ ...params, cursor, limit: 200 })}`, { signal });
    items.push(...page.items); cursor = page.nextCursor;
  } while (cursor);
  return items;
}

export async function downloadJson(path, params, filename) {
  const href = `/api${path}?${queryString(params)}`;
  const response = await fetch(href, { method: 'HEAD' });
  if (!response.ok) {
    const data = await response.json();
    throw new ApiError(data.error?.message || '下载失败，请刷新后重试。', data.error?.code, data.error?.requestId, response.status);
  }
  const link = document.createElement('a'); link.href = href; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
}
