// Phase 9 : aires et parkings PL (Overpass, jeu officiel, placement sur le tracé, prochaines aires, avis, cache).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, runFixes } from './helpers.js';
import {
  buildOverpassQuery, overpassBody, parseOverpass, simplifyLine, combineRoutes, queryLine, AREAS_OSM, OVERPASS_ENDPOINTS,
} from '../src/lib/areas-osm.js';
import {
  parseOfficialData, parseSharedStrings, parseXlsxSheet, parseOdsContent, rowsToAreas, mapColumns, missingFields,
  lambert93ToWgs84, decodeXml, OFFICIAL,
} from '../src/lib/areas-official.js';
import {
  mergeAreas, placeAlongRoute, nextAreas, areaToAnnounce, announceAreaText, describeArea, describeNextArea, placesText,
  sourcesText, AREAS,
} from '../src/lib/areas-route.js';
import {
  addAreaReport, latestReport, reportText, canReport, sanitizeAreaReports, AVIS_RULES,
} from '../src/lib/areas-avis.js';
import { createAreasCache, routeKey, AREAS_CACHE } from '../src/lib/areas-cache.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { startNavigation, updateNavigation, setNavigationAreas, rerouteDone } from '../src/lib/navigation.js';
import { createSimulator } from '../src/lib/nav-sim.js';
import { memoryStorage, sanitizeData, exportData, importData, emptyData } from '../src/lib/store.js';
import { haversine } from '../src/lib/nav-geo.js';

const text = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const route = parseDirections(fixture('ors-directions-nav.json'));
const osm = parseOverpass(fixture('overpass-aires.json'));
const official = parseOfficialData(fixture('aires-pl.json')).areas;
const pool = mergeAreas(osm, official);
const placed = placeAlongRoute(pool, route);
const byName = (list, name) => list.find((a) => a.name === name);

// ───────── Overpass ─────────

test('requête Overpass : une seule, aires à 400 m et parkings PL à 800 m du tracé (+ écart de simplification)', () => {
  const q = buildOverpassQuery(route.coordinates);
  assert.match(q, /^\[out:json\]\[timeout:25\];\(/);
  assert.match(q, /nwr\["highway"~"\^\(rest_area\|services\)\$"\]\(around:(\d+),/);
  const [rest, park] = [...q.matchAll(/\(around:(\d+),/g)].map((m) => Number(m[1]));
  assert.match(q, /\["amenity"="parking"\]\[~"\^\(hgv\|capacity:hgv\)\$"/);
  assert.ok(rest >= 400 && rest <= 400 + AREAS_OSM.TOLERANCES_M[0]);
  assert.ok(park >= 800 && park <= 800 + AREAS_OSM.TOLERANCES_M[0]);
  assert.match(q, /\);out center tags;$/);
  // latitude puis longitude, comme le veut Overpass
  assert.match(q, /around:\d+,45\.73,4\.95,/);
  assert.equal(overpassBody('a b').startsWith('data=a%20b'), true);
  assert.equal(OVERPASS_ENDPOINTS.length, 2, 'un serveur principal et un serveur de secours');
  assert.ok(OVERPASS_ENDPOINTS.every((u) => u.startsWith('https://') && !u.endsWith('/')));
});

test('simplification : extrémités gardées, ligne droite réduite à 2 points, long trajet borné', () => {
  const straight = Array.from({ length: 50 }, (_, i) => [5 + i * 0.001, 45]);
  assert.deepEqual(simplifyLine(straight, 20), [straight[0], straight[49]]);
  // ≈ 900 km de route sinueuse, un point tous les 30 m (tracé ORS dense).
  const zigzag = Array.from({ length: 30000 }, (_, i) => [-1 + i * 0.0004, 46 + 0.05 * Math.sin(i / 40)]);
  const t0 = Date.now();
  const { line, tolerance } = queryLine(zigzag);
  assert.ok(line.length <= AREAS_OSM.MAX_POINTS);
  assert.deepEqual(line[0], zigzag[0]);
  assert.deepEqual(line.at(-1), zigzag.at(-1));
  assert.ok(tolerance > 0);
  assert.ok(buildOverpassQuery(zigzag).length < 30000);
  assert.ok(Date.now() - t0 < 3000, `simplification trop lente : ${Date.now() - t0} ms`);
});

test('plusieurs itinéraires en une seule ligne, sans segment inventé (B parcouru à l\'envers)', () => {
  const a = [[0, 0], [1, 0], [2, 0]];
  const b = [[0, 0], [1, 1], [2, 0]];
  const c = [[0, 0], [1, -1], [2, 0]];
  assert.deepEqual(combineRoutes([a, b, c]), [[0, 0], [1, 0], [2, 0], [1, 1], [0, 0], [1, -1], [2, 0]]);
  assert.deepEqual(combineRoutes([a]), a);
});

test('réponse Overpass : aires, parking PL rattaché à son aire, parkings sans PL et éléments sans position écartés', () => {
  const ids = osm.map((a) => a.id);
  assert.deepEqual(ids.sort(), ['osm:n2002', 'osm:w1001', 'osm:w1002', 'osm:w1003', 'osm:w1004']);
  const est = osm.find((a) => a.id === 'osm:w1001');
  assert.equal(est.kind, 'rest_area');
  assert.equal(est.hgvPlaces, 25, 'places du parking PL dessiné dans l\'aire');
  assert.deepEqual(est.ids, ['osm:w1001', 'osm:n2001']);
  assert.deepEqual(est.services, ['toilets', 'water']);
  assert.equal(est.fee, false);
  const zone = osm.find((a) => a.id === 'osm:n2002');
  assert.equal(zone.kind, 'parking');
  assert.equal(zone.secure, true);
  assert.equal(zone.fee, true);
  const services = osm.find((a) => a.id === 'osm:w1002');
  assert.deepEqual(services.services, ['shower', 'food', 'fuel']);
  assert.deepEqual(parseOverpass(null), []);
  assert.deepEqual(parseOverpass({ elements: [{ type: 'node', id: 1, lat: 'x', lon: 2, tags: {} }] }), []);
});

// ───────── Jeu officiel ─────────

test('data/aires-pl.json : aires valides gardées, identifiants et positions hors France écartés', () => {
  assert.deepEqual(official.map((a) => a.id), ['off:SCA-A43_12', 'off:ANC-RN7_3', 'off:ANC-loin']);
  const a = official[0];
  assert.equal(a.kind, 'official');
  assert.equal(a.secure, true);
  assert.deepEqual(a.services, ['toilets', 'shower']);
  assert.deepEqual(parseOfficialData(undefined), { areas: [], updated: null });
  assert.deepEqual(parseOfficialData({ areas: 'x' }).areas, []);
  // Le fichier du dépôt (vide tant que l'Action n'a pas tourné, ou rempli) est toujours lisible.
  const repo = JSON.parse(readFileSync(new URL('../data/aires-pl.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(parseOfficialData(repo).areas));
  assert.equal(repo.licence, OFFICIAL.LICENCE);
});

test('tableur xlsx (réseau concédé) : chaînes partagées, texte en ligne, virgule décimale, ligne de titre', () => {
  const shared = parseSharedStrings(text('official-sharedStrings.xml'));
  assert.equal(shared[11], 'Aire de l\'Isle-d\'Abeau', 'texte enrichi réuni');
  assert.equal(shared[12], 'Lyon > Chambéry', 'entités XML décodées');
  const rows = parseXlsxSheet(text('official-sheet1.xml'), shared);
  const r = rowsToAreas(rows, { network: 'concédé', prefix: 'SCA' });
  assert.equal(r.headers[1], 'Nom de l\'aire');
  assert.equal(r.skipped, 1, 'ligne sans position comptée');
  assert.deepEqual(r.areas.map((a) => a.id), ['off:SCA-A43-12', 'off:SCA-A7-3']);
  const [isle, rambert] = r.areas;
  assert.deepEqual([isle.lat, isle.lon, isle.hgvPlaces, isle.fee, isle.secure], [45.6135, 5.2241, 48, false, true]);
  assert.deepEqual(isle.services, ['toilets', 'shower', 'food']);
  assert.equal(isle.direction, 'Lyon > Chambéry');
  assert.deepEqual([rambert.lat, rambert.lon, rambert.price, rambert.fee, rambert.secure], [45.293, 4.8121, '12 € / nuit', true, false]);
});

test('tableur ods (réseau non concédé) : Lambert 93, cellules répétées, espaces et paragraphes', () => {
  const [sheet] = parseOdsContent(text('official-content.xml'));
  assert.equal(sheet.name, 'Aires PL ANC');
  assert.ok(sheet.rows.length < 100, 'lignes vides répétées un million de fois : bornées');
  const r = rowsToAreas(sheet.rows, { network: 'non concédé', prefix: 'ANC' });
  assert.equal(r.areas.length, 1);
  const a = r.areas[0];
  assert.equal(a.name, 'Aire de la Nationale & Co');
  assert.equal(a.hgvPlaces, 20);
  assert.deepEqual(a.services, ['toilets', 'water']);
  assert.ok(Math.abs(a.lon - 3) < 1e-6 && Math.abs(a.lat - 46.5) < 1e-6, `${a.lon} ${a.lat}`);
});

test('Lambert 93 : origine de la projection (700 000, 6 600 000) = 3° E, 46,5° N', () => {
  const p = lambert93ToWgs84(700000, 6600000);
  assert.ok(Math.abs(p.lon - 3) < 1e-9 && Math.abs(p.lat - 46.5) < 1e-9);
  // Point plus au nord-ouest : longitude < 3°, latitude > 46,5°.
  const q = lambert93ToWgs84(652000, 6862000);
  assert.ok(q.lon > 2.2 && q.lon < 2.5 && q.lat > 48.7 && q.lat < 49, `${q.lon} ${q.lat}`);
});

test('colonnes : manque signalé clairement (nom ou position), places PL préférées aux places VL', () => {
  assert.deepEqual(missingFields(mapColumns(['Nom', 'Latitude', 'Longitude'])), []);
  assert.equal(missingFields(mapColumns(['Latitude', 'Longitude'])).length, 1);
  assert.equal(missingFields(mapColumns(['Nom de l\'aire', 'Commune'])).length, 1);
  const m = mapColumns(['Nom', 'Places VL', 'Places PL', 'Latitude', 'Longitude']);
  assert.equal(m.places, 2);
  assert.throws(() => rowsToAreas([['Commune', 'Département'], ['Lyon', '69']], { network: 'x', prefix: 'X' }),
    (err) => err.code === 'MISSING_COLUMNS' && /Commune \| Département/.test(err.message));
  assert.equal(decodeXml('a &amp; b &#233; &#x27;'), 'a & b é \'');
});

// ───────── Placement le long du tracé ─────────

test('fusion OSM + officiel : une fiche par aire (places et sécurité officielles, services réunis)', () => {
  const est = byName(pool, 'Aire PL de Test-Est');
  assert.ok(est, 'nom officiel retenu');
  assert.deepEqual(est.sources, ['osm', 'official']);
  assert.equal(est.hgvPlaces, 40);
  assert.equal(est.secure, true);
  assert.deepEqual(est.services, ['toilets', 'water', 'shower']);
  assert.ok(est.ids.includes('osm:w1001') && est.ids.includes('off:SCA-A43_12'));
  assert.equal(pool.length, osm.length + official.length - 1);
  assert.match(sourcesText(est), /Bison Futé.*Licence Ouverte.*OpenStreetMap/);
});

test('aires du trajet : triées par km, rayon respecté, aire à gauche marquée « autre sens ? »', () => {
  assert.deepEqual(placed.map((a) => a.name), [
    'Aire PL de Test-Est', 'Aire de l\'Autre-Sens', 'Parking PL de la Zone', 'Aire PL officielle du Sud', 'Aire du Bout',
  ]);
  assert.ok(placed.every((a, i) => i === 0 || a.along >= placed[i - 1].along));
  assert.equal(byName(placed, 'Aire de l\'Autre-Sens').otherSide, true);
  assert.equal(byName(placed, 'Aire de l\'Autre-Sens').side, 'left');
  assert.equal(byName(placed, 'Aire PL de Test-Est').side, 'right');
  assert.equal(byName(placed, 'Parking PL de la Zone').otherSide, false, 'parking PL : accessible des deux sens');
  assert.equal(placed.some((a) => a.name === 'Aire trop loin' || a.name === 'Aire PL hors trajet'), false);
  const est = byName(placed, 'Aire PL de Test-Est');
  assert.ok(est.time > 0 && est.time < route.duration);
  assert.ok(est.along > 900 && est.along < 1100);
});

test('aire très proche du tracé : côté inconnu, gardée dans le sens de circulation', () => {
  const near = placeAlongRoute([{ ...osm[0], id: 'x', ids: ['x'], lat: 45.73005, lon: 4.96 }], route);
  assert.equal(near[0].side, null);
  assert.equal(near[0].otherSide, false);
  // Sur la ligne « autre côté » du même itinéraire parcouru à l'envers : l'aire de gauche devient de droite.
  const back = { ...route, coordinates: route.coordinates.slice().reverse(), steps: [] };
  assert.equal(byName(placeAlongRoute(pool, back), 'Aire de l\'Autre-Sens').otherSide, false);
});

test('fiche de liste : km, heure d\'arrivée, places, services, badges', () => {
  const d = describeArea(byName(placed, 'Aire PL de Test-Est'), new Date(2026, 10, 19, 14, 0, 0));
  assert.equal(d.facts, 'km 1 · 14:00 · 40 places PL');
  assert.equal(d.services, 'WC, Eau, Douches');
  assert.deepEqual(d.badges, ['Sécurisé', 'Gratuit']);
  assert.equal(describeArea(byName(placed, 'Aire de l\'Autre-Sens')).otherSide, true);
  assert.deepEqual(describeArea(byName(placed, 'Parking PL de la Zone')).badges, ['Sécurisé', 'Payant']);
  assert.equal(placesText(1), '1 place PL');
  assert.equal(placesText(null), null);
});

test('prochaines aires : les 3 suivantes du sens de circulation, aire tout juste dépassée gardée', () => {
  const remainingAt = (al) => Math.max(0, (route.distance - al) / 15);
  const n = nextAreas(placed, 0, remainingAt);
  assert.deepEqual(n.map((a) => a.name), ['Aire PL de Test-Est', 'Parking PL de la Zone', 'Aire PL officielle du Sud']);
  assert.ok(Math.abs(n[0].distance - placed[0].along) < 1e-6);
  assert.ok(Math.abs(n[0].eta - placed[0].along / 15) < 1e-6);
  const at = nextAreas(placed, placed[0].along + 200, remainingAt);
  assert.equal(at[0].name, 'Aire PL de Test-Est', 'camion arrêté sur l\'aire : elle reste en tête');
  assert.equal(at[0].distance, 0);
  assert.equal(describeNextArea(at[0]).distance, 'Ici');
  const after = nextAreas(placed, placed[0].along + 600, remainingAt);
  assert.equal(after[0].name, 'Parking PL de la Zone');
  assert.equal(describeNextArea({ name: 'X', distance: 12300, eta: 600, hgvPlaces: null }, new Date(2026, 0, 1, 8, 0)).eta, '08:10');
});

test('annonce : une fois sous 10 km, pas pour une aire de l\'autre sens ni à moins de 2 km', () => {
  const far = [{ id: 'a', name: 'Aire A', along: 15000, otherSide: false, hgvPlaces: 45 },
    { id: 'b', name: 'Aire B', along: 26000, otherSide: true }, { id: 'c', name: 'Aire C', along: 29000, otherSide: false }];
  assert.equal(areaToAnnounce(far, 0), null);
  assert.equal(areaToAnnounce(far, 5500).area.id, 'a');
  assert.equal(areaToAnnounce(far, 5500, { a: true }), null);
  assert.equal(areaToAnnounce(far, 13500), null, 'à 1,5 km : trop tard');
  assert.equal(areaToAnnounce(far, 17000), null, 'aire de l\'autre sens jamais annoncée');
  assert.equal(areaToAnnounce(far, 19500).area.id, 'c');
  assert.equal(announceAreaText(far[0], 9800), 'Aire A dans 10 kilomètres, 45 places poids lourds.');
  assert.equal(announceAreaText({ kind: 'parking' }, 1200), 'Parking PL dans 1 kilomètre.');
});

// ───────── Guidage (moteur) ─────────

/** Positions simulées (comme le GPS : une par seconde, vitesse fournie). */
function simFixes(r, kmh, seconds, t0 = 1_000_000) {
  const sim = createSimulator(r.coordinates, { speedKmh: kmh });
  return Array.from({ length: seconds }, (_, i) => sim.next(t0 + i * 1000));
}

test('guidage : encart « Prochaines aires » mis à jour à chaque position, autre sens exclu', () => {
  const state = startNavigation(route, { destination: route.coordinates.at(-1), now: 999_000, areas: pool });
  const { views } = runFixes(updateNavigation, state, simFixes(route, 50, 140));
  const first = views[0].nextAreas;
  assert.equal(first.length, 3);
  assert.equal(first[0].name, 'Aire PL de Test-Est');
  assert.ok(views.every((v) => v.nextAreas.every((a) => a.name !== 'Aire de l\'Autre-Sens')));
  const d = views.map((v) => v.nextAreas.find((a) => a.name === 'Parking PL de la Zone')?.distance).filter((x) => x !== undefined);
  assert.ok(d.length > 30 && d.every((x, i) => i === 0 || x <= d[i - 1]), 'distance qui diminue');
  assert.ok(views.at(-1).nextAreas[0].name !== 'Aire PL de Test-Est', 'aire dépassée sortie de l\'encart');
});

test('guidage : annonce vocale seulement si le réglage est activé, une fois par aire', () => {
  // Trajet long et droit avec une aire PL à 30 km (à droite) et une à gauche à 20 km.
  const coords = Array.from({ length: 61 }, (_, i) => [4 + i * (1000 / 77800), 45.5]);
  const long = { distance: 60000, duration: 2700, coordinates: coords, steps: [], warnings: [] };
  const lat = (m) => 45.5 + m / 110540;
  const areas = [
    { id: 'r', ids: ['r'], kind: 'rest_area', name: 'Aire de Droite', lon: coords[30][0], lat: lat(-80), hgvPlaces: 45, services: [], sources: ['osm'] },
    { id: 'l', ids: ['l'], kind: 'rest_area', name: 'Aire de Gauche', lon: coords[20][0], lat: lat(80), hgvPlaces: 20, services: [], sources: ['osm'] },
  ];
  const fixes = simFixes(long, 90, 1000);
  const off = runFixes(updateNavigation, startNavigation(long, { areas, now: 999_000 }), fixes);
  assert.equal(off.events.filter((e) => /Aire/.test(e.text ?? '')).length, 0);
  const on = runFixes(updateNavigation, startNavigation(long, { areas, announceAreas: true, now: 999_000 }), fixes);
  const said = on.events.filter((e) => /Aire/.test(e.text ?? ''));
  assert.equal(said.length, 1);
  assert.equal(said[0].text, 'Aire de Droite dans 10 kilomètres, 45 places poids lourds.');
  const at = 30000 - said[0].view.nextAreas[0].distance;
  assert.ok(at > 19000 && at < 21000, `annonce à ${Math.round(30000 - at)} m de l'aire`);
});

test('guidage : aires arrivées après « Démarrer », puis replacées après un recalcul (sans nouvelle requête)', () => {
  let s = startNavigation(route, { now: 999_000 });
  const fixes = simFixes(route, 50, 5);
  let r = updateNavigation(s, fixes[0]);
  assert.deepEqual(r.view.nextAreas, []);
  s = setNavigationAreas(r.state, pool);
  r = updateNavigation(s, fixes[1]);
  assert.equal(r.view.nextAreas[0].name, 'Aire PL de Test-Est');
  const shorter = { ...route, coordinates: route.coordinates.slice(9), steps: [] };
  const done = rerouteDone(r.state, shorter);
  assert.equal(done.state.areaPool, pool);
  assert.ok(done.state.areas.every((a) => a.name !== 'Aire PL de Test-Est'), 'aire hors du nouveau tracé retirée');
  assert.equal(done.state.areas[0].name, 'Parking PL de la Zone');
});

// ───────── Mon avis ─────────

test('avis : à l\'arrêt seulement en guidage (sous 10 km/h), libre hors guidage', () => {
  assert.equal(canReport({ navigating: false }), true);
  assert.equal(canReport({ navigating: true, speedKmh: 4 }), true);
  assert.equal(canReport({ navigating: true, speedKmh: AVIS_RULES.MAX_SPEED_KMH }), false);
  assert.equal(canReport({ navigating: true, speedKmh: null }), false, 'vitesse inconnue en guidage : non');
});

test('avis : texte « Plein il y a 2 j, 21h », dernier avis retrouvé par identifiant ou par position', () => {
  const area = byName(placed, 'Aire PL de Test-Est');
  const t0 = new Date(2026, 10, 17, 21, 10);
  let list = addAreaReport([], area, 'full', t0);
  list = addAreaReport(list, byName(placed, 'Aire du Bout'), 'ok', new Date(2026, 10, 18, 8, 0));
  const r = latestReport(list, area);
  assert.equal(r.status, 'full');
  assert.equal(reportText(r, new Date(2026, 10, 19, 22, 0)), 'Plein il y a 2 j, 21h');
  assert.equal(reportText(r, new Date(2026, 10, 18, 0, 40)), 'Plein il y a 3 h, 21h');
  assert.equal(reportText(r, new Date(2026, 10, 17, 21, 35)), 'Plein il y a 25 min');
  assert.equal(reportText({ ...r, status: 'some' }, t0), 'Quelques places à l\'instant');
  // Même aire vue seulement par OSM (nouvel identifiant) : retrouvée par l'identifiant OSM gardé dans l'avis.
  assert.equal(latestReport(list, { id: 'osm:w1001', ids: ['osm:w1001'] }).status, 'full');
  // Autre identifiant, même endroit (à moins de 150 m) : retrouvée par la position.
  assert.equal(latestReport(list, { id: 'zz', ids: ['zz'], lon: area.lon + 0.0005, lat: area.lat }).status, 'full');
  assert.equal(latestReport(list, { id: 'zz', ids: ['zz'], lon: area.lon + 0.01, lat: area.lat }), null);
  // Plus récent en premier.
  const later = addAreaReport(list, area, 'ok', new Date(2026, 10, 19, 6, 0));
  assert.equal(latestReport(later, area).status, 'ok');
  assert.equal(addAreaReport(list, area, 'bof').length, 2, 'statut inconnu refusé');
});

test('avis : inclus dans l\'export / import, nettoyés, bornés', () => {
  const area = byName(placed, 'Aire du Bout');
  const data = { ...emptyData(), areaReports: addAreaReport([], area, 'some', new Date('2026-11-18T20:00:00Z')) };
  const back = importData(exportData(data));
  assert.equal(back.areaReports.length, 1);
  assert.equal(back.areaReports[0].status, 'some');
  assert.equal(back.areaReports[0].at, '2026-11-18T20:00:00.000Z');
  const dirty = sanitizeData({ ...data, areaReports: [{ status: 'full' }, { areaId: 'x', status: 'nope', at: '2026-01-01' }, 3, ...data.areaReports] });
  assert.equal(dirty.areaReports.length, 1);
  assert.deepEqual(sanitizeData({ vehicles: [] }).areaReports, []);
  const many = Array.from({ length: AVIS_RULES.MAX_REPORTS + 20 }, (_, i) => ({ areaId: `a${i}`, status: 'ok', at: new Date(2026, 0, 1, 0, i).toISOString() }));
  const kept = sanitizeAreaReports(many);
  assert.equal(kept.length, AVIS_RULES.MAX_REPORTS);
  assert.equal(kept[0].areaId, `a${AVIS_RULES.MAX_REPORTS + 19}`, 'les plus récents gardés');
  assert.equal(sanitizeData({ vehicles: [], settings: { areaVoice: true } }).settings.areaVoice, true);
  assert.equal(emptyData().settings.areaVoice, false, 'annonce des aires désactivée par défaut');
});

// ───────── Cache sur l'appareil ─────────

test('cache : même trajet retrouvé sans requête, 5 trajets au plus, 7 jours, hors des données exportées', () => {
  const storage = memoryStorage();
  const cache = createAreasCache(storage);
  const key = routeKey(route.coordinates);
  assert.equal(key, routeKey(route.coordinates.map(([x, y]) => [x + 1e-6, y])), 'arrondi à ≈ 10 m');
  assert.notEqual(key, routeKey(route.coordinates.slice(1)));
  assert.equal(cache.get(key), null);
  cache.set(key, osm, 1000);
  assert.equal(cache.get(key, 2000).length, osm.length);
  assert.equal(cache.get(key, 1000 + AREAS_CACHE.MAX_AGE_MS + 1), null);
  for (let i = 0; i < 7; i += 1) cache.set(`k${i}`, [], 3000 + i);
  assert.equal(JSON.parse(storage.getItem('gabarit.areasCache')).length, AREAS_CACHE.MAX_ENTRIES);
  storage.setItem('gabarit.areasCache', '{pas du json');
  assert.equal(cache.get(key), null);
  assert.doesNotMatch(exportData(emptyData()), /areasCache/);
});

test('constantes : rayons demandés (400 m / 800 m), 3 prochaines aires, annonce à 10 km', () => {
  assert.equal(AREAS_OSM.REST_RADIUS_M, 400);
  assert.equal(AREAS_OSM.PARKING_RADIUS_M, 800);
  assert.equal(AREAS.NEXT_COUNT, 3);
  assert.equal(AREAS.ANNOUNCE_M, 10000);
  assert.ok(haversine([0, 0], [0, 0]) === 0);
});
