import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bearing, destinationPoint, bearingDiff, normalizeBearing, prepareLine, locateOnLine, pointAt, segmentAt, segmentBearing, haversine,
} from '../src/lib/nav-geo.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≠ ${b} (±${eps})`);
const P = [4.95, 45.73];

test('cap : nord, est, sud, ouest', () => {
  near(bearing(P, [4.95, 45.74]), 0, 1e-6);
  near(bearing(P, destinationPoint(P, 90, 1000)), 90, 0.01);
  near(bearing(P, [4.95, 45.72]), 180, 1e-6);
  near(bearing(P, destinationPoint(P, 270, 1000)), 270, 0.01);
});

test('point à distance et cap donnés : aller-retour avec haversine', () => {
  for (const b of [0, 45, 135, 200, 315]) {
    const q = destinationPoint(P, b, 1234);
    near(haversine(P, q), 1234, 0.01, `cap ${b}`);
    near(bearing(P, q), b, 0.01, `cap ${b}`);
  }
});

test('angles : normalisation et écart le plus court', () => {
  assert.equal(normalizeBearing(-10), 350);
  assert.equal(normalizeBearing(370), 10);
  assert.equal(bearingDiff(350, 10), 20);
  assert.equal(bearingDiff(90, 270), 180);
});

test('distances cumulées', () => {
  const line = prepareLine([P, destinationPoint(P, 90, 500), destinationPoint(destinationPoint(P, 90, 500), 180, 300)]);
  near(line.cum[1], 500, 0.01);
  near(line.total, 800, 0.02);
  assert.throws(() => prepareLine([P]), /trop court/);
});

test('projection d\'une position sur le tracé (30 m à côté de la route)', () => {
  const b = destinationPoint(P, 90, 1000);
  const line = prepareLine([P, b]);
  const onRoad = destinationPoint(P, 90, 400);
  const gps = destinationPoint(onRoad, 0, 30);
  const loc = locateOnLine(line, gps);
  assert.equal(loc.segIndex, 0);
  near(loc.distance, 30, 0.2);
  near(loc.along, 400, 0.5);
  near(haversine(loc.point, onRoad), 0, 0.5);
});

test('avant le départ ou après l\'arrivée : projection bornée aux extrémités', () => {
  const line = prepareLine([P, destinationPoint(P, 90, 1000)]);
  const before = locateOnLine(line, destinationPoint(P, 270, 50));
  assert.equal(before.along, 0);
  near(before.distance, 50, 0.1);
});

test('aller-retour sur la même route : la recherche locale garde le bon sens', () => {
  // Aller vers l'est 1 km, demi-tour, retour 1 km : les deux sens se superposent à 10 m près.
  const A = P;
  const B = destinationPoint(A, 90, 1000);
  const back = destinationPoint(destinationPoint(B, 180, 10), 270, 1000);
  const line = prepareLine([A, B, destinationPoint(B, 180, 10), back]);
  const gps = destinationPoint(A, 90, 300); // sur l'aller
  const first = locateOnLine(line, gps, 0);
  assert.equal(first.segIndex, 0);
  // Sur le retour, 300 m avant la fin, en venant du segment 2 : on reste sur le retour.
  const gpsBack = destinationPoint(back, 90, 300);
  const second = locateOnLine(line, gpsBack, 2);
  assert.equal(second.segIndex, 2);
  near(second.along, line.total - 300, 1);
});

test('position perdue loin devant : recherche sur tout le tracé', () => {
  const pts = [P];
  for (let i = 1; i <= 40; i += 1) pts.push(destinationPoint(P, 90, i * 200)); // 8 km, au-delà de LOOKAHEAD_M
  const line = prepareLine(pts);
  const far = destinationPoint(P, 90, 7000);
  const loc = locateOnLine(line, far, 0);
  near(loc.along, 7000, 1);
});

test('point et cap à une distance donnée', () => {
  const B = destinationPoint(P, 90, 500);
  const line = prepareLine([P, B, destinationPoint(B, 180, 500)]);
  const a = pointAt(line, 250);
  near(haversine(a.point, destinationPoint(P, 90, 250)), 0, 0.5);
  near(a.bearing, 90, 0.1);
  near(pointAt(line, 750).bearing, 180, 0.1);
  assert.equal(segmentAt(line, -5), 0);
  assert.equal(segmentAt(line, 1e9), 1);
  near(haversine(pointAt(line, 1e9).point, line.coords[2]), 0, 0.01);
});

test('cap d\'un segment de longueur nulle : celui du suivant', () => {
  const B = destinationPoint(P, 90, 500);
  const line = prepareLine([P, P, B]);
  near(segmentBearing(line, 0), 90, 0.1);
});
