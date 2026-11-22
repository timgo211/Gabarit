import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { parseTomTomRoute } from '../src/lib/tomtom.js';
import {
  compareWithTomTom, ROUTE_CHECK, checkAlertText, checkSummaryText, checkDiagnosticLines, checkUnavailableText,
  CHECK_NEUTRAL_TEXT, CHECK_PENDING_TEXT, CHECK_CREDIT_TEXT,
} from '../src/lib/route-check.js';

// Fixtures TomTom construites sur le tracé ORS Metz → Nancy (tests/fixtures/ors-directions-metz-nancy.json).
const ors = parseDirections(fixture('ors-directions-metz-nancy.json'));
const tt = (name) => parseTomTomRoute(fixture(name));

test('phase 12 : même trajet (décalé de 10 m, autre carte) → aucune alerte', () => {
  const c = compareWithTomTom(ors, tt('tomtom-route-same.json'));
  assert.equal(c.alert, false);
  assert.equal(c.inconclusive, false);
  assert.ok(c.share > 0.99);
  assert.equal(c.runs, 0);
  assert.equal(c.firstDivergence, null);
});

test('phase 12 : détour local de 3 km sur 800 m → alerte, premier point et écarts', () => {
  const c = compareWithTomTom(ors, tt('tomtom-route-detour.json'));
  assert.equal(c.alert, true);
  assert.ok(Math.abs(c.firstDivergence.along - 20000) < 300);
  assert.ok(c.largest.detour > 2500 && c.largest.ratio > 3);
  assert.ok(c.distanceDelta > 2500);
  assert.ok(c.durationDelta > 250);
  const text = checkAlertText(c);
  assert.match(text, /^À vérifier : un autre service propose un trajet différent \(\+3,0 km, \+5 min\)/);
  assert.match(text, /peut-être pour une limite de hauteur ou de poids\. La signalisation fait foi\.$/);
});

test('phase 12 : différence de préférence (route parallèle, rapport 1,1) → pas d\'alerte', () => {
  const c = compareWithTomTom(ors, tt('tomtom-route-preference.json'));
  assert.equal(c.alert, false);
  assert.ok(c.share < 0.7);
  assert.ok(c.largest.ratio < 1.3);
});

test('phase 12 : TomTom plus court qu\'ORS → jamais d\'alerte', () => {
  const detour = tt('tomtom-route-detour.json');
  const c = compareWithTomTom({ ...detour }, { ...ors, otherSections: [] });
  assert.equal(c.alert, false);
  assert.ok(c.largest.detour < 0);
});

test('phase 12 : passage « other » chez TomTom sur le détour → non concluant, sans alerte', () => {
  const c = compareWithTomTom(ors, tt('tomtom-route-restricted.json'));
  assert.equal(c.alert, false);
  assert.equal(c.inconclusive, true);
  assert.equal(c.otherSections, 1);
  assert.equal(c.largest.other, true);
});

test('phase 12 : les deux règles d\'alerte (500 m × 1,5 ou 1 km × 1,3)', () => {
  assert.deepEqual(ROUTE_CHECK.ALERT_RULES.map((r) => [r.minDetourM, r.minRatio]), [[500, 1.5], [1000, 1.3]]);
  // Détour de 700 m sur un tronçon de 1 km : rapport 1,7 → alerte par la première règle.
  const line = (pts) => pts.map(([x, y]) => [6 + x / 75000, 49 + y / 111000]); // ≈ mètres → degrés à 49° N
  const straight = line(Array.from({ length: 41 }, (_, i) => [i * 100, 0])); // 4 km tout droit
  const bump = (h, from, to) => line([
    ...Array.from({ length: from / 100 + 1 }, (_, i) => [i * 100, 0]),
    [from, h], [to, h],
    ...Array.from({ length: (4000 - to) / 100 + 1 }, (_, i) => [to + i * 100, 0]),
  ]);
  const o = { coordinates: straight, distance: 4000, duration: 200 };
  const c1 = compareWithTomTom(o, { coordinates: bump(350, 1500, 2500), distance: 4700, duration: 260 });
  assert.equal(c1.alert, true);
  // Détour de 400 m (rapport 1,4) : sous les deux règles.
  const c2 = compareWithTomTom(o, { coordinates: bump(200, 1500, 2500), distance: 4400, duration: 230 });
  assert.equal(c2.alert, false);
});

test('phase 12 : divergences dans les 500 premiers et derniers mètres ignorées', () => {
  // TomTom part et arrive à 400 m du point ORS (autre accroche), puis suit le même tracé.
  const same = tt('tomtom-route-same.json');
  const c0 = same.coordinates;
  const off = (p) => [p[0] + 0.0055, p[1]]; // ≈ 400 m vers l'est
  const coords = [off(c0[0]), ...c0.slice(6, -6), off(c0[c0.length - 1])];
  const c = compareWithTomTom(ors, { ...same, coordinates: coords, distance: same.distance + 600 });
  assert.equal(c.alert, false);
  assert.equal(c.runs, 0);
});

test('phase 12 : tracé illisible → null', () => {
  assert.equal(compareWithTomTom(ors, { coordinates: [] }), null);
  assert.equal(compareWithTomTom(null, tt('tomtom-route-same.json')), null);
});

test('phase 12 : ligne sous les fiches (en cours, indisponible, neutre, alerte) et jamais « vérifié »', () => {
  assert.equal(checkSummaryText(null), '');
  assert.equal(checkSummaryText({ status: 'pending' }), CHECK_PENDING_TEXT);
  assert.equal(checkSummaryText({ status: 'failed', reason: 'pas de réseau' }), 'Contrôle TomTom indisponible : pas de réseau.');
  const same = compareWithTomTom(ors, tt('tomtom-route-same.json'));
  const detour = compareWithTomTom(ors, tt('tomtom-route-detour.json'));
  assert.equal(checkSummaryText({ status: 'done' }, [same]), `${CHECK_NEUTRAL_TEXT} ${CHECK_CREDIT_TEXT}`);
  assert.equal(checkSummaryText({ status: 'done' }, [same, detour]), CHECK_CREDIT_TEXT);
  for (const t of [CHECK_NEUTRAL_TEXT, checkAlertText(detour), checkUnavailableText('x')]) {
    assert.doesNotMatch(t, /vérifié|\bOK\b|sans restriction/i);
  }
  assert.match(CHECK_NEUTRAL_TEXT, /La signalisation fait foi\./);
});

test('phase 12 : diagnostic à copier, même sans alerte', () => {
  const same = compareWithTomTom(ors, tt('tomtom-route-same.json'));
  const lines = checkDiagnosticLines({ status: 'done' }, same);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /aucune différence significative ; part du tracé commune 100 %/);
  const restricted = compareWithTomTom(ors, tt('tomtom-route-restricted.json'));
  const all = checkDiagnosticLines({ status: 'done' }, restricted).join('\n');
  assert.match(all, /première divergence au km 20,0/);
  assert.match(all, /plus grand détour \+3,0 km .* rapport 4,\d\d\) au km 20,0, passage non camion chez TomTom/);
  assert.match(all, /1 section\(s\) où TomTom n'a pas pu rester en mode camion/);
  assert.deepEqual(checkDiagnosticLines({ status: 'failed', reason: 'quota' }, null), ['Contrôle TomTom : indisponible (quota).']);
  assert.deepEqual(checkDiagnosticLines(null, null), []);
});
