// Copie du réseau des taxes PL régionales (phase 5h ter) dans data/taxes-pl-osm.json, côté Action
// (tools/osm-update.mjs, extrait France). Logique pure, testée sous Node.
//
// Voies lues (tollWayFromFeature) : routes motorway / trunk / primary / secondary / tertiary portant une référence
// (bretelles exclues), dans le cadre des taxes (osmium extract -b). Gardé par taxe : chaque segment dont le milieu
// est dans le périmètre (pointInTax : cadre, contour de la collectivité, zones exclues, cadre ou contour de la route)
// sur une voie portant une référence de la taxe et sans toll=yes. Les segments toll=yes (sections concédées à péage)
// sont comptés à part dans le journal, jamais gardés. Données © contributeurs OpenStreetMap, licence ODbL ; contours
// IGN Admin Express (Licence Ouverte) lus dans data/taxes-pl.json.
//
// Format : { source, license, contours, updated, taxes: { id: { refs:[[réf…]…], lines:[[i_refs, x0, y0, dx, dy, …]],
// km: { réf: { kept, toll } } } } } ; coordonnées entières en 1e-5 degré, écart au point précédent, lignes simplifiées
// à 3 m près. km = longueur de route estimée (voies à sens unique comptées pour moitié : deux chaussées = une route).

import { simplifyLine } from './areas-osm.js';
import { haversine } from './ors-response.js';
import { TOLLS_GEO, encodeLine, pointInTax } from './hgv-tolls-geo.js';

export const TOLLS_CONVERT = Object.freeze({
  /** Longueur annoncée du réseau ECPL (presse, octobre 2026) : comparée au total du journal, jamais utilisée. */
  ECPL_ANNOUNCED_KM: 525,
});

/** Filtre osmium tags-filter (voies seulement) : routes lues, sur un extrait déjà découpé au cadre des taxes. */
export function osmiumTollsFilter() {
  return [`w/highway=${[...TOLLS_GEO.HIGHWAYS].join(',')}`];
}

/** Cadre réunissant ceux des taxes (osmium extract -b ouest,sud,est,nord). */
export function tollsBbox(data) {
  const boxes = (data?.taxes ?? []).map((t) => t.bbox);
  if (!boxes.length) return null;
  return [
    Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3])),
  ];
}

const km = (m) => (m / 1000).toFixed(1).replace('.', ',');

/**
 * Voies (tollWayFromFeature, sans doublon) + taxes (parseTollData) → contenu de data/taxes-pl-osm.json et journal.
 * @returns {{ json:object, log:string[] }}
 */
export function convertTollNetwork(ways, data, { updated = null } = {}) {
  const out = {
    source: 'OpenStreetMap (extrait Geofabrik France) : routes portant une référence du réseau des taxes PL régionales, hors bretelles et hors toll=yes',
    license: 'ODbL, © contributeurs OpenStreetMap',
    contours: 'IGN Admin Express COG 2018, Licence Ouverte (data/taxes-pl.json)',
    updated,
    taxes: {},
  };
  const log = [];
  const sorted = [...ways].sort((a, b) => a.id - b.id);
  for (const tax of data?.taxes ?? []) {
    const refTable = new Map();
    const refs = [];
    const lines = [];
    const stats = Object.fromEntries(tax.roads.map((r) => [r, { kept: 0, toll: 0 }]));
    for (const w of sorted) {
      const taxRefs = w.refs.filter((r) => tax.roads.includes(r));
      if (!taxRefs.length) continue;
      const key = w.refs.join(';');
      if (!refTable.has(key)) { refTable.set(key, refs.length); refs.push(w.refs); }
      const factor = w.oneway ? 0.5 : 1;
      let run = [];
      const flush = () => {
        if (run.length >= 2) lines.push(encodeLine(refTable.get(key), simplifyLine(run, TOLLS_GEO.SIMPLIFY_M)));
        run = [];
      };
      for (let i = 0; i + 1 < w.coords.length; i += 1) {
        const a = w.coords[i]; const b = w.coords[i + 1];
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const ref = taxRefs.find((r) => pointInTax(mid, r, tax));
        if (!ref) { flush(); continue; }
        const len = haversine(a, b) * factor;
        if (w.toll === 'yes') { stats[ref].toll += len; flush(); continue; }
        stats[ref].kept += len;
        if (!run.length) run.push(a);
        run.push(b);
      }
      flush();
    }
    if (lines.length) {
      out.taxes[tax.id] = {
        refs, lines,
        km: Object.fromEntries(Object.entries(stats).map(([r, s]) => [r, { kept: Math.round(s.kept / 100) / 10, toll: Math.round(s.toll / 100) / 10 }])),
      };
    }
    const total = Object.values(stats).reduce((x, s) => x + s.kept, 0);
    const excluded = Object.values(stats).reduce((x, s) => x + s.toll, 0);
    const detail = Object.entries(stats).map(([r, s]) => `${r} gardés ${km(s.kept)} km, exclus toll=yes ${km(s.toll)} km`).join(' ; ');
    const cmp = tax.id === 'ecpl' ? ` (environ ${TOLLS_CONVERT.ECPL_ANNOUNCED_KM} km annoncés)` : '';
    log.push(`${tax.short} : ${detail} ; total gardé ≈ ${km(total)} km de route${cmp}, exclu toll=yes ≈ ${km(excluded)} km, ${lines.length} lignes.`);
  }
  return { json: out, log };
}
