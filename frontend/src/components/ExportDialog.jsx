import { createId } from '../id';
import { useEffect, useRef, useState } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import { Modal, Notice } from './UI';
import { queryString, request } from '../api/client';
import { exportRequest } from '../api/adapters';
import { duration } from '../domain';

export default function ExportDialog({ range, timezone, source, defaultMode = 'fast', onClose, onSubmitted }) {
  const [mode, setMode] = useState(defaultMode), [name, setName] = useState(`Clipline_${range.date}`);
  const [preview, setPreview] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const submission = useRef(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setPreview(null); setError('');
    const timer = setTimeout(async () => {
      try {
        const days = await Promise.all([...new Set([range.date, range.endDate || range.date])].map(date => request(`/timeline?${queryString({ sourceId: range.sourceId, date, viewTimezone: timezone, startSeconds: 0, endSeconds: 1, limit: 1 })}`, { signal: controller.signal })));
        const body = exportRequest(range, days[0], mode, name, timezone, days.at(-1));
        const plan = await request('/exports/plan', { method: 'POST', body, signal: controller.signal });
        if (!controller.signal.aborted) { setPreview({ plan, body }); setLoading(false); }
      } catch (failure) { if (failure.name !== 'AbortError') { setError(failure.message); setLoading(false); } }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [range, timezone, mode, name]);
  async function submit(event) {
    event.preventDefault(); if (!preview || loading || busy || !name.trim()) return;
    setBusy(true); setError('');
    const body = { ...preview.body, planHash: preview.plan.planHash };
    const encoded = JSON.stringify(body);
    if (submission.current?.encoded !== encoded) submission.current = { encoded, key: createId() };
    try { const result = await request('/exports', { method: 'POST', body, key: submission.current.key }); if (mounted.current) onSubmitted(result.taskId); }
    catch (failure) { if (mounted.current) { setError(failure.message); setBusy(false); } }
  }
  const format = at => new Date(at).toLocaleString('zh-CN', { timeZone: timezone, hour12: false });
  return <Modal title="导出录像" description="提交后在后台处理，可继续回看。完成后从任务中心下载。" onClose={onClose} busy={busy} form={{ onSubmit: submit }} footer={<><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={loading || !preview || busy || !name.trim()}><DownloadSimple size={17} />{busy ? '正在提交…' : '加入导出队列'}</button></>}>
      <p>{source?.name} · {range.date}{range.endDate && range.endDate !== range.date ? ` — ${range.endDate}` : ''}</p>
      <label className="field">导出文件名<input value={name} maxLength={100} required disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <label className="field">导出模式<select aria-label="导出模式" value={mode} disabled={busy} onChange={event => setMode(event.target.value)}><option value="fast">快速 · 保留原编码</option><option value="precise">精准 · 按区间重新编码</option></select></label>
      <Notice>{mode === 'fast' ? '按关键帧裁剪，边界和实际时长可能偏移；编码参数不兼容时可切换精准模式重试。' : '生成 H.264 / AAC 文件。边界精度为一个输出帧，耗时随录像长度增加。'}</Notice>
      {loading && <p role="status">正在核对真实录像区间…</p>}
      {preview && !loading && <section className="export-plan"><p>{format(preview.plan.startAt)} → {format(preview.plan.endAt)}</p><dl><div><dt>实际录像</dt><dd>{duration(preview.plan.selectedCoverageMs / 1000)}</dd></div><div><dt>包含片段</dt><dd>{preview.plan.pieceCount} 个</dd></div><div><dt>无录像断档</dt><dd>{duration(preview.plan.unrecordedMs / 1000)}</dd></div><div><dt>未选中录像</dt><dd>{duration(preview.plan.omittedMs / 1000)}</dd></div></dl><p className="muted">断档和未选中区间会跳过，拼接后连续播放。仅导出所选起止时间内的录像，单次最大 7 天。</p></section>}
      {error && <p className="form-error" role="alert">{error}</p>}
  </Modal>;
}
