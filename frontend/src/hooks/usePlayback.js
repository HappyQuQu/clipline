import { createId } from '../id';
import { useEffect, useMemo, useState } from 'react';
import { request } from '../api/client';
import { fallbackPlaybackMode, isDecoderFailure, preferredPlaybackMode } from '../playbackMode';

export default function usePlayback(clip, real, initialOffset = 0) {
  const [state, setState] = useState({}), [choice, setChoice] = useState({});
  const clipIdentity = `${clip?.id}:${clip?.fingerprint}`;
  const preferred = useMemo(() => {
    const decoder = typeof document === 'undefined' ? null : document.createElement('video');
    return preferredPlaybackMode(clip, decoder && (type => decoder.canPlayType(type)));
  }, [clip?.videoCodec, clip?.audioCodec]);
  const mode = choice.identity === clipIdentity ? choice.mode : preferred;
  const startMs = mode === 'stream' ? Math.floor(Math.max(0, choice.identity === clipIdentity ? choice.offset || 0 : initialOffset) / 4) * 4000 : 0;
  const retry = choice.identity === clipIdentity ? choice.retry || 0 : 0;
  const identity = `${clipIdentity}:${mode}:${startMs}:${retry}`;
  useEffect(() => {
    if (!real || !clip) return;
    const abort = new AbortController(); let timer, taskId = null, failures = 0;
    setState({ identity, status: 'loading', mode, startMs });
    async function check() {
      try {
        const status = await request(`/segments/${clip.id}/playback?mode=${mode}&startMs=${startMs}`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        failures = 0;
        if (status.status === 'needs_prepare' && !status.taskId) {
          const queued = await request(`/segments/${clip.id}/prepare`, { method: 'POST', body: { mode, startMs }, key: createId(), signal: abort.signal });
          if (abort.signal.aborted) return;
          taskId = queued.taskId;
          setState({ identity, ...status, status: 'preparing', taskId, progress: 0 });
          timer = setTimeout(check, 250);
        } else {
          taskId = status.taskId;
          let progress = status.progress;
          if (status.status === 'preparing' && mode !== 'stream' && taskId) {
            const task = await request(`/tasks/${taskId}`, { signal: abort.signal });
            if (task.status === 'completed') { timer = setTimeout(check, 100); return; }
            if (['failed', 'cancelled'].includes(task.status)) { setState({ identity, ...status, status: task.status, message: task.errorMessage || '播放准备已停止，请重新连接。' }); return; }
            progress = task.progress;
          }
          if (!abort.signal.aborted) setState({ identity, ...status, progress, message: status.errorMessage || (status.status === 'cancelled' ? '播放准备已取消，可重新连接。' : '') });
          if (['preparing', 'streaming'].includes(status.status)) timer = setTimeout(check, mode === 'stream' ? 500 : 1000);
        }
      } catch (failure) {
        if (failure.name === 'AbortError') return;
        if ((failure.code === 'CONNECTION_FAILED' || failure.status >= 500) && ++failures <= 30) {
          setState(value => value.identity === identity ? { ...value, message: '服务正在恢复连接…' } : { identity, status: 'loading', mode, startMs });
          timer = setTimeout(check, 1000);
        } else setState({ identity, status: 'error', message: failure.message });
      }
    }
    if (retry) request(`/segments/${clip.id}/prepare`, { method: 'POST', body: { mode, startMs, force: mode !== 'stream' }, key: createId(), signal: abort.signal }).then(queued => { if (!abort.signal.aborted) { taskId = queued.taskId; check(); } }).catch(failure => { if (failure.name !== 'AbortError') setState({ identity, status: 'error', message: failure.message }); });
    else check();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [identity, real]);
  const leaseIdentity = state.identity === identity && !["failed", "cancelled", "error"].includes(state.status) ? mode === "stream" && state.taskId ? `hls:${state.taskId}` : state.mediaUrl && state.proxy ? `file:${state.mediaUrl}` : null : null;
  useEffect(() => {
    if (!real || !leaseIdentity) return;
    const stream = mode === 'stream' && state.taskId;
    if (!stream && (!state.mediaUrl || !state.proxy)) return;
    const clientId = createId(), abort = new AbortController(); let timer;
    const url = stream ? `/segments/${clip.id}/hls/${state.taskId}/lease` : `/segments/${clip.id}/lease?mode=${state.mode || mode}`;
    async function renew() {
      let delay = 2000;
      try { const result = await request(url, { method: 'POST', body: { clientId }, signal: abort.signal }); delay = Math.max(250, Math.min(5000, (result.expiresInSeconds || 20) * 1000 / 3)); }
      catch (failure) { if (failure.name === 'AbortError') return; }
      if (!abort.signal.aborted) timer = setTimeout(renew, delay);
    }
    renew();
    return () => { abort.abort(); clearTimeout(timer); request(url, { method: 'POST', body: { clientId, active: false } }).catch(() => {}); };
  }, [real, identity, leaseIdentity]);
  const current = state.identity === identity ? state : { status: 'loading', mode, startMs };
  return {
    ...current,
    retry: (offset = 0) => setChoice(value => ({ identity: clipIdentity, mode: 'stream', offset, retry: (value.retry || 0) + 1 })),
    seek: offset => {
      if (current.format !== 'hls' || offset >= current.startMs / 1000 && offset < (current.startMs + (current.availableMs || 0)) / 1000 - .1) return false;
      setChoice({ identity: clipIdentity, mode: 'stream', offset });
      return true;
    },
    fallback: (error, offset = 0) => {
      if (!isDecoderFailure(error)) return false;
      const next = fallbackPlaybackMode(state.mode || mode);
      if (!next) return false;
      setChoice({ identity: clipIdentity, mode: next, offset });
      return true;
    },
  };
}
