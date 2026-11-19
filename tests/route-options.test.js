// Itinéraires alternatifs (phase 2b) : requêtes envoyées, budget de 3 requêtes, doublons, noms, écarts, fiches.
// Aucune requête réseau : `send` est simulé et répond avec des fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRouteOptions, planVariants, wantsAlternatives, sharedShare, isNearDuplicate, dedupeOptions, nameAlternatives,
  describeOption, deltaText, failureText, guidanceParams, reroutedOption, noZfeOption, routesBbox, pickRouteAt, requestFor,
  VARIANTS, ROUTE_OPTIONS,
} from '../src/lib/route-options.js';
import { destinationPoint } from '../src/lib/nav-geo.js';
import { ERROR_KINDS } from '../src/lib/ors-errors.js';
import { defaultVehicle } from '../src/lib/vehicle.js';
import { fixture } from './helpers.js';

const LYON = [4.8357, 45.764];
const VILLEFRANCHE = [4.718, 45.989]; // ≈ 27 km à vol d'oiseau
const CLERMONT = [3.087, 45.7772]; // ≈ 136 km à vol d'oiseau
const vehicle = { ...defaultVehicle(), hazmat: true };

const apiError = (kind) => Object.assign(new Error(`échec ${kind}`), { kind });

/** Faux ORS : `respond(body)` renvoie un JSON (fixture) ou une Error ; garde la trace des requêtes. */
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

const avoidsTolls = (body) => (body.options.avoid_features ?? []).includes('tollways');

/** Réponses habituelles selon la requête. */
function standard(body, { main = null } = {}) {
  if (body.alternative_routes) return main ?? fixture('ors-directions-alternatives.json');
  if (body.preference === 'shortest') return fixture('ors-variant-shortest.json');
  if (body.preference === 'fastest') return fixture('ors-variant-no-toll.json');
  if (avoidsTolls(body)) return fixture('ors-variant-no-toll.json');
  return main ?? fixture('ors-variant-recommended.json');
}

function assertTruckRequest(req, { avoidFerries = false } = {}) {
  assert.equal(req.url, 'https://api.heigit.org/openrouteservice/v2/directions/driving-hgv/geojson');
  assert.equal(req.body.options.vehicle_type, 'hgv');
  assert.deepEqual(req.body.options.profile_params.restrictions, {
    height: 4, width: 2.55, length: 16.5, weight: 44, axleload: 11.5, hazmat: true,
  });
  assert.equal(req.body.maximum_speed, 90);
  assert.equal((req.body.options.avoid_features ?? []).includes('ferries'), avoidFerries);
}

test('100 km ou moins à vol d\'oiseau : alternative_routes (limite mesurée comme ORS)', () => {
  assert.equal(ROUTE_OPTIONS.ALTERNATIVES_MAX_CROW_M, 100000);
  assert.equal(wantsAlternatives(LYON, VILLEFRANCHE), true);
  assert.equal(wantsAlternatives(LYON, CLERMONT), false);
  assert.equal(wantsAlternatives(LYON, destinationPoint(LYON, 90, 99900)), true);
  assert.equal(wantsAlternatives(LYON, destinationPoint(LYON, 90, 100100)), false);
});

test('≤ 100 km, ORS renvoie 3 alternatives : une seule requête, 3 fiches', async () => {
  const ors = fakeOrs((b) => standard(b));
  const r = await computeRouteOptions({ start: LYON, end: VILLEFRANCHE, vehicle, avoidFerries: true, send: ors.send });
  assert.equal(r.requests, 1);
  assert.equal(ors.sent.length, 1);
  assertTruckRequest(ors.sent[0], { avoidFerries: true });
  assert.deepEqual(ors.sent[0].body.alternative_routes, { target_count: 3 });
  assert.equal(ors.sent[0].body.preference, undefined, 'Recommandé = préférence par défaut d\'ORS');
  assert.deepEqual(r.options.map((o) => o.label), ['Recommandé', 'Alternative 2', 'Alternative 3']);
  assert.deepEqual(r.options.map((o) => o.route.distance), [33412.6, 31205, 36880.4]);
  assert.deepEqual(r.options.map((o) => o.route.tollDistance), [21450, 0, 0]);
  assert.deepEqual(r.failures, []);
  // Recalcul d'une alternative : celui du Recommandé.
  assert.deepEqual(r.options[1].request, { preference: null, avoidTolls: false });
  assert.equal(deltaText(r.options[1].route, r.options[0].route), '+7 min, −2,2 km');
  assert.equal(deltaText(r.options[2].route, r.options[0].route), '+10 min, +3,5 km');
});

test('≤ 100 km, ORS ne renvoie qu\'un itinéraire : Plus court et Sans péage en plus (3 requêtes)', async () => {
  const ors = fakeOrs((b) => standard(b, { main: fixture('ors-directions.json') }));
  const r = await computeRouteOptions({ start: LYON, end: VILLEFRANCHE, vehicle, send: ors.send });
  assert.equal(r.requests, 3);
  assert.equal(ors.sent.length, 3);
  for (const req of ors.sent) assertTruckRequest(req);
  assert.deepEqual(ors.sent[0].body.alternative_routes, { target_count: 3 });
  const [, shortest, noToll] = ors.sent.map((q) => q.body);
  assert.equal(shortest.preference, 'shortest');
  assert.equal(shortest.alternative_routes, undefined);
  assert.equal(avoidsTolls(shortest), false);
  assert.deepEqual(noToll.options.avoid_features, ['tollways']);
  assert.equal(noToll.preference, undefined);
  assert.deepEqual(r.options.map((o) => o.label), ['Recommandé', 'Plus court', 'Sans péage']);
  assert.equal(r.options[1].note, 'Peut emprunter des routes secondaires');
  assert.equal(r.options[0].note, '');
});

test('> 100 km : Recommandé, Plus court et Sans péage ; deux identiques → une seule fiche', async () => {
  const ors = fakeOrs((b) => standard(b));
  const r = await computeRouteOptions({ start: LYON, end: CLERMONT, vehicle, send: ors.send });
  assert.equal(r.requests, 3);
  assert.equal(ors.sent[0].body.alternative_routes, undefined, 'pas d\'alternative_routes au-delà de 100 km');
  assert.equal(ors.sent[0].body.preference, undefined);
  assert.deepEqual(ors.sent.slice(1).map((q) => [q.body.preference ?? null, avoidsTolls(q.body)]), [['shortest', false], [null, true]]);
  // « Plus court » = même tracé que le Recommandé : doublon supprimé, signalé sur la fiche gardée.
  assert.deepEqual(r.options.map((o) => o.label), ['Recommandé', 'Sans péage']);
  assert.deepEqual(r.options[0].also, ['Plus court']);
  assert.deepEqual(r.options[1].request, { preference: null, avoidTolls: true });
  assert.equal(deltaText(r.options[1].route, r.options[0].route), '+35 min, +6,3 km');
});

test('péages déjà évités : « Plus rapide » remplace « Sans péage », péages évités partout', async () => {
  const ors = fakeOrs((b) => standard(b));
  const r = await computeRouteOptions({ start: LYON, end: CLERMONT, vehicle, avoidTolls: true, send: ors.send });
  assert.equal(ors.sent.length, 3);
  for (const q of ors.sent) assert.deepEqual(q.body.options.avoid_features, ['tollways']);
  assert.deepEqual(ors.sent.map((q) => q.body.preference ?? null), [null, 'shortest', 'fastest']);
  assert.ok(r.options.every((o) => o.key !== 'no-toll'));
  assert.ok(r.options.every((o) => o.request.avoidTolls));
});

test('Recommandé sans péage : « Plus rapide » au lieu de « Sans péage »', async () => {
  assert.deepEqual(planVariants({ reference: { tollDistance: 0 }, budget: 2 }).map((v) => v.key), ['shortest', 'fastest']);
  assert.deepEqual(planVariants({ reference: { tollDistance: 12000 }, budget: 2 }).map((v) => v.key), ['shortest', 'no-toll']);
  assert.deepEqual(planVariants({ reference: { tollDistance: null }, budget: 2 }).map((v) => v.key), ['shortest', 'no-toll'],
    'péage inconnu : « Sans péage » peut servir');
  assert.deepEqual(planVariants({ avoidTolls: true, reference: { tollDistance: 9000 }, budget: 2 }).map((v) => v.key), ['shortest', 'fastest']);
  assert.deepEqual(planVariants({ reference: null, budget: 1 }).map((v) => v.key), ['shortest']);
  assert.deepEqual(planVariants({ reference: null, budget: 0 }), []);

  const ors = fakeOrs((b) => standard(b, { main: fixture('ors-variant-no-toll.json') }));
  const r = await computeRouteOptions({ start: LYON, end: CLERMONT, vehicle, send: ors.send });
  assert.deepEqual(ors.sent.map((q) => q.body.preference ?? null), [null, 'shortest', 'fastest']);
  assert.ok(ors.sent.every((q) => !avoidsTolls(q.body)));
  assert.ok(r.requests <= 3);
});

test('alternative_routes refusé (2004) : Recommandé redemandé sans, puis une seule variante (3 requêtes max)', async () => {
  const ors = fakeOrs((b) => (b.alternative_routes ? apiError(ERROR_KINDS.TOO_FAR) : standard(b, { main: fixture('ors-directions.json') })));
  const r = await computeRouteOptions({ start: LYON, end: VILLEFRANCHE, vehicle, send: ors.send });
  assert.equal(r.requests, 3);
  assert.deepEqual(ors.sent.map((q) => [!!q.body.alternative_routes, q.body.preference ?? null]),
    [[true, null], [false, null], [false, 'shortest']]);
  assert.deepEqual(r.options.map((o) => o.label), ['Recommandé', 'Plus court']);
});

test('jamais plus de 3 requêtes, quel que soit le scénario', async () => {
  const scenarios = [
    [LYON, VILLEFRANCHE, (b) => standard(b)],
    [LYON, VILLEFRANCHE, (b) => standard(b, { main: fixture('ors-directions.json') })],
    [LYON, VILLEFRANCHE, (b) => (b.alternative_routes ? apiError(ERROR_KINDS.SERVER) : standard(b))],
    [LYON, CLERMONT, (b) => standard(b)],
    [LYON, CLERMONT, (b) => (b.preference ? apiError(ERROR_KINDS.SERVER) : standard(b))],
  ];
  for (const avoidTolls of [false, true]) {
    for (const [start, end, respond] of scenarios) {
      const ors = fakeOrs(respond);
      const r = await computeRouteOptions({ start, end, vehicle, avoidTolls, send: ors.send });
      assert.ok(ors.sent.length <= ROUTE_OPTIONS.MAX_REQUESTS, `${ors.sent.length} requêtes`);
      assert.equal(r.requests, ors.sent.length);
      assert.equal(r.options[0].key, 'recommended', 'le Recommandé reste la référence');
    }
  }
});

test('quota du jour atteint au Recommandé : erreur relancée (message existant), aucune autre requête', async () => {
  for (const end of [VILLEFRANCHE, CLERMONT]) {
    const ors = fakeOrs(() => apiError(ERROR_KINDS.DAILY_QUOTA));
    await assert.rejects(computeRouteOptions({ start: LYON, end, vehicle, send: ors.send }), (err) => err.kind === ERROR_KINDS.DAILY_QUOTA);
    assert.equal(ors.sent.length, 1);
  }
});

test('clé refusée, aucun itinéraire, réseau : pas de nouvel essai', async () => {
  for (const kind of [ERROR_KINDS.INVALID_KEY, ERROR_KINDS.KEY_OR_QUOTA, ERROR_KINDS.NO_ROUTE, ERROR_KINDS.NETWORK, ERROR_KINDS.QUOTA]) {
    const ors = fakeOrs(() => apiError(kind));
    await assert.rejects(computeRouteOptions({ start: LYON, end: VILLEFRANCHE, vehicle, send: ors.send }), (err) => err.kind === kind);
    assert.equal(ors.sent.length, 1, kind);
  }
  const empty = fakeOrs(() => ({ type: 'FeatureCollection', features: [] }));
  await assert.rejects(computeRouteOptions({ start: LYON, end: CLERMONT, vehicle, send: empty.send }), { name: 'NoRouteError' });
});

test('une variante échoue : les autres sont gardées, l\'échec est signalé discrètement', async () => {
  const ors = fakeOrs((b) => (avoidsTolls(b) ? apiError(ERROR_KINDS.DAILY_QUOTA) : standard(b, { main: fixture('ors-directions.json') })));
  const r = await computeRouteOptions({ start: LYON, end: VILLEFRANCHE, vehicle, send: ors.send });
  assert.deepEqual(r.options.map((o) => o.label), ['Recommandé', 'Plus court']);
  assert.deepEqual(r.failures, [{ key: 'no-toll', label: 'Sans péage', kind: ERROR_KINDS.DAILY_QUOTA }]);
  assert.equal(failureText(r.failures[0]), '« Sans péage » non calculé : quota du jour atteint.');

  const none = fakeOrs((b) => (b.preference || avoidsTolls(b) ? { type: 'FeatureCollection', features: [] } : standard(b)));
  const r2 = await computeRouteOptions({ start: LYON, end: CLERMONT, vehicle, send: none.send });
  assert.deepEqual(r2.options.map((o) => o.label), ['Recommandé']);
  assert.deepEqual(r2.failures.map((f) => [f.label, f.kind]), [['Plus court', 'no-route'], ['Sans péage', 'no-route']]);
  assert.equal(failureText(r2.failures[0]), '« Plus court » non calculé : aucun itinéraire autorisé pour ce gabarit.');
  assert.equal(failureText({ label: 'Plus rapide', kind: 'server' }), '« Plus rapide » non calculé : erreur du service.');
});

// Tracé de test : 200 points espacés de 1 km plein est depuis Lyon.
function straight(n = 201, stepM = 1000) {
  const out = [LYON];
  for (let i = 1; i < n; i += 1) out.push(destinationPoint(out[i - 1], 90, stepM));
  return out.map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))]);
}
const asRoute = (coordinates, tollDistance = 0) => ({ coordinates, tollDistance, distance: 0, duration: 0 });

test('doublons : tracé identique, ou presque (petit écart local)', () => {
  const a = straight();
  assert.equal(sharedShare(a, a), 1);
  assert.equal(isNearDuplicate(asRoute(a), asRoute(a.map((p) => [...p]))), true);
  // Un point déplacé de 300 m : 2 km sur 200 km diffèrent (1 %) → quasi identique.
  const b = a.map((p, i) => (i === 100 ? destinationPoint(p, 0, 300) : p));
  assert.ok(Math.abs(sharedShare(a, b) - 0.99) < 0.001);
  assert.equal(isNearDuplicate(asRoute(a), asRoute(b)), true);
  // 10 km différents sur 200 km (5 %) → deux vrais choix.
  const c = a.map((p, i) => (i >= 100 && i < 109 ? destinationPoint(p, 0, 2000) : p));
  assert.equal(isNearDuplicate(asRoute(a), asRoute(c)), false);
  // Même tracé mais un détour d'un côté seulement : l'écart compte dans les deux sens.
  const detour = [...a.slice(0, 101), ...[1, 2, 3, 4, 5, 6].map((k) => destinationPoint(a[100], 0, k * 1000)), ...a.slice(100)];
  assert.equal(sharedShare(a, detour), 1);
  assert.equal(isNearDuplicate(asRoute(a), asRoute(detour)), false);
});

test('doublons : un écart de péage de plus d\'1 km garde les deux fiches', () => {
  const a = straight();
  assert.equal(isNearDuplicate(asRoute(a, 40000), asRoute(a, 40800)), true);
  assert.equal(isNearDuplicate(asRoute(a, 40000), asRoute(a, 38000)), false);
  assert.equal(isNearDuplicate(asRoute(a, null), asRoute(a, 38000)), true, 'péage inconnu : seul le tracé compte');
});

test('dedupeOptions garde le premier et note les noms des doublons ; alternatives renumérotées', () => {
  const a = straight();
  const other = a.map((p) => destinationPoint(p, 0, 5000));
  const opt = (variant, coords) => ({ key: variant.key, label: variant.label, note: '', also: [], route: asRoute(coords), request: requestFor(variant) });
  const kept = dedupeOptions([opt(VARIANTS.recommended, a), opt(VARIANTS.alternative, a), opt(VARIANTS.shortest, a), opt(VARIANTS.fastest, other)]);
  assert.deepEqual(kept.map((o) => o.key), ['recommended', 'fastest']);
  assert.deepEqual(kept[0].also, ['Plus court'], 'une simple alternative n\'est pas citée');
  const named = nameAlternatives([opt(VARIANTS.recommended, a), opt(VARIANTS.alternative, other), opt(VARIANTS.alternative, a)]);
  assert.deepEqual(named.map((o) => o.label), ['Recommandé', 'Alternative 2', 'Alternative 3']);
});

test('fiche : durée, distance, arrivée, péage, gazole (litres et coût), écart, mentions', async () => {
  const ors = fakeOrs((b) => standard(b, { main: fixture('ors-directions.json') }));
  const { options } = await computeRouteOptions({ start: LYON, end: CLERMONT, vehicle, send: ors.send });
  const now = new Date(2026, 10, 19, 8, 0);
  const [rec] = options;
  const noToll = options.find((o) => o.key === 'no-toll');
  assert.deepEqual(options.map((o) => o.key), ['recommended', 'shortest', 'no-toll']);
  assert.deepEqual(describeOption(rec, rec, { vehicle, dieselPrice: 1.85, now }), {
    name: 'Recommandé', also: '', note: '', duration: '9 min', distance: '5,2 km', arrival: 'Arrivée : 08:08',
    toll: 'Péage : 3,5 km', fuel: 'Gazole : ≈ 2 L · ≈ 3,1 €', delta: '',
  });
  const shortest = options.find((o) => o.key === 'shortest');
  const d = describeOption(shortest, rec, { vehicle, dieselPrice: null, now });
  assert.equal(d.name, 'Plus court');
  assert.equal(d.note, 'Peut emprunter des routes secondaires');
  assert.equal(d.fuel, 'Gazole : ≈ 53 L', 'sans prix du gazole : litres seulement');
  assert.equal(d.toll, 'Péage : 128 km');
  assert.equal(d.arrival, 'Arrivée : 09:54');
  assert.equal(d.delta, '+1 h 46, +160 km');
  const n = describeOption(noToll, rec, { vehicle: { ...vehicle, consumption: null }, now });
  assert.equal(n.fuel, '');
  assert.equal(n.toll, 'Péage : 0 km');
  const unknownToll = { ...rec, route: { ...rec.route, tollDistance: null }, also: ['Plus rapide'] };
  const u = describeOption(unknownToll, null, { vehicle, now });
  assert.equal(u.toll, 'Péage : inconnu');
  assert.equal(u.also, 'aussi : Plus rapide');
  assert.equal(u.delta, '');
});

test('guidage : le recalcul garde les réglages de la variante choisie', () => {
  const base = { start: LYON, end: CLERMONT, avoidFerries: true };
  const opt = (variant, avoidTolls = false) => ({ request: requestFor(variant, avoidTolls) });
  assert.deepEqual(guidanceParams(opt(VARIANTS.recommended), base),
    { start: LYON, end: CLERMONT, avoidFerries: true, avoidTolls: false, preference: null, avoidPolygons: null });
  assert.equal(guidanceParams(opt(VARIANTS.shortest), base).preference, 'shortest');
  assert.equal(guidanceParams(opt(VARIANTS.noToll), base).avoidTolls, true);
  assert.equal(guidanceParams(opt(VARIANTS.fastest, true), base).avoidTolls, true);
  assert.equal(guidanceParams(opt(VARIANTS.alternative), base).preference, null);
  const route = fixture('ors-directions.json');
  const r = reroutedOption({ request: requestFor(VARIANTS.shortest) }, route);
  assert.equal(r.label, 'Recalculé en route');
  assert.equal(r.request.preference, 'shortest');
  // « Sans ZFE » (phase 5) : mêmes réglages + zones à éviter, gardées au recalcul.
  const zones = { type: 'MultiPolygon', coordinates: [[[[4.8, 45.7], [4.9, 45.7], [4.9, 45.8], [4.8, 45.7]]]] };
  const nz = noZfeOption({ request: requestFor(VARIANTS.shortest) }, route, zones, ['Métropole de Lyon']);
  assert.deepEqual([nz.key, nz.label, nz.note], ['nozfe', 'Sans ZFE', 'Évite : Métropole de Lyon.']);
  assert.equal(guidanceParams(nz, base).avoidPolygons, zones);
  assert.equal(guidanceParams(nz, base).preference, 'shortest');
});

test('carte : emprise commune et tracé touché', () => {
  assert.deepEqual(routesBbox([{ bbox: [1, 2, 3, 4] }, { bbox: [0, 3, 2, 5] }, { coordinates: [[4, 1], [3.5, 1.5]] }]), [0, 1, 4, 5]);
  assert.equal(routesBbox([]), null);
  assert.equal(pickRouteAt([], 0), null);
  assert.equal(pickRouteAt([0], 0), null, 'toucher le tracé déjà choisi ne change rien');
  assert.equal(pickRouteAt([2], 0), 2);
  assert.equal(pickRouteAt([0, 1, 2], 0), 1, 'tronçon commun : on passe au suivant');
  assert.equal(pickRouteAt([0, 1, 2], 2), 0);
  assert.equal(pickRouteAt([1, 1, 0], 1), 0);
});
