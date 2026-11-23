// v50 : non-régression des contours (Admin Express) de data/taxes-pl.json. Résultats de la phase 5h ter figés AVANT le
// remplacement des contours COG 2018 (tests/fixtures/taxes-5hter-attendu.json, 23/11/2026) : Mulhouse → Strasbourg
// (R-Pass, Eurométropole exclue), Metz → Nancy et Nancy → Metz (ECPL sur l'A31 ; sens inverse construit depuis
// ors-directions-metz-nancy.json), Belfort → Mulhouse, et le réseau converti de osm-tolls.geojsonseq (km gardés par
// référence et par taxe, dont l'A31 au sud de Toul). Thionville → Toul : aucune fixture, non testé ici.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDirections } from '../src/lib/ors-response.js';
import { parseTollData, tollRules, tollsAlongRoute } from '../src/lib/hgv-tolls.js';
import { tollWayFromFeature, parseTollNetwork } from '../src/lib/hgv-tolls-geo.js';
import { convertTollNetwork } from '../src/lib/hgv-tolls-convert.js';
import { parseGeojsonLine } from '../src/lib/areas-osm-data.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const expected = JSON.parse(fx('taxes-5hter-attendu.json'));
const real = parseTollData(JSON.parse(readFileSync(new URL('../data/taxes-pl.json', import.meta.url), 'utf8')));
const ways = fx('osm-tolls.geojsonseq').split('\n').map(parseGeojsonLine).map(tollWayFromFeature).filter(Boolean);
const converted = convertTollNetwork(ways, real, { updated: '2026-12-01' });
const network = parseTollNetwork(JSON.parse(JSON.stringify(converted.json)));
const dep = new Date(2026, 10, 25, 9, 0);
const truck = { weight: 19, euroClass: '6' };
const unnamed = (r) => ({ ...r, steps: r.steps.map((s) => ({ ...s, name: '-' })) });
/** Itinéraire parcouru à l'envers (points, étapes et pays). */
function reverse(r) {
  const n = r.coordinates.length - 1;
  return {
    ...r,
    coordinates: [...r.coordinates].reverse(),
    steps: [...r.steps].reverse().map((s) => ({ ...s, wayPoints: s.wayPoints ? [n - s.wayPoints[1], n - s.wayPoints[0]] : null })),
    countries: r.countries ? r.countries.map((c) => ({ ...c, from: n - c.to, to: n - c.from })).reverse() : r.countries,
  };
}
const route = (n) => parseDirections(JSON.parse(fx(n)));
const scenarios = {
  'Mulhouse → Strasbourg': unnamed(route('ors-directions-alsace.json')),
  'Metz → Nancy': unnamed(route('ors-directions-metz-nancy.json')),
  'Nancy → Metz': unnamed(reverse(route('ors-directions-metz-nancy.json'))),
  'Belfort → Mulhouse': unnamed(route('ors-directions-belfort-mulhouse.json')),
};

for (const [name, r] of Object.entries(scenarios)) {
  test(`contours : ${name} donne les mêmes passages et la même ligne qu'avec les contours COG 2018`, () => {
    const passages = tollsAlongRoute(r, { data: real, network, departure: dep }).map((p) => ({
      tax: p.tax.id, method: p.method, enter: Math.round(p.enter), exit: Math.round(p.exit), roads: [...p.roads].sort(),
    }));
    const lines = tollRules(r, { vehicle: truck, tolls: { status: 'ok', data: real, network }, departure: dep }).lines.map((l) => `${l.level}: ${l.text}`);
    assert.deepEqual(passages, expected[name].passages);
    assert.deepEqual(lines, expected[name].lines);
  });
}

test('contours : réseau converti (osm-tolls.geojsonseq) identique, km par référence et par taxe (A31 au sud de Toul compris)', () => {
  const got = Object.fromEntries(Object.entries(converted.json.taxes).map(([id, t]) => [id, { lines: t.lines.length, km: t.km }]));
  assert.deepEqual(JSON.parse(JSON.stringify(got)), expected.network);
});

test('statut « annoncée » inchangé pour les deux taxes', () => {
  const raw = JSON.parse(readFileSync(new URL('../data/taxes-pl.json', import.meta.url), 'utf8'));
  assert.deepEqual(raw.taxes.map((t) => [t.id, t.status]), [['r-pass', 'announced'], ['ecpl', 'announced']]);
});
