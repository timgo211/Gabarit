// Audit OpenStreetMap des grands axes de France (Action « Audit OSM », tools/audit-osm.mjs). Logique pure, testée
// sous Node. Lecture seule : rien n'est jamais écrit dans OSM ; chaque fiche propose une correction « à vérifier sur
// place », faite à la main par un contributeur. La signalisation fait foi. Données © contributeurs OpenStreetMap, ODbL.
//
// Pourquoi (étude docs/etude-osm-axes.md) : au-delà de 150 km à vol d'oiseau, ORS refuse les zones à éviter ; seules
// les étiquettes OSM lues par le graphe d'ORS protègent le camion. Section 2 de l'étude (code ORS et GraphHopper
// v4.17.0 lus le 25/11/2026) : `hgv=no` toujours bloquant ; `maxheight` comparé à la hauteur du profil ; une arête
// sans hauteur est acceptée ; `maxheight` sur le pont lui-même ne protège pas la voie du dessous ; `hgv:conditional`
// (horaires, poids) et `hgv=destination` ne bloquent rien.
//
// Niveaux : 1 autoroutes (motorway, motorway_link) ; 2 nationales (trunk, trunk_link, ou primary à référence N…) ;
// 3 grandes départementales (primary ou secondary à référence D…), audité seulement sur demande. Niveau 3 : fiches de
// priorité 1 (interdiction PL absente) et 2 (hauteur basse connue, hauteur sur le pont seulement) seulement ; aucune
// fiche « pont sans hauteur » ni « tunnel sans hauteur » (réseau trop vaste pour des fiches de hauteur inconnue).
// Constats, par priorité : 1 interdiction PL connue (tools/audit-osm-interdictions.json, tableau 4 de l'étude) sans
// l'étiquette correspondante ; 2 hauteur basse connue (< LOW_HEIGHT_M, seuil de tri et non une règle : valeur et sens à
// vérifier) ; 3 hauteur inconnue (pont au-dessus d'un axe ou tunnel d'un axe sans maxheight sur la voie de l'axe).
// v91 (règle du propriétaire, sans source officielle) : niveau 1, fiche « pont sans hauteur » gardée seulement si le
// point du croisement est dans une zone de grande agglomération (agglo-zones.js, même code que l'appli) ; zones
// absentes ou illisibles : l'audit s'arrête sans rien écrire (auditZones), jamais de fiche retirée en silence.

import { bridgeLayer, heightTag } from './bridges-convert.js';
import { parseHeight } from './bridge-check.js';
import { normalizeRefs } from './hgv-tolls-geo.js';
import { aggloZoneAt, parseAggloZones } from './agglo-zones.js';

export const AUDIT = Object.freeze({
  DIR: './data/audit-osm/',
  REPORT_PATH: './docs/audit-osm-axes.md',
  LEVELS: Object.freeze([1, 2]),
  /** Hauteur sous laquelle une hauteur connue est listée (m) : tri seulement, pas une règle. */
  LOW_HEIGHT_M: 4.3,
  /** Section d'une interdiction : boîte des deux communes élargie de cette marge (m). */
  PLACE_MARGIN_M: 2000,
  /** Index des segments d'axe : cellules de 0,01° (≈ 1 km) ; ponts examinés à moins de NEAR_M d'un axe. */
  CELL_DEG: 0.01,
  NEAR_M: 50,
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  /** data/audit-osm/ en tout (fichiers + index.json) : au-delà, rien n'est écrit (anciens fichiers gardés). */
  MAX_TOTAL_BYTES: 30 * 1024 * 1024,
  /** Niveau 3 : priorités et types de fiche gardés (garde-fou, les niveaux 1-2 ne changent pas). */
  LEVEL3_PRIORITIES: Object.freeze([1, 2]),
  LEVEL3_TYPES: Object.freeze(['interdiction PL absente', 'hauteur basse connue', 'hauteur sur le pont seulement']),
  /** Fiches listées par priorité dans le rapport. */
  REPORT_TOP: 50,
  /** Étiquettes recopiées dans « étiquettes actuelles » (utiles à la correction seulement). */
  KEYS: Object.freeze([
    'highway', 'ref', 'bridge', 'tunnel', 'layer', 'maxheight', 'maxheight:physical', 'maxweight', 'maxweight:hgv',
    'hgv', 'hgv:forward', 'hgv:backward', 'hgv:conditional', 'access', 'motor_vehicle', 'oneway',
  ]),
  NOTE: 'à vérifier sur place',
  PRIORITY_NAMES: Object.freeze({ 1: 'interdiction PL', 2: 'hauteur basse connue', 3: 'hauteur inconnue' }),
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const RAD = Math.PI / 180;
const KY = 110540;
const kxAt = (lat) => Math.cos(lat * RAD) * 111320;
const str = (x) => (typeof x === 'string' ? x.trim() : '');

/** Niveau d'audit d'une voie (1, 2, 3) ou null. */
export function axisLevel(tags) {
  const h = str(tags?.highway);
  if (h === 'motorway' || h === 'motorway_link') return 1;
  if (h === 'trunk' || h === 'trunk_link') return 2;
  const refs = normalizeRefs(str(tags?.ref));
  if (h === 'primary' && refs.some((r) => /^N\d/.test(r))) return 2;
  if ((h === 'primary' || h === 'secondary') && refs.some((r) => /^D\d/.test(r))) return 3;
  return null;
}

/** Étiquettes utiles d'une voie (AUDIT.KEYS présentes). */
export function usefulTags(tags) {
  const out = {};
  for (const k of AUDIT.KEYS) if (str(tags?.[k])) out[k] = str(tags[k]);
  return out;
}

/** Nom de commune comparable : minuscules, sans accents, tirets et apostrophes en espaces. */
export function normName(s) {
  return str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-'’]/g, ' ').replace(/\s+/g, ' ')
    .trim();
}

const isBridge = (t) => /^(yes|viaduct)$/.test(str(t?.bridge));
const isTunnel = (t) => /^(yes|building_passage)$/.test(str(t?.tunnel));
/** layer d'une voie au sol : absent → 0 ; illisible → 0. */
const groundLayer = (t) => {
  const n = Number(str(t?.layer).split(';')[0]);
  return str(t?.layer) && Number.isFinite(n) ? n : 0;
};

/**
 * Objet GeoJSON exporté par osmium → voie d'axe auditée { id, level, refs, tags, coords, bridge, tunnel, layer } ou
 * null (pas une voie d'axe de ces niveaux).
 */
export function auditAxisFromFeature(f, levels = AUDIT.LEVELS) {
  const m = /^w(\d+)$/.exec(String(f?.id ?? ''));
  const t = f?.properties && typeof f.properties === 'object' ? f.properties : null;
  if (!m || !t || f?.geometry?.type !== 'LineString' || !Array.isArray(f.geometry.coordinates)) return null;
  const level = axisLevel(t);
  if (!level || !levels.includes(level)) return null;
  const coords = f.geometry.coordinates.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
  if (coords.length < 2) return null;
  return {
    id: Number(m[1]), level, refs: normalizeRefs(str(t.ref)), tags: usefulTags(t), coords,
    bridge: isBridge(t), tunnel: isTunnel(t), layer: groundLayer(t),
  };
}

/** Nœud de commune (place=city|town|village) → { name, lonlat } ou null. */
export function placeFromFeature(f) {
  const t = f?.properties;
  if (f?.geometry?.type !== 'Point' || !t || !/^(city|town|village)$/.test(str(t.place)) || !str(t.name)) return null;
  const [x, y] = f.geometry.coordinates ?? [];
  return isNum(x) && isNum(y) ? { name: normName(t.name), lonlat: [x, y] } : null;
}

/**
 * Pont routier ou ferré (bridge=yes|viaduct, layer ≥ 1) → { id, kind, height, tags, coords } ou null. Passerelles
 * piétonnes gardées : au-dessus d'une autoroute, elles limitent aussi la hauteur. Projets et chantiers écartés.
 */
export function auditBridgeFromFeature(f) {
  const m = /^w(\d+)$/.exec(String(f?.id ?? ''));
  const t = f?.properties && typeof f.properties === 'object' ? f.properties : null;
  if (!m || !t || !isBridge(t) || bridgeLayer(t) < 1) return null;
  if (/^(proposed|construction)$/.test(str(t.highway)) || /^(proposed|construction|abandoned|razed)$/.test(str(t.railway))) return null;
  if (!str(t.highway) && !str(t.railway)) return null;
  if (f?.geometry?.type !== 'LineString' || !Array.isArray(f.geometry.coordinates)) return null;
  const coords = f.geometry.coordinates.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
  if (coords.length < 2) return null;
  return {
    id: Number(m[1]), kind: str(t.railway) ? `railway=${str(t.railway)}` : `highway=${str(t.highway)}`,
    height: parseHeight(heightTag(t)), heightText: heightTag(t), layer: bridgeLayer(t), coords,
  };
}

// ───────── Index des segments d'axe (voies au sol, hors pont et hors tunnel) ─────────

const cellOf = (lon, lat) => `${Math.floor(lon / AUDIT.CELL_DEG)}_${Math.floor(lat / AUDIT.CELL_DEG)}`;

/** Index : cellule → [indice de voie, indice de segment]… ; seules les voies au sol des niveaux audités. */
export function buildAxisIndex(axes) {
  const cells = new Map();
  let segments = 0;
  axes.forEach((a, i) => {
    if (a.bridge || a.tunnel) return;
    for (let s = 0; s + 1 < a.coords.length; s += 1) {
      const [x1, y1] = a.coords[s]; const [x2, y2] = a.coords[s + 1];
      const c0 = Math.floor(Math.min(x1, x2) / AUDIT.CELL_DEG); const c1 = Math.floor(Math.max(x1, x2) / AUDIT.CELL_DEG);
      const r0 = Math.floor(Math.min(y1, y2) / AUDIT.CELL_DEG); const r1 = Math.floor(Math.max(y1, y2) / AUDIT.CELL_DEG);
      for (let c = c0; c <= c1; c += 1) {
        for (let r = r0; r <= r1; r += 1) {
          const k = `${c}_${r}`;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(i, s);
        }
      }
      segments += 1;
    }
  });
  return { cells, segments };
}

/**
 * Point où le segment de pont [a, b] croise le segment d'axe [c, d] (plan local), ou null. Un bout du pont posé sur
 * l'axe (raccordement, pas un passage au-dessus) : null ; un sommet de l'axe sous le pont : compté.
 */
export function segmentCrossing(a, b, c, d) {
  const kx = kxAt((a[1] + c[1]) / 2);
  const p = (q) => [(q[0] - a[0]) * kx, (q[1] - a[1]) * KY];
  const [bx, by] = p(b); const [cx, cy] = p(c); const [dx, dy] = p(d);
  const den = bx * (dy - cy) - by * (dx - cx);
  if (Math.abs(den) < 1e-9) return null;
  const t = (cx * (dy - cy) - cy * (dx - cx)) / den;
  const u = (cx * by - cy * bx) / den;
  const eps = 1e-6;
  if (t <= eps || t >= 1 - eps || u < -eps || u > 1 + eps) return null;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Le pont passe-t-il à moins de AUDIT.NEAR_M d'une cellule occupée de l'index ? (garde-fou de la passe des ponts) */
export function bridgeNearAxis(bridge, index) {
  const lat = bridge.coords[0][1];
  const mx = AUDIT.NEAR_M / kxAt(lat); const my = AUDIT.NEAR_M / KY;
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  for (const [x, y] of bridge.coords) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  for (let c = Math.floor((w - mx) / AUDIT.CELL_DEG); c <= Math.floor((e + mx) / AUDIT.CELL_DEG); c += 1) {
    for (let r = Math.floor((s - my) / AUDIT.CELL_DEG); r <= Math.floor((n + my) / AUDIT.CELL_DEG); r += 1) {
      if (index.cells.has(`${c}_${r}`)) return true;
    }
  }
  return false;
}

/** Croisements d'un pont avec les voies d'axe au sol plus basses : [{ axis (indice), point }] (une fois par voie). */
export function bridgeCrossings(bridge, axes, index) {
  const out = new Map();
  for (let s = 0; s + 1 < bridge.coords.length; s += 1) {
    const a = bridge.coords[s]; const b = bridge.coords[s + 1];
    const seen = new Set();
    for (let c = Math.floor(Math.min(a[0], b[0]) / AUDIT.CELL_DEG); c <= Math.floor(Math.max(a[0], b[0]) / AUDIT.CELL_DEG); c += 1) {
      for (let r = Math.floor(Math.min(a[1], b[1]) / AUDIT.CELL_DEG); r <= Math.floor(Math.max(a[1], b[1]) / AUDIT.CELL_DEG); r += 1) {
        const list = index.cells.get(`${c}_${r}`);
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const i = list[k]; const j = list[k + 1];
          const key = `${i}:${j}`;
          if (seen.has(key) || out.has(i)) continue;
          seen.add(key);
          const ax = axes[i];
          if (ax.layer >= bridge.layer || ax.id === bridge.id) continue;
          const pt = segmentCrossing(a, b, ax.coords[j], ax.coords[j + 1]);
          if (pt) out.set(i, pt);
        }
      }
    }
  }
  return [...out.entries()].map(([axis, point]) => ({ axis, point }));
}

// ───────── Fiches ─────────

const round5 = (p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];
const fmtM = (h) => `${String(Math.round(h * 100) / 100).replace('.', ',')} m`;

/** Fiche d'audit (une correction proposée). */
export function auditCard({ axis, priority, type, proposed, source, confidence, orsReads, point = null, extra = {} }) {
  return {
    way: axis.id,
    url: `https://www.openstreetmap.org/way/${axis.id}`,
    niveau: axis.level,
    priorite: priority,
    type,
    ref: axis.refs.join(';'),
    point: point ? round5(point) : round5(axis.coords[Math.floor(axis.coords.length / 2)]),
    etiquettesActuelles: axis.tags,
    etiquettesProposees: proposed,
    source,
    confiance: confidence,
    orsLit: orsReads,
    note: AUDIT.NOTE,
    ...extra,
  };
}

/** Type d'une fiche sans la section entre parenthèses (« interdiction PL absente (n59) » → « interdiction PL absente »). */
const baseType = (c) => String(c?.type ?? '').replace(/ \(.*\)$/, '');

/** Fiche gardée ? Niveaux 1-2 : toujours ; niveau 3 : priorités 1 et 2 et types AUDIT.LEVEL3_TYPES seulement. */
export function keepCard(card) {
  if (card?.niveau !== 3) return true;
  return AUDIT.LEVEL3_PRIORITIES.includes(card.priorite) && AUDIT.LEVEL3_TYPES.includes(baseType(card));
}

const axisHeight = (ax) => parseHeight(ax.tags['maxheight:physical'] ?? ax.tags.maxheight ?? '');
const hasHeightText = (ax) => Boolean(ax.tags['maxheight:physical'] || ax.tags.maxheight);

/** Fiches propres aux voies d'axe : tunnels sans hauteur, hauteurs basses connues. */
export function axisCards(axes) {
  const cards = [];
  for (const ax of axes) {
    const h = axisHeight(ax);
    if (h !== null && h < AUDIT.LOW_HEIGHT_M) {
      cards.push(auditCard({
        axis: ax, priority: 2, type: 'hauteur basse connue', proposed: {},
        source: `étiquette OSM maxheight = ${ax.tags['maxheight:physical'] ?? ax.tags.maxheight} (${fmtM(h)}) : valeur et sens à vérifier`,
        confidence: 'moyenne', orsReads: 'oui',
      }));
    } else if (ax.tunnel && !hasHeightText(ax)) {
      cards.push(auditCard({
        axis: ax, priority: 3, type: 'tunnel sans hauteur', proposed: { maxheight: 'hauteur du panneau B12 (à relever)' },
        source: 'étiquette tunnel sans maxheight ni maxheight:physical', confidence: 'haute', orsReads: 'oui',
      }));
    }
  }
  return cards.filter(keepCard);
}

/** Fiche niveau 1 « pont sans hauteur » : gardée seulement en zone de grande agglomération (v91). */
const motorwayBridge = (c) => c.niveau === 1 && c.type === 'pont sans hauteur';

/**
 * Fiches d'un pont au-dessus d'axes (croisements de bridgeCrossings). v91 : `zones` (parseAggloZones) obligatoire dès
 * qu'une fiche niveau 1 « pont sans hauteur » est en jeu (sinon erreur : jamais retirée en silence) ; `stats`
 * (facultatif) compte les fiches gardées (`motorwayIn`) et retirées (`motorwayOut`).
 */
export function bridgeCards(bridge, crossings, axes, { zones = null, stats = null } = {}) {
  const cards = [];
  for (const { axis, point } of crossings) {
    const ax = axes[axis];
    if (hasHeightText(ax)) continue; // hauteur connue : fiche « hauteur basse » éventuelle déjà faite (axisCards)
    const extra = { pont: bridge.id, pontUrl: `https://www.openstreetmap.org/way/${bridge.id}`, pontType: bridge.kind };
    if (bridge.height !== null) {
      cards.push(auditCard({
        axis: ax, priority: bridge.height < AUDIT.LOW_HEIGHT_M ? 2 : 3, type: 'hauteur sur le pont seulement',
        proposed: { maxheight: String(bridge.height) },
        source: `maxheight = ${bridge.heightText} porté par le pont way/${bridge.id} (ignoré pour la voie du dessous) : `
          + 'à reporter sur la voie qui passe dessous (découpée sous le pont), valeur à vérifier',
        confidence: 'moyenne', orsReads: 'oui', point, extra,
      }));
    } else {
      cards.push(auditCard({
        axis: ax, priority: 3, type: 'pont sans hauteur', proposed: { maxheight: 'hauteur du panneau B12 ou mesurée (à relever)' },
        source: `pont way/${bridge.id} (${bridge.kind}) au-dessus, aucune hauteur sur la voie du dessous`,
        confidence: 'haute', orsReads: 'oui', point, extra,
      }));
    }
  }
  return cards.filter((c) => {
    if (!motorwayBridge(c)) return true;
    if (!zones) throw new Error('Audit OSM : zones des grandes agglomérations non lues (fiche « pont sans hauteur » de niveau 1).');
    const keep = aggloZoneAt(c.point, zones) !== null;
    if (stats) stats[keep ? 'motorwayIn' : 'motorwayOut'] = (stats[keep ? 'motorwayIn' : 'motorwayOut'] ?? 0) + 1;
    return keep;
  }).filter(keepCard);
}

/**
 * Zones de l'audit (v91) : read(chemin relatif) → texte (exception si absent). → { zones, names } ou { problem }
 * (fichier absent, JSON illisible, zone manquante ou sans anneau). v92 : names = noms officiels IGN lus dans les deux
 * fichiers (names de data/zones-agglo.json, props de data/contours-ign.json), dans l'ordre des zones ; null si un nom
 * manque (le rapport renvoie alors aux fichiers, sans liste écrite en dur).
 */
export function auditZones(read) {
  const files = ['data/zones-agglo.json', 'data/contours-ign.json'];
  const json = [];
  for (const f of files) {
    let text;
    try { text = read(f); } catch { return { problem: `${f} absent` }; }
    try { json.push(JSON.parse(text)); } catch { return { problem: `${f} illisible` }; }
  }
  const zones = parseAggloZones(json[0], json[1]);
  if (!zones) return { problem: `${files.join(' ou ')} : zone manquante ou sans contour` };
  // Propriétés IGN de data/contours-ign.json : Eurométropole sous props.epci (taxes PL), Lyon sous props.metropoleLyon.
  const contourProps = { metropoleLyon: json[1].props?.metropoleLyon, eurometropole: json[1].props?.epci };
  const names = zones.zones.map((z) => String((json[0].names?.[z.key] ?? contourProps[z.key]?.nom_officiel) || '').trim());
  return { zones, names: names.every(Boolean) ? names : null };
}

// ───────── Interdictions connues (tableau 4 de l'étude) ─────────

/** Communes → Map nom normalisé → [[lon, lat]…]. */
export function placeIndex(places) {
  const m = new Map();
  for (const p of places) { if (!m.has(p.name)) m.set(p.name, []); m.get(p.name).push(p.lonlat); }
  return m;
}

const inBox = ([x, y], [w, s, e, n]) => x >= w && x <= e && y >= s && y <= n;

/** Boîte de la section d'une interdiction, ou { reason } si elle n'est pas localisable sans deviner. */
export function locateSection(entry, places) {
  if (!entry || !Array.isArray(entry.refs) || !entry.refs.length) return { reason: 'aucune référence de route' };
  if (!Array.isArray(entry.zone) || entry.zone.length !== 4) return { reason: 'zone absente' };
  const pts = [];
  for (const which of ['de', 'a']) {
    const name = normName(entry[which]);
    if (!name) return { reason: `commune « ${which} » absente` };
    const found = (places.get(name) ?? []).filter((p) => inBox(p, entry.zone));
    if (found.length !== 1) return { reason: `commune « ${entry[which]} » : ${found.length} nœud(s) place dans la zone (il en faut un)` };
    pts.push(found[0]);
  }
  const margin = isNum(entry.marge_m) && entry.marge_m > 0 ? entry.marge_m : AUDIT.PLACE_MARGIN_M;
  const mx = margin / kxAt((pts[0][1] + pts[1][1]) / 2); const my = margin / KY;
  return {
    box: [Math.min(pts[0][0], pts[1][0]) - mx, Math.min(pts[0][1], pts[1][1]) - my,
      Math.max(pts[0][0], pts[1][0]) + mx, Math.max(pts[0][1], pts[1][1]) + my],
  };
}

const tagVariants = (tags, key) => [key, `${key}:forward`, `${key}:backward`].map((k) => str(tags[k])).filter(Boolean);

/** La voie porte-t-elle déjà l'étiquette attendue pour cette interdiction ? */
export function restrictionPresent(entry, tags) {
  const hgv = tagVariants(tags, 'hgv');
  const cond = tagVariants(tags, 'hgv:conditional');
  if (entry.nature === 'hauteur') {
    const h = parseHeight(tags['maxheight:physical'] ?? tags.maxheight ?? '');
    return h !== null && h <= entry.valeur + 0.005;
  }
  if (hgv.some((v) => /^(no|private)$/.test(v))) return true;
  if (entry.nature === 'interdit') return false;
  if (entry.nature === 'transit') return hgv.some((v) => /^(destination|delivery)$/.test(v)) || cond.length > 0;
  if (entry.nature === 'poids') {
    for (const c of cond) {
      const m = /weight\s*>\s*(\d+(?:[.,]\d+)?)/.exec(c);
      if (m && Number(m[1].replace(',', '.')) <= entry.valeur) return true;
    }
    const w = Number(str(tags.maxweight).replace(',', '.'));
    return Number.isFinite(w) && w > 0 && w <= entry.valeur;
  }
  return false;
}

/** Étiquettes proposées et lecture par ORS (étude, section 2). */
export function restrictionProposal(entry) {
  const oneWay = entry.sens && entry.sens !== '2 sens';
  let proposed; let ors;
  if (entry.nature === 'interdit') { proposed = { hgv: 'no' }; ors = 'oui'; }
  else if (entry.nature === 'hauteur') { proposed = { maxheight: String(entry.valeur) }; ors = 'oui'; }
  else if (entry.nature === 'transit' && isNum(entry.valeur) && entry.valeur > 3.5) {
    proposed = { 'hgv:conditional': `destination @ (weight>${entry.valeur})` }; ors = 'non (hgv:conditional ignoré par ORS)';
  } else if (entry.nature === 'transit') { proposed = { hgv: 'destination' }; ors = 'non (hgv=destination ne bloque rien dans ORS)'; }
  else {
    proposed = { 'hgv:conditional': `${entry.desserte ? 'destination' : 'no'} @ (weight>${entry.valeur})` };
    ors = 'non (hgv:conditional ignoré par ORS)';
  }
  if (oneWay) {
    ors = ors === 'oui' ? 'à vérifier (un seul sens)' : ors;
    proposed = { ...proposed, sens: `${entry.sens} seulement : suffixe :forward ou :backward selon le sens du chemin` };
  }
  return { proposed, ors };
}

/**
 * Lecture par ORS d'une étiquette déjà présente sur la voie : hgv=no / private et maxheight bloquent le calcul ;
 * hgv=destination / delivery et hgv:conditional ne bloquent rien (étude, section 2).
 */
export function orsReadsPresent(entry, tags) {
  if (entry?.nature === 'hauteur') return 'oui';
  if (tagVariants(tags ?? {}, 'hgv').some((v) => /^(no|private)$/.test(v))) return 'oui';
  return 'non (déjà étiquetée, ORS ne la lit pas)';
}

/**
 * Fiches des interdictions connues : voies de même référence dans la section localisée sans l'étiquette attendue.
 * v82 : voies de la section qui portent DÉJÀ l'étiquette (N59 de Lunéville à Raon-l'Étape : hgv:conditional sur chaque
 * voie) renvoyées à part (`tagged`) avec la marque `dejaEtiquetee` : jamais une fiche de correction (data/audit-osm/
 * inchangé), seulement des points de la section dans data/points-sensibles/ (section entière sur le tracé).
 * @returns {{ cards:object[], located:object[], unlocated:object[], tagged:object[] }}
 */
export function restrictionCards(entries, axes, places) {
  const cards = []; const located = []; const unlocated = []; const tagged = [];
  for (const e of entries ?? []) {
    if (e.localisable === false) { unlocated.push({ entry: e, reason: e.raison ?? 'non localisable sans deviner' }); continue; }
    const sec = locateSection(e, places);
    if (!sec.box) { unlocated.push({ entry: e, reason: sec.reason }); continue; }
    const refs = e.refs.flatMap((r) => normalizeRefs(r));
    const ways = axes.filter((ax) => ax.refs.some((r) => refs.includes(r)) && (!e.tunnel || ax.tunnel)
      && ax.coords.some((p) => inBox(p, sec.box)));
    if (!ways.length) { unlocated.push({ entry: e, reason: `aucune voie ${refs.join('/')}${e.tunnel ? ' en tunnel' : ''} dans la section` }); continue; }
    const missing = ways.filter((ax) => !restrictionPresent(e, ax.tags));
    const present = ways.filter((ax) => restrictionPresent(e, ax.tags));
    located.push({ entry: e, ways: ways.length, missing: missing.length, tagged: present.length });
    const { proposed, ors } = restrictionProposal(e);
    const confidence = e.lu === 'arrêté' ? 'moyenne' : 'faible';
    for (const ax of present) {
      tagged.push(auditCard({
        axis: ax, priority: 0, type: `interdiction PL déjà étiquetée (${e.id})`, proposed: null,
        source: `${e.texte} — ${e.arrete} ; ${e.source} ; en vigueur : à vérifier`,
        confidence, orsReads: orsReadsPresent(e, ax.tags), extra: { section: e.id, dejaEtiquetee: true },
      }));
    }
    for (const ax of missing) {
      cards.push(auditCard({
        axis: ax, priority: 1, type: `interdiction PL absente (${e.id})`, proposed,
        source: `${e.texte} — ${e.arrete} ; ${e.source} ; en vigueur : à vérifier`,
        confidence, orsReads: ors, extra: { section: e.id },
      }));
    }
  }
  return { cards, located, unlocated, tagged };
}

// ───────── Tri, découpage, rapport ─────────

export function sortCards(cards) {
  return cards.slice().sort((a, b) => a.priorite - b.priorite || a.niveau - b.niveau || a.way - b.way
    || (a.pont ?? 0) - (b.pont ?? 0));
}

/**
 * Fiches triées → fichiers de data/audit-osm/ par niveau, chacun ≤ maxBytes : Map nom → contenu (niveau-N.json, ou
 * niveau-N-1.json, niveau-N-2.json… s'il faut couper).
 */
export function splitCards(cards, maxBytes = AUDIT.MAX_FILE_BYTES) {
  const byLevel = new Map();
  for (const c of sortCards(cards)) { if (!byLevel.has(c.niveau)) byLevel.set(c.niveau, []); byLevel.get(c.niveau).push(c); }
  const files = new Map();
  for (const level of [...byLevel.keys()].sort()) {
    const parts = [];
    let cur = []; let size = 64;
    for (const c of byLevel.get(level)) {
      const n = Buffer.byteLength(JSON.stringify(c)) + 1;
      if (cur.length && size + n > maxBytes) { parts.push(cur); cur = []; size = 64; }
      cur.push(c); size += n;
    }
    if (cur.length) parts.push(cur);
    parts.forEach((p, i) => {
      const name = parts.length === 1 ? `niveau-${level}.json` : `niveau-${level}-${i + 1}.json`;
      files.set(name, { niveau: level, partie: i + 1, parties: parts.length, note: AUDIT.NOTE, fiches: p });
    });
  }
  return files;
}

/**
 * Taille de data/audit-osm/ telle qu'elle serait écrite (même texte que l'écriture : JSON + saut de ligne) ; problem
 * non nul → rien n'est écrit (ni copie partielle) et les anciens fichiers restent.
 * @returns {{ total:number, biggest:[string, number], problem:string|null }}
 */
export function auditSize(files, index, { maxFile = AUDIT.MAX_FILE_BYTES, maxTotal = AUDIT.MAX_TOTAL_BYTES } = {}) {
  let total = 0; let biggest = ['', 0];
  for (const [name, content] of [...files.entries(), ['index.json', index]]) {
    const n = Buffer.byteLength(`${JSON.stringify(content)}\n`);
    total += n;
    if (n > biggest[1]) biggest = [name, n];
  }
  const mo = (n) => (n / 1024 / 1024).toFixed(2).replace('.', ',');
  let problem = null;
  if (biggest[1] > maxFile) problem = `fichier ${biggest[0]} de ${mo(biggest[1])} Mo (plafond ${mo(maxFile)} Mo par fichier)`;
  else if (total > maxTotal) problem = `${mo(total)} Mo en tout (plafond ${mo(maxTotal)} Mo)`;
  return { total, biggest, problem };
}

/** Comptes de l'audit (index.json). */
export function auditIndex(cards, files, { updated = null, levels = AUDIT.LEVELS, extra = {} } = {}) {
  const count = (f) => { const o = {}; for (const c of cards) { const k = f(c); o[k] = (o[k] ?? 0) + 1; } return o; };
  return {
    source: 'OpenStreetMap (extrait Geofabrik France) — audit en lecture seule, rien écrit dans OSM',
    license: 'ODbL — © contributeurs OpenStreetMap',
    updated,
    levels,
    total: cards.length,
    parNiveau: count((c) => c.niveau),
    parPriorite: count((c) => c.priorite),
    parType: count(baseType),
    files: Object.fromEntries([...files.entries()].map(([k, v]) => [k, v.fiches.length])),
    note: `${AUDIT.NOTE} ; la signalisation fait foi`,
    ...extra,
  };
}

/** Trous connus (texte fixe tiré de l'étude, section 4) : jamais localisés par l'audit. */
export const KNOWN_GAPS = Object.freeze([
  ['RN 118', 'non documentée dans l\'étude (aucune source lue sur une interdiction PL permanente) : à documenter.'],
  ['Duplex A86', 'interdit à tous les PL selon une page Vinci (source secondaire) ; arrêtés interpréfectoraux 2012-657 du '
    + '06/08/2012 et 2016-2-493 du 18/11/2016 connus par extrait, contenu non lu ; gabarit de 2 m confirmé par aucune '
    + 'source lue : à documenter.'],
  ['Tunnel de l\'A14 sous La Défense', 'plus de 3,5 t interdits dans les dépliants Bison Futé 2014 et 2017, absent en 2020 '
    + 'et 2026 ; camions réautorisés selon la presse ; arrêté DRIEAT IF n° 2021-2-054 du 03/05/2021 connu par extrait '
    + 'seulement : à documenter.'],
  ['Transit dans Paris', 'arrêté municipal (plus de 7,5 t, boulevard périphérique non concerné), hors réseau national ; '
    + 'n° et date non lus : à documenter.'],
]);

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const tagText = (o) => Object.entries(o ?? {}).map(([k, v]) => `\`${k}=${v}\``).join(' ') || '—';

/** Texte Markdown de docs/audit-osm-axes.md. */
export function auditReport(index, cards, { located = [], unlocated = [], axesLog = [], runLog = [], zoneNames = null } = {}) {
  const L = [];
  L.push('# Audit OSM des grands axes (lecture seule)', '');
  L.push(`Rapport écrit par l'Action « Audit OSM » (tools/audit-osm.mjs) ; extrait OpenStreetMap du ${index.updated ?? '?'} `
    + `(France) ; niveaux audités : ${index.levels.join(', ')} (1 autoroutes, 2 nationales, 3 grandes départementales).`, '');
  L.push(`Source de l'extrait : ${index.sourceExtrait ?? 'inconnue'} (même donnée OpenStreetMap, licence ODbL).`, '');
  L.push('Règles :', '- rien n\'est écrit dans OpenStreetMap : chaque fiche est une proposition, **à vérifier sur place** ;',
    '- **la signalisation fait foi** ; seul l\'arrêté fait foi pour la règle ; « en vigueur : à vérifier » ;',
    '- une correction faite dans OSM met 2 à 3 semaines à atteindre l\'API publique d\'ORS (étude, section 1) ;',
    '- données © contributeurs OpenStreetMap, licence ODbL ; fiches complètes dans `data/audit-osm/`.');
  // v92 : liste des zones lue dans les fichiers de données (auditZones), jamais écrite en dur ici.
  const zoneList = Array.isArray(zoneNames) && zoneNames.length
    ? `l'une des ${zoneNames.length} zones suivantes : ${zoneNames.join(', ')}`
    : 'une zone de data/zones-agglo.json ou de data/contours-ign.json';
  L.push(`- niveau 1 (autoroutes) : fiche « pont sans hauteur » seulement si le croisement est dans ${zoneList} `
    + '(Île-de-France et grandes agglomérations ; règle du propriétaire, sans source officielle) ;');
  if (index.levels.includes(3)) {
    L.push('- niveau 3 (grandes départementales : primary ou secondary à référence D…) : fiches de priorité 1 et 2 '
      + 'seulement, aucune fiche « pont sans hauteur » ni « tunnel sans hauteur ».');
  }
  L.push('');
  L.push('## Chiffres', '');
  L.push(`Fiches : **${index.total}**.`, '');
  L.push('| Priorité | Fiches |', '|---|---|');
  for (const p of [1, 2, 3]) L.push(`| ${p} — ${AUDIT.PRIORITY_NAMES[p]} | ${index.parPriorite[p] ?? 0} |`);
  L.push('', '| Niveau | Fiches |', '|---|---|');
  for (const n of index.levels) L.push(`| ${n} | ${index.parNiveau[n] ?? 0} |`);
  L.push('', '| Type | Fiches |', '|---|---|');
  for (const [t, n] of Object.entries(index.parType).sort()) L.push(`| ${esc(t)} | ${n} |`);
  L.push('', 'Fichiers : ' + (Object.entries(index.files).map(([f, n]) => `\`${f}\` (${n})`).join(', ') || 'aucun') + '.', '');
  L.push('## Interdictions connues (tableau 4 de l\'étude)', '');
  if (located.length) {
    L.push('| Section | Route | Voies trouvées | Sans l\'étiquette | Déjà étiquetées (points de section, pas des fiches) |', '|---|---|---|---|---|');
    for (const l of located) L.push(`| ${esc(l.entry.id)} | ${esc(l.entry.refs.join('/'))} | ${l.ways} | ${l.missing} | ${l.tagged ?? 0} |`);
    L.push('');
  }
  L.push('Non localisées (jamais devinées) :', '');
  for (const u of unlocated) {
    const refs = u.entry.refs?.length ? ` (${esc(u.entry.refs.join('/'))})` : '';
    L.push(`- ${esc(u.entry.id)}${refs} : ${esc(u.reason)}.`);
  }
  if (!unlocated.length) L.push('- aucune.');
  L.push('', 'Hors OSM (aucune étiquette lue par ORS) : classes Euro du Mont-Blanc et du Fréjus (phase 5g) ; interdictions '
    + 'horaires (Fréjus, N66 la nuit, N7 à Tain) : `hgv:conditional` ignoré par ORS (étude, section 2), non auditées.', '');
  L.push('## Trous connus', '', 'Non localisés par l\'audit, à documenter (ce que l\'étude en dit, rien de deviné) :', '');
  for (const [k, v] of KNOWN_GAPS) L.push(`- **${k}** : ${v}`);
  L.push('', '## Limites', '',
    '- hauteur posée sur un nœud (ORS la recopie sur la voie) : non lue par l\'audit, une fiche « sans hauteur » peut être de trop ;',
    '- un pont au-dessus d\'une voie découpée : la hauteur doit être sur le morceau sous le pont ;',
    '- seuil de 4,30 m : tri des fiches seulement, pas une règle ;',
    '- sections d\'interdiction : boîte des deux communes élargie de 2 km, approximative (confiance moyenne au mieux).', '');
  L.push('## Copie des axes (data/axes-osm/)', '');
  for (const l of axesLog) L.push(`- ${esc(l)}`);
  if (!axesLog.length) L.push('- aucun journal.');
  if (runLog.length) { L.push('', '## Journal de l\'Action', ''); for (const l of runLog) L.push(`- ${esc(l)}`); }
  for (const p of [1, 2, 3]) {
    const list = sortCards(cards).filter((c) => c.priorite === p).slice(0, AUDIT.REPORT_TOP);
    L.push('', `## Priorité ${p} — ${AUDIT.PRIORITY_NAMES[p]} (${list.length} premières fiches)`, '');
    if (!list.length) { L.push('Aucune.'); continue; }
    L.push('| Voie | Niveau | Route | Type | Proposé | ORS lit | Confiance |', '|---|---|---|---|---|---|---|');
    for (const c of list) {
      L.push(`| [${c.way}](${c.url}) | ${c.niveau} | ${esc(c.ref) || '—'} | ${esc(c.type)} | ${esc(tagText(c.etiquettesProposees))} `
        + `| ${esc(c.orsLit)} | ${c.confiance} |`);
    }
  }
  L.push('', `Toutes les fiches : ${AUDIT.NOTE}. La signalisation fait foi.`, '');
  return L.join('\n');
}
