// Itinéraires alternatifs (phase 2b) : requêtes envoyées, budget de 3 requêtes, doublons, noms, écarts, fiches.
// Aucune requête réseau : `send` est simulé et répond avec des fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRouteOptions, planVariants, wantsAlternatives, sharedShare, isNearDuplicate, dedupeOptions, nameAlternatives,
  describeOption, deltaText, failureText, guidanceParams, reroutedOption, noZfeOption, routesBbox, pickRouteAt, requestFor,
  VARIANTS, ROUTE_OPTIONS, diagnose2009, RESTRICTION_HINT_TEXT, DEAD_END_HINT_TEXT, START_NO_EXIT_TEXT, START_UNREACHABLE_TEXT,
  END_UNREACHABLE_TEXT,
} from '../src/lib/route-options.js';
import { destinationPoint } from '../src/lib/nav-geo.js';
import { ERROR_KINDS, classifyError } from '../src/lib/ors-errors.js';
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

const assertRestrictions = { height: 4, width: 2.55, length: 16.5, weight: 44, axleload: 11.5, hazmat: true };

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

// Phases 5h ter et 2f : code 2009 → diagnostic (sens inverse, point de passage, sans restrictions), 3 requêtes au plus.
const METZ = [6.17963, 49.11516]; // centre de Metz renvoyé par le géocodage (tablette v35 à v37)
const NANCY = [6.17829, 48.6903];
const err2009 = (name = 'ors-error-2009.json') => {
  const c = classifyError({ status: 404, body: fixture(name) });
  return Object.assign(new Error(c.message), { kind: c.kind, code: c.code, status: 404, detail: c.detail });
};
const error2009 = () => err2009();
const isReverse = (b, start) => b.coordinates.length === 2 && b.coordinates[1][0] === start[0] && b.coordinates[1][1] === start[1];
const isVia = (b) => b.coordinates.length === 3;

test('phase 2f : Metz → Nancy en 2009, Nancy → Metz passe → « le départ semble sans sortie »', async () => {
  const ors = fakeOrs((b) => (isReverse(b, METZ) ? fixture('ors-variant-recommended.json') : err2009('ors-error-2009-metz.json')));
  await assert.rejects(computeRouteOptions({ start: METZ, end: NANCY, vehicle, send: ors.send }), (err) => {
    assert.equal(err.code, 2009);
    assert.equal(err.hint, 'start-no-exit');
    assert.equal(err.restrictionHint, false);
    assert.ok(err.message.startsWith('Aucun itinéraire autorisé pour ce gabarit.'));
    assert.ok(err.message.endsWith(START_NO_EXIT_TEXT));
    return true;
  });
  assert.equal(ors.sent.length, 2, 'Recommandé (alternative_routes) + sens inverse');
  const back = ors.sent[1].body;
  assert.deepEqual(back.coordinates, [NANCY, METZ]);
  assert.equal(back.alternative_routes, undefined);
  assertTruckRequest(ors.sent[1], { avoidFerries: false });
  assert.equal(START_NO_EXIT_TEXT, 'Le départ semble sans sortie pour un camion (sens unique, zone piétonne, sortie interdite) : le trajet inverse passe. Pose le départ sur une route voisine plus large (appui long). La signalisation fait foi.');
});

test('phase 2f : aller et retour en 2009, point de passage en échec sur le 2e tronçon → arrivée en cause', async () => {
  const ors = fakeOrs((b) => (isVia(b) ? err2009('ors-error-2009-via-end.json') : err2009('ors-error-2009-metz.json')));
  await assert.rejects(computeRouteOptions({ start: METZ, end: NANCY, vehicle, send: ors.send }), (err) => {
    assert.equal(err.hint, 'end-unreachable');
    assert.ok(err.message.endsWith(END_UNREACHABLE_TEXT));
    assert.ok(/semble/.test(END_UNREACHABLE_TEXT), 'accroche du point de passage non garantie : conditionnel');
    return true;
  });
  assert.equal(ors.sent.length, ROUTE_OPTIONS.MAX_REQUESTS, 'Recommandé + sens inverse + point de passage');
  const v = ors.sent[2].body;
  assert.equal(v.coordinates.length, 3);
  assert.deepEqual(v.coordinates[0], METZ);
  assert.deepEqual(v.coordinates[2], NANCY);
  assert.ok(Math.abs(v.coordinates[1][1] - (METZ[1] + NANCY[1]) / 2) < 1e-9);
  assert.deepEqual(v.radiuses, [-1, -1, -1], 'un rayon par point, rayon maximal du serveur');
  assert.equal(v.alternative_routes, undefined, 'alternative_routes : 2 points seulement');
  assert.deepEqual(v.options.profile_params.restrictions, assertRestrictions);
});

test('phase 2f : point de passage en échec sur le 1er tronçon → départ en cause (au conditionnel)', async () => {
  const ors = fakeOrs((b) => (isVia(b) ? err2009('ors-error-2009-via-start.json') : err2009('ors-error-2009-metz.json')));
  await assert.rejects(computeRouteOptions({ start: METZ, end: NANCY, vehicle, send: ors.send }), (err) => {
    assert.equal(err.hint, 'start-unreachable');
    assert.ok(err.message.endsWith(START_UNREACHABLE_TEXT));
    return true;
  });
  assert.ok(/^Le départ semble/.test(START_UNREACHABLE_TEXT));
  assert.ok(/limite de gabarit/.test(START_UNREACHABLE_TEXT), 'la restriction réelle n\'est pas masquée');
});

test('phase 2f : point de passage non accroché (2010) → sans restrictions si le budget le permet, sinon sans conclusion', async () => {
  // > 100 km : pas d'alternative_routes, mais Recommandé + sens inverse + point de passage = budget épuisé.
  const p2010 = () => Object.assign(new Error('point'), { kind: ERROR_KINDS.POINT_NOT_FOUND, code: 2010 });
  const ors = fakeOrs((b) => (isVia(b) ? p2010() : error2009()));
  await assert.rejects(computeRouteOptions({ start: LYON, end: CLERMONT, vehicle, send: ors.send }), (err) => {
    assert.equal(err.hint, undefined);
    assert.ok(!err.message.includes('appui long'));
    assert.match(err.diagnosticNote, /sans conclusion/);
    return true;
  });
  assert.equal(ors.sent.length, 3);
  // Profil sans restriction : la requête d'origine valait le diagnostic sans restrictions → « rue sans sortie ».
  const bare = { ...vehicle, height: null, width: null, length: null, weight: null, axleload: null, hazmat: false };
  const none = fakeOrs((b) => (isVia(b) ? fixture('ors-variant-recommended.json') : error2009()));
  await assert.rejects(computeRouteOptions({ start: LYON, end: CLERMONT, vehicle: bare, send: none.send }), (err) => err.hint === 'dead-end' && err.message.endsWith(DEAD_END_HINT_TEXT));
  assert.equal(none.sent.length, 3);
});

test('code 2009 : étape (c) sans restrictions, atteinte seulement s\'il reste une requête', async () => {
  // Dans un calcul, Recommandé + sens inverse + point de passage prennent les 3 requêtes : jamais de 4e.
  for (const respond of [() => error2009(), (b) => (isVia(b) ? fixture('ors-variant-recommended.json') : error2009())]) {
    const ors = fakeOrs(respond);
    await assert.rejects(computeRouteOptions({ start: METZ, end: NANCY, vehicle, send: ors.send }));
    assert.equal(ors.sent.length, ROUTE_OPTIONS.MAX_REQUESTS);
    assert.equal(ors.sent.filter((r) => !r.body.options.profile_params).length, 0);
  }
  // Diagnostic seul (aucune requête déjà faite) : point de passage sans conclusion → sans restrictions.
  const run = async (bareResponse) => {
    const err = error2009();
    const ors = fakeOrs((b) => {
      if (!b.options.profile_params) return bareResponse();
      return isVia(b) ? fixture('ors-variant-recommended.json') : error2009();
    });
    const n = await diagnose2009({ err, start: METZ, end: NANCY, vehicle, send: ors.send, requests: 0 });
    assert.equal(n, 3);
    assert.equal(ors.sent[2].body.options.profile_params, undefined);
    assert.equal(ors.sent[2].body.radiuses, undefined);
    return err;
  };
  const limit = await run(() => fixture('ors-variant-recommended.json'));
  assert.equal(limit.restrictionHint, true);
  assert.ok(limit.message.endsWith(RESTRICTION_HINT_TEXT));
  const dead = await run(() => error2009());
  assert.equal(dead.hint, 'dead-end');
  assert.ok(dead.message.endsWith(DEAD_END_HINT_TEXT));
  assert.equal(RESTRICTION_HINT_TEXT, 'Départ ou arrivée peut-être joignable seulement en franchissant une limite de poids, hauteur ou largeur de ton profil. Essaie un point plus accessible (appui long). La signalisation fait foi.');
  assert.equal(DEAD_END_HINT_TEXT, 'Départ ou arrivée peut-être dans une rue sans sortie possible pour le camion (sens unique, zone piétonne). Essaie un point plus accessible (appui long). La signalisation fait foi.');
});

test('code 2009 : diagnostic en 429 (ou réseau) → texte d\'origine conservé, raison dans la ligne technique', async () => {
  const quota = fakeOrs((b) => (isReverse(b, METZ) ? apiError(ERROR_KINDS.QUOTA) : err2009('ors-error-2009-metz.json')));
  await assert.rejects(computeRouteOptions({ start: METZ, end: NANCY, vehicle, send: quota.send }), (err) => {
    assert.equal(err.hint, undefined);
    assert.equal(err.message, "Aucun itinéraire autorisé pour ce gabarit. Essaie d'autoriser péages/ferries ou vérifie le profil véhicule.");
    assert.equal(err.diagnosticNote, 'Diagnostic interrompu : trop de demandes en une minute.');
    return true;
  });
  assert.equal(quota.sent.length, 2, 'diagnostic arrêté au premier échec');
  const viaQuota = fakeOrs((b) => (isVia(b) ? apiError(ERROR_KINDS.OFFLINE) : error2009()));
  await assert.rejects(computeRouteOptions({ start: LYON, end: CLERMONT, vehicle, send: viaQuota.send }), (err) => !err.hint && err.diagnosticNote === 'Diagnostic interrompu : pas de réseau.');
  const other = fakeOrs((b) => (b.options.profile_params ? apiError(ERROR_KINDS.NO_ROUTE) : fixture('ors-variant-recommended.json')));
  await assert.rejects(computeRouteOptions({ start: LYON, end: CLERMONT, vehicle, send: other.send }), (err) => !err.hint);
  assert.equal(other.sent.length, 1, 'sans code 2009 (404 sans code, réponse vide) : pas de diagnostic');
});
