// Aires trouvées par Overpass, gardées sur l'appareil (phase 9) : localStorage, à part des données de l'appli
// (ni exportées ni dans le cache du service worker). Le même trajet recalculé ne refait pas de requête Overpass.
// Stockage injectable (localStorage, ou objet en mémoire dans les tests).

export const AREAS_CACHE_KEY = 'gabarit.areasCache';
export const AREAS_CACHE = Object.freeze({
  /** Trajets gardés au plus. */
  MAX_ENTRIES: 5,
  /** Durée de validité (OpenStreetMap change peu, mais une aire peut fermer ou ouvrir). */
  MAX_AGE_MS: 7 * 24 * 3600 * 1000,
});

/** Empreinte d'un trajet : points arrondis à ≈ 10 m (FNV-1a 32 bits) + nombre de points. */
export function routeKey(coords) {
  let h = 0x811c9dc5;
  const pts = Array.isArray(coords) ? coords : [];
  for (const p of pts) {
    const s = `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)};`;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return `${pts.length}-${h.toString(16)}`;
}

function readAll(storage) {
  try {
    const v = JSON.parse(storage.getItem(AREAS_CACHE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((e) => e && typeof e.key === 'string' && Array.isArray(e.areas) && typeof e.at === 'number') : [];
  } catch {
    return [];
  }
}

export function createAreasCache(storage) {
  return {
    /** Aires gardées pour ce trajet (moins de 7 jours), ou null. */
    get(key, now = Date.now()) {
      const e = readAll(storage).find((x) => x.key === key);
      return e && now - e.at <= AREAS_CACHE.MAX_AGE_MS ? e.areas : null;
    },
    set(key, areas, now = Date.now()) {
      const list = readAll(storage).filter((x) => x.key !== key && now - x.at <= AREAS_CACHE.MAX_AGE_MS);
      list.unshift({ key, at: now, areas });
      try {
        storage.setItem(AREAS_CACHE_KEY, JSON.stringify(list.slice(0, AREAS_CACHE.MAX_ENTRIES)));
      } catch {
        // stockage plein : on garde seulement ce trajet
        try { storage.setItem(AREAS_CACHE_KEY, JSON.stringify([{ key, at: now, areas }])); } catch { /* tant pis */ }
      }
    },
  };
}
