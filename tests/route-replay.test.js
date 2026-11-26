// v85 : itinéraire montré avant la création de la carte (reprise v53 pendant le chargement du style) : cadré une fois.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRouteReplay } from '../src/lib/route-replay.js';

test('reprise avant la carte : cadrage gardé puis fait une seule fois à la création', () => {
  const r = createRouteReplay();
  assert.equal(r.takeFit(), false, 'rien montré : pas de cadrage');
  r.deferred(true);
  assert.equal(r.pending(), true);
  assert.equal(r.takeFit(), true, 'création de la carte : cadrage');
  assert.equal(r.takeFit(), false, 'carte recréée (contexte WebGL) : pas de second cadrage');
});

test('dernier appel décide ; carte déjà là ou liste vide : rien en attente', () => {
  const r = createRouteReplay();
  r.deferred(true);
  r.deferred(false);
  assert.equal(r.takeFit(), false, 'showRoutes(…, { fit: false }) en dernier : pas de cadrage');
  r.deferred(true);
  r.shown();
  assert.equal(r.takeFit(), false, 'montré avec la carte (déjà cadré) ou liste vide');
});

test('map.js : sans carte, repères retenus et cadrage différé ; build() rejoue le cadrage', () => {
  const src = readFileSync(new URL('../src/ui/map.js', import.meta.url), 'utf8');
  const show = src.slice(src.indexOf('function showRoutes('), src.indexOf('return {', src.indexOf('function showRoutes(')));
  // Branche « pas de carte » : repères départ / arrivée retenus, cadrage différé, avant tout ajout de couche.
  const noMap = show.slice(show.indexOf('if (!map) {'), show.indexOf('replay.shown();\n    removeRouteLayers'));
  assert.match(noMap, /marker\('start', line\[0\]/);
  assert.match(noMap, /marker\('end', line\[line\.length - 1\]/);
  assert.match(noMap, /replay\.deferred\(fit\)/);
  assert.doesNotMatch(noMap, /addRouteLayers|fitRoute/, 'aucun tracé ni cadrage sans carte (pas de doublon)');
  const build = src.slice(src.indexOf('function build('), src.indexOf('function drawReports('));
  assert.match(build, /map\.once\('style\.load', addRouteLayers\)/, 'tracés rejoués à la création');
  assert.match(build, /if \(marks\.start\) marker\('start'/);
  assert.match(build, /if \(marks\.end\) marker\('end'/);
  assert.match(build, /if \(replay\.takeFit\(\)\) fitRoute\(0\)/);
  // addRouteLayers ne double jamais la source.
  assert.match(src, /if \(!map \|\| !routes\.length \|\| map\.getSource\('route'\)\) return;/);
});
