// v90 : audit du niveau 3 (grandes départementales : primary ou secondary à référence D…), lecture seule. Garde-fou :
// fiches de priorité 1 (interdiction PL absente) et 2 (hauteur basse connue, hauteur sur le pont seulement) seulement ;
// aucune fiche « pont sans hauteur » ni « tunnel sans hauteur » ; niveaux 1-2 inchangés ; plafond 5 Mo / 30 Mo ;
// data/axes-osm/ jamais élargie aux départementales. Aucun réseau : objets synthétiques et fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGeojsonLine } from '../src/lib/areas-osm-data.js';
import { axisFromFeature } from '../src/lib/axes-convert.js';
import {
  AUDIT, auditAxisFromFeature, auditBridgeFromFeature, auditIndex, auditReport, auditSize, axisCards, axisLevel,
  bridgeCards, bridgeCrossings, buildAxisIndex, keepCard, placeFromFeature, placeIndex, restrictionCards, splitCards,
} from '../src/lib/osm-audit.js';
import { AGGLO_ZONES, parseAggloZones } from '../src/lib/agglo-zones.js';

// v91 : zones des grandes agglomérations SYNTHÉTIQUES couvrant toute la fixture (fiches inchangées par rapport à avant).
const sq = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const FAR = sq(0.1, 40.1, 0.2, 40.2);
const ALL_ZONES = parseAggloZones(
  // Toutes les clés lues (v92 : 13) ; seule l'Île-de-France, élargie, couvre les points des tests.
  { ...Object.fromEntries(AGGLO_ZONES.ZONES_KEYS.map((k) => [k, FAR])), ileDeFrance: sq(-10, 35, 20, 60) },
  { metropoleLyon: FAR, eurometropole: FAR });
import { SENSITIVE } from '../src/lib/sensitive-points.js';

const way = (id, props, coords) => ({ type: 'Feature', id: `w${id}`, properties: props, geometry: { type: 'LineString', coordinates: coords } });
const node = (id, props, c) => ({ type: 'Feature', id: `n${id}`, properties: props, geometry: { type: 'Point', coordinates: c } });

// Monde synthétique (aucune coordonnée réelle d'une personne : points arrondis, lieux inventés).
const FEATURES = [
  way(1, { highway: 'secondary', ref: 'D 10' }, [[1.1, 46.1], [1.13, 46.1]]), // sous un pont sans hauteur (201)
  way(2, { highway: 'secondary', ref: 'D 11', tunnel: 'yes', layer: '-1' }, [[1.2, 46.2], [1.21, 46.21]]), // tunnel sans hauteur
  way(3, { highway: 'primary', ref: 'D 12', maxheight: '3.8' }, [[1.3, 46.3], [1.31, 46.3]]), // hauteur basse connue
  way(4, { highway: 'secondary', ref: 'D 13' }, [[1.4, 46.4], [1.43, 46.4]]), // sous un pont à 4,1 m (202)
  way(5, { highway: 'secondary', ref: 'D 14' }, [[1.5, 46.5], [1.53, 46.5]]), // sous un pont à 4,5 m (203) : priorité 3
  way(6, { highway: 'secondary', ref: 'D 15' }, [[1.6, 46.6], [1.65, 46.6]]), // section interdite (Aval → Amont)
  way(7, { highway: 'motorway', ref: 'A 99' }, [[1.7, 46.7], [1.73, 46.7]]), // niveau 1 sous un pont sans hauteur (204)
  way(8, { highway: 'trunk', ref: 'N 999', tunnel: 'yes', layer: '-1' }, [[1.8, 46.8], [1.81, 46.81]]), // niveau 2 : tunnel
  way(201, { highway: 'residential', bridge: 'yes', layer: '1' }, [[1.115, 46.09], [1.115, 46.11]]),
  way(202, { railway: 'rail', bridge: 'yes', layer: '1', maxheight: '4.1' }, [[1.415, 46.39], [1.415, 46.41]]),
  way(203, { highway: 'tertiary', bridge: 'yes', layer: '1', maxheight: '4.5' }, [[1.515, 46.49], [1.515, 46.51]]),
  way(204, { highway: 'residential', bridge: 'yes', layer: '1' }, [[1.715, 46.69], [1.715, 46.71]]),
  node(301, { place: 'village', name: 'Aval' }, [1.61, 46.6]),
  node(302, { place: 'village', name: 'Amont' }, [1.64, 46.6]),
];
const RULES = [{ id: 'd15-test', refs: ['D15'], de: 'Aval', a: 'Amont', zone: [1.5, 46.5, 1.7, 46.7], nature: 'interdit',
  sens: '2 sens', texte: 'D15 test', arrete: 'inconnu', source: 'test', lu: 'Bison Futé' }];

function run(features, levels, rules = RULES) {
  const axes = []; const places = [];
  for (const f of features) {
    const a = auditAxisFromFeature(f, levels); if (a) axes.push(a);
    const p = placeFromFeature(f); if (p) places.push(p);
  }
  const index = buildAxisIndex(axes);
  const cards = [];
  for (const f of features) {
    const b = auditBridgeFromFeature(f);
    if (b) cards.push(...bridgeCards(b, bridgeCrossings(b, axes, index), axes, { zones: ALL_ZONES }));
  }
  cards.push(...axisCards(axes));
  const r = restrictionCards(rules, axes, placeIndex(places));
  cards.push(...r.cards);
  return { axes, cards, r };
}
const key = (c) => `${c.way}|${c.type}|${c.pont ?? ''}`;

test('niveau 3 = primary ou secondary à référence D… (classes et numéro), rien de plus', () => {
  assert.equal(axisLevel({ highway: 'primary', ref: 'D 12' }), 3);
  assert.equal(axisLevel({ highway: 'secondary', ref: 'D 13' }), 3);
  assert.equal(axisLevel({ highway: 'primary_link', ref: 'D 12' }), null);
  assert.equal(axisLevel({ highway: 'secondary_link', ref: 'D 13' }), null);
  assert.equal(axisLevel({ highway: 'tertiary', ref: 'D 13' }), null);
  assert.equal(axisLevel({ highway: 'secondary', ref: 'C 3' }), null);
  assert.equal(axisLevel({ highway: 'secondary' }), null);
});

test('niveau 3 : aucune fiche « pont sans hauteur » ni « tunnel sans hauteur » ; priorités 1 et 2 gardées', () => {
  const { cards } = run(FEATURES, [1, 2, 3]);
  const n3 = cards.filter((c) => c.niveau === 3);
  assert.ok(!n3.some((c) => /^(pont|tunnel) sans hauteur/.test(c.type)));
  assert.ok(n3.every((c) => c.priorite === 1 || c.priorite === 2));
  assert.deepEqual(n3.map((c) => [c.way, c.priorite, c.type]).sort((a, b) => a[0] - b[0]), [
    [3, 2, 'hauteur basse connue'],
    [4, 2, 'hauteur sur le pont seulement'],
    [6, 1, 'interdiction PL absente (d15-test)'],
  ]);
  assert.ok(!cards.some((c) => c.way === 5), 'hauteur sur le pont ≥ 4,30 m (priorité 3) : pas de fiche au niveau 3');
  for (const c of n3) assert.equal(c.note, 'à vérifier sur place');
});

test('niveaux 1-2 inchangés quand le niveau 3 est audité (mêmes fiches, même ordre)', () => {
  const a = run(FEATURES, [1, 2]).cards.map(key);
  const b = run(FEATURES, [1, 2, 3]).cards.filter((c) => c.niveau < 3).map(key);
  assert.deepEqual(b, a);
  assert.ok(a.includes('7|pont sans hauteur|204'), 'niveau 1 : pont sans hauteur gardé');
  assert.ok(a.includes('8|tunnel sans hauteur|'), 'niveau 2 : tunnel sans hauteur gardé');
  // Même chose sur la fixture de l'audit (tests/osm-audit.test.js).
  const fx = readFileSync(new URL('./fixtures/osm-audit-axes.geojsonseq', import.meta.url), 'utf8').split('\n').map(parseGeojsonLine).filter(Boolean);
  assert.deepEqual(run(fx, [1, 2, 3], []).cards.filter((c) => c.niveau < 3).map(key), run(fx, [1, 2], []).cards.map(key));
});

test('keepCard : niveaux 1-2 toujours, niveau 3 priorités 1 et 2 seulement', () => {
  assert.equal(keepCard({ niveau: 1, priorite: 3, type: 'pont sans hauteur' }), true);
  assert.equal(keepCard({ niveau: 2, priorite: 3, type: 'tunnel sans hauteur' }), true);
  assert.equal(keepCard({ niveau: 3, priorite: 3, type: 'pont sans hauteur' }), false);
  assert.equal(keepCard({ niveau: 3, priorite: 3, type: 'tunnel sans hauteur' }), false);
  assert.equal(keepCard({ niveau: 3, priorite: 3, type: 'hauteur sur le pont seulement' }), false);
  assert.equal(keepCard({ niveau: 3, priorite: 2, type: 'hauteur sur le pont seulement' }), true);
  assert.equal(keepCard({ niveau: 3, priorite: 2, type: 'hauteur basse connue' }), true);
  assert.equal(keepCard({ niveau: 3, priorite: 1, type: 'interdiction PL absente (x)' }), true);
  assert.deepEqual(AUDIT.LEVEL3_PRIORITIES, [1, 2]);
});

test('plafond : 5 Mo par fichier (découpe numérotée), 30 Mo en tout, sinon problème et rien d\'écrit', () => {
  assert.equal(AUDIT.MAX_TOTAL_BYTES, 30 * 1024 * 1024);
  assert.equal(AUDIT.MAX_FILE_BYTES, 5 * 1024 * 1024);
  const { cards } = run(FEATURES, [1, 2, 3]);
  const files = splitCards(cards);
  assert.deepEqual([...files.keys()], ['niveau-1.json', 'niveau-2.json', 'niveau-3.json']);
  const idx = auditIndex(cards, files, { updated: '2026-11-26', levels: [1, 2, 3] });
  const ok = auditSize(files, idx);
  assert.equal(ok.problem, null);
  const exact = [...files.values(), idx].reduce((n, c) => n + Buffer.byteLength(`${JSON.stringify(c)}\n`), 0);
  assert.equal(ok.total, exact, 'même texte que l\'écriture (JSON + saut de ligne)');
  // Petits plafonds (mêmes règles, chiffres réduits) : découpe en niveau-3-1.json, niveau-3-2.json…, puis total dépassé.
  const many = Array.from({ length: 300 }, (_, i) => ({ ...cards.find((c) => c.niveau === 3), way: 1000 + i }));
  const parts = splitCards(many, 20000);
  assert.ok(parts.size > 1);
  for (const name of parts.keys()) assert.match(name, /^niveau-3-\d+\.json$/);
  const idx2 = auditIndex(many, parts, { levels: [1, 2, 3] });
  assert.equal(auditSize(parts, idx2, { maxFile: 20000, maxTotal: 10 * 1024 * 1024 }).problem, null);
  const over = auditSize(parts, idx2, { maxFile: 20000, maxTotal: 50000 });
  assert.match(over.problem, /Mo en tout \(plafond/);
  assert.ok(over.total > 50000);
  assert.match(auditSize(parts, idx2, { maxFile: 1000 }).problem, /^fichier niveau-3-1\.json de .* Mo/);
});

test('data/axes-osm/ jamais élargie : secondary (D) hors copie, copie indépendante des niveaux', () => {
  assert.equal(axisFromFeature(way(4, { highway: 'secondary', ref: 'D 13' }, [[1.4, 46.4], [1.43, 46.4]])), null);
  assert.equal(axisFromFeature(way(9, { highway: 'secondary_link', ref: 'D 13' }, [[1.4, 46.4], [1.43, 46.4]])), null);
  assert.equal(axisFromFeature.length, 1, 'aucun paramètre de niveau');
  const tool = readFileSync(new URL('../tools/audit-osm.mjs', import.meta.url), 'utf8');
  assert.match(tool, /const c = axisFromFeature\(f\);/, 'copie des axes lue sans les niveaux');
  assert.match(tool, /auditSize\(files, idx\)[\s\S]*process\.exitCode = 1;\s*return;[\s\S]*writeDir\(AUDIT_DIR/, 'taille vérifiée avant toute écriture');
});

test('rapport du niveau 3 : garde-fou écrit ; points sensibles plafonnés à 300 Ko', () => {
  const { cards, r } = run(FEATURES, [1, 2, 3]);
  const idx = auditIndex(cards, splitCards(cards), { levels: [1, 2, 3] });
  const md = auditReport(idx, cards, { located: r.located, unlocated: r.unlocated });
  assert.match(md, /niveau 3 \(grandes départementales : primary ou secondary à référence D…\) : fiches de priorité 1 et 2 seulement/);
  const md12 = auditReport(auditIndex(cards, splitCards(cards), { levels: [1, 2] }), cards);
  assert.ok(!md12.includes('niveau 3 (grandes'));
  assert.equal(SENSITIVE.MAX_TOTAL_BYTES, 300 * 1024);
});
