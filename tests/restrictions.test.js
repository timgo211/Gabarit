// Phase 12b : Mes restrictions (modèle, validation, export, polygones évités, textes, limite des 150 km d'ORS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RESTR, RESTR_RADIUS_M, validateRestriction, sanitizeRestrictions, addRestriction, updateRestriction, removeRestriction,
  applies, circleRing, restrictionsForTrip, mergeAvoid, avoidedText, restrictionLines, TOO_FAR_TEXT, BLOCKED_TEXT,
  HELP_TEXT, BRIDGE_AVOID_HELP, fromBridge, nearLine, restrictionLabel,
} from '../src/lib/restrictions.js';
import { computeRouteOptions } from '../src/lib/route-options.js';
import { classifyError } from '../src/lib/ors-errors.js';
import { emptyData, exportData, importData } from '../src/lib/store.js';
import { destinationPoint, haversine } from '../src/lib/nav-geo.js';
import { defaultVehicle } from '../src/lib/vehicle.js';
import { bridgeFromFeature, clearanceFromFeature, convertBridges } from '../src/lib/bridges-convert.js';
import { parseBridgeTile, mergeBridgeTiles, bridgesAlongRoute } from '../src/lib/bridge-check.js';
import { parseGeojsonLine } from '../src/lib/areas-osm-data.js';
import { fixture } from './helpers.js';

const now = new Date('2026-11-22T10:00:00Z');
const ids = (() => { let n = 0; return () => `r-test-${(n += 1)}`; })();
const semi = { ...defaultVehicle(), height: 4, weight: 44 };
const METZ = [6.17963, 49.11516];
const NANCY = [6.17829, 48.6903];

test('constantes : rayon 30 m, bornes de saisie, 150 km', () => {
  assert.equal(RESTR_RADIUS_M, 30);
  assert.equal(RESTR.MAX_DISTANCE_M, 150000);
  assert.deepEqual(RESTR.TYPES, ['height', 'weight', 'avoid']);
  assert.match(HELP_TEXT, /150 km ou moins à vol d'oiseau \(limite d'OpenRouteService\)/);
  assert.match(BRIDGE_AVOID_HELP, /Sur un pont routier, la zone évitée bloque aussi la route du dessus\./);
});

test('validation : valeurs absurdes refusées, note nettoyée, origine pont gardée', () => {
  const ok = validateRestriction({ lat: 47.66, lon: 6.21, type: 'height', value: '3,8', note: '  Pont‮ SNCF ' }, { now, makeId: ids });
  assert.deepEqual(ok, { id: 'r-test-1', lat: 47.66, lon: 6.21, type: 'height', value: 3.8, note: 'Pont SNCF', date: '2026-11-22', origin: 'manual' });
  assert.throws(() => validateRestriction({ lat: 47.66, lon: 6.21, type: 'height', value: 12 }), /entre 1 et 6 m/);
  assert.throws(() => validateRestriction({ lat: 47.66, lon: 6.21, type: 'weight', value: 0 }), /entre 1 et 60 t/);
  assert.throws(() => validateRestriction({ lat: 95, lon: 6.21, type: 'avoid' }), /Position/);
  assert.throws(() => validateRestriction({ lat: 47, lon: 6, type: 'largeur', value: 2 }), /Type/);
  const av = validateRestriction({ lat: 47.66, lon: 6.21, type: 'avoid', value: 99, origin: 'osm-bridge', osmId: 243477938 }, { now, makeId: ids });
  assert.equal(av.value, null);
  assert.equal(av.osmId, 243477938);
  assert.equal(restrictionLabel(ok), 'Hauteur 3,8 m');
  assert.equal(restrictionLabel({ type: 'weight', value: 3.5 }), 'Poids 3,5 t');
});

test('ajout, doublons à moins de 5 m, modification, suppression', () => {
  let list = addRestriction([], { lat: 47.66, lon: 6.21, type: 'avoid' }, { now, makeId: ids });
  assert.throws(() => addRestriction(list, { lat: 47.66002, lon: 6.21, type: 'avoid' }, { now }), /existe déjà/);
  list = addRestriction(list, { lat: 47.66002, lon: 6.21, type: 'weight', value: 3.5 }, { now, makeId: ids });
  assert.equal(list.length, 2, 'autre type au même endroit : accepté');
  list = updateRestriction(list, list[1].id, { value: 7.5, note: 'Rue du Viaduc' }, { now });
  assert.equal(list[1].value, 7.5);
  assert.throws(() => updateRestriction(list, list[1].id, { value: 'beaucoup' }), /entre 1 et 60 t/);
  assert.equal(removeRestriction(list, list[0].id).length, 1);
});

test('export / import : restrictions gardées, invalides et doublons écartés, rien de secret', () => {
  const d = { ...emptyData(), restrictions: [
    { id: 'a', lat: 47.66, lon: 6.21, type: 'height', value: 3.8, note: '', date: '2026-11-22', origin: 'manual' },
    { id: 'b', lat: 47.66001, lon: 6.21, type: 'height', value: 3.9, note: '', date: '2026-11-22', origin: 'manual' },
    { id: 'c', lat: 47.7, lon: 6.3, type: 'weight', value: 500, date: '2026-11-22' },
    { id: 'd', lat: 47.7, lon: 6.3, type: 'avoid', date: '2026-11-22', origin: 'osm-bridge', osmId: 243477938 },
  ] };
  const text = exportData(d, now);
  const back = importData(text);
  assert.deepEqual(back.restrictions.map((r) => r.id), ['a', 'd']);
  assert.ok(!/orsKey|Authorization/i.test(text));
  assert.equal(sanitizeRestrictions('pas une liste').list.length, 0);
  assert.equal(sanitizeRestrictions(d.restrictions).dropped, 2);
  assert.deepEqual(emptyData().restrictions, []);
});

test('application au profil : hauteur + 0,1 m ≥ valeur, PTAC > valeur, « éviter » toujours', () => {
  assert.equal(applies({ type: 'height', value: 4.1 }, semi), true, '4 + 0,1 ≥ 4,1');
  assert.equal(applies({ type: 'height', value: 4.2 }, semi), false);
  assert.equal(applies({ type: 'weight', value: 44 }, semi), false, 'PTAC égal : non');
  assert.equal(applies({ type: 'weight', value: 3.5 }, semi), true);
  assert.equal(applies({ type: 'avoid' }, semi), true);
  assert.equal(applies({ type: 'height', value: 3 }, { ...semi, height: null }), true, 'hauteur inconnue : par prudence');
});

test('polygone : 16 côtés, fermé, rayon 30 m', () => {
  const ring = circleRing(47.66, 6.21);
  assert.equal(ring.length, RESTR.SIDES + 1);
  assert.deepEqual(ring[0], ring.at(-1));
  for (const p of ring) assert.ok(Math.abs(haversine(p, [6.21, 47.66]) - 30) < 0.5);
  assert.deepEqual(mergeAvoid(null, { type: 'Polygon', coordinates: [ring] }, { type: 'MultiPolygon', coordinates: [[ring], [ring]] }).coordinates.length, 3);
  assert.equal(mergeAvoid(null, undefined), null);
});

test('zone du trajet : seulement les restrictions proches, applicables, hors départ et arrivée', () => {
  const start = [6.02, 47.24]; const end = [6.38, 47.81]; // Besançon → Luxeuil
  const list = sanitizeRestrictions([
    { id: 'col', lat: 47.66, lon: 6.21, type: 'avoid' },
    { id: 'loin', lat: 45.76, lon: 4.83, type: 'avoid' },
    { id: 'haut', lat: 47.5, lon: 6.2, type: 'height', value: 5.5 },
    { id: 'dep', lat: 47.24, lon: 6.0201, type: 'avoid' },
  ]).list;
  const plan = restrictionsForTrip(list, { vehicle: semi, start, end });
  assert.deepEqual(plan.applicable.map((r) => r.id).sort(), ['col', 'dep']);
  assert.deepEqual(plan.avoided.map((r) => r.id), ['col']);
  assert.deepEqual(plan.atEnds.map((r) => r.id), ['dep']);
  assert.equal(plan.geometry.type, 'MultiPolygon');
  assert.equal(plan.geometry.coordinates.length, 1);
  assert.equal(avoidedText(1), 'Évite 1 restriction saisie par toi. La signalisation fait foi.');
  assert.equal(avoidedText(3), 'Évite 3 restrictions saisies par toi. La signalisation fait foi.');
  assert.ok(!/sûr|sans restriction/i.test(avoidedText(2)));
});

test('limite d\'ORS : message dès 150,1 km à vol d\'oiseau, pas à 149,9 km', () => {
  const start = [6.0, 47.0];
  const at = (m) => destinationPoint(start, 0, m);
  const r = sanitizeRestrictions([{ id: 'x', lat: at(75000)[1], lon: 6.0, type: 'avoid' }]).list;
  const far = restrictionsForTrip(r, { vehicle: semi, start, end: at(150100) });
  assert.equal(far.tooFar, true);
  assert.equal(far.geometry, null, 'aucun polygone envoyé : ORS refuserait la requête');
  assert.ok(restrictionLines({ coordinates: [] }, far).some((l) => l.text === TOO_FAR_TEXT));
  const near = restrictionsForTrip(r, { vehicle: semi, start, end: at(149900) });
  assert.equal(near.tooFar, false);
  assert.ok(near.geometry);
  assert.ok(!restrictionLines({ coordinates: [] }, near).some((l) => l.text === TOO_FAR_TEXT));
  assert.match(TOO_FAR_TEXT, /150 km.*À vérifier\. La signalisation fait foi\.$/);
});

test('tracé qui passe quand même près d\'une restriction : « à vérifier »', () => {
  const r = sanitizeRestrictions([{ id: 'x', lat: 47.66, lon: 6.21, type: 'height', value: 3.8, note: 'Colombier' }]).list;
  const plan = { applicable: r, avoided: r, atEnds: [], tooFar: false };
  const lines = restrictionLines({ coordinates: [[6.21, 47.65], [6.21, 47.67]] }, plan);
  assert.ok(lines.some((l) => l.level === 'warn' && /passe près d'une restriction saisie par toi \(Hauteur 3,8 m, Colombier\) : à vérifier/.test(l.text)));
  assert.equal(nearLine([6.21, 47.66], [[6.3, 47.65], [6.3, 47.67]], 30), false);
});

test('calcul : polygones dans chaque requête (alternatives comprises) et gardés pour le recalcul', async () => {
  const sent = [];
  const plan = restrictionsForTrip(sanitizeRestrictions([{ lat: 49.0, lon: 6.18, type: 'avoid' }]).list, { vehicle: semi, start: METZ, end: NANCY });
  const send = async (req) => { sent.push(req); return fixture('ors-directions-metz-nancy.json'); };
  const { options } = await computeRouteOptions({ start: METZ, end: NANCY, vehicle: semi, send, avoidPolygons: plan.geometry });
  assert.ok(sent.length >= 1 && sent.every((r) => r.body.options.avoid_polygons?.type === 'MultiPolygon'));
  assert.deepEqual(options[0].request.avoidPolygons, plan.geometry);
});

test('Metz → Nancy sans restriction : requêtes inchangées (aucun avoid_polygons)', async () => {
  const sent = [];
  const send = async (req) => { sent.push(req); return fixture('ors-directions-metz-nancy.json'); };
  const { options } = await computeRouteOptions({ start: METZ, end: NANCY, vehicle: semi, send });
  assert.ok(sent.every((r) => r.body.options.avoid_polygons === undefined));
  assert.equal(options[0].request.avoidPolygons, undefined);
});

test('échec 2009 avec restrictions évitées : phrase au conditionnel, sans requête de plus que le diagnostic', async () => {
  const plan = restrictionsForTrip(sanitizeRestrictions([{ lat: 49.0, lon: 6.18, type: 'avoid' }]).list, { vehicle: semi, start: METZ, end: NANCY });
  const sent = [];
  const err2009 = () => {
    const c = classifyError({ status: 404, body: fixture('ors-error-2009-metz.json') });
    return Object.assign(new Error(c.message), { kind: c.kind, code: c.code, status: 404, detail: c.detail });
  };
  const send = async (req) => { sent.push(req); throw err2009(); };
  await assert.rejects(computeRouteOptions({ start: METZ, end: NANCY, vehicle: semi, send, avoidPolygons: plan.geometry }), (err) => {
    assert.ok(err.message.endsWith(BLOCKED_TEXT));
    assert.equal(BLOCKED_TEXT, 'Une restriction saisie bloque peut-être le seul passage.');
    return true;
  });
  assert.ok(sent.length <= 3, 'budget de 3 requêtes');
  assert.ok(sent.every((r) => r.body.options.avoid_polygons), 'diagnostic avec les mêmes zones évitées');
  // Sans restriction : jamais cette phrase.
  await assert.rejects(computeRouteOptions({ start: METZ, end: NANCY, vehicle: semi, send }), (err) => !err.message.includes(BLOCKED_TEXT));
});

test('« Éviter ce passage » depuis le pont 243477938 : restriction au croisement, à moins de 30 m du tracé dessous', () => {
  const feats = readFileSync(new URL('./fixtures/osm-ponts-colombier.geojsonseq', import.meta.url), 'utf8').split('\n').map(parseGeojsonLine).filter(Boolean);
  const conv = convertBridges(feats.map(bridgeFromFeature).filter(Boolean), feats.map(clearanceFromFeature).filter(Boolean));
  const data = mergeBridgeTiles([...conv.tiles.values()].map((t) => parseBridgeTile(JSON.parse(JSON.stringify(t)))));
  const route = parseRouteFixture();
  const it = bridgesAlongRoute(route, data, { vehicleHeight: 4 }).items.find((x) => x.id === 243477938);
  const r = validateRestriction(fromBridge(it, { now }), { now, makeId: ids });
  assert.equal(r.type, 'avoid');
  assert.equal(r.origin, 'osm-bridge');
  assert.equal(r.osmId, 243477938);
  assert.ok(nearLine([r.lon, r.lat], route.coordinates, RESTR_RADIUS_M), 'à moins de 30 m du tracé');
  // Jamais le centre ni un nœud du pont (le viaduc est long) : distance à chaque nœud > 30 m.
  const v = data.bridges.find((b) => b.id === 243477938).coords;
  assert.ok(v.every((p) => haversine(p, [r.lon, r.lat]) > RESTR_RADIUS_M));
});

function parseRouteFixture() {
  const f = fixture('ors-directions-colombier.json').features[0];
  return { coordinates: f.geometry.coordinates, steps: [], roadExtras: null };
}
