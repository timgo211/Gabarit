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
  SERVER_TIMEOUT_S: 300,
  /** Tube simplifié à 10 m près, 12 points au plus. */
  TOLERANCE_M: 10,
  MAX_POINTS: 12,
});

/**
 * Requête Overpass QL : voies en tunnel portant une étiquette hazmat, avec leur tracé ; plus les tubes de Fourvière,
 * du Fréjus et du Mont-Blanc même sans étiquette hazmat (recoupement des tunnels gardés en dur, journal seulement).
 */
export function buildTunnelsQuery(bbox = TUNNELS_CONVERT.BBOX) {
  const parts = TUNNELS_CONVERT.KEYS.map((k) => `way["highway"]["tunnel"]["tunnel"!="no"]["${k}"];`).join('')
    + 'way["highway"]["tunnel"]["name"~"Fourvi|Fr[ée]jus|Mont[- ]Blanc|Monte Bianco|Traforo",i](44.9,4.7,46.1,7.1);';
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
    const name = String(t.name ?? t['tunnel:name'] ?? t['name:fr'] ?? '').trim().slice(0, 80);
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
      const name = String(e.tags?.name ?? e.tags?.['tunnel:name'] ?? '');
      const mid = checkPoints(g, 3)[1];
      if (!probe.name.test(name) && haversine(mid, probe.near) > 2000) continue;
      hits.push(`w${e.id} « ${name} » catégorie OSM ${categoryFromTags(e.tags) ?? '?'} ; tracé ${JSON.stringify(shrink(g))}`);
    }
    lines.push(`${probe.label} (Bison Futé : ${probe.cat}) : ${hits.length ? hits.join(' | ') : 'absent des données OSM'}`);
  }
  return lines;
}

/** Repères de recoupement pour les trois tunnels gardés en dur (point proche du milieu, d'après la carte). */
export const KNOWN_PROBES = Object.freeze([
  { label: 'Fourvière', cat: 'E', name: /fourvi[eè]re/i, near: [4.8135, 45.7605] },
  { label: 'Fréjus', cat: 'C', name: /fr[ée]jus/i, near: [6.685, 45.135] },
  { label: 'Mont-Blanc', cat: 'E', name: /mont[- ]blanc/i, near: [6.905, 45.858] },
].map((p) => Object.freeze(p)));

export { KNOWN_TUNNELS };
