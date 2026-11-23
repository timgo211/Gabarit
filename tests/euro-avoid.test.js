// v48 : « Éviter le tunnel » pour une classe Euro interdite (Mont-Blanc, Fréjus ; phase 5g), comme le bouton ADR de la
// phase 5b : carré de 80 m au milieu du tube (avoid_polygons), 150 km à vol d'oiseau au plus (au-delà : rien envoyé,
// « à vérifier »), à l'arrêt seulement (vitesse inconnue = en mouvement), même budget de 3 requêtes et mêmes
// diagnostics d'échec que le départ (2f). Fixtures ors-directions-mont-blanc.json et ors-directions-frejus.json.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { euroTunnelsAlongRoute, euroRules } from '../src/lib/euro.js';
import { routeRules, avoidableTunnels } from '../src/lib/route-rules.js';
import { ADR, avoidTunnelsFor, avoidTunnelAllowed, AVOID_PARKED_TEXT, KNOWN_TUNNELS } from '../src/lib/adr.js';
import { computeAvoidRoute, ROUTE_OPTIONS, START_NO_EXIT_TEXT } from '../src/lib/route-options.js';
import { classifyError } from '../src/lib/ors-errors.js';
import { fixSpeedKmh, parkedState } from '../src/lib/nav-layout.js';
import { haversine } from '../src/lib/nav-geo.js';

const mb = () => parseDirections(fixture('ors-directions-mont-blanc.json'));
const fr = () => parseDirections(fixture('ors-directions-frejus.json'));
const semi = (euroClass = '', patch = {}) => ({ name: 'Semi', weight: 44, height: 4, critair: '2', banStatus: 'concerned', euroClass, ...patch });
const ends = (r) => ({ start: r.coordinates[0], end: r.coordinates.at(-1) });

test('passage Euro : milieu du tube sur le tracé (mid), dans le tube du Mont-Blanc', () => {
  const [p] = euroTunnelsAlongRoute(mb());
  assert.equal(p.mid.length, 2);
  const tube = KNOWN_TUNNELS.find((t) => t.id === 'known:montblanc').tubes[0];
  const near = Math.min(...tube.map((q) => haversine(q, p.mid)));
  assert.ok(near < 8000, `milieu à ${Math.round(near)} m d'un point du tube`);
});

test('tunnels à éviter : Euro interdit (texte officiel ou exploitant) seulement ; admis, non précisé : aucun', () => {
  const at = (route, cls) => routeRules(route, { vehicle: semi(cls) }).avoidableTunnels;
  for (const c of ['0', '3', '4']) assert.deepEqual(at(mb(), c).map((p) => p.id), ['known:montblanc'], `Mont-Blanc Euro ${c}`);
  for (const c of ['5', 'EEV', '6', '']) assert.equal(at(mb(), c).length, 0, `Mont-Blanc Euro « ${c} »`);
  assert.equal(at(fr(), '2').length, 1, 'Fréjus Euro 2 : arrêté');
  assert.deepEqual(at(fr(), '4')[0].why, ['euro'], 'Fréjus Euro 4 : exploitant (SFTRF)');
  assert.equal(at(fr(), '5').length, 0);
  assert.equal(routeRules(mb(), { vehicle: semi('3', { weight: 3.5 }) }).avoidableTunnels.length, 0, 'PTAC ≤ 3,5 t : non concerné');
});

test('ADR et Euro sur le même tunnel : un seul carré, deux raisons', () => {
  const adr = [{ id: 'known:montblanc', name: 'Tunnel du Mont-Blanc', mid: [6.9, 45.86], forbidden: true }];
  const euro = euroRules(mb(), { vehicle: semi('3') }).passages;
  const list = avoidableTunnels(adr, euro);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].why, ['adr', 'euro']);
  assert.equal(avoidableTunnels([], euroRules(mb(), { vehicle: semi('') }).passages).length, 0, 'classe non précisée');
});

test('carré de 80 m au milieu du tube, ajouté aux zones déjà évitées', () => {
  const route = mb();
  const list = routeRules(route, { vehicle: semi('3') }).avoidableTunnels;
  const zfe = { type: 'Polygon', coordinates: [[[1, 1], [2, 1], [2, 2], [1, 1]]] };
  const plan = avoidTunnelsFor(list, { ...ends(route), existing: zfe });
  assert.equal(plan.ok, true);
  assert.equal(plan.geometry.type, 'MultiPolygon');
  assert.equal(plan.geometry.coordinates.length, 2, 'ZFE + tunnel');
  const sq = plan.geometry.coordinates[1][0];
  assert.equal(sq.length, 5);
  assert.ok(Math.abs(haversine(sq[0], sq[1]) - ADR.AVOID_SQUARE_M) < 2, 'côté de 80 m');
});

test('plus de 150 km à vol d\'oiseau : rien envoyé, « à vérifier »', () => {
  const list = routeRules(mb(), { vehicle: semi('3') }).avoidableTunnels;
  const plan = avoidTunnelsFor(list, { start: [2.35, 48.85], end: [7.68, 45.07] });
  assert.equal(plan.ok, false);
  assert.match(plan.text, /150 km/);
  assert.match(plan.text, /rien n'a été envoyé : à vérifier/);
  assert.match(plan.text, /signalisation fait foi/);
});

test('à l\'arrêt seulement : vitesse inconnue = en mouvement, jamais en guidage', () => {
  assert.equal(avoidTunnelAllowed({ guiding: false, parked: true }), true);
  assert.equal(avoidTunnelAllowed({ guiding: false, parked: false }), false);
  assert.equal(avoidTunnelAllowed({ guiding: true, parked: true }), false);
  assert.equal(avoidTunnelAllowed({}), false);
  assert.match(AVOID_PARKED_TEXT, /à l'arrêt seulement/);
});

test('vitesse hors guidage : GPS, sinon déduite de deux relevés fiables ; inconnue → jamais à l\'arrêt', () => {
  const a = { lonlat: [6.9, 45.9], t: 0, accuracy: 10 };
  assert.equal(fixSpeedKmh(null, { ...a, speed: 0 }), 0);
  assert.equal(fixSpeedKmh(null, { ...a, speed: 10 }), 36);
  assert.equal(fixSpeedKmh(null, a), null, 'premier relevé sans vitesse');
  assert.ok(fixSpeedKmh(a, { lonlat: [6.9, 45.9], t: 2000, accuracy: 10, speed: null }) < 0.01, 'même point → 0');
  assert.equal(fixSpeedKmh(a, { lonlat: [6.9, 45.9], t: 2000, accuracy: 200 }), null, 'précision trop faible');
  assert.equal(fixSpeedKmh(a, { lonlat: [6.9, 45.9], t: 60000, accuracy: 10 }), null, 'relevés trop espacés');
  // Compteur de relevés (pas d'horloge) : 0 km/h pendant 3 s → à l'arrêt ; un relevé inconnu → en mouvement.
  let s = null;
  for (const t of [0, 2000, 4000]) s = parkedState(s, 0, t);
  assert.equal(s.parked, true);
  assert.equal(parkedState(s, null, 6000).parked, false);
});

// Même budget et mêmes diagnostics que le départ (computeRouteOptions, phase 2f).
function fakeOrs(respond) {
  const sent = [];
  return { sent, send: async (req) => { sent.push(req); const r = respond(req.body); if (r instanceof Error) throw r; return structuredClone(r); } };
}
const err2009 = (name = 'ors-error-2009.json') => {
  const c = classifyError({ status: 404, body: fixture(name) });
  return Object.assign(new Error(c.message), { kind: c.kind, code: c.code, status: 404, detail: c.detail });
};

test('contournement : une requête avec la zone évitée, réglages de l\'itinéraire choisi', async () => {
  const route = mb();
  const plan = avoidTunnelsFor(routeRules(route, { vehicle: semi('3') }).avoidableTunnels, ends(route));
  const ors = fakeOrs(() => fixture('ors-directions-mont-blanc.json'));
  const out = await computeAvoidRoute({
    ...ends(route), vehicle: semi('3'), avoidTolls: true, preference: 'shortest', avoidPolygons: plan.geometry, send: ors.send,
  });
  assert.equal(out.requests, 1);
  assert.equal(ors.sent.length, 1);
  const b = ors.sent[0].body;
  assert.deepEqual(b.options.avoid_polygons, plan.geometry);
  assert.equal(b.preference, 'shortest');
  assert.ok(b.options.avoid_features.includes('tollways'));
  assert.equal(b.alternative_routes, undefined);
  assert.ok(Array.isArray(out.route.coordinates));
});

test('contournement en 2009 : diagnostics du départ dans le budget de 3 requêtes, message au conditionnel', async () => {
  const route = mb();
  const plan = avoidTunnelsFor(routeRules(route, { vehicle: semi('3') }).avoidableTunnels, ends(route));
  const { start, end } = ends(route);
  const isReverse = (b) => b.coordinates.length === 2 && b.coordinates[0][0] === end[0];
  const ors = fakeOrs((b) => (isReverse(b) ? fixture('ors-directions-mont-blanc.json') : err2009()));
  await assert.rejects(computeAvoidRoute({ start, end, vehicle: semi('3'), avoidPolygons: plan.geometry, send: ors.send }), (err) => {
    assert.equal(err.code, 2009);
    assert.equal(err.hint, 'start-no-exit');
    assert.ok(err.message.includes(START_NO_EXIT_TEXT));
    return true;
  });
  assert.ok(ors.sent.length <= ROUTE_OPTIONS.MAX_REQUESTS);
  assert.deepEqual(ors.sent[1].body.options.avoid_polygons, plan.geometry, 'diagnostic avec la même zone évitée');
});

test('contournement en 2009 partout : 3 requêtes au plus, aucun itinéraire rendu', async () => {
  const route = mb();
  const ors = fakeOrs(() => err2009());
  await assert.rejects(computeAvoidRoute({ ...ends(route), vehicle: semi('3'), send: ors.send }), (err) => err.code === 2009);
  assert.ok(ors.sent.length <= ROUTE_OPTIONS.MAX_REQUESTS, `${ors.sent.length} requêtes`);
});
