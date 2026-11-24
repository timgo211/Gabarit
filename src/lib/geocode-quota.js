// Compteur des appels de géocodage Pelias (v62) : suggestions (/autocomplete) et recherche d'un texte validé sans
// choix (/search). Logique pure : le stockage et l'horloge sont fournis (tests sans horloge réelle).
//
// Quota gratuit de HeiGIT (offre « Standard ») : la page des offres (openrouteservice.org/plans → account.heigit.org)
// n'a pas pu être lue depuis le conteneur le 24/11/2026 (hôte bloqué). La FAQ d'ORS (raw.githubusercontent.com/
// GIScience/openrouteservice, docs/frequently-asked-questions.md, lue le 24/11/2026) dit seulement que chaque service a
// une limite par jour et par minute (403 au-delà du jour, 429 au-delà de la minute), remise à zéro 24 h après la
// première requête ; un message du forum d'ORS (ask.openrouteservice.org) parle de 1 000 requêtes d'autocomplétion par
// jour, séparées des itinéraires. Chiffre non recoupé → plafonds prudents, à la moitié de ce chiffre, par service :
// 500 par jour, 40 par minute (fenêtre glissante). Au-delà : aucun appel, message ; jamais une impasse (voir
// place-resolve.js : recherche à part, appui long et coordonnées sans appel).
//
// Stockage : localStorage `gabarit.geocodeCount` = { day:'AAAA-MM-JJ', autocomplete:n, search:n } (aucun texte saisi,
// aucune clé, aucune coordonnée). Fenêtre de la minute et cache des textes : en mémoire seulement.

export const GEOCODE_QUOTA = Object.freeze({
  KEY: 'gabarit.geocodeCount',
  DAY: Object.freeze({ autocomplete: 500, search: 500 }),
  PER_MINUTE: 40,
  /** Textes gardés en mémoire (même texte = aucun appel). */
  CACHE_SIZE: 20,
});

const KINDS = ['autocomplete', 'search'];

/** Jour local « AAAA-MM-JJ » d'un instant (ms). */
export function dayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Compteurs lus (texte JSON ou rien) pour le jour donné ; autre jour ou illisible → zéro. */
export function readCounts(text, day) {
  let raw = null;
  try { raw = typeof text === 'string' ? JSON.parse(text) : null; } catch { raw = null; }
  const ok = raw && typeof raw === 'object' && raw.day === day;
  const n = (x) => (Number.isInteger(x) && x >= 0 ? x : 0);
  return { day, autocomplete: ok ? n(raw.autocomplete) : 0, search: ok ? n(raw.search) : 0 };
}

/**
 * Budget de géocodage.
 * @param {{ storage?:{getItem:Function,setItem:Function}|null, now:()=>number }} o
 */
export function createGeocodeBudget({ storage = null, now }) {
  const minute = { autocomplete: [], search: [] };
  function load() {
    let text = null;
    try { text = storage?.getItem(GEOCODE_QUOTA.KEY) ?? null; } catch { text = null; }
    return readCounts(text, dayOf(now()));
  }
  function recent(kind) {
    const t = now();
    minute[kind] = minute[kind].filter((x) => t - x < 60_000);
    return minute[kind].length;
  }
  return {
    /** Un appel de ce type peut-il partir maintenant ? */
    canSend(kind) {
      if (!KINDS.includes(kind)) return false;
      return load()[kind] < GEOCODE_QUOTA.DAY[kind] && recent(kind) < GEOCODE_QUOTA.PER_MINUTE;
    },
    /** Compte un appel réellement envoyé. */
    record(kind) {
      if (!KINDS.includes(kind)) return;
      const c = load();
      c[kind] += 1;
      minute[kind].push(now());
      try { storage?.setItem(GEOCODE_QUOTA.KEY, JSON.stringify(c)); } catch { /* stockage refusé : compteur du jour perdu */ }
    },
    /** Appels du jour (pour les contrôles et le chiffre de la PR). */
    count(kind) {
      return KINDS.includes(kind) ? load()[kind] : 0;
    },
  };
}

/** Cache des derniers textes cherchés, en mémoire seulement (jamais écrit : perdu au rechargement). */
export function createTextCache(size = GEOCODE_QUOTA.CACHE_SIZE) {
  const map = new Map();
  const norm = (t) => String(t ?? '').trim().toLowerCase();
  return {
    get(text) {
      const k = norm(text);
      if (!map.has(k)) return undefined;
      const v = map.get(k);
      map.delete(k);
      map.set(k, v); // le plus récent en dernier
      return v;
    },
    set(text, value) {
      const k = norm(text);
      map.delete(k);
      map.set(k, value);
      while (map.size > size) map.delete(map.keys().next().value);
    },
    get size() { return map.size; },
  };
}
