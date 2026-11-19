// Mode simulation : fausse position GPS le long de l'itinéraire, passée dans le même moteur de navigation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSimulator, SIM_SPEEDS, SIM_DEFAULT_SPEED, SIM_OFFROAD_MAX_M, SIM_MAX_STEP_S, isSimSpeed,
} from '../src/lib/nav-sim.js';
import { startNavigation, updateNavigation, rerouteDone, NAV } from '../src/lib/navigation.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { prepareLine, locateOnLine, haversine } from '../src/lib/nav-geo.js';
import { UTURN_SAFE_TEXT } from '../src/lib/nav-guidance.js';
import { fixture } from './helpers.js';

const NAV_ROUTE = parseDirections(fixture('ors-directions-nav.json'));
const UTURN_ROUTE = parseDirections(fixture('ors-directions-uturn.json'));
const LINE = prepareLine(NAV_ROUTE.coordinates);
const T0 = 1_800_000_000_000;

test('vitesses proposées : 30, 50, 90 km/h', () => {
  assert.deepEqual([...SIM_SPEEDS], [30, 50, 90]);
  assert.equal(SIM_DEFAULT_SPEED, 50);
  assert.ok(isSimSpeed(90) && !isSimSpeed(70) && !isSimSpeed('50'));
  assert.equal(createSimulator(NAV_ROUTE.coordinates, { speedKmh: 70 }).speedKmh, 50);
});

test('avance de vitesse × temps, sur le tracé, dans le sens de la route', () => {
  for (const kmh of SIM_SPEEDS) {
    const sim = createSimulator(NAV_ROUTE.coordinates, { speedKmh: kmh });
    const f0 = sim.next(T0);
    assert.deepEqual([f0.lon, f0.lat], NAV_ROUTE.coordinates[0]);
    let prev = f0;
    for (let i = 1; i <= 60; i += 1) {
      const f = sim.next(T0 + i * 1000);
      const loc = locateOnLine(LINE, [f.lon, f.lat]);
      assert.ok(loc.distance < 0.5, `hors tracé de ${loc.distance} m`);
      assert.ok(Math.abs(haversine([prev.lon, prev.lat], [f.lon, f.lat]) - kmh / 3.6) < 0.6 || loc.segIndex > 7);
      assert.equal(f.speed, kmh / 3.6);
      assert.equal(f.accuracy, 5);
      assert.equal(f.timestamp, T0 + i * 1000);
      prev = f;
    }
    assert.ok(Math.abs(sim.along - (60 * kmh) / 3.6) < 1e-6);
    assert.ok(Math.abs(prev.heading - 90) < 0.5 || kmh === 90);
  }
});

test('changement de vitesse en cours de route', () => {
  const sim = createSimulator(NAV_ROUTE.coordinates, { speedKmh: 30 });
  for (let i = 0; i <= 10; i += 1) sim.next(T0 + i * 1000);
  assert.equal(sim.setSpeed(90), true);
  assert.equal(sim.setSpeed(65), false);
  assert.equal(sim.speedKmh, 90);
  for (let i = 11; i <= 20; i += 1) sim.next(T0 + i * 1000);
  assert.ok(Math.abs(sim.along - (10 * 30 + 10 * 90) / 3.6) < 1e-6);
});

test('pause longue (onglet en arrière-plan) : pas de bond de plus de 5 s', () => {
  const sim = createSimulator(NAV_ROUTE.coordinates, { speedKmh: 90 });
  sim.next(T0);
  sim.next(T0 + 600000);
  assert.ok(Math.abs(sim.along - SIM_MAX_STEP_S * 25) < 1e-6);
});

test('arrivée : garé au bout de l\'itinéraire, vitesse nulle', () => {
  const sim = createSimulator(NAV_ROUTE.coordinates, { speedKmh: 90 });
  let f;
  for (let i = 0; i <= 300; i += 1) f = sim.next(T0 + i * 1000);
  assert.equal(sim.mode, 'parked');
  assert.equal(f.speed, 0);
  assert.equal(f.heading, null);
  assert.deepEqual([f.lon, f.lat], NAV_ROUTE.coordinates.at(-1));
  assert.equal(sim.leaveRoad(), false, 'impossible de sortir de la route une fois garé');
});

test('« Sortir de la route » : s\'écarte du tracé puis s\'arrête à 400 m', () => {
  const sim = createSimulator(NAV_ROUTE.coordinates, { speedKmh: 50 });
  for (let i = 0; i <= 20; i += 1) sim.next(T0 + i * 1000);
  assert.equal(sim.leaveRoad(), true);
  assert.equal(sim.mode, 'offroad');
  assert.equal(sim.leaveRoad(), false);
  const dists = [];
  let f;
  for (let i = 21; i <= 80; i += 1) {
    f = sim.next(T0 + i * 1000);
    dists.push(locateOnLine(LINE, [f.lon, f.lat]).distance);
  }
  assert.ok(dists[5] > 55, `écart après 6 s : ${dists[5]}`);
  assert.ok(dists.every((d, i) => i === 0 || d >= dists[i - 1] - 1e-6));
  assert.equal(f.speed, 0, 'attend le nouvel itinéraire');
  assert.ok(dists.at(-1) <= SIM_OFFROAD_MAX_M + 1);
});

test('reprise sur le nouvel itinéraire après recalcul', () => {
  const sim = createSimulator(NAV_ROUTE.coordinates, { speedKmh: 50 });
  sim.next(T0);
  sim.leaveRoad();
  sim.next(T0 + 1000);
  sim.setRoute(UTURN_ROUTE.coordinates);
  assert.equal(sim.mode, 'route');
  const f = sim.next(T0 + 2000);
  const loc = locateOnLine(prepareLine(UTURN_ROUTE.coordinates), [f.lon, f.lat]);
  assert.ok(loc.distance < 0.5 && Math.abs(loc.along - 50 / 3.6) < 1e-6);
});

/** Boucle de simulation complète, comme l'interface : positions simulées → moteur → événements. */
function simulate({ kmh, leaveAt = null, maxSeconds = 1500, onReroute }) {
  const sim = createSimulator(NAV_ROUTE.coordinates, { speedKmh: kmh });
  let state = startNavigation(NAV_ROUTE, { now: T0 });
  const events = [];
  for (let i = 0; i <= maxSeconds; i += 1) {
    const t = T0 + i * 1000;
    if (i === leaveAt) sim.leaveRoad();
    const r = updateNavigation(state, sim.next(t));
    state = r.state;
    for (const e of r.events) {
      events.push({ ...e, t, view: r.view });
      if (e.type === 'reroute') {
        const route = onReroute(e);
        const done = rerouteDone(state, route);
        state = done.state;
        for (const d of done.events) events.push({ ...d, t });
        sim.setRoute(route.coordinates);
      }
    }
    if (state.arrived) break;
  }
  return { events, state };
}

test('simulation complète à 30, 50 et 90 km/h : voix, flèches, zoom et arrivée', () => {
  for (const kmh of SIM_SPEEDS) {
    const { events, state } = simulate({ kmh, onReroute: () => assert.fail('aucun recalcul attendu') });
    assert.equal(state.arrived, true, `${kmh} km/h`);
    const said = events.filter((e) => e.type === 'speak');
    assert.ok(said.length >= 10, `${kmh} km/h : ${said.length} annonces`);
    const views = events.filter((e) => e.view).map((e) => e.view);
    assert.ok(views.some((v) => v.maneuver?.icon.kind === 'roundabout' && v.maneuver.icon.exit === 2));
    assert.ok(views.some((v) => v.maneuver?.icon.kind === 'arrow' && v.maneuver.icon.angle === 90));
    const moving = views.filter((v) => v.speedKmh > 1);
    assert.ok(moving.every((v) => Math.abs(v.speedKmh - kmh) < 1e-6));
    const expectedZoom = { 30: 16.5, 50: 16, 90: 15 }[kmh];
    assert.ok(moving.every((v) => Math.abs(v.zoom - expectedZoom) < 1e-9), `zoom ${kmh} km/h`);
    assert.equal(said.at(-1).text, 'Destination atteinte, sur la droite.');
  }
});

test('simulation : « Sortir de la route » déclenche un recalcul, puis demi-tour annoncé une fois', () => {
  let asked = 0;
  const { events, state } = simulate({
    kmh: 50,
    leaveAt: 30,
    onReroute: (e) => {
      asked += 1;
      assert.ok(haversine(e.from, NAV_ROUTE.coordinates[0]) > 400);
      return UTURN_ROUTE;
    },
  });
  assert.equal(asked, 1);
  const rr = events.find((e) => e.type === 'reroute');
  assert.ok(rr.t - (T0 + 30000) >= NAV.OFF_ROUTE_MS, 'au moins 5 s hors route');
  assert.ok(rr.t - (T0 + 30000) <= 15000, 'pas trop tard non plus');
  const said = events.filter((e) => e.type === 'speak').map((e) => e.text);
  assert.ok(said.includes(`Itinéraire recalculé. ${UTURN_SAFE_TEXT}.`));
  assert.equal(said.filter((t) => /demi-tour/i.test(t)).length, 1, said.join('\n'));
  assert.equal(state.arrived, true, 'arrivée sur le nouvel itinéraire');
  assert.equal(said.at(-1), 'Destination atteinte, sur la gauche.');
});

test('simulation : sortir de la route près de la destination ne déclenche aucun recalcul', () => {
  // L'itinéraire fait 6 012 m : à 30 km/h, au bout de 710 s on est à ≈ 100 m de la fin.
  // En partant de biais, on reste hors tracé une quinzaine de secondes à moins de 150 m de la destination.
  const end = NAV_ROUTE.coordinates.at(-1);
  const sim = createSimulator(NAV_ROUTE.coordinates, { speedKmh: 30 });
  let state = startNavigation(NAV_ROUTE, { now: T0 });
  let reroutes = 0;
  let offRouteNear = 0;
  for (let i = 0; i <= 900; i += 1) {
    if (i === 710) assert.equal(sim.leaveRoad(), true);
    const f = sim.next(T0 + i * 1000);
    if (i > 710 && haversine([f.lon, f.lat], end) >= NAV.NO_REROUTE_NEAR_DEST_M) break;
    const r = updateNavigation(state, f);
    state = r.state;
    reroutes += r.events.filter((e) => e.type === 'reroute').length;
    if (i > 710 && !r.view.onRoute) offRouteNear += 1;
  }
  assert.ok(offRouteNear >= 8, `positions hors tracé près de la destination : ${offRouteNear}`);
  assert.equal(reroutes, 0);
  assert.equal(state.arrived, false, 'jamais à moins de 50 m');
});
