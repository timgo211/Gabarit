// Aires du trajet (phase 9). Logique pure : fusion des sources (OpenStreetMap + jeu officiel), placement le long
// de l'itinéraire (km depuis le départ, côté de la route, heure d'arrivée), prochaines aires pendant le guidage,
// annonce vocale, textes des fiches.
//
// Sens de circulation : en France on roule à droite (Code de la route, art. R412-9 : « En marche normale, tout
// conducteur doit maintenir son véhicule près du bord droit de la chaussée »). Une aire de repos ou de service
// d'autoroute placée nettement à gauche du tracé sert en général le sens opposé ; certaines servent les deux sens
// (passerelle, aire commune). Elle n'est donc pas supprimée : affichée en gris « autre sens ? », hors des
// « Prochaines aires » et sans annonce vocale.

import { haversine } from './ors-response.js';
import { prepareLine, locateOnLine } from './nav-geo.js';
import { AREAS_OSM } from './areas-osm.js';
import { OFFICIAL } from './areas-official.js';
import { formatDistance, formatArrival } from './format.js';

export const AREAS = Object.freeze({
  /** Deux fiches à moins de 300 m (une OSM, une officielle) = la même aire. */
  MERGE_M: 300,
  /** Sous cet écart au tracé (m), le côté n'est pas fiable : aire gardée dans le sens de circulation. */
  SIDE_MIN_M: 25,
  /** Prochaines aires affichées en guidage. */
  NEXT_COUNT: 3,
  /** Une aire dépassée de moins de 500 m reste en tête (camion arrêté dessus : sa fiche reste à portée). */
  PASSED_KEEP_M: 500,
  /** Annonce vocale « vers 10 km » : dite une fois quand l'aire passe sous 10 km, si elle est encore à plus de 2 km. */
  ANNOUNCE_M: 10000,
  ANNOUNCE_MIN_M: 2000,
});

export const SERVICE_LABELS = Object.freeze({
  toilets: 'WC', shower: 'Douches', food: 'Restauration', fuel: 'Carburant', water: 'Eau', wifi: 'Wi-Fi',
});

export const KIND_LABELS = Object.freeze({
  rest_area: 'Aire de repos', services: 'Aire de service', parking: 'Parking PL', official: 'Aire PL',
});

const RAD = Math.PI / 180;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * Fusionne les aires OSM et officielles : une officielle à moins de 300 m d'une aire OSM devient une seule fiche
 * (places, prix, sécurité de la source officielle ; services réunis ; nom officiel, sinon celui d'OSM).
 */
export function mergeAreas(osm = [], official = []) {
  const out = osm.map((a) => ({ ...a, ids: [...(a.ids ?? [a.id])], sources: [...(a.sources ?? [a.source])], services: [...(a.services ?? [])] }));
  for (const o of official) {
    let host = null;
    let best = Infinity;
    for (const a of out) {
      if (a.sources.includes('official')) continue;
      const d = haversine([a.lon, a.lat], [o.lon, o.lat]);
      if (d <= AREAS.MERGE_M && d < best) { host = a; best = d; }
    }
    if (!host) { out.push({ ...o, ids: [...o.ids], sources: [...o.sources], services: [...o.services] }); continue; }
    host.ids.push(...o.ids);
    host.sources.push('official');
    host.officialName = o.name;
    if (o.name) host.name = o.name;
    if (o.hgvPlaces) host.hgvPlaces = o.hgvPlaces;
    if (o.fee !== null) host.fee = o.fee;
    if (o.price) host.price = o.price;
    if (o.secure !== null) host.secure = o.secure;
    for (const s of o.services) if (!host.services.includes(s)) host.services.push(s);
    for (const k of ['road', 'direction', 'operator', 'network']) if (o[k] && !host[k]) host[k] = o[k];
  }
  return out;
}

/** Côté du point par rapport au segment [a, b] : 1 = droite, -1 = gauche (plan local). */
function sideOf(p, a, b) {
  const kx = Math.cos(p[1] * RAD);
  const cross = (b[0] - a[0]) * kx * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) * kx;
  return cross > 0 ? -1 : 1;
}

function radiusFor(area) {
  if (area.kind === 'parking') return AREAS_OSM.PARKING_RADIUS_M;
  if (area.kind === 'official') return OFFICIAL.RADIUS_M;
  return AREAS_OSM.REST_RADIUS_M;
}

/** Temps (s) pour aller du départ jusqu'à la distance `along`, d'après les durées ORS des étapes. */
export function timeAt(route, line, along) {
  const steps = Array.isArray(route?.steps) ? route.steps : [];
  let t = 0;
  let counted = false;
  for (const st of steps) {
    if (!st?.wayPoints || !(st.duration > 0)) continue;
    const a = line.cum[st.wayPoints[0]];
    const b = line.cum[st.wayPoints[1]];
    if (!isNum(a) || !isNum(b) || !(b > a)) continue;
    counted = true;
    if (along >= b) t += st.duration;
    else if (along > a) t += st.duration * ((along - a) / (b - a));
  }
  if (counted) return t;
  return line.total > 0 && isNum(route?.duration) ? route.duration * Math.min(1, along / line.total) : 0;
}

/**
 * Aires le long d'un itinéraire, triées par distance depuis le départ.
 * @param {object[]} pool aires (mergeAreas)
 * @param {{ coordinates:number[][], steps?:object[], duration?:number }} route
 * @returns {object[]} aires + { along (m), offset (m), side:'right'|'left'|null, otherSide:boolean, time (s depuis le départ) }
 */
export function placeAlongRoute(pool, route) {
  if (!Array.isArray(route?.coordinates) || route.coordinates.length < 2) return [];
  const line = prepareLine(route.coordinates);
  const out = [];
  for (const a of Array.isArray(pool) ? pool : []) {
    if (!isNum(a?.lon) || !isNum(a?.lat)) continue;
    const p = [a.lon, a.lat];
    const loc = locateOnLine(line, p);
    if (loc.distance > radiusFor(a)) continue;
    let side = null;
    if (loc.distance >= AREAS.SIDE_MIN_M) {
      side = sideOf(p, line.coords[loc.segIndex], line.coords[loc.segIndex + 1]) > 0 ? 'right' : 'left';
    }
    // Le côté compte pour les aires d'autoroute ou de nationale (repos, service, aires officielles) ; un parking PL
    // en ville ou en zone d'activité se rejoint par la voirie, des deux sens.
    const sided = a.kind !== 'parking';
    out.push({
      ...a, along: loc.along, offset: loc.distance, side, otherSide: sided && side === 'left',
      time: timeAt(route, line, loc.along),
    });
  }
  out.sort((x, y) => x.along - y.along);
  // Deux fiches OSM du même côté à moins de 300 m le long du tracé (aire dessinée deux fois) : la mieux renseignée.
  const kept = [];
  for (const a of out) {
    const twin = kept.find((k) => Math.abs(k.along - a.along) < AREAS.MERGE_M && k.otherSide === a.otherSide
      && haversine([k.lon, k.lat], [a.lon, a.lat]) < AREAS.MERGE_M && k.kind !== 'parking' && a.kind !== 'parking');
    if (!twin) { kept.push(a); continue; }
    twin.ids = [...new Set([...twin.ids, ...a.ids])];
    if (!twin.hgvPlaces && a.hgvPlaces) twin.hgvPlaces = a.hgvPlaces;
    if (!twin.name && a.name) twin.name = a.name;
    for (const s of a.services ?? []) if (!twin.services.includes(s)) twin.services.push(s);
  }
  return kept;
}

/**
 * Prochaines aires pendant le guidage (sens de circulation seulement).
 * @param {object[]} placed placeAlongRoute
 * @param {number} along distance parcourue (m)
 * @param {(along:number)=>number} remainingAt temps restant jusqu'à l'arrivée depuis une distance (s)
 * @returns {{ id:string, name:string, kind:string, hgvPlaces:number|null, distance:number, eta:number }[]}
 *   distance (m, 0 si l'aire vient d'être dépassée), eta : secondes depuis maintenant
 */
export function nextAreas(placed, along, remainingAt, count = AREAS.NEXT_COUNT) {
  if (!Array.isArray(placed) || !isNum(along)) return [];
  const now = remainingAt(along);
  return placed
    .filter((a) => !a.otherSide && a.along >= along - AREAS.PASSED_KEEP_M)
    .slice(0, count)
    .map((a) => ({
      id: a.id, name: areaName(a), kind: a.kind, hgvPlaces: a.hgvPlaces ?? null,
      distance: Math.max(0, a.along - along), eta: Math.max(0, now - remainingAt(Math.max(a.along, along))),
    }));
}

/**
 * Aire à annoncer (une seule fois) : la première du sens de circulation qui passe sous 10 km, encore à plus de 2 km
 * (pas d'annonce pour une aire toute proche au démarrage).
 * @param {object[]} placed
 * @param {number} along
 * @param {Object<string,boolean>} done aires déjà annoncées (par id)
 */
export function areaToAnnounce(placed, along, done = {}) {
  if (!Array.isArray(placed) || !isNum(along)) return null;
  for (const a of placed) {
    if (a.otherSide || done[a.id]) continue;
    const d = a.along - along;
    if (d < AREAS.ANNOUNCE_MIN_M) continue;
    if (d > AREAS.ANNOUNCE_M) return null; // triées : les suivantes sont plus loin
    return { area: a, distance: d };
  }
  return null;
}

export function areaName(a) {
  if (a?.name) return a.name;
  return KIND_LABELS[a?.kind] ?? 'Aire';
}

/** « 45 places PL » ; null si inconnu. */
export function placesText(n) {
  if (!Number.isInteger(n) || n <= 0) return null;
  return `${n} place${n > 1 ? 's' : ''} PL`;
}

/** Phrase vocale : « Aire de Saint-Rambert dans 10 kilomètres, 45 places poids lourds. » */
export function announceAreaText(area, distance) {
  const km = Math.max(1, Math.round(distance / 1000));
  const places = Number.isInteger(area.hgvPlaces) && area.hgvPlaces > 0
    ? `, ${area.hgvPlaces} place${area.hgvPlaces > 1 ? 's' : ''} poids lourds` : '';
  return `${areaName(area)} dans ${km} kilomètre${km > 1 ? 's' : ''}${places}.`;
}

export function servicesText(services) {
  return (Array.isArray(services) ? services : []).map((s) => SERVICE_LABELS[s]).filter(Boolean).join(', ');
}

/** Sécurisé / payant / gratuit, en mots courts. */
export function statusBadges(a) {
  const out = [];
  if (a.secure === true) out.push('Sécurisé');
  if (a.fee === true) out.push('Payant');
  else if (a.fee === false) out.push('Gratuit');
  return out;
}

export function sourcesText(a) {
  const s = a.sources ?? [a.source];
  const parts = [];
  if (s.includes('official')) parts.push(`${OFFICIAL.SOURCE} (${OFFICIAL.LICENCE})`);
  if (s.includes('osm')) parts.push('© contributeurs OpenStreetMap (ODbL)');
  return parts.join(' ; ');
}

/**
 * Ligne de la liste « Aires du trajet » (avant le départ).
 * @param {object} a aire placée
 * @param {Date} departure heure de départ (maintenant)
 */
export function describeArea(a, departure = new Date()) {
  const facts = [`km ${Math.round(a.along / 1000)}`, formatArrival(departure, a.time ?? 0)];
  const places = placesText(a.hgvPlaces);
  if (places) facts.push(places);
  return {
    name: areaName(a),
    kind: KIND_LABELS[a.kind] ?? 'Aire',
    facts: facts.join(' · '),
    services: servicesText(a.services),
    badges: statusBadges(a),
    otherSide: !!a.otherSide,
  };
}

/** Ligne de l'encart « Prochaines aires » (guidage). */
export function describeNextArea(n, now = new Date()) {
  return {
    name: n.name,
    distance: n.distance < 50 ? 'Ici' : formatDistance(n.distance),
    eta: formatArrival(now, n.eta),
    places: placesText(n.hgvPlaces) ?? 'places PL ?',
  };
}
