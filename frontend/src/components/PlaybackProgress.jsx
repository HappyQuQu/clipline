import { useRef, useState } from 'react';

export default function PlaybackProgress({ min, max, value, disabled, onSeek }) {
  const dragging = useRef(false);
  const pending = useRef(value);
  const [draft, setDraft] = useState(null);

  function commit() {
    if (!dragging.current) return;
    dragging.current = false;
    setDraft(null);
    onSeek(pending.current);
  }

  function cancel() {
    dragging.current = false;
    setDraft(null);
  }

  return <input type="range" min={min} max={max} step="0.1" value={draft ?? value} aria-label="片段播放进度" disabled={disabled}
    onPointerDown={event => {
      if (event.button !== 0) return;
      dragging.current = true;
      pending.current = Number(event.currentTarget.value);
      setDraft(pending.current);
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onChange={event => {
      pending.current = Number(event.target.value);
      // Keep the native thumb enabled throughout a drag. Starting HLS preparation
      // on an intermediate input event would disable it before the pointer arrives.
      if (dragging.current) setDraft(pending.current);
      else onSeek(pending.current);
    }}
    onPointerUp={commit} onPointerCancel={cancel} onLostPointerCapture={commit} onBlur={commit}
  />;
}
