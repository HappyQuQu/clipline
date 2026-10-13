import type { Transcription } from '../../types'

export function SubtitleOverlay({
  transcriptions,
  currentTime,
}: {
  transcriptions: Transcription[]
  currentTime: number
}) {
  const currentSubtitle = transcriptions.find(
    (t) => currentTime >= t.startTime && currentTime <= t.endTime
  )

  if (!currentSubtitle) return null

  return (
    <div className="subtitleOverlay">
      <span className="subtitleText">{currentSubtitle.text}</span>
    </div>
  )
}
