// v91 : zones des grandes agglomérations (agglo-zones.js) pour les ponts sans hauteur au-dessus des autoroutes, dans
// l'appli (bridge-check.js, tests/bridges.test.js) et dans l'audit OSM (osm-audit.js, tools/audit-osm.mjs). Règle du
// propriétaire, sans source officielle ; la signalisation fait foi. Contours réels de data/ (IGN Admin Express COG 2026,
// fichiers du dépôt, aucun réseau) ; points de test et géométries SYNTHÉTIQUES à 2 décimales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AGGLO_ZONES, parseAggloZones, aggloZoneAt } from '../src/lib/agglo-zones.js';
import {
  auditAxisFromFeature, auditBridgeFromFeature, auditIndex, auditReport, auditZones, axisCards, bridgeCards, bridgeCrossings,
  buildAxisIndex, splitCards,
} from '../src/lib/osm-audit.js';
import { bridgeFromFeature, clearanceFromFeature, convertBridges } from '../src/lib/bridges-convert.js';
import { BRIDGE, parseBridgeTile, mergeBridgeTiles, bridgeLines, bridgeRules, lowBridgeText } from '../src/lib/bridge-check.js';
import { inRing } from '../src/lib/hgv-tolls-geo.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const ZONES = parseAggloZones(JSON.parse(read('data/zones-agglo.json')), JSON.parse(read('data/contours-ign.json')));
/** v92 : un point par métropole ajoutée, 2 décimales (centre-ville, choisi dans les contours du fichier de données). */
const CENTRES_V92 = {
  nice: [7.25, 43.72], montpellier: [3.88, 43.61], rennes: [-1.68, 48.11],
  grenoble: [5.72, 45.19], rouen: [1.10, 49.44], toulon: [5.95, 43.14],
};
/**
 * v93 : un point par agglomération ajoutée, CALCULÉ sur le vrai contour de data/zones-agglo.json (fichier du dépôt du
 * 27/11/2026) : point de la grille à 0,01° le plus loin du bord de la zone (3,8 km à Brest, 13,7 km à Reims), vérifié
 * par aggloZoneAt ci-dessous. Coordonnées à 2 décimales.
 */
const POINTS_V93 = {
  dijon: [5.01, 47.32], metz: [6.17, 49.11], nancy: [6.19, 48.68], reims: [4.15, 49.26], orleans: [1.91, 47.90],
  tours: [0.66, 47.38], angers: [-0.58, 47.51], clermontFerrand: [3.09, 45.77], saintEtienne: [4.51, 45.48],
  leHavre: [0.22, 49.54], avignon: [4.79, 43.97], brest: [-4.48, 48.42],
};
const V93 = Object.keys(POINTS_V93);

test('zones : les 27 contours lus, un point dans chacune, un point hors zone', () => {
  assert.ok(ZONES);
  assert.deepEqual(ZONES.zones.map((z) => z.key), [...AGGLO_ZONES.ZONES_KEYS, ...AGGLO_ZONES.CONTOURS_KEYS]);
  const at = (p) => aggloZoneAt(p, ZONES);
  // Grand Paris est dans l'Île-de-France : la première zone trouvée est l'Île-de-France.
  assert.equal(at([2.35, 48.86]), 'ileDeFrance'); // Paris
  assert.ok(ZONES.zones.find((z) => z.key === 'metropoleGrandParis').rings.some((r) => r.length >= 4));
  assert.equal(aggloZoneAt([2.35, 48.86], { zones: ZONES.zones.filter((z) => z.key !== 'ileDeFrance') }), 'metropoleGrandParis');
  assert.equal(at([2.13, 48.80]), 'ileDeFrance'); // Versailles : Île-de-France hors Grand Paris
  assert.equal(aggloZoneAt([2.13, 48.80], { zones: ZONES.zones.filter((z) => z.key !== 'ileDeFrance') }), null);
  assert.equal(at([5.37, 43.30]), 'aixMarseille'); // Marseille
  assert.equal(at([3.06, 50.63]), 'lille');
  assert.equal(at([-0.58, 44.84]), 'bordeaux');
  assert.equal(at([1.44, 43.60]), 'toulouse');
  assert.equal(at([-1.55, 47.22]), 'nantes');
  assert.equal(at([4.84, 45.76]), 'metropoleLyon'); // Lyon
  assert.equal(at([7.75, 48.58]), 'eurometropole'); // Strasbourg
  // v92 : centres des 6 métropoles ajoutées (2 décimales, à l'intérieur des contours de data/zones-agglo.json).
  for (const [k, p] of Object.entries(CENTRES_V92)) assert.equal(at(p), k, k);
  // v93 : points calculés des 12 agglomérations ajoutées.
  for (const [k, p] of Object.entries(POINTS_V93)) assert.equal(at(p), k, k);
  assert.equal(at([6.02, 47.24]), null); // Besançon : hors zone
  assert.equal(at([6.21, 47.66]), null); // Colombier (constat de la phase 12a)
  assert.equal(at(null), null);
  assert.equal(at([2.35, 48.86].slice(0, 1)), null);
});

test('zones : tout ou rien (clé manquante, anneau invalide, fichier nul → null)', () => {
  const z = JSON.parse(read('data/zones-agglo.json'));
  const c = JSON.parse(read('data/contours-ign.json'));
  assert.equal(parseAggloZones(null, c), null);
  assert.equal(parseAggloZones(z, null), null);
  assert.equal(parseAggloZones({ ...z, nantes: undefined }, c), null);
  assert.equal(parseAggloZones(z, { ...c, eurometropole: [] }), null);
  assert.equal(parseAggloZones(z, { ...c, metropoleLyon: [[[4.8, 45.7], [4.9, 45.7], [4.8, 45.7]]] }), null);
  assert.equal(parseAggloZones(z, { ...c, metropoleLyon: [[[4.8, 45.7], [4.9, 'x'], [4.9, 45.8], [4.8, 45.7]]] }), null);
  assert.equal(aggloZoneAt([2.35, 48.86], null), null);
});

// ───────── Audit ─────────
const way = (id, props, coords) => ({ type: 'Feature', id: `w${id}`, properties: props, geometry: { type: 'LineString', coordinates: coords } });
const FEATURES = [
  // Autoroute à Paris (en zone) et pont ferré sans hauteur, plus long au nord : croisement à 48,86, centre à 48,865.
  way(1, { highway: 'motorway', ref: 'A 1' }, [[2.30, 48.86], [2.40, 48.86]]),
  way(101, { railway: 'rail', bridge: 'yes', layer: '1' }, [[2.35, 48.855], [2.35, 48.875]]),
  // Autoroute à Besançon (hors zone) : pont sans hauteur, pont portant 4,1 m, tunnel sans hauteur.
  way(2, { highway: 'motorway', ref: 'A 36' }, [[6.00, 47.24], [6.04, 47.24]]),
  way(102, { highway: 'tertiary', bridge: 'yes', layer: '1' }, [[6.01, 47.23], [6.01, 47.25]]),
  way(103, { highway: 'tertiary', bridge: 'yes', layer: '1', maxheight: '4.1' }, [[6.03, 47.23], [6.03, 47.25]]),
  way(4, { highway: 'motorway', ref: 'A 36', tunnel: 'yes', layer: '-1' }, [[6.10, 47.30], [6.12, 47.30]]),
  // Nationale hors zone (niveau 2) : pont sans hauteur gardé.
  way(3, { highway: 'trunk', ref: 'N 57' }, [[6.00, 47.40], [6.04, 47.40]]),
  way(104, { highway: 'tertiary', bridge: 'yes', layer: '1' }, [[6.02, 47.39], [6.02, 47.41]]),
  // Départementale (niveau 3) en zone : jamais de fiche « pont sans hauteur ».
  way(5, { highway: 'primary', ref: 'D 910' }, [[2.20, 48.83], [2.24, 48.83]]),
  way(105, { highway: 'tertiary', bridge: 'yes', layer: '1' }, [[2.22, 48.82], [2.22, 48.84]]),
];

function audit(zones, levels = [1, 2, 3]) {
  const axes = FEATURES.map((f) => auditAxisFromFeature(f, levels)).filter(Boolean);
  const index = buildAxisIndex(axes);
  const stats = { motorwayIn: 0, motorwayOut: 0 };
  const cards = [];
  for (const f of FEATURES) {
    const b = auditBridgeFromFeature(f);
    if (b) cards.push(...bridgeCards(b, bridgeCrossings(b, axes, index), axes, { zones, stats }));
  }
  cards.push(...axisCards(axes));
  return { cards, stats };
}
const key = (c) => `${c.niveau}|${c.way}|${c.type}|${c.pont ?? ''}`;

test('audit : niveau 1 « pont sans hauteur » en zone gardé, hors zone retiré ; le reste inchangé', () => {
  const { cards, stats } = audit(ZONES);
  assert.deepEqual(cards.map(key).sort(), [
    '1|1|pont sans hauteur|101', // Paris : gardée
    '1|2|hauteur sur le pont seulement|103', // hors zone : inchangée
    '1|4|tunnel sans hauteur|', // hors zone : inchangée
    '2|3|pont sans hauteur|104', // nationale : inchangée
  ]);
  assert.deepEqual(stats, { motorwayIn: 1, motorwayOut: 1 });
  // Point de la fiche = croisement du pont avec l'autoroute, pas le centre du pont.
  const paris = cards.find((c) => c.way === 1);
  assert.deepEqual(paris.point, [2.35, 48.86]);
  // Toutes les zones loin : seule la fiche de Paris disparaît.
  const sq = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
  const far = sq(0.1, 40.1, 0.2, 40.2);
  const none = parseAggloZones(Object.fromEntries(AGGLO_ZONES.ZONES_KEYS.map((k) => [k, far])),
    Object.fromEntries(AGGLO_ZONES.CONTOURS_KEYS.map((k) => [k, far])));
  assert.ok(none);
  const out = audit(none);
  assert.deepEqual(out.cards.map(key).sort(), cards.map(key).filter((k) => k !== '1|1|pont sans hauteur|101').sort());
  assert.deepEqual(out.stats, { motorwayIn: 0, motorwayOut: 2 });
  // Niveaux 1-2 seulement : même résultat sans la départementale.
  assert.deepEqual(audit(ZONES, [1, 2]).cards.map(key).sort(), cards.map(key).sort());
});

test('audit : zones absentes → erreur dès qu\'une fiche autoroute « pont sans hauteur » est en jeu (jamais retirée en silence)', () => {
  assert.throws(() => audit(null), /zones des grandes agglomérations non lues/);
  // Sans fiche de ce type (niveau 2 seulement) : aucune erreur.
  assert.doesNotThrow(() => audit(null, [2]));
});

test('audit : zones manquantes ou illisibles → problème ; fichiers du dépôt lisibles', () => {
  assert.ok(auditZones(read).zones);
  assert.match(auditZones((f) => { if (f.includes('zones')) throw new Error('absent'); return read(f); }).problem, /zones-agglo\.json absent/);
  assert.match(auditZones((f) => (f.includes('contours') ? '{' : read(f))).problem, /contours-ign\.json illisible/);
  assert.match(auditZones((f) => (f.includes('contours') ? '{}' : read(f))).problem, /zone manquante/);
});

test('audit : script arrêté avant tout téléchargement si les zones manquent, rien d\'écrit', () => {
  const dir = join(ROOT, 'data', 'audit-osm');
  const before = readdirSync(dir).map((f) => [f, statSync(join(dir, f)).mtimeMs]);
  const reportBefore = statSync(join(ROOT, 'docs', 'audit-osm-axes.md')).mtimeMs;
  let code = 0; let out = '';
  try {
    // Export inexistant aussi : même si l'arrêt manquait, la lecture échouerait avant toute écriture.
    out = execFileSync(process.execPath, [join(ROOT, 'tools', 'audit-osm.mjs'), '--zones', join(ROOT, 'tests', 'fixtures', 'absent-zones.json'),
      '--geojsonseq', join(ROOT, 'tests', 'fixtures', 'absent.geojsonseq')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) { code = err.status; out = String(err.stdout ?? ''); }
  assert.equal(code, 1);
  assert.match(out, /⚠ Audit OSM arrêté : data\/zones-agglo\.json absent/);
  assert.match(out, /rien n'est enregistré/);
  assert.deepEqual(readdirSync(dir).map((f) => [f, statSync(join(dir, f)).mtimeMs]), before);
  assert.equal(statSync(join(ROOT, 'docs', 'audit-osm-axes.md')).mtimeMs, reportBefore);
});

// ───────── v92 : 6 métropoles ajoutées (Nice, Montpellier, Rennes, Grenoble, Rouen, Toulon) ─────────
const V92 = ['nice', 'montpellier', 'rennes', 'grenoble', 'rouen', 'toulon'];
/** Copie des ponts (comme la case lue par l'appli) à partir de chemins OSM SYNTHÉTIQUES. */
function bridgeData(feats) {
  const conv = convertBridges(feats.map(bridgeFromFeature).filter(Boolean), feats.map(clearanceFromFeature).filter(Boolean),
    { updated: '2026-11-01', grid: null, countries: ['france'] });
  return mergeBridgeTiles([...conv.tiles.values()].map((t) => parseBridgeTile(JSON.parse(JSON.stringify(t)))));
}
const r6 = (v) => Math.round(v * 1e6) / 1e6;
/** Autoroute nord-sud de 2,2 km passant par p (waycategory 1). */
function motorwayThrough([x, y]) {
  const coordinates = [];
  for (let k = -11; k <= 11; k += 1) coordinates.push([x, r6(y + k * 0.001)]);
  const last = coordinates.length - 1;
  return { coordinates, steps: [{ name: 'A 99', wayPoints: [0, last] }], roadExtras: { waycategory: [[0, last, 1]], waytype: [[0, last, 1]] } };
}
/** Pont ferré est-ouest sans hauteur (ou pont routier à 3,5 m) centré sur p. */
const bridgeAt = (id, [x, y], props = { railway: 'rail', bridge: 'yes', layer: '1' }) => way(id, props, [[r6(x - 0.002), y], [r6(x + 0.002), y]]);
const LOW = { highway: 'primary', bridge: 'yes', layer: '1', maxheight: '3.5' };
const BESANCON = [6.02, 47.24]; // A36 vers Besançon : hors zone

test('v93 : ZONES_KEYS = 13 clés de v92 (ordre inchangé) + 12 ; Lyon et Strasbourg toujours dans data/contours-ign.json', () => {
  assert.deepEqual([...AGGLO_ZONES.ZONES_KEYS], ['ileDeFrance', 'metropoleGrandParis', 'aixMarseille', 'lille', 'bordeaux',
    'toulouse', 'nantes', ...V92, ...V93]);
  assert.deepEqual(V93, ['dijon', 'metz', 'nancy', 'reims', 'orleans', 'tours', 'angers', 'clermontFerrand', 'saintEtienne',
    'leHavre', 'avignon', 'brest']);
  assert.deepEqual([...AGGLO_ZONES.CONTOURS_KEYS], ['metropoleLyon', 'eurometropole']);
  assert.equal(AGGLO_ZONES.ZONES_PATH, './data/zones-agglo.json');
  assert.equal(AGGLO_ZONES.CONTOURS_PATH, './data/contours-ign.json');
});

test('v92 (b) : ancienne copie à 7 clés → zones indisponibles, UNE ligne « à vérifier » (texte inchangé), jamais d\'erreur', () => {
  const zAll = JSON.parse(read('data/zones-agglo.json'));
  const c = JSON.parse(read('data/contours-ign.json'));
  const z7 = { ...zAll };
  for (const k of [...V92, ...V93]) delete z7[k];
  // Une seule clé manquante suffit (tout ou rien).
  assert.doesNotThrow(() => parseAggloZones(z7, c));
  assert.equal(parseAggloZones(z7, c), null);
  for (const k of V92) assert.equal(parseAggloZones({ ...zAll, [k]: undefined }, c), null, k);
  // Appli (loadAgglo) : null → { status: 'failed' } → une seule ligne, même sur un trajet par une métropole ajoutée.
  const d = parseAggloZones(z7, c);
  const zones = d ? { status: 'ok', data: d } : { status: 'failed', data: null };
  const bridges = { status: 'ok', data: bridgeData([bridgeAt(201, CENTRES_V92.nice)]), uncovered: false };
  let r;
  assert.doesNotThrow(() => { r = bridgeRules(motorwayThrough(CENTRES_V92.nice), { vehicle: { height: 4 }, bridges, zones }); });
  const lines = r.lines.filter((l) => l.text === AGGLO_ZONES.UNAVAILABLE_TEXT);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], { level: 'info', sev: 'check', text: 'Zones des grandes agglomérations indisponibles : ponts sans '
    + 'hauteur au-dessus des autoroutes non examinés. La signalisation fait foi.' });
  assert.equal(r.items.length, 0); // pont d'autoroute non signalé, ni dit : seule la ligne « à vérifier »
  assert.equal(r.lines.length, 1);
  // Audit : ancienne copie = arrêt avant tout téléchargement (problème, jamais une fiche retirée en silence).
  assert.match(auditZones((f) => (f.includes('zones-agglo') ? JSON.stringify(z7) : read(f))).problem, /zone manquante/);
});

test('v92 (c) : pont sans hauteur au-dessus d\'une autoroute au centre de chacune des 6 métropoles → en zone (appli et audit)', () => {
  for (const [i, k] of V92.entries()) {
    const p = CENTRES_V92[k];
    assert.equal(aggloZoneAt(p, ZONES), k);
    // Appli : priorité moyenne, compté « autoroutes en zone ».
    const bridges = { status: 'ok', data: bridgeData([bridgeAt(300 + i, p)]), uncovered: false };
    const res = bridgeRules(motorwayThrough(p), { vehicle: { height: 4 }, bridges, zones: { status: 'ok', data: ZONES } });
    assert.equal(res.items.length, 1, k);
    assert.equal(res.items[0].zone, k);
    assert.equal(res.items[0].level, 'medium');
    assert.deepEqual(res.items[0].point, p);
    assert.equal(res.counts.motorwayZone, 1);
    assert.equal(res.counts.motorway, 0);
    // Audit, niveau 1 : fiche « pont sans hauteur » gardée.
    const axes = [auditAxisFromFeature(way(10 + i, { highway: 'motorway', ref: 'A 99' }, motorwayThrough(p).coordinates), [1])];
    const index = buildAxisIndex(axes);
    const b = auditBridgeFromFeature(bridgeAt(300 + i, p));
    const stats = { motorwayIn: 0, motorwayOut: 0 };
    const cards = bridgeCards(b, bridgeCrossings(b, axes, index), axes, { zones: ZONES, stats });
    assert.deepEqual(cards.map(key), [`1|${10 + i}|pont sans hauteur|${300 + i}`], k);
    assert.deepEqual(stats, { motorwayIn: 1, motorwayOut: 0 });
  }
});

test('v92 (d) : point hors zone (A36 vers Besançon) toujours ignoré', () => {
  assert.equal(aggloZoneAt(BESANCON, ZONES), null);
  const bridges = { status: 'ok', data: bridgeData([bridgeAt(401, BESANCON)]), uncovered: false };
  const res = bridgeRules(motorwayThrough(BESANCON), { vehicle: { height: 4 }, bridges, zones: { status: 'ok', data: ZONES } });
  assert.equal(res.items.length, 0);
  assert.equal(res.counts.motorway, 1);
  assert.equal(res.counts.motorwayZone, 0);
  assert.deepEqual(res.lines, []);
  const axes = [auditAxisFromFeature(way(40, { highway: 'motorway', ref: 'A 36' }, motorwayThrough(BESANCON).coordinates), [1])];
  const b = auditBridgeFromFeature(bridgeAt(401, BESANCON));
  const stats = { motorwayIn: 0, motorwayOut: 0 };
  assert.deepEqual(bridgeCards(b, bridgeCrossings(b, axes, buildAxisIndex(axes)), axes, { zones: ZONES, stats }), []);
  assert.deepEqual(stats, { motorwayIn: 0, motorwayOut: 1 });
});

test('v92 (e) : pont portant une hauteur ≤ véhicule → priorité haute partout (6 métropoles, hors zone, zones indisponibles)', () => {
  for (const [i, p] of [...V92.map((k) => CENTRES_V92[k]), BESANCON].entries()) {
    const bridges = { status: 'ok', data: bridgeData([way(500 + i, LOW, [[r6(p[0] - 0.002), p[1]], [r6(p[0] + 0.002), p[1]]])]), uncovered: false };
    for (const zones of [{ status: 'ok', data: ZONES }, { status: 'failed', data: null }, null]) {
      const res = bridgeRules(motorwayThrough(p), { vehicle: { height: 4 }, bridges, zones });
      const low = res.items.find((it) => it.id === 500 + i);
      assert.ok(low, String(p));
      assert.equal(low.level, 'high');
      assert.equal(low.text, lowBridgeText(3.5));
      assert.equal(low.zone, undefined);
    }
  }
});

test('v93 : rapport d\'audit — les 27 zones citées, noms lus dans les fichiers de données (jamais écrits en dur)', () => {
  const zr = auditZones(read);
  const z = JSON.parse(read('data/zones-agglo.json'));
  const c = JSON.parse(read('data/contours-ign.json'));
  // Noms officiels IGN, dans l'ordre des zones : 25 de data/zones-agglo.json, puis Lyon et Strasbourg.
  const expected = [...AGGLO_ZONES.ZONES_KEYS.map((k) => z.names[k]), c.props.metropoleLyon.nom_officiel, c.props.epci.nom_officiel];
  assert.deepEqual(zr.names, expected);
  assert.equal(zr.names.length, 27);
  for (const k of V93) assert.ok(zr.names.includes(z.names[k]), k);
  assert.ok(zr.names.every((n) => typeof n === 'string' && n.length > 3));
  assert.equal(zr.names.at(-2), 'Métropole de Lyon');
  assert.equal(zr.names.at(-1), 'Eurométropole de Strasbourg');
  const { cards } = audit(ZONES);
  const index = auditIndex(cards, splitCards(cards), { updated: '2026-11-26', levels: [1, 2, 3] });
  const md = auditReport(index, cards, { zoneNames: zr.names });
  const line = md.split('\n').find((l) => l.startsWith('- niveau 1 (autoroutes) : fiche « pont sans hauteur »'));
  assert.equal(line, `- niveau 1 (autoroutes) : fiche « pont sans hauteur » seulement si le croisement est dans l'une des 27 zones `
    + `suivantes : ${expected.join(', ')} (Île-de-France et grandes agglomérations ; règle du propriétaire, sans source officielle) ;`);
  for (const n of expected) assert.ok(line.includes(n), n);
  // Plus aucune liste de v91 écrite en dur.
  assert.doesNotMatch(md, /Métropoles du Grand Paris, d'Aix-Marseille-Provence, de Lille/);
  const src = read('src/lib/osm-audit.js');
  for (const n of ['Rennes Métropole', 'Toulouse Métropole', 'Nantes', 'Montpellier']) assert.ok(!src.includes(n), n);
  // Noms absents (fichier sans names) : renvoi aux fichiers, aucune liste inventée.
  const noNames = auditZones((f) => (f.includes('zones-agglo') ? JSON.stringify({ ...z, names: {} }) : read(f)));
  assert.ok(noNames.zones);
  assert.equal(noNames.names, null);
  const md0 = auditReport(index, cards, { zoneNames: noNames.names });
  assert.ok(md0.includes('seulement si le croisement est dans une zone de data/zones-agglo.json ou de '
    + 'data/contours-ign.json (Île-de-France et grandes agglomérations ; règle du propriétaire, sans source officielle) ;'));
  // Le script d'audit passe les noms lus au rapport.
  assert.match(read('tools/audit-osm.mjs'), /zoneNames: zr\.names/);
  // Aucun nombre de zones écrit en dur dans le code du rapport ni des zones : il vient de la liste lue.
  for (const f of ['src/lib/osm-audit.js', 'tools/audit-osm.mjs']) assert.doesNotMatch(read(f), /\b(13|15|25|27) zones\b/, f);
});

// ───────── v93 : 12 agglomérations ajoutées (Dijon … Brest), 27 zones ─────────
const C = JSON.parse(read('data/contours-ign.json'));
const ZALL = JSON.parse(read('data/zones-agglo.json'));
const sqFar = [[[0.1, 40.1], [0.2, 40.1], [0.2, 40.2], [0.1, 40.2], [0.1, 40.1]]];

test('v93 (a) : fichier à 25 clés accepté (27 zones), appli et audit lisent les mêmes', () => {
  for (const k of AGGLO_ZONES.ZONES_KEYS) assert.ok(Array.isArray(ZALL[k]) && ZALL[k].length, k);
  assert.equal(AGGLO_ZONES.ZONES_KEYS.length, 25);
  assert.equal(ZONES.zones.length, 27);
  assert.deepEqual(auditZones(read).zones, ZONES);
});

test('v93 (b) : une clé manquante parmi les 12 → null ; fichier à 24 clés (n\'importe laquelle) → null', () => {
  for (const k of V93) {
    assert.equal(parseAggloZones({ ...ZALL, [k]: undefined }, C), null, k);
    assert.equal(parseAggloZones({ ...ZALL, [k]: [] }, C), null, k);
    assert.equal(parseAggloZones({ ...ZALL, [k]: [[[5, 47], [5.1, 47], [5, 47]]] }, C), null, k);
  }
  for (const k of AGGLO_ZONES.ZONES_KEYS) {
    const z24 = { ...ZALL };
    delete z24[k];
    assert.equal(AGGLO_ZONES.ZONES_KEYS.filter((x) => Array.isArray(z24[x])).length, 24, k);
    assert.equal(parseAggloZones(z24, C), null, k);
  }
});

test('v93 (c) : copie à 13 clés (v92, gardée hors ligne) avec l\'appli v93 → UNE ligne « indisponibles », aucune alerte', () => {
  const z13 = { ...ZALL, names: { ...ZALL.names }, props: { ...ZALL.props } };
  for (const k of V93) { delete z13[k]; delete z13.names[k]; delete z13.props[k]; }
  assert.equal(Object.keys(z13).filter((k) => Array.isArray(z13[k])).length, 13);
  assert.doesNotThrow(() => parseAggloZones(z13, C));
  const d = parseAggloZones(z13, C);
  assert.equal(d, null);
  // Comme loadAgglo (app.js) : null → { status: 'failed' }.
  const zones = d ? { status: 'ok', data: d } : { status: 'failed', data: null };
  // Trajet par une zone ajoutée (Dijon) et par une zone de v92 (Paris) : jamais d'alerte, une seule ligne.
  for (const p of [POINTS_V93.dijon, POINTS_V93.brest, [2.35, 48.86]]) {
    const bridges = { status: 'ok', data: bridgeData([bridgeAt(601, p)]), uncovered: false };
    const r = bridgeRules(motorwayThrough(p), { vehicle: { height: 4 }, bridges, zones });
    assert.deepEqual(r.lines, [{ level: 'info', sev: 'check', text: AGGLO_ZONES.UNAVAILABLE_TEXT }], String(p));
    assert.equal(r.items.length, 0, String(p));
    assert.equal(r.counts.motorwayZone, 0);
  }
  // Audit : copie à 13 clés = arrêt (problème), jamais une fiche retirée en silence.
  assert.match(auditZones((f) => (f.includes('zones-agglo') ? JSON.stringify(z13) : read(f))).problem, /zone manquante/);
});

test('v93 (d) : pont sans hauteur au-dessus d\'une autoroute dans chacune des 12 zones → moyenne, « à vérifier » (appli et audit)', () => {
  for (const [i, k] of V93.entries()) {
    const p = POINTS_V93[k];
    assert.equal(aggloZoneAt(p, ZONES), k);
    // Point dans le vrai contour du fichier du dépôt (pas seulement dans sa boîte).
    assert.ok(ZONES.zones.find((z) => z.key === k).rings.some((r) => inRing(p, r)), k);
    const bridges = { status: 'ok', data: bridgeData([bridgeAt(700 + i, p)]), uncovered: false };
    const res = bridgeRules(motorwayThrough(p), { vehicle: { height: 4 }, bridges, zones: { status: 'ok', data: ZONES } });
    assert.equal(res.items.length, 1, k);
    assert.equal(res.items[0].zone, k);
    assert.equal(res.items[0].level, 'medium');
    assert.equal(res.items[0].text, BRIDGE.TEXT);
    assert.deepEqual(res.items[0].point, p);
    assert.equal(res.counts.motorwayZone, 1);
    assert.equal(res.counts.motorway, 0);
    // Ligne de la fiche (seule ligne, aucune « indisponibles ») : « à vérifier », priorité moyenne.
    const lines = bridgeLines(res.items);
    assert.deepEqual(res.lines, lines);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].sev, 'check');
    assert.match(lines[0].text, /à vérifier/);
    assert.match(lines[0].text, /priorité moyenne\)$/);
    // Audit, niveau 1 : fiche « pont sans hauteur » gardée.
    const axes = [auditAxisFromFeature(way(60 + i, { highway: 'motorway', ref: 'A 99' }, motorwayThrough(p).coordinates), [1])];
    const b = auditBridgeFromFeature(bridgeAt(700 + i, p));
    const stats = { motorwayIn: 0, motorwayOut: 0 };
    const cards = bridgeCards(b, bridgeCrossings(b, axes, buildAxisIndex(axes)), axes, { zones: ZONES, stats });
    assert.deepEqual(cards.map(key), [`1|${60 + i}|pont sans hauteur|${700 + i}`], k);
    assert.deepEqual(stats, { motorwayIn: 1, motorwayOut: 0 });
  }
});

test('v93 (e) : même pont hors zone (contour de la zone éloigné) → ignoré (appli et audit)', () => {
  for (const [i, k] of V93.entries()) {
    const p = POINTS_V93[k];
    const out = parseAggloZones({ ...ZALL, [k]: sqFar }, C);
    assert.ok(out, k);
    assert.equal(aggloZoneAt(p, out), null, k);
    const bridges = { status: 'ok', data: bridgeData([bridgeAt(700 + i, p)]), uncovered: false };
    const res = bridgeRules(motorwayThrough(p), { vehicle: { height: 4 }, bridges, zones: { status: 'ok', data: out } });
    assert.equal(res.items.length, 0, k);
    assert.equal(res.counts.motorway, 1);
    assert.equal(res.counts.motorwayZone, 0);
    assert.deepEqual(res.lines, []);
    const axes = [auditAxisFromFeature(way(60 + i, { highway: 'motorway', ref: 'A 99' }, motorwayThrough(p).coordinates), [1])];
    const b = auditBridgeFromFeature(bridgeAt(700 + i, p));
    const stats = { motorwayIn: 0, motorwayOut: 0 };
    assert.deepEqual(bridgeCards(b, bridgeCrossings(b, axes, buildAxisIndex(axes)), axes, { zones: out, stats }), [], k);
    assert.deepEqual(stats, { motorwayIn: 0, motorwayOut: 1 });
  }
  // A36 vers Besançon : toujours hors des 27 zones.
  assert.equal(aggloZoneAt(BESANCON, ZONES), null);
});

test('v93 (f) : pont portant une hauteur ≤ véhicule → priorité haute partout (12 zones, hors zone, zones indisponibles)', () => {
  for (const [i, p] of [...V93.map((k) => POINTS_V93[k]), BESANCON].entries()) {
    const bridges = { status: 'ok', data: bridgeData([way(800 + i, LOW, [[r6(p[0] - 0.002), p[1]], [r6(p[0] + 0.002), p[1]]])]), uncovered: false };
    for (const zones of [{ status: 'ok', data: ZONES }, { status: 'failed', data: null }, null]) {
      const res = bridgeRules(motorwayThrough(p), { vehicle: { height: 4 }, bridges, zones });
      const low = res.items.find((it) => it.id === 800 + i);
      assert.ok(low, String(p));
      assert.equal(low.level, 'high');
      assert.equal(low.text, lowBridgeText(3.5));
      assert.equal(low.zone, undefined);
    }
  }
});

test('v93 (g) : Lyon et Strasbourg → même résultat qu\'avec les 15 zones de v92', () => {
  // Zones de v92 : les mêmes objets, sans les 12 ajoutées (ce que parseAggloZones rendait en v92).
  const v92 = { zones: ZONES.zones.filter((z) => !V93.includes(z.key)) };
  assert.equal(v92.zones.length, 15);
  assert.deepEqual(ZONES.zones.slice(-2).map((z) => z.key), ['metropoleLyon', 'eurometropole']);
  assert.deepEqual(ZONES.zones.find((z) => z.key === 'metropoleLyon').rings, C.metropoleLyon);
  assert.deepEqual(ZONES.zones.find((z) => z.key === 'eurometropole').rings, C.eurometropole);
  for (const [k, p] of [['metropoleLyon', [4.84, 45.76]], ['eurometropole', [7.75, 48.58]]]) {
    assert.equal(aggloZoneAt(p, ZONES), k);
    assert.equal(aggloZoneAt(p, v92), k);
    for (const [j, props] of [[0, undefined], [1, LOW]]) {
      const bridges = { status: 'ok', data: bridgeData([bridgeAt(900 + j, p, props)]), uncovered: false };
      const now = bridgeRules(motorwayThrough(p), { vehicle: { height: 4 }, bridges, zones: { status: 'ok', data: ZONES } });
      const before = bridgeRules(motorwayThrough(p), { vehicle: { height: 4 }, bridges, zones: { status: 'ok', data: v92 } });
      assert.deepEqual(now, before, k);
      assert.equal(now.items.length, 1);
      assert.equal(now.items[0].level, j ? 'high' : 'medium');
    }
  }
});

/** Boîte [w, s, e, n] d'une liste d'anneaux. */
const boxOf = (rings) => rings.flat().reduce(([w, s, e, n], [x, y]) => [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)],
  [Infinity, Infinity, -Infinity, -Infinity]);
const boxesMeet = (a, b) => !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
/** Deux segments se coupent (croisement franc). */
function segmentsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0]);
  const d1 = d(p3, p4, p1); const d2 = d(p3, p4, p2); const d3 = d(p1, p2, p3); const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

test('v93 (h) : recouvrements des 27 zones — Grand Paris dans l\'Île-de-France seulement (boîtes puis anneaux)', () => {
  const zs = ZONES.zones;
  assert.equal(zs.length, 27);
  // Boîtes qui se recouvrent : 2 paires seulement.
  const pairs = [];
  for (let i = 0; i < zs.length; i += 1) {
    for (let j = i + 1; j < zs.length; j += 1) if (boxesMeet(zs[i].box, zs[j].box)) pairs.push([zs[i], zs[j]]);
  }
  assert.deepEqual(pairs.map(([a, b]) => `${a.key}×${b.key}`), ['ileDeFrance×metropoleGrandParis', 'aixMarseille×toulon']);
  // Anneaux : croisements de côtés et sommets de l'une dans l'autre.
  const meet = (A, B) => {
    let cross = 0; let aInB = 0; let bInA = 0;
    for (const ra of A.rings) {
      for (const rb of B.rings) {
        if (!boxesMeet(boxOf([ra]), boxOf([rb]))) continue;
        for (let k = 0; k < ra.length - 1; k += 1) {
          for (let m = 0; m < rb.length - 1; m += 1) if (segmentsCross(ra[k], ra[k + 1], rb[m], rb[m + 1])) cross += 1;
        }
        aInB += ra.filter((p) => inRing(p, rb)).length;
        bInA += rb.filter((p) => inRing(p, ra)).length;
      }
    }
    return { cross, aInB, bInA, bPts: B.rings.reduce((s, r) => s + r.length, 0) };
  };
  const [idf, gp] = pairs[0];
  const m1 = meet(idf, gp);
  // Grand Paris entièrement dans l'Île-de-France : aggloZoneAt rend ileDeFrance (première zone), jamais metropoleGrandParis.
  assert.equal(m1.cross, 0);
  assert.equal(m1.aInB, 0);
  assert.equal(m1.bInA, m1.bPts);
  const [aix, tln] = pairs[1];
  // Aix-Marseille et Toulon : boîtes qui se touchent, anneaux disjoints.
  assert.deepEqual(meet(aix, tln), { cross: 0, aInB: 0, bInA: 0, bPts: tln.rings.reduce((s, r) => s + r.length, 0) });
  // Les 12 zones ajoutées ne touchent aucune autre zone, même par leur boîte.
  for (const k of V93) assert.ok(!pairs.flat().some((z) => z.key === k), k);
});

test('v93 : sw.js — agglo-zones.js précaché, zones-agglo.json et contours-ign.json jamais précachés', () => {
  const sw = read('sw.js');
  const files = sw.slice(sw.indexOf('const APP_FILES'), sw.indexOf('].map('));
  assert.ok(files.includes("'./src/lib/agglo-zones.js'"));
  assert.ok(!files.includes('zones-agglo.json'));
  assert.ok(!files.includes('contours-ign.json'));
});
