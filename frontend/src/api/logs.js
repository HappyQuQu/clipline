import { bytes } from './adapters.js';
export function logSummary(row) {
  const detail = row.detail || {};
  if (detail.message) return detail.message;
  if (detail.result?.actualDurationMs != null) return `目标 ${detail.result.expectedDurationMs / 1000} 秒 · 实际 ${detail.result.actualDurationMs / 1000} 秒 · ${bytes(detail.result.sizeBytes)} · ${detail.result.mode === 'precise' ? '精准导出' : '保留视频编码'}`;
  if (detail.result?.processed != null) return `已检查 ${detail.result.processed} 个文件 · 新增 ${detail.result.added || 0} · 更新 ${detail.result.updated || 0} · 复用 ${detail.result.unchanged || 0} · 异常 ${detail.result.failed || 0}`;
  if (detail.group) { const names = { scan: '扫描与索引', playback: '录像回看', export: '录像导出', tasks: '后台任务' }; return `${names[detail.group] || '设置'}已更新，保存后在相关操作中生效。`; }
  if (detail.removedFiles != null) return `清理 ${detail.removedFiles} 个应用文件 · 释放 ${bytes(detail.removedBytes || 0)} · 到期导出 ${detail.expiredExports || 0} 个 · 播放缓存 ${detail.evictedPlayback || 0} 个`;
  if (detail.stage) { const stages = { discover: '遍历录像目录', probe: '读取媒体信息', index: '更新录像索引', finalize: '完成索引处理', validate: '检查输入文件', cut: '快速裁剪', transcode: row.kind === 'export' ? '精准裁剪' : '生成兼容播放版本', concat: '按时间顺序拼接片段', verify: '校验输出文件', publish: '登记已验证结果' }; return stages[detail.stage] || '更新处理阶段'; }
  if (detail.expectedDurationMs != null) return `${detail.mode === 'precise' ? '精准导出' : '快速导出'} · 计划 ${detail.expectedDurationMs / 1000} 秒 · 已加入后台队列`;
  if (detail.changedFields) return '录像源配置已更新，之后的相关操作使用新配置。';
  if (detail.errorCode) return `处理异常：${detail.errorCode}${detail.relativePath ? ` · ${detail.relativePath.split('/').pop()}` : ''}`;
  if (detail.name) return `新增录像源：${detail.name}`;
  if (detail.trigger) return detail.trigger === 'scheduled' ? '按录像源频率自动提交扫描' : '已提交后台队列';
  if (detail.status) { const statuses = { queued: '任务正在排队', running: '任务开始处理', cancelling: '已请求取消，等待处理停止', cancelled: '任务已取消', completed: '任务已完成', failed: '任务失败，请查看详细记录' }; return statuses[detail.status] || '任务状态已更新'; }
  if (detail.retryOfTaskId) return '已创建新的重试任务，原任务历史保留。';
  return '查看详情了解本次操作。';
}
