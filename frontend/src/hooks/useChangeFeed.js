import { useEffect, useRef, useState } from 'react';
export default function useChangeFeed(onChange) {
  const callback = useRef(onChange); callback.current = onChange;
  const [status, setStatus] = useState('connecting');
  useEffect(() => {
    if (!window.EventSource) { setStatus('polling'); return; }
    let stream, timer, reconnect, lastId, disposed = false;
    const changed = event => { if (event?.lastEventId) lastId = event.lastEventId; clearTimeout(timer); timer = setTimeout(() => callback.current(), 200); };
    function connect() {
      if (disposed) return;
      stream = new EventSource(`/api/events${lastId ? `?after=${encodeURIComponent(lastId)}` : ''}`);
      stream.onopen = () => setStatus('live');
      stream.onmessage = changed;
      stream.addEventListener('reset', changed);
      stream.addEventListener('ready', changed);
      stream.onerror = () => { setStatus('polling'); if (stream.readyState === 2) { stream.close(); reconnect = setTimeout(connect, 5000); } };
    }
    connect();
    return () => { disposed = true; clearTimeout(timer); clearTimeout(reconnect); stream?.close(); };
  }, []);
  return status;
}
