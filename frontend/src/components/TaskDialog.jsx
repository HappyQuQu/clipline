import { useRef, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { Modal } from './UI';

export default function TaskDialog({ source, kind, setKind, onClose, onSubmit }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (pending.current || !source?.enabled) return;
    pending.current = true; setBusy(true); setError('');
    try { await onSubmit({ sourceId: source.id, kind }); }
    catch (failure) { setError(failure.message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Modal title="新建后台任务" description="任务在后台处理，你可以继续操作，在任务中心查看结果。" onClose={onClose} busy={busy} form={{ onSubmit: submit }} footer={<><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy || !source?.enabled}><Plus size={17} />{busy ? '正在提交…' : '加入后台队列'}</button></>}>
    <label className="field">任务类型<select aria-label="后台任务类型" value={kind} onChange={event => setKind(event.target.value)}><option value="scan">目录扫描</option><option value="reindex">索引重建</option></select></label>
    <p>当前录像源：{source?.name || '请先选择录像源'}</p>
    <p className="background-task-description">{kind === 'scan' ? '扫描新增和变化的文件，更新录像时间轴。' : '重新读取录像文件信息，重建这个源的索引。'}</p>
    <p className="muted">播放准备从回看自动提交；录像导出从回看或片段库提交。</p>
    {error && <p className="form-error" role="alert">{error}</p>}
  </Modal>;
}
