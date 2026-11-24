// v55 : étapes multiples (src/lib/stops.js) dans le calcul, la fiche, les limites de 150 km, le diagnostic 2009, le
// guidage et la mémoire de l'itinéraire. Fixture : ors-directions-etapes.json (itinéraire de ors-directions-nav.json
// coupé en deux tronçons par une étape, comme ORS : arrivée type 10 puis départ type 11 au point de l'étape).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STOPS, cleanStop, sanitizeStops, moveStop, removeStop, appendStop, insertStopByRoute, crowPath, tripPoints, legLines,
} from '../src/lib/stops.js';
import { parseDirections, haversine } from '../src/lib/ors-response.js';
import { computeRouteOptions, describeOption, guidanceParams, requestFor, VARIANTS, stopUnreachableText } from '../src/lib/route-options.js';
import { restrictionsForTrip } from '../src/lib/restrictions.js';
import { avoidPolygonsFor, avoidForReroute } from '../src/lib/zfe.js';
import { avoidTunnelsFor } from '../src/lib/adr.js';
import { avoidLocalFor } from '../src/lib/access-local.js';
import { buildManeuvers, maneuverText, nextManeuver, STOP_REACHED_TEXT } from '../src/lib/nav-guidance.js';
import { startNavigation, updateNavigation, rerouteDone, remainingStops, resumeNavigation, NAV } from '../src/lib/navigation.js';
import { prepareLine, pointAt } from '../src/lib/nav-geo.js';
import { buildSave, checkSave, isValidSave, restoredChoice } from '../src/lib/route-save.js';
import { createSimulator } from '../src/lib/nav-sim.js';
import { fixture } from './helpers.js';

const ROUTE = parseDirections(fixture('ors-directions-etapes.json'));
const SINGLE = parseDirections(fixture('ors-directions-nav.json'));
const C = ROUTE.coordinates;
const STOP = { label: 'Quai 4', lon: C[14][0], lat: C[14][1] };
const vehicle = { id: 'v1', name: 'Semi', height: 4, width: 2.55, length: 16.5, weight: 44, axleload: 11.5, consumption: 33 };
const T0 = 1_800_000_000_000;

test('étapes : 10 au plus, nettoyées, déplacées, retirées', () => {
  assert.equal(STOPS.MAX, 10);
  assert.deepEqual(cleanStop({ label: '  Metz ', lon: 6.17, lat: 49.12, extra: 1 }), { label: 'Metz', lon: 6.17, lat: 49.12 });
  assert.equal(cleanStop({ label: 'x', lon: 200, lat: 0 }), null);
  assert.deepEqual(sanitizeStops(undefined), [], 'ancienne sauvegarde sans étapes');
  assert.equal(sanitizeStops([{ lon: 'a', lat: 1 }]), null);
  assert.equal(sanitizeStops(Array.from({ length: 11 }, () => STOP)), null);
  const a = { label: 'A', lon: 1, lat: 1 };
  const b = { label: 'B', lon: 2, lat: 2 };
  const c = { label: 'C', lon: 3, lat: 3 };
  assert.deepEqual(moveStop([a, b, c], 2, -1).map((x) => x.label), ['A', 'C', 'B']);
  assert.deepEqual(moveStop([a, b, c], 0, -1).map((x) => x.label), ['A', 'B', 'C'], 'bord : inchangé');
  assert.deepEqual(removeStop([a, b, c], 1).map((x) => x.label), ['A', 'C']);
  const full = Array.from({ length: 10 }, () => a);
  assert.equal(appendStop(full, b).ok, false);
  assert.equal(appendStop(full, b).text, STOPS.FULL_TEXT);
  assert.equal(appendStop([a], b).list.length, 2);
});

test('étape ajoutée en route : rangée selon sa place sur le tracé', () => {
  const near = (i) => ({ label: `km${i}`, lon: C[i][0], lat: C[i][1] });
  const r = insertStopByRoute([near(8), near(28)], near(14), C);
  assert.equal(r.ok, true);
  assert.equal(r.index, 1);
  assert.deepEqual(r.list.map((x) => x.label), ['km8', 'km14', 'km28']);
  assert.equal(insertStopByRoute([near(8)], near(30), C).index, 1, 'après la dernière étape');
  assert.equal(insertStopByRoute([near(20)], near(2), C).index, 0, 'avant la première');
  assert.equal(insertStopByRoute([near(20)], near(2), null).index, 1, 'sans tracé : avant l\'arrivée');
  assert.equal(insertStopByRoute(Array.from({ length: 10 }, () => near(3)), near(2), C).ok, false);
});

test('distance mesurée par ORS : somme des distances à vol d\'oiseau entre points successifs', () => {
  const s = [0, 45];
  const m = [1, 45];
  const e = [0, 45.0001];
  const pts = tripPoints(s, [{ lon: m[0], lat: m[1] }], e);
  assert.deepEqual(pts, [s, m, e]);
  assert.ok(Math.abs(crowPath(pts) - (haversine(s, m) + haversine(m, e))) < 1e-6);
  assert.ok(crowPath(pts) > haversine(s, e) * 100, 'une étape allonge la mesure');
});

test('réponse ORS avec étapes : un tronçon par segment, way_points gardés', () => {
  assert.deepEqual(ROUTE.wayPoints, [0, 14, 33]);
  assert.deepEqual(ROUTE.legs, [
    { distance: 3800, duration: 171, endIndex: 14 },
    { distance: 2212.1, duration: 185.7, endIndex: 33 },
  ]);
  assert.equal(SINGLE.legs.length, 1, 'sans étape : un seul tronçon');
  assert.equal(SINGLE.legs[0].duration, SINGLE.duration);
});

test('fiche : une ligne par étape (heure d\'arrivée cumulée, durée du tronçon)', () => {
  const now = new Date(2026, 10, 23, 8, 0);
  assert.deepEqual(legLines(ROUTE, [STOP], now), ['Étape 1 · Quai 4 — 08:02 (3 min)']);
  assert.deepEqual(legLines(SINGLE, [STOP], now), [], 'tronçons incohérents : rien');
  const option = { key: 'recommended', label: 'Recommandé', note: '', also: [], route: ROUTE, request: requestFor(VARIANTS.recommended) };
  const d = describeOption(option, option, { vehicle, now, stops: [STOP] });
  assert.deepEqual(d.legs, ['Étape 1 · Quai 4 — 08:02 (3 min)']);
  assert.match(d.arrival, /^Arrivée : 08:0[56]$/);
  assert.deepEqual(guidanceParams(option, { start: C[0], end: C[33], stops: [STOP] }).stops, [STOP]);
});

function fakeOrs(respond) {
  const sent = [];
  return {
    sent,
    send: async (req) => {
      sent.push(req);
      const r = respond(req.body);
      if (r instanceof Error) throw r;
      return structuredClone(r);
    },
  };
}

test('calcul avec étapes : tous les points dans chaque requête, jamais alternative_routes, 3 requêtes au plus', async () => {
  const ors = fakeOrs(() => fixture('ors-directions-etapes.json'));
  const { options, requests } = await computeRouteOptions({
    start: C[0], end: C[33], vehicle, send: ors.send, via: [[STOP.lon, STOP.lat]],
  });
  assert.ok(requests <= 3);
  assert.equal(ors.sent.length, requests);
  for (const r of ors.sent) {
    assert.equal(r.body.coordinates.length, 3);
    assert.deepEqual(r.body.coordinates[1], [STOP.lon, STOP.lat]);
    assert.equal(r.body.alternative_routes, undefined, 'jamais avec des étapes');
  }
  assert.equal(options[0].label, 'Recommandé');
  // Trajet court sans étape : alternative_routes demandé (comportement inchangé).
  const plain = fakeOrs(() => fixture('ors-directions-alternatives.json'));
  await computeRouteOptions({ start: C[0], end: C[33], vehicle, send: plain.send });
  assert.ok(plain.sent[0].body.alternative_routes);
});

const err2009 = (detail) => Object.assign(new Error('Aucun itinéraire camion trouvé.'), { code: 2009, kind: 'no-route', detail });

test('2009 avec étapes : tronçon nommé par ORS, aucune requête de plus', async () => {
  const ors = fakeOrs(() => err2009('Route could not be found - Unable to find a route between points 2 (4.9 45.7) and 3 (4.99 45.69).'));
  await assert.rejects(
    computeRouteOptions({ start: C[0], end: C[33], vehicle, send: ors.send, via: [[STOP.lon, STOP.lat], [4.98, 45.70]] }),
    (e) => {
      assert.equal(e.hint, 'stop-unreachable');
      assert.match(e.message, /entre l'étape 1 et l'étape 2/);
      return true;
    },
  );
  assert.equal(ors.sent.length, 1);
  assert.match(stopUnreachableText(1, 2), /entre le départ et l'étape 1/);
  assert.match(stopUnreachableText(3, 2), /entre l'étape 2 et l'arrivée/);
});

test('2009 avec étapes sans tronçon nommé : sens inverse (étapes à l\'envers), puis sans restrictions', async () => {
  const via = [[STOP.lon, STOP.lat], [4.98, 45.70]];
  let n = 0;
  const ors = fakeOrs(() => {
    n += 1;
    return n === 3 ? fixture('ors-directions-etapes.json') : err2009('');
  });
  await assert.rejects(computeRouteOptions({ start: C[0], end: C[33], vehicle, send: ors.send, via }), (e) => {
    assert.equal(e.hint, 'restrictions');
    return true;
  });
  assert.equal(ors.sent.length, 3, 'budget de 3 requêtes');
  assert.deepEqual(ors.sent[1].body.coordinates, [C[33], via[1], via[0], C[0]]);
  assert.equal(ors.sent[2].body.coordinates.length, 4);
  assert.equal(ors.sent[2].body.options.profile_params, undefined, 'sans restrictions');
  // Sens inverse qui passe : un point semble sans sortie.
  let k = 0;
  const back = fakeOrs(() => { k += 1; return k === 2 ? fixture('ors-directions-etapes.json') : err2009(''); });
  await assert.rejects(computeRouteOptions({ start: C[0], end: C[33], vehicle, send: back.send, via }), (e) => e.hint === 'point-no-exit');
});

test('150 km avec zones évitées : somme des tronçons (restrictions, ZFE, tunnel, desserte, recalcul)', () => {
  const start = [6.0, 49.0];
  const end = [6.0, 49.5]; // ≈ 56 km
  const far = { label: 'Loin', lon: 7.2, lat: 49.25 }; // ≈ 2 × 90 km
  const restr = [{ id: 'r1', type: 'avoid', lon: 6.0, lat: 49.25, note: '' }];
  assert.equal(restrictionsForTrip(restr, { vehicle, start, end }).tooFar, false);
  assert.equal(restrictionsForTrip(restr, { vehicle, start, end, stops: [far] }).tooFar, true);
  const atStop = [{ id: 'r2', type: 'avoid', lon: 6.1, lat: 49.2, note: '' }];
  const st = { label: 'Dépôt', lon: 6.1, lat: 49.2 };
  assert.equal(restrictionsForTrip(atStop, { vehicle, start, end, stops: [st] }).atEnds.length, 1, 'à l\'étape : non évitable');
  const zone = { name: 'ZFE test', bbox: [6.5, 49.2, 6.6, 49.3], polygons: [[[[6.5, 49.2], [6.6, 49.2], [6.6, 49.3], [6.5, 49.2]]]] };
  assert.equal(avoidPolygonsFor([zone], { start, end }).ok, true);
  const z = avoidPolygonsFor([zone], { start, end, stops: [far] });
  assert.equal(z.ok, false);
  assert.match(z.text, /départ, étapes, arrivée/);
  assert.doesNotMatch(z.text, /ajoute une étape/i);
  const tunnel = [{ forbidden: true, mid: [6.0, 49.3] }];
  assert.equal(avoidTunnelsFor(tunnel, { start, end }).ok, true);
  const t = avoidTunnelsFor(tunnel, { start, end, stops: [far] });
  assert.equal(t.ok, false);
  assert.doesNotMatch(t.text, /ajoute une étape/i);
  const local = [{ accepted: false, mid: [6.0, 49.3] }];
  assert.equal(avoidLocalFor(local, { start, end }).ok, true);
  const l = avoidLocalFor(local, { start, end, stops: [far] });
  assert.equal(l.ok, false);
  assert.doesNotMatch(l.text, /ajoute une étape/i);
  const poly = { type: 'MultiPolygon', coordinates: [] };
  assert.equal(avoidForReroute(poly, start, end), poly);
  assert.equal(avoidForReroute(poly, start, end, [far]), null);
});

test('guidage : arrivée d\'une étape dite « Vous arrivez à l\'étape », jamais « à destination »', () => {
  const line = prepareLine(C);
  const ms = buildManeuvers(ROUTE.steps, line.cum);
  const goals = ms.filter((m) => m.type === 10);
  assert.equal(goals.length, 2);
  assert.equal(goals[0].waypoint, true);
  assert.equal(goals[1].waypoint, undefined);
  assert.equal(maneuverText(goals[0]), "Vous arrivez à l'étape, sur la droite");
  assert.equal(maneuverText(goals[1]), 'Vous arrivez à destination, sur la droite');
  // « puis » ne vise jamais le départ du tronçon suivant.
  const i = ms.indexOf(goals[0]);
  const nm = nextManeuver(ms, goals[0].at - 300);
  assert.equal(nm.index, i);
  assert.notEqual(ms[nm.then].type, 11);
});

function drive(state, route, kmh, seconds, t0 = T0) {
  const sim = createSimulator(route.coordinates, { speedKmh: kmh });
  let s = state;
  const events = [];
  let view = null;
  for (let k = 0; k <= seconds; k += 1) {
    const r = updateNavigation(s, sim.next(t0 + k * 1000));
    s = r.state;
    view = r.view ?? view;
    events.push(...r.events);
  }
  return { state: s, events, view };
}

test('guidage : « Étape atteinte » une fois (phrase fixe), puis la suite vers l\'arrivée', () => {
  const s0 = startNavigation(ROUTE, { destination: C[33], now: T0, stops: [STOP] });
  assert.equal(s0.stops.length, 1);
  assert.ok(Math.abs(s0.stops[0].along - prepareLine(C).cum[14]) < 1e-6, 'point d\'accroche ORS');
  const first = drive(s0, ROUTE, 50, 60);
  assert.ok(first.view.nextStop, 'prochaine étape affichée');
  assert.equal(first.view.nextStop.label, 'Quai 4');
  const all = drive(s0, ROUTE, 50, 600);
  const said = all.events.filter((e) => e.type === 'speak').map((e) => e.text);
  assert.equal(said.filter((t) => t === STOP_REACHED_TEXT).length, 1);
  assert.equal(all.events.filter((e) => e.type === 'stop-reached').length, 1);
  assert.equal(said.filter((t) => /Destination atteinte/.test(t)).length, 1, 'arrivée finale une seule fois');
  assert.ok(said.indexOf(STOP_REACHED_TEXT) < said.findIndex((t) => /Destination atteinte/.test(t)));
  assert.ok(!said.some((t) => /arrivez à destination/.test(t) && said.indexOf(t) < said.indexOf(STOP_REACHED_TEXT)));
  assert.equal(all.state.nextStop, 1);
  assert.deepEqual(remainingStops(all.state), []);
});

test('guidage : étape dépassée sur le tracé sans y passer, marquée sans voix', () => {
  const off = { label: 'Hors route', lon: C[14][0] + 0.003, lat: C[14][1] }; // ≈ 230 m du tracé
  const s0 = startNavigation(SINGLE, { destination: C[33], now: T0, stops: [off] });
  const r = drive(s0, SINGLE, 50, 600);
  assert.equal(r.state.nextStop, 1);
  assert.ok(!r.events.some((e) => e.type === 'stop-reached'));
});

test('recalcul : les étapes non atteintes sont gardées ; reprise : étapes atteintes gardées', () => {
  const s0 = startNavigation(ROUTE, { destination: C[33], now: T0, stops: [STOP] });
  assert.deepEqual(remainingStops(s0), [STOP]);
  const done = rerouteDone(s0, ROUTE);
  assert.equal(done.state.stops.length, 1);
  const none = rerouteDone(s0, SINGLE, []);
  assert.equal(none.state.stops.length, 0);
  const back = resumeNavigation(s0, { along: 4000, nextStop: 1 });
  assert.equal(back.nextStop, 1);
  assert.equal(resumeNavigation(s0, { along: 10 }).nextStop, 0, 'ancienne sauvegarde');
});

test('pas de recalcul automatique à moins de 150 m de la prochaine étape', () => {
  const s0 = startNavigation(ROUTE, { destination: C[33], now: T0, stops: [STOP] });
  const line = prepareLine(C);
  let s = updateNavigation(s0, { lon: C[0][0], lat: C[0][1], accuracy: 5, speed: 14, heading: 90, timestamp: T0 }).state;
  // À 100 m de l'étape, hors du tracé, en roulant : aucune demande de recalcul.
  const p = pointAt(line, line.cum[14]).point;
  const events = [];
  for (let k = 1; k <= 20; k += 1) {
    const r = updateNavigation(s, { lon: p[0], lat: p[1] + 0.0009, accuracy: 5, speed: 14, heading: 0, timestamp: T0 + k * 1000 });
    s = r.state;
    events.push(...r.events);
  }
  assert.ok(NAV.NO_REROUTE_NEAR_DEST_M >= 150);
  assert.ok(!events.some((e) => e.type === 'reroute'));
});

test('mémoire de l\'itinéraire : étapes gardées, ancienne sauvegarde sans étapes acceptée', () => {
  const choice = {
    options: [{ key: 'recommended', label: 'Recommandé', route: ROUTE }], selected: 0, start: C[0], end: C[33],
    fromLabel: 'Dépôt', toLabel: 'Client', stops: [STOP], vehicle,
  };
  const vehicles = [vehicle];
  const save = buildSave({ kind: 'nav', choice, vehicleId: 'v1', along: 100, nextStop: 1, now: 1000 });
  assert.deepEqual(save.choice.stops, [STOP]);
  assert.equal(save.progress.nextStop, 1);
  assert.equal(isValidSave(save), true);
  assert.deepEqual(restoredChoice(save, vehicles).stops, [STOP]);
  const old = structuredClone(save);
  delete old.choice.stops;
  delete old.progress.nextStop;
  assert.equal(checkSave(old, { now: 2000, vehicles }).action, 'restore');
  assert.deepEqual(restoredChoice(old, vehicles).stops, []);
  const bad = structuredClone(save);
  bad.choice.stops = [{ lon: 'x' }];
  assert.equal(isValidSave(bad), false);
});
