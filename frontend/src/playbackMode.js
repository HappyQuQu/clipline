// Ask the decoder, rather than guessing from browser names or the NAS architecture.
export function preferredPlaybackMode(clip, canPlayType) {
  if (clip?.videoCodec !== 'hevc' || !canPlayType) return 'compatible';
  const hevc = 'hvc1.1.6.L150.B0';
  if (!canPlayType(`video/mp4; codecs="${hevc},mp4a.40.2"`)) return 'compatible';
  const audio = clip.audioCodec;
  if (audio == null || audio === 'aac' || audio === 'opus' && canPlayType(`video/mp4; codecs="${hevc},opus"`)) return 'original';
  return 'hevc';
}

export function fallbackPlaybackMode(mode) {
  return mode === 'original' ? 'hevc' : mode === 'hevc' ? 'compatible' : null;
}
