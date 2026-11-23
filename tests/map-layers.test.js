// Couche de fond (phases 7 et 7d) : zones couvertes par les photos (IGN, orthophotos voisines), choix mémorisé, guidage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isInFrance, sanitizeMapLayer, satelliteView, IGN_ORTHO, SATELLITE_OUTSIDE_TEXT, MAP_LAYERS, DEFAULT_MAP_LAYER,
  SATELLITE_SOURCES, SATELLITE_READ, satelliteSourceAt, satelliteCredits,
} from '../src/lib/map-layers.js';
import { SATELLITE_ZONES } from '../src/lib/satellite-zones.js';
import { cacheStrategy } from '../src/lib/sw-routing.js';

const IN = {
  Paris: [2.3522, 48.8566], Lyon: [4.8357, 45.764], Lille: [3.0573, 50.6292], Strasbourg: [7.7521, 48.5734],
  Brest: [-4.4861, 48.3904], Bayonne: [-1.4748, 43.4929], Perpignan: [2.8948, 42.6887], Nice: [7.262, 43.7102],
  Annecy: [6.1294, 45.8992], Chamonix: [6.8694, 45.9237], Dunkerque: [2.3768, 51.0343], Mulhouse: [7.3389, 47.7508],
  Ajaccio: [8.7369, 41.9192], Bastia: [9.4509, 42.6973], 'Pointe-à-Pitre': [-61.534, 16.241],
  'Fort-de-France': [-61.0588, 14.6161], Cayenne: [-52.3135, 4.9224], 'Saint-Denis (Réunion)': [55.4481, -20.8823],
  Mamoudzou: [45.2279, -12.7806],
};
const OUT = {
  Bruxelles: [4.3517, 50.8503], Luxembourg: [6.1296, 49.6116], Sarrebruck: [7.0, 49.2402], Kehl: [7.86, 48.57],
  Bâle: [7.5886, 47.5596], Genève: [6.1432, 46.2044], Lausanne: [6.6323, 46.5197], Turin: [7.6869, 45.0703],
  Barcelone: [2.1734, 41.3851], 'Saint-Sébastien': [-1.9812, 43.3183], Andorre: [1.5218, 42.5063],
  Jersey: [-2.1312, 49.2144], Londres: [-0.1276, 51.5072], Madrid: [-3.7038, 40.4168], Sardaigne: [9.1, 40.0],
};

test('zone des photos IGN : villes de France (métropole, Corse, outre-mer) et voisines', () => {
  for (const [name, p] of Object.entries(IN)) assert.equal(isInFrance(p), true, name);
  for (const [name, p] of Object.entries(OUT)) assert.equal(isInFrance(p), false, name);
  for (const p of [null, [], [2], [NaN, 48], ['2', '48']]) assert.equal(isInFrance(p), false);
});

test('choix de couche mémorisé : plan par défaut', () => {
  assert.deepEqual(MAP_LAYERS, ['plan', 'satellite']);
  assert.equal(DEFAULT_MAP_LAYER, 'plan');
  assert.equal(sanitizeMapLayer('satellite'), 'satellite');
  for (const x of [undefined, null, '', 'SATELLITE', 'hybride', 3]) assert.equal(sanitizeMapLayer(x), 'plan');
});

test('satellite : photos en France, message hors de toute source ; en guidage aussi (phase 7c), sans les boutons de l\'arrêt', () => {
  assert.deepEqual(satelliteView({ layer: 'plan', center: IN.Paris }), { photos: false, message: '', button: true, source: null });
  assert.deepEqual(satelliteView({ layer: 'satellite', center: IN.Paris }), { photos: true, message: '', button: true, source: 'ign' });
  assert.deepEqual(satelliteView({ layer: 'satellite', center: OUT.Turin }),
    { photos: false, message: SATELLITE_OUTSIDE_TEXT, button: true, source: null });
  assert.equal(SATELLITE_OUTSIDE_TEXT, 'Vue satellite indisponible à cet endroit');
  assert.deepEqual(satelliteView({ layer: 'satellite', center: IN.Paris, navigating: true }),
    { photos: true, message: '', button: false, source: 'ign' });
  assert.deepEqual(satelliteView({ layer: 'plan', center: IN.Paris, navigating: true }),
    { photos: false, message: '', button: false, source: null });
  assert.deepEqual(satelliteView({ layer: 'satellite', center: OUT.Turin, navigating: true }),
    { photos: false, message: SATELLITE_OUTSIDE_TEXT, button: false, source: null });
  assert.equal(satelliteView({ layer: 'satellite', center: null }).photos, false);
});

// ───────── Phase 7d : orthophotos hors de France ─────────
const ABROAD = {
  Luxembourg: [[6.1296, 49.6116], 'lu'], Esch: [5.98, 49.495], Bruxelles: [[4.3517, 50.8503], 'be-bru'],
  Berne: [[7.4474, 46.948], 'ch'], Lausanne: [[6.6323, 46.5197], 'ch'], Genève: [[6.1432, 46.2044], 'ch'], Bâle: [[7.5886, 47.5596], 'ch'],
  Madrid: [[-3.7038, 40.4168], 'es'], Barcelone: [[2.1734, 41.3851], 'es'], 'Saint-Sébastien': [[-1.9812, 43.3183], 'es'],
  Cologne: [[6.958, 50.941], 'de-nw'], Aix: [[6.0839, 50.7753], 'de-nw'], Trèves: [[6.641, 49.756], 'de-rp'], Mayence: [[8.2473, 49.9929], 'de-rp'],
};

test('7d : source choisie selon la position (une ville par pays codé, France prioritaire)', () => {
  for (const [name, v] of Object.entries(ABROAD)) {
    if (!Array.isArray(v[0])) continue;
    assert.equal(satelliteSourceAt(v[0])?.id, v[1], name);
    assert.deepEqual(satelliteView({ layer: 'satellite', center: v[0] }), { photos: true, message: '', button: true, source: v[1] }, name);
  }
  for (const [name, p] of Object.entries(IN)) assert.equal(satelliteSourceAt(p)?.id, 'ign', name);
});

test('7d : hors de toute source codée → aucune source, message (Flandre, Wallonie, Sarre, Italie, mer, Andorre)', () => {
  const none = {
    Gand: [3.7174, 51.0543], Namur: [4.8719, 50.4674], Sarrebruck: [7.0, 49.2402], Turin: OUT.Turin, Sardaigne: OUT.Sardaigne, Londres: OUT.Londres,
    Andorre: OUT.Andorre, 'Golfe de Gascogne': [-4, 45.5],
  };
  for (const [name, p] of Object.entries(none)) {
    assert.equal(satelliteSourceAt(p), null, name);
    assert.deepEqual(satelliteView({ layer: 'satellite', center: p }), { photos: false, message: SATELLITE_OUTSIDE_TEXT, button: true, source: null }, name);
  }
  for (const p of [null, [], [NaN, 1], ['6', '49']]) assert.equal(satelliteSourceAt(p), null);
});

test('v58 : Bade-Wurtemberg, Bavière, Hesse ; Strasbourg reste IGN, Bâle reste suisse', () => {
  assert.equal(satelliteSourceAt([7.85, 47.995])?.id, 'de-bw', 'Fribourg-en-Brisgau');
  assert.equal(satelliteSourceAt([11.575, 48.137])?.id, 'de-by', 'Munich');
  assert.equal(satelliteSourceAt([8.682, 50.11])?.id, 'de-he', 'Francfort');
  assert.equal(satelliteSourceAt([7.75, 48.58])?.id, 'ign', 'Strasbourg (France d\'abord)');
  assert.equal(satelliteSourceAt([7.59, 47.56])?.id, 'ch', 'Bâle');
});

test('7d : frontière entre deux sources (France / Suisse à Vallorbe, France / Espagne à Hendaye, France / Luxembourg)', () => {
  assert.equal(satelliteSourceAt([6.3786, 46.7123])?.id, 'ch', 'Vallorbe (CH)');
  assert.equal(satelliteSourceAt([6.3417, 46.7820])?.id, 'ign', 'Jougne (FR)');
  assert.equal(satelliteSourceAt([-1.7616, 43.3598])?.id, 'ign', 'Hendaye (FR)');
  assert.equal(satelliteSourceAt([-1.7891, 43.3381])?.id, 'es', 'Irun (ES)');
  assert.equal(satelliteSourceAt([6.1667, 49.4667])?.id, 'ign', 'Thionville (FR)');
  assert.equal(satelliteSourceAt([6.1131, 49.5847])?.id, 'lu', 'Strassen (LU)');
});

test('7d : chaque source a une attribution, une licence lue, aucune clé, tuiles jamais mises en cache', () => {
  assert.equal(SATELLITE_SOURCES[0].id, 'ign', 'la France d\'abord');
  assert.deepEqual(SATELLITE_SOURCES.map((x) => x.id), ['ign', 'lu', 'be-bru', 'ch', 'es', 'de-nw', 'de-rp', 'de-bw', 'de-by', 'de-he']);
  assert.equal(new Set(SATELLITE_SOURCES.map((x) => x.layer)).size, SATELLITE_SOURCES.length);
  assert.equal(SATELLITE_READ, 'lu le 23/11/2026 (journal de l\'Action Textes officiels)');
  for (const src of SATELLITE_SOURCES) {
    assert.ok(src.attribution && src.attributionText && src.licence && /^https:\/\//.test(src.licenceUrl), src.id);
    assert.equal(src.tiles.length, 1, src.id);
    const [url] = src.tiles;
    assert.match(url, /^https:\/\//, src.id);
    assert.ok(/\{bbox-epsg-3857\}/.test(url) || (/\{z\}/.test(url) && /\{x\}/.test(url) && /\{y\}/.test(url)), src.id);
    assert.doesNotMatch(url, /apikey|api_key|[?&]key=|token/i, src.id);
    const tile = url.replace('{z}', '17').replace('{y}', '45000').replace('{x}', '66000').replace('{bbox-epsg-3857}', '0,0,1,1');
    assert.equal(cacheStrategy('GET', tile, 'https://timgo211.github.io'), 'bypass', src.id);
    assert.ok(src.zone === null || SATELLITE_ZONES[src.zone]?.length > 0, `${src.id} : zone`);
  }
  assert.match(SATELLITE_SOURCES.find((x) => x.id === 'ch').attributionText, /swisstopo/);
  assert.match(SATELLITE_SOURCES.find((x) => x.id === 'es').attributionText, /© Instituto Geográfico Nacional de España/);
  assert.match(SATELLITE_SOURCES.find((x) => x.id === 'de-rp').attributionText, /^©GeoBasis-DE \/ LVermGeoRP2026, dl-de\/by-2-0, www\.lvermgeo\.rlp\.de$/);
  // v58 : Bade-Wurtemberg (mention imposée par le LGL), Bavière (CC BY 4.0), Hesse (open data).
  assert.match(SATELLITE_SOURCES.find((x) => x.id === 'de-bw').attributionText, /^LGL-BW \(2026\) Datenlizenz Deutschland – Namensnennung – Version 2\.0, www\.lgl-bw\.de$/);
  assert.match(SATELLITE_SOURCES.find((x) => x.id === 'de-bw').tiles[0], /VERSION=1\.1\.1.*SRS=EPSG:3857/);
  assert.match(SATELLITE_SOURCES.find((x) => x.id === 'de-by').attributionText, /Bayerische Vermessungsverwaltung.*CC BY 4\.0/);
  assert.match(SATELLITE_SOURCES.find((x) => x.id === 'de-he').attributionText, /Hessische Verwaltung für Bodenmanagement und Geoinformation/);
  const credits = satelliteCredits();
  assert.equal(credits.length, SATELLITE_SOURCES.length);
  assert.ok(credits.every((c) => /^.+ : .+ — .+$/.test(c.text)));
  assert.match(credits[0].text, /^France : © IGN – Géoplateforme — Licence Ouverte/);
});

test('tuiles IGN : WMTS Géoplateforme sans clé, jamais mises en cache par le service worker', () => {
  const [url] = IGN_ORTHO.tiles;
  assert.match(url, /^https:\/\/data\.geopf\.fr\/wmts\?/);
  for (const p of ['LAYER=ORTHOIMAGERY.ORTHOPHOTOS', 'TILEMATRIXSET=PM', 'FORMAT=image/jpeg', 'STYLE=normal',
    'TILEMATRIX={z}', 'TILEROW={y}', 'TILECOL={x}']) assert.ok(url.includes(p), p);
  assert.doesNotMatch(url, /apikey|api_key|key=/i);
  assert.equal(IGN_ORTHO.maxzoom, 19);
  assert.equal(IGN_ORTHO.tileSize, 256);
  assert.match(IGN_ORTHO.attribution, /IGN/);
  const tile = url.replace('{z}', '17').replace('{y}', '45000').replace('{x}', '66000');
  assert.equal(cacheStrategy('GET', tile, 'https://exemple.github.io'), 'bypass');
});

test('changement de thème : photos IGN et tracés recopiés dans le nouveau style (carryOverlay)', async () => {
  const { carryOverlay } = await import('../src/lib/map-layers.js');
  const prev = {
    sources: { base: { type: 'vector' }, 'ign-ortho': { type: 'raster', tiles: ['t'] }, route: { type: 'geojson', data: { a: 1 } } },
    layers: [
      { id: 'bg', type: 'background' }, { id: 'ign-ortho', type: 'raster', source: 'ign-ortho', layout: { visibility: 'visible' } },
      { id: 'labels', type: 'symbol', source: 'base' }, { id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#00f', 'line-width': 7 } },
    ],
  };
  const next = {
    sources: { base: { type: 'vector', url: 'nuit' } },
    layers: [{ id: 'bg', type: 'background' }, { id: 'roads', type: 'line', source: 'base' }, { id: 'labels', type: 'symbol', source: 'base' }],
  };
  const out = carryOverlay(prev, next, {
    below: ['ign-ortho'], above: ['route-line', 'route-absent'], paint: { 'route-line': { 'line-color': '#fb0' } },
  });
  assert.deepEqual(out.layers.map((l) => l.id), ['bg', 'roads', 'ign-ortho', 'labels', 'route-line']);
  assert.equal(out.layers[2].layout.visibility, 'visible');
  assert.deepEqual(out.layers[4].paint, { 'line-color': '#fb0', 'line-width': 7 });
  assert.deepEqual(Object.keys(out.sources).sort(), ['base', 'ign-ortho', 'route']);
  assert.equal(out.sources.base.url, 'nuit');
  assert.deepEqual(out.sources.route.data, { a: 1 });
  assert.equal(next.layers.length, 3, 'nouveau style non modifié');
  // Sans libellés : photos tout en haut du fond, sous les tracés. Pas de style précédent : rien à recopier.
  const noSym = carryOverlay(prev, { sources: {}, layers: [{ id: 'bg', type: 'background' }] }, { below: ['ign-ortho'], above: ['route-line'] });
  assert.deepEqual(noSym.layers.map((l) => l.id), ['bg', 'ign-ortho', 'route-line']);
  assert.deepEqual(carryOverlay(undefined, next, { below: ['ign-ortho'] }).layers.map((l) => l.id), ['bg', 'roads', 'labels']);
});

test('guidage : démarre en plan ; le bouton propose l\'autre couche', async () => {
  const { GUIDANCE_START_LAYER, guidanceLayerButton } = await import('../src/lib/map-layers.js');
  assert.equal(GUIDANCE_START_LAYER, 'plan');
  assert.equal(guidanceLayerButton('plan').next, 'satellite');
  assert.equal(guidanceLayerButton('satellite').next, 'plan');
  assert.equal(guidanceLayerButton('n\'importe quoi').next, 'satellite');
});
