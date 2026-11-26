// Copie DiaLog (phase 12c, Action « DiaLog (copie) », .github/workflows/dialog.yml) : mesures d'interdiction d'accès
// avec une limite de hauteur ou de poids, lues dans le XML DATEX II v3 de DiaLog, découpées en cases de 1° pour
// data/dialog/ (même découpage que les copies OSM, jamais précachées).
//
// Source : « Base de données nationale de la réglementation de circulation » (DiaLog, DGITM), Licence Ouverte 2.0,
// fiche data.gouv.fr 64947a4af5faf2f1f9eee299 ; gabarit XML officiel
// https://github.com/MTES-MCT/dialog/blob/main/templates/api/regulations.xml.twig (lu le 26/11/2026).
// Avertissement du producteur : « Les restrictions diffusées par DiaLog n'ont pas de valeur juridique. Seul l'arrêté
// fait foi. » Le XML ne donne que le titre de l'arrêté, jamais son texte.
//
// Lecture retenue par l'étude (docs/etude-ponts-sources.md §8) : la valeur est le MAXIMUM AUTORISÉ ; l'opérateur
// `comparisonOperator` est ignoré (le gabarit l'écrit en dur : toujours lessThanOrEqualTo). Les véhicules au-dessus
// de la valeur sont visés.
//
// Ce fichier est pur (aucun accès disque ni réseau ; hors de l'appli, donc hors du service worker) : le lecteur XML et
// les fichiers sont dans tools/dialog-update.mjs.
// Il n'est pas dans la liste `paths` de .github/workflows/osm-data.yml (ne relance pas « Données OSM »).

import { simplifyLine } from '../src/lib/areas-osm.js';
import { tileKey } from '../src/lib/areas-osm-data.js';

export const DIALOG = Object.freeze({
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  MAX_TOTAL_BYTES: 30 * 1024 * 1024,
  TOLERANCES_M: [3, 8, 20],
  HEIGHT_M: [1, 6],        // hauteur lisible : 1 à 6 m
  WEIGHT_T: [1, 100],      // poids lisible : 1 à 100 t
  MAX_TITLE: 300,
  MAX_ORG: 120,
  MAX_LINES: 200,          // lignes d'une même mesure au plus
  MAX_POINTS: 20000,       // points d'une même mesure au plus
  SOURCE: 'Base nationale de la réglementation de circulation (DiaLog, DGITM) : interdictions d\'accès (noEntry) avec une limite de hauteur ou de poids',
  LICENSE: 'Licence Ouverte 2.0',
  NOTICE: 'DiaLog n\'a pas de valeur juridique. Seul l\'arrêté fait foi. La signalisation fait foi.',
});

/** Motifs d'une mesure ignorée (journal). */
export const SKIP = Object.freeze({
  OTHER: 'autre type de mesure (vitesse, stationnement, circulation alternée…)',
  NO_DIM: 'interdiction sans limite de hauteur ni de poids',
  NEGATE_ONLY: 'hauteur ou poids en dérogation seulement (negate)',
  NO_GEOMETRY: 'sans géométrie',
  BAD_GEOMETRY: 'géométrie illisible',
  NOT_LINEAR: 'géométrie non linéaire (point ou zone)',
  BAD_VALUE: 'valeur de hauteur ou de poids illisible',
  EXPIRED: 'mesure temporaire déjà terminée',
});

const DIM = {
  heightCharacteristic: { k: 'h', valueTag: 'vehicleHeight' },
  grossWeightCharacteristic: { k: 'w', valueTag: 'grossVehicleWeight' },
};
const RECURRING = new Set(['validPeriod', 'recurringTimePeriodOfDay', 'recurringDayWeekMonthPeriod']);

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const inc = (map, k, n = 1) => map.set(k, (map.get(k) ?? 0) + n);
const clean = (t, max) => (t == null ? null : String(t).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || null);

/**
 * Date du jour d'un horodatage DATEX (« 2026-12-31T00:00:00+01:00 ») telle qu'écrite, sans fuseau : « AAAA-MM-JJ ».
 * Fin à minuit pile = fin de la veille (« jusqu'au 31/12 » s'écrit « 2027-01-01T00:00:00 »). null si illisible.
 */
export function dayOf(raw, { isEnd = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(raw ?? '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) return null;
  if (isEnd && m[4] === '00' && m[5] === '00' && (m[6] ?? '00') === '00') d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Valeur lue comme maximum autorisé (« 3.5 », « 3,5 ») ; null hors des bornes de la grandeur. */
export function parseLimit(k, text) {
  const s = String(text ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  const [lo, hi] = k === 'h' ? DIALOG.HEIGHT_M : DIALOG.WEIGHT_T;
  return isNum(v) && v >= lo && v <= hi ? Math.round(v * 100) / 100 : null;
}

const validPoint = (p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/**
 * Lignes d'une géométrie GeoJSON (texte) : LineString, MultiLineString, lignes d'une GeometryCollection.
 * @returns {{ lines:number[][][] }|{ skip:string }}
 */
export function linesOf(texts) {
  const lines = [];
  let linear = false;
  let points = 0;
  const addLine = (c) => {
    if (!Array.isArray(c)) return;
    const pts = c.filter(validPoint).map((p) => [p[0], p[1]]);
    if (pts.length >= 2 && lines.length < DIALOG.MAX_LINES && points + pts.length <= DIALOG.MAX_POINTS) {
      lines.push(pts);
      points += pts.length;
    }
  };
  const walk = (g, depth = 0) => {
    if (!g || typeof g !== 'object' || depth > 3) return;
    if (g.type === 'LineString') { linear = true; addLine(g.coordinates); }
    else if (g.type === 'MultiLineString') { linear = true; if (Array.isArray(g.coordinates)) g.coordinates.forEach(addLine); }
    else if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) g.geometries.forEach((x) => walk(x, depth + 1));
  };
  let parsed = 0;
  for (const t of texts) {
    let g;
    try { g = JSON.parse(t); } catch { continue; }
    parsed += 1;
    walk(g);
  }
  if (!parsed) return { skip: SKIP.BAD_GEOMETRY };
  if (!linear) return { skip: SKIP.NOT_LINEAR };
  if (!lines.length) return { skip: SKIP.BAD_GEOMETRY };
  return { lines };
}

/**
 * Handler du lecteur XML en flux (tools/dialog-etude.mjs, createXmlReader) : garde les mesures utiles.
 * Une mesure gardée par grandeur (hauteur, poids) : { k:'h'|'w', value, title, org, start, end, rec, negate, lines }.
 * @param {{ today:string }} opts jour de la copie « AAAA-MM-JJ » (mesure finie avant : ignorée)
 */
export function createDialogCollector({ today }) {
  const measures = [];
  const stats = {
    publicationTime: null, orders: 0, read: 0, kept: 0,
    byKind: { h: 0, w: 0 }, permanent: 0, temporary: 0, recurring: 0, future: 0, withNegate: 0,
    organizations: new Map(), skipped: new Map(),
  };
  const path = [];
  let order = null;
  let measure = null;
  let cond = null;
  let dim = null;
  let validity = null;
  let text = '';
  const parent = (k = 1) => path[path.length - 1 - k];
  const under = (name) => path.includes(name);
  const localName = (n) => (n ? n.slice(n.indexOf(':') + 1) : null);

  function finish(m) {
    stats.read += 1;
    if (m.regType !== 'AccessRestriction' || m.regSubtype !== 'noEntry') { inc(stats.skipped, SKIP.OTHER); return; }
    const kept = m.vehicles.filter((v) => !v.negate);
    const dims = kept.flatMap((v) => v.dims);
    if (!dims.length) {
      inc(stats.skipped, m.vehicles.some((v) => v.negate && v.dims.length) ? SKIP.NEGATE_ONLY : SKIP.NO_DIM);
      return;
    }
    if (!m.geometries.length) { inc(stats.skipped, SKIP.NO_GEOMETRY); return; }
    // Une valeur par grandeur : la plus basse lue (opérateur ignoré, valeur = maximum autorisé).
    const values = {};
    let bad = false;
    for (const d of dims) {
      const v = parseLimit(d.k, d.value);
      if (v === null) { bad = true; continue; }
      values[d.k] = values[d.k] == null ? v : Math.min(values[d.k], v);
    }
    if (!Object.keys(values).length) { inc(stats.skipped, bad ? SKIP.BAD_VALUE : SKIP.NO_DIM); return; }
    // Validité : conditions de la mesure si présentes, sinon celles de l'arrêté.
    let start = order.start;
    let end = order.end;
    let rec = false;
    if (m.validities.length) {
      const starts = m.validities.map((v) => v.start).filter(Boolean).sort();
      start = starts[0] ?? order.start;
      const ends = m.validities.map((v) => v.end);
      end = ends.some((e) => e == null) ? null : ends.sort().at(-1);
      rec = m.validities.some((v) => v.rec);
    }
    if (end && end < today) { inc(stats.skipped, SKIP.EXPIRED); return; }
    const geo = linesOf(m.geometries);
    if (geo.skip) { inc(stats.skipped, geo.skip); return; }
    const negate = m.vehicles.some((v) => v.negate);
    const title = clean(order.title, DIALOG.MAX_TITLE);
    const org = clean(order.org, DIALOG.MAX_ORG);
    for (const k of ['h', 'w']) {
      if (values[k] == null) continue;
      measures.push({ k, value: values[k], title, org, start, end, rec, negate, lines: geo.lines });
      stats.byKind[k] += 1;
    }
    stats.kept += 1;
    if (end) stats.temporary += 1; else stats.permanent += 1;
    if (rec) stats.recurring += 1;
    if (start && start > today) stats.future += 1;
    if (negate) stats.withNegate += 1;
    inc(stats.organizations, org ?? '(sans organisation)');
  }

  const handler = {
    open(name, attrs) {
      const type = localName(attrs['xsi:type']);
      text = '';
      if (name === 'trafficRegulationOrder') order = { title: null, org: null, start: null, end: null };
      else if (name === 'trafficRegulation' && order) {
        measure = { regType: null, regSubtype: null, vehicles: [], geometries: [], validities: [] };
      } else if (measure && name === 'typeOfRegulation') measure.regType = type;
      else if (measure && name === 'conditions' && type === 'VehicleCondition') cond = { negate: false, dims: [] };
      else if (measure && name === 'conditions' && type === 'ValidityCondition') validity = { start: null, end: null, rec: false };
      else if (validity && RECURRING.has(name)) validity.rec = true;
      else if (cond && DIM[name]) dim = { k: DIM[name].k, valueTag: DIM[name].valueTag, value: null };
      path.push(name);
    },
    text(t) { text += t; },
    close(name) {
      path.pop();
      const t = text.trim();
      text = '';
      if (name === 'publicationTime' && !order) stats.publicationTime = t;
      if (name === 'trafficRegulationOrder') { stats.orders += 1; order = null; return; }
      if (name === 'trafficRegulation' && measure) { finish(measure); measure = null; return; }
      if (!order) return;
      if (!measure) {
        if (name === 'value' && parent(1) === 'description' && parent(2) === 'trafficRegulationOrder') order.title = t;
        else if (name === 'value' && parent(1) === 'issuingAuthority') order.org = t;
        else if (name === 'overallStartTime' && under('validityByOrder')) order.start = dayOf(t);
        else if (name === 'overallEndTime' && under('validityByOrder')) order.end = dayOf(t, { isEnd: true });
        return;
      }
      if (validity) {
        if (name === 'overallStartTime') validity.start = dayOf(t);
        else if (name === 'overallEndTime') validity.end = dayOf(t, { isEnd: true });
        else if (name === 'conditions') { measure.validities.push(validity); validity = null; }
        return;
      }
      if (name === 'accessRestrictionType') measure.regSubtype = t;
      else if (name === 'geoJsonGeometry') { if (t) measure.geometries.push(t); }
      else if (cond) {
        if (dim) {
          // comparisonOperator volontairement ignoré (toujours lessThanOrEqualTo, écrit en dur par le gabarit).
          if (name === dim.valueTag) dim.value = t;
          else if (DIM[name]) { cond.dims.push(dim); dim = null; }
          return;
        }
        if (name === 'negate') cond.negate = t === 'true';
        else if (name === 'conditions') { measure.vehicles.push(cond); cond = null; }
      }
    },
  };
  return { handler, measures, stats };
}

// ── Cases de data/dialog/ ─────────────────────────────────────────────────────────────────────────────────────────
// Case : { o:[[titre, organisation, début, fin|null]], m:[[ligne, mesure, k 0|1, valeur, iO, drapeaux, x0, y0, dx, dy…]] }
// k : 0 hauteur (m), 1 poids (t). Drapeaux : 1 = période récurrente, 2 = mesure avec aussi une dérogation (negate).
// Coordonnées en 1e-5°, écarts successifs (comme data/poids-osm/).

function encodeLine(coords, tolerance) {
  const out = [];
  let px = 0; let py = 0;
  for (const [lon, lat] of simplifyLine(coords, tolerance)) {
    const x = Math.round(lon * 1e5); const y = Math.round(lat * 1e5);
    out.push(x - px, y - py);
    px = x; py = y;
  }
  return out;
}

function build(measures, tolerance) {
  const tiles = new Map();
  let lineId = 0;
  measures.forEach((m, mid) => {
    const flags = (m.rec ? 1 : 0) | (m.negate ? 2 : 0);
    const meta = [m.title ?? '', m.org ?? '', m.start ?? null, m.end ?? null];
    const metaKey = JSON.stringify(meta);
    for (const line of m.lines) {
      lineId += 1;
      const enc = encodeLine(line, tolerance);
      for (const key of new Set(line.map(([lon, lat]) => tileKey(lon, lat)))) {
        if (!tiles.has(key)) tiles.set(key, { o: [], m: [], keys: new Map() });
        const t = tiles.get(key);
        if (!t.keys.has(metaKey)) { t.keys.set(metaKey, t.o.length); t.o.push(meta); }
        t.m.push([lineId, mid + 1, m.k === 'h' ? 0 : 1, m.value, t.keys.get(metaKey), flags, ...enc]);
      }
    }
  });
  const sorted = new Map([...tiles.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, t]) => [k, { o: t.o, m: t.m }]));
  let total = 0;
  let biggest = ['', 0];
  for (const [k, t] of sorted) {
    const n = Buffer.byteLength(`${JSON.stringify(t)}\n`);
    total += n;
    if (n > biggest[1]) biggest = [k, n];
  }
  return { tiles: sorted, sizes: { total, biggest } };
}

/** Taille dans les limites ? Sinon le texte du journal. */
export function dialogSizeProblem(sizes, { maxFile = DIALOG.MAX_FILE_BYTES, maxTotal = DIALOG.MAX_TOTAL_BYTES } = {}) {
  const mo = (n) => (n / 1024 / 1024).toFixed(1);
  if (sizes.biggest[1] > maxFile) return `case ${sizes.biggest[0]} de ${mo(sizes.biggest[1])} Mo (plus de ${mo(maxFile)} Mo)`;
  if (sizes.total > maxTotal) return `total de ${mo(sizes.total)} Mo (plus de ${mo(maxTotal)} Mo)`;
  return null;
}

/**
 * Mesures gardées → contenu de data/dialog/ (simplification 3 m, puis 8 m, puis 20 m si trop gros).
 * @param {object[]} measures createDialogCollector
 * @param {{ publication:string|null, updated:string, grid:object, limits?:object }} opts
 * @returns {{ index:object|null, tiles:Map<string,object>, log:string[], sizes:object, problem:string|null }}
 */
export function convertDialog(measures, { publication = null, updated, grid, limits = {} } = {}) {
  const log = [];
  if (!grid || typeof grid.bits !== 'string') return { index: null, tiles: new Map(), log, sizes: null, problem: 'grille de couverture France absente' };
  if (!measures.length) return { index: null, tiles: new Map(), log, sizes: null, problem: 'aucune mesure gardée' };
  let res = null;
  let problem = null;
  let tolerance = null;
  for (const tol of limits.tolerances ?? DIALOG.TOLERANCES_M) {
    res = build(measures, tol);
    tolerance = tol;
    problem = dialogSizeProblem(res.sizes, limits);
    log.push(`Simplification ${tol} m : ${(res.sizes.total / 1024 / 1024).toFixed(2)} Mo, plus grosse case `
      + `${res.sizes.biggest[0]} (${(res.sizes.biggest[1] / 1024).toFixed(0)} Ko)${problem ? ` — ${problem}` : ''}.`);
    if (!problem) break;
  }
  const counts = { h: measures.filter((m) => m.k === 'h').length, w: measures.filter((m) => m.k === 'w').length };
  const index = {
    source: DIALOG.SOURCE, license: DIALOG.LICENSE, notice: DIALOG.NOTICE,
    publication, updated, count: measures.length, counts, grid, tolerance,
    tiles: Object.fromEntries([...res.tiles.entries()].map(([k, t]) => [k, t.m.length])),
  };
  return { index, tiles: res.tiles, log, sizes: res.sizes, problem };
}

/** Journal de la copie (aucune géométrie, aucun texte d'arrêté au-delà du nom des organisations). */
export function dialogLog(stats, result = null) {
  const L = [];
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
  L.push(`Publication DiaLog : ${stats.publicationTime ?? '(absente)'} ; arrêtés ${stats.orders}.`);
  L.push(`Mesures lues : ${stats.read} ; gardées : ${stats.kept} (hauteur ${stats.byKind.h}, poids ${stats.byKind.w}).`);
  L.push(`Gardées : permanentes ${stats.permanent}, temporaires ${stats.temporary}, sur période ${stats.recurring}, `
    + `à venir ${stats.future}, avec aussi une dérogation (negate) ${stats.withNegate} (toujours « à vérifier »).`);
  const sk = top(stats.skipped, 20);
  L.push(`Ignorées : ${sk.reduce((n, [, v]) => n + v, 0)}${sk.length ? ` — ${sk.map(([k, v]) => `${k} : ${v}`).join(' ; ')}` : ''}.`);
  L.push(`Organisations (10 premières, mesures gardées) : ${top(stats.organizations, 10).map(([k, v]) => `${k} ${v}`).join(' ; ') || '(aucune)'}.`);
  if (result?.log) L.push(...result.log);
  if (result?.index) {
    L.push(`Cases : ${result.tiles.size} ; total ${(result.sizes.total / 1024 / 1024).toFixed(2)} Mo ; plus grosse `
      + `${result.sizes.biggest[0]} (${(result.sizes.biggest[1] / 1024).toFixed(0)} Ko) ; simplification ${result.index.tolerance} m.`);
  }
  return L.join('\n');
}
