import { useEffect, useState } from 'react';
import { parseRecordingTime, recordingTime } from '../recordingSelection';

// A text clock also supports 24:00:00, which native time inputs cannot represent.
export default function RecordingTimeInput({ value, label, valid, onCommit, onValidityChange }) {
  const [draft, setDraft] = useState(recordingTime(value));
  const [error, setError] = useState(false);
  useEffect(() => { setDraft(recordingTime(value)); setError(false); onValidityChange(true); }, [value]);
  function commit() {
    const parsed = parseRecordingTime(draft);
    if (!Number.isFinite(parsed)) { setError(true); onValidityChange(false); return; }
    setError(false); setDraft(recordingTime(parsed)); onCommit(parsed); onValidityChange(true);
  }
  return <input type="text" className="recording-time-input" value={draft} aria-label={label} aria-invalid={error || !valid} title={error ? '请输入 HH:MM:SS，结束时间可填 24:00:00' : 'HH:MM:SS，按回车确认'} placeholder="HH:MM:SS" maxLength={8} spellCheck={false} autoComplete="off" data-1p-ignore="true" onChange={event => { setDraft(event.target.value); setError(false); onValidityChange(false); }} onBlur={commit} onKeyDown={event => {
    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
    if (event.key === 'Escape') { setDraft(recordingTime(value)); setError(false); onValidityChange(true); }
  }} />;
}
