// Version affichée en bas de Réglages : toujours celle de VERSION dans sw.js (aucun second numéro à tenir à jour).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION_REQUEST, versionReply, versionLabel, UNKNOWN_VERSION_TEXT, requestVersionLabel } from '../src/lib/app-version.js';
import { routeDiagnosticText } from '../src/lib/route-diagnostic.js';

const swText = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

// Charge le vrai sw.js avec un faux `self` et renvoie ses écouteurs d'événements. Adresse unique par chargement
// (compteur, jamais l'horloge : deux chargements dans la même milliseconde recevaient le module déjà en cache, donc
// sans écouteurs neufs). `self` reste défini : les écouteurs le lisent après le chargement.
let loads = 0;
async function loadServiceWorker() {
  const listeners = {};
  globalThis.self = {
    location: new URL('https://exemple.test/gabarit/sw.js'),
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  loads += 1;
  await import(`../sw.js?chargement=${loads}`);
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

// Phase 5h ter : le diagnostic du trajet commençait par « Gabarit, version inconnue » (#app-version rempli seulement à
// l'ouverture de Réglages). La version est désormais demandée au service worker, comme Réglages.
test('diagnostic du trajet : version demandée au vrai sw.js, même texte qu\'en bas de Réglages', async () => {
  const declared = swText.match(/const VERSION = '([^']+)';/)[1];
  const listeners = await loadServiceWorker();
  // Contrôleur simulé : transmet le message au vrai écouteur de sw.js avec le port du MessageChannel.
  const controller = { postMessage: (data, ports) => listeners.message({ data, ports }) };
  const label = await requestVersionLabel(controller, 1000);
  assert.equal(label, `Gabarit ${declared}`);
  const route = { coordinates: [[7.33, 47.75], [7.35, 47.8]], steps: [] };
  assert.match(routeDiagnosticText(route, { version: label }), new RegExp(`^Gabarit ${declared} — diagnostic du trajet`));
});

test('version : sans contrôleur, sans réponse ou erreur → « version inconnue », jamais rejetée', async () => {
  assert.equal(await requestVersionLabel(null), UNKNOWN_VERSION_TEXT);
  assert.equal(await requestVersionLabel({ postMessage: () => {} }, 50), UNKNOWN_VERSION_TEXT);
  assert.equal(await requestVersionLabel({ postMessage: () => { throw new Error('x'); } }), UNKNOWN_VERSION_TEXT);
  const bad = { postMessage: (d, [port]) => port.postMessage({ type: 'VERSION', version: 'undefined' }) };
  assert.equal(await requestVersionLabel(bad, 1000), UNKNOWN_VERSION_TEXT);
});
