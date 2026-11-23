// Limites de poids d'après OpenStreetMap (phase 12a bis) : copie data/poids-osm/ (Action) et tronçons suivis par
// l'itinéraire. Fixture osm-poids-colombier.geojsonseq SYNTHÉTIQUE (étiquettes réelles du chemin 190520091, Rue du
// Viaduc, non lisibles depuis le conteneur), posée sur le tracé de ors-directions-colombier.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  WEIGHTS, convertWeights, osmiumWeightsFilter, parseTonnes, probeLog, weightFromFeature, weightSizeProblem,
} from '../src/lib/weight-convert.js';
import {
  WEIGHT, WEIGHT_UNAVAILABLE_TEXT, mergeWeightTiles, parseWeightTile, weightLines, weightRules, weightText,
  weightsAlongRoute,
} from '../src/lib/weight-check.js';
import { parseGeojsonLine, parseIndex, routePlan } from '../src/lib/areas-osm-data.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { routeRules } from '../src/lib/route-rules.js';
import { routeDiagnosticText } from '../src/lib/route-diagnostic.js';
import { fromWeight, applies, validateRestriction } from '../src/lib/restrictions.js';

const features = readFileSync(new URL('./fixtures/osm-poids-colombier.geojsonseq', import.meta.url), 'utf8')
  .split('\n').map(parseGeojsonLine).filter(Boolean);
const route = parseDirections(JSON.parse(readFileSync(new URL('./fixtures/ors-directions-colombier.json', import.meta.url), 'utf8')));

function copy(list = features) {
  const ways = list.map(weightFromFeature).filter(Boolean);
  const conv = convertWeights(ways, { updated: '2026-11-21', grid: null, countries: ['france'] });
  const tiles = [...conv.tiles.values()].map((t) => parseWeightTile(JSON.parse(JSON.stringify(t))));
  return { conv, data: mergeWeightTiles(tiles) };
}

test('étiquettes : tonnes lisibles seulement, maxweight:hgv prioritaire, drapeau desserte', () => {
  assert.equal(parseTonnes('3.5'), 3.5);
  assert.equal(parseTonnes('3,5 t'), 3.5);
  assert.equal(parseTonnes('12t'), 12);
  for (const bad of ['3 st', '5000 lbs', 'none', 'default', '3.5;7.5', '0.5', '250', '', null]) assert.equal(parseTonnes(bad), null, String(bad));
  const byId = new Map(features.map((f) => [f.id, weightFromFeature(f)]));
  assert.equal(byId.get('w190520091').limit, 3.5);
  assert.equal(byId.get('w190520091').local, false);
  assert.equal(byId.get('w2003').local, true, 'hgv=destination');
  assert.equal(byId.get('w2006').limit, 19, 'maxweight:hgv prioritaire');
  assert.equal(byId.get('w2006').local, true, 'maxweight:conditional');
  assert.equal(byId.get('w2005'), null, 'tonnes courtes illisibles');
  assert.equal(byId.get('w2007'), null, 'chemin piéton écarté');
  assert.deepEqual(osmiumWeightsFilter(), ['w/maxweight', 'w/maxweight:hgv']);
});

test('copie : mêmes cases de 1° que les ponts, index, taille, simplification plus forte au-delà des limites', () => {
  const { conv } = copy();
  assert.deepEqual([...conv.tiles.keys()], ['6_47']);
  assert.equal(conv.index.count, 7);
  assert.equal(conv.index.tolerance, 3);
  assert.deepEqual(conv.index.tiles, { '6_47': 7 });
  assert.equal(conv.problem, null);
  assert.match(conv.log[0], /7 tronçons \(dont 2 « desserte possible »\)/);
  assert.equal(weightSizeProblem({ total: 31 * 1024 * 1024, biggest: ['2_48', 1000] }), 'total de 31.0 Mo (plus de 30 Mo)');
  assert.match(weightSizeProblem({ total: 6e6, biggest: ['2_48', 5.5 * 1024 * 1024] }), /case 2_48 de 5\.5 Mo/);
  assert.equal(WEIGHTS.MAX_TOTAL_BYTES, 30 * 1024 * 1024);
  assert.equal(WEIGHTS.MAX_FILE_BYTES, 5 * 1024 * 1024);
  assert.equal(WEIGHTS.DIR, './data/poids-osm/');
  // Ligne sinueuse dense : simplifiée à 3 m, puis plus fort si la copie ne tient pas (essai avec une limite réduite).
  assert.deepEqual(WEIGHTS.TOLERANCES_M, [3, 8, 20]);
  // Index lisible par le lecteur des copies par cases (routePlan, comme data/ponts-osm/).
  const idx = parseIndex({ ...conv.index, grid: { lon0: 6, lat0: 47, step: 0.1, cols: 10, rows: 10, bits: Buffer.alloc(13, 255).toString('base64') } });
  assert.ok(idx);
  assert.deepEqual(routePlan(route.coordinates, idx).tiles, ['6_47']);
});

test('journal : étiquettes du chemin 190520091 (Rue du Viaduc) ou absence', () => {
  assert.match(probeLog(features[0]), /^Chemin 190520091 \(Rue du Viaduc, Colombier\) : name=Rue du Viaduc ; highway=residential ; maxweight=3\.5\.$/);
  assert.match(probeLog(null), /absent du filtrage/);
});

test('tronçons suivis par le tracé sous le PTAC : jamais un croisement, une parallèle à 37 m ni une route en biais', () => {
  const { data } = copy();
  const r = weightsAlongRoute(route, data, { ptac: 44 });
  assert.deepEqual(r.items.map((i) => i.id), [190520091, 2003, 2006]);
  const viaduc = r.items[0];
  assert.equal(viaduc.limit, 3.5);
  assert.equal(viaduc.local, false);
  assert.ok(Math.abs(viaduc.point[0] - 6.2105) < 1e-6 && viaduc.point[1] > 47.659 && viaduc.point[1] < 47.661, 'milieu du passage sur le tracé');
  assert.ok(viaduc.length > 400 && viaduc.length < 500, `passage de ≈ 445 m (${viaduc.length})`);
  assert.equal(viaduc.text, "Limite de poids de 3,5 t d'après OpenStreetMap, que le calcul n'a peut-être pas prise en compte : à vérifier. La signalisation fait foi.");
  assert.equal(r.items[1].text, "Limite de poids de 12 t d'après OpenStreetMap (desserte locale possible), que le calcul n'a peut-être pas prise en compte : à vérifier. La signalisation fait foi.");
  assert.equal(r.items[2].limit, 19, 'pont court de 11 m compté');
  assert.equal(r.counts.local, 2);
  assert.ok(!r.items.some((i) => [2001, 2002, 2004, 2008].includes(i.id)));
  // PTAC égal à la limite : admis (le panneau B13 interdit au-delà).
  assert.deepEqual(weightsAlongRoute(route, data, { ptac: 12 }).items.map((i) => i.id), [190520091]);
  assert.deepEqual(weightsAlongRoute(route, data, { ptac: 3.5 }).items, []);
  assert.deepEqual(weightsAlongRoute(route, data, { ptac: null }).items, []);
});

test('fiche : 5 lignes au plus puis « +N », résumé, ligne technique, réglage, copie absente', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ id: i, limit: 3.5, local: false, along: i * 1000, text: weightText(3.5) }));
  const lines = weightLines(many);
  assert.equal(lines.length, 6);
  assert.equal(lines[5].text, '+2 limites de poids à vérifier (voir la carte).');
  assert.match(lines[0].text, /\(km 0\)$/);
  const { data } = copy();
  const vehicle = { weight: 44, height: 4 };
  const ok = weightRules(route, { vehicle, weights: { status: 'ok', data } });
  assert.equal(ok.tech, 'Limites de poids : 3');
  assert.deepEqual(ok.short, ['3 limites de poids à vérifier']);
  assert.equal(ok.lines.length, 3);
  assert.ok(ok.lines.every((l) => l.level === 'warn' && /à vérifier\. La signalisation fait foi\./.test(l.text)));
  assert.equal(weightRules(route, { vehicle, weights: { status: 'ok', data }, enabled: false }).lines.length, 0);
  const off = weightRules(route, { vehicle, weights: { status: 'failed', data: { ways: [] } } });
  assert.deepEqual(off.lines, [{ level: 'info', text: WEIGHT_UNAVAILABLE_TEXT }]);
  assert.equal(off.tech, 'Limites de poids : données non chargées');
  // Réglementation complète et diagnostic : ligne technique « Limites de poids : N ».
  const rules = routeRules(route, { vehicle, weightLimits: { status: 'ok', data }, weightWarnings: true });
  assert.equal(rules.weightLimits.items.length, 3);
  assert.ok(rules.lines.some((l) => l.text.startsWith('Limite de poids de 3,5 t')));
  assert.ok(rules.short.includes('3 limites de poids à vérifier'));
  assert.ok(routeDiagnosticText(route, { rules }).includes('Limites de poids : 3'));
  // Jamais de voix ni de bandeau : aucune donnée de poids dans les règles du guidage.
  assert.equal(WEIGHT.MAX_SHOWN, 5);
});

test('« Éviter ce passage » : restriction de poids au point du tracé, appliquée au PTAC du profil', () => {
  const { data } = copy();
  const it = weightsAlongRoute(route, data, { ptac: 44 }).items[0];
  const r = validateRestriction(fromWeight(it, { now: new Date('2026-11-23T10:00:00Z') }), { makeId: () => 'x' });
  assert.equal(r.type, 'weight');
  assert.equal(r.value, 3.5);
  assert.equal(r.origin, 'osm-weight');
  assert.equal(r.osmId, 190520091);
  assert.equal(r.lat, it.point[1]);
  assert.equal(r.lon, it.point[0]);
  assert.equal(r.date, '2026-11-23');
  assert.ok(applies(r, { weight: 44 }));
  assert.ok(!applies(r, { weight: 3.5 }));
});
