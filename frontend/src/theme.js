export const THEME_MODES = Object.freeze(['light', 'dark', 'system']);
export const normalizeTheme = value => THEME_MODES.includes(value) ? value : 'system';
export const resolveTheme = (preference, systemDark) => normalizeTheme(preference) === 'system' ? systemDark ? 'dark' : 'light' : preference;
export const themeCacheKey = demo => demo ? 'clipline:demo-theme' : 'clipline:theme';

// The cache only supplies the first paint. Saved server settings remain authoritative.
export function createThemeController({ root, media, storage, key, meta }) {
  let cached;
  try { cached = storage?.getItem(key); } catch { /* Storage can be unavailable. */ }
  let preference = normalizeTheme(cached);
  function apply() {
    const resolved = resolveTheme(preference, media.matches);
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    root.style.colorScheme = resolved;
    meta?.setAttribute('content', resolved === 'dark' ? '#10151d' : '#f6f7f8');
    return resolved;
  }
  const changed = () => { if (preference === 'system') apply(); };
  if (media.addEventListener) media.addEventListener('change', changed);
  else media.addListener?.(changed);
  apply();
  return {
    setPreference(value) { preference = normalizeTheme(value); return apply(); },
    remember(value) { try { storage?.setItem(key, normalizeTheme(value)); } catch { /* Appearance still works. */ } },
    dispose() { if (media.removeEventListener) media.removeEventListener('change', changed); else media.removeListener?.(changed); },
  };
}
let controller;
export function initializeTheme() {
  if (!controller) {
    let storage;
    try { storage = window.localStorage; } catch { /* Private contexts may block storage. */ }
    controller = createThemeController({ root: document.documentElement, media: window.matchMedia('(prefers-color-scheme: dark)'), storage, key: themeCacheKey(new URLSearchParams(window.location.search).get('mode') === 'demo'), meta: document.querySelector('meta[name="theme-color"]') });
  }
  return controller;
}
