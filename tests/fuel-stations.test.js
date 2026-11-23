// Phase 4 — Carburant : stations le long du trajet (fixture tests/fixtures/carburants-v2.json, forme de l'export
// /exports/json lue par l'Action « Textes officiels » le 23/11/2026, valeurs synthétiques). Aucun appel réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FUEL, franceRanges, routeBoxes, fuelQueryUrl, parseStations, stationsAlongRoute, describeStation, tripFuelCost,
  filterStations, sanitizeFuelStations, toggleFuelStation, lazyLoader, fetchErrorText, updatedText,
} from '../src/lib/fuel-stations.js';
import { FUEL_API } from '../src/lib/config.js';
import { sanitizeData, exportData, importData, emptyData } from '../src/lib/store.js';
import { cacheStrategy, LAZY_APP_FILES } from '../src/lib/sw-routing.js';

const json = JSON.parse(readFileSync(new URL('./fixtures/carburants-v2.json', import.meta.url), 'utf8'));
// Tracé est-ouest à 45,76° N, de 4,85° à 5,15° E (≈ 23 km), points tous les 0,01°.
const coords = Array.from({ length: 31 }, (_, i) => [4.85 + i * 0.01, 45.76]);
const route = { coordinates: coords, distance: 23300, duration: 1200 };

test('parseStations : champs réels, services en liste ou texte « // », invalides et doublons écartés', () => {
  const s = parseStations(json);
  assert.deepEqual(s.map((x) => x.id), [69100001, 69009003, 69110006, 69007012, 69002006]);
  assert.equal(s[0].price, 2.026);
  assert.equal(s[0].updated.toISOString(), '2026-11-23T10:52:00.000Z');
  assert.equal(s[0].address, '1 rue de l\'Essai');
  assert.deepEqual(s.map((x) => x.hgv), [false, false, true, true, false]);
  assert.equal(parseStations({ results: json }).length, 5);
  assert.equal(parseStations({ error_code: 'x' }), null);
  assert.equal(parseStations('pas du json'), null);
});

test('stationsAlongRoute : ≤ 2 km du tracé, tri par prix puis distance, devant seulement en guidage', () => {
  const st = parseStations(json);
  const along = stationsAlongRoute(st, route);
  assert.deepEqual(along.map((x) => x.id), [69009003, 69100001, 69007012, 69110006]); // « Loin du trajet » écartée
  assert.ok(along.every((x) => x.offset <= FUEL.RADIUS_M));
  const ahead = stationsAlongRoute(st, route, { from: [4.96, 45.76] });
  assert.deepEqual(ahead.map((x) => x.id), [69007012, 69110006]);
  assert.ok(ahead[0].ahead > 0 && ahead[0].ahead < ahead[0].along);
  assert.deepEqual(stationsAlongRoute(st, { coordinates: [] }), []);
});

test('describeStation : prix, détour à vol d\'oiseau, « ancien » au-delà de 48 h', () => {
  const [s] = stationsAlongRoute(parseStations(json), route).filter((x) => x.id === 69110006);
  const now = new Date('2026-11-23T12:00:00Z');
  const d = describeStation(s, { now });
  assert.equal(d.price, '2,19 €/L');
  assert.match(d.detour, /^détour ≈ \d,\d km à vol d'oiseau$/);
  assert.equal(d.old, false);
  assert.equal(d.hgv, true);
  assert.equal(d.updated, `mis à jour le ${updatedText(s.updated)}`);
  const vieux = describeStation({ ...s, updated: new Date('2026-11-21T11:59:00Z') }, { now });
  assert.equal(vieux.old, true);
  assert.equal(describeStation({ ...s, updated: null }, { now }).old, true);
  assert.equal(describeStation({ ...s, offset: 20 }, { now }).detour, 'sur le trajet');
  assert.equal(updatedText(null), 'date inconnue');
});

test('routeBoxes et fuelQueryUrl : une requête, boîtes du trajet élargies de 2 km, in_bbox(lat, lon, lat, lon)', () => {
  const boxes = routeBoxes(route);
  assert.equal(boxes.length, 2); // 23 km → tronçons de 20 km
  const [w, s, e, n] = boxes[0];
  assert.ok(w < 4.85 && s < 45.76 && n > 45.76 && e > 4.85);
  assert.ok(Math.abs((n - 45.76) * 111320 - FUEL.RADIUS_M) < 1);
  assert.ok(boxes[0][2] >= boxes[1][0]); // aucun trou entre deux boîtes
  const url = fuelQueryUrl(boxes);
  assert.ok(url.startsWith(`${FUEL_API}/exports/json?`));
  const q = new URL(url).searchParams;
  assert.equal(q.get('select'), 'id,adresse,ville,cp,geom,gazole_prix,gazole_maj,services_service');
  assert.match(q.get('where'), /^gazole_prix is not null and \(in_bbox\(geom, 45\.7420, 4\.\d{4}, 45\.7780, \d\.\d{4}\) or in_bbox/);
  assert.doesNotMatch(url, /key|token/i);
  // Long trajet : 60 boîtes au plus (URL courte).
  const long = { coordinates: Array.from({ length: 1001 }, (_, i) => [2 + i * 0.01, 46]) };
  assert.ok(routeBoxes(long).length <= FUEL.MAX_BOXES);
  assert.ok(fuelQueryUrl(routeBoxes(long)).length < 8000);
});

test('France seulement : tronçons FR d\'ORS, autre pays → rien demandé', () => {
  assert.equal(franceRanges(route).france, 'unknown');
  const mixed = { ...route, countries: [{ from: 0, to: 10, code: 'FR' }, { from: 10, to: 30, code: 'CH' }] };
  assert.deepEqual(franceRanges(mixed), { ranges: [[0, 10]], france: 'partly' });
  assert.equal(routeBoxes(mixed).length, 1);
  const suisse = { ...route, countries: [{ from: 0, to: 30, code: 'CH' }] };
  assert.equal(franceRanges(suisse).france, 'none');
  assert.deepEqual(routeBoxes(suisse), []);
  assert.equal(franceRanges({ ...route, countries: [{ from: 0, to: 30, code: 'FR' }] }).france, 'all');
});

test('coût du trajet : km × consommation du profil × prix de la station', () => {
  const r = tripFuelCost({ distance: 500000 }, { consumption: 32 }, 2);
  assert.equal(r.ok, true);
  assert.equal(r.liters, 160);
  assert.equal(r.cost, 320);
  assert.equal(r.text, 'Coût du trajet à ce prix : ≈ 320 € (≈ 160 L)');
  assert.deepEqual(tripFuelCost({ distance: 500000 }, { consumption: null }, 2), { ok: false, text: FUEL.NO_CONSUMPTION_TEXT });
});

test('filtres « Piste PL » et « OK camion »', () => {
  const st = stationsAlongRoute(parseStations(json), route);
  assert.deepEqual(filterStations(st, { hgvOnly: true }).map((s) => s.id), [69007012, 69110006]);
  assert.deepEqual(filterStations(st, { okOnly: true, okIds: new Set([69100001]) }).map((s) => s.id), [69100001]);
  assert.equal(filterStations(st).length, 4);
});

test('Mes stations « OK camion » : ajout, retrait, nettoyage, export et import de gabarit.data', () => {
  const [s] = parseStations(json);
  const now = new Date('2026-11-23T12:00:00Z');
  const list = toggleFuelStation([], s, now);
  assert.deepEqual(list, [{ id: 69100001, name: '1 rue de l\'Essai, Villebrune', lon: 4.88, lat: 45.7605, addedAt: '2026-11-23T12:00:00.000Z' }]);
  assert.deepEqual(toggleFuelStation(list, s, now), []);
  assert.deepEqual(sanitizeFuelStations([{ id: 'x' }, { id: 5, lon: 200, lat: 0 }, list[0], list[0], null]), list);
  const many = Array.from({ length: 600 }, (_, i) => ({ id: i + 1, name: 'n', lon: 1, lat: 1 }));
  assert.equal(sanitizeFuelStations(many).length, FUEL.MAX_OK);
  const data = { ...emptyData(), fuelStations: list };
  assert.deepEqual(sanitizeData(data).fuelStations, list);
  assert.deepEqual(importData(exportData(data)).fuelStations, list);
  assert.deepEqual(sanitizeData(emptyData()).fuelStations, []);
});

test('chargement paresseux : import refusé (hors ligne) → message, puis nouvel essai', async () => {
  let calls = 0;
  let fail = true;
  const load = lazyLoader(async () => { calls += 1; if (fail) throw new TypeError('Failed to fetch dynamically imported module'); return { ok: 1 }; });
  assert.deepEqual(await load(), { ok: false, text: 'Pas de connexion : prix indisponibles.' });
  fail = false;
  assert.deepEqual(await load(), { ok: true, mod: { ok: 1 } });
  assert.deepEqual(await load(), { ok: true, mod: { ok: 1 } });
  assert.equal(calls, 2); // module gardé après le premier succès
});

test('messages d\'échec de la requête', () => {
  assert.equal(fetchErrorText(new TypeError('Failed to fetch')), FUEL.OFFLINE_TEXT);
  assert.equal(fetchErrorText(new Error('HTTP 500'), false), FUEL.OFFLINE_TEXT);
  assert.equal(fetchErrorText(new Error('HTTP 500')), FUEL.ERROR_TEXT);
});

test('service worker : prix jamais mis en cache, module carburant chargé à la demande hors cache', () => {
  const ORIGIN = 'https://exemple.github.io';
  assert.equal(cacheStrategy('GET', fuelQueryUrl(routeBoxes(route)), ORIGIN), 'bypass');
  assert.deepEqual(LAZY_APP_FILES, ['src/ui/fuel.js']);
  assert.equal(cacheStrategy('GET', `${ORIGIN}/Gabarit/src/ui/fuel.js`, ORIGIN), 'bypass');
  assert.equal(cacheStrategy('GET', `${ORIGIN}/Gabarit/src/lib/fuel-stations.js`, ORIGIN), 'network-first');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sw, /src\/ui\/fuel\.js/);
  assert.match(sw, /'\.\/src\/lib\/fuel-stations\.js'/);
});
