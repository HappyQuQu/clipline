export const DEMO_DATE = '2026-10-13';
export const SETTINGS_FIELDS = Object.freeze({
  scan: ['interval', 'skipRecent'],
  playback: ['autoNext', 'skipGaps'],
  export: ['defaultMode', 'maxDuration'],
  tasks: ['concurrency'],
});
export function mergeSettingsGroup(base, values, group) {
  const fields = SETTINGS_FIELDS[group];
  if (!fields) throw new Error('Unknown settings group');
  return { ...base, ...Object.fromEntries(fields.map(field => [field, values[field]])) };
}
export function validateSourcePath(value, sources, excludedId) {
  const path = value.trim().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (!path) return { path, error: '请选择录像目录，或手动输入路径。' };
  if (!path.startsWith('/recordings/') || path.split('/').some(part => part === '..' || part === '.') || /[\\\u0000-\u001f]/.test(path)) return { path, error: '请使用 /recordings/ 下的文件夹，例如 /recordings/living-room。' };
  const duplicate = sources.find(source => source.id !== excludedId && source.path.replace(/\/{2,}/g, '/').replace(/\/+$/, '') === path);
  if (duplicate) return { path, error: `此目录已添加为「${duplicate.name}」，请使用其他目录。` };
  const overlaps = sources.filter(source => source.id !== excludedId).flatMap(source => {
    const existing = source.path.trim().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    const relation = path.startsWith(`${existing}/`) ? 'inside' : existing.startsWith(`${path}/`) ? 'contains' : null;
    return relation ? [{ id: source.id, name: source.name, path: existing, relation }] : [];
  });
  return { path, error: '', overlaps };
}
export const TASK_TYPES = Object.freeze({
  scan: { label: '目录扫描', description: '发现新录像，读取文件信息、建立索引并生成缩略图。', stages: ['遍历录像目录', '读取文件信息', '更新索引与缩略图'], complete: '扫描演示完成；示例片段未增加' },
  export: { label: '录像导出', description: '裁剪、跨片段拼接和必要的转码，在回看或片段库提交。', stages: ['检查录像区间', '裁剪与拼接录像', '准备下载文件'], complete: '导出演示完成，可下载 60 秒示例视频' },
  reindex: { label: '索引重建', description: '重新校验文件信息与时间索引，用于修复遗漏或异常。', stages: ['校验已索引文件', '重新读取录像信息', '重建时间索引'], complete: '索引重建演示完成；示例索引保持原样' },
  prepare: { label: '播放准备', description: '为不兼容的录像准备可播放版本，并补齐预览缩略图。', stages: ['检查播放兼容性', '生成可播放版本与缩略图', '准备预览缓存'], complete: '播放准备演示完成；未执行真实转码' },
});
export function taskStage(task) {
  const stages = TASK_TYPES[task.kind]?.stages;
  if (task.status === 'queued') return '等待空闲处理资源';
  if (task.status !== 'running' || !stages) return '';
  return stages[Math.min(2, Math.floor((task.progress || 0) / 34))];
}
export const seconds = (value) => value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
export function clock(value) {
  const safe = Math.max(0, Math.min(86399, Math.floor(value)));
  return [Math.floor(safe / 3600), Math.floor(safe / 60) % 60, safe % 60].map(n => String(n).padStart(2, '0')).join(':');
}
export function duration(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}
export function summarizeRange(clips, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { valid: false, message: '结束时间需要晚于开始时间。', coverage: 0, gap: 0, clips: [] };
  const intersecting = clips.filter(c => c.start < end && c.end > start).sort((a, b) => a.start - b.start);
  let covered = 0, cursor = start;
  for (const clip of intersecting) {
    const from = Math.max(cursor, start, clip.start), to = Math.min(end, clip.end);
    if (to > from) covered += to - from;
    cursor = Math.max(cursor, to);
  }
  return { valid: covered > 0, message: covered ? '' : '所选区间没有录像，请调整起止时间。', coverage: covered, gap: end - start - covered, clips: intersecting };
}

export const initialSources = [
  { id: 'studio', name: '工作室', description: '小米摄像机 · NAS 备份', path: '/recordings/studio', enabled: true, status: 'online', image: '/assets/studio.jpg', count: 123, size: '8.4 GB', lastScan: '今天 09:42', interval: '5', color: 'blue' },
  { id: 'door', name: '家门口', description: '室外摄像机 · NAS 备份', path: '/recordings/front-door', enabled: true, status: 'online', image: '/assets/front-door.jpg', count: 86, size: '6.1 GB', lastScan: '今天 09:40', interval: '10', color: 'blue' },
  { id: 'garage', name: '车库', description: '停车监控 · 本地目录', path: '/recordings/garage', enabled: false, status: 'paused', image: '/assets/front-door-vehicle.jpg', count: 42, size: '3.2 GB', lastScan: '昨天 22:15', interval: 'manual', color: 'amber' },
].map(source => ({ ...source, autoTranscribe: false, autoDetect: false }));
const base = seconds('09:14:12');
export const demoClips = [DEMO_DATE, '2026-10-12'].flatMap(date => ['studio', 'door', 'garage'].flatMap(sourceId => Array.from({ length: 6 }, (_, index) => {
  const start = base + index * 60 + (index >= 3 ? 18 : 0);
  return {
    id: `${sourceId}-${date}-${index}`, sourceId, date, start, end: start + 60, index,
    filename: `${sourceId}_${date.replaceAll('-', '')}_${clock(start).replaceAll(':', '')}.mp4`,
    image: sourceId === 'studio' ? `/assets/studio-${index}.jpg` : ['/assets/front-door.jpg', '/assets/front-door-person.jpg', '/assets/front-door-vehicle.jpg'][index % 3],
    media: sourceId === 'studio' ? '/assets/studio-demo.mp4' : null,
    size: `${(8.2 + index * 0.7).toFixed(1)} MB`, codec: sourceId === 'garage' ? 'H.265' : 'H.264', resolution: '1920 × 1080',
  };
})));

export const initialTasks = [
  { id: 'demo-export', kind: 'export', title: '工作室 · 上午录像', sourceId: 'studio', status: 'completed', progress: 100, mode: 'precise', created: '今天 09:38', date: DEMO_DATE, start: base, end: base + 120, demo: true },
  { id: 'demo-scan', kind: 'scan', title: '家门口 · 目录扫描', sourceId: 'door', status: 'completed', progress: 100, created: '今天 09:40', demo: true },
  { id: 'demo-failed', kind: 'export', title: '车库 · 停车录像', sourceId: 'garage', status: 'failed', progress: 0, mode: 'fast', created: '昨天 22:18', error: '原始录像编码不支持快速拼接，请改用精准模式。', date: '2026-10-12', start: base, end: base + 60, demo: true },
];
export const initialLogs = [
  { id: 'log-1', time: '今天 09:40', kind: 'scan', title: '家门口扫描完成', detail: '86 个文件已建立索引，无新增文件', sourceId: 'door' },
  { id: 'log-2', time: '今天 09:38', kind: 'export', title: '工作室导出完成', detail: '精准模式 · 2 个片段 · 02:00', sourceId: 'studio' },
  { id: 'log-3', time: '今天 09:42', kind: 'scan', title: '工作室扫描完成', detail: '123 个文件已建立索引，跳过 1 个正在写入的文件', sourceId: 'studio' },
];

export const nowLabel = () => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).format(new Date());
export function readSaved(key, fallback) {
  try {
    const data = JSON.parse(localStorage.getItem(`clipline-v1-${key}`));
    if (Array.isArray(fallback)) {
      if (!Array.isArray(data) || (key === 'sources' && !data.length) || !data.every(item => item && typeof item.id === 'string')) return fallback;
      // Keep persisted user configuration while updating bundled demo asset paths.
      return key === 'sources' ? data.map(item => ({ autoTranscribe: false, autoDetect: false, ...item, image: fallback.find(source => source.id === item.id)?.image || item.image })) : data;
    }
    return data && !Array.isArray(data) && typeof data === 'object' ? { ...fallback, ...data } : fallback;
  }
  catch { return fallback; }
}
