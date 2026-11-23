// v57 : limite déduite d'une règle générale (pas d'une étiquette OSM). Hors autoroute (80 des nationales, 60 articulé)
// la règle est ambiguë : compteur jamais rouge (bord pointillé neutre), jamais dite. Sur autoroute (90, 80 ADR > 12 t)
// elle est sans ambiguïté : rouge comme une étiquette OSM. Panneau et mention « règle » inchangés.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wayLimit, limitAt } from '../src/lib/speed-limit.js';
import { speedStatus } from '../src/lib/nav-layout.js';
import { startNavigation, updateNavigation } from '../src/lib/navigation.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { createSimulator } from '../src/lib/nav-sim.js';
import { fixture } from './helpers.js';

const TEST_FR = Object.freeze({
  verified: '2026-11-23',
  source: 'test',
  bands: [
    { over: 3.5, upTo: 12, trailer: 'any', motorway: 90, express: 80, road: 80 },
    { over: 12, upTo: null, trailer: 'none', motorway: 90, express: 80, road: 80 },
    { over: 12, upTo: null, trailer: 'with', motorway: 90, express: 60, road: 60 },
  ],
  adr: { over: 12, motorway: 80, express: 60, road: 60 },
});
const truck = { weight: 44 };

test('règle générale : ambiguë hors autoroute, sans ambiguïté sur autoroute', () => {
  const motorway = wayLimit({ limit: 130, hgv: false, cond: false, cls: 0 }, 'FR', truck, null, TEST_FR);
  assert.deepEqual(motorway, { kmh: 90, source: 'rule', cond: false, ambiguous: false });
  const adr = wayLimit({ limit: 130, hgv: false, cond: false, cls: 0 }, 'FR', { weight: 44, hazmat: true }, null, TEST_FR);
  assert.equal(adr.kmh, 80);
  assert.equal(adr.ambiguous, false, '80 ADR sur autoroute : sans ambiguïté');
  const road = wayLimit({ limit: 90, hgv: false, cond: false, cls: 2 }, 'FR', truck, null, TEST_FR);
  assert.equal(road.source, 'rule');
  assert.equal(road.ambiguous, true, '80 hors autoroute : ambiguë');
  const osm = wayLimit({ limit: 50, hgv: false, cond: false, cls: 2 }, 'FR', truck, null, TEST_FR);
  assert.deepEqual(osm, { kmh: 50, source: 'osm', cond: false }, 'étiquette OSM sous la règle : inchangée');
  const lim = limitAt({ intervals: [{ from: 0, to: 100, kmh: 80, source: 'rule', cond: false, ambiguous: true }] }, 50).limit;
  assert.equal(lim.ambiguous, true);
});

test('compteur : jamais rouge pour une règle ambiguë, rouge sinon', () => {
  assert.deepEqual(speedStatus(95, 80, 'rule', true), { value: '95', limit: 80, over: false, overRule: true, rule: true });
  assert.deepEqual(speedStatus(95, 90, 'rule', false), { value: '95', limit: 90, over: true, overRule: false, rule: true });
  assert.equal(speedStatus(95, 80, 'osm', true).over, true, 'étiquette OSM : rouge (ambiguous ignoré)');
  assert.equal(speedStatus(75, 80, 'rule', true).overRule, false, 'sous la limite : rien');
  assert.equal(speedStatus(95, 80, 'rule').over, true, 'ancien appel sans drapeau : comportement v51');
});

test('guidage : règle ambiguë passée dans la vue, jamais dite (même avec « Limite X » activé)', () => {
  const route = parseDirections(fixture('ors-directions-nav.json'));
  const T0 = 1_800_000_000_000;
  let s = startNavigation(route, { now: T0, speeds: { data: null, voice: true } });
  s = { ...s, speedCtx: { data: null, voice: true }, speedLimits: { intervals: [{ from: 0, to: 1e6, kmh: 30, source: 'rule', cond: false, ambiguous: true }] } };
  const sim = createSimulator(route.coordinates, { speedKmh: 50 });
  const said = [];
  let view = null;
  for (let k = 0; k <= 40; k += 1) {
    const r = updateNavigation(s, sim.next(T0 + k * 1000));
    s = r.state;
    view = r.view ?? view;
    said.push(...r.events.filter((e) => e.type === 'speak').map((e) => e.text));
  }
  assert.equal(view.speedLimitAmbiguous, true);
  assert.equal(view.speedLimitSource, 'rule');
  assert.ok(!said.some((t) => /Limite/.test(t)), said.join(' | '));
  const st = speedStatus(view.speedKmh, view.speedLimit, view.speedLimitSource, view.speedLimitAmbiguous);
  assert.equal(st.over, false);
  assert.equal(st.overRule, true);
});
