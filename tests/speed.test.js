// Limitations de vitesse PL (phase 11a) : copie data/vitesses-osm/ (Action), règles générales PL, limite le long du
// tracé. Fixture osm-vitesses-colombier.geojsonseq SYNTHÉTIQUE posée sur le tracé de ors-directions-colombier.json
// (Rue du Viaduc 50, puis 90, puis voie rapide maxspeed:hgv 70 avec condition, puis A 36 à 130).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SPEEDS, chainWays, convertSpeeds, limitOf, osmiumSpeedsFilter, parseKmh, reduceWays, speedFromFeature, speedSizeProblem,
} from '../src/lib/speed-convert.js';
import {
  SPEED, SPEED_TEXT, limitAt, mergeSpeedTiles, parseSpeedTile, speedLimitsAlongRoute, speedRules, wayLimit,
} from '../src/lib/speed-limit.js';
import { FR_SPEED_RULES, generalLimit, reducedThreshold, roadKind } from '../src/lib/speed-rules.js';
import { parseCountryData } from '../src/lib/country-rules.js';
import { parseGeojsonLine } from '../src/lib/areas-osm-data.js';
import { parseDirections } from '../src/lib/ors-response.js';

const features = readFileSync(new URL('./fixtures/osm-vitesses-colombier.geojsonseq', import.meta.url), 'utf8')
  .split('\n').map(parseGeojsonLine).filter(Boolean);
const route = parseDirections(JSON.parse(readFileSync(new URL('./fixtures/ors-directions-colombier.json', import.meta.url), 'utf8')));

// Règles de test (même forme que FR_SPEED_RULES, valeurs d'essai) : autoroute 90, voie rapide 80, route 80.
const TEST_FR = Object.freeze({
  verified: '2026-11-23', source: 'essai',
  bands: [{ over: 3.5, upTo: null, trailer: 'any', motorway: 90, express: 80, road: 80 }],
  adr: null,
});
const UNVERIFIED = Object.freeze({ verified: null, source: null, bands: [], adr: null });
const truck = { weight: 44, trailer: '' };

function copy(fr = TEST_FR, list = features) {
  const ways = list.map(speedFromFeature).filter(Boolean);
  const conv = convertSpeeds(ways, { updated: '2026-11-21', grid: null, countries: ['france'], fr });
  const tiles = conv.tiles ? [...conv.tiles.values()].map((t) => parseSpeedTile(JSON.parse(JSON.stringify(t)))) : [];
  return { ways, conv, data: mergeSpeedTiles(tiles) };
}

test('étiquettes : km/h lisibles seulement, sens, maxspeed:hgv prioritaire, drapeau conditions', () => {
  assert.equal(parseKmh('50'), 50);
  assert.equal(parseKmh('50 km/h'), 50);
  for (const bad of ['none', 'signals', 'FR:urban', '50 mph', '50;70', 'walk', '', null, '3', '200']) assert.equal(parseKmh(bad), null, String(bad));
  assert.equal(limitOf({ maxspeed: '70', 'maxspeed:backward': '50' }, 'maxspeed'), 50, 'la plus basse des deux');
  assert.equal(limitOf({ 'maxspeed:forward': '70' }, 'maxspeed'), null, 'un seul sens connu');
  const byId = new Map(features.map((f) => [f.id, speedFromFeature(f)]));
  assert.deepEqual({ ...byId.get('w3001'), coords: undefined }, { limit: 50, hgv: false, cond: false, cls: 4, coords: undefined });
  assert.equal(byId.get('w3003').limit, 70);
  assert.equal(byId.get('w3003').hgv, true);
  assert.equal(byId.get('w3003').cond, true);
  assert.equal(byId.get('w3003').cls, 1);
  assert.equal(byId.get('w3004').cls, 0);
  assert.equal(byId.get('w3006'), null, 'rue résidentielle non gardée');
  assert.equal(byId.get('w3007'), null, 'FR:urban illisible');
  assert.equal(byId.get('w3008').limit, 50);
  assert.equal(byId.get('w3009'), null);
  assert.equal(byId.get('w3010'), null, 'mph');
  assert.deepEqual(osmiumSpeedsFilter(), ['w/maxspeed', 'w/maxspeed:hgv']);
});

test('règles générales : France seulement si vérifiée, agglomération jamais, voie rapide = la plus basse ailleurs', () => {
  assert.equal(roadKind(0), 'motorway');
  assert.equal(roadKind(1), 'express');
  assert.equal(roadKind(3), 'road');
  assert.deepEqual(generalLimit({ country: 'FR', cls: 0, vehicle: truck, fr: TEST_FR }), { kmh: 90, source: 'essai' });
  assert.equal(generalLimit({ country: 'FR', cls: 0, vehicle: truck, fr: UNVERIFIED }), null);
  assert.equal(generalLimit({ country: 'FR', cls: 0, vehicle: { weight: 3.5 }, fr: TEST_FR }), null, '3,5 t : pas un PL');
  assert.equal(generalLimit({ country: 'FR', cls: 0, vehicle: { ...truck, hazmat: true }, fr: TEST_FR }), null, 'ADR non vérifié');
  assert.equal(generalLimit({ country: null, cls: 0, vehicle: truck, fr: TEST_FR }), null, 'pays inconnu');
  const de = parseCountryData(JSON.parse(readFileSync(new URL('../data/pays/DE.json', import.meta.url), 'utf8')));
  const be = parseCountryData(JSON.parse(readFileSync(new URL('../data/pays/BE.json', import.meta.url), 'utf8')));
  const es = parseCountryData(JSON.parse(readFileSync(new URL('../data/pays/ES.json', import.meta.url), 'utf8')));
  const countries = new Map([['DE', { status: 'ok', data: de }], ['BE', { status: 'ok', data: be }], ['ES', { status: 'ok', data: es }]]);
  assert.equal(generalLimit({ country: 'DE', cls: 0, vehicle: truck, countries }).kmh, 80);
  assert.equal(generalLimit({ country: 'DE', cls: 2, vehicle: truck, countries }).kmh, 60);
  assert.equal(generalLimit({ country: 'DE', cls: 1, vehicle: truck, countries }).kmh, 60, 'voie rapide : la plus basse');
  assert.equal(generalLimit({ country: 'BE', cls: 2, vehicle: { weight: 7 }, countries }), null, 'BE route selon la région');
  assert.equal(generalLimit({ country: 'ES', cls: 0, vehicle: { ...truck, hazmat: true }, countries }).kmh, 80, 'ES : ADR −10');
  assert.equal(generalLimit({ country: 'AT', cls: 0, vehicle: truck, countries }), null, 'fiche absente');
  assert.equal(reducedThreshold('FR', 0, TEST_FR), 90);
  assert.equal(reducedThreshold('FR', 0, UNVERIFIED), null);
  // Règles françaises de l'appli : vérifiées avec une source, ou aucune (jamais une valeur sans source).
  if (FR_SPEED_RULES.verified) {
    assert.match(FR_SPEED_RULES.verified, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(FR_SPEED_RULES.source);
    assert.ok(FR_SPEED_RULES.bands.length > 0);
  } else assert.equal(FR_SPEED_RULES.bands.length, 0);
});

test('copie : cases, index, voies mises bout à bout, taille, copie réduite, rien écrit au-delà', () => {
  const { conv, ways } = copy();
  assert.equal(conv.problem, null);
  assert.equal(conv.index.mode, 'complet');
  assert.equal(conv.index.tolerance, 3);
  assert.equal(conv.index.count, 6);
  assert.deepEqual(Object.keys(conv.index.tiles), ['6_47']);
  assert.match(conv.log[0], /6 voies \(dont 1 maxspeed:hgv, 1 avec conditions\)/);
  assert.equal(SPEEDS.MAX_TOTAL_BYTES, 40 * 1024 * 1024);
  assert.equal(SPEEDS.MAX_FILE_BYTES, 5 * 1024 * 1024);
  assert.match(speedSizeProblem({ total: 41 * 1024 * 1024, biggest: ['2_48', 10] }), /plus de 40 Mo/);
  assert.match(speedSizeProblem({ total: 1, biggest: ['2_48', 6 * 1024 * 1024] }), /case 2_48/);
  // Réduite : maxspeed:hgv + limites sous la règle (90 sur route : 80 → gardé ; 130 sur autoroute → retiré).
  const red = reduceWays(ways, TEST_FR);
  assert.deepEqual(red.map((w) => w.limit).sort((a, b) => a - b), [30, 50, 50, 70]);
  assert.equal(reduceWays(ways, UNVERIFIED).length, 1, 'sans règle vérifiée : maxspeed:hgv seulement');
  const small = convertSpeeds(ways, { fr: TEST_FR, maxTotal: conv.sizes.total - 1 });
  assert.equal(small.problem, null);
  assert.equal(small.index.mode, 'réduit');
  assert.equal(small.index.count, 4);
  const none = convertSpeeds(ways, { fr: TEST_FR, maxTotal: 10 });
  assert.equal(none.index, null);
  assert.equal(none.tiles, null);
  assert.match(none.problem, /plus de 40 Mo/);
  // Deux voies de même limite qui se touchent : une seule ligne (sens de l'une retourné).
  const a = { limit: 50, hgv: false, cond: false, cls: 4, coords: [[0, 0], [0, 1]] };
  const b = { limit: 50, hgv: false, cond: false, cls: 4, coords: [[0, 2], [0, 1]] };
  const c = { limit: 70, hgv: false, cond: false, cls: 4, coords: [[0, 2], [0, 3]] };
  const ch = chainWays([a, b, c]);
  assert.equal(ch.length, 2);
  assert.deepEqual(ch[0].coords, [[0, 0], [0, 1], [0, 2]]);
});

test('limite le long du tracé : étiquette, plafond de la règle, conditions, croisement ignoré, couverture', () => {
  const { data } = copy();
  const res = speedLimitsAlongRoute(route, data, { vehicle: truck, fr: TEST_FR });
  const list = res.intervals.map((r) => [r.kmh, r.source, r.cond]);
  assert.deepEqual(list, [[50, 'osm', false], [80, 'rule', false], [70, 'osm', true], [90, 'rule', false]]);
  assert.ok(res.coverage > 0.9 && res.coverage <= 1, String(res.coverage));
  assert.ok(res.condShare > 0.05 && res.condShare < 0.15, String(res.condShare));
  // La route qui croise à 30 km/h (km 0,55) n'interrompt rien.
  assert.equal(limitAt(res, 556).limit.kmh, 50);
  // Règle non vérifiée : plus que maxspeed:hgv.
  const un = speedLimitsAlongRoute(route, data, { vehicle: truck, fr: UNVERIFIED });
  assert.deepEqual(un.intervals.map((r) => [r.kmh, r.source]), [[70, 'osm']]);
  // Véhicule de 3,5 t : maxspeed sans plafond, maxspeed:hgv ignoré (inconnu là).
  const van = speedLimitsAlongRoute(route, data, { vehicle: { weight: 3.5 }, fr: TEST_FR });
  assert.deepEqual(van.intervals.map((r) => r.kmh), [50, 90, 130]);
  // Copie absente : rien.
  const no = speedLimitsAlongRoute(route, null, { vehicle: truck, fr: TEST_FR });
  assert.deepEqual(no.intervals, []);
  assert.equal(no.coverage, 0);
  assert.equal(wayLimit({ limit: 130, hgv: false, cond: false, cls: 0 }, 'FR', { weight: 44 }, null, TEST_FR).kmh, 90);
  assert.equal(SPEED.TOLERANCE_M, 15);
});

test('limitAt : curseur qui avance, recule, hors intervalle = inconnue', () => {
  const limits = { intervals: [{ from: 0, to: 100, kmh: 50, source: 'osm', cond: false }, { from: 200, to: 300, kmh: 90, source: 'rule', cond: false }] };
  let r = limitAt(limits, 10, 0);
  assert.equal(r.limit.kmh, 50);
  r = limitAt(limits, 150, r.cursor);
  assert.equal(r.limit, null);
  r = limitAt(limits, 250, r.cursor);
  assert.equal(r.limit.kmh, 90);
  assert.equal(r.cursor, 1);
  r = limitAt(limits, 20, r.cursor);
  assert.equal(r.limit.kmh, 50);
  assert.equal(limitAt(limits, 400, 1).limit, null);
  assert.equal(limitAt(null, 10).limit, null);
});

test('fiche et diagnostic : couverture, conditions à vérifier, copie absente', () => {
  const { data } = copy();
  const ok = speedRules(route, { vehicle: truck, speeds: { status: 'ok', data, updated: '2026-11-21' }, fr: TEST_FR });
  assert.equal(ok.card, 'Limites de vitesse connues : 100 % du trajet');
  assert.deepEqual(ok.lines, [{ level: 'info', text: SPEED_TEXT.COND }]);
  assert.match(ok.tech, /^Limites de vitesse : 100 % \(OSM \d+ %, plafonnées par règle générale \d+ %, conditions \d+ %\) ; copie du 2026-11-21$/);
  const failed = speedRules(route, { vehicle: truck, speeds: { status: 'failed', data: { ways: [] } } });
  assert.equal(failed.card, 'Limites de vitesse connues : inconnues (copie OpenStreetMap absente)');
  assert.match(failed.tech, /copie data\/vitesses-osm absente/);
  const none = speedRules(route, { vehicle: truck, speeds: { status: 'ok', data: { ways: [] } }, fr: TEST_FR });
  assert.equal(none.card, 'Limites de vitesse connues : inconnues');
  assert.deepEqual(none.lines, []);
  assert.equal(speedRules(route, { vehicle: truck, speeds: { status: 'loading' } }).card, '');
  assert.equal(SPEED_TEXT.SETTINGS, "Limites d'après OpenStreetMap et règles générales : la signalisation fait foi.");
});

test('guidage : limite du tronçon affichée, « Limite 50 » une fois au dépassement si le réglage est activé', async () => {
  const { startNavigation, updateNavigation, setNavigationSpeeds, rerouteDone } = await import('../src/lib/navigation.js');
  const { data } = copy();
  const van = { weight: 3.5, height: 2.8 }; // 3,5 t : maxspeed sans plafond, indépendant des règles françaises
  const rules = { vehicle: van, zfe: null };
  const fixes = [47.6505, 47.6507, 47.6509, 47.6511].map((lat, i) => ({ lon: 6.2105, lat, accuracy: 5, speed: 70 / 3.6, heading: 0, timestamp: 1000 + i * 1000 }));
  const run = (st) => {
    const out = { views: [], speak: [] };
    for (const f of fixes) {
      const r = updateNavigation(st, f);
      st = r.state;
      out.views.push(r.view);
      out.speak.push(...r.events.filter((e) => e.type === 'speak' && /^Limite/.test(e.text)).map((e) => e.text));
    }
    return { ...out, st };
  };
  const on = run(startNavigation(route, { now: 1000, rules, speeds: { data, voice: true } }));
  assert.equal(on.views[0].speedLimit, 50);
  assert.equal(on.views[0].speedLimitSource, 'osm');
  assert.deepEqual(on.speak, ['Limite 50.']);
  const off = run(startNavigation(route, { now: 1000, rules, speeds: { data, voice: false } }));
  assert.equal(off.views[1].speedLimit, 50);
  assert.deepEqual(off.speak, [], 'désactivé par défaut');
  const none = run(startNavigation(route, { now: 1000, rules }));
  assert.equal(none.views[0].speedLimit, null, 'copie absente : aucun panneau');
  // Cases arrivées après « Démarrer », puis recalcul : limites recalculées.
  const late = setNavigationSpeeds(startNavigation(route, { now: 1000, rules }), data);
  assert.equal(updateNavigation(late, fixes[0]).view.speedLimit, 50);
  const re = rerouteDone(late, route).state;
  assert.equal(re.speedLimits.intervals.length > 0, true);
  // 44 t sans règle française vérifiée : seule la voie rapide maxspeed:hgv (avec condition) a une limite, jamais dite.
  const hgv = startNavigation(route, { now: 1000, rules: { vehicle: truck }, speeds: { data, voice: true } });
  const at = (lat) => ({ lon: 6.2105, lat, accuracy: 5, speed: 100 / 3.6, heading: 0 });
  let st = hgv; const said = [];
  for (const [i, lat] of [47.6670, 47.6672, 47.6674].entries()) {
    const r = updateNavigation(st, { ...at(lat), timestamp: 1000 + i * 1000 });
    st = r.state;
    said.push(...r.events.filter((e) => /^Limite/.test(e.text ?? '')));
    if (!FR_SPEED_RULES.verified) assert.equal(r.view.speedLimit, 70);
  }
  assert.deepEqual(said, [], 'limite avec conditions : jamais dite');
});
