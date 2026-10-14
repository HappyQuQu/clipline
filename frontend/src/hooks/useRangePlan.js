import { useEffect, useState } from 'react';
import { request } from '../api/client';
import { exportRequest } from '../api/adapters';

export default function useRangePlan({ enabled, sourceId, date, start, end, timezone, mode, timeline }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const dayStartAt = timeline?.dayStartAt, dayEndAt = timeline?.dayEndAt;
  const key = JSON.stringify([sourceId, date, start, end, timezone, mode, dayStartAt, dayEndAt, timeline?.indexedAt, attempt]);
  useEffect(() => {
    if (!enabled || !dayStartAt || !dayEndAt) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const body = exportRequest({ sourceId, date, start, end }, { dayStartAt, dayEndAt }, mode, `Clipline_${date}`, timezone);
        const plan = await request('/exports/plan', { method: 'POST', body, signal: controller.signal });
        if (!controller.signal.aborted) setResult({ key, plan });
      } catch (failure) {
        if (!controller.signal.aborted) setResult({ key, error: failure.message });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [enabled, key, sourceId, date, start, end, timezone, mode, dayStartAt, dayEndAt]);
  const current = enabled && result?.key === key ? result : null;
  return { plan: current?.plan, error: current?.error, loading: enabled && !current, retry: () => setAttempt(value => value + 1) };
}
