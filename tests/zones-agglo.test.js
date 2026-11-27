// Contours des grandes agglomérations (data/zones-agglo.json, PR 1 sur 3 : contours seulement) : zones cherchées par
// leur nom dans les couches IGN Admin Express, simplification, plafond 500 Ko, clés écrites ; data/contours-ign.json
// inchangé (taxes PL, contournement de Lyon). Fixture SYNTHÉTIQUE zones-agglo-ign.geojson (2 décimales). Aucun réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers.js';
import {
  ZONES, ZONES_MAX_BYTES, normName, pickByName, simplify, rings, buildZones,
} from '../tools/zones-agglo.mjs';
import { AGGLO_ZONES, parseAggloZones, aggloZoneAt } from '../src/lib/agglo-zones.js';

const FX = fixture('zones-agglo-ign.geojson').features;
/** Candidats d'une zone comme le filtre WFS « nom_officiel ILIKE '%mot%' » (sans casse) sur sa couche. */
const like = (z) => FX.filter((f) => f.properties.layer === z.layer
  && f.properties.nom_officiel.toLowerCase().includes(z.like.toLowerCase()));
const foundAll = () => Object.fromEntries(ZONES.map((z) => [z.key, like(z)]));
const OPTS = { prefix: 'ADMINEXPRESS-COG.2026', year: 2026, read: '2026-11-26' };

test('zones : clés, couches, noms cherchés et tolérances', () => {
  assert.deepEqual(ZONES.map((z) => z.key),
    ['ileDeFrance', 'metropoleGrandParis', 'aixMarseille', 'lille', 'bordeaux', 'toulouse', 'nantes',
      'nice', 'montpellier', 'rennes', 'grenoble', 'rouen', 'toulon']);
  assert.deepEqual(ZONES.map((z) => z.name), ['Île-de-France', 'Métropole du Grand Paris',
    "Métropole d'Aix-Marseille-Provence", 'Métropole Européenne de Lille', 'Bordeaux Métropole', 'Toulouse Métropole',
    'Nantes Métropole', "Métropole Nice Côte d'Azur", 'Montpellier Méditerranée Métropole', 'Rennes Métropole',
    'Grenoble-Alpes-Métropole', 'Métropole Rouen Normandie', 'Métropole Toulon-Provence-Méditerranée']);
  assert.deepEqual(ZONES.map((z) => z.layer), ['region', ...Array(12).fill('epci')]);
  assert.deepEqual(ZONES.map((z) => z.tol), [150, ...Array(12).fill(50)]);
  // Les 7 zones lues par l'appli sont obligatoires ; les 6 nouvelles, facultatives.
  assert.deepEqual(ZONES.filter((z) => !z.optional).map((z) => z.key), [...AGGLO_ZONES.ZONES_KEYS]);
  assert.deepEqual(ZONES.filter((z) => z.optional).map((z) => z.key),
    ['nice', 'montpellier', 'rennes', 'grenoble', 'rouen', 'toulon']);
  // Filtre WFS sans recouvrement : « Toulon » ne ramène pas Toulouse.
  assert.ok(!normName('Toulouse Métropole').includes('toulon'));
  // Mot du filtre WFS sans accent ni apostrophe, contenu dans le nom cherché.
  for (const z of ZONES) {
    assert.equal(normName(z.like), z.like.toLowerCase());
    assert.ok(!/['’]/.test(z.like));
    assert.ok(normName(z.name).includes(normName(z.like)), z.key);
  }
  assert.equal(ZONES_MAX_BYTES, 500_000);
});

test('nom : accents, casse, apostrophes et espaces ignorés', () => {
  assert.equal(normName('Île-de-France'), 'ile-de-france');
  assert.equal(normName('METROPOLE EUROPEENNE DE LILLE'), normName('Métropole Européenne de Lille'));
  assert.equal(normName('Métropole d’Aix-Marseille-Provence'), normName("Métropole d'Aix-Marseille-Provence"));
  assert.equal(normName(' Bordeaux  Métropole '), 'bordeaux metropole');
  assert.notEqual(normName('Ile de France'), normName('Île-de-France'));
});

test('nom trouvé, absent, ambigu', () => {
  const gp = pickByName(like(ZONES[1]), 'Métropole du Grand Paris');
  assert.equal(gp.status, 'ok');
  assert.equal(gp.feature.properties.code_siren, '200054781');
  assert.equal(gp.names.length, 2);
  const lille = pickByName(like(ZONES[3]), 'Métropole Européenne de Lille');
  assert.equal(lille.status, 'ok');
  const nantes = pickByName(like(ZONES[6]), 'Nantes Métropole');
  assert.equal(nantes.status, 'absent');
  assert.deepEqual(nantes.names, ["Communauté de communes d'Erdre et Gesvres (près de Nantes)"]);
  const tls = pickByName(like(ZONES[5]), 'Toulouse Métropole');
  assert.equal(tls.status, 'ambigu');
  assert.equal(tls.count, 2);
  assert.equal(pickByName([], 'Nantes Métropole').status, 'absent');
  assert.equal(pickByName(undefined, 'Nantes Métropole').status, 'absent');
});

test('simplification : points alignés retirés, sommet loin gardé, anneaux extérieurs seuls, 4 décimales', () => {
  // (2.50, 48.50) est sur le côté sud : retiré à 150 m ; trou ignoré ; deux polygones = deux anneaux.
  const idf = rings([FX[0]], 150);
  assert.deepEqual(idf, [
    [[2, 48.5], [3, 48.5], [3, 49], [2, 49], [2, 48.5]],
    [[1.5, 48.8], [1.6, 48.8], [1.6, 48.9], [1.5, 48.8]],
  ]);
  // (2.31, 48.85) à ≈ 5 km du côté sud : gardé à 50 m.
  assert.deepEqual(rings([FX[1]], 50)[0], [[2.2, 48.8], [2.3, 48.8], [2.31, 48.85], [2.4, 48.8], [2.4, 48.9], [2.2, 48.9], [2.2, 48.8]]);
  // Écart de 30 m : retiré à 50 m, gardé à 10 m ; coordonnées arrondies à 4 décimales ; anneau fermé.
  const r = [[5, 45], [5.000049, 45.0003], [5, 45.01], [5.01, 45.01], [5.01, 45], [5, 45]];
  const r30 = [[5, 45], [5.0004, 45.005], [5, 45.01], [5.01, 45.01], [5.01, 45], [5, 45]];
  assert.equal(simplify(r30, 50).length, 5);
  assert.equal(simplify(r30, 10).length, 6);
  assert.deepEqual(simplify(r, 1)[1], [5, 45.0003]);
  assert.deepEqual(simplify(r30, 50).at(-1), simplify(r30, 50)[0]);
  // Anneau trop petit après simplification : écarté.
  assert.deepEqual(rings([{ geometry: { type: 'Polygon', coordinates: [[[5, 45], [5.0001, 45], [5, 45]]] } }], 50), []);
  assert.deepEqual(rings([{ geometry: { type: 'Point', coordinates: [5, 45] } }, { geometry: null }], 50), []);
});

test('fichier des zones : clés écrites, zones absente / ambiguë non écrites, codes lus dans props', () => {
  const z = buildZones(foundAll(), OPTS);
  assert.ok(z.text);
  const d = JSON.parse(z.text);
  assert.deepEqual(Object.keys(d), ['source', 'layer', 'year', 'read', 'tolerance', 'names', 'props',
    'ileDeFrance', 'metropoleGrandParis', 'aixMarseille', 'lille', 'bordeaux', 'nice', 'montpellier', 'rennes', 'toulon']);
  assert.equal(d.toulouse, undefined);
  assert.equal(d.grenoble, undefined);
  assert.equal(d.rouen, undefined);
  assert.equal(d.nantes, undefined);
  assert.match(d.source, /IGN Admin Express COG \(ADMINEXPRESS-COG\.2026.*Licence Ouverte Etalab 2\.0, © IGN/);
  assert.deepEqual(d.tolerance, { region: 150, epci: 50 });
  assert.equal(d.props.ileDeFrance.code_insee, '11');
  assert.equal(d.props.metropoleGrandParis.code_siren, '200054781');
  assert.equal(d.props.aixMarseille.code_siren, '200054807');
  assert.equal(d.names.lille, 'METROPOLE EUROPEENNE DE LILLE');
  assert.equal(d.names.nice, 'Métropole Nice Côte d’Azur');
  assert.equal(d.props.toulon.code_siren, '900000009');
  assert.deepEqual(Object.keys(d.props), ['ileDeFrance', 'metropoleGrandParis', 'aixMarseille', 'lille', 'bordeaux',
    'nice', 'montpellier', 'rennes', 'toulon']);
  for (const k of Object.keys(d.props)) {
    for (const ring of d[k]) {
      assert.ok(ring.length >= 4);
      assert.deepEqual(ring[0], ring.at(-1));
      for (const p of ring) for (const v of p) assert.equal(Math.round(v * 1e4) / 1e4, v);
    }
  }
  const log = z.log.join('\n');
  assert.match(log, /⚠ toulouse \(« Toulouse Métropole »\) : ambigu \(2 objets\), clé non écrite ; noms proches trouvés : « Toulouse Métropole »\./);
  assert.match(log, /⚠ nantes \(« Nantes Métropole »\) : absent, clé non écrite ; noms proches trouvés : « Communauté de communes d'Erdre et Gesvres \(près de Nantes\) »\./);
  assert.match(log, /ileDeFrance : « Île-de-France » \(region, code 11\), 2 anneau\(x\), 9 points \(150 m\)\./);
  assert.match(log, /⚠ grenoble \(« Grenoble-Alpes-Métropole »\) : ambigu \(2 objets\), clé facultative non écrite ; noms proches trouvés : « Grenoble-Alpes-Métropole », « Grenoble Alpes Métropole »\./);
  assert.match(log, /⚠ rouen \(« Métropole Rouen Normandie »\) : absent, clé facultative non écrite ; noms proches trouvés : « Communauté d'agglomération Seine-Eure \(près de Rouen\) »\./);
  assert.match(log, /rennes : « Rennes Métropole » \(epci, code 900000003\), 1 anneau\(x\), 4 points \(50 m\)\./);
  assert.match(log, /data\/zones-agglo\.json : 9\/13 zone\(s\) \(2 facultative\(s\) manquante\(s\)\), \d+ octets \(plafond 500000\)\./);
});

test('fichier des zones : requête échouée = zone absente ; aucune zone = rien écrit', () => {
  const found = foundAll();
  delete found.lille;
  const z = buildZones(found, OPTS);
  assert.equal(JSON.parse(z.text).lille, undefined);
  assert.ok(JSON.parse(z.text).bordeaux);
  assert.match(z.log.join('\n'), /⚠ lille \(« Métropole Européenne de Lille »\) : requête échouée, clé non écrite\./);
  const none = buildZones({}, OPTS);
  assert.equal(none.text, null);
  assert.match(none.log.at(-1), /⚠ Aucune zone trouvée : data\/zones-agglo\.json non écrit\./);
  const empty = buildZones(Object.fromEntries(ZONES.map((x) => [x.key, []])), OPTS);
  assert.equal(empty.text, null);
  assert.match(empty.log[0], /absent, clé non écrite ; noms proches trouvés : aucun\./);
});

test('zones facultatives : candidats des 7 anciennes zones seulement (ancien fichier) → 7 clés, aucune erreur', () => {
  const found = Object.fromEntries(ZONES.filter((z) => !z.optional).map((z) => [z.key, like(z)]));
  found.toulouse = found.toulouse.slice(0, 1);
  found.nantes = [{ properties: { nom_officiel: 'Nantes Métropole', code_siren: '900000010' }, geometry: { type: 'Polygon', coordinates: [[[-1.7, 47.15], [-1.4, 47.15], [-1.4, 47.3], [-1.7, 47.15]]] } }];
  const z = buildZones(found, OPTS);
  const d = JSON.parse(z.text);
  assert.deepEqual(Object.keys(d).slice(7), [...AGGLO_ZONES.ZONES_KEYS]);
  for (const k of ['nice', 'montpellier', 'rennes', 'grenoble', 'rouen', 'toulon']) {
    assert.equal(d[k], undefined);
    assert.match(z.log.join('\n'), new RegExp(`⚠ ${k} \\(« .+ »\\) : requête échouée, clé facultative non écrite\\.`));
  }
  assert.match(z.log.at(-1), /: 7\/13 zone\(s\) \(6 facultative\(s\) manquante\(s\)\), /);
});

test('appli : fichier à 7 ou 13 clés → mêmes 9 zones lues, clés facultatives ignorées (ZONES_KEYS inchangé)', () => {
  assert.deepEqual([...AGGLO_ZONES.ZONES_KEYS],
    ['ileDeFrance', 'metropoleGrandParis', 'aixMarseille', 'lille', 'bordeaux', 'toulouse', 'nantes']);
  const z7 = JSON.parse(readFileSync(new URL('../data/zones-agglo.json', import.meta.url), 'utf8'));
  const contours = JSON.parse(readFileSync(new URL('../data/contours-ign.json', import.meta.url), 'utf8'));
  // Fichier du dépôt : 7 ou 13 clés de zones (avant ou après le run de l'Action), jamais une autre.
  const zoneKeys = Object.keys(z7).filter((k) => ZONES.some((x) => x.key === k));
  assert.ok([7, 13].includes(zoneKeys.length), zoneKeys.join());
  for (const k of AGGLO_ZONES.ZONES_KEYS) assert.ok(zoneKeys.includes(k), k);
  // 13 clés : contours synthétiques (2 décimales) des 6 zones facultatives, dont un sur Paris.
  const z13 = { ...z7 };
  const sq = (x, y) => [[[x, y], [x + 0.1, y], [x + 0.1, y + 0.1], [x, y + 0.1], [x, y]]];
  z13.nice = sq(7.2, 43.65); z13.montpellier = sq(3.85, 43.6); z13.rennes = sq(-1.7, 48.1);
  z13.grenoble = sq(5.7, 45.15); z13.rouen = sq(1.05, 49.4); z13.toulon = sq(2.3, 48.8);
  const p7 = parseAggloZones(z7, contours);
  const p13 = parseAggloZones(z13, contours);
  assert.ok(p7);
  assert.deepEqual(p13, p7);
  assert.equal(aggloZoneAt([7.25, 43.7], p13), null);
  assert.equal(aggloZoneAt([2.35, 48.86], p13), aggloZoneAt([2.35, 48.86], p7));
  // Clé facultative absente ou illisible : rien ne change.
  assert.deepEqual(parseAggloZones({ ...z13, rouen: undefined, toulon: 'x' }, contours), p7);
});

test('plafond 500 Ko : au-delà, rien écrit (jamais partiel), ⚠ avec les chiffres', () => {
  // Contour en dents de scie (écarts de ≈ 1 km) : aucun point retiré à 50 m, > 500 000 octets.
  const ring = [];
  for (let i = 0; i < 40000; i += 1) ring.push([Math.round((1 + i * 0.0005) * 1e4) / 1e4, i % 2 ? 43.01 : 43]);
  ring.push([21, 44], ring[0]);
  const found = foundAll();
  found.nantes = [{ properties: { nom_officiel: 'Nantes Métropole', code_siren: '244400404' }, geometry: { type: 'Polygon', coordinates: [ring] } }];
  const z = buildZones(found, OPTS);
  assert.equal(z.text, null);
  const msg = z.log.at(-1);
  const m = msg.match(/^⚠ data\/zones-agglo\.json : (\d+) octets > plafond 500000 octets : rien écrit\.$/);
  assert.ok(m, msg);
  assert.ok(Number(m[1]) > ZONES_MAX_BYTES);
  // Même contenu sous le plafond : écrit.
  const ok = buildZones(found, { ...OPTS, maxBytes: Number(m[1]) });
  assert.ok(ok.text);
  assert.equal(Buffer.byteLength(ok.text), Number(m[1]));
});

test('data/contours-ign.json inchangé : mêmes clés, aucune zone dedans', () => {
  const c = JSON.parse(readFileSync(new URL('../data/contours-ign.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(c), ['source', 'layer', 'year', 'read', 'tolerance', 'alsace', 'grandEst',
    'meurtheEtMoselle', 'eurometropole', 'props', 'metropoleLyon']);
  assert.deepEqual(Object.keys(c.props), ['epci', 'region', 'metropoleLyon']);
  assert.deepEqual(c.tolerance, { departement: 150, region: 150, epci: 50 });
  for (const z of ZONES) {
    assert.equal(c[z.key], undefined);
    assert.equal(c.props[z.key], undefined);
  }
  // L'outil écrit les zones dans un fichier à part, jamais dans l'objet de data/contours-ign.json.
  const src = readFileSync(new URL('../tools/contours-ign.mjs', import.meta.url), 'utf8');
  for (const z of ZONES) assert.ok(!src.includes(`result.${z.key}`), z.key);
  assert.match(src, /process\.argv\[3\] \?\? 'data\/zones-agglo\.json'/);
  for (const k of ['alsace', 'grandEst', 'meurtheEtMoselle', 'eurometropole']) assert.match(src, new RegExp(`  ${k}: rings\\(`));
  assert.match(src, /result\.metropoleLyon = rings\(lyon, 50\);/);
});

test('Action « Contours IGN » : data/zones-agglo.json ajouté au commit, aucun schedule', () => {
  const yml = readFileSync(new URL('../.github/workflows/contours-ign.yml', import.meta.url), 'utf8');
  assert.match(yml, /git add data\/contours-ign\.json\n\s+if \[ -f data\/zones-agglo\.json \]; then git add data\/zones-agglo\.json; fi\n/);
  assert.doesNotMatch(yml, /schedule/);
  assert.match(yml, /run: node tools\/contours-ign\.mjs data\/contours-ign\.json\n/);
});
