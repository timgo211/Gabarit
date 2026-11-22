// Phase 2c-a : fond de carte OpenFreeMap recoloré aux couleurs Panier Perdu (src/lib/map-palette.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { MAP_PALETTE, ROUTE_WIDTH, layerRole, mapPaintPatches, recolorStyle } from '../src/lib/map-palette.js';
import { contrastRatio } from '../src/lib/contrast.js';

const liberty = fixture('style-liberty-layers.json').layers;
const dark = fixture('style-dark-layers.json').layers;
const OURS = ['route-line', 'route-casing', 'zfe-fill', 'ign-ortho'];

const patch = (patches, id, prop) => patches.find((p) => p.id === id && p.prop === prop)?.value;

test('palette jour et nuit : valeurs Panier Perdu', () => {
  assert.equal(MAP_PALETTE.day.background, '#EDEAE3');
  assert.equal(MAP_PALETTE.night.background, '#14161C');
  assert.equal(MAP_PALETTE.night.majorCasing, '#6B6E78');
  for (const t of ['day', 'night']) {
    const p = MAP_PALETTE[t];
    for (const v of Object.values(p)) assert.match(v, /^#[0-9A-F]{6}$/);
    assert.ok(contrastRatio(p.label, p.halo) >= 4.5, `libellés lisibles (${t})`);
  }
});

test('liberty (jour) : chaque groupe de couches reçoit sa couleur', () => {
  const p = mapPaintPatches(liberty, 'day');
  const d = MAP_PALETTE.day;
  assert.equal(patch(p, 'background', 'background-color'), d.background);
  assert.equal(patch(p, 'water', 'fill-color'), d.water);
  assert.equal(patch(p, 'waterway_river', 'line-color'), d.water);
  assert.equal(patch(p, 'park', 'fill-color'), d.park);
  assert.equal(patch(p, 'park', 'fill-outline-color'), d.park);
  assert.equal(patch(p, 'landcover_wood', 'fill-color'), d.park);
  assert.equal(patch(p, 'landuse_residential', 'fill-color'), d.land);
  assert.equal(patch(p, 'building', 'fill-color'), d.building);
  assert.equal(patch(p, 'road_minor', 'line-color'), d.road);
  assert.equal(patch(p, 'road_minor_casing', 'line-color'), d.roadCasing);
  assert.equal(patch(p, 'road_motorway', 'line-color'), d.major);
  assert.equal(patch(p, 'road_trunk_primary_casing', 'line-color'), d.majorCasing);
  assert.equal(patch(p, 'bridge_motorway_casing', 'line-color'), d.majorCasing);
  assert.equal(patch(p, 'label_city', 'text-color'), d.label);
  assert.equal(patch(p, 'label_city', 'text-halo-color'), d.halo);
  // Laissés tels quels : rails, frontières, boucliers, raster.
  for (const id of ['road_major_rail', 'road_major_rail_hatching', 'boundary_2', 'highway-shield-non-us', 'natural_earth']) {
    assert.equal(p.some((x) => x.id === id), false, id);
  }
  // Halo ajouté seulement là où il existe déjà.
  assert.equal(patch(p, 'highway-name-minor', 'text-halo-color'), undefined);
});

test('dark (nuit) : routes, grands axes et libellés', () => {
  const p = mapPaintPatches(dark, 'night');
  const n = MAP_PALETTE.night;
  assert.equal(patch(p, 'background', 'background-color'), n.background);
  assert.equal(patch(p, 'water', 'fill-color'), n.water);
  assert.equal(patch(p, 'landuse_park', 'fill-color'), n.park);
  assert.equal(patch(p, 'highway_minor', 'line-color'), n.road);
  assert.equal(patch(p, 'highway_major_casing', 'line-color'), n.majorCasing);
  assert.equal(patch(p, 'highway_motorway_inner', 'line-color'), n.major);
  assert.equal(patch(p, 'place_city', 'text-color'), n.label);
  assert.equal(p.some((x) => x.id === 'railway'), false);
  assert.equal(p.some((x) => x.id === 'road_pier'), false);
});

test('couches de Gabarit jamais touchées, seules les couleurs changent', () => {
  const layers = [
    ...OURS.map((id) => ({ id, type: 'line', 'source-layer': 'transportation', paint: { 'line-color': '#E8A93B' } })),
    { id: 'road_minor', type: 'line', 'source-layer': 'transportation', paint: { 'line-color': '#fff', 'line-width': 4, 'line-opacity': 0.5 } },
  ];
  const style = { version: 8, sources: {}, layers };
  const out = recolorStyle(style, 'day', OURS);
  for (const id of OURS) assert.equal(out.layers.find((l) => l.id === id).paint['line-color'], '#E8A93B');
  assert.deepEqual(out.layers.at(-1).paint, { 'line-color': MAP_PALETTE.day.road, 'line-width': 4, 'line-opacity': 0.5 });
  assert.equal(style.layers.at(-1).paint['line-color'], '#fff', 'style d\'origine non modifié');
  assert.deepEqual(out.layers.map((l) => l.id), layers.map((l) => l.id), 'ordre gardé');
  assert.equal(recolorStyle(null, 'day'), null);
  assert.deepEqual(mapPaintPatches(undefined, 'day'), []);
});

test('schéma Shortbread (VersaTiles, secours) reconnu', () => {
  assert.equal(layerRole({ id: 'water-ocean', type: 'fill', 'source-layer': 'ocean' }), 'water');
  assert.equal(layerRole({ id: 'street-motorway:outline', type: 'line', 'source-layer': 'streets' }), 'majorCasing');
  assert.equal(layerRole({ id: 'street-residential', type: 'line', 'source-layer': 'streets' }), 'road');
  assert.equal(layerRole({ id: 'land-park', type: 'fill', 'source-layer': 'land' }), 'park');
  assert.equal(layerRole({ id: 'building', type: 'fill', 'source-layer': 'buildings' }), 'building');
  assert.equal(layerRole({ id: 'boundary-country', type: 'line', 'source-layer': 'boundaries' }), null);
});

test('tracé : bord sombre de 2 px de chaque côté, à tous les zooms (largeurs fixes)', () => {
  assert.equal((ROUTE_WIDTH.casing - ROUTE_WIDTH.line) / 2, 2);
  assert.equal((ROUTE_WIDTH.altCasing - ROUTE_WIDTH.altLine) / 2, 2);
  for (const v of Object.values(ROUTE_WIDTH)) assert.equal(typeof v, 'number');
});
