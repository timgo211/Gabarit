// Phase 3a — Mes signalements : création d'un appui, validation, placement, alerte, voix (confirmés à moi seulement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT, cleanReport, sanitizeReports, addMark, updateReport, removeReport, canEditReports, placeReports,
  guidanceReport, reportAlertText, reportSpokenText, isSpeakable, SIGNAGE_TEXT, stampOf,
} from '../src/lib/reports.js';
import { startNavigation, updateNavigation, markReport, rerouteDone } from '../src/lib/navigation.js';
import { guidanceAlerts } from '../src/lib/nav-layout.js';
import { createSimulator } from '../src/lib/nav-sim.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { prepareLine, pointAt } from '../src/lib/nav-geo.js';
import { emptyData, sanitizeData } from '../src/lib/store.js';
import { fixture, runFixes } from './helpers.js';

const ROUTE = parseDirections(fixture('ors-directions-nav.json'));
const LINE = prepareLine(ROUTE.coordinates);
const T0 = 1_800_000_000_000;
let n = 0;
const makeId = () => `t-${(n += 1)}`;
const NOW = new Date(2026, 10, 24, 14, 5);

/** Signalement à `along` mètres sur le tracé (cap du tracé, vers l'est). */
function at(along, extra = {}) {
  const p = pointAt(LINE, along).point;
  return cleanReport({ id: `r${along}`, lon: p[0], lat: p[1], heading: 90, createdAt: '2026-11-20T08:00', type: 'low-bridge', confirmed: true, ...extra });
}

function simFixes(kmh, seconds) {
  const sim = createSimulator(ROUTE.coordinates, { speedKmh: kmh });
  return Array.from({ length: seconds + 1 }, (_, i) => sim.next(T0 + i * 1000));
}

test('un appui : repère sans type ni note, à la position reçue, cap gardé', () => {
  const r = addMark([], { lon: 6.18, lat: 48.69, heading: 271 }, { now: NOW, makeId });
  assert.equal(r.reason, 'ok');
  assert.deepEqual(
    { type: r.report.type, note: r.report.note, confirmed: r.report.confirmed, origin: r.report.origin, heading: r.report.heading, createdAt: r.report.createdAt },
    { type: null, note: '', confirmed: false, origin: 'mine', heading: 271, createdAt: '2026-11-24T14:05' },
  );
  assert.equal(r.list.length, 1);
  // Deuxième appui au même endroit : pas de doublon.
  const again = addMark(r.list, { lon: 6.18, lat: 48.69001, heading: 271 }, { now: NOW, makeId });
  assert.equal(again.reason, 'duplicate');
  assert.equal(again.list.length, 1);
  // Sans position : rien.
  assert.equal(addMark([], null, { now: NOW }).reason, 'no-fix');
});

test('validation : champs connus seulement, types, bornes, note nettoyée', () => {
  const c = cleanReport({
    id: 'a', lon: 6, lat: 48, createdAt: '2026-11-24', type: 'control', note: ' <b>x</b>\u0007 y ', confirmed: true, extra: 'jamais', origin: 'mine',
  });
  assert.deepEqual(Object.keys(c).sort(), ['confirmed', 'createdAt', 'heading', 'id', 'lat', 'lon', 'note', 'origin', 'type']);
  assert.equal(c.note, '<b>x</b> y'); // texte brut, affiché en textContent
  assert.equal(cleanReport({ lon: 200, lat: 48, createdAt: '2026-11-24' }), null);
  assert.equal(cleanReport({ lon: 6, lat: 48, createdAt: '2026-11-24', type: 'inconnu' }), null);
  assert.equal(cleanReport({ lon: 6, lat: 48, createdAt: 'hier' }), null);
  assert.equal(cleanReport({ lon: '6', lat: 48, createdAt: '2026-11-24' }), null);
  // Confirmé : jamais sans type, jamais pour un importé.
  assert.equal(cleanReport({ lon: 6, lat: 48, createdAt: '2026-11-24', confirmed: true }).confirmed, false);
  assert.equal(cleanReport({ lon: 6, lat: 48, createdAt: '2026-11-24', type: 'danger', confirmed: true, origin: 'imported' }).confirmed, false);
  assert.equal(cleanReport({ lon: 6, lat: 48, createdAt: '2026-11-24', note: 'x'.repeat(500) }).note.length, REPORT.NOTE_MAX);
});

test('liste : doublons écartés, 500 au plus en gardant les miens d\'abord', () => {
  const imported = Array.from({ length: 400 }, (_, i) => ({ id: `i${i}`, lon: 2 + i * 0.01, lat: 45, createdAt: '2026-11-01', type: 'danger', origin: 'imported' }));
  const mine = Array.from({ length: 300 }, (_, i) => ({ id: `m${i}`, lon: 2 + i * 0.01, lat: 46, createdAt: '2026-11-01', type: 'danger' }));
  const list = sanitizeReports([...imported, ...mine, mine[0]]);
  assert.equal(list.length, REPORT.MAX_COUNT);
  assert.equal(list.filter((r) => r.origin === 'mine').length, 300);
  assert.equal(list[0].origin, 'mine');
  assert.deepEqual(sanitizeReports('pas une liste'), []);
});

test('modification et suppression ; confirmation seulement avec un type ; importé repris à mon compte', () => {
  let list = [cleanReport({ id: 'x', lon: 6, lat: 48, createdAt: '2026-11-24T10:00' })];
  list = updateReport(list, 'x', { confirmed: true });
  assert.equal(list[0].confirmed, false); // aucun type
  list = updateReport(list, 'x', { type: 'parking', note: 'derrière la station', confirmed: true });
  assert.deepEqual([list[0].type, list[0].note, list[0].confirmed], ['parking', 'derrière la station', true]);
  let imp = [cleanReport({ id: 'y', lon: 6, lat: 48, createdAt: '2026-11-24', type: 'danger', origin: 'imported' })];
  assert.equal(updateReport(imp, 'y', { confirmed: true })[0].confirmed, false);
  imp = updateReport(imp, 'y', { confirmed: true, adopt: true });
  assert.deepEqual([imp[0].origin, imp[0].confirmed], ['mine', true]);
  assert.deepEqual(removeReport(list, 'x'), []);
});

test('modification permise seulement à l\'arrêt confirmé, en guidage comme hors guidage', () => {
  assert.equal(canEditReports({ parked: true }), true);
  assert.equal(canEditReports({ parked: false }), false);
  assert.equal(canEditReports({}), false); // vitesse inconnue = en mouvement
  assert.equal(canEditReports({ parked: null }), false);
});

test('placement : sur le tracé à 30 m au plus, dans le sens de circulation si le cap est connu', () => {
  const near = at(2000);
  const far = cleanReport({ ...at(2500), id: 'far', lat: at(2500).lat + 0.001 }); // ≈ 110 m au nord
  const other = at(3000, { id: 'other', heading: 270 }); // autre sens
  const noHeading = at(3500, { id: 'nh', heading: null });
  const placed = placeReports([far, other, noHeading, near], ROUTE);
  assert.deepEqual(placed.map((p) => p.id), ['r2000', 'nh']);
  assert.ok(Math.abs(placed[0].along - 2000) < 1);
});

test('alerte : encart sous 1 km, voix une seule fois entre 500 et 50 m, phrase fixe et « La signalisation fait foi. »', () => {
  const placed = placeReports([at(2000)], ROUTE);
  assert.equal(guidanceReport(placed, 900, {}, { voice: true }).view, null); // 1,1 km
  const a = guidanceReport(placed, 1200, {}, { voice: true });
  assert.equal(a.view.text, `Signalement à 800 m : pont bas. ${SIGNAGE_TEXT}`);
  assert.equal(a.speak, null);
  const b = guidanceReport(placed, 1600, a.announced, { voice: true });
  assert.equal(b.speak, `Signalement dans 400 mètres : pont bas. ${SIGNAGE_TEXT}`);
  const c = guidanceReport(placed, 1700, b.announced, { voice: true });
  assert.equal(c.speak, null); // une seule fois
  assert.ok(c.view);
  assert.equal(guidanceReport(placed, 1995, c.announced).view, null); // dépassé
});

test('voix : jamais par défaut, jamais pour un repère à vérifier ni importé', () => {
  for (const [r, voice] of [
    [at(2000), false],
    [at(2000, { confirmed: false }), true],
    [at(2000, { type: null, confirmed: false }), true],
    [at(2000, { origin: 'imported' }), true],
  ]) {
    const placed = placeReports([r], ROUTE);
    const g = guidanceReport(placed, 1600, {}, { voice });
    assert.equal(g.speak, null);
    assert.match(g.view.text, /La signalisation fait foi\.$/);
  }
  assert.equal(reportAlertText({ type: null, confirmed: false, origin: 'mine' }, 420), `Repère à vérifier à 400 m. ${SIGNAGE_TEXT}`);
  assert.equal(reportAlertText({ type: 'danger', origin: 'imported' }, 420), `Signalement importé à 400 m : danger (à vérifier). ${SIGNAGE_TEXT}`);
  assert.equal(reportSpokenText({ type: 'danger', origin: 'imported', confirmed: false }, 400), null);
  assert.equal(isSpeakable({ type: 'danger', origin: 'mine', confirmed: true }), true);
});

test('guidage : signalement confirmé dit une fois avec le réglage, alerte dans la liste des alertes', () => {
  const st = startNavigation(ROUTE, { now: T0, reports: { list: [at(2000)], voice: true } });
  const { events, views } = runFixes(updateNavigation, st, simFixes(90, 120));
  const said = events.filter((e) => e.type === 'speak' && e.text.startsWith('Signalement'));
  assert.equal(said.length, 1);
  const v = views.find((x) => x?.report);
  assert.ok(v);
  assert.ok(guidanceAlerts(v).some((a) => a.kind === 'report' && a.level === 'warn'));
  // Sans le réglage : affiché, jamais dit.
  const quiet = runFixes(updateNavigation, startNavigation(ROUTE, { now: T0, reports: { list: [at(2000)], voice: false } }), simFixes(90, 120));
  assert.equal(quiet.events.filter((e) => e.type === 'speak' && e.text.startsWith('Signalement')).length, 0);
  assert.ok(quiet.views.some((x) => x?.report));
});

test('guidage : « Signaler » pose un repère à la dernière position, sans voix ni encart ensuite ; gardé au recalcul', () => {
  let { state } = runFixes(updateNavigation, startNavigation(ROUTE, { now: T0, reports: { list: [], voice: true } }), simFixes(50, 60));
  const m = markReport(state, [], { now: NOW, makeId });
  assert.equal(m.reason, 'ok');
  assert.deepEqual([m.report.lon, m.report.lat], state.lastFix.map((x) => Math.round(x * 1e6) / 1e6));
  assert.equal(m.report.type, null);
  assert.equal(m.state.reports.length, 1);
  const after = runFixes(updateNavigation, m.state, simFixes(50, 120).slice(61));
  assert.equal(after.views.filter((v) => v?.report).length, 0);
  const re = rerouteDone(after.state, ROUTE);
  assert.equal(re.state.reports.length, 1);
  // Aucune position reçue : rien posé.
  assert.equal(markReport(startNavigation(ROUTE, { now: T0 }), [], { now: NOW }).reason, 'no-fix');
});

test('stockage : signalements validés au chargement, voix désactivée par défaut, exportés', () => {
  assert.equal(emptyData().settings.reportVoice, false);
  const d = sanitizeData({ ...emptyData(), reports: [{ lon: 6, lat: 48, createdAt: '2026-11-24', type: 'control', confirmed: true }, { lon: 'x' }, 'texte'] });
  assert.equal(d.reports.length, 1);
  assert.equal(d.reports[0].confirmed, true);
  assert.equal(sanitizeData({ ...emptyData(), settings: { reportVoice: 'oui' } }).settings.reportVoice, false);
});

test('date : minute près, heure locale', () => {
  assert.equal(stampOf(new Date(2026, 0, 2, 3, 4)), '2026-01-02T03:04');
});
