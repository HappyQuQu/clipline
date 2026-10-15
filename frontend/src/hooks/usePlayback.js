import { createId } from '../id';
import { useEffect, useMemo, useState } from 'react';
import { request } from '../api/client';
import { fallbackPlaybackMode, preferredPlaybackMode } from '../playbackMode';
export default function usePlayback(clip, real) {
  const [state, setState] = useState({}), [retryRequest, setRetry] = useState({});
  const clipIdentity = `${clip?.id}:${clip?.fingerprint}`;
  const preferred = useMemo(() => {
    const decoder = typeof document === 'undefined' ? null : document.createElement('video');
    return preferredPlaybackMode(clip, decoder && (type => decoder.canPlayType(type)));
  }, [clip?.videoCodec, clip?.audioCodec]);
  const mode = retryRequest.identity === clipIdentity ? retryRequest.mode : preferred;
  const identity = `${clipIdentity}:${mode}`;
  const retry = retryRequest.identity === clipIdentity ? retryRequest.count : 0;
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
        const status = await request(`/segments/${clip.id}/playback?mode=${mode}`, { signal: controller.signal });
        failures = 0;
        if (controller.signal.aborted) return;
        if (status.status === 'needs_prepare' && (!status.taskId || retry)) {
          const queued = await request(`/segments/${clip.id}/prepare`, { method: 'POST', body: { mode }, key: createId(), signal: controller.signal });
          taskId = queued.taskId; setState({ identity, status: 'preparing', taskId, progress: 0 }); timer = setTimeout(check, 500);
        } else if (status.status === 'preparing') {
          taskId = status.taskId; timer = setTimeout(check, 500); setState({ identity, ...status, progress: 0 });
        } else { setState({ identity, ...status, message: status.errorMessage || (status.status === 'needs_prepare' ? '播放准备已取消，可重新提交。' : '') }); }
      } catch (error) { if (error.name === 'AbortError') return; if ((error.code === 'CONNECTION_FAILED' || error.status >= 500) && ++failures <= 15) { setState({ identity, status: taskId ? 'preparing' : 'loading', taskId, message: '服务正在恢复连接…' }); timer = setTimeout(check, 2000); } else setState({ identity, status: 'error', message: error.message }); }
    }
    // A retry of a browser-incompatible direct file forces the same background proxy flow.
    if (retry) request(retryTaskId ? `/tasks/${retryTaskId}/retry` : `/segments/${clip.id}/prepare`, { method: 'POST', body: retryTaskId ? {} : { force: true }, key: createId(), signal: controller.signal }).then(queued => { if (!controller.signal.aborted) { taskId = queued.taskId; check(); } }).catch(error => { if (error.name !== 'AbortError') setState({ identity, status: 'error', message: error.message }); });
    else check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [identity, real, retry]);
  useEffect(() => {
    if (!real || state.identity !== identity || !state.mediaUrl || !state.proxy) return;
    const clientId = createId(), abort = new AbortController(); let timer;
    const leaseUrl = `/segments/${clip.id}/lease?mode=${state.mode || mode}`;
    async function renew() {
      let delay = 5000;
      try { const result = await request(leaseUrl, { method: 'POST', body: { clientId }, signal: abort.signal }); delay = Math.max(250, Math.min(20000, (result.expiresInSeconds || 60) * 1000 / 3)); }
      catch (failure) { if (failure.name === 'AbortError') return; }
      if (!abort.signal.aborted) timer = setTimeout(renew, delay);
    }
    renew();
    return () => { abort.abort(); clearTimeout(timer); request(leaseUrl, { method: 'POST', body: { clientId, active: false } }).catch(() => {}); };
  }, [real, identity, state.mediaUrl, state.proxy]);
  return {
    ...(state.identity === identity ? state : { status: 'loading' }),
    retry: () => setRetry(value => ({ identity: clipIdentity, mode: 'compatible', count: value.identity === clipIdentity ? value.count + 1 : 1 })),
    fallback: () => {
      const next = fallbackPlaybackMode(state.mode || mode);
      if (!next) return false;
      setRetry({ identity: clipIdentity, mode: next, count: 0 });
      return true;
    },
  };
}
