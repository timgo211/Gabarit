// Copie des voies à flèches au sol (phase 11d) : conversion côté Action vers data/voies-osm/. Fixture SYNTHÉTIQUE
// osm-voies.geojsonseq : autoroute à sens unique vers le carrefour de ors-directions-sortie.json (point 20), voie à
// double sens forward / backward, refus (nombre ≠, lanes absent, none, vide, rond-point, oneway=-1, valeur inconnue,
// turn:lanes sans suffixe à double sens, chemin piéton) et voie de 1,1 km coupée aux 200 derniers mètres ; v63 :
// « none » gardé sur motorway_link (w7014) et motorway (w7018, valeur vide), ignoré sur residential (w7016), rangée
// toute en « none » ignorée (w7015), « none » mêlé à une flèche refusé (w7017).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LANES, LANE_SKIPS, convertLanes, emptyLaneSkips, laneCount, laneSizeProblem, laneSkipLog, laneSourceProblem,
  lanesFromFeature, osmiumLanesFilter, parseTurnLanes,
} from '../src/lib/lanes-convert.js';
import { parseGeojsonLine } from '../src/lib/areas-osm-data.js';
import { haversine } from '../src/lib/nav-geo.js';

const features = readFileSync(new URL('./fixtures/osm-voies.geojsonseq', import.meta.url), 'utf8')
  .split('\n').map(parseGeojsonLine).filter(Boolean);
const byId = (id) => features.find((f) => f.id === id);

function decode(row) {
  const out = [];
  let x = 0; let y = 0;
  for (let i = 2; i + 1 < row.length; i += 2) { x += row[i]; y += row[i + 1]; out.push([x / 1e5, y / 1e5]); }
  return out;
}

test('filtre osmium : trois étiquettes turn:lanes, voies seulement', () => {
  assert.deepEqual(osmiumLanesFilter(), ['w/turn:lanes', 'w/turn:lanes:forward', 'w/turn:lanes:backward']);
  assert.ok(LANES.DIR.startsWith('./') && LANES.INDEX_PATH === './data/voies-osm/index.json');
  assert.equal(LANES.MAX_FILE_BYTES, 5 * 1024 * 1024);
  assert.equal(LANES.MAX_TOTAL_BYTES, 40 * 1024 * 1024);
});

test('nombre de voies : entier de 1 à 16, sinon null', () => {
  assert.equal(laneCount('3'), 3);
  assert.equal(laneCount(' 2 '), 2);
  for (const v of [undefined, '', '0', '2.5', 'deux', '17', '-1']) assert.equal(laneCount(v), null, String(v));
});

test('turn:lanes : nombre égal exigé, none et vide à part, valeur inconnue refusée', () => {
  assert.deepEqual(parseTurnLanes('left|through;right', 2), { ok: true, text: 'left|through;right', lanes: [['left'], ['through', 'right']], none: 0 });
  assert.equal(parseTurnLanes(' left | through ', 2).text, 'left|through');
  assert.deepEqual(parseTurnLanes('left|through', 3), { ok: false, reason: 'count' });
  assert.deepEqual(parseTurnLanes('left|through', null), { ok: false, reason: 'lanes' });
  assert.deepEqual(parseTurnLanes('left|none', 2), { ok: false, reason: 'none' });
  assert.deepEqual(parseTurnLanes('left||right', 3), { ok: false, reason: 'none' });
  assert.deepEqual(parseTurnLanes('left|foo', 2), { ok: false, reason: 'value' });
  assert.deepEqual(parseTurnLanes(null, 2), { ok: false, reason: 'value' });
});

test('v63 : « none » sur autoroute = voie sans flèche ; toute la rangée sans flèche → ignorée', () => {
  const opt = { allowNone: true };
  assert.deepEqual(parseTurnLanes('through|none|slight_right', 3, opt),
    { ok: true, text: 'through|none|slight_right', lanes: [['through'], ['none'], ['slight_right']], none: 1 });
  assert.equal(parseTurnLanes('|through', 2, opt).text, 'none|through');
  assert.deepEqual(parseTurnLanes('none|none', 2, opt), { ok: false, reason: 'allnone' });
  assert.deepEqual(parseTurnLanes('||', 3, opt), { ok: false, reason: 'allnone' });
  assert.deepEqual(parseTurnLanes('none;left|right', 2, opt), { ok: false, reason: 'value' });
  assert.deepEqual(parseTurnLanes('left|none', 3, opt), { ok: false, reason: 'count' });
  assert.equal(parseTurnLanes('left|through', 2, opt).none, 0);
});

test('v63 : « none » gardé sur motorway_link et motorway, ignoré sur residential', () => {
  const kept = lanesFromFeature(byId('w7014'));
  assert.deepEqual(kept.skips, []);
  assert.equal(kept.lines[0].turn, 'through|none|slight_right');
  assert.equal(kept.lines[0].none, 1);
  assert.equal(lanesFromFeature(byId('w7018')).lines[0].turn, 'none|through');
  assert.deepEqual(lanesFromFeature(byId('w7016')), { lines: [], skips: ['none'] });
  assert.deepEqual(lanesFromFeature(byId('w7015')), { lines: [], skips: ['allnone'] });
  assert.deepEqual(lanesFromFeature(byId('w7017')), { lines: [], skips: ['value'] });
  // Primaire : « none » toujours ignoré (w7005, w7012).
  assert.deepEqual(lanesFromFeature(byId('w7005')).skips, ['none']);
});

test('sens unique implicite (autoroute) : une ligne qui finit au carrefour', () => {
  const r = lanesFromFeature(byId('w7001'));
  assert.deepEqual(r.skips, []);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].kind, 'oneway');
  assert.equal(r.lines[0].turn, 'through|through|slight_right');
  assert.equal(r.lines[0].n, 3);
  assert.deepEqual(r.lines[0].coords.at(-1), [6.1, 49.02]);
});

test('double sens : forward dans le sens du dessin, backward retourné', () => {
  const r = lanesFromFeature(byId('w7002'));
  assert.deepEqual(r.skips, []);
  const fw = r.lines.find((l) => l.kind === 'forward');
  const bw = r.lines.find((l) => l.kind === 'backward');
  assert.equal(fw.turn, 'left|through');
  assert.deepEqual(fw.coords.at(-1), [6.112, 49.03]);
  assert.equal(bw.turn, 'through|right');
  assert.deepEqual(bw.coords.at(-1), [6.11, 49.03]);
});

test('refus : un motif par cas, jamais de voie gardée', () => {
  const cases = {
    w7003: 'count', w7004: 'lanes', w7005: 'none', w7006: 'roundabout', w7007: 'oneway', w7008: 'value',
    w7009: 'nosuffix', w7010: 'highway', w7012: 'none',
  };
  for (const [id, reason] of Object.entries(cases)) {
    const r = lanesFromFeature(byId(id));
    assert.deepEqual(r.lines, [], id);
    assert.deepEqual(r.skips, [reason], id);
  }
  assert.equal(lanesFromFeature(byId('n7013')), null);
  assert.equal(lanesFromFeature({ id: 'w1', properties: { highway: 'primary' } }), null);
  assert.equal(lanesFromFeature(null), null);
  for (const k of Object.keys(emptyLaneSkips())) assert.ok(LANE_SKIPS[k]);
});

test('voie longue : seuls les 200 derniers mètres sont gardés', () => {
  const [l] = lanesFromFeature(byId('w7011')).lines;
  assert.deepEqual(l.coords.at(-1), [6.2, 49.01]);
  let d = 0;
  for (let i = 1; i < l.coords.length; i += 1) d += haversine(l.coords[i - 1], l.coords[i]);
  assert.ok(d >= LANES.KEEP_M && d < LANES.KEEP_M + 120, `${d} m`);
});

test('conversion : cases, textes indexés, lignes relues à l’identique, index', () => {
  const list = features.map(lanesFromFeature).filter(Boolean).flatMap((r) => r.lines);
  assert.equal(list.length, 6); // w7001, w7002 ×2, w7011, w7014, w7018
  const conv = convertLanes(list, { updated: '2026-12-01', countries: ['france'] });
  assert.equal(conv.problem, null);
  assert.equal(conv.index.count, 6);
  assert.equal(conv.index.tolerance, 3);
  assert.equal(conv.index.license, 'ODbL, © contributeurs OpenStreetMap');
  assert.deepEqual(Object.keys(conv.index.tiles), ['6_49']);
  const tile = conv.tiles.get('6_49');
  assert.deepEqual(Object.keys(tile), ['t', 'v']);
  const row = tile.v.find((r) => tile.t[r[0]] === 'through|through|slight_right');
  assert.equal(row[1], 3);
  assert.deepEqual(decode(row).at(-1), [6.1, 49.02]);
  for (const r of tile.v) assert.equal(tile.t[r[0]].split('|').length, r[1]);
  assert.match(conv.log[0], /6 lignes gardées \(4 sens unique, 1 forward, 1 backward ; 2 avec une voie sans flèche\)/);
  assert.ok(tile.t.includes('through|none|slight_right'));
});

test('plafonds : trop gros → rien, journal clair', () => {
  const list = lanesFromFeature(byId('w7001')).lines;
  const none = convertLanes(list, { maxTotal: 5 });
  assert.equal(none.index, null);
  assert.equal(none.tiles, null);
  assert.match(none.problem, /total/);
  assert.equal(none.log.length, 1 + LANES.TOLERANCES_M.length);
  assert.match(laneSizeProblem({ total: 1, biggest: ['6_49', 6 * 1024 * 1024] }), /case 6_49 de 6\.0 Mo/);
  assert.equal(laneSourceProblem(10, 100), null);
  assert.match(laneSourceProblem(200 * 1024 * 1024, 100 * 1024 * 1024), /200 Mo \(plus de 100 Mo\)/);
});

test('journal : « none » hors autoroute et sur autoroute à part, avant / après', () => {
  const skips = emptyLaneSkips();
  const rs = features.map(lanesFromFeature).filter(Boolean);
  for (const r of rs) for (const k of r.skips) skips[k] += 1;
  const kept = rs.flatMap((r) => r.lines);
  const log = laneSkipLog(skips, kept);
  assert.equal(log[0], 'Voies ignorées à cause de « none » hors autoroute : 3.'); // w7005, w7012, w7016
  assert.equal(log[1], 'Voies ignorées à cause de « none » sur autoroute (toutes les voies sans flèche) : 1.'); // w7015
  assert.match(log[2], /rond-point 1/);
  assert.doesNotMatch(log[2], /none/);
  // Avant : 4 gardées (sans w7014 ni w7018), none 3 + 1 + 2 = 6 ; après : 6 gardées, none 3 et 1.
  assert.match(log[3], /^Avant \(règle v59, tout « none » ignoré\) : 4 lignes gardées ; ignorées : none 6, autres motifs \d+\.$/);
  assert.match(log[4], /^Après \(règle v63, « none » gardé sur autoroute\) : 6 lignes gardées \(dont 2 avec une voie sans flèche\) ; ignorées : none hors autoroute 3, none sur autoroute 1, autres motifs \d+\.$/);
  const other = Number(log[3].match(/autres motifs (\d+)/)[1]);
  assert.equal(other, Number(log[4].match(/autres motifs (\d+)/)[1]));
  assert.equal(laneSkipLog(emptyLaneSkips())[2], 'Voies ignorées pour un autre motif : aucune.');
  assert.equal(laneSkipLog(emptyLaneSkips()).length, 3);
});
