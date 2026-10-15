import { useEffect } from 'react';

// Load the transmuxer only when H.264 streaming is needed; native playback stays light.
export default function useHlsSource(video, playback, onError) {
  useEffect(() => {
    const player = video.current;
    if (playback.format !== 'hls' || !playback.mediaUrl || !player) return;
    let disposed = false, hls, retryTimer, networkRetries = 0;
    import('hls.js').then(({ default: Hls }) => {
      if (disposed) return;
      if (Hls.isSupported()) {
        hls = new Hls({ startPosition: 0, maxBufferLength: 20, maxMaxBufferLength: 40, backBufferLength: 20, liveSyncDurationCount: 100000, maxLiveSyncPlaybackRate: 1 });
        hls.on(Hls.Events.LEVEL_LOADED, () => { networkRetries = 0; });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal && !disposed && data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 30) { clearTimeout(retryTimer); retryTimer = setTimeout(() => { if (!disposed) hls.startLoad(); }, 2000); return; }
          if (data.fatal && !disposed) onError(data.type === Hls.ErrorTypes.NETWORK_ERROR ? '流式播放连接中断，请重新连接。' : '浏览器无法解码 H.264 播放分片。');
        });
        hls.loadSource(playback.mediaUrl);
        hls.attachMedia(player);
      } else if (player.canPlayType('application/vnd.apple.mpegurl')) {
        player.src = playback.mediaUrl;
      } else onError('当前浏览器不支持流式回看，请使用支持 H.264/MSE 的浏览器。');
    }).catch(() => { if (!disposed) onError('流式播放器加载失败，请刷新页面。'); });
    return () => { disposed = true; clearTimeout(retryTimer); hls?.destroy(); };
  }, [playback.mediaUrl, playback.format]);
}
