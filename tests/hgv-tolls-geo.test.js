process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDirections } from '../src/lib/ors-response.js';
import { parseTollData, tollRules, tollsAlongRoute } from '../src/lib/hgv-tolls.js';
import {
  TOLLS_GEO, normalizeRefs, axisDiff, tollWayFromFeature, parseTollNetwork, matchTollNetwork, encodeLine,
} from '../src/lib/hgv-tolls-geo.js';
import { convertTollNetwork, osmiumTollsFilter, tollsBbox } from '../src/lib/hgv-tolls-convert.js';
import { parseGeojsonLine } from '../src/lib/areas-osm-data.js';
import { routeDiagnosticText } from '../src/lib/route-diagnostic.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const routeOf = (name) => parseDirections(JSON.parse(fixture(name)));
const real = parseTollData(JSON.parse(readFileSync(new URL('../data/taxes-pl.json', import.meta.url), 'utf8')));
const ways = fixture('osm-tolls.geojsonseq').split('\n').map(parseGeojsonLine).map(tollWayFromFeature).filter(Boolean);
const converted = convertTollNetwork(ways, real, { updated: '2026-12-01' });
const network = parseTollNetwork(JSON.parse(JSON.stringify(converted.json)));
const dep = new Date(2026, 10, 25, 9, 0);
const truck = { weight: 19, euroClass: '6' };
/** Étapes sans nom ni référence (constat des diagnostics v30 : 90 km sans référence entre Mulhouse et Strasbourg). */
const unnamed = (r) => ({ ...r, steps: r.steps.map((s) => ({ ...s, name: '-' })) });
const alsace = routeOf('ors-directions-alsace.json');
const metz = routeOf('ors-directions-metz-nancy.json');

test('références normalisées : espaces, plusieurs références, majuscules', () => {
  assert.deepEqual(normalizeRefs('A 35;E 25'), ['A35', 'E25']);
  assert.deepEqual(normalizeRefs('a 35 ; e 25'), ['A35', 'E25']);
  assert.deepEqual(normalizeRefs('Autoroute des Cigognes, A 35'), ['A35']);
  assert.deepEqual(normalizeRefs('RN 4'), ['N4']);
  assert.deepEqual(normalizeRefs(''), []);
  // Veto par le nom d'étape : « A35 » (étape ORS) et « A 35;E 25 » (OSM) désignent la même route.
  const [a] = normalizeRefs('A35');
  assert.ok(normalizeRefs('A 35;E 25').includes(a));
});

test('écart de cap modulo 180° : sens de circulation ignoré', () => {
  assert.equal(axisDiff(10, 190), 0);
  assert.equal(axisDiff(350, 10), 20);
  assert.equal(axisDiff(0, 90), 90);
  assert.equal(axisDiff(30, 200), 10);
  assert.equal(axisDiff(100, 260), 20);
});

test('voies lues : bretelles et routes sans référence écartées, toll et sens unique gardés', () => {
  const ids = ways.map((w) => w.id);
  assert.ok(!ids.includes(107), 'bretelle');
  assert.ok(!ids.includes(109), 'sans référence');
  assert.deepEqual(ways.find((w) => w.id === 102).refs, ['A35', 'E25']);
  assert.equal(ways.find((w) => w.id === 108).toll, 'yes');
  assert.deepEqual(osmiumTollsFilter(), ['w/highway=motorway,trunk,primary,secondary,tertiary']);
  const b = tollsBbox(real);
  assert.ok(b[0] <= 4.6 && b[2] >= 8.24 && b[1] <= 47.42 && b[3] >= 49.6);
});

test('conversion : toll=yes exclu et compté, Eurométropole exclue, M35 jamais lue, journal par référence', () => {
  const rp = converted.json.taxes['r-pass'];
  const ec = converted.json.taxes.ecpl;
  assert.ok(rp && ec);
  assert.equal(converted.json.updated, '2026-12-01');
  assert.match(converted.json.license, /ODbL/);
  assert.match(converted.json.contours, /IGN Admin Express.*Licence Ouverte/);
  assert.ok(rp.km.A35.kept > 80, `A35 gardée ${rp.km.A35.kept} km`);
  assert.equal(rp.km.A35.toll, 0);
  assert.ok(rp.km.A36.toll > 5, 'A36 à péage comptée à part');
  assert.ok(ec.km.A31.kept > 20 && ec.km.A31.toll > 2, "voies à sens unique comptées pour moitié");
  // Aucune ligne gardée dans l'Eurométropole (« A 35 » 106 au même endroit que la M35 105).
  const net = network.taxes['r-pass'];
  assert.ok(net.segments.every((s) => !(s.a[1] > 48.5 && s.a[0] > 7.68 && s.b[1] > 48.5)), 'segment dans l\'Eurométropole');
  assert.ok(net.segments.every((s) => !s.refs.includes('M35')));
  const rLog = converted.log.find((l) => /^R-Pass/.test(l));
  assert.match(rLog, /A35 gardés \d+,\d km, exclus toll=yes 0,0 km/);
  assert.match(rLog, /A36 gardés \d+,\d km, exclus toll=yes \d+,\d km/);
  assert.match(converted.log.find((l) => /^Écocontribution/.test(l)), /total gardé ≈ \d+,\d km de route \(environ 525 km annoncés\)/);
});

test('Mulhouse → Strasbourg sans aucune référence : R-Pass trouvé sur l\'A35 par la géométrie', () => {
  const r = unnamed(alsace);
  assert.equal(tollsAlongRoute(r, { data: real, departure: dep }).length, 0, 'aveugle par les noms (v30)');
  const [p, ...rest] = tollsAlongRoute(r, { data: real, network, departure: dep });
  assert.ok(p, 'R-Pass non trouvé');
  assert.equal(rest.length, 0);
  assert.equal(p.method, 'osm');
  assert.ok(p.enter < 1000 && p.exit > 85000 && p.exit < 93000, `km ${p.enter}–${p.exit}`);
  assert.deepEqual(p.roads.sort(), ['A35', 'A36']);
  const line = tollRules(r, { vehicle: truck, tolls: { status: 'ok', data: real, network }, departure: dep }).lines[0];
  assert.equal(line.level, 'info', 'annoncée : jamais une alerte');
  assert.match(line.text, /prévue à partir du 1er janvier 2027, de km 0 à km \d+ \(A3[56], A3[56] ; repérage sur la carte OpenStreetMap du 01\/12\/2026 \(ODbL\) et les contours IGN Admin Express \(Licence Ouverte\), limites exactes à vérifier\)/);
  assert.doesNotMatch(line.text, /au moins/);
  assert.match(line.text, /La signalisation fait foi\.$/);
});

test('Metz → Nancy sans référence : écocontribution sur l\'A31 de bout en bout', () => {
  const r = unnamed(metz);
  const [p] = tollsAlongRoute(r, { data: real, network, departure: dep });
  assert.equal(p.tax.id, 'ecpl');
  assert.ok(p.enter < 500 && p.exit > 42000, `km ${p.enter}–${p.exit}`);
});

test('veto du nom d\'étape : une étape qui nomme une autre route refuse le point', () => {
  const r = { ...alsace, steps: alsace.steps.map((s) => ({ ...s, name: 'D 1083' })) };
  assert.equal(tollsAlongRoute(r, { data: real, network, departure: dep }).length, 0);
  // « A 35, E 25 » (ORS) contre « A 35;E 25 » (OSM) : même route.
  assert.equal(tollsAlongRoute(alsace, { data: real, network, departure: dep })[0].method, 'osm');
});

const tax = { roads: ['A35'], bbox: [7, 48, 8, 49] };
/** Réseau d'une ligne nord-sud à 7,5° E, de 48,1 à 48,2° N. */
const lineNet = () => parseTollNetwork({ updated: '2026-12-01', taxes: { t: { refs: [['A35']], lines: [encodeLine(0, [[7.5, 48.1], [7.5, 48.2]])] } } }).taxes.t;
const mPerDegLon = 111320 * Math.cos(48.15 * Math.PI / 180);

test('tolérance 15 m : parallèle à 10 m comptée, à 25 m non', () => {
  const at = (m) => ({ coordinates: [[7.5 + m / mPerDegLon, 48.11], [7.5 + m / mPerDegLon, 48.19]], steps: [] });
  assert.equal(matchTollNetwork(at(10), lineNet(), tax).length, 1);
  assert.equal(matchTollNetwork(at(25), lineNet(), tax).length, 0);
  // Sens inverse (cap à 180°) : compté.
  assert.equal(matchTollNetwork({ coordinates: [[7.5, 48.19], [7.5, 48.11]], steps: [] }, lineNet(), tax).length, 1);
  assert.equal(TOLLS_GEO.TOLERANCE_M, 15);
});

test('pont au-dessus de l\'autoroute : croisement non compté (cap)', () => {
  const r = { coordinates: [[7.49, 48.15], [7.51, 48.15]], steps: [] };
  assert.equal(matchTollNetwork(r, lineNet(), tax).length, 0);
  // Biais de 40° sur 300 m : refusé aussi ; 20° : compté.
  const skew = (deg, len = 2000) => {
    const dx = (Math.sin(deg * Math.PI / 180) * len) / mPerDegLon; const dy = (Math.cos(deg * Math.PI / 180) * len) / 111200;
    return { coordinates: [[7.5 - dx / 2, 48.15 - dy / 2], [7.5 + dx / 2, 48.15 + dy / 2]], steps: [] };
  };
  assert.equal(matchTollNetwork(skew(40), lineNet(), tax).length, 0);
  assert.equal(matchTollNetwork(skew(0.3), lineNet(), tax).length, 1);
});

test('série de moins de 300 m écartée', () => {
  const r = { coordinates: [[7.49, 48.1495], [7.5, 48.15], [7.5, 48.1525], [7.51, 48.153]], steps: [] };
  assert.equal(matchTollNetwork(r, lineNet(), tax).length, 0);
});

test('copie illisible ou sans la taxe : repli sur les noms d\'étape (« au moins »)', () => {
  assert.equal(parseTollNetwork(null), null);
  assert.equal(parseTollNetwork({ taxes: { 'r-pass': { refs: [], lines: [[0, 1]] } } }), null);
  const onlyEcpl = { ...network, taxes: { ecpl: network.taxes.ecpl } };
  const [p] = tollsAlongRoute(alsace, { data: real, network: onlyEcpl, departure: dep });
  assert.equal(p.method, 'names');
  const t = tollRules(alsace, { vehicle: truck, tolls: { status: 'ok', data: real, network: null }, departure: dep });
  assert.match(t.lines[0].text, /au moins de km 0 .*repérage par les noms d'étape, carte OpenStreetMap du réseau non chargée/);
  assert.deepEqual(t.method.map((m) => m.method), ['names', 'names']);
});

test('diagnostic : méthode écrite, point tous les 10 km sur les étapes sans nom de plus de 5 km', () => {
  const r = unnamed(alsace);
  const rules = { tolls: tollRules(r, { vehicle: truck, tolls: { status: 'ok', data: real, network }, departure: dep }) };
  const text = routeDiagnosticText(r, { version: 'Gabarit v32', rules });
  assert.match(text, /Méthode taxes PL : R-Pass : géométrie OSM \(copie du 01\/12\/2026\) ; Écocontribution PL : géométrie OSM \(copie du 01\/12\/2026\)/);
  assert.match(text, /R-Pass : km 0,0–\d+,\d \(A3[56], A3[56]\) — géométrie OSM/);
  // Étape « - » de 88 km (km 4,5 à 92,5) : points à km 14,5, 24,5…, arrondis à 0,001°.
  const pts = text.split('\n').filter((l) => /^ {4}point km /.test(l));
  assert.ok(pts.length >= 8, pts.join('\n'));
  assert.match(pts[0], /^ {4}point km 14,5 : 4\d\.\d{3}, 7\.\d{3}$/);
  const noNet = routeDiagnosticText(r, { rules: { tolls: tollRules(r, { vehicle: truck, tolls: { status: 'ok', data: real }, departure: dep }) } });
  assert.match(noNet, /Méthode taxes PL : R-Pass : noms d'étape \(réseau OSM non chargé\)/);
});
