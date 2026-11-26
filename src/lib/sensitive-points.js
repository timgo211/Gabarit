// Points sensibles avant le départ (PR 3b, v74) : copie data/points-sensibles/ tirée des fiches de l'Action « Audit
// OSM » (data/audit-osm/, osm-audit.js ; © contributeurs OpenStreetMap, ODbL), puis rapprochement d'un itinéraire.
// Logique pure, testée sous Node.
//
// Pourquoi : ORS n'évite que hgv=no et les limites maxheight / maxweight d'OSM ; une interdiction par tonnage, en
// transit ou horaire (hgv:conditional, ignoré par ORS) ne le protège pas. Avertissements seulement : le calcul ne
// change pas ; fiche d'itinéraire et carte (panneau du choix, masqué en guidage), jamais dit, rien dans le guidage
// (Code de la route art. R412-6-2). Toujours « à vérifier » ; la signalisation fait foi ; source citée.
//
// Contenu (choix validés par le propriétaire) :
// - interdictions PL localisées par l'audit (tools/audit-osm-interdictions.json) : sections lues par arrêté, et
//   sections connues par Bison Futé seulement, marquées « source Bison Futé, arrêté non lu » ;
// - hauteurs basses connues des axes (maxheight < 4,30 m, fiches « hauteur basse connue ») ;
// - tunnels d'un axe sans hauteur renseignée.
// Les ponts n'y sont pas : ceux de l'audit (hors ponts au-dessus d'une autoroute) sont tous dans data/ponts-osm/ et
// déjà signalés par l'alerte « ponts à vérifier » de la phase 12a (bridge-check.js) ; le journal de la construction
// vérifie qu'aucun n'en manque (jamais un second compteur de ponts).
//
// Format : index.json (source, license, updated, counts, grid de data/axes-osm/, tiles, sections) + une case E_N.json
// par degré : { r:[références…], p:[[type, x, y, cap, i_ref|-1, valeur|null, i_section|-1, way]] } ; x, y en 1e-5 degré ;
// cap en degrés (0 à 179, sens de circulation inconnu) ; types : 0 interdiction lue par arrêté, 1 interdiction connue
// par Bison Futé (arrêté non lu), 2 hauteur basse (valeur en m), 3 tunnel sans hauteur.
//
// Cap de chaque point : celui de la voie de data/axes-osm/ de même référence à 5 m au plus du point (la fiche ne garde
// qu'un point de la voie). Deux voies à plus de 30° l'une de l'autre, ou aucune : point écarté, compté par type au
// journal ; jamais un point sans cap (sans cap, un pont ou une route qui croise le tracé serait pris).
//
// Rapprochement du tracé : même méthode que le repli par la géométrie (axis-match.js, phase 5h ter) : 15 m au plus, cap
// à 30° au plus modulo 180° ; référence du tracé connue (étape ORS ou repli 3a) et différente de celle du point :
// écarté.

import { axisDiff } from './hgv-tolls-geo.js';
import { roadRefs } from './route-samples.js';
import { tileKey } from './areas-osm-data.js';
import { parseHeight } from './bridge-check.js';

export const SENSITIVE = Object.freeze({
  DIR: './data/points-sensibles/',
  INDEX_PATH: './data/points-sensibles/index.json',
  TYPES: Object.freeze({ BAN: 0, BAN_BF: 1, LOW: 2, TUNNEL: 3 }),
  TYPE_NAMES: Object.freeze(['interdiction (arrêté)', 'interdiction (Bison Futé)', 'hauteur basse', 'tunnel sans hauteur']),
  /** Voie de la copie des axes qui donne le cap d'un point : à 5 m au plus. */
  CAP_NEAR_M: 5,
  TOLERANCE_M: 15,
  MAX_HEADING_DEG: 30,
  /**
   * Marge de hauteur (m) : 0, comme les ponts de la phase 12a (bridge-check.js, signalé si la hauteur est au plus
   * celle du véhicule). Le panneau B12 donne la hauteur à ne pas dépasser et l'étiquette maxheight d'OSM recopie ce
   * panneau (wiki OSM Key:maxheight, lu le 25/11/2026) ; aucun texte officiel lu ne donne de marge en plus : en ajouter
   * une ferait des alertes sans source.
   */
  HEIGHT_MARGIN_M: 0,
  MAX_SHOWN: 5,
  MAX_FILE_BYTES: 1024 * 1024,
  MAX_TOTAL_BYTES: 5 * 1024 * 1024,
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const RAD = Math.PI / 180;
const KY = 110540;
const kxAt = (lat) => Math.cos(lat * RAD) * 111320;
const CELL = 0.005;
const cellOf = (lon, lat) => `${Math.floor(lon / CELL)}_${Math.floor(lat / CELL)}`;

/** Distance (m) du point p au segment ab et cap du segment (0 à 360), en projection locale. */
function toSegment(p, a, b) {
  const kx = kxAt(p[1]);
  const ax = (a[0] - p[0]) * kx; const ay = (a[1] - p[1]) * KY;
  const bx = (b[0] - p[0]) * kx; const by = (b[1] - p[1]) * KY;
  const dx = bx - ax; const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return { dist: Math.hypot(ax + t * dx, ay + t * dy), heading: ((Math.atan2(dx, dy) / RAD) + 360) % 360, t };
}

/** Segments rangés par cellule (une cellule par extrémité et par cellule traversée, emprise élargie). */
function segmentGrid(lines, marginDeg, maxCells = 400) {
  const cells = new Map();
  for (const [li, l] of lines.entries()) {
    for (let i = 1; i < l.coords.length; i += 1) {
      const a = l.coords[i - 1]; const b = l.coords[i];
      const seg = { a, b, li, i: i - 1 };
      const x0 = Math.floor((Math.min(a[0], b[0]) - marginDeg) / CELL); const x1 = Math.floor((Math.max(a[0], b[0]) + marginDeg) / CELL);
      const y0 = Math.floor((Math.min(a[1], b[1]) - marginDeg) / CELL); const y1 = Math.floor((Math.max(a[1], b[1]) + marginDeg) / CELL);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > maxCells) continue; // voie de la copie aberrante (plus de 10 km de côté)
      for (let cx = x0; cx <= x1; cx += 1) {
        for (let cy = y0; cy <= y1; cy += 1) {
          const k = `${cx}_${cy}`;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(seg);
        }
      }
    }
  }
  return cells;
}

// ───────── Construction (outil tools/points-sensibles.mjs et Action « Audit OSM ») ─────────

/** Type d'une fiche d'audit gardée, ou null. */
export function sensitiveType(card, sectionsById) {
  if (typeof card?.type !== 'string') return null;
  if (card.type.startsWith('interdiction PL absente')) {
    const s = sectionsById.get(card.section);
    if (!s || s.localisable === false) return null;
    return s.lu === 'arrêté' ? SENSITIVE.TYPES.BAN : SENSITIVE.TYPES.BAN_BF;
  }
  if (card.type === 'hauteur basse connue') return SENSITIVE.TYPES.LOW;
  if (card.type === 'tunnel sans hauteur') return SENSITIVE.TYPES.TUNNEL;
  return null;
}

/** Ponts d'audit qui seraient gardés par le plan (hors autoroute dessous, ouvrage route ≥ tertiaire ou voie ferrée). */
export function auditBridgeIds(cards) {
  const ids = new Set();
  const above = /^(railway=(rail|tram|subway|narrow_gauge)|highway=(motorway|trunk|primary|secondary|tertiary)(_link)?)$/;
  for (const c of cards ?? []) {
    const below = c?.etiquettesActuelles?.highway;
    if (c?.type === 'hauteur sur le pont seulement' && Number.isInteger(c.pont)) ids.add(c.pont);
    if (c?.type === 'pont sans hauteur' && below !== 'motorway' && below !== 'motorway_link' && above.test(String(c.pontType ?? ''))
      && Number.isInteger(c.pont)) ids.add(c.pont);
  }
  return ids;
}

/** Cap du point d'après les voies de la copie des axes de même référence à 5 m au plus ; null si absent ou ambigu. */
function capOf(point, ref, grid, lines) {
  const heads = [];
  for (const seg of grid.get(cellOf(point[0], point[1])) ?? []) {
    const l = lines[seg.li];
    if (ref ? !l.refs.includes(ref) : l.refs.length) continue;
    const r = toSegment(point, seg.a, seg.b);
    if (r.dist <= SENSITIVE.CAP_NEAR_M) heads.push(r.heading % 180);
  }
  if (!heads.length) return null;
  if (heads.some((h) => axisDiff(h, heads[0]) > SENSITIVE.MAX_HEADING_DEG)) return null;
  return Math.round(heads[0]) % 180;
}

/**
 * Fiches d'audit → contenu de data/points-sensibles/.
 * @param {object[]} cards fiches de data/audit-osm/
 * @param {object[]} sections tools/audit-osm-interdictions.json (sections)
 * @param {{ lines:{ refs:string[], coords:number[][] }[] }} axes copie des axes lue (axis-match.js, mergeAxesTiles)
 * @param {{ pontsIds?:Set<number>|null, updated?:string|null, grid?:object|null }} opts pontsIds : ids de data/ponts-osm/
 * @returns {{ index:object|null, tiles:Map<string,object>|null, log:string[], problem:string|null }}
 */
export function buildSensitivePoints(cards, sections, axes, { pontsIds = null, updated = null, grid = null } = {}) {
  const log = [];
  const byId = new Map((sections ?? []).map((s) => [s.id, s]));
  const lines = axes?.lines ?? [];
  const capGrid = segmentGrid(lines, SENSITIVE.CAP_NEAR_M / KY * 2);
  const kept = [0, 0, 0, 0];
  const noCap = [0, 0, 0, 0];
  const usedSections = new Map();
  const tiles = new Map();
  const seen = new Set();
  for (const c of cards ?? []) {
    const type = sensitiveType(c, byId);
    if (type === null) continue;
    const p = c.point;
    if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) { noCap[type] += 1; continue; }
    const key = `${type}|${c.way}|${p[0]}|${p[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = typeof c.ref === 'string' ? c.ref : '';
    const cap = capOf(p, ref, capGrid, lines);
    if (cap === null) { noCap[type] += 1; continue; }
    let value = null;
    if (type === SENSITIVE.TYPES.LOW) {
      value = parseHeight(c.etiquettesActuelles?.['maxheight:physical'] ?? c.etiquettesActuelles?.maxheight ?? '');
      if (value === null) { noCap[type] += 1; continue; }
    }
    let si = -1;
    if (type <= SENSITIVE.TYPES.BAN_BF) {
      if (!usedSections.has(c.section)) usedSections.set(c.section, usedSections.size);
      si = usedSections.get(c.section);
    }
    const tk = tileKey(p[0], p[1]);
    if (!tiles.has(tk)) tiles.set(tk, { refs: new Map(), p: [] });
    const t = tiles.get(tk);
    let ri = -1;
    if (ref) { if (!t.refs.has(ref)) t.refs.set(ref, t.refs.size); ri = t.refs.get(ref); }
    t.p.push([type, Math.round(p[0] * 1e5), Math.round(p[1] * 1e5), cap, ri, value, si, Number.isInteger(c.way) ? c.way : 0]);
    kept[type] += 1;
  }
  const names = SENSITIVE.TYPE_NAMES;
  log.push(`Points sensibles gardés : ${kept.reduce((a, b) => a + b, 0)} (${names.map((n, i) => `${n} ${kept[i]}`).join(', ')}).`);
  log.push(`Écartés faute de cap (aucune voie des axes de même référence à ${SENSITIVE.CAP_NEAR_M} m, ou voies de caps différents) : `
    + `${noCap.reduce((a, b) => a + b, 0)} (${names.map((n, i) => `${n} ${noCap[i]}`).join(', ')}).`);
  // Ponts : déjà signalés par la phase 12a s'ils sont dans data/ponts-osm/.
  const bridges = auditBridgeIds(cards);
  if (pontsIds) {
    const missing = [...bridges].filter((id) => !pontsIds.has(id));
    log.push(`Ponts de l'audit gardés : ${bridges.size} ; absents de data/ponts-osm/ (donc non signalés par « ponts à vérifier ») : `
      + `${missing.length}${missing.length ? ` (${missing.slice(0, 10).map((id) => `way/${id}`).join(', ')}${missing.length > 10 ? '…' : ''}) — à revoir` : ''}.`);
  } else log.push(`Ponts de l'audit gardés : ${bridges.size} ; data/ponts-osm/ non lue : recoupement non fait.`);

  const out = new Map();
  let total = 0;
  let biggest = ['', 0];
  for (const k of [...tiles.keys()].sort()) {
    const t = tiles.get(k);
    const tile = { r: [...t.refs.keys()], p: t.p };
    const n = Buffer.byteLength(`${JSON.stringify(tile)}\n`);
    total += n;
    if (n > biggest[1]) biggest = [k, n];
    out.set(k, tile);
  }
  const sectionList = [...usedSections.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => {
    const s = byId.get(id);
    return { id, texte: s.texte, arrete: s.arrete ?? null, source: s.source ?? null, lu: s.lu, nature: s.nature ?? null,
      valeur: isNum(s.valeur) ? s.valeur : null, sens: s.sens ?? null, refs: s.refs ?? [] };
  });
  const index = {
    source: 'OpenStreetMap (audit Gabarit en lecture seule, data/audit-osm/) : interdictions PL, hauteurs basses, tunnels sans hauteur',
    license: 'ODbL — © contributeurs OpenStreetMap',
    updated,
    count: kept.reduce((a, b) => a + b, 0),
    counts: Object.fromEntries(names.map((n, i) => [n, kept[i]])),
    grid,
    tiles: Object.fromEntries([...out.entries()].map(([k, t]) => [k, t.p.length])),
    sections: sectionList,
    note: 'à vérifier sur place ; la signalisation fait foi',
  };
  const indexBytes = Buffer.byteLength(`${JSON.stringify(index)}\n`);
  total += indexBytes;
  const mo = (n) => (n / 1024).toFixed(0);
  log.push(`Taille : ${out.size} cases, ${mo(total)} Ko en tout (plus grosse ${biggest[0]} : ${mo(biggest[1])} Ko).`);
  let problem = null;
  if (biggest[1] > SENSITIVE.MAX_FILE_BYTES) problem = `case ${biggest[0]} de plus de 1 Mo`;
  else if (total > SENSITIVE.MAX_TOTAL_BYTES) problem = 'plus de 5 Mo en tout';
  if (problem) {
    log.push(`⚠ data/points-sensibles/ non modifié : ${problem} (ancienne copie gardée).`);
    return { index: null, tiles: null, log, problem };
  }
  return { index, tiles: out, log, problem: null };
}

// ───────── Appli : lecture ─────────

/** index.json → sections (tableau, dans l'ordre des indices) ; [] si illisible. */
export function parseSensitiveSections(json) {
  return Array.isArray(json?.sections) ? json.sections.filter((s) => s && typeof s.id === 'string' && typeof s.texte === 'string') : [];
}

/** Case → { points } ; null si illisible. */
export function parseSensitiveTile(json) {
  if (!json || !Array.isArray(json.r) || !Array.isArray(json.p)) return null;
  const points = [];
  for (const r of json.p) {
    if (!Array.isArray(r) || r.length < 8 || ![0, 1, 2, 3].includes(r[0]) || !Number.isInteger(r[1]) || !Number.isInteger(r[2]) || !isNum(r[3])) continue;
    points.push({
      type: r[0], point: [r[1] / 1e5, r[2] / 1e5], cap: r[3],
      ref: r[4] >= 0 && typeof json.r[r[4]] === 'string' ? json.r[r[4]] : '',
      value: isNum(r[5]) ? r[5] : null, section: Number.isInteger(r[6]) ? r[6] : -1, way: Number.isInteger(r[7]) ? r[7] : 0,
    });
  }
  return { points };
}

/** Cases lues → une seule liste (sans doublon). */
export function mergeSensitiveTiles(tiles) {
  const seen = new Set();
  const points = [];
  for (const t of tiles) {
    for (const p of t?.points ?? []) {
      const k = `${p.type}|${p.way}|${p.point[0]}|${p.point[1]}`;
      if (seen.has(k)) continue;
      seen.add(k);
      points.push(p);
    }
  }
  return { points };
}

// ───────── Rapprochement d'un itinéraire ─────────

/**
 * Références de la route au tronçon i : étape ORS, sinon repli par la géométrie (3a) ; [] si inconnues. v81 : avec
 * geoAll (geoRoadsAll, tous les tronçons), les références de la géométrie s'ajoutent à celles du nom d'étape : le veto
 * ne s'applique que si NI le nom NI la géométrie ne donnent la référence du point.
 */
function refsBySegment(route, geo, geoAll = null) {
  const n = route.coordinates.length - 1;
  const out = new Array(n).fill(null);
  for (const s of route.steps ?? []) {
    if (!Array.isArray(s?.wayPoints)) continue;
    const refs = roadRefs(s.name);
    for (let i = Math.max(0, s.wayPoints[0]); i < s.wayPoints[1] && i < n; i += 1) out[i] = refs;
  }
  const split = (g) => (typeof g === 'string' && g ? g.split(';') : []);
  for (let i = 0; i < n; i += 1) {
    if (!out[i]?.length) out[i] = split(geo?.ref?.[i]);
    if (out[i].length && geoAll) {
      const more = split(geoAll.ref?.[i]).filter((r) => !out[i].includes(r));
      if (more.length) out[i] = [...out[i], ...more];
    }
  }
  return out;
}

/**
 * Points sensibles le long d'un itinéraire, regroupés : une section d'interdiction = une entrée ; une voie = une entrée.
 * @param {object} route itinéraire (parseDirections)
 * @param {{ points:object[] }} data copie lue (mergeSensitiveTiles)
 * @param {{ geo?:object|null }} opts geo : repli par la géométrie (axis-match.js) pour le veto de référence
 * @returns {{ type:number, ref:string, value:number|null, section:number, way:number, point:number[], along:number }[]}
 */
export function sensitivePointsAlongRoute(route, data, { geo = null, geoAll = null } = {}) {
  const coords = route?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || !data?.points?.length) return [];
  const line = [{ coords }];
  const grid = segmentGrid(line, SENSITIVE.TOLERANCE_M / KY * 2, Infinity);
  const cum = [0];
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1]; const b = coords[i];
    cum.push(cum[i - 1] + Math.hypot((b[0] - a[0]) * kxAt(a[1]), (b[1] - a[1]) * KY));
  }
  const refs = refsBySegment(route, geo, geoAll);
  const hits = [];
  for (const pt of data.points) {
    let best = null;
    for (const seg of grid.get(cellOf(pt.point[0], pt.point[1])) ?? []) {
      const r = toSegment(pt.point, seg.a, seg.b);
      if (r.dist > SENSITIVE.TOLERANCE_M || axisDiff(r.heading, pt.cap) > SENSITIVE.MAX_HEADING_DEG) continue;
      const rr = refs[seg.i];
      if (pt.ref && rr.length && !rr.includes(pt.ref)) continue;
      const along = cum[seg.i] + r.t * (cum[seg.i + 1] - cum[seg.i]);
      if (!best || along < best.along) best = { along };
    }
    if (best) hits.push({ ...pt, along: best.along });
  }
  hits.sort((a, b) => a.along - b.along);
  const groups = new Set();
  const out = [];
  for (const h of hits) {
    const g = h.type <= SENSITIVE.TYPES.BAN_BF ? `s${h.section}` : `w${h.type}:${h.way}`;
    if (groups.has(g)) continue;
    groups.add(g);
    out.push(h);
  }
  return out;
}

// ───────── Textes et règles de la fiche ─────────

const num = (x) => String(x).replace('.', ',');
const km = (m) => `km ${Math.round(m / 1000)}`;
const shortDate = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : '?');
const roadName = (ref) => (ref ? ref.replace(/^([A-Z]+)(\d)/, '$1 $2') : '');

/** Le point concerne-t-il ce véhicule ? (poids et hauteur du profil ; inconnu → oui) */
export function concernsVehicle(item, section, vehicle) {
  const h = isNum(vehicle?.height) ? vehicle.height : null;
  const w = isNum(vehicle?.weight) ? vehicle.weight : null;
  if (item.type === SENSITIVE.TYPES.LOW) return h === null || item.value <= h + SENSITIVE.HEIGHT_MARGIN_M;
  if (item.type <= SENSITIVE.TYPES.BAN_BF) {
    const v = isNum(section?.valeur) ? section.valeur : null;
    if (section?.nature === 'hauteur') return v === null || h === null || v <= h + SENSITIVE.HEIGHT_MARGIN_M;
    if (section?.nature === 'poids' || section?.nature === 'transit') return v === null || w === null || w > v;
    return true; // nature « interdit » sans seuil lu : toujours affiché
  }
  return true;
}

/** Texte d'un point sensible (fiche) : situation, « à vérifier », « La signalisation fait foi. », source. */
export function sensitiveText(item, section, { updated = null } = {}) {
  const where = [roadName(item.ref), km(item.along)].filter(Boolean).join(', ');
  const osm = `OpenStreetMap way/${item.way}, audit Gabarit du ${shortDate(updated)}`;
  if (item.type <= SENSITIVE.TYPES.BAN_BF) {
    const transit = section?.nature === 'transit' ? ' Transit seulement : desserte locale possible, à vérifier.' : '';
    const src = item.type === SENSITIVE.TYPES.BAN ? `Source : ${section?.arrete ?? 'arrêté'} ; ${osm}.` : `Source Bison Futé, arrêté non lu ; ${osm}.`;
    return `Point sensible (${where}) : ${section?.texte ?? 'interdiction PL'}. En vigueur : à vérifier.${transit} La signalisation fait foi. ${src}`;
  }
  if (item.type === SENSITIVE.TYPES.LOW) {
    return `Point sensible (${where}) : hauteur limitée à ${num(item.value)} m dans OpenStreetMap (ORS en tient compte sur la route empruntée) : à vérifier. La signalisation fait foi. Source : ${osm}.`;
  }
  return `Point sensible (${where}) : tunnel sans hauteur renseignée dans OpenStreetMap : à vérifier. La signalisation fait foi. Source : ${osm}.`;
}

export const SENSITIVE_UNAVAILABLE_TEXT = 'Points sensibles : données non chargées (copie de l\'audit OpenStreetMap absente ou illisible). La signalisation fait foi.';

/**
 * Fiche d'itinéraire : lignes (5 au plus, puis « +N »), résumé, éléments (repères de la carte), ligne technique.
 * @param {object} route
 * @param {{ vehicle?:object, copy?:{ status:string, data:object, updated?:string|null, meta?:{ sections:object[] } }|null,
 *   geo?:object|null }} ctx
 */
export function sensitiveRules(route, { vehicle = null, copy = null, geo = null, geoAll = null } = {}) {
  const out = { lines: [], short: [], items: [], tech: null };
  if (!copy) return out;
  if (copy.status === 'idle' || copy.status === 'loading') { out.tech = 'Points sensibles : copie en cours de lecture'; return out; }
  if (copy.status !== 'ok') {
    out.lines.push({ level: 'info', text: SENSITIVE_UNAVAILABLE_TEXT });
    out.tech = 'Points sensibles : données non chargées';
    return out;
  }
  const sections = copy.meta?.sections ?? [];
  const found = sensitivePointsAlongRoute(route, copy.data, { geo, geoAll });
  const counts = [0, 0, 0, 0];
  let ignored = 0;
  for (const it of found) {
    const s = it.section >= 0 ? sections[it.section] : null;
    if (!concernsVehicle(it, s, vehicle)) { ignored += 1; continue; }
    counts[it.type] += 1;
    out.items.push({ ...it, text: sensitiveText(it, s, { updated: copy.updated }) });
  }
  // v81 : la ligne garde sa section (`section`, indice dans meta.sections) : une interdiction connue active la remplace
  // par sa ligne unique (route-bans.js).
  const shown = out.items.slice(0, SENSITIVE.MAX_SHOWN).map((it) => ({
    level: 'warn', text: it.text, ...(it.type <= SENSITIVE.TYPES.BAN_BF ? { section: it.section } : {}),
  }));
  const more = out.items.length - shown.length;
  if (more > 0) shown.push({ level: 'warn', text: `+${more} point${more > 1 ? 's' : ''} sensible${more > 1 ? 's' : ''} à vérifier (voir la carte).` });
  out.lines = shown;
  const n = out.items.length;
  if (n) out.short.push(`${n} point${n > 1 ? 's' : ''} sensible${n > 1 ? 's' : ''} à vérifier`);
  out.tech = `Points sensibles : ${n} (interdictions ${counts[0] + counts[1]}, dont Bison Futé ${counts[1]} ; hauteurs basses ${counts[2]} ; `
    + `tunnels sans hauteur ${counts[3]} ; non concernés par le profil ${ignored}), copie du ${shortDate(copy.updated)}`;
  return out;
}
