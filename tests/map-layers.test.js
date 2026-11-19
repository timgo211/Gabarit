// Couche de fond (phase 7) : zone couverte par les photos IGN, choix mémorisé, plan forcé en guidage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isInFrance, sanitizeMapLayer, satelliteView, IGN_ORTHO, SATELLITE_OUTSIDE_TEXT, MAP_LAYERS, DEFAULT_MAP_LAYER,
} from '../src/lib/map-layers.js';
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

test('satellite : photos en France, message hors de France, plan sans bouton en guidage', () => {
  assert.deepEqual(satelliteView({ layer: 'plan', center: IN.Paris }), { photos: false, message: '', button: true });
  assert.deepEqual(satelliteView({ layer: 'satellite', center: IN.Paris }), { photos: true, message: '', button: true });
  assert.deepEqual(satelliteView({ layer: 'satellite', center: OUT.Bruxelles }),
    { photos: false, message: SATELLITE_OUTSIDE_TEXT, button: true });
  assert.equal(SATELLITE_OUTSIDE_TEXT, 'Vue satellite disponible en France uniquement');
  assert.deepEqual(satelliteView({ layer: 'satellite', center: IN.Paris, navigating: true }),
    { photos: false, message: '', button: false });
  assert.equal(satelliteView({ layer: 'satellite', center: null }).photos, false);
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
