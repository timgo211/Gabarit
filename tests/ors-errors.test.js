import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyError, formatDiagnostic, summarizeKeyTest, serviceDetailText, failedSegment, ERROR_KINDS,
} from '../src/lib/ors-errors.js';
import { fixture } from './helpers.js';

test('aucun itinéraire autorisé (2009)', () => {
  const e = classifyError({ status: 404, body: fixture('ors-error-2009.json') });
  assert.equal(e.kind, 'no-route');
  assert.match(e.message, /Aucun itinéraire autorisé/);
});

test('point introuvable (2010)', () => {
  assert.equal(classifyError({ status: 404, body: fixture('ors-error-2010.json') }).kind, 'point-not-found');
});

test('clé invalide (401, ou 403 qui met clairement la clé en cause)', () => {
  assert.equal(classifyError({ status: 401, body: '' }).kind, 'invalid-key');
  const e = classifyError({ status: 403, body: { error: 'Invalid API key' } });
  assert.equal(e.kind, 'invalid-key');
  assert.match(e.message, /^Clé OpenRouteService refusée/);
});

test('403 dont le message parle du quota ou de la limite → « Quota du jour atteint »', () => {
  const e = classifyError({ status: 403, body: fixture('ors-error-403-quota.json') });
  assert.equal(e.kind, 'daily-quota');
  assert.match(e.message, /^Quota du jour atteint/);
  for (const text of ['Daily quota reached', 'Rate limit exceeded', 'Limit exceeded for this key']) {
    assert.equal(classifyError({ status: 403, body: { error: text } }).kind, 'daily-quota', text);
  }
  assert.equal(classifyError({ status: 403, body: { error: { code: 0, message: 'Quota exceeded' } } }).kind, 'daily-quota');
});

test('403 au message ambigu → « Clé refusée ou quota du jour atteint »', () => {
  const e = classifyError({ status: 403, body: fixture('ors-error-key.json') }); // « Access to this API has been disallowed »
  assert.equal(e.kind, 'key-or-quota');
  assert.match(e.message, /^Clé refusée ou quota du jour atteint/);
  assert.equal(classifyError({ status: 403, body: '' }).kind, 'key-or-quota');
  assert.equal(classifyError({ status: 403 }).kind, 'key-or-quota');
});

test('limite par minute (429)', () => {
  const e = classifyError({ status: 429, body: fixture('ors-error-quota.json') });
  assert.equal(e.kind, 'quota');
  assert.match(e.message, /une minute/);
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

test('bouton Tester : 403 ambigu → non enregistrée, « Clé refusée ou quota du jour atteint »', () => {
  const bad = { ok: false, kind: 'key-or-quota', status: 403, detail: 'Access to this API has been disallowed' };
  const r = summarizeKeyTest({ directions: bad, geocode: bad }, 'CLE-FACTICE');
  assert.equal(r.level, 'err');
  assert.equal(r.saveKey, false);
  assert.match(r.message, /^Clé refusée ou quota du jour atteint \(HTTP 403/);
});

test('bouton Tester : quota du jour atteint → clé gardée', () => {
  const q = { ok: false, kind: 'daily-quota', status: 403, detail: 'Quota exceeded' };
  const r = summarizeKeyTest({ directions: q, geocode: q });
  assert.equal(r.level, 'warn');
  assert.equal(r.saveKey, true);
  assert.match(r.message, /quota du jour atteint/);
});

test('bouton Tester : clé refusée → non enregistrée, code HTTP affiché', () => {
  const bad = { ok: false, kind: 'invalid-key', status: 401, detail: 'Access to this API has been disallowed' };
  const r = summarizeKeyTest({ directions: bad, geocode: bad }, 'CLE-FACTICE');
  assert.equal(r.level, 'err');
  assert.equal(r.saveKey, false);
  assert.match(r.message, /HTTP 401/);
  assert.doesNotMatch(r.message, /CLE-FACTICE/);
});

test('bouton Tester : quota dépassé → clé gardée', () => {
  const r = summarizeKeyTest({ directions: { ok: false, kind: 'quota', status: 429 }, geocode: { ok: true } });
  assert.equal(r.saveKey, true);
});

test('phase 5h bis : codes rangés sous « Aucun itinéraire autorisé » (2009, 404 sans code) ; 429 jamais', () => {
  const noRoute = classifyError({ status: 404, body: { error: { code: 2009, message: 'Route could not be found - Unable to find a route between points 1 (6.17 49.12) and 2 (6.18 48.69).' } } });
  assert.equal(noRoute.kind, ERROR_KINDS.NO_ROUTE);
  assert.equal(noRoute.code, 2009);
  assert.equal(classifyError({ status: 404, body: null }).kind, ERROR_KINDS.NO_ROUTE);
  const quota = classifyError({ status: 429, body: { error: 'Rate limit exceeded' } });
  assert.equal(quota.kind, ERROR_KINDS.QUOTA);
  assert.doesNotMatch(quota.message, /profil|gabarit/);
  assert.equal(classifyError({ status: 404, body: { error: { code: 2010, message: 'Could not find point 1' } } }).kind, ERROR_KINDS.POINT_NOT_FOUND);
  assert.equal(classifyError({ status: 400, body: { error: { code: 2004, message: 'Request parameters exceed the server configuration limits.' } } }).kind, ERROR_KINDS.TOO_FAR);
});

test('phase 5h bis : ligne technique sous le message (statut, code, message ; jamais la clé)', () => {
  const e = { ...classifyError({ status: 404, body: { error: { code: 2009, message: 'Route could not be found' } } }), status: 404 };
  assert.equal(serviceDetailText(e), "Réponse du service d'itinéraire : HTTP 404, code 2009 — « Route could not be found ».");
  assert.equal(serviceDetailText({ ...classifyError({ status: 429, body: { error: 'Rate limit exceeded' } }), status: 429 }),
    "Réponse du service d'itinéraire : HTTP 429 — « Rate limit exceeded ».");
  assert.equal(serviceDetailText({ status: 403, detail: 'key CLE-FACTICE-123 refused' }, 'CLE-FACTICE-123'),
    "Réponse du service d'itinéraire : HTTP 403 — « key ••• refused ».");
  assert.equal(serviceDetailText(classifyError({ networkError: true })), '');
  assert.equal(serviceDetailText(null), '');
  assert.ok(serviceDetailText({ status: 500, detail: 'x'.repeat(300) }).length < 220);
});

test('phase 2f : tronçon en échec lu dans le message 2009 (points comptés à partir de 1)', () => {
  const read = (name) => failedSegment(classifyError({ status: 404, body: fixture(name) }).detail);
  assert.equal(read('ors-error-2009-metz.json'), 1);
  assert.equal(read('ors-error-2009-via-start.json'), 1);
  assert.equal(read('ors-error-2009-via-end.json'), 2);
  assert.equal(failedSegment('Route could not be found'), null);
  assert.equal(failedSegment('between points 1 (x) and 3 (y)'), null, 'points non consécutifs : illisible');
  assert.equal(failedSegment(null), null);
});

test('phase 2f : diagnostic interrompu ajouté à la ligne technique', () => {
  const e = { ...classifyError({ status: 404, body: { error: { code: 2009, message: 'Route could not be found' } } }), status: 404,
    diagnosticNote: 'Diagnostic interrompu : trop de demandes en une minute.' };
  assert.equal(serviceDetailText(e), "Réponse du service d'itinéraire : HTTP 404, code 2009 — « Route could not be found ». Diagnostic interrompu : trop de demandes en une minute.");
});
