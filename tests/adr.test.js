// Phase 5b : matières dangereuses (ADR) — catégories des tunnels OpenStreetMap, code du véhicule (ADR 8.6.4),
// conversion de la copie hebdomadaire, passage de l'itinéraire, textes (« la signalisation fait foi »), données
// absentes, tunnels gardés en dur, « Éviter le tunnel », guidage avec des positions envoyées comme le vrai GPS.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, runFixes } from './helpers.js';
import {
  ADR, KNOWN_TUNNELS, CATEGORY_ALL, categoryFromTags, isForbidden, effectiveCode, parseTunnelData, tunnelsAlongRoute,
  describeForbidden, describeAllowed, noTunnelText, avoidingOptionsText, guidanceTunnel, avoidTunnelsFor, squareAround,
} from '../src/lib/adr.js';
import {
  convertTunnels, crossCheck, KNOWN_PROBES, knownTubesFromMap, elementsFromGeojsonSeq, osmiumFilter, TUNNELS_CONVERT,
} from '../src/lib/tunnels-convert.js';
import { routeRules, tunnelRules, rulesSourceText } from '../src/lib/route-rules.js';
import { startNavigation, updateNavigation, rerouteDone, setNavigationTunnels } from '../src/lib/navigation.js';
import { createSimulator } from '../src/lib/nav-sim.js';
import { normalizeVehicle, validateVehicle, defaultVehicle } from '../src/lib/vehicle.js';
import {
  ADR_CLASSES, ADR_TUNNEL_CODES, TUNNEL_CODE_HELP, sanitizeAdrSettings, emptyAdrSettings, unNumberError, withAdr, adrSummary,
} from '../src/lib/adr-settings.js';
import { sanitizeData, importData, exportData, activeVehicle, createStore, memoryStorage, DATA_KEY } from '../src/lib/store.js';
import { noTunnelOption, guidanceParams } from '../src/lib/route-options.js';
import { buildDirectionsRequest } from '../src/lib/ors-request.js';
import { haversine } from '../src/lib/nav-geo.js';

const raw = fixture('overpass-tunnels.json');
const converted = convertTunnels(raw, { updated: '2026-11-17' });
const data = parseTunnelData(JSON.parse(JSON.stringify(converted.data)));
const adr = (tunnelCode, extra = {}) => ({ ...defaultVehicle(), hazmat: true, tunnelCode, ...extra });

/** 39 km plein est à la latitude 45,05 (30 min) : tunnels de la fixture vers les km 8, 24 et 31. */
function eastRoute() {
  const n = 400;
  const coords = Array.from({ length: n + 1 }, (_, i) => [4.9 + (0.5 * i) / n, 45.05]);
  return { coordinates: coords, steps: [{ name: 'A 99', instruction: 'Suivez A 99', type: 11, wayPoints: [0, n], duration: 1800, distance: 39400 }], duration: 1800, distance: 39400, bbox: [4.9, 45.05, 5.4, 45.05] };
}

function drive(route, t0, seconds) {
  const sim = createSimulator(route.coordinates, { speedKmh: 90 });
  return Array.from({ length: seconds }, (_, i) => sim.next(t0 + i * 1000));
}

test('catégorie lue dans les étiquettes OSM (wiki Key:hazmat), catégorie A et « yes » sans effet', () => {
  assert.equal(categoryFromTags({ 'hazmat:B': 'no', 'hazmat:C': 'no' }), 'C', 'plus haute lettre marquée no');
  assert.equal(categoryFromTags({ 'hazmat:E': 'no' }), 'E');
  assert.equal(categoryFromTags({ 'hazmat:D': 'yes', 'hazmat:E': 'no' }), 'E');
  assert.equal(categoryFromTags({ 'hazmat:adr_tunnel_cat': 'd' }), 'D');
  assert.equal(categoryFromTags({ 'hazmat:tunnel_cat': 'E' }), 'E');
  assert.equal(categoryFromTags({ hazmat: 'E', 'hazmat:conditional': 'no @ (UN2919)' }), 'E', 'Mont-Blanc côté français (OSM)');
  assert.equal(categoryFromTags({ 'hazmat:adr_tunnel_cat': 'A' }), null);
  assert.equal(categoryFromTags({ hazmat: 'no', 'hazmat:C': 'no' }), CATEGORY_ALL, 'hazmat=no : tout interdit');
  assert.equal(categoryFromTags({ 'hazmat:E': 'yes' }), null);
  assert.equal(categoryFromTags({ 'hazmat:B': 'destination' }), null);
  assert.equal(categoryFromTags(null), null);
});

test('ADR 8.6.4 : un code interdit les tunnels de sa lettre et des lettres suivantes', () => {
  assert.equal(isForbidden('B', 'B'), true);
  assert.equal(isForbidden('E', 'B'), true);
  assert.equal(isForbidden('B', 'C'), false);
  assert.equal(isForbidden('C', 'C'), true);
  assert.equal(isForbidden('D', 'C'), true);
  assert.equal(isForbidden('C', 'D'), false);
  assert.equal(isForbidden('E', 'E'), true);
  assert.equal(isForbidden('D', 'E'), false);
  assert.equal(isForbidden('E', 'none'), false, 'chargement sans code : catégorie E autorisée');
  assert.equal(isForbidden(CATEGORY_ALL, 'none'), true, 'panneau sans lettre : toutes matières dangereuses');
  assert.equal(isForbidden('E', null), false, 'code non renseigné : aucune alerte');
});

test('code du véhicule : vide = aucune vérification ; numéros ONU sans code (ADR 1.9.5.2.2) ; pas d\'ADR = rien', () => {
  assert.equal(effectiveCode(adr('')), null);
  assert.equal(effectiveCode(adr('C')), 'C');
  assert.equal(effectiveCode({ ...adr('C'), hazmat: false }), null);
  for (const un of ADR.NO_CODE_UN) assert.equal(effectiveCode(adr('B', { unNumber: un })), 'none', `UN ${un}`);
  assert.equal(effectiveCode(adr('B', { unNumber: '1202' })), 'B');
});

test('Réglages ADR (réglage global) : nettoyage, numéro ONU, code tunnel jamais déduit de la classe', () => {
  assert.deepEqual(sanitizeAdrSettings({ enabled: true, adrClass: '3', unNumber: 'UN 1202', tunnelCode: 'D' }),
    { enabled: true, adrClass: '3', unNumber: '1202', tunnelCode: 'D' });
  assert.deepEqual(sanitizeAdrSettings({ enabled: true, adrClass: '10', unNumber: '12', tunnelCode: 'Z' }),
    { enabled: true, adrClass: '', unNumber: '', tunnelCode: '' }, 'valeurs inconnues → vides');
  assert.deepEqual(sanitizeAdrSettings(null), emptyAdrSettings());
  assert.equal(sanitizeAdrSettings({ enabled: true, adrClass: '3' }).tunnelCode, '', 'classe 3 seule : code tunnel vide');
  assert.match(unNumberError('12'), /4 chiffres/);
  assert.equal(unNumberError(''), null);
  assert.equal(unNumberError('UN 1202'), null);
  assert.deepEqual(ADR_TUNNEL_CODES, ['', 'B', 'C', 'D', 'E']);
  assert.equal(ADR_CLASSES.length, 13);
  assert.match(ADR_CLASSES.find((c) => c.value === '3').label, /gazole, essence/);
  assert.match(TUNNEL_CODE_HELP, /document de transport ; la classe seule ne la donne pas/);
  // Le profil ne garde plus aucun champ ADR.
  const v = normalizeVehicle({ ...defaultVehicle(), hazmat: 'on', tunnelCode: 'D', adrClass: '3', unNumber: '1202' });
  assert.equal(validateVehicle(v).valid, true);
  for (const k of ['hazmat', 'tunnelCode', 'adrClass', 'unNumber']) assert.equal(k in v, false, k);
});

test('withAdr : véhicule lu par ORS, les alertes et les notes = profil + Réglages', () => {
  const on = { enabled: true, adrClass: '3', unNumber: '1202', tunnelCode: 'D' };
  const v = withAdr(defaultVehicle(), on);
  assert.deepEqual([v.hazmat, v.tunnelCode, v.adrClass, v.unNumber], [true, 'D', '3', '1202']);
  assert.equal(effectiveCode(v), 'D');
  const off = withAdr(defaultVehicle(), { ...on, enabled: false });
  assert.deepEqual([off.hazmat, off.tunnelCode], [false, '']);
  assert.equal(effectiveCode(off), null);
  assert.equal(effectiveCode(withAdr(defaultVehicle(), { enabled: true, tunnelCode: '' })), null, 'code vide : aucune alerte');
  for (const un of ADR.NO_CODE_UN) assert.equal(effectiveCode(withAdr(defaultVehicle(), { ...on, unNumber: un })), 'none', `UN ${un}`);
  assert.equal(adrSummary(on), 'ADR (code D, classe 3, UN 1202)');
  assert.equal(adrSummary({ enabled: true }), 'ADR');
  assert.equal(adrSummary({ ...on, enabled: false }), '');
  // ORS ne reçoit que hazmat (oui / non) : le code tunnel n'est jamais envoyé.
  const { body } = buildDirectionsRequest({ start: [5, 45], end: [5.1, 45.1], vehicle: v });
  assert.equal(body.options.profile_params.restrictions.hazmat, true);
  assert.doesNotMatch(JSON.stringify(body), /tunnel|1202|adrClass/i);
  const { body: b2 } = buildDirectionsRequest({ start: [5, 45], end: [5.1, 45.1], vehicle: off });
  assert.equal('hazmat' in b2.options.profile_params.restrictions, false);
});

test('reprise des anciens profils ADR dans les Réglages (stockage et import d\'un ancien JSON)', () => {
  const base = { height: 4, width: 2.55, length: 16.5, weight: 44, maxSpeed: 90, critair: '1' };
  const old = {
    version: 1, activeVehicleId: 'b',
    vehicles: [
      { ...base, id: 'a', name: 'Citerne', hazmat: true, tunnelCode: 'E', adrClass: '2', unNumber: '1965' },
      { ...base, id: 'b', name: 'Semi', hazmat: true, tunnelCode: 'D', adrClass: '3', unNumber: 'UN 1202' },
      { ...base, id: 'c', name: 'Porteur', hazmat: false },
    ],
    settings: { theme: 'day' },
  };
  const d = importData(JSON.stringify(old));
  assert.deepEqual(d.settings.adr, { enabled: true, adrClass: '3', unNumber: '1202', tunnelCode: 'D' }, 'profil actif ADR repris');
  for (const v of d.vehicles) assert.equal('hazmat' in v || 'tunnelCode' in v, false, `${v.name} : champs ADR retirés`);
  assert.deepEqual(activeVehicle(d).tunnelCode, 'D');
  assert.equal(activeVehicle(d).hazmat, true);
  // Profil actif sans ADR : premier profil ADR.
  const d2 = sanitizeData({ ...old, activeVehicleId: 'c' });
  assert.deepEqual(d2.settings.adr, { enabled: true, adrClass: '2', unNumber: '1965', tunnelCode: 'E' });
  // Ancien « sans code » gardé (même alerte qu'avant).
  const d3 = sanitizeData({ ...old, vehicles: [{ ...base, id: 'x', name: 'X', hazmat: 'on', tunnelCode: 'none' }] });
  assert.equal(d3.settings.adr.tunnelCode, 'none');
  // Aucun profil ADR : réglage vide ; réglage déjà présent : gardé, profils ignorés.
  assert.deepEqual(sanitizeData({ ...old, vehicles: [old.vehicles[2]] }).settings.adr, emptyAdrSettings());
  const kept = sanitizeData({ ...old, settings: { adr: { enabled: false, adrClass: '8', unNumber: '', tunnelCode: 'C' } } });
  assert.deepEqual(kept.settings.adr, { enabled: false, adrClass: '8', unNumber: '', tunnelCode: 'C' });
  assert.equal(activeVehicle(kept).hazmat, false);
  // Aller-retour export → import : rien de perdu.
  assert.deepEqual(importData(exportData(d)).settings.adr, d.settings.adr);
  // Le stockage local (ancien format) est repris au chargement.
  const storage = memoryStorage();
  storage.setItem(DATA_KEY, JSON.stringify(old));
  assert.equal(createStore(storage).load().settings.adr.tunnelCode, 'D');
});

test('conversion de la réponse Overpass : catégories, catégorie A et étiquettes sans effet retirées, tube simplifié', () => {
  const { data: d, log } = converted;
  assert.equal(d.updated, '2026-11-17');
  assert.match(d.license, /ODbL/);
  assert.deepEqual(d.tunnels.map((t) => [t.id, t.cat]), [['w101', 'C'], ['w102', 'E'], ['w103', 'D'], ['w104', 'D'], ['w105', 'X']]);
  assert.equal(d.tunnels[1].ref, 'A 99');
  assert.ok(d.tunnels.every((t) => t.g.length >= 2 && t.g.length <= 12));
  assert.equal(d.tunnels[0].g.length, 2, 'tube droit : deux points suffisent');
  assert.match(log[0], /5 tubes gardés.*2 sans catégorie/);
  assert.deepEqual(d.countries.slice(0, 2), ['france', 'belgium']);
  assert.deepEqual(osmiumFilter(), ['w/hazmat', 'w/hazmat:B', 'w/hazmat:C', 'w/hazmat:D', 'w/hazmat:E', 'w/hazmat:adr_tunnel_cat', 'w/hazmat:tunnel_cat']);
  assert.ok(TUNNELS_CONVERT.GEOFABRIK.includes('europe/france') && TUNNELS_CONVERT.GEOFABRIK.includes('europe/italy'));
  const cc = crossCheck(raw, KNOWN_PROBES);
  assert.equal(cc.length, 3);
  assert.match(cc[0], /^Fourvière \(Bison Futé : E\) : absent des données OSM$/);
});

test('export osmium (geojsonseq, RFC 8142) → voies en tunnel ; route ordinaire et ligne illisible ignorées', () => {
  const RS = '\u001e';
  const text = [
    `${RS}{"type":"Feature","id":"w10","geometry":{"type":"LineString","coordinates":[[5,45.05],[5.01,45.05],[5.02,45.05]]},"properties":{"highway":"motorway","tunnel":"yes","hazmat:C":"no","tunnel:name":"Tunnel de Test"}}`,
    `${RS}{"type":"Feature","id":"w11","geometry":{"type":"LineString","coordinates":[[5,45.06],[5.02,45.06]]},"properties":{"highway":"primary","hazmat":"no"}}`,
    `${RS}{"type":"Feature","id":"w12","geometry":{"type":"LineString","coordinates":[[5,45.06],[5,45.05]]},"properties":{"highway":"primary","tunnel":"no","hazmat":"no"}}`,
    `${RS}{"type":"Feature","id":"n3","geometry":{"type":"Point","coordinates":[5,45]},"properties":{"hazmat":"no"}}`,
    'pas du json',
  ].join('\n');
  const els = elementsFromGeojsonSeq(text);
  assert.deepEqual(els.map((e) => e.id), [10]);
  assert.deepEqual(els[0].geometry[1], { lon: 5.01, lat: 45.05 });
  const { data: d } = convertTunnels({ elements: els }, { updated: '2026-11-19' });
  assert.deepEqual(d.tunnels, [{ id: 'w10', cat: 'C', g: [[5, 45.05], [5.02, 45.05]], name: 'Tunnel de Test' }]);
});

test('recoupement des tunnels en dur : tubes lus dans une réponse de l\'API OSM /api/0.6/map (format JSON)', () => {
  const map = {
    version: '0.6', elements: [
      { type: 'node', id: 1, lat: 45.18, lon: 6.67 }, { type: 'node', id: 2, lat: 45.13, lon: 6.685 }, { type: 'node', id: 3, lat: 45.09, lon: 6.70 },
      { type: 'way', id: 9, nodes: [1, 2, 3], tags: { highway: 'trunk', tunnel: 'yes', name: 'Tunnel du Fréjus', 'hazmat:C': 'no' } },
      { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'service', name: 'Tunnel du Fréjus' } },
      { type: 'way', id: 11, nodes: [2, 3], tags: { highway: 'trunk', tunnel: 'yes', name: 'Autre' } },
      // Fourvière (étiquettes réelles lues le 20/11/2026) : nom du tunnel dans tunnel:name, hazmat=no.
      { type: 'way', id: 12, nodes: [3, 1], tags: { highway: 'trunk', tunnel: 'yes', name: 'Autoroute du Soleil', 'tunnel:name': 'Tunnel de Fourvière', hazmat: 'no', ref: 'M 6' } },
    ],
  };
  assert.deepEqual(knownTubesFromMap(map, /fr[ée]jus/i), [{ id: 'w9', name: 'Tunnel du Fréjus', cat: 'C', g: [[6.67, 45.18], [6.685, 45.13], [6.7, 45.09]] }]);
  assert.deepEqual(knownTubesFromMap(map, /fourvi[eè]re/i).map((t) => [t.id, t.name, t.cat]), [['w12', 'Tunnel de Fourvière', 'X']]);
  const conv = convertTunnels({ elements: [{ type: 'way', id: 5, geometry: [{ lon: 1, lat: 2 }, { lon: 1.01, lat: 2 }], tags: map.elements.at(-1).tags }] });
  assert.equal(conv.data.tunnels[0].name, 'Tunnel de Fourvière', 'nom affiché : tunnel:name, pas le nom de la route');
});

test('fichier absent, vide ou illisible : données indisponibles (jamais un silence)', () => {
  assert.equal(parseTunnelData(null).ok, false);
  assert.equal(parseTunnelData({ tunnels: [] }).ok, false);
  assert.equal(parseTunnelData({ tunnels: [{ cat: 'Q', g: [[1, 2], [3, 4]] }, { cat: 'C', g: [[1, 2]] }] }).ok, false);
  const route = eastRoute();
  for (const tunnels of [null, { status: 'failed', data: null }, { status: 'ok', data: parseTunnelData({ tunnels: [] }) }]) {
    const r = tunnelRules(route, { vehicle: adr('C'), tunnels });
    assert.deepEqual(r.lines.map((l) => l.text), [ADR.UNAVAILABLE_TEXT]);
    assert.equal(r.lines[0].level, 'warn');
  }
  assert.match(ADR.UNAVAILABLE_TEXT, /^Alerte tunnels indisponible \(données non chargées\)/);
  assert.deepEqual(tunnelRules(route, { vehicle: adr('C'), tunnels: { status: 'loading' } }).lines.map((l) => l.text), [ADR.LOADING_TEXT]);
});

test('passage de l\'itinéraire : tunnels du tracé, tube double réuni, tunnel voisin ignoré', () => {
  const route = eastRoute();
  const dep = new Date(2026, 10, 18, 10, 0);
  const list = tunnelsAlongRoute(route, { data, vehicle: adr('D'), departure: dep });
  assert.deepEqual(list.map((p) => p.name), ['Tunnel de Test C', 'Tunnel de Test E', 'Tunnel double']);
  assert.deepEqual(list.map((p) => p.forbidden), [false, true, true], 'code D : catégorie C autorisée, D et E interdites');
  const c = list[0];
  assert.ok(Math.abs(c.enter - haversine([4.9, 45.05], [5.0, 45.05])) < 50, `entrée ${c.enter}`);
  assert.ok(Math.abs(c.exit - c.enter - haversine([5.0, 45.05], [5.02, 45.05])) < 50);
  assert.equal(c.at.getHours(), 10);
  const e = tunnelsAlongRoute(route, { data, vehicle: adr('E') });
  assert.deepEqual(e.map((p) => p.forbidden), [false, true, false]);
  assert.deepEqual(tunnelsAlongRoute(route, { data, vehicle: adr('B') }).map((p) => p.forbidden), [true, true, true]);
  // Un tunnel parallèle à 2 km ne compte pas ; un tracé qui passe à côté d'un tube (65 m) non plus.
  const beside = { ...route, coordinates: route.coordinates.map(([x, y]) => [x, y + 0.0006]) };
  assert.equal(tunnelsAlongRoute(beside, { data, vehicle: adr('B') }).length, 0);
  // Tracé qui ne fait que croiser le tunnel (perpendiculaire) : pas dedans.
  const cross = { coordinates: [[5.01, 45.0], [5.01, 45.1]], steps: [], duration: 600 };
  assert.equal(tunnelsAlongRoute(cross, { data, vehicle: adr('B') }).length, 0);
  // Itinéraire dans l'autre sens : mêmes tunnels.
  const back = { ...route, coordinates: [...route.coordinates].reverse() };
  assert.deepEqual(tunnelsAlongRoute(back, { data, vehicle: adr('D') }).map((p) => p.name), ['Tunnel double', 'Tunnel de Test E', 'Tunnel de Test C']);
});

test('textes : « la signalisation fait foi » sur chaque alerte, jamais « sans tunnel interdit »', () => {
  const route = eastRoute();
  const r = tunnelRules(route, { vehicle: adr('C'), tunnels: { status: 'ok', data }, departure: new Date(2026, 10, 18, 10) });
  assert.equal(r.forbidden.length, 3);
  assert.equal(r.lines.length, 3);
  for (const l of r.lines) assert.match(l.text, /La signalisation fait foi\.$/);
  assert.match(r.lines[0].text, /^Tunnel de Test C \(catégorie C\) interdit au code C : vous y seriez vers km 8 \(vers 10 h 0\d\)\. La signalisation fait foi\.$/);
  assert.deepEqual(r.short, ['Tunnel de Test C interdit', 'Tunnel de Test E interdit', 'Tunnel double interdit']);
  const ok = tunnelRules(route, { vehicle: adr('E'), tunnels: { status: 'ok', data } });
  assert.match(ok.lines.find((l) => l.level === 'info').text, /^Tunnel de Test C \(catégorie C\) vers km 8 : autorisé au code E\. La signalisation fait foi\.$/);
  const none = tunnelRules({ coordinates: [[3, 44], [3.1, 44.1]], steps: [], duration: 600 }, { vehicle: adr('B'), tunnels: { status: 'ok', data } });
  assert.deepEqual(none.lines.map((l) => l.text), ['Aucun tunnel signalé dans les données (copie du 17/11), la signalisation fait foi.']);
  assert.equal(noTunnelText(null), 'Aucun tunnel signalé dans les données, la signalisation fait foi.');
  for (const t of [ADR.UNAVAILABLE_TEXT, ADR.ORS_TEXT, ADR.REMINDER_TEXT, ...r.lines.map((l) => l.text), ...none.lines.map((l) => l.text)]) {
    assert.doesNotMatch(t, /sans tunnel interdit/i);
  }
  const all = { name: 'Tunnel X', cat: CATEGORY_ALL, code: 'none', enter: 1000, at: new Date(2026, 0, 1, 8, 5), note: null };
  assert.match(describeForbidden(all), /^Tunnel X interdit aux matières dangereuses : vous y seriez vers km 1 \(vers 8 h 05\)\. La signalisation fait foi\.$/);
  assert.match(describeAllowed({ ...all, cat: 'E', forbidden: false }), /autorisé au sans code tunnel|sans code tunnel/);
});

test('code tunnel vide : aucune alerte ; pas d\'ADR : rien ; rappel ADR et source dans les notes', () => {
  const route = eastRoute();
  const empty = tunnelRules(route, { vehicle: adr(''), tunnels: { status: 'ok', data } });
  assert.equal(empty.forbidden.length, 0);
  assert.deepEqual(empty.lines.map((l) => [l.level, l.text]), [['info', ADR.NO_CODE_TEXT]]);
  assert.deepEqual(tunnelRules(route, { vehicle: defaultVehicle(), tunnels: { status: 'ok', data } }).lines, []);
  const rules = routeRules(route, { vehicle: adr('C'), departure: new Date(2026, 10, 18, 10), tunnels: { status: 'ok', data } });
  assert.equal(rules.forbiddenTunnels.length, 3);
  assert.match(rules.lines[0].text, /^Tunnel de Test C/, 'tunnel interdit en tête des notes');
  assert.ok(rules.lines.some((l) => l.text === ADR.REMINDER_TEXT));
  assert.deepEqual(rules.short.slice(0, 1), ['Tunnel de Test C interdit']);
  assert.ok(!routeRules(route, { vehicle: defaultVehicle(), departure: new Date(2026, 10, 18, 10) }).lines.some((l) => l.text === ADR.REMINDER_TEXT));
  assert.match(rulesSourceText(null, { hazmat: true, tunnelsUpdated: '2026-11-17' }), /OpenStreetMap \(ODbL\).*Bison Futé.*Copie OSM du 17\/11\/2026\.$/);
  assert.doesNotMatch(rulesSourceText(null), /Tunnels/, 'pas d\'ADR : pas de source des tunnels');
  assert.match(ADR.ORS_TEXT, /plus long que nécessaire/);
});

test('autres itinéraires qui évitent le tunnel indiqués sur la fiche choisie', () => {
  const opts = [{ label: 'Recommandé', forbidden: 1 }, { label: 'Plus court', forbidden: 0 }, { label: 'Sans péage', forbidden: 0 }];
  assert.equal(avoidingOptionsText(opts, 0), 'Les itinéraires « Plus court », « Sans péage » évitent ce tunnel : touche sa fiche pour le choisir.');
  assert.equal(avoidingOptionsText(opts, 1), null);
  assert.equal(avoidingOptionsText([{ label: 'A', forbidden: 1 }, { label: 'B', forbidden: 2 }], 0), null);
  assert.equal(avoidingOptionsText([{ label: 'A', forbidden: 1 }, { label: 'B', forbidden: 0 }], 0), 'L\'itinéraire « B » évite ce tunnel : touche sa fiche pour le choisir.');
});

test('« Éviter le tunnel » : carré de 80 m au milieu du tube, ZFE déjà évitées gardées, limite de 150 km', () => {
  const route = eastRoute();
  const forbidden = tunnelsAlongRoute(route, { data, vehicle: adr('C') }).filter((p) => p.forbidden);
  const zfe = { type: 'MultiPolygon', coordinates: [[[[1, 1], [2, 1], [2, 2], [1, 1]]]] };
  const plan = avoidTunnelsFor(forbidden, { start: route.coordinates[0], end: route.coordinates.at(-1), existing: zfe });
  assert.equal(plan.ok, true);
  assert.equal(plan.geometry.coordinates.length, 1 + forbidden.length);
  const sq = plan.geometry.coordinates[1][0];
  assert.ok(Math.abs(haversine(sq[0], sq[1]) - 80) < 1);
  assert.ok(haversine([(sq[0][0] + sq[2][0]) / 2, (sq[0][1] + sq[2][1]) / 2], [5.01, 45.05]) < 30, 'milieu du tunnel C');
  assert.deepEqual(squareAround([5, 45])[0], squareAround([5, 45])[4]);
  const far = avoidTunnelsFor(forbidden, { start: [2.35, 48.85], end: [6.7, 45.1] });
  assert.equal(far.ok, false);
  assert.match(far.text, /150 km.*la signalisation fait foi\.$/);
  assert.equal(avoidTunnelsFor([], { start: [5, 45], end: [5.1, 45] }).ok, false);
  const opt = noTunnelOption({ key: 'recommended', label: 'Recommandé', request: { avoidTolls: false, preference: null } }, route, plan.geometry, ['Tunnel de Test C']);
  assert.equal(opt.label, 'Contournement');
  assert.match(opt.note, /^Évite : Tunnel de Test C\. La signalisation fait foi\.$/);
  assert.equal(guidanceParams(opt, { start: [5, 45], end: [5.1, 45] }).avoidPolygons, plan.geometry, 'recalcul en guidage : zones gardées');
});

test('tunnels gardés en dur (Bison Futé) : Fourvière E, Fréjus C, Mont-Blanc E, vérifiés même sans données', () => {
  assert.deepEqual(KNOWN_TUNNELS.map((t) => [t.name, t.cat]), [['Tunnel de Fourvière', 'E'], ['Tunnel du Fréjus', 'C'], ['Tunnel du Mont-Blanc', 'E']]);
  for (const t of KNOWN_TUNNELS) {
    assert.ok(t.tubes.length >= 1, `${t.name} : tracé connu`);
    for (const g of t.tubes) assert.ok(g.length >= 2);
    // Un tracé qui suit le tube : tunnel trouvé sans fichier de données, catégorie Bison Futé.
    const route = { coordinates: t.tubes[0], steps: [], duration: 900 };
    const p = tunnelsAlongRoute(route, { data: null, vehicle: adr('C') });
    assert.equal(p.length, 1, t.name);
    assert.equal(p[0].cat, t.cat);
    assert.equal(p[0].forbidden, true, `${t.name} interdit au code C`);
    assert.ok(p[0].known);
    const lines = tunnelRules(route, { vehicle: adr('C'), tunnels: { status: 'failed' } }).lines;
    assert.equal(lines[0].text, ADR.UNAVAILABLE_TEXT);
    assert.match(lines[1].text, new RegExp(`^${t.name}`));
  }
  // Fourvière et Mont-Blanc : interdits même sans code tunnel (Bison Futé) ; Fréjus (C) : autorisé sans code.
  const none = (t) => tunnelsAlongRoute({ coordinates: t.tubes[0], steps: [], duration: 900 }, { data: null, vehicle: adr('E', { unNumber: '3373' }) })[0];
  assert.equal(none(KNOWN_TUNNELS[0]).forbidden, true);
  assert.match(describeForbidden(none(KNOWN_TUNNELS[0])), /^Tunnel de Fourvière \(catégorie E\) interdit à toutes les matières dangereuses, même sans code tunnel/);
  assert.equal(none(KNOWN_TUNNELS[2]).forbidden, true);
  assert.equal(none(KNOWN_TUNNELS[1]).forbidden, false);
  const frejus = KNOWN_TUNNELS[1];
  const route = { coordinates: frejus.tubes[0], steps: [], duration: 900 };
  assert.equal(tunnelsAlongRoute(route, { data: null, vehicle: adr('D') })[0].forbidden, false, 'Fréjus (C) autorisé au code D');
  // Le même tunnel dans les données OSM avec une autre catégorie : celle de Bison Futé est gardée, un seul passage.
  const osm = parseTunnelData({ tunnels: [{ id: 'w1', name: 'Fréjus (OSM)', cat: 'E', g: frejus.tubes[0] }] });
  const merged = tunnelsAlongRoute(route, { data: osm, vehicle: adr('D') });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].cat, 'C');
  assert.equal(merged[0].name, 'Tunnel du Fréjus');
});

test('guidage (GPS émulé, 90 km/h) : bandeau sous 20 km, une annonce vers 5 km, recalcul, voix coupée', () => {
  const route = eastRoute();
  const t0 = new Date(2026, 10, 18, 10).getTime();
  const vehicle = { ...adr('E'), critair: '1' };
  const s0 = startNavigation(route, { now: t0, rules: { vehicle, voice: true, tunnels: data } });
  assert.deepEqual(s0.tunnels.map((p) => p.name), ['Tunnel de Test E']);
  const { events, views } = runFixes(updateNavigation, s0, drive(route, t0, 1100));
  const speech = events.filter((e) => e.type === 'speak' && /tunnel/i.test(e.text));
  assert.equal(speech.length, 1);
  assert.equal(speech[0].text, 'Attention, tunnel de test e dans 5 kilomètres, interdit à votre chargement. Suivez la signalisation.');
  const banner = views.map((v) => v.rules.tunnel?.text).filter(Boolean);
  assert.ok(banner.length > 0);
  for (const b of banner) assert.match(b, /la signalisation fait foi$/);
  assert.match(banner[0], /^Tunnel de Test E dans (19|20)(,\d)? km : interdit \(code E\)/);
  const first = views.findIndex((v) => v.rules.tunnel);
  assert.ok(first > 0, 'pas de bandeau au-delà de 20 km');
  // Voix coupée : bandeau seulement.
  const muted = runFixes(updateNavigation, startNavigation(route, { now: t0, rules: { vehicle, voice: false, tunnels: data } }), drive(route, t0, 1100));
  assert.ok(!muted.events.some((e) => /tunnel/i.test(e.text ?? '')));
  assert.ok(muted.views.some((v) => v.rules.tunnel));
  // Code vide : rien.
  const none = runFixes(updateNavigation, startNavigation(route, { now: t0, rules: { vehicle: adr(''), voice: true, tunnels: data } }), drive(route, t0, 1100));
  assert.ok(none.views.every((v) => v.rules.tunnel === null));
  // Fichier arrivé après « Démarrer » : tunnels placés ; recalcul : replacés sur le nouveau tracé.
  const late = setNavigationTunnels(startNavigation(route, { now: t0, rules: { vehicle, voice: true, tunnels: null } }), data);
  assert.equal(late.tunnels.length, 1);
  const back = { ...route, coordinates: route.coordinates.slice(0, 200) };
  assert.equal(rerouteDone(late, back).state.tunnels.length, 0, 'nouveau tracé sans le tunnel E');
});

test('vraie copie data/tunnels-adr.json : lisible, moins de 1 Mo, Fourvière réuni avec le tunnel en dur', () => {
  const text = readFileSync(new URL('../data/tunnels-adr.json', import.meta.url), 'utf8');
  assert.ok(Buffer.byteLength(text) < 1024 * 1024, `${Buffer.byteLength(text)} octets`);
  const real = parseTunnelData(JSON.parse(text));
  assert.equal(real.ok, true);
  assert.ok(real.tunnels.length > 100);
  assert.match(real.updated, /^\d{4}-\d{2}-\d{2}$/);
  const tube = KNOWN_TUNNELS[0].tubes[0];
  const p = tunnelsAlongRoute({ coordinates: tube, steps: [], duration: 120 }, { data: real, vehicle: adr('E') });
  assert.equal(p.length, 1, 'un seul passage (OSM + Bison Futé)');
  assert.equal(p[0].name, 'Tunnel de Fourvière');
  assert.equal(p[0].cat, 'E');
  assert.equal(p[0].forbidden, true);
});
