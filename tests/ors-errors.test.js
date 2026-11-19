import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, formatDiagnostic, summarizeKeyTest } from '../src/lib/ors-errors.js';
import { fixture } from './helpers.js';

test('aucun itinéraire autorisé (2009)', () => {
  const e = classifyError({ status: 404, body: fixture('ors-error-2009.json') });
  assert.equal(e.kind, 'no-route');
  assert.match(e.message, /Aucun itinéraire autorisé/);
});

test('point introuvable (2010)', () => {
  assert.equal(classifyError({ status: 404, body: fixture('ors-error-2010.json') }).kind, 'point-not-found');
});

test('clé invalide (401 / 403)', () => {
  assert.equal(classifyError({ status: 403, body: fixture('ors-error-key.json') }).kind, 'invalid-key');
  assert.equal(classifyError({ status: 401, body: '' }).kind, 'invalid-key');
});

test('quota dépassé (429)', () => {
  const e = classifyError({ status: 429, body: fixture('ors-error-quota.json') });
  assert.equal(e.kind, 'quota');
  assert.match(e.message, /Quota/);
});

test('hors ligne, réseau, délai, clé absente, serveur', () => {
  assert.equal(classifyError({ offline: true }).kind, 'offline');
  assert.equal(classifyError({ networkError: true }).kind, 'network');
  assert.equal(classifyError({ timeout: true }).kind, 'timeout');
  assert.equal(classifyError({ noKey: true }).kind, 'no-key');
  assert.equal(classifyError({ status: 502 }).kind, 'server');
  assert.equal(classifyError({ status: 400, body: { error: { code: 2003, message: 'x' } } }).kind, 'bad-request');
  assert.equal(classifyError({ status: 404, body: { error: { code: 2004 } } }).kind, 'too-far');
  assert.equal(classifyError({}).kind, 'unknown');
});

test('chaque message est en français et non vide', () => {
  for (const p of [{ offline: true }, { status: 429 }, { status: 403 }, { status: 404 }, { noKey: true }]) {
    assert.ok(classifyError(p).message.length > 10);
  }
});

test('diagnostic : code HTTP + message serveur, clé masquée, texte tronqué', () => {
  assert.equal(formatDiagnostic({ status: 403, detail: 'Access to this API has been disallowed' }),
    'HTTP 403 : Access to this API has been disallowed');
  assert.equal(formatDiagnostic({ status: 401, detail: 'bad key CLE-FACTICE-123' }, 'CLE-FACTICE-123'), 'HTTP 401 : bad key •••');
  assert.ok(formatDiagnostic({ status: 500, detail: 'x'.repeat(300) }).length < 120);
  assert.match(formatDiagnostic({ kind: 'network' }), /pas de réponse/);
});

test('bouton Tester : les deux services OK', () => {
  const r = summarizeKeyTest({ directions: { ok: true }, geocode: { ok: true } });
  assert.equal(r.level, 'ok');
  assert.equal(r.saveKey, true);
});

test('bouton Tester : itinéraires OK, recherche en échec → clé gardée, avertissement', () => {
  const r = summarizeKeyTest({ directions: { ok: true }, geocode: { ok: false, kind: 'server', status: 500, detail: 'oops' } });
  assert.equal(r.level, 'warn');
  assert.equal(r.saveKey, true);
  assert.match(r.message, /HTTP 500/);
});

test('bouton Tester : clé refusée → non enregistrée, code HTTP affiché', () => {
  const bad = { ok: false, kind: 'invalid-key', status: 403, detail: 'Access to this API has been disallowed' };
  const r = summarizeKeyTest({ directions: bad, geocode: bad }, 'CLE-FACTICE');
  assert.equal(r.level, 'err');
  assert.equal(r.saveKey, false);
  assert.match(r.message, /HTTP 403/);
  assert.doesNotMatch(r.message, /CLE-FACTICE/);
});

test('bouton Tester : quota dépassé → clé gardée', () => {
  const r = summarizeKeyTest({ directions: { ok: false, kind: 'quota', status: 429 }, geocode: { ok: true } });
  assert.equal(r.saveKey, true);
});
