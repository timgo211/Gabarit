// Moteur de navigation : traces GPS simulées sur des itinéraires ORS de test (aucun appel réseau).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startNavigation, updateNavigation, rerouteDone, rerouteFailed, gpsLost, zoomForSpeed, fixFromPosition,
  remainingDuration, prepareRoute, NAV,
} from '../src/lib/navigation.js';
import { createSimulator } from '../src/lib/nav-sim.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { destinationPoint, haversine, prepareLine, pointAt } from '../src/lib/nav-geo.js';
import { UTURN_SAFE_TEXT } from '../src/lib/nav-guidance.js';
import { fixture, runFixes } from './helpers.js';

const NAV_ROUTE = parseDirections(fixture('ors-directions-nav.json'));
const UTURN_ROUTE = parseDirections(fixture('ors-directions-uturn.json'));
const T0 = 1_800_000_000_000;

/** Positions toutes les secondes le long de l'itinéraire, à vitesse constante. */
function simFixes(route, kmh, seconds, { from = 0, t0 = T0 } = {}) {
  const sim = createSimulator(route.coordinates, { speedKmh: kmh });
  const out = [];
  for (let i = 0; i <= seconds; i += 1) out.push(sim.next(t0 + (from + i) * 1000));
  return out;
}

/** Position immobile (feu rouge) : vitesse 0, cap absent. */
const still = (p, t, accuracy = 5) => ({ lon: p[0], lat: p[1], accuracy, speed: 0, heading: null, timestamp: t });

/** Camion qui s'éloigne du tracé en roulant (50 km/h, cap constant), une position par seconde. */
const leaving = (origin, bearing, startM, t0, n, { from = 0 } = {}) => Array.from({ length: n }, (_, k) => {
  const i = from + k;
  const q = destinationPoint(origin, bearing, startM + i * 14);
  return { lon: q[0], lat: q[1], accuracy: 5, speed: 14, heading: bearing, timestamp: t0 + i * 1000 };
});
const OFF_ORIGIN = NAV_ROUTE.coordinates[2];

const speeches = (events) => events.filter((e) => e.type === 'speak');
const reroutes = (events) => events.filter((e) => e.type === 'reroute');

test('trajet complet à 90 km/h : annonces à ≈ 1,5 km, 500 m, 120 m puis arrivée', () => {
  const st = startNavigation(NAV_ROUTE, { now: T0 });
  const { events, state } = runFixes(updateNavigation, st, simFixes(NAV_ROUTE, 90, 400));
  assert.equal(reroutes(events).length, 0);
  const said = speeches(events);
  assert.equal(said[0].text, 'Démarrez en direction de l’Est sur Route de Lyon.');

  const turn = said.filter((e) => /D 306/.test(e.text));
  assert.deepEqual(turn.map((e) => e.text), [
    'Dans 1,5 kilomètre, tournez à droite sur D 306.',
    'Dans 500 mètres, tournez à droite sur D 306.',
    'Tournez à droite sur D 306.',
  ]);
  const d = turn.map((e) => e.view.maneuver.distance);
  assert.ok(d[0] <= 1500 && d[0] > 1470, `loin : ${d[0]}`);
  assert.ok(d[1] <= 500 && d[1] > 470, `proche : ${d[1]}`);
  assert.ok(d[2] <= 120 && d[2] > 90, `maintenant : ${d[2]}`);
  assert.equal(turn[2].interrupt, true);

  assert.ok(said.some((e) => e.text === 'Entrez sur le rond-point et prenez la 2ème sortie sur Avenue des Frères Lumière.'));
  assert.ok(said.some((e) => e.text === 'Tournez à gauche sur Rue de l’Industrie, puis tournez à droite sur Chemin du Dépôt.'));
  const arrived = events.filter((e) => e.type === 'arrived');
  assert.equal(arrived.length, 1);
  assert.equal(said[said.length - 1].text, 'Destination atteinte, sur la droite.');
  assert.ok(haversine(arrived[0].view.rawPosition, NAV_ROUTE.coordinates.at(-1)) <= NAV.ARRIVAL_RADIUS_M);
  assert.ok(haversine(arrived[0].view.rawPosition, NAV_ROUTE.coordinates.at(-1)) > 25, 'arrivée annoncée dès 50 m');
  assert.equal(state.arrived, true);
});

test('chaque manœuvre n\'est annoncée qu\'une fois par palier', () => {
  const { events } = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), simFixes(NAV_ROUTE, 50, 500));
  const texts = speeches(events).map((e) => e.text);
  assert.equal(new Set(texts).size, texts.length, texts.join('\n'));
});

test('annonces proportionnelles à la vitesse (30 km/h : plus tard)', () => {
  const { events } = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), simFixes(NAV_ROUTE, 30, 800));
  const turn = speeches(events).filter((e) => /D 306/.test(e.text));
  assert.equal(turn.length, 3);
  assert.match(turn[0].text, /^Dans 500 mètres/);
  assert.ok(turn[2].view.maneuver.distance <= 40);
  assert.equal(events.filter((e) => e.type === 'arrived').length, 1);
});

test('carte : zoom selon la vitesse, inclinée, orientée dans le sens de la marche', () => {
  assert.equal(zoomForSpeed(0), 17);
  assert.equal(zoomForSpeed(90), 15);
  assert.equal(zoomForSpeed(60), 15.75);
  assert.equal(zoomForSpeed(200), 14.5);
  assert.equal(zoomForSpeed(null), 17);
  const { views } = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), simFixes(NAV_ROUTE, 90, 20));
  const v = views.at(-1);
  assert.equal(v.zoom, 15);
  assert.equal(v.pitch, 50);
  assert.ok(Math.abs(v.bearing - 90) < 1, `cap ${v.bearing}`);
  assert.equal(Math.round(v.speedKmh), 90);
});

test('arrêt au feu : cap conservé, zoom qui se resserre, pas de recalcul', () => {
  const moving = simFixes(NAV_ROUTE, 90, 85); // juste après le virage à droite (cap sud)
  let r = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), moving);
  const heading = r.views.at(-1).bearing;
  assert.ok(Math.abs(heading - 180) < 1);
  const p = [moving.at(-1).lon, moving.at(-1).lat];
  const stops = Array.from({ length: 30 }, (_, i) => still(p, moving.at(-1).timestamp + (i + 1) * 1000));
  r = runFixes(updateNavigation, r.state, stops);
  assert.ok(Math.abs(r.views.at(-1).bearing - heading) < 1e-9);
  assert.ok(r.views.at(-1).zoom > 16.9);
  assert.equal(reroutes(r.events).length, 0);
  assert.equal(speeches(r.events).length, 0, 'rien à répéter à l\'arrêt');
});

test('bruit GPS (±20 m, précision 20 m) : pas de recalcul, guidage normal', () => {
  const fixes = simFixes(NAV_ROUTE, 50, 500).map((f, i) => {
    const q = destinationPoint([f.lon, f.lat], (i * 97) % 360, 20 * Math.abs(Math.sin(i * 1.7)));
    return { ...f, lon: q[0], lat: q[1], accuracy: 20 };
  });
  const { events } = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), fixes);
  assert.equal(reroutes(events).length, 0);
  assert.equal(events.filter((e) => e.type === 'arrived').length, 1);
  assert.ok(speeches(events).some((e) => /rond-point/.test(e.text)));
});

test('vitesse calculée entre deux positions si le GPS ne la donne pas', () => {
  const fixes = simFixes(NAV_ROUTE, 90, 10).map((f) => ({ ...f, speed: null, heading: null }));
  const { views } = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), fixes);
  assert.equal(Math.round(views.at(-1).speedKmh), 90);
  assert.ok(Math.abs(views.at(-1).bearing - 90) < 1, 'cap tiré du déplacement');
});

test('position imprécise (> 100 m) : ignorée pour le hors-itinéraire', () => {
  const st = startNavigation(NAV_ROUTE, { now: T0 });
  const off = destinationPoint(NAV_ROUTE.coordinates[2], 0, 300);
  const fixes = Array.from({ length: 20 }, (_, i) => still(off, T0 + i * 1000, 250));
  assert.equal(reroutes(runFixes(updateNavigation, st, fixes).events).length, 0);
});

test('hors itinéraire en roulant : recalcul après 3 positions et 5 s, une seule demande à la fois', () => {
  const st = startNavigation(NAV_ROUTE, { now: T0 });
  let r = runFixes(updateNavigation, st, leaving(OFF_ORIGIN, 0, 120, T0, 4));
  assert.equal(reroutes(r.events).length, 0, 'pas avant 5 s');
  const more = leaving(OFF_ORIGIN, 0, 120, T0, 20, { from: 4 });
  r = runFixes(updateNavigation, r.state, more);
  const rr = reroutes(r.events);
  assert.equal(rr.length, 1);
  assert.equal(rr[0].t, T0 + 5000);
  assert.deepEqual(rr[0].from, [more[1].lon, more[1].lat]);
  assert.equal(rr[0].manual, undefined, 'recalcul automatique');
  assert.equal(r.state.rerouting, true);
  assert.equal(r.views.at(-1).rerouting, true);
  assert.equal(r.views.at(-1).onRoute, false);
  assert.equal(r.views.at(-1).offRouteStopped, false, 'en roulant : pas de proposition');
  const last = more.at(-1);
  assert.ok(haversine(r.views.at(-1).position, [last.lon, last.lat]) < 0.01, 'hors route : position brute affichée');
});

test('recalcul en échec (réseau) : nouvel essai 30 s après, message vocal une seule fois', () => {
  let r = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), leaving(OFF_ORIGIN, 0, 120, T0, 6));
  assert.equal(reroutes(r.events).length, 1);
  let f = rerouteFailed(r.state, 'network');
  assert.equal(f.events.length, 1);
  assert.match(f.events[0].text, /Recalcul impossible/);
  r = runFixes(updateNavigation, f.state, leaving(OFF_ORIGIN, 0, 120, T0, 40, { from: 6 }));
  const rr = reroutes(r.events);
  assert.equal(rr.length, 1);
  assert.equal(rr[0].t, T0 + 5000 + NAV.REROUTE_COOLDOWN_MS);
  f = rerouteFailed(r.state, 'timeout');
  assert.equal(f.events.length, 0, 'pas de répétition vocale');
});

test('recalcul refusé (quota du jour, clé) : plus de nouvelle demande', () => {
  for (const kind of ['daily-quota', 'key-or-quota', 'invalid-key', 'no-key']) {
    let r = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), leaving(OFF_ORIGIN, 0, 120, T0, 6));
    assert.equal(reroutes(r.events).length, 1, kind);
    const f = rerouteFailed(r.state, kind);
    r = runFixes(updateNavigation, f.state, leaving(OFF_ORIGIN, 0, 120, T0, 90, { from: 6 }));
    assert.equal(reroutes(r.events).length, 0, kind);
    assert.equal(r.views.at(-1).rerouteBlocked, true);
  }
});

test('après un recalcul qui commence par un demi-tour : phrase prudente une seule fois', () => {
  let r = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), leaving(OFF_ORIGIN, 0, 120, T0, 6));
  const done = rerouteDone(r.state, UTURN_ROUTE);
  assert.deepEqual(done.events.map((e) => e.text), [`Itinéraire recalculé. ${UTURN_SAFE_TEXT}.`]);
  assert.equal(done.state.rerouting, false);

  // On suit le nouvel itinéraire : le demi-tour n'est plus jamais répété.
  r = runFixes(updateNavigation, done.state, simFixes(UTURN_ROUTE, 30, 220, { from: 10 }));
  assert.equal(r.views[0].maneuver.text, UTURN_SAFE_TEXT, 'bandeau : même phrase prudente');
  const said = speeches(r.events).map((e) => e.text);
  assert.equal(said.filter((t) => /demi-tour/i.test(t)).length, 0, said.join('\n'));
  assert.deepEqual(said.filter((t) => /Rue des Lilas/.test(t)), [
    'Dans 500 mètres, tournez à droite sur Rue des Lilas.',
    'Dans 150 mètres, tournez à droite sur Rue des Lilas.',
    'Tournez à droite sur Rue des Lilas.',
  ]);
  assert.equal(r.events.filter((e) => e.type === 'arrived').length, 1);
  assert.equal(reroutes(r.events).length, 0);
});

test('recalcul sans demi-tour : simple « Itinéraire recalculé »', () => {
  const st = startNavigation(NAV_ROUTE, { now: T0 });
  const done = rerouteDone({ ...st, rerouting: true }, NAV_ROUTE);
  assert.deepEqual(done.events.map((e) => e.text), ['Itinéraire recalculé.']);
});

test('itinéraire qui commence par un demi-tour dès le départ : même phrase prudente, une fois', () => {
  const r = runFixes(updateNavigation, startNavigation(UTURN_ROUTE, { now: T0 }), simFixes(UTURN_ROUTE, 30, 60));
  const said = speeches(r.events).map((e) => e.text);
  assert.equal(said[0], `${UTURN_SAFE_TEXT}.`);
  assert.equal(said.filter((t) => /demi-tour/i.test(t)).length, 1);
});

test('près de la destination (< 150 m) : jamais de recalcul ; arrivée à 50 m', () => {
  const end = NAV_ROUTE.coordinates.at(-1);
  const depot = destinationPoint(end, 240, 30); // entrée du dépôt, à côté du point
  const st = startNavigation(NAV_ROUTE, { destination: depot, now: T0 });
  // 120 m à côté de la fin de l'itinéraire, longtemps : pas de recalcul, pas d'arrivée.
  const yard = destinationPoint(end, 60, 120);
  let r = runFixes(updateNavigation, st, Array.from({ length: 60 }, (_, i) => still(yard, T0 + i * 1000)));
  assert.equal(reroutes(r.events).length, 0);
  assert.equal(r.state.arrived, false);
  // 60 m de la destination : toujours pas ; 45 m : arrivée (hors tracé, dans la cour).
  r = runFixes(updateNavigation, r.state, [still(destinationPoint(depot, 150, 60), T0 + 61000)]);
  assert.equal(r.state.arrived, false);
  r = runFixes(updateNavigation, r.state, [still(destinationPoint(depot, 150, 45), T0 + 62000)]);
  assert.equal(r.state.arrived, true);
  assert.deepEqual(r.events.map((e) => e.type), ['speak', 'arrived']);
  // Ensuite : plus rien.
  r = runFixes(updateNavigation, r.state, Array.from({ length: 10 }, (_, i) => still(depot, T0 + (63 + i) * 1000)));
  assert.equal(r.events.length, 0);
});

test('à 151 m de la destination et hors tracé : le recalcul reste possible', () => {
  const end = NAV_ROUTE.coordinates.at(-1);
  // En roulant sur un cercle de 160 m autour de la fin (5° par seconde ≈ 14 m/s).
  const fixes = Array.from({ length: 8 }, (_, i) => {
    const q = destinationPoint(end, 60 + i * 5, 160);
    return { lon: q[0], lat: q[1], accuracy: 5, speed: 14, heading: 150 + i * 5, timestamp: T0 + i * 1000 };
  });
  const r = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), fixes);
  assert.equal(reroutes(r.events).length, 1);
});

test('pas de fausse arrivée quand l\'itinéraire longe la destination avant d\'y revenir', () => {
  const A = [4.9, 45.7];
  const B = destinationPoint(A, 90, 1000);
  const C = destinationPoint(B, 180, 40);
  const D = destinationPoint(C, 270, 600); // fin à 40 m au sud du point 400 m de A
  const route = {
    coordinates: [A, B, C, D],
    duration: 120,
    steps: [
      { type: 11, instruction: 'Démarrez', wayPoints: [0, 1], duration: 60 },
      { type: 1, instruction: 'Tournez à droite', wayPoints: [1, 2], duration: 10 },
      { type: 1, instruction: 'Tournez à droite', wayPoints: [2, 3], duration: 50 },
      { type: 10, instruction: 'Arrivé à votre destination', wayPoints: [3, 3], duration: 0 },
    ],
  };
  const line = prepareLine(route.coordinates);
  const pass = pointAt(line, 400).point;
  assert.ok(haversine(pass, D) < 50);
  const r = runFixes(updateNavigation, startNavigation(route, { now: T0 }), [
    { lon: pass[0], lat: pass[1], accuracy: 5, speed: 10, heading: 90, timestamp: T0 },
  ]);
  assert.equal(r.state.arrived, false);
});

test('signal GPS perdu après 10 s sans position', () => {
  const st = startNavigation(NAV_ROUTE, { now: T0 });
  assert.equal(gpsLost(st, T0 + 5000), false);
  assert.equal(gpsLost(st, T0 + 11000), true, 'aucune position depuis le démarrage');
  const r = runFixes(updateNavigation, st, simFixes(NAV_ROUTE, 50, 3));
  assert.equal(gpsLost(r.state, T0 + 3000 + 9000), false);
  assert.equal(gpsLost(r.state, T0 + 3000 + 10001), true);
});

test('temps et distance restants', () => {
  const prepared = prepareRoute(NAV_ROUTE);
  assert.ok(Math.abs(remainingDuration(prepared, 0) - NAV_ROUTE.duration) < 0.5);
  assert.ok(Math.abs(remainingDuration(prepared, 1000) - (NAV_ROUTE.duration - 45)) < 0.5, 'moitié de la 1re étape (90 s)');
  assert.equal(remainingDuration(prepared, prepared.line.total), 0);
  const bare = prepareRoute({ coordinates: NAV_ROUTE.coordinates, duration: 600, steps: [] });
  assert.ok(Math.abs(remainingDuration(bare, bare.line.total / 2) - 300) < 1e-6);
  const { views } = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), simFixes(NAV_ROUTE, 90, 40));
  assert.ok(views.at(-1).remainingDistance < views[0].remainingDistance);
  assert.ok(Math.abs(views[0].remainingDistance - 6012) < 2);
});

test('lecture d\'une GeolocationPosition', () => {
  const f = fixFromPosition({ timestamp: 123, coords: { longitude: 4.9, latitude: 45.7, accuracy: 8, speed: null, heading: Number.NaN } });
  assert.deepEqual(f, { lon: 4.9, lat: 45.7, accuracy: 8, speed: null, heading: null, timestamp: 123 });
  assert.equal(fixFromPosition({ coords: { longitude: 1, latitude: 2, speed: -1 } }).speed, null);
});

test('position illisible : état inchangé', () => {
  const st = startNavigation(NAV_ROUTE, { now: T0 });
  const r = updateNavigation(st, { lon: Number.NaN, lat: 45 });
  assert.equal(r.state, st);
  assert.equal(r.view, null);
});

// ───────── Phase 7b : pas de recalcul à l'arrêt ni avec un GPS imprécis ─────────

/** Camion arrêté sur une aire à 120 m du tracé, GPS qui dérive jusqu'à 60 m autour (n positions, 1 par seconde). */
function parkedDrift(n, { speed = 0, accuracy = 15 } = {}) {
  const aire = destinationPoint(NAV_ROUTE.coordinates[3], 0, 120);
  return Array.from({ length: n }, (_, i) => {
    const q = destinationPoint(aire, (i * 137) % 360, 60 * Math.abs(Math.sin(i * 0.9)));
    return { lon: q[0], lat: q[1], accuracy, speed, heading: speed ? (i * 53) % 360 : null, timestamp: T0 + i * 1000 };
  });
}

test('camion arrêté (0 km/h) hors du tracé, GPS qui dérive de 60 m : aucun recalcul, recalcul seulement proposé', () => {
  const r = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), parkedDrift(600));
  assert.equal(reroutes(r.events).length, 0);
  assert.equal(r.state.rerouting, false);
  const v = r.views.at(-1);
  assert.equal(v.onRoute, false);
  assert.equal(v.offRouteStopped, true, 'proposition « Recalculer d\'ici »');
  assert.equal(v.canRequestReroute, true);
  assert.equal(r.views[1].offRouteStopped, false, 'pas dès la première position');
});

test('arrêté, GPS qui dérive sans donner la vitesse : la dérive ne fait pas une vitesse, aucun recalcul', () => {
  // Dérive lente (≈ 10 m d'une position à l'autre) sur un cercle de 60 m, précision annoncée 40 m.
  const aire = destinationPoint(NAV_ROUTE.coordinates[3], 0, 120);
  const fixes = Array.from({ length: 600 }, (_, i) => {
    const q = destinationPoint(aire, i * 10, 60);
    return { lon: q[0], lat: q[1], accuracy: 40, speed: null, heading: null, timestamp: T0 + i * 1000 };
  });
  const r = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), fixes);
  assert.equal(reroutes(r.events).length, 0);
  assert.ok(r.views.every((v) => v.speedKmh < 10), `vitesse max ${Math.max(...r.views.map((v) => v.speedKmh))}`);
});

test('GPS imprécis (40 m) en roulant hors du tracé : pas de recalcul ; sous 10 km/h non plus', () => {
  const imprecise = leaving(OFF_ORIGIN, 0, 120, T0, 120).map((f) => ({ ...f, accuracy: 40 }));
  assert.equal(reroutes(runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), imprecise).events).length, 0);
  const slow = leaving(OFF_ORIGIN, 0, 120, T0, 120).map((f, i) => {
    const q = destinationPoint(OFF_ORIGIN, 0, 120 + i * 2.2);
    return { ...f, lon: q[0], lat: q[1], speed: 2.2 }; // 8 km/h
  });
  assert.equal(reroutes(runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), slow).events).length, 0);
  // Pile 10 km/h, précision 30 m : vraie sortie de route, recalcul.
  const limit = leaving(OFF_ORIGIN, 0, 120, T0, 20).map((f, i) => {
    const q = destinationPoint(OFF_ORIGIN, 0, 120 + (i * 10) / 3.6);
    return { ...f, lon: q[0], lat: q[1], speed: 10 / 3.6, accuracy: 30 };
  });
  assert.equal(reroutes(runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), limit).events).length, 1);
});

test('« Recalculer d\'ici » (à l\'arrêt) : une demande, puis attente du délai de 30 s', async () => {
  const { requestReroute } = await import('../src/lib/navigation.js');
  const r = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), parkedDrift(10));
  const now = T0 + 10_000;
  const a = requestReroute(r.state, now);
  assert.equal(a.events.length, 1);
  assert.equal(a.events[0].type, 'reroute');
  assert.equal(a.events[0].manual, true);
  assert.deepEqual(a.events[0].from, r.state.lastFix);
  assert.equal(a.state.rerouting, true);
  assert.equal(requestReroute(a.state, now + 1000).events.length, 0, 'déjà en cours');
  const failed = rerouteFailed(a.state, 'network').state;
  assert.equal(requestReroute(failed, now + 5000).events.length, 0, 'moins de 30 s');
  assert.equal(requestReroute(failed, now + NAV.REROUTE_COOLDOWN_MS).events.length, 1);
  assert.equal(requestReroute(rerouteFailed(a.state, 'daily-quota').state, now + 60_000).events.length, 0, 'quota');
  assert.equal(requestReroute(startNavigation(NAV_ROUTE, { now: T0 }), T0).events.length, 0, 'sans position');
});

test('de retour sur le tracé après l\'arrêt : plus de proposition', () => {
  let r = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), parkedDrift(10));
  assert.equal(r.views.at(-1).offRouteStopped, true);
  r = runFixes(updateNavigation, r.state, simFixes(NAV_ROUTE, 50, 5, { from: 11 }));
  assert.equal(r.views.at(-1).offRouteStopped, false);
  assert.equal(reroutes(r.events).length, 0);
});

test('saut de position (vitesse calculée > 150 km/h) : ignoré, pas de recalcul', () => {
  const aire = destinationPoint(NAV_ROUTE.coordinates[3], 0, 150);
  const fixes = Array.from({ length: 120 }, (_, i) => {
    const q = destinationPoint(aire, 0, i % 2 ? 60 : 0); // sauts de 60 m toutes les 0,4 s (540 km/h)
    return { lon: q[0], lat: q[1], accuracy: 10, speed: null, heading: null, timestamp: T0 + i * 400 };
  });
  const r = runFixes(updateNavigation, startNavigation(NAV_ROUTE, { now: T0 }), fixes);
  assert.equal(reroutes(r.events).length, 0);
  assert.ok(r.views.every((v) => v.speedKmh < 10));
});
