// Version affichée en bas de Réglages : toujours celle de VERSION dans sw.js (aucun second numéro à tenir à jour).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION_REQUEST, versionReply, versionLabel, UNKNOWN_VERSION_TEXT } from '../src/lib/app-version.js';

const swText = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

// Charge le vrai sw.js avec un faux `self` et renvoie ses écouteurs d'événements.
async function loadServiceWorker() {
  const listeners = {};
  globalThis.self = {
    location: new URL('https://exemple.test/gabarit/sw.js'),
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  await import(`../sw.js?t=${Date.now()}`);
  return listeners;
}

test('la ligne de Réglages affiche exactement VERSION de sw.js', async () => {
  const declared = swText.match(/const VERSION = '([^']+)';/);
  assert.ok(declared, 'VERSION introuvable dans sw.js');
  assert.equal([...swText.matchAll(/const VERSION = /g)].length, 1);
  const listeners = await loadServiceWorker();
  let reply;
  listeners.message({ data: { type: VERSION_REQUEST }, ports: [{ postMessage: (m) => { reply = m; } }] });
  assert.deepEqual(reply, { type: 'VERSION', version: declared[1] });
  assert.equal(versionLabel(reply), `Gabarit ${declared[1]}`);
});

test('aucune autre copie du numéro dans l\'appli', () => {
  const v = swText.match(/const VERSION = '([^']+)';/)[1];
  for (const f of ['index.html', 'src/app.js', 'src/ui/settings.js', 'src/lib/app-version.js']) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!text.includes(`'${v}'`) && !text.includes(`Gabarit ${v}`), `${f} recopie ${v}`);
  }
});

test('version absente ou inattendue → « version inconnue », jamais « undefined »', () => {
  assert.equal(UNKNOWN_VERSION_TEXT, 'version inconnue');
  for (const r of [null, undefined, {}, { type: 'VERSION' }, versionReply(undefined), versionReply(''),
    versionReply(16), { type: 'AUTRE', version: 'v3' }, versionReply('v1<b>')]) {
    assert.equal(versionLabel(r), 'version inconnue');
  }
  assert.equal(versionLabel(versionReply('v7')), 'Gabarit v7');
});

test('message sans canal de réponse : le service worker ne plante pas', async () => {
  const listeners = await loadServiceWorker();
  assert.doesNotThrow(() => listeners.message({ data: { type: VERSION_REQUEST }, ports: [] }));
});
