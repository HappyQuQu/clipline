// Ask the decoder, rather than guessing from browser names or the NAS architecture.
export function preferredPlaybackMode(clip, canPlayType) {
  if (clip?.videoCodec !== 'hevc') return 'compatible';
  if (!canPlayType) return 'stream';
  const hevc = 'hvc1.1.6.L150.B0';
  if (!canPlayType(`video/mp4; codecs="${hevc},mp4a.40.2"`)) return 'stream';
  const audio = clip.audioCodec;
  if (audio == null || audio === 'aac' || audio === 'opus' && canPlayType(`video/mp4; codecs="${hevc},opus"`)) return 'original';
  return 'hevc';
}

export function fallbackPlaybackMode(mode) {
  return mode === 'original' ? 'hevc' : mode === 'hevc' || mode === 'compatible' ? 'stream' : null;
}

export function isDecoderFailure(error) {
  // A network interruption must not turn a direct stream into a costly transcode.
  return error?.code === 3 || error?.code === 4;
}
