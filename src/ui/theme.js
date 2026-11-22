// Applique le thème jour/nuit et le réévalue chaque minute en mode auto.

import { resolveTheme, CHROME_COLOR } from '../lib/theme.js';

export function createThemeController(onChange) {
  let mode = 'auto';
  let current = null;

  function apply() {
    const theme = resolveTheme(mode, new Date());
    if (theme === current) return;
    current = theme;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME_COLOR); // barre d'état noire jour et nuit (2c-a)
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
