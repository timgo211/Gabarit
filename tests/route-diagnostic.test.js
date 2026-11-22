process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDirections } from '../src/lib/ors-response.js';
import { routeDiagnosticText } from '../src/lib/route-diagnostic.js';
import { routeRules } from '../src/lib/route-rules.js';
import { parseTollData } from '../src/lib/hgv-tolls.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const tolls = { status: 'ok', data: parseTollData(JSON.parse(readFileSync(new URL('../data/taxes-pl.json', import.meta.url), 'utf8'))) };

test('diagnostic : étapes (km, nom ORS, références lues, point arrondi), pays, taxes', () => {
  const route = parseDirections(fixture('ors-directions-cernay-erstein.json'));
  const rules = routeRules(route, { vehicle: { weight: 44, euroClass: '6' }, departure: new Date(2026, 10, 25, 9, 0), tolls });
  const t = routeDiagnosticText(route, { version: 'Gabarit v30', rules, label: 'vers Erstein' });
  const lines = t.split('\n');
  assert.equal(lines[0], 'Gabarit v30 — diagnostic du trajet (vers Erstein)');
  assert.match(t, /^Distance : 82,0 km ; départ 47\.80, 7\.17 ; arrivée 48\.45, 7\.66$/m);
  assert.match(t, /^Pays \(countryinfo\) : FR$/m);
  assert.match(t, /^ {2}\d+,\d–\d+,\d \| Route de Strasbourg, D 83 \| D83 \| 48\.22, 7\.40$/m);
  assert.match(t, /^ {2}\d+,\d–\d+,\d \| Autoroute des Cigognes, N 83 \| N83 \| /m);
  assert.match(t, /^Taxes PL \(1\) :\n {2}R-Pass : km \d+,\d–\d+,\d \(D83, N83\) — noms d.étape \(réseau OSM non chargé\)$/m);
  assert.match(t, /^ZFE \(0\) : aucune$/m);
  assert.doesNotMatch(t, /cle|clé|api_key|44 t/i);
});

test('diagnostic : sans version, sans tracé, sans étapes, sans règles', () => {
  assert.match(routeDiagnosticText(null), /^Gabarit, version inconnue — diagnostic du trajet\nTracé absent\.$/);
  assert.match(routeDiagnosticText(null, { version: 'version inconnue' }), /^Gabarit, version inconnue — /);
  const t = routeDiagnosticText({ coordinates: [[7, 48], [7.1, 48]], steps: [], countries: null });
  assert.match(t, /Pays \(countryinfo\) : absent/);
  assert.match(t, /\(aucune étape\)/);
  assert.doesNotMatch(t, /ZFE/);
});

test('diagnostic : étape sans nom', () => {
  const t = routeDiagnosticText({ coordinates: [[7, 48], [7.1, 48]], steps: [{ name: '', wayPoints: [0, 1] }] });
  assert.match(t, /\| \(sans nom\) \| — \| 48\.00, 7\.00/);
});
