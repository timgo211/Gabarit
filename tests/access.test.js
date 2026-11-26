// Phase 5d : accès par tranches horaires (copie data/acces-osm/) et routes réservées à la desserte locale (extra
// roadaccessrestrictions d'ORS). Fixtures : ors-directions-access.json (31 km plein est à 45,6° N, extra écrit
// d'après la doc ORS road-access-restrictions.md), osm-access.geojsonseq (voies au format de l'export osmium le long
// de ce tracé). Aucun appel réseau.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, runFixes } from './helpers.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { buildDirectionsRequest } from '../src/lib/ors-request.js';
import {
  LOCAL, parseAccessExtra, localAlongRoute, describeLocal, avoidLocalFor, guidanceLocal,
} from '../src/lib/access-local.js';
import {
  ACCESS, parseConditional, parseCondition, evaluateWay, conditionalAlongRoute, parseAccessTile, describeConditional,
  noConditionalText, unknownText, wayAlongRoute, holidayFor, mergePassages, plageShort, plageName, guidanceConditional, wayRestrictions,
} from '../src/lib/access-conditional.js';
import { accessElementFromFeature, convertAccess, osmiumAccessFilter, canRestrict } from '../src/lib/access-convert.js';
import { parseGeojsonLine, parseIndex, buildCoverage, parsePoly } from '../src/lib/areas-osm-data.js';
import { parseHours, hoursActive } from '../src/lib/zfe.js';
import { accessRules, routeRules } from '../src/lib/route-rules.js';
import { startNavigation, updateNavigation, rerouteDone } from '../src/lib/navigation.js';
import { createSimulator } from '../src/lib/nav-sim.js';
import { prepareLine } from '../src/lib/nav-geo.js';
import { indexLine } from '../src/lib/adr.js';
import { noLocalOption } from '../src/lib/route-options.js';

const semi = { name: 'Semi', weight: 44, height: 4, length: 16.5, critair: '4', banStatus: 'concerned', hazmat: false };
const route = () => parseDirections(fixture('ors-directions-access.json'));
const D = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

/** Voies de la fixture passées par la chaîne de l'Action (export osmium → convertAccess) puis relues comme l'appli. */
function copy() {
  const lines = readFileSync(new URL('./fixtures/osm-access.geojsonseq', import.meta.url), 'utf8').split('\n');
  const ways = lines.map(parseGeojsonLine).filter(Boolean).map(accessElementFromFeature).filter(Boolean);
  const poly = parsePoly('zone\n1\n   4 45\n   6 45\n   6 46\n   4 46\nEND\nEND\n');
  const conv = convertAccess(ways, { updated: '2026-12-01', grid: buildCoverage([poly]), countries: ['france'] });
  return { conv, ways: [...conv.tiles.values()].flatMap((t) => parseAccessTile(JSON.parse(JSON.stringify(t)))) };
}
const ids = (passages) => passages.map((p) => p.id);
const state = (passages, id) => passages.find((p) => p.id === id)?.state;

test('ORS : roadaccessrestrictions demandé dans la même requête, lu par itinéraire (bits cumulés)', () => {
  const req = buildDirectionsRequest({ start: [4.8, 45.6], end: [5.2, 45.6], vehicle: semi });
  assert.ok(req.body.extra_info.includes('roadaccessrestrictions'));
  assert.equal(req.body.options.vehicle_type, 'hgv');
  assert.deepEqual(route().local, [{ from: 0, to: 2, value: 4 }, { from: 20, to: 21, value: 4 }, { from: 37, to: 38, value: 12 }, { from: 39, to: 40, value: 8 }]);
  assert.equal(parseAccessExtra({}), null, 'extra absent');
  assert.deepEqual(parseAccessExtra({ roadaccessrestrictions: { values: [[0, 5, 16], [5, 9, 1], [9, 12, 0]] } }), [], 'Private / No : pas de desserte (ORS les interdit déjà)');
});

test('desserte locale : acceptée près du départ ou de l\'arrivée (3 km), alertée en transit', () => {
  const r = route();
  const loc = localAlongRoute(r, { departure: D(2026, 11, 18, 8) });
  assert.equal(loc.ok, true);
  assert.deepEqual(loc.passages.map((p) => [p.from, p.accepted, p.reason]), [[0, true, 'start'], [20, false, null], [37, true, 'end'], [39, true, 'end']]);
  const transit = loc.passages[1];
  assert.equal(describeLocal(transit), 'Route réservée à la desserte locale vers km 16 (D 306) : vous la traversez. La signalisation fait foi.');
  // Près du départ (sortie d'un client ou d'un dépôt) : à 2,3 km accepté, à 3,9 km non.
  const near = localAlongRoute({ ...r, local: [{ from: 3, to: 4, value: 4 }] }).passages[0];
  assert.deepEqual([near.accepted, near.reason], [true, 'start']);
  const far = localAlongRoute({ ...r, local: [{ from: 5, to: 6, value: 8 }] }).passages[0];
  assert.equal(far.accepted, false);
  assert.match(describeLocal(far), /^Route réservée aux livraisons vers km 4/);
  assert.equal(LOCAL.RADIUS_M, 3000);
  assert.equal(localAlongRoute({ ...r, local: [{ from: 5, to: 6, value: 8 }] }, { radius: 5000 }).passages[0].accepted, true, 'constante modifiable');
  assert.equal(localAlongRoute({ ...r, local: null }).ok, false);
});

test('« Éviter la desserte locale » : carré de 80 m, zones déjà évitées gardées, 150 km au plus', () => {
  const r = route();
  const transit = localAlongRoute(r).passages.filter((p) => !p.accepted);
  const existing = { type: 'Polygon', coordinates: [[[4.9, 45.5], [4.95, 45.5], [4.95, 45.55], [4.9, 45.5]]] };
  const plan = avoidLocalFor(transit, { start: r.coordinates[0], end: r.coordinates[40], existing });
  assert.equal(plan.ok, true);
  assert.equal(plan.geometry.coordinates.length, 2);
  const sq = plan.geometry.coordinates[1][0];
  assert.ok(Math.abs((sq[1][0] - sq[0][0]) * Math.cos(45.6 * Math.PI / 180) * 111320 - 80) < 1);
  const far = avoidLocalFor(transit, { start: [2.35, 48.85], end: [4.85, 45.75] });
  assert.equal(far.ok, false);
  assert.match(far.text, /150 km au plus à vol d'oiseau/);
  assert.equal(avoidLocalFor([], { start: [0, 0], end: [0, 0] }).ok, false);
  const opt = noLocalOption({ request: { preference: 'shortest' } }, r, plan.geometry);
  assert.deepEqual([opt.key, opt.request.preference, opt.request.avoidPolygons], ['nolocal', 'shortest', plan.geometry]);
});

test('Action : filtre osmium, routes carrossables seulement, conditions sans effet retirées, aller-retour du format', () => {
  const filter = osmiumAccessFilter();
  for (const k of ['w/hgv:conditional', 'w/motor_vehicle:conditional', 'w/vehicle:conditional', 'w/access:conditional', 'w/maxweight:conditional', 'w/hgv:forward:conditional']) {
    assert.ok(filter.includes(k), k);
  }
  const { conv, ways } = copy();
  assert.deepEqual(ids(ways).sort(), ['w101', 'w102', 'w103', 'w104', 'w105', 'w106', 'w107', 'w110']);
  assert.equal(conv.index.count, 8);
  assert.ok(parseIndex(JSON.parse(JSON.stringify(conv.index))), 'index lisible par l\'appli');
  const w101 = ways.find((w) => w.id === 'w101');
  assert.equal(w101.name, 'Rue des Écoles');
  assert.deepEqual(w101.tags, { 'hgv:conditional': 'no @ (Mo-Fr 07:00-19:00)' });
  assert.ok(Math.abs(w101.coords[0][0] - 4.9) < 2e-5 && Math.abs(w101.coords.at(-1)[0] - 4.92) < 2e-5);
  assert.equal(w101.coords.length, 2, 'ligne droite simplifiée à 2 points');
  assert.equal(canRestrict({ 'hgv:conditional': 'yes @ (Mo-Fr 07:00-19:00)' }), false, 'permission seule');
  assert.equal(canRestrict({ hgv: 'designated', 'motor_vehicle:conditional': 'no @ (22:00-06:00)' }), false, 'hgv sans condition plus précis');
  assert.equal(parseAccessTile({ w: [[1, 0]] }), null);
  assert.deepEqual(parseAccessTile({ t: [{}], n: [], w: [[1, 0, 0, 1, 2]] }), [], 'voie à un seul point ignorée');
});

test('lecture des conditions : jours, heures, AND, poids, saison non lue', () => {
  assert.deepEqual(parseConditional('no @ (Mo-Fr 07:00-09:00; Sa 08:00-12:00); destination @ (weight>7.5)').map((x) => x.value), ['no', 'destination']);
  const c = parseCondition('(Mo-Fr 06:00-22:00 AND weight>3.5)');
  assert.deepEqual([c.unknown, c.vehicle], [false, [{ key: 'weight', op: '>', value: 3.5 }]]);
  assert.equal(parseCondition('wet').unknown, true);
  assert.equal(parseCondition('Nov-Mar').unknown, true, 'saison non lue');
  assert.equal(parseCondition('sunrise-sunset').unknown, true);
  assert.deepEqual(parseConditional('no'), [], 'valeur sans condition : pas une étiquette conditionnelle');
});

test('plage qui passe minuit (22:00-06:00) : du soir au lendemain matin, jours compris', () => {
  const every = parseHours('22:00-06:00');
  assert.equal(hoursActive(every, D(2026, 11, 18, 23, 30)), true);
  assert.equal(hoursActive(every, D(2026, 11, 19, 5, 59)), true);
  assert.equal(hoursActive(every, D(2026, 11, 19, 6, 0)), false);
  assert.equal(hoursActive(every, D(2026, 11, 19, 21, 59)), false);
  const week = parseHours('Mo-Fr 22:00-06:00');
  assert.equal(hoursActive(week, D(2026, 11, 21, 5)), true, 'samedi 5 h : suite du vendredi 22 h');
  assert.equal(hoursActive(week, D(2026, 11, 23, 5)), false, 'lundi 5 h : le dimanche soir n\'est pas compris');
  assert.equal(hoursActive(week, D(2026, 11, 23, 22, 30)), true);
  const tags = { 'hgv:conditional': 'no @ (22:00-06:00)' };
  assert.equal(evaluateWay(tags, { date: D(2026, 11, 19, 2), vehicle: semi, holiday: null, dir: null }).state, 'no');
  assert.equal(evaluateWay(tags, { date: D(2026, 11, 19, 12), vehicle: semi, holiday: null, dir: null }).state, 'ok');
});

test('priorité hgv > motor_vehicle > vehicle > access : hgv:conditional=yes lève motor_vehicle:conditional=no', () => {
  const tags = { 'hgv:conditional': 'yes @ (Mo-Fr 07:00-19:00)', 'motor_vehicle:conditional': 'no @ (Mo-Fr 06:00-20:00)' };
  const at = (h, m = 0) => evaluateWay(tags, { date: D(2026, 11, 18, h, m), vehicle: semi, holiday: null, dir: null });
  assert.deepEqual([at(8).state, at(8).mode], ['ok', 'hgv'], 'mercredi 8 h : PL autorisés');
  assert.deepEqual([at(6, 30).state, at(6, 30).mode], ['no', 'motor_vehicle'], '6 h 30 : interdit');
  assert.equal(at(19, 30).state, 'no');
  assert.equal(at(21).state, 'ok', 'hors des deux tranches');
  // Étiquette sans condition d'un moyen plus précis : l'emporte sur toute condition moins précise.
  assert.equal(evaluateWay({ hgv: 'yes', 'access:conditional': 'no @ (Mo-Fr 07:00-19:00)' }, { date: D(2026, 11, 18, 8), vehicle: semi, holiday: null, dir: null }).state, 'ok');
  // Même moyen : la condition vraie l'emporte sur l'étiquette sans condition.
  assert.equal(evaluateWay({ hgv: 'yes', 'hgv:conditional': 'no @ (Mo-Fr 07:00-19:00)' }, { date: D(2026, 11, 18, 8), vehicle: semi, holiday: null, dir: null }).state, 'no');
  assert.equal(evaluateWay({ 'vehicle:conditional': 'destination @ (Mo-Sa 06:00-11:00)' }, { date: D(2026, 11, 18, 8), vehicle: semi, holiday: null, dir: null }).state, 'local');
  // Condition sur le véhicule.
  const heavy = { 'motor_vehicle:conditional': 'no @ (weight>7.5 AND Mo-Fr 07:00-09:00)' };
  assert.equal(evaluateWay(heavy, { date: D(2026, 11, 18, 8), vehicle: semi, holiday: null, dir: null }).state, 'no');
  assert.equal(evaluateWay(heavy, { date: D(2026, 11, 18, 8), vehicle: { weight: 3.5 }, holiday: null, dir: null }).state, 'ok');
  // Sens : étiquette :forward lue dans le sens de la voie seulement.
  const fwd = { 'hgv:forward:conditional': 'no @ (Mo-Fr 07:00-19:00)' };
  assert.equal(evaluateWay(fwd, { date: D(2026, 11, 18, 8), vehicle: semi, holiday: null, dir: 'forward' }).state, 'no');
  assert.equal(evaluateWay(fwd, { date: D(2026, 11, 18, 8), vehicle: semi, holiday: null, dir: 'backward' }).state, 'ok');
});

test('rapprochement prudent : voie suivie retenue ; route parallèle, pont et autre chaussée non retenus', () => {
  const r = route();
  const { ways } = copy();
  const line = prepareLine(r.coordinates);
  const grid = indexLine(line);
  const by = (id) => wayAlongRoute(line, grid, ways.find((w) => w.id === id));
  assert.ok(by('w101'), 'voie sur le tracé');
  assert.equal(by('w101').dir, 'forward');
  assert.equal(by('w102'), null, 'route parallèle à 25 m');
  assert.equal(by('w103'), null, 'route sous un pont (perpendiculaire)');
  assert.equal(by('w110'), null, 'sens unique à contresens : autre chaussée');
  // Voie qui ne suit le tracé que sur 60 % de sa longueur : non retenue.
  const half = { id: 'wx', tags: {}, coords: [[4.9, 45.6], [4.93, 45.6], [4.93, 45.61]] };
  assert.equal(wayAlongRoute(line, grid, half), null);
  assert.equal(ACCESS.MATCH_M, 15);
  assert.equal(ACCESS.MATCH_SHARE, 0.8);
});

test('voie conditionnelle interdite ou autorisée selon l\'heure de passage (pauses comprises)', () => {
  const r = route();
  const { ways } = copy();
  const morning = conditionalAlongRoute(r, { ways, vehicle: semi, departure: D(2026, 11, 18, 8) });
  assert.deepEqual(ids(morning.passages), ['w104', 'w101', 'w107', 'w106']);
  assert.equal(morning.unknown, 1, 'saison / météo (wet) : comptée, jamais alertée');
  assert.deepEqual(['w104', 'w101', 'w107', 'w106'].map((id) => state(morning.passages, id)), ['ok', 'no', 'ok', 'ok']);
  const w101 = morning.passages[1];
  assert.equal(describeConditional(w101), 'Rue des Écoles interdite aux PL lun. mar. mer. jeu. ven. 7 h–19 h : vous y seriez vers km 8 (vers 8 h 06), en vigueur à votre passage. La signalisation fait foi.');
  assert.match(describeConditional(morning.passages[0]), /^Rue du Marché interdite aux véhicules à moteur .* 6 h–20 h \(PL autorisés .* 7 h–19 h\) : .*pas en vigueur à votre passage\. La signalisation fait foi\.$/);
  const early = conditionalAlongRoute(r, { ways, vehicle: semi, departure: D(2026, 11, 18, 6, 30) });
  assert.deepEqual([state(early.passages, 'w104'), state(early.passages, 'w101')], ['no', 'ok']);
  // Pause conseillée de 45 min avant km 8 : passage à 8 h 55 au lieu de 8 h 10 (heure recalée).
  const late = conditionalAlongRoute(r, { ways, vehicle: semi, departure: D(2026, 11, 18, 18, 20), elapsed: (t) => t + 45 * 60 });
  assert.equal(state(late.passages, 'w101'), 'ok', '19 h 11 : hors tranche');
  const night = conditionalAlongRoute(r, { ways, vehicle: semi, departure: D(2026, 11, 18, 23, 30) });
  assert.equal(state(night.passages, 'w106'), 'no', 'plage 22 h → 6 h');
  const small = conditionalAlongRoute(r, { ways, vehicle: { weight: 3.5 }, departure: D(2026, 11, 22, 10) });
  assert.ok(!ids(small.passages).includes('w107'), 'poids sous la limite : voie non signalée');
});

test('PH : jours fériés du pays traversé (holidays.js)', () => {
  const r = route();
  const { ways } = copy();
  const fr = (code) => () => code;
  // 25/12/2026 (vendredi, Noël) : férié en France → 7,5 t le dimanche et les jours fériés.
  const xmas = conditionalAlongRoute(r, { ways, vehicle: semi, departure: D(2026, 12, 25, 10), countryAt: fr('FR') });
  assert.equal(state(xmas.passages, 'w107'), 'no');
  // 26/12/2026 (samedi) : férié en Allemagne (2e jour de Noël), pas en France.
  const de = conditionalAlongRoute(r, { ways, vehicle: semi, departure: D(2026, 12, 26, 10), countryAt: fr('DE') });
  assert.equal(state(de.passages, 'w107'), 'no');
  const fr26 = conditionalAlongRoute(r, { ways, vehicle: semi, departure: D(2026, 12, 26, 10), countryAt: fr('FR') });
  assert.equal(state(fr26.passages, 'w107'), 'ok');
  // Pays sans calendrier (Pays-Bas) : condition « PH » non lue, comptée à vérifier.
  const nl = conditionalAlongRoute(r, { ways, vehicle: semi, departure: D(2026, 12, 26, 10), countryAt: fr('NL') });
  assert.ok(!ids(nl.passages).includes('w107'));
  assert.equal(nl.unknown, 2);
  assert.equal(holidayFor('NL'), null);
  assert.equal(holidayFor('DE')(D(2026, 12, 26, 12)), true);
});

test('messages : jamais « aucune restriction », copie absente, conditions non lues, signalisation', () => {
  const r = route();
  const { ways } = copy();
  assert.equal(noConditionalText('2026-12-01'), 'Aucune restriction horaire signalée dans les données (copie du 01/12), la signalisation fait foi.');
  assert.equal(unknownText(2), '2 voies avec conditions non lues, à vérifier.');
  assert.equal(unknownText(1), '1 voie avec conditions non lues, à vérifier.');
  const missing = accessRules(r, { vehicle: semi, access: { status: 'failed', ways: [], updated: null } });
  assert.ok(missing.lines.some((l) => l.text === 'Restrictions horaires indisponibles (données non chargées).'));
  const ok = accessRules(r, { vehicle: semi, access: { status: 'ok', ways, updated: '2026-12-01' }, departure: D(2026, 11, 18, 8) });
  const texts = ok.lines.map((l) => l.text);
  assert.ok(texts.includes('1 voie avec conditions non lues, à vérifier.'));
  assert.ok(!texts.some((t) => /Route des Crues/.test(t)), 'condition non lue : aucune ligne propre');
  assert.ok(ok.lines.filter((l) => l.level === 'warn').every((l) => /La signalisation fait foi\.$/.test(l.text)));
  assert.ok(!texts.some((t) => /aucune restriction/i.test(t) && !/signalée dans les données/.test(t)));
  assert.deepEqual(ok.short, ['Desserte locale km 16', 'Accès PL limité km 8 à 9']); // v81 : plage km de la voie
  const empty = accessRules(r, { vehicle: semi, access: { status: 'ok', ways: [], updated: '2026-12-01' } });
  assert.ok(empty.lines.some((l) => l.text === noConditionalText('2026-12-01')));
  const all = routeRules(r, { vehicle: semi, departure: D(2026, 11, 18, 8), access: { status: 'ok', ways, updated: '2026-12-01' } });
  assert.equal(all.localTransit.length, 1);
  assert.ok(all.lines.findIndex((l) => /Rue des Écoles/.test(l.text)) < all.lines.findIndex((l) => l.level === 'info'));
});

test('guidage : bandeau sous 10 km, une annonce vers 3 km seulement si interdite à l\'heure de passage', () => {
  const r = route();
  const { ways } = copy();
  const t0 = D(2026, 11, 18, 8).getTime(); // mercredi 8 h
  const sim = createSimulator(r.coordinates, { speedKmh: 90 });
  const fixes = Array.from({ length: 900 }, (_, i) => sim.next(t0 + i * 1000));
  const run = (opts) => runFixes(updateNavigation, startNavigation(r, { now: t0, rules: { vehicle: semi, voice: true, access: ways, ...opts } }), fixes);
  const { events, views } = run({});
  const spoken = events.filter((e) => e.type === 'speak' && /desserte|interdite aux poids lourds/.test(e.text));
  assert.deepEqual(spoken.map((e) => e.text), [
    'Attention, dans 3 kilomètres, rue des écoles interdite aux poids lourds à cette heure. Suivez la signalisation.',
    'Attention, dans 3 kilomètres, route réservée à la desserte locale. Suivez la signalisation.',
  ]);
  for (const e of spoken) assert.ok(e.view.rules.access, 'bandeau affiché pendant l\'annonce');
  // Sous 10 km, la voie interdite à l'heure de passage d'abord (Rue des Écoles), avant la plus proche (Rue du Marché).
  assert.match(views[0].rules.access.text, /^Rue des Écoles dans 7,8 km : interdite à votre passage · la signalisation fait foi$/);
  assert.ok(views.some((v) => /^Rue des Écoles dans .* : interdite à votre passage · la signalisation fait foi$/.test(v.rules.access?.text ?? '')));
  assert.ok(views.some((v) => /^Desserte locale dans .* \(D 306\) : vous la traversez · la signalisation fait foi$/.test(v.rules.access?.text ?? '')));
  // Voie hors tranche (Avenue du Port, 22 h → 6 h, vers 8 h 15) : bandeau, jamais de voix.
  assert.ok(views.some((v) => /^(Avenue du Port|Rue de l'Église) dans .* hors tranche/.test(v.rules.access?.text ?? '')), 'voie hors tranche : bandeau seulement');
  assert.ok(!events.some((e) => e.type === 'speak' && /avenue du port.*(interdite|desserte)/i.test(e.text)));
  const muted = run({ voice: false });
  assert.equal(muted.events.filter((e) => e.type === 'speak' && /desserte|poids lourds à cette heure/.test(e.text)).length, 0, 'voix des règles coupée');
  // Recalcul : voies replacées sur le nouveau tracé.
  const s1 = rerouteDone(startNavigation(r, { now: t0, rules: { vehicle: semi, voice: true, access: ways } }), r).state;
  assert.equal(s1.access.length, 4);
  assert.equal(s1.local.length, 1);
  assert.equal(guidanceLocal(s1.local, 0).view, null, 'desserte à 15,6 km : pas encore de bandeau');
  assert.match(guidanceLocal(s1.local, 6000).view.text, /^Desserte locale dans 9,6 km/);
});

// v81 : N59 (test tablette Nancy → Colmar) : une voie OSM = une entrée « Accès PL limité » (plus de 60 sur la fiche).
test('v81 : voies contiguës réunies en plages (2 km, même état, même restriction) ; une seule voix par plage', () => {
  const tags = { 'hgv:conditional': 'no @ (weight>3.5)' };
  const { restrictive } = wayRestrictions(tags, { vehicle: { weight: 44 } });
  const dest = wayRestrictions({ 'hgv:conditional': 'destination @ (weight>3.5)' }, { vehicle: { weight: 44 } }).restrictive;
  const way = (id, enter, exit, state = 'no', extra = {}) => ({
    id, name: '', enter, exit, state, tags, restrictive, permissive: [], holiday: null, dir: null, at: new Date(2026, 10, 26, 6), ...extra,
  });
  const ways = [way('a', 39000, 40000), way('b', 40500, 47000), way('c', 52000, 53000), way('d', 53500, 54000, 'ok'),
    way('e', 54100, 55000, 'local', { restrictive: dest })];
  const pl = mergePassages(ways);
  assert.deepEqual(pl.map((p) => [p.enter, p.exit, p.count]), [[39000, 47000, 2], [52000, 53000, 1], [53500, 54000, 1], [54100, 55000, 1]]);
  assert.deepEqual(pl[0].ids, ['a', 'b']);
  assert.equal(plageShort(pl[0]), 'Accès PL limité km 39 à 47');
  assert.equal(plageShort(pl[1]), 'Accès PL limité km 52 à 53');
  assert.equal(plageName(pl[0]), 'Voies sans nom (2 voies)');
  assert.match(describeConditional(pl[0]), /^Voies sans nom \(2 voies\) interdite aux PL plus de 3,5 t : vous y seriez de km 39 à 47 \(entrée vers 6 h 00\), en vigueur à votre passage\. La signalisation fait foi\.$/);
  assert.deepEqual(mergePassages([]), []);
  // Guidage : 60 voies contiguës = une plage : une seule voix, le bandeau reste jusqu'à la fin de la plage.
  const many = mergePassages(Array.from({ length: 60 }, (_, i) => way(`w${i}`, 39000 + i * 900, 39000 + i * 900 + 800)));
  assert.equal(many.length, 1);
  let announced = {};
  let voices = 0;
  for (let along = 30000; along < 95000; along += 250) {
    const g = guidanceConditional(many, announced, { along, now: new Date(2026, 10, 26, 6).getTime(), timeTo: () => 0, vehicle: { weight: 44 } });
    announced = g.announced;
    if (g.speak) voices += 1;
    if (along > 40000 && along < 92000) assert.ok(g.view, `bandeau à ${along}`);
  }
  assert.equal(voices, 1);
});
