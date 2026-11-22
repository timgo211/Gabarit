// Copie du réseau des taxes PL régionales (phase 5h ter) dans data/taxes-pl-osm.json, côté Action
// (tools/osm-update.mjs, extrait France). Logique pure, testée sous Node.
//
// Voies lues (tollWayFromFeature) : routes motorway / trunk / primary / secondary / tertiary portant une référence
// (bretelles exclues), dans le cadre des taxes (osmium extract -b). Gardé par taxe : chaque segment dont le milieu
// est dans le périmètre (pointInTax : cadre, contour de la collectivité, zones exclues, cadre ou contour de la route)
// sur une voie portant une référence de la taxe et hors péage poids lourd (isHgvToll : toll:hgv=yes, ou toll=yes
// sans toll:hgv=no). Les segments à péage (sections concédées) sont comptés à part dans le journal, jamais gardés.
// Journal par taxe : km avant découpage (cadre seul) puis après (contours : ce qui est réellement compté par l'appli),
// et répartition des étiquettes toll / toll:hgv pour les routes de TOLL_BREAKDOWN (A31 au sud de Toul). Données © contributeurs OpenStreetMap, licence ODbL ; contours
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
  /** Répartition des étiquettes de péage écrite au journal : A31 au sud de 48,65° N (section concédée APRR). */
  TOLL_BREAKDOWN: Object.freeze([Object.freeze({ tax: 'ecpl', ref: 'A31', maxLat: 48.65 })]),
});

/**
 * Péage poids lourd ? toll:hgv l'emporte sur toll (OSM : clé propre au moyen de transport) ; toll:hgv=yes ou
 * toll=yes sans toll:hgv=no.
 */
export function isHgvToll(w) {
  if (w?.tollHgv === 'yes') return true;
  if (w?.tollHgv === 'no') return false;
  return w?.toll === 'yes';
}

/** Libellé du périmètre de découpage d'une taxe (journal). */
function cutLabel(tax) {
  const parts = [];
  if (tax.rings?.length) parts.push(tax.areaSource ? `contour (${tax.areaSource.split(' :')[0]})` : 'contour de la collectivité');
  if (tax.excludeRings?.length) parts.push(tax.excludeSource ? `sans ${tax.excludeSource.split(/ [:(]/)[0]}` : 'zones exclues');
  const boxes = Object.keys(tax.roadBoxes ?? {});
  if (boxes.length) parts.push(`cadre propre à ${boxes.join(', ')}`);
  const areas = Object.keys(tax.roadAreas ?? {});
  if (areas.length) parts.push(`contour propre à ${areas.join(', ')}`);
  return parts.length ? parts.join(', ') : 'cadre seul';
}

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
    source: 'OpenStreetMap (extrait Geofabrik France) : routes portant une référence du réseau des taxes PL régionales, hors bretelles et hors péage poids lourd (toll:hgv=yes, ou toll=yes sans toll:hgv=no)',
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
    // box : dans le cadre de la taxe, hors péage (avant découpage) ; kept : dans le périmètre complet, hors péage
    // (après découpage, compté par l'appli) ; toll : dans le périmètre complet, à péage poids lourd.
    const stats = Object.fromEntries(tax.roads.map((r) => [r, { box: 0, kept: 0, toll: 0 }]));
    const breakdowns = TOLLS_CONVERT.TOLL_BREAKDOWN.filter((b) => b.tax === tax.id && tax.roads.includes(b.ref))
      .map((b) => ({ ...b, toll: new Map(), tollHgv: new Map() }));
    const add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);
    for (const w of sorted) {
      const taxRefs = w.refs.filter((r) => tax.roads.includes(r));
      if (!taxRefs.length) continue;
      const key = w.refs.join(';');
      if (!refTable.has(key)) { refTable.set(key, refs.length); refs.push(w.refs); }
      const factor = w.oneway ? 0.5 : 1;
      const paid = isHgvToll(w);
      let run = [];
      const flush = () => {
        if (run.length >= 2) lines.push(encodeLine(refTable.get(key), simplifyLine(run, TOLLS_GEO.SIMPLIFY_M)));
        run = [];
      };
      for (let i = 0; i + 1 < w.coords.length; i += 1) {
        const a = w.coords[i]; const b = w.coords[i + 1];
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const len = haversine(a, b) * factor;
        if (pointInTax(mid, null, { bbox: tax.bbox })) {
          const boxRef = taxRefs[0];
          if (!paid) stats[boxRef].box += len;
          for (const bd of breakdowns) {
            if (!taxRefs.includes(bd.ref) || mid[1] >= bd.maxLat) continue;
            add(bd.toll, w.toll || '(absent)', len);
            add(bd.tollHgv, w.tollHgv || '(absent)', len);
          }
        }
        const ref = taxRefs.find((r) => pointInTax(mid, r, tax));
        if (!ref) { flush(); continue; }
        if (paid) { stats[ref].toll += len; flush(); continue; }
        stats[ref].kept += len;
        if (!run.length) run.push(a);
        run.push(b);
      }
      flush();
    }
    if (lines.length) {
      out.taxes[tax.id] = {
        refs, lines,
        km: Object.fromEntries(Object.entries(stats).map(([r, s]) => [r, {
          box: Math.round(s.box / 100) / 10, kept: Math.round(s.kept / 100) / 10, toll: Math.round(s.toll / 100) / 10,
        }])),
      };
    }
    const sum = (f) => Object.values(stats).reduce((x, s) => x + s[f], 0);
    const cmp = tax.id === 'ecpl' ? ` (environ ${TOLLS_CONVERT.ECPL_ANNOUNCED_KM} km annoncés)` : '';
    const before = Object.entries(stats).map(([r, s]) => `${r} ${km(s.box)} km`).join(' ; ');
    log.push(`${tax.short} : avant découpage (cadre ${tax.bbox.join(',')} seul, hors péage) : ${before} ; total ≈ ${km(sum('box'))} km de route${cmp}.`);
    const detail = Object.entries(stats).map(([r, s]) => `${r} gardés ${km(s.kept)} km, exclus péage ${km(s.toll)} km`).join(' ; ');
    log.push(`${tax.short} : après découpage (${cutLabel(tax)}) : ${detail} ; total gardé ≈ ${km(sum('kept'))} km de route${cmp}, exclu péage (toll:hgv=yes ou toll=yes) ≈ ${km(sum('toll'))} km, ${lines.length} lignes.`);
    for (const bd of breakdowns) {
      const fmt = (name, m) => (m.size ? [...m].sort((x, y) => y[1] - x[1]).map(([v, l]) => `${name}=${v} ${km(l)} km`).join(', ') : `${name} : aucune voie`);
      log.push(`${tax.short} : ${bd.ref} au sud de ${String(bd.maxLat).replace('.', ',')}° N (cadre seul, avant découpage) : ${fmt('toll', bd.toll)} ; ${fmt('toll:hgv', bd.tollHgv)}.`);
    }
  }
  return { json: out, log };
}
