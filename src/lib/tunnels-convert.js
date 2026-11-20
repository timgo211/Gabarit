// Tunnels signalés aux matières dangereuses (phase 5b) : conversion des voies OpenStreetMap (extraits Geofabrik filtrés
// par osmium dans l'Action hebdomadaire) en data/tunnels-adr.json. Logique pure (testée sous Node) ; téléchargements
// et osmium dans tools/tunnels-update.mjs.
//
// Pas d'Overpass, ni dans l'appli ni dans l'Action : mesuré le 20/11/2026, la requête « aires + tunnels » comme
// « tunnels seuls » dépassait 26 s sur 520 km (A6 + A43), et l'Action a échoué trois fois (serveurs publics pleins,
// 502 / 504, même sur des cases de 1,25° sans aucune voie). Les extraits par pays de Geofabrik ne dépendent pas de
// la charge d'un serveur de requêtes.
// Données © contributeurs OpenStreetMap, licence ODbL (attribution dans la note de source des fiches).

import { categoryFromTags, KNOWN_TUNNELS, checkPoints } from './adr.js';
import { simplifyLine } from './areas-osm.js';
import { haversine } from './nav-geo.js';

export const TUNNELS_CONVERT = Object.freeze({
  /**
   * Extraits OpenStreetMap par pays de Geofabrik (download.geofabrik.de, refaits chaque jour, licence ODbL) : France
   * et pays voisins. L'Action télécharge chaque fichier .osm.pbf, garde les voies portant une étiquette hazmat
   * (osmium tags-filter), les exporte en GeoJSON (osmium export), puis efface le fichier avant le pays suivant.
   */
  GEOFABRIK: Object.freeze([
    'europe/france', 'europe/belgium', 'europe/luxembourg', 'europe/netherlands', 'europe/germany',
    'europe/switzerland', 'europe/liechtenstein', 'europe/austria', 'europe/italy', 'europe/monaco',
    'europe/andorra', 'europe/spain', 'europe/portugal',
  ]),
  /** Clés lues (wiki OSM « Key:hazmat »). */
  KEYS: Object.freeze(['hazmat', 'hazmat:B', 'hazmat:C', 'hazmat:D', 'hazmat:E', 'hazmat:adr_tunnel_cat', 'hazmat:tunnel_cat']),
  /** Tube simplifié à 10 m près, 12 points au plus. */
  TOLERANCE_M: 10,
  MAX_POINTS: 12,
  /**
   * Recoupement des tunnels gardés en dur : API principale d'OpenStreetMap (/api/0.6/map, emprise ≤ 0,25 degré²) et
   * Nominatim. [ouest, sud, est, nord] autour de chaque tunnel.
   */
  KNOWN_BBOX: Object.freeze({
    'known:fourviere': Object.freeze([4.800, 45.750, 4.826, 45.774]),
    'known:frejus': Object.freeze([6.655, 45.075, 6.715, 45.195]),
    'known:montblanc': Object.freeze([6.840, 45.805, 6.970, 45.910]),
  }),
});

/** Filtre osmium tags-filter : voies portant l'une des clés hazmat. */
export function osmiumFilter() {
  return TUNNELS_CONVERT.KEYS.map((k) => `w/${k}`);
}

/**
 * Lignes GeoJSON (osmium export -f geojsonseq --add-unique-id=type_id) → voies en tunnel au format d'une réponse
 * Overpass « out tags geom » ({ type:'way', id, tags, geometry:[{ lon, lat }] }), pour convertTunnels.
 */
export function elementsFromGeojsonSeq(text) {
  const out = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/^\u001e/, '').trim(); // geojsonseq : séparateur RS (RFC 8142) en tête de ligne
    if (!line) continue;
    let f;
    try { f = JSON.parse(line); } catch { continue; }
    const m = /^w(\d+)$/.exec(String(f?.id ?? ''));
    const tags = { ...(f?.properties ?? {}) };
    if (!m || f?.geometry?.type !== 'LineString' || !tags.highway || !tags.tunnel || tags.tunnel === 'no') continue;
    out.push({ type: 'way', id: Number(m[1]), tags, geometry: f.geometry.coordinates.map(([lon, lat]) => ({ lon, lat })) });
  }
  return out;
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
 * Voies OSM ({ elements } au format Overpass, voir elementsFromGeojsonSeq) → contenu de data/tunnels-adr.json.
 * Tunnels de catégorie A ou sans catégorie lisible : retirés.
 * @returns {{ data:{ source:string, license:string, updated:string|null, countries:string[], tunnels:object[] }, log:string[] }}
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
      source: 'OpenStreetMap (extraits Geofabrik), voies en tunnel portant hazmat, hazmat:B…E, hazmat:adr_tunnel_cat',
      license: 'ODbL, © contributeurs OpenStreetMap',
      updated, countries: TUNNELS_CONVERT.GEOFABRIK.map((c) => c.split('/').pop()), tunnels,
    },
    log,
  };
}

/**
 * Recoupement des tunnels gardés en dur (Bison Futé) avec OpenStreetMap : tubes OSM du même nom, ou à moins de
 * 2 km du point donné, et leur catégorie. Écrit dans le journal de l'Action.
 * @param {object} json voies OSM ({ elements })
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
