// Applique le thème jour/nuit et le réévalue chaque minute en mode auto.
// Phase 2c : en mode auto, nuit entre le coucher et le lever du soleil à la dernière position connue (src/lib/sun.js) ;
// pendant le guidage, la position du GPS est reprise au plus toutes les 5 min (THEME_RECHECK_NAV_MS).

import { resolveTheme, CHROME_COLOR, THEME_RECHECK_NAV_MS } from '../lib/theme.js';

export function createThemeController(onChange) {
  let mode = 'auto';
  let current = null;
  let position = null;
  let positionAt = 0;

  function apply() {
    const theme = resolveTheme(mode, new Date(), position);
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
    /**
     * Dernière position connue [lon, lat] (GPS de l'accueil ou du guidage). `throttle` : position du guidage, prise
     * en compte au plus toutes les 5 min.
     */
    setPosition(lonlat, { throttle = false } = {}) {
      if (!Array.isArray(lonlat) || !lonlat.every(Number.isFinite)) return;
      const now = Date.now();
      if (throttle && position && now - positionAt < THEME_RECHECK_NAV_MS) return;
      position = [lonlat[0], lonlat[1]];
      positionAt = now;
      apply();
    },
    get theme() {
      return current ?? resolveTheme(mode, new Date(), position);
    },
  };
}
