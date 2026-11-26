// Trafic (phase 10 A, PR 1) : conversion du flux « tipi » de Bison Futé (événements du réseau routier national non
// concédé publiés par les DIR, DATEX II v2 dans une enveloppe SOAP) en un petit JSON national pour l'appli.
// Source : https://www.bison-fute.gouv.fr/donnees-sur-le-rrn.html — Licence Ouverte Etalab 2.0 (citer la source et la
// date de dernière mise à jour). Étude : docs/etude-trafic.md (section 2, source A ; option A).
//
// Logique pure (aucun réseau, aucune horloge : `now` est toujours donné), utilisée par tools/trafic-update.mjs (Action
// « Trafic ») et par tests/trafic-convert.test.js. Le XML est une donnée : lu par le lecteur maison de
// tools/dialog-etude.mjs (DOCTYPE refusé, donc aucune entité externe ; seules les 5 entités XML et les références
// numériques sont décodées ; rien n'est exécuté ni évalué). Chaque enregistrement (situationRecord) devient un petit
// arbre plafonné (nœuds, texte), lu par noms de balises seulement.
//
// Gardés : fermeture (RoadOrCarriagewayOrLaneManagement roadClosed / carriagewayClosures), bouchon (AbnormalTraffic),
// accident (Accident), chantier (MaintenanceWorks, ConstructionWorks), obstacle (…Obstruction). Le reste est compté
// (journal) et écarté. Ligne = droite du point de départ au point d'arrivée seulement (jamais un itinéraire indexé).
// Le journal ne contient aucune coordonnée.

import { createXmlReader } from './dialog-etude.mjs';

export const TRAFIC = Object.freeze({
  FORMAT: 'gabarit-trafic',
  VERSION: 1,
  SOURCE: 'Bison Futé (DIR) — tipi.bison-fute.gouv.fr, DATEX II',
  LICENCE: 'Licence Ouverte Etalab 2.0',
  MAX_EVENTS: 3000,
  MAX_JSON_BYTES: 1024 * 1024,       // 1 Mo au plus
  MAX_NODES_PER_RECORD: 3000,        // garde-fou : enregistrement plus gros = tronqué (compté)
  MAX_NODE_TEXT: 4000,               // texte gardé par balise
  MAX_TAG_NAMES: 500,                // noms distincts comptés dans la carte des balises
  FUTURE_MS: 7 * 24 * 3600e3,        // début au-delà de 7 jours : écarté
  MIN_LINE_M: 20,                    // départ et arrivée plus proches : point seulement
  COMMENT_MAX: 200,
  ROAD_MAX: 20,
  ID_MAX: 80,
  // France métropolitaine (Corse comprise), large : une position hors de cette boîte est écartée.
  BOX: Object.freeze({ south: 41.2, north: 51.2, west: -5.3, east: 9.7 }),
});

// Codes DATEX II v2 (RoadOrCarriagewayOrLaneManagementTypeEnum) lus comme une fermeture. Run 1 de l'Action (26/11/2026) :
// les DIR publient roadClosed et closedPermanentlyForTheWinter (route fermée pour l'hiver) ; carriagewayClosures non vu.
export const CLOSURE_CODES = Object.freeze(['roadClosed', 'carriagewayClosures', 'closedPermanentlyForTheWinter']);

// Ordre de priorité si plus de MAX_EVENTS événements.
export const KINDS = Object.freeze(['fermeture', 'accident', 'obstacle', 'bouchon', 'chantier']);

// Balises de sous-type (DATEX II v2) gardées comme `st`.
const SUBTYPE_TAGS = [
  'roadOrCarriagewayOrLaneManagementType', 'abnormalTrafficType', 'accidentType', 'roadMaintenanceType',
  'constructionWorkType', 'obstructionType', 'animalPresenceType', 'vehicleObstructionType',
  'environmentalObstructionType', 'infrastructureDamageType',
];
const DIRECTION_TAGS = ['tpegDirection', 'alertCDirectionCoded', 'directionRelative', 'directionBound'];
const BOTH = new Set(['bothWays', 'allDirections', 'both']);
// Sens TPEG par point cardinal (cap de la circulation concernée, degrés) : sert à vérifier l'ordre départ → arrivée.
export const COMPASS = Object.freeze({
  northBound: 0, northEastBound: 45, eastBound: 90, southEastBound: 135,
  southBound: 180, southWestBound: 225, westBound: 270, northWestBound: 315,
});
const UNKNOWN_DIR = new Set(['unknown', 'other', '']);

const strip = (v) => (typeof v === 'string' ? v.slice(v.indexOf(':') + 1).trim() : '');
function typeAttr(attrs) {
  if (!attrs) return '';
  if ('xsi:type' in attrs) return strip(attrs['xsi:type']);
  const k = Object.keys(attrs).find((n) => n === 'type' || n.endsWith(':type'));
  return k ? strip(attrs[k]) : '';
}

// ── Collecte (handler du lecteur XML) ───────────────────────────────────────────────────────────────────────────────

function emptyStats() {
  return {
    publicationTime: null, situations: 0, records: 0, truncated: 0,
    recordTypes: {}, roclmTypes: {}, abnormalTypes: {}, groupTypes: {}, positions: { point: 0, ligne: 0, aucune: 0 },
    indexedItineraries: 0, directions: {}, dirKept: { both: 0, one: 0, inconnu: 0 },
    dirCheck: { suit: 0, inverse: 0, flou: 0 },
    times: { debut: 0, fin: 0, lesDeux: 0, aucun: 0 }, validity: {}, probability: {}, sources: {},
    skipped: { autres: 0, sansPosition: 0, horsFrance: 0, termine: 0, suspendu: 0, futur: 0, doublonId: 0, doublonLieu: 0, dateIllisible: 0 },
    future: 0, withRoad: 0, withComment: 0, tags: {}, otherTags: 0,
  };
}
const inc = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };

/**
 * Collecteur pour createXmlReader : un petit arbre par situationRecord, extrait à la fermeture de la balise.
 * @returns {{ handler:object, records:object[], stats:object }}
 */
export function createTrafficCollector() {
  const stats = emptyStats();
  const records = [];
  let situation = null;
  let rec = null;        // { root, stack, nodes }
  let pubText = null;
  let tagNames = 0;

  const handler = {
    open(name, attrs) {
      if (rec) {
        const tagCount = stats.tags;
        if (name in tagCount) tagCount[name] += 1;
        else if (tagNames < TRAFIC.MAX_TAG_NAMES) { tagCount[name] = 1; tagNames += 1; }
        else stats.otherTags += 1;
        if (rec.nodes >= TRAFIC.MAX_NODES_PER_RECORD) { rec.over += 1; rec.stack.push(null); return; }
        const parent = rec.stack[rec.stack.length - 1];
        const node = { n: name, t: '', c: [] };
        const ty = typeAttr(attrs);
        if (ty) node.ty = ty;
        if (attrs?.lang) node.lang = attrs.lang;
        if (parent) parent.c.push(node);
        rec.stack.push(node);
        rec.nodes += 1;
        return;
      }
      if (name === 'situation') {
        stats.situations += 1;
        situation = { id: attrs?.id ?? null, version: attrs?.version ?? null };
        return;
      }
      if (name === 'situationRecord') {
        const root = { n: name, t: '', c: [], ty: typeAttr(attrs), id: attrs?.id ?? null, version: attrs?.version ?? null };
        rec = { root, stack: [root], nodes: 1, over: 0 };
        return;
      }
      if (name === 'publicationTime' && stats.publicationTime == null) pubText = '';
    },
    text(t) {
      if (rec) {
        const node = rec.stack[rec.stack.length - 1];
        if (node && node.t.length < TRAFIC.MAX_NODE_TEXT) node.t += t.slice(0, TRAFIC.MAX_NODE_TEXT - node.t.length);
        return;
      }
      if (pubText != null) pubText += t;
    },
    close(name) {
      if (rec) {
        rec.stack.pop();
        if (name === 'situationRecord' && rec.stack.length === 0) {
          stats.records += 1;
          if (rec.over) stats.truncated += 1;
          records.push({ tree: rec.root, situation: situation ? { ...situation } : null });
          rec = null;
        }
        return;
      }
      if (name === 'situation') situation = null;
      if (name === 'publicationTime' && pubText != null) {
        stats.publicationTime = pubText.trim() || null;
        pubText = null;
      }
    },
  };
  return { handler, records, stats };
}

/** Lit un texte XML complet (lève une erreur « XML … » s'il est mal formé ou refusé). */
export function collectXml(text) {
  const c = createTrafficCollector();
  const reader = createXmlReader(c.handler);
  reader.write(text);
  reader.end();
  return c;
}

// ── Lecture d'un enregistrement ─────────────────────────────────────────────────────────────────────────────────────

function find(node, name) {
  for (const ch of node.c) {
    if (ch.n === name) return ch;
    const f = find(ch, name);
    if (f) return f;
  }
  return null;
}
function findAll(node, pred, anc = [], out = []) {
  for (const ch of node.c) {
    if (pred(ch)) out.push({ node: ch, anc });
    findAll(ch, pred, [...anc, ch.n], out);
  }
  return out;
}
const textOf = (node) => (node ? node.t.trim() : '');
const childText = (node, name) => textOf(node?.c.find((c) => c.n === name));

function isoOf(raw, stats) {
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) { stats.skipped.dateIllisible += 1; return null; }
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

function clean(s, max) {
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const round4 = (x) => Math.round(x * 1e4) / 1e4;
function inBox(lat, lon) {
  const b = TRAFIC.BOX;
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}
function meters(a, b) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Rôle d'un point d'après ses balises parentes : départ, arrivée, affichage ou autre.
function roleOf(name, anc) {
  if (name === 'locationForDisplay') return 'display';
  for (let i = anc.length - 1; i >= 0; i -= 1) {
    const a = anc[i];
    if (a === 'from' || /StartPoint$/.test(a) || /Secondary/.test(a)) return 'from';
    if (a === 'to' || /EndPoint$/.test(a) || /Primary/.test(a)) return 'to';
  }
  return 'other';
}

/** Positions d'un groupOfLocations : { p, l, kind, out } (coordonnées [lon, lat] arrondies à 1e-4). */
export function positionOf(group, stats) {
  if (!group) return { p: null, l: null, kind: 'aucune', out: 0 };
  let out = 0;
  const found = findAll(group, (n) => n.n === 'pointCoordinates' || n.n === 'locationForDisplay').map(({ node, anc }) => {
    const lat = Number(childText(node, 'latitude'));
    const lon = Number(childText(node, 'longitude'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || childText(node, 'latitude') === '' || childText(node, 'longitude') === '') return null;
    if (!inBox(lat, lon)) { out += 1; return null; }
    return { role: roleOf(node.n, anc), c: [round4(lon), round4(lat)] };
  }).filter(Boolean);
  if (group.ty === 'ItineraryByIndexedLocations' && stats) stats.indexedItineraries += 1;
  const pick = (role) => found.find((f) => f.role === role)?.c ?? null;
  const from = pick('from');
  const to = pick('to');
  const p = pick('display') ?? from ?? found[0]?.c ?? null;
  // Ligne : droite du départ à l'arrivée seulement (jamais un itinéraire indexé).
  const l = group.ty !== 'ItineraryByIndexedLocations' && from && to && meters(from, to) >= TRAFIC.MIN_LINE_M ? [from, to] : null;
  return { p, l, kind: l ? 'ligne' : p ? 'point' : 'aucune', out };
}

/** Sens : { d: both | one | null, raw: valeur brute (≤ 30 car.) ou null }. */
function directionOf(tree, stats) {
  for (const tag of DIRECTION_TAGS) {
    const node = find(tree, tag);
    if (!node) continue;
    const v = textOf(node);
    inc(stats.directions, `${tag}=${v || '(vide)'}`);
    const raw = v ? v.slice(0, 30) : null;
    if (BOTH.has(v)) return { d: 'both', raw };
    if (UNKNOWN_DIR.has(v)) return { d: null, raw };
    return { d: 'one', raw };
  }
  return { d: null, raw: null };
}

/** Cap initial (degrés, 0 = nord) de a vers b ([lon, lat]). */
export function bearingDeg(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/**
 * La droite départ → arrivée va-t-elle dans le sens cardinal publié ? « suit » (écart < 60°), « inverse » (> 120°),
 * sinon « flou » ; null si le sens n'est pas cardinal ou sans ligne.
 */
export function lineFollowsCompass(l, raw) {
  if (!l || !(raw in COMPASS)) return null;
  const diff = Math.abs(((bearingDeg(l[0], l[1]) - COMPASS[raw]) % 360 + 540) % 360 - 180);
  return diff < 60 ? 'suit' : diff > 120 ? 'inverse' : 'flou';
}

function roadOf(tree) {
  const rn = clean(textOf(find(tree, 'roadNumber')), TRAFIC.ROAD_MAX);
  if (rn) return rn;
  // Descripteur TPEG (« name » de type TpegOtherPointDescriptor…) dont le type est linkName.
  const desc = findAll(tree, (n) => n.c.some((c) => /DescriptorType$/.test(c.n) && textOf(c) === 'linkName'));
  for (const { node } of desc) {
    const v = clean(textOf(find(node, 'value')), TRAFIC.ROAD_MAX);
    if (v) return v;
  }
  return null;
}

function commentOf(tree) {
  const gpc = find(tree, 'generalPublicComment');
  if (!gpc) return null;
  const values = findAll(gpc, (n) => n.n === 'value');
  const fr = values.find(({ node }) => /^fr/i.test(node.lang ?? '')) ?? values[0];
  return fr ? clean(textOf(fr.node), TRAFIC.COMMENT_MAX) : null;
}

function sourceOf(tree) {
  const s = find(tree, 'sourceName');
  const v = s ? textOf(find(s, 'value')) || textOf(s) : textOf(find(tree, 'sourceIdentification'));
  return clean(v, 40);
}

function subtypeOf(tree) {
  for (const tag of SUBTYPE_TAGS) {
    const v = textOf(find(tree, tag));
    if (v) return v.slice(0, 60);
  }
  return null;
}

/** Type d'événement gardé, ou null (« autres »). */
export function kindOf(type, sub) {
  if (type === 'RoadOrCarriagewayOrLaneManagement') return CLOSURE_CODES.includes(sub) ? 'fermeture' : null;
  if (type === 'AbnormalTraffic') return 'bouchon';
  if (type === 'Accident') return 'accident';
  if (type === 'MaintenanceWorks' || type === 'ConstructionWorks') return 'chantier';
  if (/Obstruction$/.test(type)) return 'obstacle';
  return null;
}

const safeId = (s) => String(s ?? '').replace(/[^\w.:-]/g, '_').slice(0, TRAFIC.ID_MAX);

/**
 * Lit un enregistrement : { ev } (événement gardé) ou { skip: motif }. Met à jour les statistiques.
 * @param {{ tree:object, situation:object|null }} record
 */
export function readRecord(record, { now, stats, index = 0 }) {
  const { tree, situation } = record;
  const type = tree.ty || '(sans type)';
  inc(stats.recordTypes, type);
  const sub = subtypeOf(tree);
  if (type === 'RoadOrCarriagewayOrLaneManagement') inc(stats.roclmTypes, sub || '(vide)');
  if (type === 'AbnormalTraffic') inc(stats.abnormalTypes, sub || '(vide)');
  const validity = find(tree, 'validity');
  const status = childText(validity, 'validityStatus') || textOf(find(tree, 'validityStatus'));
  inc(stats.validity, status || '(vide)');
  const prob = textOf(find(tree, 'probabilityOfOccurrence'));
  inc(stats.probability, prob || '(vide)');
  const src = sourceOf(tree);
  if (src) inc(stats.sources, src);
  const startRaw = textOf(find(tree, 'overallStartTime'));
  const endRaw = textOf(find(tree, 'overallEndTime'));
  if (startRaw && endRaw) stats.times.lesDeux += 1;
  else if (startRaw) stats.times.debut += 1;
  else if (endRaw) stats.times.fin += 1;
  else stats.times.aucun += 1;
  const group = find(tree, 'groupOfLocations');
  if (group) inc(stats.groupTypes, group.ty || '(sans type)');
  const pos = positionOf(group, stats);
  stats.positions[pos.kind] += 1;
  const dir = directionOf(tree, stats);
  const d = dir.d;
  const follows = lineFollowsCompass(pos.l, dir.raw);
  if (follows) stats.dirCheck[follows] += 1;

  const k = kindOf(type, sub);
  if (!k) { stats.skipped.autres += 1; return { skip: 'autres' }; }
  if (!pos.p) {
    if (pos.out) { stats.skipped.horsFrance += 1; return { skip: 'horsFrance' }; }
    stats.skipped.sansPosition += 1; return { skip: 'sansPosition' };
  }
  if (status === 'suspended') { stats.skipped.suspendu += 1; return { skip: 'suspendu' }; }
  const s = isoOf(startRaw, stats);
  const e = isoOf(endRaw, stats);
  if (e && Date.parse(e) < now) { stats.skipped.termine += 1; return { skip: 'termine' }; }
  if (s && Date.parse(s) > now + TRAFIC.FUTURE_MS) { stats.skipped.futur += 1; return { skip: 'futur' }; }
  const r = roadOf(tree);
  const c = commentOf(tree);
  const id = safeId(tree.id || (situation?.id ? `${situation.id}-${index}` : `sans-id-${index}`));
  const ev = { id, k, st: sub, p: pos.p };
  if (pos.l) ev.l = pos.l;
  Object.assign(ev, { s, e, d, dv: dir.raw, r, c, v: isoOf(textOf(find(tree, 'situationRecordVersionTime')), stats) });
  return { ev, version: Number(tree.version) || 0 };
}

// ── Conversion complète ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Événements gardés, dédoublonnés, plafonnés ; JSON prêt à publier ou `problem`.
 * @param {object[]} records sortie de createTrafficCollector
 * @param {{ now:number, stats:object, lastModified?:string|null, maxEvents?:number, maxBytes?:number }} opts
 */
export function convertTraffic(records, { now, stats, lastModified = null, maxEvents = TRAFIC.MAX_EVENTS, maxBytes = TRAFIC.MAX_JSON_BYTES }) {
  if (!Number.isFinite(now)) throw new TypeError('now manquant');
  const byId = new Map();
  records.forEach((rec, i) => {
    const out = readRecord(rec, { now, stats, index: i });
    if (!out.ev) return;
    const prev = byId.get(out.ev.id);
    if (prev) {
      stats.skipped.doublonId += 1;
      const newer = out.version > prev.version || (out.version === prev.version && (out.ev.v ?? '') > (prev.ev.v ?? ''));
      if (!newer) return;
    }
    byId.set(out.ev.id, out);
  });
  const seen = new Set();
  let events = [];
  for (const { ev } of byId.values()) {
    const sig = `${ev.k}|${ev.p[0]}|${ev.p[1]}|${ev.s ?? ''}`;
    if (seen.has(sig)) { stats.skipped.doublonLieu += 1; continue; }
    seen.add(sig);
    events.push(ev);
  }
  // Chiffres des événements gardés (après les doublons).
  for (const ev of events) {
    if (ev.s && Date.parse(ev.s) > now) stats.future += 1;
    if (ev.d === 'both') stats.dirKept.both += 1; else if (ev.d === 'one') stats.dirKept.one += 1; else stats.dirKept.inconnu += 1;
    if (ev.r) stats.withRoad += 1;
    if (ev.c) stats.withComment += 1;
  }
  const rank = (k) => KINDS.indexOf(k);
  events.sort((a, b) => rank(a.k) - rank(b.k) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const beyond = Math.max(0, events.length - maxEvents);
  if (beyond) events = events.slice(0, maxEvents);
  const counts = Object.fromEntries(KINDS.map((k) => [k, events.filter((e) => e.k === k).length]));
  const lines = events.filter((e) => e.l).length;
  const json = {
    format: TRAFIC.FORMAT, version: TRAFIC.VERSION, source: TRAFIC.SOURCE, licence: TRAFIC.LICENCE,
    publication: isoOf(stats.publicationTime, stats), lastModified: isoOf(lastModified, stats),
    copied: new Date(Math.floor(now / 60000) * 60000).toISOString().replace('.000Z', 'Z'),
    count: events.length, counts, events,
  };
  const reductions = [];
  let text = `${JSON.stringify(json)}\n`;
  if (Buffer.byteLength(text) > maxBytes) {
    for (const ev of events) ev.c = null;
    reductions.push('commentaires retirés');
    text = `${JSON.stringify(json)}\n`;
  }
  const bytes = Buffer.byteLength(text);
  const problem = bytes > maxBytes ? `JSON trop gros (${Math.ceil(bytes / 1024)} Ko > ${Math.floor(maxBytes / 1024)} Ko)` : null;
  return { json, text, bytes, problem, beyond, lines, reductions };
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/** Date d'une ligne de liste de dossier (« 2026-11-26 16:24 » ou « 26-Nov-2026 16:24 »), lue en UTC, ou null. */
function listingDate(seg) {
  let m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(seg);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  m = /(\d{2})-([A-Z][a-z]{2})-(\d{4}) (\d{2}):(\d{2})/.exec(seg);
  if (m && m[2] in MONTHS) return Date.UTC(+m[3], MONTHS[m[2]], +m[1], +m[4], +m[5]);
  return null;
}
const minuteText = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/**
 * Dossier du flux (page de liste) : nombre de fichiers .xml autres que content.xml, combien portent un id connu, et
 * leur âge d'après la date de la liste (heure du serveur lue comme UTC : ± 2 h). Les fichiers par événement ne sont
 * jamais lus ici.
 */
export function listingStats(html, ids, now = null) {
  if (typeof html !== 'string') return null;
  const hits = [...html.matchAll(/href\s*=\s*["']([^"'?#]+\.xml)["']/gi)];
  const files = new Map();
  hits.forEach((m, i) => {
    const name = decodeURIComponent(m[1].split('/').pop());
    if (name.toLowerCase() === 'content.xml' || files.has(name)) return;
    const seg = html.slice(m.index + m[0].length, i + 1 < hits.length ? hits[i + 1].index : html.length);
    files.set(name, listingDate(seg));
  });
  if (!files.size) return { files: 0, matched: 0, examples: [], ages: null };
  const known = new Set([...ids].filter(Boolean).map(String));
  let matched = 0;
  for (const n of files.keys()) {
    const base = n.replace(/\.xml$/i, '');
    if (known.has(base) || base.split(/[_\-.]/).some((part) => known.has(part))) matched += 1;
  }
  let ages = null;
  const dates = [...files.values()].filter((d) => d != null);
  if (Number.isFinite(now)) {
    ages = { h2: 0, h24: 0, j7: 0, plus: 0, sansDate: files.size - dates.length };
    for (const d of dates) {
      const age = now - d;
      if (age <= 2 * 3600e3) ages.h2 += 1; else if (age <= 24 * 3600e3) ages.h24 += 1;
      else if (age <= 7 * 24 * 3600e3) ages.j7 += 1; else ages.plus += 1;
    }
    if (dates.length) { ages.oldest = minuteText(Math.min(...dates)); ages.newest = minuteText(Math.max(...dates)); }
  }
  return { files: files.size, matched, examples: [...files.keys()].slice(0, 3).map((n) => n.slice(0, 60)), ages };
}

// ── Journal (aucune coordonnée) ─────────────────────────────────────────────────────────────────────────────────────

const fmt = (o, max = 30) => {
  const e = Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = e.slice(0, max).map(([k, v]) => `${k} ${v}`).join(' ; ');
  return (head || '(aucun)') + (e.length > max ? ` ; … (+${e.length - max})` : '');
};

/** Journal lisible (chiffres seulement, aucune coordonnée). */
export function trafficLog(stats, result, { bytesRead = null, lastModified = null, listing = null } = {}) {
  const L = [];
  const sk = stats.skipped;
  L.push('████ Trafic — journal (aucune coordonnée)');
  L.push(`Flux lu : ${bytesRead != null ? `${(bytesRead / 1024).toFixed(0)} Ko décodés` : '?'} ; last-modified : ${lastModified ?? '(absent)'} ; publicationTime : ${stats.publicationTime ?? '(absente)'}`);
  L.push(`Situations : ${stats.situations} ; enregistrements (situationRecord) : ${stats.records}${stats.truncated ? ` ; tronqués (trop gros) : ${stats.truncated}` : ''}`);
  L.push(`Types DATEX (xsi:type) : ${fmt(stats.recordTypes)}`);
  L.push(`  Gestion de voies (RoadOrCarriagewayOrLaneManagement) : ${fmt(stats.roclmTypes)} — fermeture = ${CLOSURE_CODES.join(' / ')}`);
  L.push(`  Bouchons (AbnormalTraffic) : ${fmt(stats.abnormalTypes)}`);
  L.push(`Positions (groupOfLocations) : ${fmt(stats.groupTypes)}`);
  L.push(`  point ${stats.positions.point} ; ligne droite départ → arrivée ${stats.positions.ligne} ; aucune ${stats.positions.aucune} ; itinéraires indexés (point seulement) ${stats.indexedItineraries}`);
  L.push(`Sens (balise=valeur) : ${fmt(stats.directions)}`);
  L.push(`Début / fin (overallStartTime / overallEndTime) : les deux ${stats.times.lesDeux} ; début seul ${stats.times.debut} ; fin seule ${stats.times.fin} ; aucun ${stats.times.aucun}`);
  L.push(`validityStatus : ${fmt(stats.validity)} ; probabilityOfOccurrence : ${fmt(stats.probability)}`);
  L.push(`Sources (sourceName) : ${fmt(stats.sources, 15)}`);
  L.push(`Écartés : autres types ${sk.autres} ; sans position ${sk.sansPosition} ; hors France ${sk.horsFrance} ; terminés ${sk.termine} ; suspendus ${sk.suspendu} ; début > 7 j ${sk.futur} ; doublons même id ${sk.doublonId} ; doublons même type, lieu et début ${sk.doublonLieu}${sk.dateIllisible ? ` ; dates illisibles ${sk.dateIllisible}` : ''}`);
  if (result) {
    L.push(`Gardés : ${result.json.count} (${fmt(result.json.counts)}) ; dont lignes droites ${result.lines} ; à venir (≤ 7 j) ${stats.future} ; avec route ${stats.withRoad} ; avec commentaire ${stats.withComment}${result.beyond ? ` ; au-delà de ${TRAFIC.MAX_EVENTS} : ${result.beyond} écartés` : ''}`);
    L.push(`Sens des gardés : deux sens ${stats.dirKept.both} ; un sens ${stats.dirKept.one} ; inconnu ${stats.dirKept.inconnu}`);
    L.push(`Ordre départ → arrivée des lignes à sens cardinal (tous enregistrements) : suit le sens ${stats.dirCheck.suit} ; inverse ${stats.dirCheck.inverse} ; flou (60 à 120°) ${stats.dirCheck.flou}`);
    L.push(`JSON : ${(result.bytes / 1024).toFixed(1)} Ko${result.reductions.length ? ` (${result.reductions.join(', ')})` : ''}${result.problem ? ` — REFUSÉ : ${result.problem}` : ''}`);
  }
  L.push(`Carte des balises dans situationRecord (noms seulement) : ${fmt(stats.tags, 80)}${stats.otherTags ? ` ; autres noms ${stats.otherTags}` : ''}`);
  const lst = listing == null ? 'non mesurée'
    : listing.error ? `non mesurable (${listing.error})`
      : `${listing.files} fichiers .xml listés dans le dossier, ${listing.matched} portent un id de content.xml${listing.examples?.length ? ` (ex. ${listing.examples.join(', ')})` : ''}${listing.ages ? ` ; dates de la liste (± 2 h) : ≤ 2 h ${listing.ages.h2}, ≤ 24 h ${listing.ages.h24}, ≤ 7 j ${listing.ages.j7}, plus ancien ${listing.ages.plus}, sans date ${listing.ages.sansDate}${listing.ages.newest ? ` (du ${listing.ages.oldest} au ${listing.ages.newest})` : ''}` : ''}`;
  L.push(`Dossier du flux : ${lst}`);
  L.push('');
  L.push('████ Réponses aux « À vérifier » de l\'étude (docs/etude-trafic.md § 6)');
  const closures = CLOSURE_CODES.map((c) => `${c} ${stats.roclmTypes[c] ?? 0}`).join(', ');
  L.push(`- Codes des fermetures : ${closures} ; autres codes de gestion de voies (non gardés) : ${fmt(Object.fromEntries(Object.entries(stats.roclmTypes).filter(([k]) => !CLOSURE_CODES.includes(k))), 10)}.`);
  const dc = stats.dirCheck;
  const dcTotal = dc.suit + dc.inverse + dc.flou;
  L.push(`- Sens : ${fmt(stats.directions, 10)}${Object.keys(stats.directions).length ? '' : ' — aucune balise de sens trouvée'}.${dcTotal ? ` Droite départ → arrivée dans le sens cardinal publié : ${dc.suit}/${dcTotal} (inverse ${dc.inverse}, flou ${dc.flou}).` : ''}`);
  L.push(`- Positions : point ${stats.positions.point}, ligne droite ${stats.positions.ligne}, aucune ${stats.positions.aucune}.`);
  let complete = 'non mesurable';
  if (listing && !listing.error) {
    if (listing.files === 0) complete = 'aucun fichier par événement listé : content.xml seul';
    else if (listing.matched >= listing.files) complete = `complet (${listing.files} fichiers listés, tous dans content.xml)`;
    else complete = `non établie : noms de fichiers sans lien avec les id (${listing.files} fichiers listés, ${listing.matched} reconnus ; ${stats.situations} situations, ${stats.records} enregistrements dans content.xml${listing.ages ? ` ; ${listing.ages.h2} fichiers datés de moins de 2 h` : ''})`;
  }
  L.push(`- Complétude de content.xml : ${complete}.`);
  return L.join('\n');
}
