// Phase 4 — Carburant : stations-service le long du trajet, prix du gazole (logique pure, sans DOM).
//
// Source : jeu « Prix des carburants en France - Flux instantané - v2 » de data.economie.gouv.fr (Opendatasoft,
// Explore API v2.1), lu par l'Action « Textes officiels » le 23/11/2026 (entrée « carburants », run 45249524034) :
// - accès anonyme, sans clé ; réponses avec « Access-Control-Allow-Origin: * » (appel direct depuis la page) ;
// - quota « X-RateLimit-Limit: 50000 » appels par jour, remis à zéro à 00:00 UTC (X-RateLimit-Reset) ;
// - /records : limit ≤ 100 et offset + limit ≤ 10 000 (erreurs 400 lues) ; /exports : « no limitations »
//   (help.opendatasoft.com/apis/ods-explore-v2) → une seule requête /exports/json pour tout le trajet ;
// - in_bbox(<geo_field>, lat1, lon1, lat2, lon2), clause where seulement (même documentation) ;
// - champs : id (int), adresse, ville, cp (text), geom (geo_point_2d {lon, lat} en degrés), gazole_prix (double),
//   gazole_maj (datetime, renvoyé en UTC « 2026-11-23T14:35:41+00:00 »), services_service (text multivalué « // »,
//   renvoyé en liste JSON) ; 9 826 stations ;
// - facette services_service : « Piste poids lourds » (4 128 stations) → filtre « Piste PL » ;
// - licence : « Licence Ouverte 2.0 » (page information du jeu, data.economie.gouv.fr).
// Le détour est estimé à vol d'oiseau seulement (aucune requête ORS de plus : budget de 3 inchangé).
// Rien n'est dit à voix haute ni montré en roulant (Code de la route art. R412-6-2).

import { prepareLine, locateOnLine } from './nav-geo.js';
import { fuelEstimate, fuelCost } from './ors-response.js';
import { formatDistance, formatEuros, formatPricePerLiter } from './format.js';
import { FUEL_API } from './config.js';

export const FUEL = Object.freeze({
  RADIUS_M: 2000, // stations à moins de 2 km du tracé
  OLD_MS: 48 * 3600 * 1000, // prix de plus de 48 h : « ancien »
  CHUNK_M: 20000, // une boîte par tronçon de 20 km (boîtes étroites, peu de stations hors couloir)
  MAX_BOXES: 60, // au-delà, tronçons plus longs (URL courte)
  PRICE_MIN: 0.3, // €/L : bornes larges, écartent les valeurs aberrantes
  PRICE_MAX: 5,
  HGV_SERVICE: 'Piste poids lourds',
  MAX_OK: 500, // « Mes stations OK camion »
  NAME_MAX: 120,
  TIMEOUT_MS: 20000,
  NOTE_TEXT: 'Prix indicatifs : vérifie à la pompe.',
  SOURCE_TEXT: 'Prix : data.economie.gouv.fr (flux instantané), Licence Ouverte 2.0.',
  OFFLINE_TEXT: 'Pas de connexion : prix indisponibles.',
  ERROR_TEXT: 'Prix indisponibles pour l\'instant.',
  NONE_TEXT: 'Aucune station à moins de 2 km du tracé.',
  FRANCE_ONLY_TEXT: 'Prix des carburants : France seulement.',
  PARTLY_TEXT: 'Hors de France : aucun prix.',
  PARKED_TEXT: 'Carburant : disponible à l\'arrêt.',
  NO_CONSUMPTION_TEXT: 'Renseigne la consommation du profil pour le coût du trajet.',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const RAD = Math.PI / 180;

/**
 * Tronçons du tracé en France (route.countries d'ORS, code 'FR'). Pays inconnus (extra absent) : tout le tracé, le jeu
 * ne contient de toute façon que des stations françaises.
 * @returns {{ ranges:number[][], france:'all'|'partly'|'none'|'unknown' }} ranges : [début, fin] d'indices de points
 */
export function franceRanges(route) {
  const n = Array.isArray(route?.coordinates) ? route.coordinates.length : 0;
  if (n < 2) return { ranges: [], france: 'none' };
  const parts = route.countries;
  if (!Array.isArray(parts) || !parts.length) return { ranges: [[0, n - 1]], france: 'unknown' };
  const fr = parts.filter((p) => p.code === 'FR').map((p) => [Math.max(0, p.from), Math.min(n - 1, p.to)]).filter(([a, b]) => b > a);
  if (!fr.length) return { ranges: [], france: 'none' };
  return { ranges: fr, france: fr.length === parts.length ? 'all' : 'partly' };
}

/** Boîtes [ouest, sud, est, nord] (degrés) le long du tracé en France, élargies de RADIUS_M. */
export function routeBoxes(route, { radius = FUEL.RADIUS_M } = {}) {
  const { ranges } = franceRanges(route);
  if (!ranges.length) return [];
  const coords = route.coordinates;
  const line = prepareLine(coords);
  const length = ranges.reduce((s, [a, b]) => s + (line.cum[b] - line.cum[a]), 0);
  const chunk = Math.max(FUEL.CHUNK_M, length / FUEL.MAX_BOXES);
  const boxes = [];
  for (const [a, b] of ranges) {
    let box = null;
    let start = line.cum[a];
    for (let i = a; i <= b; i += 1) {
      const [lon, lat] = coords[i];
      if (!isNum(lon) || !isNum(lat)) continue;
      if (!box) box = [lon, lat, lon, lat];
      else box = [Math.min(box[0], lon), Math.min(box[1], lat), Math.max(box[2], lon), Math.max(box[3], lat)];
      if (line.cum[i] - start >= chunk && i < b) {
        boxes.push(box);
        box = [lon, lat, lon, lat]; // le point de coupure appartient aux deux boîtes : pas de trou
        start = line.cum[i];
      }
    }
    if (box) boxes.push(box);
  }
  return boxes.map(([w, s, e, n]) => {
    const dLat = radius / 111320;
    const dLon = radius / (111320 * Math.max(0.2, Math.cos(((s + n) / 2) * RAD)));
    return [w - dLon, s - dLat, e + dLon, n + dLat];
  });
}

const f4 = (x) => x.toFixed(4);

/**
 * Adresse de la requête : une seule, /exports/json, champs réduits, gazole connu, union des boîtes du trajet.
 * Seules les zones du trajet (boîtes) partent vers data.economie.gouv.fr : aucune autre donnée.
 */
export function fuelQueryUrl(boxes, base = FUEL_API) {
  const where = `gazole_prix is not null and (${boxes
    .map(([w, s, e, n]) => `in_bbox(geom, ${f4(s)}, ${f4(w)}, ${f4(n)}, ${f4(e)})`).join(' or ')})`;
  const q = new URLSearchParams({ select: 'id,adresse,ville,cp,geom,gazole_prix,gazole_maj,services_service', where });
  return `${base}/exports/json?${q.toString()}`;
}

const text = (x, max = FUEL.NAME_MAX) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Réponse de /exports/json (liste) ou de /records ({ results }) → stations valides.
 * @returns {{ id:number, address:string, city:string, cp:string, lon:number, lat:number, price:number,
 *   updated:Date|null, hgv:boolean }[]}
 */
export function parseStations(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.results) ? json.results : null;
  if (!list) return null;
  const out = [];
  const seen = new Set();
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const id = Number(r.id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    const lon = r.geom?.lon;
    const lat = r.geom?.lat;
    if (!isNum(lon) || !isNum(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const price = r.gazole_prix;
    if (!isNum(price) || price < FUEL.PRICE_MIN || price > FUEL.PRICE_MAX) continue;
    const d = typeof r.gazole_maj === 'string' ? new Date(r.gazole_maj) : null;
    const services = Array.isArray(r.services_service) ? r.services_service
      : typeof r.services_service === 'string' ? r.services_service.split('//') : [];
    seen.add(id);
    out.push({
      id, address: text(r.adresse), city: text(r.ville), cp: text(r.cp, 10), lon, lat, price,
      updated: d && Number.isFinite(d.getTime()) ? d : null,
      hgv: services.some((s) => typeof s === 'string' && s.trim() === FUEL.HGV_SERVICE),
    });
  }
  return out;
}

/**
 * Stations à moins de RADIUS_M du tracé, triées par prix du gazole puis par distance depuis le départ.
 * @param {{ from?:number[]|null }} opts from : position (guidage) → seulement les stations devant
 * @returns {object[]} stations + { along (m depuis le départ), offset (m au tracé), ahead (m depuis from) }
 */
export function stationsAlongRoute(stations, route, { from = null, radius = FUEL.RADIUS_M } = {}) {
  if (!Array.isArray(route?.coordinates) || route.coordinates.length < 2) return [];
  const line = prepareLine(route.coordinates);
  const origin = Array.isArray(from) && isNum(from[0]) && isNum(from[1]) ? locateOnLine(line, from).along : 0;
  const out = [];
  for (const s of Array.isArray(stations) ? stations : []) {
    const loc = locateOnLine(line, [s.lon, s.lat]);
    if (loc.distance > radius) continue;
    if (loc.along < origin) continue;
    out.push({ ...s, along: loc.along, offset: loc.distance, ahead: loc.along - origin });
  }
  return out.sort((a, b) => a.price - b.price || a.along - b.along);
}

const pad = (n) => String(n).padStart(2, '0');

/** Date de mise à jour (heure de la tablette) : « 23/11 à 14 h 35 ». */
export function updatedText(d) {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return 'date inconnue';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} à ${d.getHours()} h ${pad(d.getMinutes())}`;
}

/** Détour aller-retour estimé à vol d'oiseau (2 × écart au tracé). */
export function detourMeters(offset) {
  return isNum(offset) && offset > 0 ? 2 * offset : 0;
}

/** Textes d'une ligne de station. */
export function describeStation(s, { now = new Date() } = {}) {
  const old = !(s.updated instanceof Date) || now.getTime() - s.updated.getTime() > FUEL.OLD_MS;
  const detour = detourMeters(s.offset);
  return {
    price: `${formatPricePerLiter(s.price)} €/L`,
    place: [s.address, [s.cp, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Adresse inconnue',
    where: `à ${formatDistance(s.ahead ?? s.along ?? 0)}`,
    detour: detour < 100 ? 'sur le trajet' : `détour ≈ ${formatDistance(detour)} à vol d'oiseau`,
    updated: `mis à jour le ${updatedText(s.updated)}`,
    old,
    hgv: s.hgv === true,
  };
}

/** Coût du trajet au prix d'une station : km × consommation du profil × prix. */
export function tripFuelCost(route, vehicle, price) {
  const liters = fuelEstimate(route?.distance, vehicle?.consumption);
  if (liters === null) return { ok: false, text: FUEL.NO_CONSUMPTION_TEXT };
  const cost = fuelCost(liters, price);
  if (cost === null) return { ok: false, text: FUEL.ERROR_TEXT };
  return { ok: true, liters, cost, text: `Coût du trajet à ce prix : ≈ ${formatEuros(cost)} (≈ ${Math.round(liters)} L)` };
}

/** Filtres « Piste PL seulement » et « OK camion seulement ». */
export function filterStations(list, { hgvOnly = false, okOnly = false, okIds = new Set() } = {}) {
  return list.filter((s) => (!hgvOnly || s.hgv) && (!okOnly || okIds.has(s.id)));
}

/** « Mes stations OK camion » (champ fuelStations de gabarit.data, exporté) : invalides et doublons écartés. */
export function sanitizeFuelStations(raw) {
  const out = [];
  const seen = new Set();
  for (const s of Array.isArray(raw) ? raw : []) {
    if (!s || typeof s !== 'object') continue;
    const id = Number(s.id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    if (!isNum(s.lon) || !isNum(s.lat) || Math.abs(s.lat) > 90 || Math.abs(s.lon) > 180) continue;
    const at = typeof s.addedAt === 'string' && Number.isFinite(Date.parse(s.addedAt)) ? s.addedAt : null;
    seen.add(id);
    out.push({ id, name: text(s.name), lon: s.lon, lat: s.lat, addedAt: at });
    if (out.length >= FUEL.MAX_OK) break;
  }
  return out;
}

/** Ajoute ou retire une station de « Mes stations OK camion ». */
export function toggleFuelStation(list, station, now = new Date()) {
  const clean = sanitizeFuelStations(list);
  if (clean.some((s) => s.id === station.id)) return clean.filter((s) => s.id !== station.id);
  const name = [station.address, station.city].filter(Boolean).join(', ');
  return sanitizeFuelStations([{ id: station.id, name, lon: station.lon, lat: station.lat, addedAt: now.toISOString() }, ...clean]);
}

/**
 * Chargement paresseux du module d'interface (src/ui/fuel.js, hors précache du service worker) : un échec (hors
 * ligne) donne un message, jamais un bouton muet ; l'essai suivant recommence.
 * @param {() => Promise<object>} importer
 * @returns {() => Promise<{ ok:true, mod:object }|{ ok:false, text:string }>}
 */
export function lazyLoader(importer) {
  let pending = null;
  return async () => {
    pending ??= importer();
    try {
      return { ok: true, mod: await pending };
    } catch {
      pending = null;
      return { ok: false, text: FUEL.OFFLINE_TEXT };
    }
  };
}

/** Message d'échec d'une requête de prix (hors ligne ou réponse refusée). */
export function fetchErrorText(err, online = true) {
  if (!online || err?.name === 'TypeError') return FUEL.OFFLINE_TEXT;
  return FUEL.ERROR_TEXT;
}
