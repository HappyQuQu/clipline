import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createThemeController, normalizeTheme, resolveTheme, themeCacheKey } from '../src/theme.js';

function fixture(value = 'system', dark = false, blocked = false) {
  const values = new Map([['theme', value]]), listeners = new Set();
  const root = { dataset: {}, style: {} }, meta = { setAttribute(name, value) { this[name] = value; } };
  const media = { matches: dark, addEventListener(type, listener) { listeners.add(listener); }, removeEventListener(type, listener) { listeners.delete(listener); } };
  const storage = { getItem(key) { if (blocked) throw Error('blocked'); return values.get(key); }, setItem(key, value) { if (blocked) throw Error('blocked'); values.set(key, value); } };
  return { root, meta, media, storage, values, listeners, change(dark) { media.matches = dark; for (const listener of listeners) listener(); } };
}
test('跟随系统实时响应变化，固定主题不受系统切换影响', () => {
  const state = fixture();
  const theme = createThemeController({ ...state, key: 'theme' });
  assert.equal(state.root.dataset.theme, 'light');
  state.change(true); assert.equal(state.root.dataset.theme, 'dark');
  theme.setPreference('light'); state.change(false); state.change(true);
  assert.equal(state.root.dataset.theme, 'light');
  theme.setPreference('dark'); state.change(false);
  assert.equal(state.root.dataset.theme, 'dark');
  theme.setPreference('system'); assert.equal(state.root.dataset.theme, 'light');
  assert.equal(state.root.style.colorScheme, 'light');
  assert.equal(state.meta.content, '#f6f7f8');
  theme.dispose(); assert.equal(state.listeners.size, 0);
});
test('使用已保存缓存完成首屏绘制，未保存预览不覆盖缓存，撤销可恢复', () => {
  const state = fixture('dark');
  const theme = createThemeController({ ...state, key: 'theme' });
  assert.equal(state.root.dataset.theme, 'dark');
  theme.setPreference('light'); assert.equal(state.values.get('theme'), 'dark');
  theme.setPreference('dark'); assert.equal(state.root.dataset.theme, 'dark');
  theme.remember('system'); assert.equal(state.values.get('theme'), 'system');
  assert.notEqual(themeCacheKey(true), themeCacheKey(false));
});
test('无效偏好和禁用浏览器存储时可安全使用系统及手动主题', () => {
  const state = fixture('invalid', true, true);
  const theme = createThemeController({ ...state, key: 'theme' });
  assert.equal(state.root.dataset.theme, 'dark');
  theme.remember('light'); theme.setPreference('light');
  assert.equal(state.root.dataset.theme, 'light');
  assert.equal(normalizeTheme(null), 'system');
  assert.equal(resolveTheme('invalid', true), 'dark');
});
test('加载入口前的首屏脚本与主题控制器使用相同偏好和系统规则', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(html.indexOf(bootstrap) < html.indexOf('/src/main.jsx'));
  for (const saved of ['light', 'dark', 'system', 'invalid', null]) {
    for (const dark of [true, false]) {
      const root = { dataset: {}, style: {} }, meta = {};
      vm.runInNewContext(bootstrap, { URLSearchParams, location: { search: '' }, localStorage: { getItem: () => saved }, matchMedia: () => ({ matches: dark }), document: { documentElement: root, querySelector: () => meta } });
      assert.equal(root.dataset.theme, resolveTheme(saved, dark));
      assert.equal(root.dataset.themePreference, normalizeTheme(saved));
    }
  }
});
