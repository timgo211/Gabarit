// Zones des grandes agglomérations (v91) : un pont sans hauteur connue au-dessus d'une autoroute n'est signalé (appli,
// bridge-check.js) et gardé dans l'audit OSM (osm-audit.js, niveau 1) que si le point du croisement est dans l'une
// de ces zones. Règle du propriétaire (Timothée), sans source officielle : pont au-dessus d'une autoroute = pas un point
// sensible, sauf en Île-de-France et dans les grandes agglomérations. La signalisation fait foi.
// Contours : IGN Admin Express COG 2026 (Licence Ouverte), Action « Contours IGN » : data/zones-agglo.json (Île-de-France,
// Métropoles du Grand Paris, d'Aix-Marseille-Provence, Européenne de Lille, Bordeaux, Toulouse, Nantes) et
// data/contours-ign.json (Métropole de Lyon, Eurométropole de Strasbourg). Anneaux extérieurs [lon, lat] ; un point
// est en zone s'il est dans l'un des anneaux. Logique pure, même code pour l'appli et l'audit.

import { inRing } from './hgv-tolls-geo.js';

export const AGGLO_ZONES = Object.freeze({
  ZONES_PATH: './data/zones-agglo.json',
  CONTOURS_PATH: './data/contours-ign.json',
  ZONES_KEYS: Object.freeze(['ileDeFrance', 'metropoleGrandParis', 'aixMarseille', 'lille', 'bordeaux', 'toulouse', 'nantes']),
  CONTOURS_KEYS: Object.freeze(['metropoleLyon', 'eurometropole']),
  UNAVAILABLE_TEXT: 'Zones des grandes agglomérations indisponibles : ponts sans hauteur au-dessus des autoroutes non examinés. '
    + 'La signalisation fait foi.',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const validRing = (r) => Array.isArray(r) && r.length >= 4 && r.every((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));

function zoneOf(key, rings) {
  if (!Array.isArray(rings)) return null;
  const ok = rings.filter(validRing);
  if (!ok.length) return null;
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  for (const r of ok) for (const [x, y] of r) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return { key, rings: ok, box: [w, s, e, n] };
}

/**
 * Les deux fichiers lus → { zones:[{ key, rings, box }] } ; null si une seule des 9 zones manque ou n'a aucun anneau
 * valide (tout ou rien : jamais une zone écartée en silence).
 */
export function parseAggloZones(zonesJson, contoursJson) {
  const zones = [];
  for (const [json, keys] of [[zonesJson, AGGLO_ZONES.ZONES_KEYS], [contoursJson, AGGLO_ZONES.CONTOURS_KEYS]]) {
    if (!json || typeof json !== 'object') return null;
    for (const k of keys) {
      const z = zoneOf(k, json[k]);
      if (!z) return null;
      zones.push(z);
    }
  }
  return { zones };
}

/** Clé de la première zone qui contient le point [lon, lat], ou null. */
export function aggloZoneAt(point, parsed) {
  if (!Array.isArray(point) || !isNum(point[0]) || !isNum(point[1]) || !Array.isArray(parsed?.zones)) return null;
  const [x, y] = point;
  for (const z of parsed.zones) {
    const [w, s, e, n] = z.box;
    if (x < w || x > e || y < s || y > n) continue;
    if (z.rings.some((r) => inRing(point, r))) return z.key;
  }
  return null;
}
