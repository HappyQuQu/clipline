import test from 'node:test';
import assert from 'node:assert/strict';
import { sameExportScope, librarySelection, toggleLibraryClip } from '../src/librarySelection.js';

const a = { id: 'a', sourceId: 'one', date: '2026-06-02', availability: 'available' };
const b = { ...a, id: 'b' };
const otherSource = { ...a, id: 'other-source', sourceId: 'two' };
const otherDay = { ...a, id: 'other-day', date: '2026-06-01' };
const pending = { ...a, id: 'pending', availability: 'pending' };
const rows = [a, otherSource, b, otherDay, pending];

test('首次勾选确定导出范围，拒绝跨源、跨日和未就绪文件', () => {
  const ids = toggleLibraryClip(rows, [], a);
  for (const clip of [otherSource, otherDay, pending]) assert.deepEqual(toggleLibraryClip(rows, ids, clip), ['a']);
  assert.deepEqual(toggleLibraryClip(rows, ids, b), ['a', 'b']);
  assert.deepEqual(toggleLibraryClip(rows, ['a', 'b'], a), ['b']);
  assert.deepEqual(toggleLibraryClip(rows, [], pending), []);
});

test('全选只选已加载的同源同日可用片段，查看其他源不改变已选范围', () => {
  const state = librarySelection(rows, ['a'], otherSource);
  assert.equal(state.anchor.id, 'a');
  assert.deepEqual(state.eligible.map(clip => clip.id), ['a', 'b']);
  assert.equal(state.allSelected, false);
  assert.equal(librarySelection(rows, ['a', 'b'], otherSource).allSelected, true);
  assert.equal(librarySelection(rows, ['a', 'other-source'], a).compatible, false);
  assert.equal(librarySelection(rows, ['a', 'pending'], a).compatible, false);
});

test('指定回看日期时跨午夜文件属于该导出日，但仍拒绝不同录像源', () => {
  assert.equal(sameExportScope(a, otherDay), false);
  assert.equal(sameExportScope(a, otherDay, '2026-06-02'), true);
  assert.equal(sameExportScope(a, otherSource, '2026-06-02'), false);
  assert.deepEqual(librarySelection(rows, ['a'], a, '2026-06-02').eligible.map(clip => clip.id), ['a', 'b', 'other-day']);
});

test('取消选择或切换筛选后可重新选择范围，失效 ID 不算已选片段', () => {
  const state = librarySelection(rows, ['removed'], otherSource);
  assert.deepEqual(state.chosen, []);
  assert.deepEqual(state.eligible.map(clip => clip.id), ['other-source']);
  assert.deepEqual(toggleLibraryClip(rows, [], otherSource), ['other-source']);
  assert.equal(librarySelection([], [], undefined).allSelected, false);
});
