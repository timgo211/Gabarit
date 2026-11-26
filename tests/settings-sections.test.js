// v84 : sections repliables de Réglages (src/lib/settings-sections.js) et leur état (settings.sectionsOpen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTION_KEYS, sanitizeSectionsOpen, toggleSection, sectionSummary, KEY_MISSING_TEXT } from '../src/lib/settings-sections.js';
import { emptyData, exportData, readExport, sanitizeData, createStore, memoryStorage } from '../src/lib/store.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const settingsHtml = html.slice(html.indexOf('<dialog id="dlg-settings"'), html.indexOf('<p id="app-version"'));

test('index.html : une section repliable par clé, dans l\'ordre, toutes repliées, aucune perdue', () => {
  const keys = [...settingsHtml.matchAll(/data-section="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, [...SECTION_KEYS]);
  // 18 sections : toutes les sections de Réglages (aucune <section> sans data-section).
  assert.equal((settingsHtml.match(/<section /g) ?? []).length, SECTION_KEYS.length);
  for (const m of settingsHtml.matchAll(/class="section-toggle" aria-expanded="(\w+)" aria-controls="([\w-]+)"/g)) {
    assert.equal(m[1], 'false');
    assert.match(settingsHtml, new RegExp(`id="${m[2]}"[^>]* hidden>`));
  }
  assert.equal((settingsHtml.match(/class="section-toggle"/g) ?? []).length, SECTION_KEYS.length);
  // « Gabarit vNN » reste hors des sections.
  assert.match(html, /<\/section>\s*<p id="app-version"/);
});

test('index.html : tous les réglages encore là (mêmes identifiants qu\'en v83)', () => {
  for (const id of ['key-input', 'btn-key-save', 'btn-key-test', 'btn-key-clear', 'voice-enabled', 'voice-name', 'voice-rate',
    'voice-volume', 'btn-voice-test', 'area-voice', 'rule-voice', 'drive-voice', 'wind-voice', 'speed-voice', 'report-voice',
    'adr-enabled', 'adr-class', 'adr-un', 'adr-tunnel', 'btn-driving-reset', 'wind-gust', 'btn-wind-save', 'auto-bypass',
    'bridge-warnings', 'weight-warnings', 'place-kind', 'place-name', 'btn-place-to', 'btn-place-center', 'reports-list',
    'btn-reports-share', 'reports-import-file', 'restr-type', 'restr-value', 'restr-note', 'btn-restr-add', 'diesel-price',
    'btn-diesel-save', 'btn-history-print', 'btn-history-clear', 'btn-recent-clear', 'btn-export', 'import-file',
    'btn-simulate', 'btn-credits', 'credits-body', 'satellite-credit-list']) {
    assert.match(settingsHtml, new RegExp(`id="${id}"`), id);
  }
  for (const name of ['theme', 'night-level', 'vehicle-icon', 'arrow-color', 'sim-speed']) {
    assert.match(settingsHtml, new RegExp(`name="${name}"`), name);
  }
});

test('état par défaut : tout replié ; ancienne sauvegarde sans champ : sans erreur, tout replié', () => {
  assert.deepEqual(emptyData().settings.sectionsOpen, {});
  assert.deepEqual(sanitizeData({ vehicles: [], settings: {} }).settings.sectionsOpen, {});
  assert.deepEqual(sanitizeData({ vehicles: [] }).settings.sectionsOpen, {});
  assert.deepEqual(sanitizeSectionsOpen('abîmé'), {});
  assert.deepEqual(sanitizeSectionsOpen([true]), {});
  assert.deepEqual(sanitizeSectionsOpen({ voice: 'oui', inconnue: true, adr: true }), { adr: true });
});

test('ouverture / fermeture : plusieurs ouvertes possibles, état gardé', () => {
  let o = toggleSection({}, 'voice', true);
  o = toggleSection(o, 'adr', true);
  assert.deepEqual(o, { voice: true, adr: true });
  o = toggleSection(o, 'voice', false);
  assert.deepEqual(o, { adr: true });
  assert.deepEqual(toggleSection(o, 'inconnue', true), { adr: true });
});

test('état gardé après rechargement et dans l\'export ; ancien import v64 lisible', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  const d = emptyData();
  d.settings.sectionsOpen = { display: true, credits: true };
  store.save(d);
  assert.deepEqual(createStore(storage).load().settings.sectionsOpen, { display: true, credits: true });
  assert.deepEqual(readExport(exportData(d)).data.settings.sectionsOpen, { display: true, credits: true });
  const v64 = JSON.stringify({ app: 'gabarit', version: 1, vehicles: [], settings: { creditsOpen: true, theme: 'night' } });
  const r = readExport(v64).data.settings;
  assert.deepEqual(r.sectionsOpen, { credits: true });
  assert.equal(r.theme, 'night');
  // sectionsOpen présent : il fait foi, creditsOpen ignoré.
  assert.deepEqual(sanitizeSectionsOpen({ credits: false }, true), {});
});

test('valeur courante sous le titre : réglages de conduite seulement, courte', () => {
  const s = emptyData().settings;
  assert.equal(sectionSummary('display', s), 'Mode nuit : Auto');
  assert.equal(sectionSummary('display', { ...s, theme: 'night' }), 'Mode nuit : Nuit');
  assert.equal(sectionSummary('voice', s), 'Annonces vocales : oui');
  assert.equal(sectionSummary('arrow', { ...s, arrowColor: 'vert' }), 'Couleur : Vert');
  assert.equal(sectionSummary('adr', s), 'Matières dangereuses : non');
  assert.equal(sectionSummary('adr', { ...s, adr: { enabled: true, tunnelCode: 'E' } }), 'Matières dangereuses : oui, code E');
  assert.equal(sectionSummary('driving', s), 'Alerte vent : 70 km/h');
  assert.equal(sectionSummary('bans', s), 'Contournement automatique : oui');
  assert.equal(sectionSummary('bans', { ...s, autoBypass: false }), 'Contournement automatique : non');
  assert.equal(sectionSummary('bridges', s), 'Signaler : oui');
  assert.equal(sectionSummary('weights', { ...s, weightWarnings: false }), 'Signaler : non · DiaLog : oui');
  assert.equal(sectionSummary('weights', { ...s, dialogWarnings: false }), 'Signaler : oui · DiaLog : non'); // phase 12c
  assert.equal(sectionSummary('diesel', s), 'Prix : non renseigné');
  assert.equal(sectionSummary('diesel', { ...s, dieselPrice: 1.85 }), 'Prix : 1,85 €/L');
  assert.equal(sectionSummary('test', s), 'Vitesse : 50 km/h');
  for (const k of ['places', 'reports', 'restrictions', 'history', 'recent', 'data', 'credits']) assert.equal(sectionSummary(k, s), '');
  // Une ligne en portrait : 40 caractères au plus.
  for (const k of SECTION_KEYS) assert.ok(sectionSummary(k, { ...s, adr: { enabled: true, tunnelCode: 'B1000C' } }).length <= 40, k);
});

test('« Clé : manquante » : clé vide ou refusée au test', () => {
  assert.equal(sectionSummary('key', {}, { hasKey: false }), KEY_MISSING_TEXT);
  assert.equal(sectionSummary('key', {}, { hasKey: true, keyInvalid: true }), KEY_MISSING_TEXT);
  assert.equal(sectionSummary('key', {}, { hasKey: true }), 'Clé : enregistrée');
});
