// Aires et parkings PL d'OpenStreetMap (phase 9), lus via l'API Overpass. Logique pure : construction de la requête
// (une seule par calcul) et lecture de la réponse. Les appels réseau sont dans src/ui/areas.js.
//
// Étiquettes OpenStreetMap (wiki.openstreetmap.org) :
// - highway=rest_area : aire de repos ; highway=services : aire de service (carburant, restaurant…) ;
// - amenity=parking + hgv=yes/designated : parking accessible / réservé aux poids lourds ;
// - capacity:hgv : nombre de places PL ; fee : payant ; supervised : gardé / surveillé ; lit : éclairé ;
// - toilets, shower, drinking_water, wifi (internet_access), restaurant / fuel en étiquettes de l'aire.
// Données © contributeurs OpenStreetMap, licence ODbL (attribution affichée sur la fiche et dans la liste).
//
// Overpass (wiki « Overpass API/Overpass QL ») : filtre around:rayon,lat1,lon1,lat2,lon2,… sur une ligne ;
// « out center tags » donne le centre des voies et relations (aires dessinées en surface).

import { haversine } from './ors-response.js';

/** Serveurs Overpass publics gratuits, dans l'ordre d'essai (le second en secours). */
export const OVERPASS_ENDPOINTS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]);

export const AREAS_OSM = Object.freeze({
  /** Rayon autour du tracé pour les aires de repos / de service (m). */
  REST_RADIUS_M: 400,
  /** Rayon pour les parkings PL (souvent un peu à l'écart de la route, m). */
  PARKING_RADIUS_M: 800,
  /** Nombre maximal de points du tracé envoyés à Overpass (requête courte, serveur ménagé). */
  MAX_POINTS: 400,
  /** Tolérances de simplification essayées (m) ; l'écart est ajouté au rayon de la requête. */
  TOLERANCES_M: [20, 50, 100, 200, 400],
  /** Délai côté serveur (s) et côté appli (ms) avant d'essayer le serveur suivant. */
  SERVER_TIMEOUT_S: 25,
  CLIENT_TIMEOUT_MS: 30000,
  /** Un parking PL à moins de 300 m d'une aire OSM est rattaché à l'aire (places additionnées). */
  ATTACH_PARKING_M: 300,
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const RAD = Math.PI / 180;

/** Distance (m) de p au segment [a, b] (plan local ; kx : mètres par degré de longitude). */
function segmentDistance(p, a, b, kx = Math.cos(p[1] * RAD) * 111320) {
  const ky = 110540;
  const ax = (a[0] - p[0]) * kx; const ay = (a[1] - p[1]) * ky;
  const dx = (b[0] - a[0]) * kx; const dy = (b[1] - a[1]) * ky;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Simplification de Douglas-Peucker (itérative), tolérance en mètres. */
export function simplifyLine(input, tolerance) {
  if (!Array.isArray(input) || input.length <= 2) return Array.isArray(input) ? input.slice() : [];
  const kx = Math.cos(input[Math.floor(input.length / 2)][1] * RAD) * 111320;
  // Points plus proches que la tolérance du dernier gardé : retirés d'abord (tracés ORS très denses en ville).
  const coords = [input[0]];
  for (let i = 1; i < input.length - 1; i += 1) {
    const q = coords[coords.length - 1];
    if (Math.hypot((input[i][0] - q[0]) * kx, (input[i][1] - q[1]) * 110540) >= tolerance) coords.push(input[i]);
  }
  coords.push(input[input.length - 1]);
  const keep = new Uint8Array(coords.length);
  keep[0] = 1; keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let max = -1; let at = -1;
    for (let k = i + 1; k < j; k += 1) {
      const d = segmentDistance(coords[k], coords[i], coords[j], kx);
      if (d > max) { max = d; at = k; }
    }
    if (max > tolerance && at > 0) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return coords.filter((_, k) => keep[k]);
}

/**
 * Une seule ligne qui passe par tous les itinéraires proposés (même départ, même arrivée), sans segment inventé :
 * A (départ → arrivée), puis B à l'envers (arrivée → départ), puis C (départ → arrivée). La requête couvre ainsi
 * tous les itinéraires en une fois, et changer d'itinéraire à l'arrêt ne demande aucune nouvelle requête.
 * @param {number[][][]} lines tracés [lon, lat] (même départ, même arrivée)
 */
export function combineRoutes(lines) {
  const ok = (Array.isArray(lines) ? lines : []).filter((l) => Array.isArray(l) && l.length > 1);
  const out = [];
  ok.forEach((l, i) => {
    const part = i % 2 === 1 ? l.slice().reverse() : l;
    out.push(...(out.length ? part.slice(1) : part));
  });
  return out;
}

/** Tracé simplifié pour la requête : au plus MAX_POINTS points ; renvoie aussi l'écart toléré (m). */
export function queryLine(coords, { maxPoints = AREAS_OSM.MAX_POINTS } = {}) {
  let line = coords;
  let tolerance = 0;
  for (const tol of AREAS_OSM.TOLERANCES_M) {
    line = simplifyLine(coords, tol);
    tolerance = tol;
    if (line.length <= maxPoints) break;
  }
  if (line.length > maxPoints) {
    // Très long trajet sinueux : on garde un point sur n (l'écart reste couvert par le rayon élargi).
    const step = Math.ceil(line.length / maxPoints);
    const last = line[line.length - 1];
    line = line.filter((_, i) => i % step === 0);
    if (line[line.length - 1] !== last) line.push(last);
    tolerance = Math.max(tolerance, AREAS_OSM.TOLERANCES_M.at(-1) * 2);
  }
  return { line, tolerance };
}

const fmt = (x) => (Math.round(x * 1e5) / 1e5).toString();

/**
 * Requête Overpass QL (une seule par calcul) : aires de repos / de service à 400 m du tracé, parkings PL à 800 m
 * (+ l'écart de simplification).
 * @param {number[][]} coords tracé [lon, lat] (combineRoutes pour plusieurs itinéraires)
 */
export function buildOverpassQuery(coords) {
  const { line, tolerance } = queryLine(coords);
  if (line.length < 2) throw new TypeError('Tracé trop court.');
  const pts = line.map(([lon, lat]) => `${fmt(lat)},${fmt(lon)}`).join(',');
  const rest = Math.round(AREAS_OSM.REST_RADIUS_M + tolerance);
  const park = Math.round(AREAS_OSM.PARKING_RADIUS_M + tolerance);
  return `[out:json][timeout:${AREAS_OSM.SERVER_TIMEOUT_S}];(`
    + `nwr["highway"~"^(rest_area|services)$"](around:${rest},${pts});`
    + `nwr["amenity"="parking"][~"^(hgv|capacity:hgv)$"~"^(yes|designated|[1-9][0-9]*)$"](around:${park},${pts});`
    + ');out center tags;';
}

/** Corps de la requête POST (formulaire : requête « simple », sans pré-vérification CORS). */
export function overpassBody(query) {
  return `data=${encodeURIComponent(query)}`;
}

const yes = (v) => (v === undefined ? null : /^(yes|designated|true|1|oui)$/i.test(String(v).trim()) ? true
  : /^(no|false|0|non)$/i.test(String(v).trim()) ? false : null);

function capacity(v) {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isInteger(n) && n > 0 && n < 2000 ? n : null;
}

/** Services connus d'après les étiquettes de l'élément. */
export function osmServices(tags) {
  const t = tags ?? {};
  const s = [];
  if (yes(t.toilets) || t.amenity === 'toilets') s.push('toilets');
  if (yes(t.shower) || yes(t.showers)) s.push('shower');
  if (yes(t.restaurant) || yes(t.food) || /restaurant|fast_food|cafe/.test(t.amenity ?? '')) s.push('food');
  if (yes(t.fuel) || t.amenity === 'fuel') s.push('fuel');
  if (yes(t.drinking_water)) s.push('water');
  if (/^(yes|wlan|wifi)$/i.test(t.internet_access ?? '') || yes(t.wifi)) s.push('wifi');
  return s;
}

function kindOf(tags) {
  if (tags.highway === 'services') return 'services';
  if (tags.highway === 'rest_area') return 'rest_area';
  return 'parking';
}

/**
 * Lit la réponse Overpass : une aire par élément, les parkings PL situés dans une aire rattachés à celle-ci.
 * @returns {object[]} aires { id, ids, source:'osm', kind, name, lon, lat, hgvPlaces, fee, price, secure, lit, services }
 */
export function parseOverpass(json) {
  const list = [];
  for (const e of Array.isArray(json?.elements) ? json.elements : []) {
    const lat = isNum(e?.lat) ? e.lat : e?.center?.lat;
    const lon = isNum(e?.lon) ? e.lon : e?.center?.lon;
    const tags = e?.tags && typeof e.tags === 'object' ? e.tags : null;
    if (!isNum(lat) || !isNum(lon) || !tags || !['node', 'way', 'relation'].includes(e.type) || !Number.isInteger(e.id)) continue;
    const kind = kindOf(tags);
    const hgv = tags.hgv;
    if (kind === 'parking' && /^no$/i.test(hgv ?? '')) continue;
    if (kind === 'parking' && !/^(yes|designated)$/i.test(hgv ?? '') && !capacity(tags['capacity:hgv'])) continue;
    const id = `osm:${e.type[0]}${e.id}`;
    const fee = yes(tags.fee);
    list.push({
      id, ids: [id], source: 'osm', sources: ['osm'], kind,
      name: String(tags.name ?? tags['name:fr'] ?? '').trim().slice(0, 80),
      lon, lat,
      hgvPlaces: capacity(tags['capacity:hgv']),
      hgvOnly: kind === 'parking' && /^designated$/i.test(hgv ?? ''),
      fee,
      price: typeof tags.charge === 'string' ? tags.charge.slice(0, 60) : null,
      secure: yes(tags.supervised) ?? (tags.surveillance ? true : null),
      lit: yes(tags.lit),
      services: osmServices(tags),
      road: null, direction: null, operator: typeof tags.operator === 'string' ? tags.operator.slice(0, 60) : null,
    });
  }
  // Parkings PL dessinés à l'intérieur d'une aire : une seule fiche (places additionnées, services réunis).
  const areas = list.filter((a) => a.kind !== 'parking');
  const out = [...areas.map((a) => ({ ...a, ids: [...a.ids], services: [...a.services] }))];
  for (const p of list.filter((a) => a.kind === 'parking')) {
    let host = null;
    let best = Infinity;
    for (const a of out) {
      if (a.kind === 'parking') continue;
      const d = haversine([a.lon, a.lat], [p.lon, p.lat]);
      if (d <= AREAS_OSM.ATTACH_PARKING_M && d < best) { host = a; best = d; }
    }
    if (!host) { out.push({ ...p }); continue; }
    if (p.hgvPlaces) host.hgvPlaces = (host.hgvPlaces ?? 0) + p.hgvPlaces;
    host.ids.push(p.id);
    for (const s of p.services) if (!host.services.includes(s)) host.services.push(s);
    if (host.fee === null) host.fee = p.fee;
    if (host.secure === null) host.secure = p.secure;
    if (host.lit === null) host.lit = p.lit;
    if (!host.price && p.price) host.price = p.price;
  }
  return out;
}
