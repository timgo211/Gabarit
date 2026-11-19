// Applique le thème jour/nuit et le réévalue chaque minute en mode auto.

import { resolveTheme } from '../lib/theme.js';

export function createThemeController(onChange) {
  let mode = 'auto';
  let current = null;

  function apply() {
    const theme = resolveTheme(mode, new Date());
    if (theme === current) return;
    current = theme;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'night' ? '#05080b' : '#0f1720');
    onChange?.(theme);
  }

  setInterval(apply, 60000);
  return {
    setMode(m) {
      mode = m;
      apply();
    },
    get theme() {
      return current ?? resolveTheme(mode);
    },
  };
}
