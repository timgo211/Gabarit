// v65 : aplats du plan (bâtiments, aéroports…) masqués au-dessus des photos aériennes (src/lib/photo-cover.js).
// Fixtures : ordre réel des couches OpenFreeMap liberty et dark (github.com/hyperknot/openfreemap-styles, 24/11/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { isCoverLayer, photoCoverLayers, photoCoverPatches } from '../src/lib/photo-cover.js';

const SAT = ['ign-ortho', 'sat-es'];
const KEEP = ['route-casing', 'route-line', 'zfe-fill', 'zfe-line', ...SAT];

/** Style tel que la carte le montre : photos puis ZFE avant le premier libellé (addSatelliteLayer, addZfeLayers). */
function withOverlay(layers) {
  const out = layers.map((l) => ({ ...l }));
  const at = out.findIndex((l) => l.type === 'symbol');
  out.splice(at, 0, ...SAT.map((id) => ({ id, type: 'raster' })), { id: 'zfe-fill', type: 'fill' }, { id: 'zfe-line', type: 'line' });
  out.push({ id: 'route-casing', type: 'line' }, { id: 'route-line', type: 'line' });
  return out;
}

const liberty = withOverlay(fixture('style-liberty-layers.json').layers);
const dark = withOverlay(fixture('style-dark-layers.json').layers);

test('liberty : bâtiments fill et fill-extrusion au-dessus des photos (cause du « film »)', () => {
  const idx = (id) => liberty.findIndex((l) => l.id === id);
  assert.ok(idx('building') > idx('ign-ortho') && idx('building-3d') > idx('ign-ortho'), 'ordre réel du style');
  assert.deepEqual(photoCoverLayers(liberty, SAT, KEEP), ['building', 'building-3d']);
});

test('dark : bâtiments, aéroports et quais au-dessus des photos', () => {
  assert.deepEqual(photoCoverLayers(dark, SAT, KEEP), ['building', 'aeroway-area', 'road_area_pier']);
});

test('routes, libellés et couches de Gabarit jamais masqués', () => {
  for (const layers of [liberty, dark]) {
    const ids = new Set(photoCoverLayers(layers, SAT, KEEP));
    for (const l of layers) {
      if (l.type === 'symbol' || KEEP.includes(l.id)) assert.ok(!ids.has(l.id), l.id);
      if (l.type === 'line' && !/^building/.test(l['source-layer'] ?? '')) assert.ok(!ids.has(l.id), l.id);
    }
  }
});

test('aplats sous les photos laissés (déjà recouverts par l\'image)', () => {
  const ids = photoCoverLayers(liberty, SAT, KEEP);
  for (const id of ['background', 'park', 'landuse_residential', 'water', 'road_area_pattern']) assert.ok(!ids.includes(id), id);
});

test('sans couche de photos dans le style : rien à masquer', () => {
  assert.deepEqual(photoCoverLayers(fixture('style-liberty-layers.json').layers, SAT, KEEP), []);
  assert.deepEqual(photoCoverLayers(null, SAT, KEEP), []);
  assert.deepEqual(photoCoverPatches(undefined, { photos: true, satIds: SAT }).patches, []);
});

test('isCoverLayer : aplats et contours de bâtiments seulement', () => {
  assert.equal(isCoverLayer({ id: 'b', type: 'fill' }), true);
  assert.equal(isCoverLayer({ id: 'b', type: 'fill-extrusion' }), true);
  assert.equal(isCoverLayer({ id: 'b', type: 'hillshade' }), true);
  assert.equal(isCoverLayer({ id: 'b:outline', type: 'line', 'source-layer': 'buildings' }), true);
  assert.equal(isCoverLayer({ id: 'r', type: 'line', 'source-layer': 'transportation' }), false);
  assert.equal(isCoverLayer({ id: 's', type: 'symbol' }), false);
  assert.equal(isCoverLayer(null), false);
});

test('photos montrées → masqués ; Plan → rendus ; deux fois de suite → aucun patch', () => {
  let r = photoCoverPatches(liberty, { photos: true, satIds: SAT, keep: KEEP });
  assert.deepEqual(r.patches, [{ id: 'building', value: 'none' }, { id: 'building-3d', value: 'none' }]);
  const again = photoCoverPatches(liberty, { photos: true, satIds: SAT, keep: KEEP, hidden: r.hidden });
  assert.deepEqual(again.patches, [], 'déjà masqués');
  r = photoCoverPatches(liberty, { photos: false, satIds: SAT, keep: KEEP, hidden: again.hidden });
  assert.deepEqual(r.patches, [{ id: 'building', value: 'visible' }, { id: 'building-3d', value: 'visible' }]);
  assert.equal(r.hidden.size, 0);
  assert.deepEqual(photoCoverPatches(liberty, { photos: false, satIds: SAT, keep: KEEP, hidden: r.hidden }).patches, []);
});

test('aplat masqué par le style lui-même : jamais rallumé', () => {
  const layers = liberty.map((l) => (l.id === 'building-3d' ? { ...l, layout: { visibility: 'none' } } : l));
  const on = photoCoverPatches(layers, { photos: true, satIds: SAT, keep: KEEP });
  assert.deepEqual(on.patches, [{ id: 'building', value: 'none' }]);
  const off = photoCoverPatches(layers, { photos: false, hidden: on.hidden });
  assert.deepEqual(off.patches, [{ id: 'building', value: 'visible' }]);
});

test('nouveau style (thème) : couche retenue absente → rien à rallumer pour elle', () => {
  const off = photoCoverPatches(dark, { photos: false, hidden: new Set(['building-3d', 'building']) });
  assert.deepEqual(off.patches, [{ id: 'building', value: 'visible' }]);
});

test('« hidden » donné jamais modifié', () => {
  const hidden = new Set();
  photoCoverPatches(liberty, { photos: true, satIds: SAT, keep: KEEP, hidden });
  assert.equal(hidden.size, 0);
});
