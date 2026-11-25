// Repli par la géométrie (PR 3a) : référence des étapes ORS sans nom retrouvée dans data/axes-osm/.
// Fixture : reconstitution Joigny → Gonfreville-l'Orcher (tools/make-fixture-axes.mjs), cases réduites de la copie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fixture } from './helpers.js';
import { parseDirections, rawResponseOf } from '../src/lib/ors-response.js';
import {
  AXIS_MATCH, AXIS_GEO_NOTE, parseAxesTile, mergeAxesTiles, matchRouteAxes, geoRoadsFor, axisTechText,
} from '../src/lib/axis-match.js';
import { roadStats, roadStatsText, segmentClasses, pickRecommendedIndex, anShare, ROUTE_PREF } from '../src/lib/road-class.js';
import { sampleRoute } from '../src/lib/route-samples.js';
import { bansAlongRoute, describeBanConflict } from '../src/lib/hgv-bans.js';
import { routeRules } from '../src/lib/route-rules.js';
import { routeDiagnosticText } from '../src/lib/route-diagnostic.js';

const DIR = new URL('./fixtures/axes-osm-joigny/', import.meta.url);
const tiles = readdirSync(DIR).filter((f) => f !== 'index.json')
  .map((f) => parseAxesTile(JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))));
const DATA = mergeAxesTiles(tiles);
const INDEX = JSON.parse(readFileSync(new URL('index.json', DIR), 'utf8'));
const route = () => parseDirections(fixture('ors-directions-joigny-gonfreville.json'));
const SEMI = { weight: 40, height: 4, width: 2.55, length: 16.5, hazmat: false };
// Samedi 28/11/2026, 8 h : passage sur l'A13 près de Paris vers 10 h (art. 3 : samedi 10 h – 18 h, Paris-province).
const SATURDAY = new Date(2026, 10, 28, 8, 0);

// Mini-copie de test : une voie [lon,lat] en 1e-5 degré, encodée comme axes-convert.js.
const enc = (coords) => {
  const out = []; let px = 0; let py = 0;
  for (const [lon, lat] of coords) { const x = Math.round(lon * 1e5); const y = Math.round(lat * 1e5); out.push(x - px, y - py); px = x; py = y; }
  return out;
};
const tileOf = (ways) => {
  const r = [];
  const a = ways.map(([ref, cls, coords]) => {
    let i = -1;
    if (ref) { i = r.indexOf(ref); if (i < 0) { r.push(ref); i = r.length - 1; } }
    return [i, cls, ...enc(coords)];
  });
  return parseAxesTile({ r, a });
};
// Tracé droit est-ouest de 2 km à 48,5° N, une seule étape « - ».
const line = (lat = 48.5, from = 2.0, to = 2.027) => {
  const coords = [];
  for (let k = 0; k <= 40; k += 1) coords.push([from + (to - from) * (k / 40), lat]);
  return coords;
};
const straightRoute = (name = '-') => {
  const coordinates = line();
  return {
    coordinates, duration: 100, distance: 2000,
    steps: [{ name: name === '-' ? '' : name, wayPoints: [0, coordinates.length - 1], duration: 100 }],
    roadExtras: { waycategory: [[0, coordinates.length - 1, 0]], waytype: [[0, coordinates.length - 1, 1]] },
  };
};
const dLat = (m) => m / 110540;

test('constantes : méthode de la phase 5h ter (15 m, 30° modulo 180°, séries de 300 m, copie à 3 m)', () => {
  assert.equal(AXIS_MATCH.SAMPLE_M, 50);
  assert.equal(AXIS_MATCH.TOLERANCE_M, 15);
  assert.equal(AXIS_MATCH.MAX_HEADING_DEG, 30);
  assert.equal(AXIS_MATCH.MIN_RUN_M, 300);
  assert.equal(AXIS_MATCH.MAX_COPY_TOLERANCE_M, 3);
  assert.equal(INDEX.tolerance, 3, 'copie data/axes-osm/ simplifiée à 3 m');
});

test('case lue : références, classes, voies en double retirées ; case illisible → null', () => {
  const t = tileOf([['A13', 0, line()], ['', 0, line(48.6)]]);
  assert.equal(t.lines.length, 2);
  assert.deepEqual(t.lines.map((l) => [l.ref, l.cls]), [['A13', 0], ['', 0]]);
  assert.equal(mergeAxesTiles([t, t]).lines.length, 2, 'voie écrite dans deux cases : une fois');
  assert.equal(parseAxesTile(null), null);
  assert.equal(parseAxesTile({ r: [] }), null);
  assert.equal(parseAxesTile({ r: [], a: [[0, 7, 1, 2, 3, 4]] }).lines.length, 0, 'classe inconnue ignorée');
});

test('Joigny → Gonfreville : km sans nom > 30 % sans repli, < 30 % avec ; l\'A13 retrouvée', () => {
  const r = route();
  const before = roadStats(r);
  assert.ok(before.unknown / before.total > ROUTE_PREF.MAX_UNKNOWN_SHARE, 'part A/N inconnue sans repli');
  assert.equal(before.share, null);
  const geo = matchRouteAxes(r, DATA, { copyTolerance: INDEX.tolerance });
  assert.equal(geo.status, 'ok');
  const after = roadStats(r, { geo });
  assert.ok(after.unknown / after.total < ROUTE_PREF.MAX_UNKNOWN_SHARE, `${after.unknown} m encore inconnus`);
  assert.ok(after.geo > 120000, 'plus de 120 km retrouvés');
  const km = {};
  for (let i = 0; i < geo.ref.length; i += 1) {
    if (!geo.ref[i]) continue;
    km[geo.ref[i]] = (km[geo.ref[i]] ?? 0) + 1;
  }
  const top = Object.entries(km).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(top, 'A13');
  // Un tronçon nommé par ORS n'est jamais réécrit : rien n'est retrouvé sur les étapes nommées (A 6, N 12…).
  const seg = segmentClasses(r);
  for (let i = 0; i < geo.ref.length; i += 1) if (!seg.unknown[i]) assert.equal(geo.ref[i], null, `tronçon ${i} nommé`);
  // Travail mesuré par compteur, borné : quelques dizaines de segments testés par point au plus.
  assert.ok(geo.stats.samples > 2000);
  assert.ok(geo.stats.segmentsTested < geo.stats.samples * 40, `${geo.stats.segmentsTested} segments testés`);
});

test('« Recommandé » inchangé : sans option, segmentClasses et anShare ignorent le repli', () => {
  const r = route();
  const geo = matchRouteAxes(r, DATA, { copyTolerance: 3 });
  assert.equal(anShare(r), null, 'part A/N du Recommandé toujours inconnue');
  assert.deepEqual(segmentClasses(r).unknown, segmentClasses({ ...r }).unknown);
  assert.equal(pickRecommendedIndex([{ route: r }, { route: { ...r, duration: r.duration + 10 } }]), 0);
  assert.notDeepEqual(segmentClasses(r, { geo }).unknown, segmentClasses(r).unknown);
});

test('week-end Île-de-France : conflit sur l\'A13 avec le repli, absent sans ; texte « à vérifier », jamais dit', () => {
  const r = route();
  const geo = matchRouteAxes(r, DATA, { copyTolerance: 3 });
  const without = bansAlongRoute(r, { vehicle: SEMI, departure: SATURDAY });
  assert.equal(without.conflicts.filter((c) => c.kind === 'idf').length, 0, 'A13 sans nom : art. 3 non vu');
  const withGeo = bansAlongRoute(r, { vehicle: SEMI, departure: SATURDAY, geo });
  const idf = withGeo.conflicts.filter((c) => c.kind === 'idf');
  assert.equal(idf.length, 1);
  assert.equal(idf[0].geo, true);
  assert.deepEqual(idf[0].roads, ['A13']);
  const text = describeBanConflict(idf[0]);
  assert.match(text, /Île-de-France/);
  assert.match(text, /Section et sens à vérifier dans l'arrêté\./);
  assert.ok(text.endsWith(AXIS_GEO_NOTE));
  // Fiche complète : même conflit par routeRules quand la copie est chargée.
  const axes = { status: 'ok', data: DATA, updated: '2026-11-24', meta: { tolerance: 3 } };
  const rules = routeRules(r, { vehicle: SEMI, departure: SATURDAY, axes });
  assert.ok(rules.lines.some((l) => l.text.includes(AXIS_GEO_NOTE)));
  assert.match(rules.axes.tech, /km retrouvés sur .* km sans nom ni référence/);
  assert.ok(!routeRules(r, { vehicle: SEMI, departure: SATURDAY }).lines.some((l) => l.text.includes(AXIS_GEO_NOTE)));
  // Diagnostic : deux lignes de classes (sans et avec repli) et la ligne technique.
  const diag = routeDiagnosticText(r, { rules, version: 'Gabarit v73' });
  assert.match(diag, /Avec le repli par la géométrie \(à vérifier, choix du Recommandé inchangé\)/);
  assert.match(diag, /Repli par la géométrie \(axes OSM\), copie du 24\/11\/2026/);
});

test('copie non chargée, échouée ou trop simplifiée : rien retrouvé, ligne technique', () => {
  const r = route();
  assert.equal(matchRouteAxes(r, DATA, { copyTolerance: 8 }).status, 'disabled');
  assert.equal(matchRouteAxes(r, DATA, { copyTolerance: null }).status, 'disabled');
  assert.equal(matchRouteAxes(r, { lines: [] }, { copyTolerance: 3 }).km.matched, 0);
  assert.equal(axisTechText({ status: 'failed' }, null), 'Repli par la géométrie (axes OSM) : données non chargées');
  assert.equal(axisTechText({ status: 'loading' }, null), 'Repli par la géométrie (axes OSM) : chargement');
  assert.match(axisTechText({ status: 'ok' }, { status: 'disabled' }), /copie trop simplifiée, repli désactivé/);
  const rules = routeRules(r, { vehicle: SEMI, departure: SATURDAY, axes: { status: 'failed', data: { lines: [] } } });
  assert.equal(rules.axes.geo, null);
  assert.equal(rules.axes.tech, 'Repli par la géométrie (axes OSM) : données non chargées');
});

test('voie à 8 m au même cap : retrouvée ; à 20 m : rien ; croisement perpendiculaire : rien', () => {
  const r = straightRoute();
  const at = (m) => line(48.5 + dLat(m));
  assert.equal(matchRouteAxes(r, tileOf([['A13', 0, at(8)]])).ref[10], 'A13');
  assert.equal(matchRouteAxes(r, tileOf([['A13', 0, at(20)]])).km.matched, 0);
  const cross = [[2.0135, 48.49], [2.0135, 48.51]];
  assert.equal(matchRouteAxes(r, tileOf([['N13', 1, cross]])).km.matched, 0);
});

test('ambigu = inconnu : classes différentes ou références incompatibles côte à côte', () => {
  const r = straightRoute();
  const at = (m) => line(48.5 + dLat(m));
  const amb = matchRouteAxes(r, tileOf([['A13', 0, at(5)], ['N13', 1, at(-5)]]));
  assert.equal(amb.km.matched, 0);
  assert.ok(amb.km.ambiguous > 1500);
  assert.equal(matchRouteAxes(r, tileOf([['A13', 0, at(5)], ['A14', 0, at(-5)]])).km.matched, 0);
  // Compatibles : « A13 » et « A13;E5 » → la plus complète ; bretelle sans référence à côté → référence gardée.
  assert.equal(matchRouteAxes(r, tileOf([['A13', 0, at(5)], ['A13;E5', 0, at(-5)]])).ref[10], 'A13;E5');
  assert.equal(matchRouteAxes(r, tileOf([['A13', 0, at(5)], ['', 0, at(-5)]])).ref[10], 'A13');
});

test('série de moins de 300 m écartée ; étape nommée jamais réécrite', () => {
  const r = straightRoute();
  const short = [[2.0, 48.5 + dLat(5)], [2.0027, 48.5 + dLat(5)]]; // ≈ 200 m
  assert.equal(matchRouteAxes(r, tileOf([['A13', 0, short]])).km.matched, 0);
  const named = straightRoute('D 306');
  const g = matchRouteAxes(named, tileOf([['A13', 0, line(48.5 + dLat(5))]]));
  assert.equal(g.km.matched, 0);
  assert.equal(g.km.unnamed, 0);
});

test('sampleRoute : référence du repli seulement sur une étape sans nom, marquée geo', () => {
  const r = straightRoute();
  const geo = matchRouteAxes(r, tileOf([['A13', 0, line(48.5 + dLat(5))]]));
  const s = sampleRoute(r, 200, { geo });
  assert.ok(s.every((x) => x.geo === true && x.roads[0] === 'A13'));
  assert.ok(sampleRoute(r, 200).every((x) => x.geo === false && !x.roads.length));
  const n = sampleRoute(straightRoute('D 306'), 200, { geo });
  assert.ok(n.every((x) => x.roads[0] === 'D306' && x.geo === false));
});

test('geoRoadsFor : un calcul par itinéraire et par copie', () => {
  const r = straightRoute();
  const data = tileOf([['A13', 0, line(48.5 + dLat(5))]]);
  const a = geoRoadsFor(r, data, { copyTolerance: 3 });
  assert.equal(geoRoadsFor(r, data, { copyTolerance: 3 }), a);
  assert.notEqual(geoRoadsFor(r, mergeAxesTiles([data]), { copyTolerance: 3 }), a);
});

test('réponse ORS gardée en mémoire pour « Copier la réponse ORS », sans clé', () => {
  const json = fixture('ors-directions-joigny-gonfreville.json');
  const r = parseDirections(json);
  const raw = rawResponseOf(r);
  assert.equal(raw.type, 'FeatureCollection');
  assert.equal(raw.features.length, 1);
  assert.deepEqual(raw.features[0].geometry.coordinates, json.features[0].geometry.coordinates);
  assert.equal(parseDirections(JSON.parse(JSON.stringify(raw))).distance, r.distance, 'relisible comme une réponse ORS');
  assert.ok(!/api[_-]?key|authorization/i.test(JSON.stringify(raw)));
  assert.equal(rawResponseOf({ ...r }), null, 'itinéraire copié (mémoire v53) : rien');
});
