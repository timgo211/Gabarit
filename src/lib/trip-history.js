// Historique des trajets terminés (phase 6, v56). Logique pure, sans DOM ni IndexedDB (src/ui/trip-history.js).
//
// Règles :
// - un trajet est gardé seulement à l'arrivée (« Destination atteinte ») d'un guidage avec le vrai GPS : jamais une
//   simulation, jamais un guidage quitté avant l'arrivée ;
// - champs : date de début, départ, arrivée, étapes (libellés), km parcourus sur le tracé (recalculs compris), durée
//   (du début du guidage à l'arrivée, pauses comprises), nom du profil. Aucune coordonnée, aucune trace GPS : un
//   libellé qui est lui-même un couple de coordonnées (point choisi par appui long) est remplacé par « Point choisi
//   sur la carte » ;
// - gardé seulement sur l'appareil (IndexedDB), inclus dans l'export de gabarit.data (champ `history`), fusionné à
//   l'import (par identifiant) ; 1 000 trajets au plus, les plus anciens retirés ;
// - statistiques par mois (trajets, km, durée) et relevé imprimable (feuille de style d'impression).

import { parseCoordinates } from './coords.js';
import { formatDuration } from './format.js';

export const HISTORY = Object.freeze({
  FORMAT: 1,
  MAX: 1000,
  LABEL_MAX: 120,
  STOPS_MAX: 10,
  PRIVACY_TEXT: "Gardé seulement sur cet appareil. Inclus dans l'export.",
  MAP_POINT: 'Point choisi sur la carte',
  EMPTY_TEXT: 'Aucun trajet terminé pour l\'instant.',
  PRINT_TITLE: 'Gabarit — relevé personnel des trajets (non officiel)',
  UNAVAILABLE_TEXT: 'Historique indisponible sur ce navigateur (stockage refusé ou plein) : le guidage marche normalement.',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Libellé gardé : texte court ; coordonnées → « Point choisi sur la carte ». */
export function safeLabel(label) {
  const t = typeof label === 'string' ? label.trim().slice(0, HISTORY.LABEL_MAX) : '';
  if (!t) return '';
  return parseCoordinates(t) ? HISTORY.MAP_POINT : t;
}

/**
 * Trajet à garder à l'arrivée, ou null (simulation, données illisibles).
 * @param {{ startedAt:number, arrivedAt:number, from:string, to:string, stops?:{label:string}[], drivenM:number,
 *   profile:string, simulating?:boolean, seq?:number }} p seq : compteur (deux trajets à la même milliseconde)
 */
export function buildTrip({ startedAt, arrivedAt, from, to, stops = [], drivenM, profile, simulating = false, seq = 0 }) {
  if (simulating || !isNum(startedAt) || !isNum(arrivedAt) || arrivedAt < startedAt) return null;
  return {
    id: `${Math.round(startedAt)}-${Number.isInteger(seq) ? seq : 0}`,
    date: new Date(startedAt).toISOString(),
    from: safeLabel(from) || 'Départ',
    to: safeLabel(to) || 'Arrivée',
    stops: (Array.isArray(stops) ? stops : []).slice(0, HISTORY.STOPS_MAX).map((s) => safeLabel(s?.label) || 'Étape'),
    km: isNum(drivenM) && drivenM > 0 ? Math.round(drivenM / 100) / 10 : 0,
    duration: Math.round((arrivedAt - startedAt) / 1000),
    profile: typeof profile === 'string' ? profile.slice(0, HISTORY.LABEL_MAX) : '',
  };
}

/** Trajet lisible (import, lecture de la base) : seulement les champs connus, aucune coordonnée. */
function cleanTrip(t) {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id || t.id.length > 40) return null;
  const ms = Date.parse(t.date);
  if (!Number.isFinite(ms)) return null;
  if (!isNum(t.km) || t.km < 0 || t.km > 100000 || !isNum(t.duration) || t.duration < 0 || t.duration > 30 * 86400) return null;
  return {
    id: t.id,
    date: new Date(ms).toISOString(),
    from: safeLabel(t.from) || 'Départ',
    to: safeLabel(t.to) || 'Arrivée',
    stops: (Array.isArray(t.stops) ? t.stops : []).slice(0, HISTORY.STOPS_MAX).map((s) => safeLabel(String(s ?? '')) || 'Étape'),
    km: Math.round(t.km * 10) / 10,
    duration: Math.round(t.duration),
    profile: typeof t.profile === 'string' ? t.profile.slice(0, HISTORY.LABEL_MAX) : '',
  };
}

/** Liste nettoyée : trajets lisibles, sans doublon d'identifiant, du plus récent au plus ancien, 1 000 au plus. */
export function sanitizeHistory(list) {
  const seen = new Set();
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    const c = cleanTrip(t);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1)));
  return out.slice(0, HISTORY.MAX);
}

/** Ajoute un trajet (le plus récent en tête). */
export function addToHistory(list, trip) {
  return trip ? sanitizeHistory([trip, ...(Array.isArray(list) ? list : [])]) : sanitizeHistory(list);
}

/** Import : trajets du fichier ajoutés à ceux de l'appareil (même identifiant → celui de l'appareil). */
export function mergeHistory(current, imported) {
  return sanitizeHistory([...(Array.isArray(current) ? current : []), ...(Array.isArray(imported) ? imported : [])]);
}

/** Mois local « AAAA-MM » d'une date ISO. */
function monthKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Statistiques par mois (heure de la tablette), du plus récent au plus ancien.
 * @returns {{ month:string, label:string, trips:number, km:number, duration:number }[]}
 */
export function monthlyStats(list) {
  const by = new Map();
  for (const t of sanitizeHistory(list)) {
    const k = monthKey(t.date);
    const m = by.get(k) ?? { month: k, trips: 0, km: 0, duration: 0 };
    m.trips += 1;
    m.km += t.km;
    m.duration += t.duration;
    by.set(k, m);
  }
  return [...by.values()].sort((a, b) => (a.month < b.month ? 1 : -1)).map((m) => {
    const [y, mo] = m.month.split('-').map(Number);
    return { ...m, km: Math.round(m.km * 10) / 10, label: `${MONTHS[mo - 1]} ${y}` };
  });
}

const kmText = (km) => `${String(km >= 100 ? Math.round(km) : Math.round(km * 10) / 10).replace('.', ',')} km`;

/** Textes d'une ligne de l'historique (affichage et relevé). */
export function describeTrip(t) {
  const d = new Date(t.date);
  const p2 = (n) => String(n).padStart(2, '0');
  return {
    date: `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`,
    route: `${t.from} → ${t.to}`,
    stops: t.stops.length ? `par ${t.stops.join(', ')}` : '',
    km: kmText(t.km),
    duration: formatDuration(t.duration),
    profile: t.profile,
  };
}

/** Ligne d'un mois : « novembre 2026 : 12 trajets · 1 234 km · 18 h 05 ». */
export function monthText(m) {
  return `${m.label} : ${m.trips} trajet${m.trips > 1 ? 's' : ''} · ${kmText(m.km)} · ${formatDuration(m.duration)}`;
}
