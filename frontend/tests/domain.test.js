import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRange, demoClips, DEMO_DATE, validateSourcePath, mergeSettingsGroup } from '../src/domain.js';
import { createExtensionRegistry, PHASE_ONE_CAPABILITIES } from '../src/capabilities.js';

const clips = demoClips.filter(c => c.sourceId === 'studio' && c.date === DEMO_DATE);
test('保存一个设置分类时不带入其他分类未保存的值', () => {
  const saved = { interval: '5', skipRecent: '30', concurrency: '2', defaultMode: 'fast', maxDuration: '30', autoNext: true, skipGaps: true };
  const draft = { ...saved, interval: '10', concurrency: '1' };
  const result = mergeSettingsGroup(saved, draft, 'tasks');
  assert.equal(result.concurrency, '1');
  assert.equal(result.interval, '5');
  assert.equal(saved.concurrency, '2');
});
test('恢复一个分类默认值时保留其他分类草稿，拒绝未知分类', () => {
  const draft = { interval: '30', skipRecent: '120', concurrency: '3', defaultMode: 'precise', maxDuration: '60' };
  const result = mergeSettingsGroup(draft, { defaultMode: 'fast', maxDuration: '30' }, 'export');
  assert.equal(result.defaultMode, 'fast');
  assert.equal(result.maxDuration, '30');
  assert.equal(result.interval, '30');
  assert.equal(result.concurrency, '3');
  assert.throws(() => mergeSettingsGroup(draft, {}, 'all'));
});
test('录像源路径归一化后仍可识别重复目录，编辑自身目录不报重复', () => {
  const sources = [{ id: 'existing', name: '工作室', path: '/recordings/studio/' }];
  const duplicate = validateSourcePath(' /recordings//studio/// ', sources);
  assert.equal(duplicate.path, '/recordings/studio');
  assert.match(duplicate.error, /工作室/);
  assert.equal(validateSourcePath('/recordings/studio/', sources, 'existing').error, '');
});
test('录像源路径拒绝根目录、越界、相对路径与控制字符', () => {
  for (const path of ['', '/recordings', '/recordings/../other', '/recordings/a/./b', '/elsewhere/video', 'C:\\NAS\\video', '/recordings/a\nb']) {
    assert.notEqual(validateSourcePath(path, []).error, '', path);
  }
});
test('录像源允许正常嵌套目录和包含连续点号的文件夹名称', () => {
  assert.equal(validateSourcePath('/recordings/客厅/2026-10-13', []).error, '');
  assert.equal(validateSourcePath('/recordings/v1..backup', []).error, '');
});
test('跨片段导出按实际覆盖计时，排除 18 秒断档', () => {
  const result = summarizeRange(clips, clips[0].start, clips.at(-1).end);
  assert.equal(result.valid, true);
  assert.equal(result.coverage, 360);
  assert.equal(result.gap, 18);
  assert.equal(result.clips.length, 6);
});
test('裁剪片段中间的一段，边界不多算一秒', () => {
  const result = summarizeRange(clips, clips[0].start + 10, clips[0].end - 10);
  assert.equal(result.coverage, 40);
  assert.equal(result.clips.length, 1);
});
test('重叠文件不重复计算时间', () => {
  assert.equal(summarizeRange([{ start: 0, end: 60 }, { start: 30, end: 90 }], 0, 90).coverage, 90);
});
test('倒序或无录像区间不可导出', () => {
  assert.equal(summarizeRange(clips, clips[0].end, clips[0].start).valid, false);
  assert.equal(summarizeRange(clips, clips[2].end, clips[3].start).valid, false);
  assert.equal(summarizeRange(clips, NaN, clips[0].end).valid, false);
});
test('范围右端恰好碰到下一片段起点时不包含下一片段', () => {
  assert.equal(summarizeRange(clips, clips[0].start, clips[1].start).clips.length, 1);
});
test('一期不加载识别模块，二期打开能力开关后可以注册模块', () => {
  const disabled = createExtensionRegistry();
  const extension = { id: 'transcript', slot: 'clip-detail', capability: 'transcription', component: () => null };
  assert.equal(disabled.register(extension), false);
  assert.deepEqual(disabled.forSlot('clip-detail'), []);
  const enabled = createExtensionRegistry({ ...PHASE_ONE_CAPABILITIES, transcription: true });
  assert.equal(enabled.register(extension), true);
  assert.equal(enabled.forSlot('clip-detail').length, 1);
  assert.throws(() => enabled.register({ id: 'invalid', slot: 'invalid', capability: 'transcription' }));
});
