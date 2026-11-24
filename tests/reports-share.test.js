// Phase 3c — Signalements pour un ami : contenu du fichier (sans lieux ni notes par défaut, jour seulement), import
// vérifié (taille, schéma, types, champs connus), marqué importé, jamais dit, fusion sans doublons, 500 au plus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARE, buildShareFile, parseShareFile, previewImport, previewText, mergeImported, shareFileName,
} from '../src/lib/reports-share.js';
import { cleanReport, isSpeakable, placeReports, guidanceReport, REPORT } from '../src/lib/reports.js';
import { emptyData } from '../src/lib/store.js';

let n = 0;
const makeId = () => `t-${(n += 1)}`;
// Signalements et lieu synthétiques.
const mine = (extra = {}) => cleanReport({
  id: 'm1', lon: 5.5, lat: 47.25, heading: 90, createdAt: '2026-11-20T08:15', type: 'low-bridge', note: 'note privée', confirmed: true, ...extra,
});

test('fichier : mes signalements confirmés seulement, jour seulement, sans notes par défaut, sans identifiant', () => {
  const list = [mine(), mine({ id: 'm2', lon: 5.6, confirmed: false }), mine({ id: 'i1', lon: 5.7, origin: 'imported' })];
  const f = JSON.parse(buildShareFile(list));
  assert.deepEqual(f, { kind: SHARE.KIND, version: SHARE.VERSION, reports: [{ type: 'low-bridge', lat: 47.25, lon: 5.5, heading: 90, createdAt: '2026-11-20' }] });
  assert.equal(JSON.parse(buildShareFile(list, { withNotes: true })).reports[0].note, 'note privée');
  assert.throws(() => buildShareFile([mine({ confirmed: false })]), new RegExp(SHARE.NONE_TEXT));
  assert.equal(shareFileName(new Date(2026, 10, 24)), 'gabarit-signalements-2026-11-24.json');
});

test('fichier : jamais mes lieux, ma clé ni mon profil (seul data.reports est lu)', () => {
  const data = {
    ...emptyData(),
    reports: [mine()],
    places: [{ id: 'p1', kind: 'home', name: 'Maison Secrète', label: '9 impasse Privée', lon: 5.9, lat: 47.9 }],
  };
  const text = buildShareFile(data.reports);
  for (const leak of ['Maison', 'Privée', '5.9', 'orsKey', 'vehicles', 'note privée', 'm1', '08:15']) assert.equal(text.includes(leak), false, leak);
});

test('import : taille, format, version, liste, nombre vérifiés ; ne lève jamais', () => {
  assert.equal(parseShareFile(null).ok, false);
  assert.match(parseShareFile('x'.repeat(SHARE.MAX_BYTES + 1)).error, /trop gros/);
  assert.match(parseShareFile('{pas du json').error, /JSON/);
  assert.match(parseShareFile(JSON.stringify({ kind: 'autre', version: 1, reports: [] })).error, /pas un fichier/);
  assert.match(parseShareFile(JSON.stringify([1, 2])).error, /pas un fichier/);
  assert.match(parseShareFile(JSON.stringify({ kind: SHARE.KIND, version: 2, reports: [] })).error, /Version/);
  assert.match(parseShareFile(JSON.stringify({ kind: SHARE.KIND, version: 1, reports: 'x' })).error, /liste/);
  const many = Array.from({ length: REPORT.MAX_COUNT + 1 }, () => ({ type: 'danger', lat: 47, lon: 5, createdAt: '2026-11-01' }));
  assert.match(parseShareFile(JSON.stringify({ kind: SHARE.KIND, version: 1, reports: many })).error, /500/);
});

test('import : champs connus seulement, types vérifiés, marqués importés, jamais confirmés', () => {
  const text = JSON.stringify({
    kind: SHARE.KIND, version: 1,
    reports: [
      { type: 'control', lat: 47, lon: 5, createdAt: '2026-11-01', note: '<img src=x onerror=alert(1)>', confirmed: true, origin: 'mine', id: 'pirate', script: 'x' },
      { type: 'inconnu', lat: 47, lon: 5.1, createdAt: '2026-11-01' },
      { type: 'danger', lat: '47', lon: 5.2, createdAt: '2026-11-01' },
      { lat: 47, lon: 5.3, createdAt: '2026-11-01' }, // sans type
      { type: 'danger', lat: 47, lon: 5.4, createdAt: 'demain' },
      'texte', null, [1],
      { type: 'control', lat: 47, lon: 5.00001, createdAt: '2026-11-02' }, // doublon < 20 m
    ],
  });
  const r = parseShareFile(text, { makeId });
  assert.equal(r.ok, true);
  assert.equal(r.reports.length, 1);
  assert.equal(r.dropped, 8);
  const c = r.reports[0];
  assert.deepEqual(Object.keys(c).sort(), ['confirmed', 'createdAt', 'heading', 'id', 'lat', 'lon', 'note', 'origin', 'type']);
  assert.deepEqual([c.origin, c.confirmed, c.id === 'pirate'], ['imported', false, false]);
  assert.equal(c.note, '<img src=x onerror=alert(1)>'); // texte brut, affiché en textContent seulement
  assert.equal(isSpeakable(c), false);
});

test('import : jamais dit à voix haute même avec le réglage activé', () => {
  const route = { coordinates: [[5, 47], [5.02, 47]] };
  const r = parseShareFile(JSON.stringify({ kind: SHARE.KIND, version: 1, reports: [{ type: 'danger', lat: 47, lon: 5.01, createdAt: '2026-11-01' }] }), { makeId });
  const placed = placeReports(r.reports, route);
  const at = placed[0].along - 300;
  const g = guidanceReport(placed, at, {}, { voice: true });
  assert.equal(g.speak, null);
  assert.match(g.view.text, /^Signalement importé à 300 m : danger \(à vérifier\)\. La signalisation fait foi\.$/);
});

test('aperçu puis fusion : sans doublons, les miens d\'abord, 500 au plus', () => {
  const current = [mine()];
  const imported = parseShareFile(JSON.stringify({
    kind: SHARE.KIND, version: 1,
    reports: [
      { type: 'low-bridge', lat: 47.25, lon: 5.50001, createdAt: '2026-11-01' }, // déjà chez moi
      { type: 'danger', lat: 47, lon: 5, createdAt: '2026-11-01' },
      { type: 'parking', lat: 46, lon: 5, createdAt: '2026-11-01' },
    ],
  }), { makeId }).reports;
  const p = previewImport(current, imported);
  assert.deepEqual(p, { add: 2, duplicates: 1, overflow: 0 });
  assert.match(previewText(p), /^2 signalements à importer \(1 déjà présent\)\./);
  const merged = mergeImported(current, imported);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, 'm1');
  // Plafond : 499 miens + 3 importés → 500, les miens tous gardés.
  const lots = Array.from({ length: 499 }, (_, i) => cleanReport({ id: `x${i}`, lon: 2 + i * 0.01, lat: 44, createdAt: '2026-11-01', type: 'danger' }));
  const p2 = previewImport(lots, imported);
  assert.deepEqual(p2, { add: 1, duplicates: 0, overflow: 2 });
  const m2 = mergeImported(lots, imported);
  assert.equal(m2.length, REPORT.MAX_COUNT);
  assert.equal(m2.filter((r) => r.origin === 'mine').length, 499);
});
