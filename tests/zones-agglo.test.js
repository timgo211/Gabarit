// Contours des grandes agglomérations (data/zones-agglo.json, PR 1 sur 3 : contours seulement) : zones cherchées par
// leur nom dans les couches IGN Admin Express, simplification, plafond 500 Ko ; v92 : 13 zones obligatoires, une
// manquante = rien écrit (exitCode 1) ; data/contours-ign.json
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
/**
 * Les 13 zones trouvées, une seule fois chacune : candidats de la fixture, doublons de Toulouse et de Grenoble
 * écartés, Nantes et Rouen (absentes de la fixture) ajoutées en formes SYNTHÉTIQUES (2 décimales, codes fictifs).
 */
function foundComplete() {
  const f = foundAll();
  f.toulouse = f.toulouse.filter((x) => x.properties.code_siren !== '999999999');
  f.grenoble = f.grenoble.filter((x) => x.properties.code_siren === '900000005');
  f.nantes = [...f.nantes, { properties: { nom_officiel: 'Nantes Métropole', code_siren: '900000010' }, geometry: { type: 'Polygon', coordinates: [[[-1.7, 47.15], [-1.4, 47.15], [-1.4, 47.3], [-1.7, 47.15]]] } }];
  f.rouen = [...f.rouen, { properties: { nom_officiel: 'Métropole Rouen Normandie', code_siren: '900000011' }, geometry: { type: 'Polygon', coordinates: [[[0.95, 49.35], [1.25, 49.35], [1.25, 49.5], [0.95, 49.35]]] } }];
  return f;
}
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
  // v92 : l'outil écrit exactement les zones lues par l'appli (ZONES_KEYS, même ordre), toutes obligatoires.
  assert.deepEqual(ZONES.map((z) => z.key), [...AGGLO_ZONES.ZONES_KEYS]);
  for (const z of ZONES) assert.deepEqual(Object.keys(z), ['key', 'layer', 'name', 'like', 'tol'], z.key);
  // Les 7 zones d'origine (v91) inchangées.
  assert.deepEqual(ZONES.slice(0, 7).map((z) => ({ ...z })), [
    { key: 'ileDeFrance', layer: 'region', name: 'Île-de-France', like: 'France', tol: 150 },
    { key: 'metropoleGrandParis', layer: 'epci', name: 'Métropole du Grand Paris', like: 'Grand Paris', tol: 50 },
    { key: 'aixMarseille', layer: 'epci', name: "Métropole d'Aix-Marseille-Provence", like: 'Marseille', tol: 50 },
    { key: 'lille', layer: 'epci', name: 'Métropole Européenne de Lille', like: 'Lille', tol: 50 },
    { key: 'bordeaux', layer: 'epci', name: 'Bordeaux Métropole', like: 'Bordeaux', tol: 50 },
    { key: 'toulouse', layer: 'epci', name: 'Toulouse Métropole', like: 'Toulouse', tol: 50 },
    { key: 'nantes', layer: 'epci', name: 'Nantes Métropole', like: 'Nantes', tol: 50 },
  ]);
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

test('fichier des zones : les 13 présentes → fichier écrit comme avant, codes lus dans props, exitCode 0', () => {
  const z = buildZones(foundComplete(), OPTS);
  assert.ok(z.text);
  assert.equal(z.exitCode, 0);
  const d = JSON.parse(z.text);
  assert.deepEqual(Object.keys(d), ['source', 'layer', 'year', 'read', 'tolerance', 'names', 'props', ...AGGLO_ZONES.ZONES_KEYS]);
  assert.equal(d.source, 'IGN Admin Express COG (ADMINEXPRESS-COG.2026, WFS Géoplateforme data.geopf.fr), Licence Ouverte Etalab 2.0, © IGN');
  assert.equal(d.layer, 'ADMINEXPRESS-COG.2026');
  assert.equal(d.year, 2026);
  assert.equal(d.read, '2026-11-26');
  assert.deepEqual(d.tolerance, { region: 150, epci: 50 });
  assert.deepEqual(Object.keys(d.names), [...AGGLO_ZONES.ZONES_KEYS]);
  assert.deepEqual(Object.keys(d.props), [...AGGLO_ZONES.ZONES_KEYS]);
  assert.equal(d.props.ileDeFrance.code_insee, '11');
  assert.equal(d.props.metropoleGrandParis.code_siren, '200054781');
  assert.equal(d.props.aixMarseille.code_siren, '200054807');
  assert.equal(d.props.toulouse.code_siren, '243100518');
  assert.equal(d.names.lille, 'METROPOLE EUROPEENNE DE LILLE');
  assert.equal(d.names.bordeaux, 'Bordeaux  Métropole'); // nom lu tel quel (espaces bords retirés seulement)
  assert.equal(d.names.nice, 'Métropole Nice Côte d’Azur');
  assert.equal(d.props.grenoble.code_siren, '900000005');
  assert.equal(d.props.toulon.code_siren, '900000009');
  for (const k of AGGLO_ZONES.ZONES_KEYS) {
    for (const ring of d[k]) {
      assert.ok(ring.length >= 4);
      assert.deepEqual(ring[0], ring.at(-1));
      for (const p of ring) for (const v of p) assert.equal(Math.round(v * 1e4) / 1e4, v);
    }
  }
  // Texte du fichier : JSON sur une ligne + saut de ligne, comme avant.
  assert.equal(z.text, `${JSON.stringify(d)}\n`);
  const log = z.log.join('\n');
  assert.doesNotMatch(log, /⚠/);
  assert.match(log, /ileDeFrance : « Île-de-France » \(region, code 11\), 2 anneau\(x\), 9 points \(150 m\)\./);
  assert.match(log, /rennes : « Rennes Métropole » \(epci, code 900000003\), 1 anneau\(x\), 4 points \(50 m\)\./);
  assert.match(z.log.at(-1), /^data\/zones-agglo\.json : 13\/13 zone\(s\), \d+ octets \(plafond 500000\)\.$/);
  // L'appli lit ce fichier (15 zones avec Lyon et Strasbourg).
  const contours = JSON.parse(readFileSync(new URL('../data/contours-ign.json', import.meta.url), 'utf8'));
  assert.equal(parseAggloZones(d, contours).zones.length, 15);
});

test('fichier des zones : zones absente / ambiguë → ⚠ avec les noms proches, RIEN écrit, exitCode 1', () => {
  const z = buildZones(foundAll(), OPTS);
  assert.equal(z.text, null);
  assert.equal(z.exitCode, 1);
  const log = z.log.join('\n');
  assert.match(log, /⚠ toulouse \(« Toulouse Métropole »\) : ambigu \(2 objets\), zone manquante ; noms proches trouvés : « Toulouse Métropole »\./);
  assert.match(log, /⚠ nantes \(« Nantes Métropole »\) : absent, zone manquante ; noms proches trouvés : « Communauté de communes d'Erdre et Gesvres \(près de Nantes\) »\./);
  assert.match(log, /⚠ grenoble \(« Grenoble-Alpes-Métropole »\) : ambigu \(2 objets\), zone manquante ; noms proches trouvés : « Grenoble-Alpes-Métropole », « Grenoble Alpes Métropole »\./);
  assert.match(log, /⚠ rouen \(« Métropole Rouen Normandie »\) : absent, zone manquante ; noms proches trouvés : « Communauté d'agglomération Seine-Eure \(près de Rouen\) »\./);
  // Les zones trouvées restent au journal, mais aucun fichier partiel.
  assert.match(log, /ileDeFrance : « Île-de-France » \(region, code 11\), 2 anneau\(x\), 9 points \(150 m\)\./);
  assert.equal(z.log.at(-1), '⚠ data/zones-agglo.json : 4 zone(s) manquante(s) sur 13 (toulouse, nantes, grenoble, rouen) : rien écrit, l\'ancien fichier reste.');
  assert.ok(!z.log.some((l) => /zone\(s\), \d+ octets/.test(l)));
});

test('fichier des zones : une seule zone manquante parmi les 13 (absente, ambiguë, illisible, requête échouée) → rien écrit, exitCode 1', () => {
  const ok = buildZones(foundComplete(), OPTS);
  assert.equal(ok.exitCode, 0);
  const bad = (x) => [{ properties: { nom_officiel: x.name, code_siren: '900000099' }, geometry: { type: 'Point', coordinates: [5, 45] } }];
  for (const z of ZONES) {
    const near = { properties: { nom_officiel: `${z.name} (voisin)`, code_siren: '900000098' }, geometry: null };
    const cases = {
      'requête échouée': (f) => { delete f[z.key]; },
      absent: (f) => { f[z.key] = [near]; },
      'ambigu (2 objets)': (f) => { f[z.key] = [...f[z.key], f[z.key].find((x) => normName(x.properties.nom_officiel) === normName(z.name))]; },
      'aucun anneau lisible': (f) => { f[z.key] = bad(z); },
    };
    for (const [why, mutate] of Object.entries(cases)) {
      const found = foundComplete();
      mutate(found);
      const r = buildZones(found, OPTS);
      assert.equal(r.text, null, `${z.key} ${why}`);
      assert.equal(r.exitCode, 1, `${z.key} ${why}`);
      assert.ok(r.log.some((l) => l.startsWith(`⚠ ${z.key} (« ${z.name} ») : ${why}`)), `${z.key} ${why}`);
      assert.equal(r.log.at(-1), `⚠ data/zones-agglo.json : 1 zone(s) manquante(s) sur 13 (${z.key}) : rien écrit, l'ancien fichier reste.`);
    }
  }
  // Rien trouvé du tout, ou listes vides : rien écrit.
  for (const found of [{}, undefined, Object.fromEntries(ZONES.map((x) => [x.key, []]))]) {
    const r = buildZones(found, OPTS);
    assert.equal(r.text, null);
    assert.equal(r.exitCode, 1);
    assert.match(r.log.at(-1), /^⚠ data\/zones-agglo\.json : 13 zone\(s\) manquante\(s\) sur 13 /);
  }
  assert.match(buildZones(Object.fromEntries(ZONES.map((x) => [x.key, []])), OPTS).log[0], /absent, zone manquante ; noms proches trouvés : aucun\./);
});

test('ancien jeu de 7 zones seulement (6 ajoutées en échec) → rien écrit, exitCode 1, jamais « facultative »', () => {
  const found = foundComplete();
  for (const k of ['nice', 'montpellier', 'rennes', 'grenoble', 'rouen', 'toulon']) delete found[k];
  const z = buildZones(found, OPTS);
  assert.equal(z.text, null);
  assert.equal(z.exitCode, 1);
  for (const k of ['nice', 'montpellier', 'rennes', 'grenoble', 'rouen', 'toulon']) {
    assert.match(z.log.join('\n'), new RegExp(`⚠ ${k} \\(« .+ »\\) : requête échouée, zone manquante\\.`));
  }
  assert.equal(z.log.at(-1), '⚠ data/zones-agglo.json : 6 zone(s) manquante(s) sur 13 (nice, montpellier, rennes, grenoble, rouen, toulon) : rien écrit, l\'ancien fichier reste.');
  assert.doesNotMatch(z.log.join('\n'), /facultative/);
});

test('appli (v92) : fichier du dépôt à 13 clés lu (15 zones) ; sans une clé ajoutée en v92 → refusé (tout ou rien)', () => {
  const z13 = JSON.parse(readFileSync(new URL('../data/zones-agglo.json', import.meta.url), 'utf8'));
  const contours = JSON.parse(readFileSync(new URL('../data/contours-ign.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(z13).filter((k) => ZONES.some((x) => x.key === k)), [...AGGLO_ZONES.ZONES_KEYS]);
  const p13 = parseAggloZones(z13, contours);
  assert.ok(p13);
  assert.deepEqual(p13.zones.map((z) => z.key), [...AGGLO_ZONES.ZONES_KEYS, ...AGGLO_ZONES.CONTOURS_KEYS]);
  for (const k of ['nice', 'montpellier', 'rennes', 'grenoble', 'rouen', 'toulon']) {
    assert.equal(parseAggloZones({ ...z13, [k]: undefined }, contours), null, k);
    assert.equal(parseAggloZones({ ...z13, [k]: 'x' }, contours), null, k);
  }
  assert.equal(aggloZoneAt([6.02, 47.24], p13), null); // Besançon : hors zone
});

test('plafond 500 Ko (inchangé) : au-delà, rien écrit (jamais partiel), ⚠ avec les chiffres, exitCode 1', () => {
  // Contour en dents de scie (écarts de ≈ 1 km) : aucun point retiré à 50 m, > 500 000 octets.
  const ring = [];
  for (let i = 0; i < 40000; i += 1) ring.push([Math.round((1 + i * 0.0005) * 1e4) / 1e4, i % 2 ? 43.01 : 43]);
  ring.push([21, 44], ring[0]);
  const found = foundComplete();
  found.nantes = [{ properties: { nom_officiel: 'Nantes Métropole', code_siren: '244400404' }, geometry: { type: 'Polygon', coordinates: [ring] } }];
  const z = buildZones(found, OPTS);
  assert.equal(z.text, null);
  assert.equal(z.exitCode, 1);
  const msg = z.log.at(-1);
  const m = msg.match(/^⚠ data\/zones-agglo\.json : (\d+) octets > plafond 500000 octets : rien écrit\.$/);
  assert.ok(m, msg);
  assert.ok(Number(m[1]) > ZONES_MAX_BYTES);
  // Même contenu sous le plafond : écrit.
  const ok = buildZones(found, { ...OPTS, maxBytes: Number(m[1]) });
  assert.ok(ok.text);
  assert.equal(Buffer.byteLength(ok.text), Number(m[1]));
  assert.equal(ok.exitCode, 0);
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
