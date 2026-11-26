// v91 : zones des grandes agglomérations (agglo-zones.js) pour les ponts sans hauteur au-dessus des autoroutes, dans
// l'appli (bridge-check.js, tests/bridges.test.js) et dans l'audit OSM (osm-audit.js, tools/audit-osm.mjs). Règle du
// propriétaire, sans source officielle ; la signalisation fait foi. Contours réels de data/ (IGN Admin Express COG 2026,
// fichiers du dépôt, aucun réseau) ; points de test et géométries SYNTHÉTIQUES à 2 décimales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AGGLO_ZONES, parseAggloZones, aggloZoneAt } from '../src/lib/agglo-zones.js';
import {
  auditAxisFromFeature, auditBridgeFromFeature, auditZones, axisCards, bridgeCards, bridgeCrossings, buildAxisIndex,
} from '../src/lib/osm-audit.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const ZONES = parseAggloZones(JSON.parse(read('data/zones-agglo.json')), JSON.parse(read('data/contours-ign.json')));

test('zones : les 9 contours lus, un point dans chacune, un point hors zone', () => {
  assert.ok(ZONES);
  assert.deepEqual(ZONES.zones.map((z) => z.key), [...AGGLO_ZONES.ZONES_KEYS, ...AGGLO_ZONES.CONTOURS_KEYS]);
  const at = (p) => aggloZoneAt(p, ZONES);
  // Grand Paris est dans l'Île-de-France : la première zone trouvée est l'Île-de-France.
  assert.equal(at([2.35, 48.86]), 'ileDeFrance'); // Paris
  assert.ok(ZONES.zones.find((z) => z.key === 'metropoleGrandParis').rings.some((r) => r.length >= 4));
  assert.equal(aggloZoneAt([2.35, 48.86], { zones: ZONES.zones.filter((z) => z.key !== 'ileDeFrance') }), 'metropoleGrandParis');
  assert.equal(at([2.13, 48.80]), 'ileDeFrance'); // Versailles : Île-de-France hors Grand Paris
  assert.equal(aggloZoneAt([2.13, 48.80], { zones: ZONES.zones.filter((z) => z.key !== 'ileDeFrance') }), null);
  assert.equal(at([5.37, 43.30]), 'aixMarseille'); // Marseille
  assert.equal(at([3.06, 50.63]), 'lille');
  assert.equal(at([-0.58, 44.84]), 'bordeaux');
  assert.equal(at([1.44, 43.60]), 'toulouse');
  assert.equal(at([-1.55, 47.22]), 'nantes');
  assert.equal(at([4.84, 45.76]), 'metropoleLyon'); // Lyon
  assert.equal(at([7.75, 48.58]), 'eurometropole'); // Strasbourg
  assert.equal(at([6.02, 47.24]), null); // Besançon : hors zone
  assert.equal(at([6.21, 47.66]), null); // Colombier (constat de la phase 12a)
  assert.equal(at(null), null);
  assert.equal(at([2.35, 48.86].slice(0, 1)), null);
});

test('zones : tout ou rien (clé manquante, anneau invalide, fichier nul → null)', () => {
  const z = JSON.parse(read('data/zones-agglo.json'));
  const c = JSON.parse(read('data/contours-ign.json'));
  assert.equal(parseAggloZones(null, c), null);
  assert.equal(parseAggloZones(z, null), null);
  assert.equal(parseAggloZones({ ...z, nantes: undefined }, c), null);
  assert.equal(parseAggloZones(z, { ...c, eurometropole: [] }), null);
  assert.equal(parseAggloZones(z, { ...c, metropoleLyon: [[[4.8, 45.7], [4.9, 45.7], [4.8, 45.7]]] }), null);
  assert.equal(parseAggloZones(z, { ...c, metropoleLyon: [[[4.8, 45.7], [4.9, 'x'], [4.9, 45.8], [4.8, 45.7]]] }), null);
  assert.equal(aggloZoneAt([2.35, 48.86], null), null);
});

// ───────── Audit ─────────
const way = (id, props, coords) => ({ type: 'Feature', id: `w${id}`, properties: props, geometry: { type: 'LineString', coordinates: coords } });
const FEATURES = [
  // Autoroute à Paris (en zone) et pont ferré sans hauteur, plus long au nord : croisement à 48,86, centre à 48,865.
  way(1, { highway: 'motorway', ref: 'A 1' }, [[2.30, 48.86], [2.40, 48.86]]),
  way(101, { railway: 'rail', bridge: 'yes', layer: '1' }, [[2.35, 48.855], [2.35, 48.875]]),
  // Autoroute à Besançon (hors zone) : pont sans hauteur, pont portant 4,1 m, tunnel sans hauteur.
  way(2, { highway: 'motorway', ref: 'A 36' }, [[6.00, 47.24], [6.04, 47.24]]),
  way(102, { highway: 'tertiary', bridge: 'yes', layer: '1' }, [[6.01, 47.23], [6.01, 47.25]]),
  way(103, { highway: 'tertiary', bridge: 'yes', layer: '1', maxheight: '4.1' }, [[6.03, 47.23], [6.03, 47.25]]),
  way(4, { highway: 'motorway', ref: 'A 36', tunnel: 'yes', layer: '-1' }, [[6.10, 47.30], [6.12, 47.30]]),
  // Nationale hors zone (niveau 2) : pont sans hauteur gardé.
  way(3, { highway: 'trunk', ref: 'N 57' }, [[6.00, 47.40], [6.04, 47.40]]),
  way(104, { highway: 'tertiary', bridge: 'yes', layer: '1' }, [[6.02, 47.39], [6.02, 47.41]]),
  // Départementale (niveau 3) en zone : jamais de fiche « pont sans hauteur ».
  way(5, { highway: 'primary', ref: 'D 910' }, [[2.20, 48.83], [2.24, 48.83]]),
  way(105, { highway: 'tertiary', bridge: 'yes', layer: '1' }, [[2.22, 48.82], [2.22, 48.84]]),
];

function audit(zones, levels = [1, 2, 3]) {
  const axes = FEATURES.map((f) => auditAxisFromFeature(f, levels)).filter(Boolean);
  const index = buildAxisIndex(axes);
  const stats = { motorwayIn: 0, motorwayOut: 0 };
  const cards = [];
  for (const f of FEATURES) {
    const b = auditBridgeFromFeature(f);
    if (b) cards.push(...bridgeCards(b, bridgeCrossings(b, axes, index), axes, { zones, stats }));
  }
  cards.push(...axisCards(axes));
  return { cards, stats };
}
const key = (c) => `${c.niveau}|${c.way}|${c.type}|${c.pont ?? ''}`;

test('audit : niveau 1 « pont sans hauteur » en zone gardé, hors zone retiré ; le reste inchangé', () => {
  const { cards, stats } = audit(ZONES);
  assert.deepEqual(cards.map(key).sort(), [
    '1|1|pont sans hauteur|101', // Paris : gardée
    '1|2|hauteur sur le pont seulement|103', // hors zone : inchangée
    '1|4|tunnel sans hauteur|', // hors zone : inchangée
    '2|3|pont sans hauteur|104', // nationale : inchangée
  ]);
  assert.deepEqual(stats, { motorwayIn: 1, motorwayOut: 1 });
  // Point de la fiche = croisement du pont avec l'autoroute, pas le centre du pont.
  const paris = cards.find((c) => c.way === 1);
  assert.deepEqual(paris.point, [2.35, 48.86]);
  // Toutes les zones loin : seule la fiche de Paris disparaît.
  const sq = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
  const far = sq(0.1, 40.1, 0.2, 40.2);
  const none = parseAggloZones(
    { ileDeFrance: far, metropoleGrandParis: far, aixMarseille: far, lille: far, bordeaux: far, toulouse: far, nantes: far },
    { metropoleLyon: far, eurometropole: far });
  const out = audit(none);
  assert.deepEqual(out.cards.map(key).sort(), cards.map(key).filter((k) => k !== '1|1|pont sans hauteur|101').sort());
  assert.deepEqual(out.stats, { motorwayIn: 0, motorwayOut: 2 });
  // Niveaux 1-2 seulement : même résultat sans la départementale.
  assert.deepEqual(audit(ZONES, [1, 2]).cards.map(key).sort(), cards.map(key).sort());
});

test('audit : zones absentes → erreur dès qu\'une fiche autoroute « pont sans hauteur » est en jeu (jamais retirée en silence)', () => {
  assert.throws(() => audit(null), /zones des grandes agglomérations non lues/);
  // Sans fiche de ce type (niveau 2 seulement) : aucune erreur.
  assert.doesNotThrow(() => audit(null, [2]));
});

test('audit : zones manquantes ou illisibles → problème ; fichiers du dépôt lisibles', () => {
  assert.ok(auditZones(read).zones);
  assert.match(auditZones((f) => { if (f.includes('zones')) throw new Error('absent'); return read(f); }).problem, /zones-agglo\.json absent/);
  assert.match(auditZones((f) => (f.includes('contours') ? '{' : read(f))).problem, /contours-ign\.json illisible/);
  assert.match(auditZones((f) => (f.includes('contours') ? '{}' : read(f))).problem, /zone manquante/);
});

test('audit : script arrêté avant tout téléchargement si les zones manquent, rien d\'écrit', () => {
  const dir = join(ROOT, 'data', 'audit-osm');
  const before = readdirSync(dir).map((f) => [f, statSync(join(dir, f)).mtimeMs]);
  const reportBefore = statSync(join(ROOT, 'docs', 'audit-osm-axes.md')).mtimeMs;
  let code = 0; let out = '';
  try {
    // Export inexistant aussi : même si l'arrêt manquait, la lecture échouerait avant toute écriture.
    out = execFileSync(process.execPath, [join(ROOT, 'tools', 'audit-osm.mjs'), '--zones', join(ROOT, 'tests', 'fixtures', 'absent-zones.json'),
      '--geojsonseq', join(ROOT, 'tests', 'fixtures', 'absent.geojsonseq')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) { code = err.status; out = String(err.stdout ?? ''); }
  assert.equal(code, 1);
  assert.match(out, /⚠ Audit OSM arrêté : data\/zones-agglo\.json absent/);
  assert.match(out, /rien n'est enregistré/);
  assert.deepEqual(readdirSync(dir).map((f) => [f, statSync(join(dir, f)).mtimeMs]), before);
  assert.equal(statSync(join(ROOT, 'docs', 'audit-osm-axes.md')).mtimeMs, reportBefore);
});
