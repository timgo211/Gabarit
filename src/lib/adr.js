// Matières dangereuses (ADR, phase 5b) : code de restriction en tunnel du véhicule, catégorie des tunnels du trajet,
// alertes avant le départ et en guidage. Logique pure.
//
// Sources :
// - Accord ADR (CEE-ONU, édition 2025 ; unece.org refuse l'accès depuis le conteneur de développement : règles citées
//   d'après le texte connu, à vérifier) : 1.9.5.2.2 — cinq catégories de tunnels, A (aucune restriction) à E
//   (« restriction pour toutes les marchandises dangereuses autres que les nos ONU 2919, 3291, 3331, 3359 et 3373 ») ;
//   8.6.3 — le code de restriction en tunnel du chargement figure sur le document de transport ; 8.6.4 — un code B
//   interdit les tunnels de catégories B, C, D et E, un code C les catégories C, D et E, un code D les catégories D et
//   E, un code E la catégorie E. Codes combinés (B1000C, B/D, C5000D, C/D, C/E, D/E) : la lettre qui s'applique dépend
//   du chargement (citerne, masse nette d'explosifs) ; le conducteur choisit dans le profil la lettre qui s'applique.
// - Bison Futé, « Interdictions dans les principaux tunnels » (www.bison-fute.gouv.fr/principaux-tunnels.html, lu le
//   20/11/2026) : « Tunnel de Fourvière (69) – Catégorie E ; Tunnel du Fréjus (73) – Catégorie C ; Tunnel du Mont-Blanc
//   (74) – Catégorie E », d'après la note CETU du 17 juillet 2009 (TMD dans les tunnels, obligatoire depuis le
//   1er janvier 2010). Ces trois tunnels sont gardés en dur (KNOWN_TUNNELS), même sans données OpenStreetMap.
// - Tunnels OpenStreetMap (wiki « Key:hazmat », section « ADR tunnel restriction key suffixes ») : hazmat:B=no …
//   hazmat:E=no = interdit aux chargements de ce code ; un tunnel de catégorie C porte hazmat:C=no (et souvent
//   hazmat:B=no) : catégorie = plus haute lettre marquée « no » (même lecture que GraphHopper, OSMHazmatTunnelParser) ;
//   hazmat:adr_tunnel_cat=A…E (rare) ; hazmat=B…E (lettre en valeur, rare) ; hazmat=no : toutes matières
//   dangereuses interdites (panneau sans lettre). Nom du tunnel : tunnel:name d'abord (le name d'une voie en tunnel
//   est souvent celui de la route : « Autoroute du Soleil » pour Fourvière).
// - OpenRouteService (code source, HazmatAccessParser / HeavyVehicleEdgeFilter) : avec restrictions.hazmat=true, toute
//   voie hazmat=no ou hazmat:B…E=no est évitée, QUELLE QUE SOIT la lettre ; hazmat:adr_tunnel_cat n'est pas lu.
//   L'itinéraire peut donc être plus long que nécessaire pour un code D ou E, et un tunnel marqué seulement par sa
//   catégorie n'est pas évité : d'où les alertes ci-dessous.
// - Arrêté du 16 avril 2021 (interdictions PL) : aucun horaire propre au transport de matières dangereuses ; mêmes
//   interdictions que les autres PL de plus de 7,5 t ; la dérogation préfectorale 7° de l'art. 5 (unité de production)
//   exclut ce transport ; dérogations « service continu » pour ce transport selon l'annexe III.

import { prepareLine, pointAt, haversine } from './nav-geo.js';
import { timeAt } from './areas-route.js';

export const ADR = Object.freeze({
  DATA_PATH: './data/tunnels-adr.json',
  /** Codes de restriction en tunnel proposés dans le profil ('' = non renseigné ; 'none' = chargement sans code). */
  TUNNEL_CODES: Object.freeze(['', 'B', 'C', 'D', 'E', 'none']),
  CLASSES: Object.freeze(['', '1', '2', '3', '4.1', '4.2', '4.3', '5.1', '5.2', '6.1', '6.2', '7', '8', '9']),
  /** ADR 1.9.5.2.2, catégorie E : numéros ONU sans code de restriction en tunnel. */
  NO_CODE_UN: Object.freeze(['2919', '3291', '3331', '3359', '3373']),
  /** Un point du tube à moins de 35 m du tracé : le tracé passe par là. */
  MATCH_M: 35,
  /** Points du tube examinés (extrémités comprises). */
  CHECK_POINTS: 5,
  /** Bandeau du guidage sous 20 km, annonce une fois vers 5 km (pas sous 1 km). */
  BANNER_M: 20000,
  ANNOUNCE_M: 5000,
  ANNOUNCE_MIN_M: 1000,
  /** « Éviter le tunnel » : carré de 80 m autour du milieu du tube (options.avoid_polygons d'ORS). */
  AVOID_SQUARE_M: 80,
  SIGNAGE: 'la signalisation fait foi',
  UNAVAILABLE_TEXT: 'Alerte tunnels indisponible (données non chargées). Les tunnels de Fourvière, du Fréjus et du Mont-Blanc restent vérifiés ; la signalisation fait foi.',
  LOADING_TEXT: 'Alerte tunnels : chargement des données…',
  NO_CODE_TEXT: 'Code tunnel non renseigné dans le profil véhicule : aucune alerte tunnel.',
  ORS_TEXT: 'Matières dangereuses : OpenRouteService évite tous les tunnels et routes signalés interdits aux matières dangereuses, quel que soit ton code tunnel. L\'itinéraire peut être plus long que nécessaire.',
  REMINDER_TEXT: 'ADR : mêmes interdictions de circulation que les autres PL (week-ends, jours fériés : arrêté du 16 avril 2021), dérogations seulement par arrêté préfectoral ; document de transport, consignes écrites et équipements à bord ; la signalisation fait foi.',
  SOURCE: 'Tunnels : © contributeurs OpenStreetMap (ODbL) et Bison Futé (Fourvière, Fréjus, Mont-Blanc) ; accord ADR 1.9.5 et 8.6.4.',
});

/** Rang d'une lettre (B le plus dangereux, E le moins). */
const RANK = Object.freeze({ B: 1, C: 2, D: 3, E: 4 });
/** Catégorie « X » : hazmat=no, toutes les matières dangereuses interdites. */
export const CATEGORY_ALL = 'X';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isPoint = (p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]);

/**
 * Trois tunnels gardés en dur (Bison Futé, voir en tête), même si data/tunnels-adr.json est absent. Tracé de chaque
 * tube d'après OpenStreetMap (recoupé par l'Action « Tunnels ADR » : catégorie lue dans OSM et écrite dans le journal).
 */
export const KNOWN_TUNNELS = Object.freeze([
  Object.freeze({
    id: 'known:fourviere', name: 'Tunnel de Fourvière', cat: 'E', known: true,
    note: 'Interdit aussi aux PL de plus de 7,5 t et de plus de 4,50 m (arrêté DDT69/Métropole de Lyon du 2 avril 2019).',
    tubes: Object.freeze([]),
  }),
  Object.freeze({
    id: 'known:frejus', name: 'Tunnel du Fréjus', cat: 'C', known: true,
    note: 'Règlement du tunnel : classe 1 interdite, autres classes selon le conditionnement ; classe 2 (codes 2A, 2O, 3A, 3O) admise (Bison Futé, sftrf.fr).',
    // OSM (API, 20/11/2026) : tube 1 = w101986702 « Tunnel Routier du Fréjus » + w24593777 « Traforo Stradale del
    // Frejus », hazmat de catégorie C (= Bison Futé) ; tube 2 = w317397424 + w1476732975 + w849010780 (sans catégorie).
    tubes: Object.freeze([Object.freeze([[6.67746,45.19582],[6.67934,45.19549],[6.68212,45.19391],[6.68437,45.19052],[6.68494,45.17842],[6.68154,45.16095],[6.682,45.15391],[6.68756,45.14007],[6.69369,45.12416],[6.71297,45.0894],[6.71347,45.08801],[6.71337,45.08674]]), Object.freeze([[6.7138,45.08677],[6.71417,45.08785],[6.71372,45.0889],[6.69855,45.11551],[6.69385,45.12417],[6.688,45.14003],[6.68293,45.15412],[6.68221,45.15762],[6.68243,45.16088],[6.68545,45.17744],[6.68508,45.19058],[6.68479,45.19184],[6.68426,45.19294],[6.68333,45.19396],[6.68232,45.19472],[6.67992,45.19562],[6.67748,45.19593]])]),
  }),
  Object.freeze({
    id: 'known:montblanc', name: 'Tunnel du Mont-Blanc', cat: 'E', known: true,
    note: 'PL de plus de 3,5 t : accréditation obligatoire avant le tunnel (Passy-Le Fayet ou Aoste).',
    // OSM (API, 20/11/2026) : w1212015047 + w4525912 « Tunnel du Mont Blanc » (côté français, sans catégorie) +
    // w205544546 « Traforo del Monte Bianco » (hazmat=no) ; Bison Futé : catégorie E, gardée.
    tubes: Object.freeze([Object.freeze([[6.86128,45.90122],[6.86287,45.90086],[6.8782,45.88706],[6.92139,45.84674],[6.9517,45.8181]])]),
  }),
]);

// ───────── Profil véhicule ─────────

/** Code qui s'applique au chargement : null = aucune vérification (code non renseigné ou pas d'ADR). */
export function effectiveCode(vehicle) {
  if (!vehicle?.hazmat) return null;
  const code = vehicle.tunnelCode ?? '';
  if (!code) return null;
  const un = String(vehicle.unNumber ?? '').replace(/^UN\s*/i, '').trim();
  if (ADR.NO_CODE_UN.includes(un)) return 'none';
  return code;
}

/** Libellé court du code (« code C », « sans code tunnel »). */
export function codeText(code) {
  return code === 'none' ? 'sans code tunnel' : `code ${code}`;
}

/** Catégorie de tunnel lue dans les étiquettes OSM, ou null (pas de restriction connue, catégorie A). */
export function categoryFromTags(tags) {
  const t = tags && typeof tags === 'object' ? tags : {};
  const h = String(t.hazmat ?? '').trim();
  if (/^no$/i.test(h)) return CATEGORY_ALL;
  // hazmat=E (lettre en valeur, rare : tunnel du Mont-Blanc côté français) : catégorie de cette lettre.
  if (/^[B-E]$/i.test(h)) return h.toUpperCase();
  for (const key of ['hazmat:adr_tunnel_cat', 'hazmat:tunnel_cat']) {
    const v = String(t[key] ?? '').trim().toUpperCase();
    if (/^[A-E]$/.test(v)) return v === 'A' ? null : v;
  }
  for (const letter of ['E', 'D', 'C', 'B']) {
    if (/^no$/i.test(String(t[`hazmat:${letter}`] ?? '').trim())) return letter;
  }
  return null;
}

/** ADR 8.6.4 : le tunnel de catégorie `cat` est-il interdit au code `code` ? */
export function isForbidden(cat, code) {
  if (!code) return false;
  if (cat === CATEGORY_ALL) return true;
  if (code === 'none' || !RANK[cat] || !RANK[code]) return false;
  return RANK[code] <= RANK[cat];
}

export function categoryText(cat) {
  return cat === CATEGORY_ALL ? 'interdit aux matières dangereuses' : `catégorie ${cat}`;
}

// ───────── Données (data/tunnels-adr.json) ─────────

function cleanLine(g) {
  if (!Array.isArray(g)) return null;
  const pts = g.filter(isPoint).map((p) => [p[0], p[1]]);
  return pts.length >= 2 ? pts : null;
}

/**
 * Lit data/tunnels-adr.json. Fichier absent, illisible ou vide : { ok:false } (l'appli affiche UNAVAILABLE_TEXT).
 * @returns {{ ok:boolean, tunnels:object[], updated:string|null }}
 */
export function parseTunnelData(json) {
  const list = Array.isArray(json?.tunnels) ? json.tunnels : [];
  const tunnels = [];
  for (const t of list) {
    const g = cleanLine(t?.g);
    const cat = typeof t?.cat === 'string' && (RANK[t.cat] || t.cat === CATEGORY_ALL) ? t.cat : null;
    if (!g || !cat) continue;
    tunnels.push({
      id: typeof t.id === 'string' ? t.id.slice(0, 40) : `t${tunnels.length}`,
      name: typeof t.name === 'string' ? t.name.trim().slice(0, 80) : '',
      ref: typeof t.ref === 'string' ? t.ref.trim().slice(0, 30) : '',
      cat, tubes: [g],
    });
  }
  const updated = typeof json?.updated === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json.updated) ? json.updated : null;
  return { ok: tunnels.length > 0, tunnels, updated };
}

// ───────── Placement sur le tracé ─────────

/** Points régulièrement espacés le long d'un tube (extrémités comprises). */
export function checkPoints(g, n = ADR.CHECK_POINTS) {
  if (g.length < 2) return g.slice();
  const line = prepareLine(g);
  const out = [];
  for (let k = 0; k < n; k += 1) out.push(pointAt(line, (line.total * k) / (n - 1)).point);
  return out;
}

const CELL = 0.01; // ≈ 1 km
const cellKey = (x, y) => `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;

/** Index des segments du tracé par cases de 0,01° (recherche rapide des tunnels proches). */
function indexLine(line) {
  const grid = new Map();
  const c = line.coords;
  for (let i = 0; i < c.length - 1; i += 1) {
    const x0 = Math.floor(Math.min(c[i][0], c[i + 1][0]) / CELL);
    const x1 = Math.floor(Math.max(c[i][0], c[i + 1][0]) / CELL);
    const y0 = Math.floor(Math.min(c[i][1], c[i + 1][1]) / CELL);
    const y1 = Math.floor(Math.max(c[i][1], c[i + 1][1]) / CELL);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) continue; // segment aberrant (> 20 km) : ignoré
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const k = `${x}:${y}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  }
  return grid;
}

/** Point du tracé le plus proche de p (cases voisines seulement), ou null au-delà d'environ 1 km. */
function nearest(line, grid, p) {
  const RAD = Math.PI / 180;
  const kx = Math.cos(p[1] * RAD) * 111320;
  const ky = 110540;
  const cx = Math.floor(p[0] / CELL);
  const cy = Math.floor(p[1] / CELL);
  const seen = new Set();
  let best = null;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (const i of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const a = line.coords[i]; const b = line.coords[i + 1];
        const ax = (a[0] - p[0]) * kx; const ay = (a[1] - p[1]) * ky;
        const vx = (b[0] - a[0]) * kx; const vy = (b[1] - a[1]) * ky;
        const len2 = vx * vx + vy * vy;
        const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * vx + ay * vy) / len2)) : 0;
        const d = Math.hypot(ax + t * vx, ay + t * vy);
        if (!best || d < best.distance) best = { distance: d, along: line.cum[i] + t * (line.cum[i + 1] - line.cum[i]) };
      }
    }
  }
  return best;
}

/** Passage du tracé dans un tube : { enter, exit } (m depuis le départ), ou null. */
function tubePassage(line, grid, g) {
  const pts = checkPoints(g);
  const alongs = [];
  for (const p of pts) {
    const n = nearest(line, grid, p);
    if (!n || n.distance > ADR.MATCH_M) return null;
    alongs.push(n.along);
  }
  // Les points du tube doivent se suivre sur le tracé (dans un sens ou dans l'autre).
  const up = alongs.every((a, i) => i === 0 || a >= alongs[i - 1] - 5);
  const down = alongs.every((a, i) => i === 0 || a <= alongs[i - 1] + 5);
  if (!up && !down) return null;
  return { enter: Math.min(...alongs), exit: Math.max(...alongs) };
}

/** Tunnels connus (en dur) et tunnels des données, dans une seule liste. */
export function tunnelPool(data) {
  return [...KNOWN_TUNNELS.filter((t) => t.tubes.length), ...(data?.tunnels ?? [])];
}

/**
 * Tunnels signalés (catégorie connue) traversés par l'itinéraire, triés depuis le départ.
 * Deux tubes qui se chevauchent sur le tracé (tunnel découpé en plusieurs voies, tunnel connu + OSM) : un seul
 * passage ; un tunnel connu (Bison Futé) garde sa catégorie, sinon la plus restrictive est gardée.
 * @param {{ coordinates:number[][], steps?:object[], duration?:number }} route
 * @param {{ data?:{ tunnels:object[] }|null, vehicle?:object, departure?:Date, elapsed?:(t:number)=>number }} ctx
 * @returns {{ id, name, cat, known, note, enter, exit, time, at:Date, forbidden:boolean, code:string|null }[]}
 */
export function tunnelsAlongRoute(route, { data = null, vehicle = null, departure = new Date(), elapsed = (t) => t } = {}) {
  if (!Array.isArray(route?.coordinates) || route.coordinates.length < 2) return [];
  const line = prepareLine(route.coordinates);
  const grid = indexLine(line);
  const code = effectiveCode(vehicle);
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  for (const [x, y] of line.coords) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const found = [];
  for (const t of tunnelPool(data)) {
    for (const g of t.tubes) {
      if (!g.some(([x, y]) => x >= w - 0.02 && x <= e + 0.02 && y >= s - 0.02 && y <= n + 0.02)) continue;
      const pass = tubePassage(line, grid, g);
      if (pass) { found.push({ t, ...pass }); break; }
    }
  }
  found.sort((a, b) => a.enter - b.enter);
  const merged = [];
  for (const f of found) {
    const prev = merged[merged.length - 1];
    if (prev && f.enter <= prev.exit + 50) {
      prev.exit = Math.max(prev.exit, f.exit);
      if (f.t.known && !prev.known) Object.assign(prev, { id: f.t.id, name: f.t.name, cat: f.t.cat, known: true, note: f.t.note });
      else if (!prev.known && rankAll(f.t.cat) < rankAll(prev.cat)) prev.cat = f.t.cat;
      if (!prev.name && f.t.name) prev.name = f.t.name;
      continue;
    }
    merged.push({
      id: f.t.id, name: f.t.name || (f.t.ref ? `Tunnel (${f.t.ref})` : ''), cat: f.t.cat, known: !!f.t.known,
      note: f.t.note ?? null, enter: f.enter, exit: f.exit, mid: pointAt(line, (f.enter + f.exit) / 2).point,
    });
  }
  return merged.map((p) => {
    const time = elapsed(timeAt(route, line, p.enter));
    return { ...p, time, at: new Date(departure.getTime() + time * 1000), forbidden: isForbidden(p.cat, code), code };
  });
}

/** Rang pour garder la catégorie la plus restrictive (X avant E avant D…). */
const rankAll = (cat) => (cat === CATEGORY_ALL ? 0 : 5 - (RANK[cat] ?? 5));

// ───────── Textes ─────────

const km = (m) => `km ${Math.round(m / 1000)}`;
const hhmm = (d) => `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
export const tunnelName = (p) => p.name || 'Tunnel sans nom';

/** Fiche : tunnel interdit au code du véhicule. */
export function describeForbidden(p) {
  const why = p.cat === CATEGORY_ALL ? 'interdit aux matières dangereuses' : `(catégorie ${p.cat}) interdit au ${codeText(p.code)}`;
  return `${tunnelName(p)} ${why} : vous y seriez vers ${km(p.enter)} (vers ${hhmm(p.at)}).${p.note ? ` ${p.note}` : ''} ${capital(ADR.SIGNAGE)}.`;
}

/** Fiche : tunnel signalé, autorisé au code du véhicule. */
export function describeAllowed(p) {
  return `${tunnelName(p)} (${categoryText(p.cat)}) vers ${km(p.enter)} : autorisé au ${codeText(p.code)}.${p.note ? ` ${p.note}` : ''} ${capital(ADR.SIGNAGE)}.`;
}

/** Aucun tunnel signalé : jamais « trajet sans tunnel interdit ». */
export function noTunnelText(updated) {
  const date = updated ? ` (copie du ${updated.slice(8, 10)}/${updated.slice(5, 7)})` : '';
  return `Aucun tunnel signalé dans les données${date}, ${ADR.SIGNAGE}.`;
}

function capital(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Autres itinéraires proposés qui ne passent par aucun tunnel interdit (pour la fiche de l'itinéraire choisi).
 * @param {{ label:string, forbidden:number }[]} options nombre de tunnels interdits par itinéraire
 */
export function avoidingOptionsText(options, selected) {
  if (!(options?.[selected]?.forbidden > 0)) return null;
  const free = options.filter((o, i) => i !== selected && o.forbidden === 0).map((o) => `« ${o.label} »`);
  if (!free.length) return null;
  return `${free.length > 1 ? 'Les itinéraires' : 'L\'itinéraire'} ${free.join(', ')} ${free.length > 1 ? 'évitent' : 'évite'} ce tunnel : touche sa fiche pour le choisir.`;
}

// ───────── Guidage ─────────

const distText = (m) => (m >= 1000 ? `${(Math.round(m / 100) / 10).toString().replace('.', ',')} km` : `${Math.round(m)} m`);

export function tunnelBannerText(p, distance) {
  const what = p.cat === CATEGORY_ALL ? 'interdit aux matières dangereuses' : `interdit (${codeText(p.code)})`;
  return distance > 0 ? `${tunnelName(p)} dans ${distText(distance)} : ${what} · ${ADR.SIGNAGE}`
    : `${tunnelName(p)} : ${what} · ${ADR.SIGNAGE}`;
}

export function tunnelAnnounceText(p, distance) {
  return `Attention, ${tunnelName(p).toLowerCase()} dans ${Math.round(distance / 1000)} kilomètres, interdit à votre chargement. Suivez la signalisation.`;
}

/**
 * Guidage : prochain tunnel interdit devant le véhicule (bandeau sous 20 km, annonce une fois vers 5 km).
 * @param {object[]} passages tunnelsAlongRoute
 * @returns {{ view:{ name:string, distance:number, text:string }|null, speak:string|null, announced:object }}
 */
export function guidanceTunnel(passages, along, announced = {}) {
  const next = (passages ?? []).find((p) => p.forbidden && p.exit >= along);
  if (!next) return { view: null, speak: null, announced };
  const distance = Math.max(0, next.enter - along);
  if (distance > ADR.BANNER_M) return { view: null, speak: null, announced };
  const key = `${next.id}:${Math.round(next.enter)}`;
  const out = { ...announced };
  let speak = null;
  if (!out[key] && distance <= ADR.ANNOUNCE_M && distance >= ADR.ANNOUNCE_MIN_M) {
    out[key] = true;
    speak = tunnelAnnounceText(next, distance);
  }
  return { view: { name: tunnelName(next), distance, text: tunnelBannerText(next, distance) }, speak, announced: out };
}

// ───────── Éviter le tunnel (options.avoid_polygons d'ORS) ─────────

/** Carré de côté `size` (m) centré sur p, anneau GeoJSON fermé. */
export function squareAround(p, size = ADR.AVOID_SQUARE_M) {
  const RAD = Math.PI / 180;
  const dy = size / 2 / 110540;
  const dx = size / 2 / (Math.cos(p[1] * RAD) * 111320);
  const r = (x) => Math.round(x * 1e6) / 1e6;
  return [[r(p[0] - dx), r(p[1] - dy)], [r(p[0] + dx), r(p[1] - dy)], [r(p[0] + dx), r(p[1] + dy)], [r(p[0] - dx), r(p[1] + dy)], [r(p[0] - dx), r(p[1] - dy)]];
}

/**
 * Zones à éviter pour les tunnels interdits, ajoutées à celles déjà évitées (ZFE). Mêmes limites de l'API publique
 * d'ORS que pour les ZFE (150 km à vol d'oiseau avec zones à éviter).
 * @returns {{ ok:true, geometry:object }|{ ok:false, text:string }}
 */
export function avoidTunnelsFor(passages, { start, end, existing = null, maxDistance = 150000 }) {
  const list = (passages ?? []).filter((p) => p.forbidden && isPoint(p.mid));
  if (!list.length) return { ok: false, text: 'Aucun tunnel interdit sur cet itinéraire.' };
  if (!isPoint(start) || !isPoint(end) || haversine(start, end) > maxDistance) {
    return {
      ok: false,
      text: 'Éviter le tunnel : impossible pour ce trajet. OpenRouteService (service gratuit) ne contourne une zone que si le départ et l\'arrivée sont à 150 km au plus à vol d\'oiseau. Choisis un autre itinéraire proposé ou ajoute une étape ; la signalisation fait foi.',
    };
  }
  const polygons = [];
  if (existing?.type === 'MultiPolygon' && Array.isArray(existing.coordinates)) polygons.push(...existing.coordinates);
  else if (existing?.type === 'Polygon' && Array.isArray(existing.coordinates)) polygons.push(existing.coordinates);
  for (const p of list) polygons.push([squareAround(p.mid)]);
  return { ok: true, geometry: { type: 'MultiPolygon', coordinates: polygons } };
}
