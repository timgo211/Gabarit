// v55 : étapes multiples (src/lib/stops.js) dans le calcul, la fiche, les limites de 150 km, le diagnostic 2009, le
// guidage et la mémoire de l'itinéraire. Fixture : ors-directions-etapes.json (itinéraire de ors-directions-nav.json
// coupé en deux tronçons par une étape, comme ORS : arrivée type 10 puis départ type 11 au point de l'étape).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STOPS, cleanStop, sanitizeStops, moveStop, removeStop, appendStop, insertStopByRoute, crowPath, tripPoints, legLines,
  nextStopLine,
  nextStopParts,
} from '../src/lib/stops.js';
import { formatArrival } from '../src/lib/format.js';
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

test('fiche : une ligne par tronçon (durée, km, heure d\'arrivée cumulée), dernier tronçon compris', () => {
  const now = new Date(2026, 10, 23, 8, 0);
  assert.deepEqual(legLines(ROUTE, [STOP], now), [
    { title: 'Tronçon 1 : Départ → Étape 1', detail: '« Quai 4 » · 3 min · 3,8 km · arrivée 08:02' },
    { title: 'Tronçon 2 : Étape 1 → Arrivée', detail: '3 min · 2,2 km · arrivée 08:05' },
  ]);
  assert.deepEqual(legLines(SINGLE, [STOP], now), [], 'tronçons incohérents : rien');
  const option = { key: 'recommended', label: 'Recommandé', note: '', also: [], route: ROUTE, request: requestFor(VARIANTS.recommended) };
  const d = describeOption(option, option, { vehicle, now, stops: [STOP] });
  assert.equal(d.legs.length, 2);
  assert.equal(d.legs[0].title, 'Tronçon 1 : Départ → Étape 1');
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

// v62 : fixture à 2 étapes (ors-directions-2-etapes.json) : 254 km vers le nord, épingle de 80 km (37,5 km est, 5 km,
// 37,5 km ouest : l'étape 2 est à 5 km à vol d'oiseau de l'étape 1), puis 100 km.
const ROUTE2 = parseDirections(fixture('ors-directions-2-etapes.json'));
const C2 = ROUTE2.coordinates;
const STOPS2 = [
  { label: 'Total Aire de la Couline', lon: C2[26][0], lat: C2[26][1] },
  { label: 'Quai 4', lon: C2[37][0], lat: C2[37][1] },
];

test('fiche à 2 étapes : 3 tronçons lus dans segments, somme = total de la fiche, dernière heure = arrivée', () => {
  const now = new Date(2026, 10, 23, 12, 3);
  assert.deepEqual(ROUTE2.wayPoints, [0, 26, 37, 47]);
  assert.equal(ROUTE2.legs.length, 3);
  const lines = legLines(ROUTE2, STOPS2, now);
  assert.deepEqual(lines, [
    { title: 'Tronçon 1 : Départ → Étape 1', detail: '« Total Aire de la Couline » · 3 h 29 · 254 km · arrivée 15:32' },
    { title: 'Tronçon 2 : Étape 1 → Étape 2', detail: '« Quai 4 » · 1 h 05 · 80,0 km · arrivée 16:37' },
    { title: 'Tronçon 3 : Étape 2 → Arrivée', detail: '1 h 20 · 100 km · arrivée 17:57' },
  ]);
  const sumD = ROUTE2.legs.reduce((a, l) => a + l.duration, 0);
  const sumM = ROUTE2.legs.reduce((a, l) => a + l.distance, 0);
  assert.equal(sumD, ROUTE2.duration, 'somme des durées = total');
  assert.equal(sumM, ROUTE2.distance, 'somme des distances = total');
  const option = { key: 'recommended', label: 'Recommandé', note: '', also: [], route: ROUTE2, request: requestFor(VARIANTS.recommended) };
  const d = describeOption(option, option, { vehicle, now, stops: STOPS2 });
  assert.equal(d.duration, '5 h 54');
  assert.equal(d.distance, '434 km');
  assert.equal(d.arrival, `Arrivée : ${formatArrival(now, ROUTE2.duration)}`);
  assert.equal(d.arrival, 'Arrivée : 17:57');
  assert.ok(d.legs.at(-1).detail.endsWith('arrivée 17:57'), 'arrivée du dernier tronçon = arrivée de la fiche');
  assert.ok(!d.legs.some((l) => /^Total|· Total/.test(l.title)), '« Total » jamais dans un titre');
});

test('guidage : « Étape k/n : durée · km » le long du tracé, jamais à vol d\'oiseau, mis à jour à chaque étape', () => {
  assert.equal(nextStopLine(null), '');
  assert.equal(nextStopLine({ index: 2, count: 2, distance: 0, duration: 0 }), '');
  const line = prepareLine(C2);
  const s0 = startNavigation(ROUTE2, { destination: C2[47], now: T0, stops: STOPS2 });
  let s = s0;
  const seen = [];
  const said = [];
  const STEP = 100; // m, toutes les 4 s (90 km/h)
  for (let k = 0, a = 0; a <= line.total; k += 1, a += STEP) {
    const { point: p, bearing: heading } = pointAt(line, a);
    const r = updateNavigation(s, { lon: p[0], lat: p[1], accuracy: 5, speed: 25, heading, timestamp: T0 + k * 4000 });
    s = r.state;
    said.push(...r.events.filter((e) => e.type === 'speak').map((e) => e.text));
    const text = nextStopLine(r.view?.nextStop);
    if (!seen.length || seen.at(-1).text !== text.replace(/ : .*/, '')) seen.push({ text: text.replace(/ : .*/, ''), a, full: text, view: r.view?.nextStop });
  }
  assert.deepEqual(seen.map((x) => x.text), ['Étape 1/2', 'Étape 2/2', ''], 'mise à jour à chaque étape atteinte');
  assert.equal(seen[0].full, 'Étape 1/2 : 3 h 29 · 254 km');
  // Juste après l'étape 1 : 80 km par l'épingle, alors que l'étape 2 est à 5 km à vol d'oiseau.
  const v = seen[1].view;
  assert.ok(v.distance > 75000 && v.distance <= 80100, `distance le long du tracé : ${v.distance}`);
  assert.ok(haversine(pointAt(line, seen[1].a).point, C2[37]) < 6000, 'à vol d\'oiseau : environ 5 km');
  assert.match(seen[1].full, /^Étape 2\/2 : 1 h 0\d · (7\d|80),\d km$/);
  assert.equal(said.filter((t) => t === STOP_REACHED_TEXT).length, 2, '« Étape atteinte. » à chaque étape');
});

test('v70 : ligne d\'étape en morceaux insécables, même texte que nextStopLine', () => {
  assert.equal(nextStopParts(null), null);
  assert.equal(nextStopParts({ index: 1, count: 1, distance: 0, duration: 0 }), null);
  const next = { index: 0, count: 1, distance: 148_000, duration: 117 * 60 };
  assert.deepEqual(nextStopParts(next), { label: 'Étape 1/1 :', duration: '1 h 57', distance: '148 km' });
  assert.equal(nextStopLine(next), 'Étape 1/1 : 1 h 57 · 148 km');
  const p = nextStopParts({ index: 9, count: 10, distance: -5, duration: Number.NaN });
  assert.deepEqual(p, { label: 'Étape 10/10 :', duration: '0 min', distance: '0 m' });
});

test('v76 : point de passage technique (`via`) : ni « Étape atteinte. », ni « Vous arrivez à l\'étape », ni ligne d\'étape', () => {
  const via = { ...STOP, label: 'Rocade Est (point de passage)', via: true };
  const s0 = startNavigation(ROUTE, { destination: C[33], now: T0, stops: [via] });
  assert.equal(s0.stops[0].via, true);
  assert.ok(!s0.route.maneuvers.some((m) => m.waypoint), 'arrivée intermédiaire du point de passage retirée');
  const first = drive(s0, ROUTE, 50, 60);
  assert.equal(first.view.nextStop, null, 'aucune ligne « Étape k/n »');
  const all = drive(s0, ROUTE, 50, 600);
  const said = all.events.filter((e) => e.type === 'speak').map((e) => e.text);
  assert.equal(said.filter((t) => t === STOP_REACHED_TEXT).length, 0);
  assert.ok(!said.some((t) => /arrivez à l'étape/.test(t)), said.join(' | '));
  assert.equal(all.events.filter((e) => e.type === 'stop-reached').length, 0);
  assert.equal(said.filter((t) => /Destination atteinte/.test(t)).length, 1);
  assert.equal(all.state.nextStop, 1, 'passé en silence');
  assert.deepEqual(all.state.stopsDone, [], 'jamais dans l\'historique');
  // Recalcul avant le point : il est gardé (via) et toujours sans arrivée intermédiaire.
  const left = remainingStops(first.state);
  assert.deepEqual(left.map((x) => x.via), [true]);
  const re = rerouteDone(first.state, ROUTE, left);
  assert.ok(!re.state.route.maneuvers.some((m) => m.waypoint));
  assert.equal(re.state.stops[0].via, true);
});
