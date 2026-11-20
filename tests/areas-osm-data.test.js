// Phase 9b : copie des aires et parkings PL d'OpenStreetMap (data/aires-osm/) placée sur le tracé sans réseau —
// export osmium → aires (mêmes identifiants que la version Overpass), zone couverte, cases de 1°, trajet de 520 km,
// case non couverte (seule demandée à Overpass), copie absente ou illisible. Aucun appel réseau.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import {
  AREAS_DATA, areaElementFromFeature, isAreaTags, elementKey, parseGeojsonLine, parsePoly, buildCoverage, coverageTest,
  compactArea, expandArea, tileKey, tilePath, convertAreas, parseIndex, parseTile, samplePoints, routePlan,
  mergeOsmSources, copyDateText,
} from '../src/lib/areas-osm-data.js';
import { parseOverpass, buildOverpassQuery, combineRoutes } from '../src/lib/areas-osm.js';
import { mergeAreas, placeAlongRoute, nextAreas, sourcesText, areaToAnnounce } from '../src/lib/areas-route.js';
import { latestReport, addAreaReport } from '../src/lib/areas-avis.js';
import { tunnelElementFromFeature } from '../src/lib/tunnels-convert.js';
import { haversine } from '../src/lib/nav-geo.js';

// Aucun appel réseau : fetch interdit pendant ces tests.
let realFetch;
before(() => { realFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('appel réseau interdit'); }; });
after(() => { globalThis.fetch = realFetch; });

const square = (lon, lat, d = 0.0004) => [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]];

/** Réponse Overpass (out center tags) → lignes exportées par osmium (voie fermée : ligne « w » et surface « a »). */
function osmiumFeatures(json) {
  const out = [];
  for (const e of json.elements) {
    const props = e.tags ?? {};
    if (e.type === 'node') out.push({ type: 'Feature', id: `n${e.id}`, geometry: { type: 'Point', coordinates: [e.lon, e.lat] }, properties: props });
    else if (e.center) {
      const ring = square(e.center.lon, e.center.lat);
      if (e.type === 'way') out.push({ type: 'Feature', id: `w${e.id}`, geometry: { type: 'LineString', coordinates: ring[0] }, properties: props });
      const aid = e.type === 'way' ? 2 * e.id : 2 * e.id + 1;
      out.push({ type: 'Feature', id: `a${aid}`, geometry: { type: 'MultiPolygon', coordinates: [ring] }, properties: props });
    }
  }
  return out;
}

function elementsOf(features) {
  const m = new Map();
  for (const f of features) {
    const e = areaElementFromFeature(f);
    if (e) m.set(elementKey(e), e);
  }
  return [...m.values()];
}

const BOX = (w, s, e, n) => parsePoly(`zone\n1\n   ${w} ${s}\n   ${e} ${s}\n   ${e} ${n}\n   ${w} ${n}\n   ${w} ${s}\nEND\nEND\n`);

/** Copie complète (index + cases) relue comme par l'appli (JSON sérialisé puis parseIndex / parseTile). */
function buildCopy(elements, polys, updated = '2026-12-01') {
  const { index, tiles } = convertAreas(elements, { updated, grid: buildCoverage(polys), countries: ['france'] });
  const files = new Map([...tiles].map(([k, t]) => [tilePath(k), JSON.parse(JSON.stringify(t))]));
  return { index: parseIndex(JSON.parse(JSON.stringify(index))), raw: index, files };
}

function readCopy(copy, line) {
  const plan = routePlan(line, copy.index);
  const areas = plan.tiles.flatMap((k) => parseTile(copy.files.get(tilePath(k)), copy.index.updated) ?? []);
  return { plan, areas };
}

// ───────── Export osmium → aires ─────────

test('osmium : identifiants n / w / a (voie 2 × id, relation 2 × id + 1), centre de l\'emprise comme Overpass', () => {
  const tags = { highway: 'rest_area' };
  assert.deepEqual(areaElementFromFeature({ id: 'n7', geometry: { type: 'Point', coordinates: [4, 45] }, properties: tags }),
    { type: 'node', id: 7, lat: 45, lon: 4, tags });
  const w = areaElementFromFeature({ id: 'a20', geometry: { type: 'MultiPolygon', coordinates: [square(4, 45, 0.001)] }, properties: tags });
  assert.equal(w.type, 'way'); assert.equal(w.id, 10);
  assert.ok(Math.abs(w.center.lon - 4) < 1e-9 && Math.abs(w.center.lat - 45) < 1e-9);
  const r = areaElementFromFeature({ id: 'a41', geometry: { type: 'MultiPolygon', coordinates: [square(4, 45)] }, properties: tags });
  assert.equal(r.type, 'relation'); assert.equal(r.id, 20);
  assert.equal(elementKey(areaElementFromFeature({ id: 'w10', geometry: { type: 'LineString', coordinates: square(4, 45)[0] }, properties: tags })), elementKey(w));
  assert.equal(areaElementFromFeature({ id: 'x1', geometry: { type: 'Point', coordinates: [4, 45] }, properties: tags }), null);
  assert.equal(areaElementFromFeature({ id: 'n1', geometry: null, properties: tags }), null);
  assert.equal(parseGeojsonLine('\u001e{"id":"n1"}').id, 'n1');
  assert.equal(parseGeojsonLine('pas du json'), null);
});

test('filtre en JS : parkings gardés seulement avec hgv=yes/designated ou capacity:hgv ; routes hgv=yes écartées', () => {
  assert.deepEqual(AREAS_DATA.OSMIUM_FILTER, ['nwr/highway=rest_area,services', 'nwr/amenity=parking', 'nwr/capacity:hgv']);
  assert.ok(!AREAS_DATA.OSMIUM_FILTER.some((f) => /\bhgv=/.test(f)), 'aucun filtre hgv=* global');
  assert.equal(isAreaTags({ highway: 'services' }), true);
  assert.equal(isAreaTags({ amenity: 'parking', hgv: 'designated' }), true);
  assert.equal(isAreaTags({ amenity: 'parking', hgv: 'yes' }), true);
  assert.equal(isAreaTags({ amenity: 'parking', 'capacity:hgv': '12' }), true);
  assert.equal(isAreaTags({ amenity: 'parking' }), false);
  assert.equal(isAreaTags({ amenity: 'parking', hgv: 'no' }), false);
  assert.equal(isAreaTags({ amenity: 'parking', 'capacity:hgv': '0' }), false);
  assert.equal(isAreaTags({ highway: 'primary', hgv: 'yes' }), false);
  assert.equal(isAreaTags({ building: 'yes', 'capacity:hgv': '4' }), false);
  // Un même export sert aux tunnels et aux aires : chacun ne garde que les siens.
  const tunnel = { id: 'w5', geometry: { type: 'LineString', coordinates: [[4, 45], [4.01, 45]] }, properties: { highway: 'motorway', tunnel: 'yes', 'hazmat:E': 'no' } };
  const parking = { id: 'w6', geometry: { type: 'LineString', coordinates: square(4, 45)[0] }, properties: { amenity: 'parking', hgv: 'yes', tunnel: 'yes', highway: 'service' } };
  assert.ok(tunnelElementFromFeature(tunnel)); assert.equal(areaElementFromFeature(tunnel), null);
  assert.equal(tunnelElementFromFeature(parking), null); assert.ok(areaElementFromFeature(parking));
});

test('identifiants identiques à la version Overpass (« Mon avis » reste sur la même aire)', () => {
  const json = fixture('overpass-aires.json');
  const viaOverpass = parseOverpass(json);
  const copy = buildCopy(elementsOf(osmiumFeatures(json)), [BOX(-5, 40, 10, 52)]);
  const viaCopy = [...copy.files.values()].flatMap((t) => parseTile(t, copy.index.updated));
  const key = (a) => `${a.id}|${a.ids.join(',')}|${a.kind}|${a.name}|${a.hgvPlaces}|${a.fee}|${a.secure}|${[...a.services].sort()}`;
  assert.deepEqual(viaCopy.map(key).sort(), viaOverpass.map(key).sort());
  assert.ok(viaCopy.every((a) => /^osm:[nwr]\d+$/.test(a.id)));
  // Avis enregistré sur une aire lue par Overpass (version 9) : retrouvé sur la même aire lue dans la copie.
  const before = viaOverpass.find((a) => a.id === 'osm:w1001');
  const reports = addAreaReport([], before, 'full', new Date('2026-11-20T10:00:00Z'));
  const after = viaCopy.find((a) => a.id === 'osm:w1001');
  assert.ok(after.ids.includes('osm:n2001'), 'parking rattaché gardé');
  // Avis donné sur le parking rattaché seul : retrouvé aussi par identifiant (sans le repli à 150 m).
  const moved = { ...after, lon: after.lon + 0.01 };
  assert.equal(latestReport(reports, moved)?.status, 'full');
  const onParking = addAreaReport([], { id: 'osm:n2001', ids: ['osm:n2001'], lon: 0, lat: 0, name: 'P' }, 'ok', new Date('2026-11-20T10:00:00Z'));
  assert.equal(latestReport(onParking, moved)?.status, 'ok');
});

test('forme compacte : aller-retour, champs illisibles écartés', () => {
  const a = parseOverpass(fixture('overpass-aires.json')).find((x) => x.id === 'osm:n2002');
  const back = expandArea(JSON.parse(JSON.stringify(compactArea(a))), '2026-12-01');
  for (const k of ['id', 'ids', 'kind', 'name', 'hgvPlaces', 'fee', 'secure', 'services', 'hgvOnly']) assert.deepEqual(back[k], a[k], k);
  assert.ok(haversine([back.lon, back.lat], [a.lon, a.lat]) < 2);
  assert.equal(back.copy, '2026-12-01');
  assert.equal(expandArea({ i: 'x12', k: 'r', x: 4, y: 45 }), null);
  assert.equal(expandArea({ i: 'w12', k: 'z', x: 4, y: 45 }), null);
  assert.equal(expandArea({ i: 'w12', k: 'r', x: 'a', y: 45 }), null);
  assert.equal(expandArea({ i: 'w12', k: 'r', x: 4, y: 95 }), null);
  assert.deepEqual(expandArea({ i: 'w12', k: 'r', x: 4, y: 45, a: ['n3', '<script>'], c: -4 }).ids, ['osm:w12', 'osm:n3']);
});

// ───────── Zone couverte ─────────

test('contour .poly : anneaux, trou, cellules couvertes seulement à 0,1° du bord', () => {
  const poly = parsePoly('france\n1\n   2.0 44.0\n   6.0 44.0\n   6.0 48.0\n   2.0 48.0\nEND\n!2\n   3.0 45.0\n   4.0 45.0\n   4.0 46.0\n   3.0 46.0\nEND\nEND\n');
  assert.equal(poly.rings.length, 2);
  assert.deepEqual(poly.bbox, [2, 44, 6, 48]);
  const grid = buildCoverage([poly]);
  const inside = coverageTest(grid);
  assert.equal(inside(5, 47), true);
  assert.equal(inside(2.05, 47), false, 'bord du contour');
  assert.equal(inside(2.25, 47), true);
  assert.equal(inside(3.5, 45.5), false, 'trou');
  assert.equal(inside(4.25, 45.5), true);
  assert.equal(inside(10, 47), false, 'hors grille');
  assert.equal(coverageTest(null)(5, 47), false);
  assert.equal(coverageTest({ cols: 2, rows: 2, bits: '%%%' })(0, 0), false);
  // Deux contours voisins : la frontière commune reste couverte.
  const two = coverageTest(buildCoverage([BOX(0, 44, 3, 47), BOX(3, 44, 6, 47)]));
  assert.equal(two(3.0, 45.5), true);
  assert.equal(two(2.95, 45.5), true);
});

// ───────── Trajet de 520 km ─────────

// Paris → Lyon → tunnel du Fréjus, un point par kilomètre environ.
const WAYPOINTS = [[2.35, 48.85], [3.57, 47.8], [4.83, 45.76], [5.92, 45.57], [6.69, 45.13]];
function longLine() {
  const out = [];
  for (let i = 1; i < WAYPOINTS.length; i += 1) {
    const [a, b] = [WAYPOINTS[i - 1], WAYPOINTS[i]];
    const n = Math.ceil(haversine(a, b) / 1000);
    for (let k = i === 1 ? 0 : 1; k <= n; k += 1) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
const LINE = longLine();
const LENGTH = LINE.reduce((t, p, i) => (i ? t + haversine(LINE[i - 1], p) : 0), 0);

/** Point à `frac` du tracé, décalé de `offset` m à droite (> 0) ou à gauche (< 0) du sens de marche. */
function beside(frac, offset) {
  const i = Math.max(1, Math.round(frac * (LINE.length - 1)));
  const [a, b] = [LINE[i - 1], LINE[i]];
  const kx = Math.cos((b[1] * Math.PI) / 180) * 111320;
  const dx = (b[0] - a[0]) * kx; const dy = (b[1] - a[1]) * 110540;
  const len = Math.hypot(dx, dy);
  // Normale droite du vecteur (dx, dy) : (dy, -dx).
  return [b[0] + ((dy / len) * offset) / kx, b[1] + ((-dx / len) * offset) / 110540];
}

let nextId = 5000;
function el(kind, [lon, lat], name, extra = {}) {
  nextId += 1;
  const tags = kind === 'parking' ? { amenity: 'parking', hgv: 'designated', ...extra } : { highway: kind, ...extra };
  if (name) tags.name = name;
  return { type: 'Feature', id: kind === 'parking' ? `n${nextId}` : `a${2 * nextId}`,
    geometry: kind === 'parking' ? { type: 'Point', coordinates: [lon, lat] } : { type: 'MultiPolygon', coordinates: [square(lon, lat, 0.0003)] },
    properties: tags };
}

const FEATURES = [
  el('rest_area', beside(0.05, 120), 'Aire droite 5 %'),
  el('services', beside(0.05, -150), 'Aire gauche 5 %'),
  el('services', beside(0.4, 140), 'Aire droite 40 %', { fuel: 'yes' }),
  el('rest_area', beside(0.4, -130), 'Aire gauche 40 %'),
  el('parking', beside(0.6, -600), 'Parking PL gauche 60 %', { 'capacity:hgv': '30' }),
  el('rest_area', beside(0.93, 110), 'Aire droite 93 %'),
  el('rest_area', beside(0.93, -120), 'Aire gauche 93 %'),
  el('rest_area', beside(0.7, 2500), 'Aire trop loin'),
  el('parking', beside(0.8, 300), 'Parking voitures', { hgv: 'no' }),
];
const ELEMENTS = elementsOf(FEATURES);
const FRANCE = [BOX(-5, 42, 8.3, 51.2)];

test('520 km dans la zone couverte : aires placées sans Overpass, deux sens, gauche en « autre sens ? »', () => {
  assert.ok(LENGTH >= 520000 && LENGTH < 700000, `${Math.round(LENGTH / 1000)} km`);
  const copy = buildCopy(ELEMENTS, FRANCE);
  const { plan, areas } = readCopy(copy, LINE);
  assert.equal(plan.uncovered.length, 0, 'aucun morceau pour Overpass');
  assert.equal(plan.coveredPoints, plan.points);
  assert.ok(plan.tiles.length >= 3 && plan.tiles.length <= 12, plan.tiles.join(' '));
  assert.ok(plan.tiles.every((k) => Object.hasOwn(copy.index.tiles, k)), 'seulement des cases non vides');
  const placed = placeAlongRoute(mergeAreas(areas, []), { coordinates: LINE, duration: 6 * 3600 });
  const byName = Object.fromEntries(placed.map((a) => [a.name, a]));
  assert.deepEqual(Object.keys(byName).sort(), ['Aire droite 40 %', 'Aire droite 5 %', 'Aire droite 93 %', 'Aire gauche 40 %',
    'Aire gauche 5 %', 'Aire gauche 93 %', 'Parking PL gauche 60 %'].sort());
  for (const n of ['Aire droite 5 %', 'Aire droite 40 %', 'Aire droite 93 %']) assert.equal(byName[n].otherSide, false, n);
  for (const n of ['Aire gauche 5 %', 'Aire gauche 40 %', 'Aire gauche 93 %']) assert.equal(byName[n].otherSide, true, n);
  assert.equal(byName['Parking PL gauche 60 %'].otherSide, false, 'parking PL : des deux sens');
  assert.equal(byName['Parking PL gauche 60 %'].hgvPlaces, 30);
  assert.ok(Math.abs(byName['Aire droite 93 %'].along - 0.93 * LENGTH) < 3000);
  assert.ok(placed.every((a) => a.copy === '2026-12-01'));
  // Guidage : prochaines aires et annonce seulement dans le sens de circulation.
  const remaining = (x) => (LENGTH - x) / 25;
  const next = nextAreas(placed, 0.39 * LENGTH, remaining);
  assert.deepEqual(next.map((n) => n.name), ['Aire droite 40 %', 'Parking PL gauche 60 %', 'Aire droite 93 %']);
  assert.equal(areaToAnnounce(placed, 0.93 * LENGTH - 8000)?.area.name, 'Aire droite 93 %');
  // Note de source : date de la copie.
  assert.equal(sourcesText(byName['Aire droite 5 %']), '© contributeurs OpenStreetMap (ODbL, copie du 01/12/2026)');
});

test('fusion avec le jeu officiel (Bison Futé) à 300 m, comme avant', () => {
  const copy = buildCopy(ELEMENTS, FRANCE);
  const { areas } = readCopy(copy, LINE);
  const host = areas.find((a) => a.name === 'Aire droite 40 %');
  const [nlon, nlat] = beside(0.4, 300); // 160 m de l'aire de droite, 430 m de celle de gauche
  const near = { id: 'off:X1', ids: ['off:X1'], source: 'official', sources: ['official'], kind: 'official', name: 'Aire officielle',
    lon: nlon, lat: nlat, hgvPlaces: 44, fee: false, price: null, secure: true, services: ['shower'] };
  const far = { ...near, id: 'off:X2', ids: ['off:X2'], name: 'Officielle seule', lon: host.lon + 0.02 };
  const pool = mergeAreas(areas, [near, far]);
  const merged = pool.find((a) => a.ids.includes('off:X1'));
  assert.equal(merged.id, host.id);
  assert.equal(merged.name, 'Aire officielle');
  assert.equal(merged.hgvPlaces, 44);
  assert.equal(merged.secure, true);
  assert.deepEqual(merged.sources, ['osm', 'official']);
  assert.ok(pool.some((a) => a.id === 'off:X2' && a.sources.length === 1));
  assert.match(sourcesText(merged), /Bison Futé.*copie du 01\/12\/2026/);
});

test('case non couverte : seul ce morceau du tracé part dans la requête Overpass (une seule)', () => {
  // Zone couverte jusqu'à 45,6° N : la fin du trajet (Maurienne, Fréjus) est hors copie.
  const copy = buildCopy(ELEMENTS, [BOX(-5, 45.6, 8.3, 51.2)]);
  const { plan, areas } = readCopy(copy, LINE);
  assert.equal(plan.uncovered.length, 1);
  const piece = plan.uncovered[0];
  assert.ok(piece.every(([, lat]) => lat < 45.85), 'morceau hors copie seulement');
  assert.ok(piece.at(-1)[1] < 45.2 && piece[0][1] > 45.6, 'du bord de la zone à l\'arrivée');
  const pieceKm = piece.reduce((t, p, i) => (i ? t + haversine(piece[i - 1], p) : 0), 0) / 1000;
  assert.ok(pieceKm < 200, `${Math.round(pieceKm)} km demandés à Overpass sur ${Math.round(LENGTH / 1000)}`);
  const q = buildOverpassQuery(plan.uncovered);
  const lats = [...q.matchAll(/(-?\d+\.\d+),(-?\d+\.\d+)/g)].map((m) => Number(m[1]));
  assert.ok(lats.length > 0 && lats.every((lat) => lat < 45.85));
  assert.equal((q.match(/around:/g) ?? []).length, 2);
  // Les aires couvertes restent lues dans la copie (Overpass n'est pas appelé pour elles).
  const names = placeAlongRoute(areas, { coordinates: LINE, duration: 6 * 3600 }).map((a) => a.name);
  assert.ok(names.includes('Aire droite 5 %') && names.includes('Aire droite 40 %'));
  // Plusieurs morceaux : une seule requête, les points partagés.
  const two = buildOverpassQuery([LINE.slice(0, 50), LINE.slice(-80)]);
  assert.equal((two.match(/around:/g) ?? []).length, 4);
  assert.throws(() => buildOverpassQuery([[[4, 45]]]), TypeError);
  // Trajet entièrement hors de la zone : tout le tracé, toujours un seul morceau.
  const none = routePlan(LINE, buildCopy(ELEMENTS, [BOX(20, 50, 22, 52)]).index);
  assert.equal(none.uncovered.length, 1);
  assert.equal(none.tiles.length, 0);
});

test('aires de la copie et d\'Overpass réunies sans doublon (même identifiant OSM)', () => {
  const a = { id: 'osm:w1', ids: ['osm:w1', 'osm:n2'] };
  const out = mergeOsmSources([a], [{ id: 'osm:n2', ids: ['osm:n2'] }, { id: 'osm:w3', ids: ['osm:w3'] }]);
  assert.deepEqual(out.map((x) => x.id), ['osm:w1', 'osm:w3']);
});

test('copie absente, vide ou illisible : aucune aire lue (l\'appli affiche « Aires indisponibles… »)', () => {
  const good = buildCopy(ELEMENTS, FRANCE).raw;
  assert.ok(parseIndex(good));
  for (const bad of [null, undefined, {}, 'texte', { ...good, grid: null }, { ...good, tiles: {} }, { ...good, count: 0 },
    { ...good, tiles: [] }, { ...good, grid: { ...good.grid, step: 0 } }]) {
    assert.equal(parseIndex(bad), null, JSON.stringify(bad)?.slice(0, 40));
  }
  assert.equal(parseTile(null), null);
  assert.equal(parseTile({ areas: 'x' }), null);
  assert.deepEqual(parseTile({ areas: [{ i: 'w1' }, null] }), []);
  // Date de la copie : affichée seulement si lisible.
  assert.equal(parseIndex({ ...good, updated: 'hier' }).updated, null);
  assert.equal(copyDateText('2026-12-01'), '01/12/2026');
  assert.equal(copyDateText(null), null);
  assert.equal(sourcesText({ sources: ['osm'] }), '© contributeurs OpenStreetMap (ODbL)');
});

test('cases : nom par coin sud-ouest, tracé lu tous les 500 m, marge de 1 km aux bords', () => {
  assert.equal(tileKey(4.83, 45.76), '4_45');
  assert.equal(tileKey(-1.2, 43.5), '-2_43');
  assert.equal(tilePath('4_45'), './data/aires-osm/4_45.json');
  const pts = samplePoints([[4, 45], [4.1, 45]]);
  assert.ok(pts.length >= 16 && pts.length <= 18);
  // Point à 300 m au sud de 46° N : la case du dessus est lue aussi (aire à 800 m de l'autre côté).
  const idx = { inside: () => true, tiles: { '4_45': 1, '4_46': 1, '5_45': 1 } };
  assert.deepEqual(routePlan([[4.5, 45.997], [4.51, 45.997]], idx).tiles, ['4_45', '4_46']);
  assert.ok(combineRoutes([LINE]).length === LINE.length);
});

test('vraie copie du dépôt (data/aires-osm/) : lisible, Paris → Lyon → Fréjus couvert sans Overpass', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const dir = new URL('../data/aires-osm/', import.meta.url);
  if (!existsSync(new URL('index.json', dir))) return; // copie pas encore créée par l'Action
  const index = parseIndex(JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')));
  assert.ok(index && index.count > 1000, 'index lisible');
  assert.ok(copyDateText(index.updated));
  const plan = routePlan(LINE, index);
  assert.equal(plan.uncovered.length, 0, 'trajet entièrement dans la zone couverte');
  const areas = plan.tiles.flatMap((k) => {
    const t = parseTile(JSON.parse(readFileSync(new URL(`${k}.json`, dir), 'utf8')), index.updated);
    assert.ok(t, k);
    return t;
  });
  assert.ok(areas.length > 100, `${areas.length} aires lues dans ${plan.tiles.length} cases`);
  assert.ok(areas.every((a) => /^osm:[nwr]\d+$/.test(a.id)));
  // Hors zone (Pologne) : non couvert.
  assert.equal(index.inside(21, 52.2), false);
  assert.equal(index.inside(2.35, 48.85), true);
});
