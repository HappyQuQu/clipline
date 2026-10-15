import test from 'node:test';
import assert from 'node:assert/strict';
import { preferredPlaybackMode, fallbackPlaybackMode } from '../src/playbackMode.js';

const clip = { videoCodec: 'hevc', audioCodec: 'opus' };
test('支持 H.265 和原音轨时跳过整段转码', () => {
  assert.equal(preferredPlaybackMode(clip, () => 'probably'), 'original');
  for (const audioCodec of [null, 'aac']) assert.equal(preferredPlaybackMode({ ...clip, audioCodec }, () => 'probably'), 'original');
});
test('支持 H.265 但不支持 Opus 或其他原音轨时仅转换音频', () => {
  assert.equal(preferredPlaybackMode(clip, mime => mime.includes('opus') ? '' : 'probably'), 'hevc');
  assert.equal(preferredPlaybackMode({ ...clip, audioCodec: 'pcm_s16le' }, () => 'probably'), 'hevc');
});
test('不支持 H.265、缺少能力接口或普通 H.264 保持兼容路径', () => {
  assert.equal(preferredPlaybackMode(clip, () => ''), 'compatible');
  assert.equal(preferredPlaybackMode(clip, null), 'compatible');
  assert.equal(preferredPlaybackMode({ ...clip, videoCodec: 'h264' }, () => 'probably'), 'compatible');
});
test('解码器误报时自动逐级回退，每一级只尝试一次', () => {
  assert.equal(fallbackPlaybackMode('original'), 'hevc');
  assert.equal(fallbackPlaybackMode('hevc'), 'compatible');
  assert.equal(fallbackPlaybackMode('compatible'), null);
});
