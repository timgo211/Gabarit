// Phase 2c-a : fond de carte OpenFreeMap recoloré aux couleurs Panier Perdu (src/lib/map-palette.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import {
  MAP_PALETTE, ROUTE_WIDTH, ROUTE_WIDTH_NAV, layerRole, mapPaintPatches, recolorStyle, streetLabelLayers, streetBubblePatches,
  STREET_BUBBLE, satellitePaint, photoLabelPatches, PHOTO_NIGHT_LABEL, NIGHT_PALETTES, NIGHT_BUBBLES, NIGHT_LEVELS,
  DEFAULT_NIGHT_LEVEL, mapPalette, sanitizeNightLevel, bubbleColors,
} from '../src/lib/map-palette.js';
import { contrastRatio, luminance, parseColor, AA_TEXT, AA_LARGE } from '../src/lib/contrast.js';

const relativeLuminance = (hex) => luminance(parseColor(hex));

const liberty = fixture('style-liberty-layers.json').layers;
const dark = fixture('style-dark-layers.json').layers;
const OURS = ['route-line', 'route-casing', 'zfe-fill', 'ign-ortho'];

const patch = (patches, id, prop) => patches.find((p) => p.id === id && p.prop === prop)?.value;

test('palette jour et nuit : valeurs Panier Perdu', () => {
  assert.equal(MAP_PALETTE.day.background, '#EDEAE3');
  assert.equal(MAP_PALETTE.night, NIGHT_PALETTES.normal, 'nuit par défaut : Normal (phase 2d)');
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

test('guidage : tracé épais, même bord de 2 px', () => {
  assert.equal((ROUTE_WIDTH_NAV.casing - ROUTE_WIDTH_NAV.line) / 2, 2);
  assert.equal((ROUTE_WIDTH_NAV.doneCasing - ROUTE_WIDTH_NAV.done) / 2, 2);
  assert.ok(ROUTE_WIDTH_NAV.line > ROUTE_WIDTH.line);
});

test('bulles des noms de rues en guidage, réglages d\'origine ensuite', () => {
  const layers = liberty;
  const streets = streetLabelLayers(layers).map((l) => l.id);
  assert.ok(streets.includes('highway-name-minor') && streets.includes('highway-name-major'));
  assert.ok(!streets.some((id) => /shield/.test(id)));
  const on = streetBubblePatches(layers, 'night', true);
  const minor = on.filter((p) => p.id === 'highway-name-minor');
  assert.equal(minor.find((p) => p.prop === 'icon-image').value, STREET_BUBBLE.image);
  assert.equal(minor.find((p) => p.prop === 'icon-text-fit').value, 'both');
  assert.equal(minor.find((p) => p.prop === 'text-color').value, STREET_BUBBLE.night.text);
  const off = streetBubblePatches([{ id: 'n', type: 'symbol', 'source-layer': 'transportation_name', layout: { 'symbol-placement': 'line' } }], 'day', false);
  assert.equal(off.find((p) => p.prop === 'symbol-placement').value, 'line');
  assert.equal(off.find((p) => p.prop === 'icon-text-fit').value, undefined, 'valeur par défaut de MapLibre');
  assert.ok(!off.some((p) => p.kind === 'paint'));
  for (const t of ['day', 'night']) assert.ok(contrastRatio(STREET_BUBBLE[t].text, STREET_BUBBLE[t].fill) >= AA_TEXT, t);
});

test('satellite la nuit : photos assombries, libellés clairs', () => {
  assert.deepEqual(satellitePaint('night'), { 'raster-brightness-max': 0.8 }, 'Normal (phase 2d)');
  assert.deepEqual(satellitePaint('night', 'dark'), { 'raster-brightness-max': 0.6 }, 'Sombre = v35');
  assert.deepEqual(satellitePaint('night', 'light'), { 'raster-brightness-max': 0.9 });
  assert.deepEqual(satellitePaint('day', 'dark'), { 'raster-brightness-max': 1 });
  assert.deepEqual(satellitePaint('day'), { 'raster-brightness-max': 1 });
  const layers = [{ id: 'place', type: 'symbol', paint: {} }, { id: 'road', type: 'line', 'source-layer': 'transportation' }];
  assert.deepEqual(photoLabelPatches(layers, 'night', true), [
    { id: 'place', prop: 'text-color', value: PHOTO_NIGHT_LABEL.text }, { id: 'place', prop: 'text-halo-color', value: PHOTO_NIGHT_LABEL.halo }]);
  assert.equal(photoLabelPatches(layers, 'night', false)[0].value, MAP_PALETTE.night.label);
  assert.ok(contrastRatio(PHOTO_NIGHT_LABEL.text, PHOTO_NIGHT_LABEL.halo) >= AA_TEXT);
});

// ───────── Phase 2d : trois niveaux de luminosité la nuit ─────────

test('nuit : Sombre = la v35 à l\'identique, Normal par défaut, valeur inconnue → Normal', () => {
  assert.deepEqual({ ...NIGHT_PALETTES.dark }, {
    background: '#14161C', land: '#1C1F28', building: '#22252F', water: '#17222C', park: '#1B2620',
    road: '#1C1F28', roadCasing: '#3A3E4A', major: '#2B2E37', majorCasing: '#6B6E78',
    label: '#A9A79E', halo: '#14161C',
  });
  assert.deepEqual({ ...NIGHT_BUBBLES.dark }, { fill: '#1C1F28', border: '#6B6E78', text: '#EDEAE3' });
  assert.deepEqual(NIGHT_LEVELS, ['dark', 'normal', 'light']);
  assert.equal(DEFAULT_NIGHT_LEVEL, 'normal');
  for (const x of [undefined, null, 'clair', 42]) assert.equal(sanitizeNightLevel(x), 'normal');
  assert.equal(mapPalette('night', 'light'), NIGHT_PALETTES.light);
  assert.equal(mapPalette('day', 'light'), MAP_PALETTE.day, 'le jour ne change pas');
  assert.equal(bubbleColors('day', 'dark'), STREET_BUBBLE.day);
});

test('nuit : chaque niveau plus clair que le précédent (fond, terre, bâti, routes)', () => {
  for (const k of ['background', 'land', 'building', 'road', 'major']) {
    const [d, n, l] = NIGHT_LEVELS.map((lv) => relativeLuminance(NIGHT_PALETTES[lv][k]));
    assert.ok(d < n && n < l, `${k} : ${d.toFixed(3)} < ${n.toFixed(3)} < ${l.toFixed(3)}`);
  }
});

test('nuit : écart plus net entre fond, bâti, routes et libellés (Normal et Clair)', () => {
  for (const lv of ['normal', 'light']) {
    const p = NIGHT_PALETTES[lv];
    const d = NIGHT_PALETTES.dark;
    assert.ok(contrastRatio(p.major, p.background) > contrastRatio(d.major, d.background), `${lv} : grands axes`);
    assert.ok(contrastRatio(p.road, p.background) > contrastRatio(d.road, d.background), `${lv} : routes`);
    assert.ok(contrastRatio(p.building, p.land) >= contrastRatio(d.building, d.land), `${lv} : bâti`);
    assert.ok(contrastRatio(p.label, p.background) > contrastRatio(d.label, d.background), `${lv} : libellés`);
  }
});

test('nuit : niveau appliqué au fond, aux bulles et aux libellés sur la carte plan', () => {
  const light = mapPaintPatches(dark, 'night', [], 'light');
  assert.equal(patch(light, 'background', 'background-color'), NIGHT_PALETTES.light.background);
  assert.equal(patch(light, 'highway_minor', 'line-color'), NIGHT_PALETTES.light.road);
  const sombre = recolorStyle({ layers: dark }, 'night', [], 'dark');
  assert.equal(sombre.layers.find((l) => l.id === 'background').paint['background-color'], '#14161C');
  const on = streetBubblePatches(liberty, 'night', true, 'light');
  assert.equal(on.find((p) => p.prop === 'text-color').value, NIGHT_BUBBLES.light.text);
  const layers = [{ id: 'place', type: 'symbol', paint: {} }];
  assert.equal(photoLabelPatches(layers, 'night', false, [], 'dark')[0].value, NIGHT_PALETTES.dark.label);
});
