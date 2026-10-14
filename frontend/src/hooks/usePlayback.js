import { useEffect, useState } from 'react';
import { request } from '../api/client';
export default function usePlayback(clip, real) {
  const [state, setState] = useState({}), [retryRequest, setRetry] = useState({});
  const identity = `${clip?.id}:${clip?.fingerprint}`;
  const retry = retryRequest.identity === identity ? retryRequest.count : 0;
  useEffect(() => {
    if (!real || !clip) return;
    const retryTaskId = state.identity === identity && state.taskId && ['failed', 'cancelled', 'needs_prepare'].includes(state.status) ? state.taskId : null;
    const controller = new AbortController(); let timer; let taskId = null; let failures = 0;
    setState({ identity, status: 'loading' });
    async function check() {
      try {
        if (taskId) {
          const task = await request(`/tasks/${taskId}`, { signal: controller.signal });
          failures = 0;
          if (['queued', 'running', 'cancelling'].includes(task.status)) { if (!controller.signal.aborted) setState({ identity, status: 'preparing', taskId, progress: task.progress }); timer = setTimeout(check, 1500); return; }
          if (task.status !== 'completed') { if (!controller.signal.aborted) setState({ identity, status: task.status, taskId, message: task.errorMessage || (task.status === 'cancelled' ? '播放准备已取消，可重新提交。' : '播放准备失败，可重试并查看任务日志。') }); return; }
          taskId = null;
        }
        const status = await request(`/segments/${clip.id}/playback`, { signal: controller.signal });
        failures = 0;
        if (controller.signal.aborted) return;
        if (status.status === 'needs_prepare' && (!status.taskId || retry)) {
          const queued = await request(`/segments/${clip.id}/prepare`, { method: 'POST', body: {}, key: crypto.randomUUID(), signal: controller.signal });
          taskId = queued.taskId; setState({ identity, status: 'preparing', taskId, progress: 0 }); timer = setTimeout(check, 500);
        } else if (status.status === 'preparing') {
          taskId = status.taskId; timer = setTimeout(check, 500); setState({ identity, ...status, progress: 0 });
        } else { setState({ identity, ...status, message: status.errorMessage || (status.status === 'needs_prepare' ? '播放准备已取消，可重新提交。' : '') }); }
      } catch (error) { if (error.name === 'AbortError') return; if ((error.code === 'CONNECTION_FAILED' || error.status >= 500) && ++failures <= 15) { setState({ identity, status: taskId ? 'preparing' : 'loading', taskId, message: '服务正在恢复连接…' }); timer = setTimeout(check, 2000); } else setState({ identity, status: 'error', message: error.message }); }
    }
    // A retry of a browser-incompatible direct file forces the same background proxy flow.
    if (retry) request(retryTaskId ? `/tasks/${retryTaskId}/retry` : `/segments/${clip.id}/prepare`, { method: 'POST', body: retryTaskId ? {} : { force: true }, key: crypto.randomUUID(), signal: controller.signal }).then(queued => { if (!controller.signal.aborted) { taskId = queued.taskId; check(); } }).catch(error => { if (error.name !== 'AbortError') setState({ identity, status: 'error', message: error.message }); });
    else check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [identity, real, retry]);
  useEffect(() => {
    if (!real || state.identity !== identity || !state.mediaUrl || !state.proxy) return;
    const clientId = crypto.randomUUID(), abort = new AbortController(); let timer;
    async function renew() {
      let delay = 5000;
      try { const result = await request(`/segments/${clip.id}/lease`, { method: 'POST', body: { clientId }, signal: abort.signal }); delay = Math.max(250, Math.min(20000, (result.expiresInSeconds || 60) * 1000 / 3)); }
      catch (failure) { if (failure.name === 'AbortError') return; }
      if (!abort.signal.aborted) timer = setTimeout(renew, delay);
    }
    renew();
    return () => { abort.abort(); clearTimeout(timer); request(`/segments/${clip.id}/lease`, { method: 'POST', body: { clientId, active: false } }).catch(() => {}); };
  }, [real, identity, state.mediaUrl, state.proxy]);
  return { ...(state.identity === identity ? state : { status: 'loading' }), retry: () => setRetry(value => ({ identity, count: value.identity === identity ? value.count + 1 : 1 })) };
}
