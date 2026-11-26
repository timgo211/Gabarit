// Mes restrictions (phase 12b) : passages saisis par le chauffeur (hauteur, poids, à éviter), gardés sur l'appareil
// (champ `restrictions` des données `gabarit.data`, comme les véhicules et « Mon avis »), exportés avec les données,
// vérifiés à l'import (doublons, valeurs absurdes), évités au calcul par de petits polygones (options.avoid_polygons
// d'ORS, avec les ZFE). Logique pure. Rien de secret. Jamais « sûr » ni « sans restriction » : la signalisation fait foi.
//
// Limites de l'API publique d'ORS (voir ZFE dans zfe.js) : « Maximum Distance (with avoid areas) 150 km » à vol
// d'oiseau entre les points, « Avoid polygon area 200 km² », étendue 20 km par polygone. Un polygone de 30 m de rayon
// (≈ 0,003 km²) reste très loin des deux dernières ; au-delà de 150 km, aucun polygone n'est envoyé (ORS refuserait la
// requête) et la fiche le dit, « à vérifier ».

import { haversine } from './nav-geo.js';
import { ZFE } from './zfe.js';
import { crowPath } from './stops.js';

/** Rayon constant du polygone évité autour d'une restriction (m). */
export const RESTR_RADIUS_M = 30;

export const RESTR = Object.freeze({
  TYPES: Object.freeze(['height', 'weight', 'avoid']),
  ORIGINS: Object.freeze(['manual', 'osm-bridge', 'osm-weight', 'dialog']),
  HEIGHT: Object.freeze({ min: 1, max: 6 }),
  WEIGHT: Object.freeze({ min: 1, max: 60 }),
  /** Marge du profil sur la hauteur : la restriction s'applique si hauteur + 0,1 m ≥ valeur. */
  HEIGHT_MARGIN_M: 0.1,
  /** Même type à moins de 5 m : doublon. */
  DUPLICATE_M: 5,
  MAX_COUNT: 500,
  NOTE_MAX: 120,
  SIDES: 16,
  /** Limite de l'API publique d'ORS avec des zones évitées (vol d'oiseau, comme pour les ZFE). */
  MAX_DISTANCE_M: ZFE.AVOID_MAX_DISTANCE_M,
  /** « Proche de la zone du trajet » : à moins de max(10 km, 25 % du trajet) de la ligne départ–arrivée. */
  ZONE_MIN_M: 10000,
  ZONE_SHARE: 0.25,
});

export const TOO_FAR_TEXT = "Restrictions saisies non évitées : trajet de plus de 150 km à vol d'oiseau (limite d'OpenRouteService). À vérifier. La signalisation fait foi.";
export const BLOCKED_TEXT = 'Une restriction saisie bloque peut-être le seul passage.';
export const HELP_TEXT = "Chaque restriction qui concerne le véhicule actif est évitée au calcul (zone de 30 m de rayon), seulement pour un trajet de 150 km ou moins à vol d'oiseau (limite d'OpenRouteService) ; au-delà, elle est signalée « à vérifier ». Ajout et modification à l'arrêt seulement. La signalisation fait foi.";
export const BRIDGE_AVOID_HELP = "« Éviter ce passage » enregistre le point où l'itinéraire passe sous le pont. Sur un pont routier, la zone évitée bloque aussi la route du dessus.";

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
export const TYPE_LABELS = Object.freeze({ height: 'Hauteur', weight: 'Poids', avoid: 'À éviter' });

/** « Hauteur 3,8 m », « Poids 3,5 t », « À éviter ». */
export function restrictionLabel(r) {
  if (r.type === 'height') return `Hauteur ${String(r.value).replace('.', ',')} m`;
  if (r.type === 'weight') return `Poids ${String(r.value).replace('.', ',')} t`;
  return 'À éviter';
}

/**
 * Vérifie une restriction (saisie ou importée). Lève une Error en français si elle est invalide.
 * @returns {{ id, lat, lon, type, value, note, date, origin, osmId? }}
 */
export function validateRestriction(raw, { now = new Date(), makeId = defaultId } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Restriction illisible.');
  const lat = Number(raw.lat); const lon = Number(raw.lon);
  if (!isNum(lat) || !isNum(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Position de la restriction invalide.');
  if (!RESTR.TYPES.includes(raw.type)) throw new Error('Type de restriction inconnu (hauteur, poids ou à éviter).');
  let value = null;
  if (raw.type !== 'avoid') {
    value = typeof raw.value === 'string' ? Number(raw.value.replace(',', '.')) : Number(raw.value);
    const b = raw.type === 'height' ? RESTR.HEIGHT : RESTR.WEIGHT;
    if (!isNum(value) || value < b.min || value > b.max) {
      throw new Error(raw.type === 'height' ? 'Hauteur entre 1 et 6 m.' : 'Poids entre 1 et 60 t.');
    }
    value = round(value, 2);
  }
  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : now.toISOString().slice(0, 10);
  const note = typeof raw.note === 'string' ? raw.note.replace(/\p{C}+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, RESTR.NOTE_MAX) : '';
  const origin = RESTR.ORIGINS.includes(raw.origin) ? raw.origin : 'manual';
  const out = {
    id: typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : makeId(),
    lat: round(lat, 6), lon: round(lon, 6), type: raw.type, value, note, date, origin,
  };
  if (origin !== 'manual' && Number.isInteger(raw.osmId) && raw.osmId > 0) out.osmId = raw.osmId;
  return out;
}

function defaultId() {
  return `r-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Doublon : même type à moins de RESTR.DUPLICATE_M (valeur ignorée). */
export function isDuplicate(a, b) {
  return a.type === b.type && haversine([a.lon, a.lat], [b.lon, b.lat]) < RESTR.DUPLICATE_M;
}

/**
 * Liste importée ou chargée → liste propre ; invalides et doublons écartés (comptés).
 * @returns {{ list:object[], dropped:number }}
 */
export function sanitizeRestrictions(raw, opts = {}) {
  const list = [];
  let dropped = 0;
  for (const r of Array.isArray(raw) ? raw : []) {
    try {
      const v = validateRestriction(r, opts);
      if (list.length >= RESTR.MAX_COUNT || list.some((o) => isDuplicate(o, v) || o.id === v.id)) { dropped += 1; continue; }
      list.push(v);
    } catch {
      dropped += 1;
    }
  }
  return { list, dropped };
}

/** Ajout : erreur si doublon ou liste pleine. */
export function addRestriction(list, raw, opts = {}) {
  const v = validateRestriction(raw, opts);
  if (list.some((o) => isDuplicate(o, v))) throw new Error('Une restriction du même type existe déjà à cet endroit.');
  if (list.length >= RESTR.MAX_COUNT) throw new Error(`${RESTR.MAX_COUNT} restrictions au plus.`);
  return [...list, v];
}

/** Modification (même id) : valeur, type ou note. */
export function updateRestriction(list, id, patch, opts = {}) {
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) throw new Error('Restriction introuvable.');
  const v = validateRestriction({ ...list[i], ...patch, id }, opts);
  if (list.some((o, k) => k !== i && isDuplicate(o, v))) throw new Error('Une restriction du même type existe déjà à cet endroit.');
  return list.map((r, k) => (k === i ? v : r));
}

export const removeRestriction = (list, id) => list.filter((r) => r.id !== id);

/** La restriction concerne-t-elle ce véhicule ? Hauteur ou poids inconnus du profil : oui, par prudence. */
export function applies(r, vehicle) {
  if (r.type === 'avoid') return true;
  if (r.type === 'height') return !isNum(vehicle?.height) || vehicle.height + RESTR.HEIGHT_MARGIN_M >= r.value;
  if (r.type === 'weight') return !isNum(vehicle?.weight) || vehicle.weight > r.value;
  return false;
}

/** Polygone GeoJSON (anneau fermé, RESTR.SIDES côtés) de rayon `radius` m autour du point. */
export function circleRing(lat, lon, radius = RESTR_RADIUS_M) {
  const kx = Math.cos(lat * Math.PI / 180) * 111320;
  const ring = [];
  for (let k = 0; k < RESTR.SIDES; k += 1) {
    const a = (2 * Math.PI * k) / RESTR.SIDES;
    ring.push([round(lon + (radius * Math.cos(a)) / kx, 6), round(lat + (radius * Math.sin(a)) / 110540, 6)]);
  }
  ring.push(ring[0]);
  return ring;
}

/** Distance (m) d'un point au segment départ–arrivée (plan local). */
function distToTrip(p, start, end) {
  const kx = Math.cos(((start[1] + end[1]) / 2) * Math.PI / 180) * 111320;
  const ax = (start[0] - p[0]) * kx; const ay = (start[1] - p[1]) * 110540;
  const dx = (end[0] - start[0]) * kx; const dy = (end[1] - start[1]) * 110540;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * Restrictions à éviter pour ce calcul.
 * @param {object[]} list
 * @param {{ vehicle:object, start:number[], end:number[], stops?:{lon:number,lat:number}[] }} trip start / end en
 *   [lon, lat] ; stops (v55) : étapes, dans l'ordre. La limite de 150 km porte sur la somme des distances à vol
 *   d'oiseau entre points successifs (mesure d'ORS, crowPath) ; zone du trajet autour de chaque tronçon ; une
 *   restriction à 60 m d'une étape est comptée comme au départ ou à l'arrivée (non évitable).
 * @returns {{ applicable:object[], avoided:object[], atEnds:object[], tooFar:boolean, geometry:object|null }}
 *   applicable : concernent le véhicule et proches de la zone du trajet ; avoided : celles envoyées à ORS ;
 *   atEnds : au départ ou à l'arrivée (non évitables) ; tooFar : trajet > 150 km, aucun polygone envoyé
 */
export function restrictionsForTrip(list, { vehicle, start, end, stops = [] }) {
  const out = { applicable: [], avoided: [], atEnds: [], tooFar: false, geometry: null };
  if (!Array.isArray(list) || !list.length || !Array.isArray(start) || !Array.isArray(end)) return out;
  const via = (Array.isArray(stops) ? stops : []).map((s) => [s.lon, s.lat]);
  const pts = [start, ...via, end];
  const crow = crowPath(pts);
  const zone = Math.max(RESTR.ZONE_MIN_M, RESTR.ZONE_SHARE * crow);
  const near = (p) => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i += 1) best = Math.min(best, distToTrip(p, pts[i - 1], pts[i]));
    return best;
  };
  out.applicable = list.filter((r) => applies(r, vehicle) && near([r.lon, r.lat]) <= zone);
  if (!out.applicable.length) return out;
  if (crow > RESTR.MAX_DISTANCE_M) { out.tooFar = true; return out; }
  for (const r of out.applicable) {
    const p = [r.lon, r.lat];
    if (pts.some((q) => haversine(p, q) <= RESTR_RADIUS_M * 2)) out.atEnds.push(r);
    else out.avoided.push(r);
  }
  if (out.avoided.length) {
    out.geometry = { type: 'MultiPolygon', coordinates: out.avoided.map((r) => [circleRing(r.lat, r.lon)]) };
  }
  return out;
}

/** Zones évitées réunies (restrictions + ZFE, tunnels, desserte) en un MultiPolygon ; null si aucune. */
export function mergeAvoid(...geoms) {
  const coords = [];
  for (const g of geoms) {
    if (!g || !Array.isArray(g.coordinates)) continue;
    if (g.type === 'Polygon') coords.push(g.coordinates);
    else if (g.type === 'MultiPolygon') coords.push(...g.coordinates);
  }
  return coords.length ? { type: 'MultiPolygon', coordinates: coords } : null;
}

/** Ligne de la fiche : « Évite 2 restrictions saisies par toi. » (jamais « sûr »). */
export function avoidedText(n) {
  return `Évite ${n} restriction${n > 1 ? 's' : ''} saisie${n > 1 ? 's' : ''} par toi. La signalisation fait foi.`;
}

/**
 * Lignes de la fiche pour un itinéraire calculé : trop loin pour ORS, restriction au départ / à l'arrivée, ou tracé
 * qui passe quand même à moins de RESTR_RADIUS_M d'une restriction applicable (non évitée) : « à vérifier ».
 */
export function restrictionLines(route, plan) {
  const lines = [];
  if (!plan?.applicable?.length) return lines;
  if (plan.avoided.length && !plan.tooFar) lines.push({ level: 'info', text: avoidedText(plan.avoided.length) });
  if (plan.tooFar) lines.push({ level: 'warn', sev: 'check', text: TOO_FAR_TEXT });
  for (const r of plan.atEnds) {
    lines.push({ level: 'warn', sev: 'check', text: `Restriction saisie par toi au départ ou à l'arrivée (${restrictionLabel(r)}) : non évitable, à vérifier. La signalisation fait foi.` });
  }
  const coords = route?.coordinates ?? [];
  for (const r of plan.tooFar ? plan.applicable : plan.avoided) {
    if (nearLine([r.lon, r.lat], coords, RESTR_RADIUS_M)) {
      lines.push({ level: 'warn', sev: 'check', text: `L'itinéraire passe près d'une restriction saisie par toi (${restrictionLabel(r)}${r.note ? `, ${r.note}` : ''}) : à vérifier. La signalisation fait foi.` });
    }
  }
  return lines;
}

/** Le tracé passe-t-il à moins de `d` m du point ? */
export function nearLine(p, coords, d) {
  const kx = Math.cos(p[1] * Math.PI / 180) * 111320;
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1]; const b = coords[i];
    const ax = (a[0] - p[0]) * kx; const ay = (a[1] - p[1]) * 110540;
    const dx = (b[0] - a[0]) * kx; const dy = (b[1] - a[1]) * 110540;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    if (Math.hypot(ax + t * dx, ay + t * dy) <= d) return true;
  }
  return false;
}

/** Restriction « à éviter » créée depuis un repère de pont (phase 12a) : au point de croisement tracé × pont. */
export function fromBridge(item, { now = new Date() } = {}) {
  return {
    lat: item.point[1], lon: item.point[0], type: 'avoid', value: null,
    note: item.name ? `Pont : ${item.name}` : 'Pont sans hauteur connue (OSM)', date: now.toISOString().slice(0, 10),
    origin: 'osm-bridge', osmId: item.id,
  };
}

/**
 * Restriction proposée par « Éviter ce passage » depuis une limite de poids d'OSM (phase 12a bis) : type poids,
 * valeur = limite du tronçon, au milieu du passage sur le tracé (comme fromBridge au point de croisement).
 */
export function fromWeight(item, { now = new Date() } = {}) {
  return {
    lat: item.point[1], lon: item.point[0], type: 'weight', value: item.limit,
    note: `Limite de poids OSM${item.local ? ' (desserte locale possible)' : ''}`, date: now.toISOString().slice(0, 10),
    origin: 'osm-weight', osmId: item.id,
  };
}

/**
 * Restriction proposée par « Éviter ce passage » depuis une limite DiaLog (phase 12c) : hauteur ou poids, valeur de la
 * mesure (maximum autorisé), au milieu du passage sur le tracé (comme fromWeight).
 */
export function fromDialog(item, { now = new Date() } = {}) {
  const title = typeof item.title === 'string' && item.title ? ` : ${item.title}` : '';
  return {
    lat: item.point[1], lon: item.point[0], type: item.k === 'h' ? 'height' : 'weight', value: item.value,
    note: `Limite DiaLog${title}`, date: now.toISOString().slice(0, 10), origin: 'dialog',
  };
}

export const DIALOG_AVOID_HELP = "« Éviter ce passage » enregistre une restriction (hauteur ou poids) au milieu du passage sur l'itinéraire ; elle est évitée quand le profil dépasse la limite. Seul l'arrêté fait foi.";

export const WEIGHT_AVOID_HELP = "« Éviter ce passage » enregistre une restriction de poids au milieu du passage sur l'itinéraire ; elle est évitée quand le PTAC du profil dépasse la limite.";

/**
 * Ajout ou modification permis ? Hors guidage : oui (écran d'avant le départ) ; en guidage : seulement à l'arrêt
 * (parkedState, vitesse inconnue = en mouvement). Code de la route art. R412-6-2 : aucune saisie en roulant.
 */
export function canEditRestrictions({ navigating = false, parked = false } = {}) {
  return !navigating || parked === true;
}
