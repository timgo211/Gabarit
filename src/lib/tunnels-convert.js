// Tunnels signalés aux matières dangereuses (phase 5b) : requête Overpass de l'Action hebdomadaire et conversion de
// la réponse en data/tunnels-adr.json. Logique pure (testée sous Node) ; le réseau est dans tools/tunnels-update.mjs.
//
// Pas de requête Overpass en direct depuis l'appli pour les tunnels : mesurée le 20/11/2026 sur un trajet de 520 km
// (A6 + A43), la requête « aires + tunnels » comme « tunnels seuls » dépassait 26 s (ou serveur plein, 502). Une copie
// hebdomadaire, lue sur l'appareil, ne dépend plus de la charge des serveurs.
// Données © contributeurs OpenStreetMap, licence ODbL (attribution dans la note de source des fiches).

import { categoryFromTags, KNOWN_TUNNELS, checkPoints } from './adr.js';
import { simplifyLine } from './areas-osm.js';
import { haversine } from './nav-geo.js';

export const TUNNELS_CONVERT = Object.freeze({
  /** France et pays voisins (Espagne, Portugal, Italie, Suisse, Autriche, Allemagne, Benelux) [sud, ouest, nord, est]. */
  BBOX: Object.freeze([35.9, -9.6, 55.1, 17.2]),
  /** Clés lues (wiki OSM « Key:hazmat ») : une requête par clé, toutes réunies. */
  KEYS: Object.freeze(['hazmat', 'hazmat:B', 'hazmat:C', 'hazmat:D', 'hazmat:E', 'hazmat:adr_tunnel_cat', 'hazmat:tunnel_cat']),
  SERVER_TIMEOUT_S: 180,
  /** Zone découpée en cases de 5° (petites requêtes : le 20/11/2026, la zone entière dépassait 300 s). */
  TILE_DEG: 5,
  /**
   * Serveurs de l'Action (dans l'ordre) : ceux de l'appli, puis deux serveurs publics de plus (wiki OSM « Overpass
   * API », instances publiques).
   */
  ENDPOINTS: Object.freeze([
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ]),
  /** Case en échec sur tous les serveurs : découpée en 4 (jusqu'à 1,25°), chaque morceau redemandé. */
  MIN_TILE_DEG: 1.25,
  /**
   * Recoupement des tunnels gardés en dur : API principale d'OpenStreetMap (/api/0.6/map, emprise ≤ 0,25 degré²),
   * sans Overpass. [ouest, sud, est, nord] autour de chaque tunnel.
   */
  KNOWN_BBOX: Object.freeze({
    'known:fourviere': Object.freeze([4.800, 45.750, 4.826, 45.774]),
    'known:frejus': Object.freeze([6.655, 45.075, 6.715, 45.195]),
    'known:montblanc': Object.freeze([6.840, 45.805, 6.970, 45.910]),
  }),
  /** Tube simplifié à 10 m près, 12 points au plus. */
  TOLERANCE_M: 10,
  MAX_POINTS: 12,
});

/** Requête Overpass QL pour une case [sud, ouest, nord, est] : voies en tunnel portant une étiquette hazmat, tracé compris. */
/** Une case [sud, ouest, nord, est] coupée en quatre. */
export function splitTile([s, w, n, e]) {
  const my = Math.round(((s + n) / 2) * 1000) / 1000;
  const mx = Math.round(((w + e) / 2) * 1000) / 1000;
  return [[s, w, my, mx], [s, mx, my, e], [my, w, n, mx], [my, mx, n, e]];
}

/** Cases de TILE_DEG degrés qui couvrent la zone [sud, ouest, nord, est]. */
export function tiles(bbox = TUNNELS_CONVERT.BBOX, step = TUNNELS_CONVERT.TILE_DEG) {
  const [s, w, n, e] = bbox;
  const out = [];
  for (let y = s; y < n; y += step) {
    for (let x = w; x < e; x += step) out.push([y, x, Math.min(n, y + step), Math.min(e, x + step)].map((v) => Math.round(v * 100) / 100));
  }
  return out;
}

export function buildTunnelsQuery(bbox = TUNNELS_CONVERT.BBOX) {
  const parts = TUNNELS_CONVERT.KEYS.map((k) => `way["${k}"]["tunnel"]["tunnel"!="no"]["highway"];`).join('');
  return `[out:json][timeout:${TUNNELS_CONVERT.SERVER_TIMEOUT_S}][bbox:${bbox.join(',')}];(${parts});out tags geom;`;
}

const r5 = (x) => Math.round(x * 1e5) / 1e5;

function shrink(g) {
  let line = simplifyLine(g, TUNNELS_CONVERT.TOLERANCE_M);
  if (line.length > TUNNELS_CONVERT.MAX_POINTS) {
    const step = Math.ceil(line.length / TUNNELS_CONVERT.MAX_POINTS);
    const last = line[line.length - 1];
    line = line.filter((_, i) => i % step === 0);
    if (line[line.length - 1] !== last) line.push(last);
  }
  return line.map(([x, y]) => [r5(x), r5(y)]);
}

/**
 * Réponse Overpass → contenu de data/tunnels-adr.json. Tunnels de catégorie A ou sans catégorie lisible : retirés.
 * @returns {{ data:{ source:string, license:string, updated:string|null, bbox:number[], tunnels:object[] }, log:string[] }}
 */
export function convertTunnels(json, { updated = null } = {}) {
  const log = [];
  const tunnels = [];
  const counts = {};
  let skipped = 0;
  for (const e of Array.isArray(json?.elements) ? json.elements : []) {
    if (e?.type !== 'way' || !Number.isInteger(e.id) || !Array.isArray(e.geometry)) continue;
    const g = e.geometry.filter((p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat)).map((p) => [p.lon, p.lat]);
    const cat = categoryFromTags(e.tags);
    if (!cat || g.length < 2) { skipped += 1; continue; }
    counts[cat] = (counts[cat] ?? 0) + 1;
    const t = e.tags ?? {};
    const name = String(t['tunnel:name'] ?? t.name ?? t['name:fr'] ?? '').trim().slice(0, 80);
    const out = { id: `w${e.id}`, cat, g: shrink(g) };
    if (name) out.name = name;
    if (typeof t.ref === 'string' && t.ref.trim()) out.ref = t.ref.trim().slice(0, 30);
    tunnels.push(out);
  }
  tunnels.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  log.push(`${tunnels.length} tubes gardés (${Object.entries(counts).map(([k, v]) => `${k === 'X' ? 'hazmat=no' : k} : ${v}`).join(', ') || 'aucun'}), ${skipped} sans catégorie (A ou illisible).`);
  return {
    data: {
      source: 'OpenStreetMap (Overpass API), voies en tunnel portant hazmat, hazmat:B…E, hazmat:adr_tunnel_cat',
      license: 'ODbL, © contributeurs OpenStreetMap',
      updated, bbox: [...TUNNELS_CONVERT.BBOX], tunnels,
    },
    log,
  };
}

/**
 * Recoupement des tunnels gardés en dur (Bison Futé) avec OpenStreetMap : tubes OSM du même nom, ou à moins de
 * 2 km du point donné, et leur catégorie. Écrit dans le journal de l'Action.
 * @param {object} json réponse Overpass brute
 * @param {{ name:RegExp, near:number[] }[]} probes
 */
export function crossCheck(json, probes) {
  const lines = [];
  for (const probe of probes) {
    const hits = [];
    for (const e of Array.isArray(json?.elements) ? json.elements : []) {
      if (e?.type !== 'way' || !Array.isArray(e.geometry) || e.geometry.length < 2) continue;
      const g = e.geometry.map((p) => [p.lon, p.lat]);
      const name = String(e.tags?.['tunnel:name'] ?? e.tags?.name ?? '');
      const mid = checkPoints(g, 3)[1];
      if (!probe.name.test(name) && haversine(mid, probe.near) > 2000) continue;
      hits.push(`w${e.id} « ${name} » catégorie OSM ${categoryFromTags(e.tags) ?? '?'} ; tracé ${JSON.stringify(shrink(g))}`);
    }
    lines.push(`${probe.label} (Bison Futé : ${probe.cat}) : ${hits.length ? hits.join(' | ') : 'absent des données OSM'}`);
  }
  return lines;
}

/**
 * Tubes d'un tunnel gardé en dur lus dans une réponse JSON de l'API OSM /api/0.6/map (éléments node et way) : voies
 * highway + tunnel dont le nom correspond. Renvoie [{ id, name, cat, g }] (tracé simplifié, catégorie OSM).
 */
export function knownTubesFromMap(json, nameRe) {
  const nodes = new Map();
  for (const e of Array.isArray(json?.elements) ? json.elements : []) {
    if (e?.type === 'node' && Number.isFinite(e.lon) && Number.isFinite(e.lat)) nodes.set(e.id, [e.lon, e.lat]);
  }
  const out = [];
  for (const e of Array.isArray(json?.elements) ? json.elements : []) {
    if (e?.type !== 'way' || !e.tags?.highway || !e.tags.tunnel || e.tags.tunnel === 'no') continue;
    const name = String(e.tags['tunnel:name'] ?? e.tags.name ?? '');
    if (!nameRe.test(`${name} ${e.tags.name ?? ''} ${e.tags['name:fr'] ?? ''}`)) continue;
    const g = (e.nodes ?? []).map((id) => nodes.get(id)).filter(Boolean);
    if (g.length < 2) continue;
    out.push({ id: `w${e.id}`, name, cat: categoryFromTags(e.tags), g: shrink(g) });
  }
  return out;
}

/** Repères de recoupement pour les trois tunnels gardés en dur (point proche du milieu, d'après la carte). */
export const KNOWN_PROBES = Object.freeze([
  { id: 'known:fourviere', label: 'Fourvière', cat: 'E', name: /fourvi[eè]re/i, near: [4.8135, 45.7605], search: ['Tunnel de Fourvière', 'Tunnel sous Fourvière', 'Fourvière tunnel Lyon'] },
  { id: 'known:frejus', label: 'Fréjus', cat: 'C', name: /fr[ée]jus|traforo/i, near: [6.685, 45.135], search: ['Tunnel routier du Fréjus'] },
  { id: 'known:montblanc', label: 'Mont-Blanc', cat: 'E', name: /mont[- ]blanc|monte bianco|traforo/i, near: [6.905, 45.858], search: ['Tunnel du Mont-Blanc'] },
].map((p) => Object.freeze(p)));

export { KNOWN_TUNNELS };
