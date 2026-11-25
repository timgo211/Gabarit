// Points sensibles avant départ (PR 3b) : construction depuis les fiches d'audit, rapprochement du tracé, textes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  SENSITIVE, buildSensitivePoints, sensitiveType, auditBridgeIds, parseSensitiveTile, mergeSensitiveTiles,
  parseSensitiveSections, sensitivePointsAlongRoute, concernsVehicle, sensitiveText, sensitiveRules,
  SENSITIVE_UNAVAILABLE_TEXT,
} from '../src/lib/sensitive-points.js';
import { parseAxesTile, mergeAxesTiles, matchRouteAxes, geoStepLabel } from '../src/lib/axis-match.js';
import { routeRules } from '../src/lib/route-rules.js';
import { routeDiagnosticText } from '../src/lib/route-diagnostic.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { fixture } from './helpers.js';

const SECTIONS = [
  { id: 'lyon-a6', refs: ['A6'], nature: 'poids', valeur: 7.5, texte: 'A6, Lissieu → Limonest : marchandises > 7,5 t interdits', arrete: 'arrêté DDT_SST_2019_01_02 du 02/04/2019', source: 'PDF Bison Futé de l\'arrêté', lu: 'arrêté' },
  { id: 'n66', refs: ['N66'], nature: 'transit', valeur: 3.5, texte: 'N66, Remiremont → Cernay : > 3,5 t en transit interdits', arrete: 'inconnu', source: 'Bison Futé', lu: 'Bison Futé' },
  { id: 'fourviere', refs: [], localisable: false, texte: 'Tunnel sous Fourvière', lu: 'arrêté' },
];
const SEMI = { weight: 44, height: 4 };
const VAN = { weight: 3.5, height: 2.8 };
const dLat = (m) => m / 110540;
// Voie est-ouest de 2 km à 45,8° N (A6 synthétique) et tracé qui la suit à 3 m.
const LAT = 45.8;
const axisLine = (ref, lat = LAT) => {
  const c = []; for (let k = 0; k <= 20; k += 1) c.push([4.7 + 0.0257 * (k / 20), lat]); return { ref, refs: ref ? [ref] : [], cls: 0, coords: c };
};
const AXES = { lines: [axisLine('A6'), axisLine('N66', 45.9), axisLine('', 45.95)] };
const route = (name = '', lat = LAT + dLat(3)) => {
  const coordinates = []; for (let k = 0; k <= 40; k += 1) coordinates.push([4.7 + 0.0257 * (k / 40), lat]);
  return { coordinates, duration: 100, distance: 2000, steps: [{ name, wayPoints: [0, 40], duration: 100 }],
    roadExtras: { waycategory: [[0, 40, 1]], waytype: [[0, 40, 1]] } };
};
const card = (type, extra = {}) => ({ way: 1, niveau: 1, type, ref: 'A6', point: [4.71, LAT], etiquettesActuelles: { highway: 'motorway' }, ...extra });
const CARDS = [
  card('interdiction PL absente (lyon-a6)', { section: 'lyon-a6', way: 11 }),
  card('interdiction PL absente (lyon-a6)', { section: 'lyon-a6', way: 12, point: [4.72, LAT] }),
  card('interdiction PL absente (n66)', { section: 'n66', ref: 'N66', way: 13, point: [4.71, 45.9] }),
  card('interdiction PL absente (fourviere)', { section: 'fourviere', way: 14 }),
  card('hauteur basse connue', { way: 21, point: [4.715, LAT], etiquettesActuelles: { highway: 'motorway', maxheight: '3.5' } }),
  card('hauteur basse connue', { way: 22, point: [4.716, LAT], etiquettesActuelles: { highway: 'motorway', maxheight: '4.5' } }),
  card('tunnel sans hauteur', { way: 31, point: [4.718, LAT] }),
  card('tunnel sans hauteur', { way: 32, point: [4.71, 46.2] }), // aucune voie des axes : écarté faute de cap
  card('pont sans hauteur', { way: 41, pont: 900, pontType: 'highway=primary', etiquettesActuelles: { highway: 'trunk' } }),
];

function copyOf(res) {
  const sections = parseSensitiveSections(res.index);
  const data = mergeSensitiveTiles([...res.tiles.values()].map(parseSensitiveTile));
  return { status: 'ok', data, updated: '2026-11-24', meta: { sections } };
}
const built = () => buildSensitivePoints(CARDS, SECTIONS, AXES, { pontsIds: new Set([900]), updated: '2026-11-24' });

test('constantes : 15 m, 30° modulo 180°, cap à 5 m, marge de hauteur 0 m, limites 1 Mo / 5 Mo', () => {
  assert.equal(SENSITIVE.TOLERANCE_M, 15);
  assert.equal(SENSITIVE.MAX_HEADING_DEG, 30);
  assert.equal(SENSITIVE.CAP_NEAR_M, 5);
  assert.equal(SENSITIVE.HEIGHT_MARGIN_M, 0);
  assert.equal(SENSITIVE.MAX_FILE_BYTES, 1024 * 1024);
  assert.equal(SENSITIVE.MAX_TOTAL_BYTES, 5 * 1024 * 1024);
});

test('types gardés : arrêté, Bison Futé marqué, hauteur basse, tunnel ; jamais un pont ni une section non localisable', () => {
  const byId = new Map(SECTIONS.map((s) => [s.id, s]));
  assert.equal(sensitiveType(CARDS[0], byId), SENSITIVE.TYPES.BAN);
  assert.equal(sensitiveType(CARDS[2], byId), SENSITIVE.TYPES.BAN_BF);
  assert.equal(sensitiveType(CARDS[3], byId), null, 'Fourvière non localisable');
  assert.equal(sensitiveType(CARDS[4], byId), SENSITIVE.TYPES.LOW);
  assert.equal(sensitiveType(CARDS[6], byId), SENSITIVE.TYPES.TUNNEL);
  assert.equal(sensitiveType(CARDS[8], byId), null, 'ponts : alerte de la phase 12a');
  // Ponts gardés par le plan : jamais au-dessus d'une autoroute, ouvrage route ≥ tertiaire ou voie ferrée.
  const ids = auditBridgeIds([
    CARDS[8],
    card('pont sans hauteur', { pont: 901, pontType: 'highway=primary' }), // autoroute dessous
    card('pont sans hauteur', { pont: 902, pontType: 'highway=footway', etiquettesActuelles: { highway: 'trunk' } }),
    card('pont sans hauteur', { pont: 903, pontType: 'railway=rail', etiquettesActuelles: { highway: 'trunk' } }),
  ]);
  assert.deepEqual([...ids].sort(), [900, 903]);
});

test('construction : cap pris sur la copie des axes, écartés comptés par type, ponts recoupés, sections citées', () => {
  const res = built();
  assert.equal(res.problem, null);
  const all = [...res.tiles.values()].flatMap((t) => t.p);
  assert.equal(all.length, 6);
  assert.ok(all.every((p) => p[3] === 90), 'cap est-ouest (modulo 180°)');
  assert.ok(!all.some((p) => p[7] === 41), 'aucun pont');
  assert.match(res.log.join('\n'), /Écartés faute de cap .* : 1 \(interdiction \(arrêté\) 0, interdiction \(Bison Futé\) 0, hauteur basse 0, tunnel sans hauteur 1\)/);
  assert.match(res.log.join('\n'), /Ponts de l'audit gardés : 1 ; absents de data\/ponts-osm\/ .* : 0\./);
  const missing = buildSensitivePoints(CARDS, SECTIONS, AXES, { pontsIds: new Set() });
  assert.match(missing.log.join('\n'), /: 1 \(way\/900\) — à revoir/);
  assert.deepEqual(res.index.sections.map((s) => [s.id, s.lu]), [['lyon-a6', 'arrêté'], ['n66', 'Bison Futé']]);
  // Deux voies de caps différents à 5 m : cap ambigu → écarté.
  const cross = { lines: [axisLine('A6'), { ref: 'A6', refs: ['A6'], cls: 0, coords: [[4.71, LAT - 0.001], [4.71, LAT + 0.001]] }] };
  const amb = buildSensitivePoints([CARDS[0]], SECTIONS, cross, {});
  assert.equal([...amb.tiles.values()].flatMap((t) => t.p).length, 0);
});

test('limites de taille : copie trop grosse → rien d\'écrit, message', () => {
  const many = [];
  for (let i = 0; i < 40000; i += 1) many.push(card('tunnel sans hauteur', { way: 1000 + i, point: [4.7 + (i % 2000) * 0.00001, LAT] }));
  const res = buildSensitivePoints(many, SECTIONS, AXES, {});
  assert.equal(res.tiles, null);
  assert.match(res.problem, /1 Mo|5 Mo/);
  assert.match(res.log.at(-1), /^⚠ data\/points-sensibles\/ non modifié/);
});

test('rapprochement : même voie à 3 m → trouvé, regroupé par section ; voie à 20 m, croisement : rien', () => {
  const copy = copyOf(built());
  const found = sensitivePointsAlongRoute(route(), copy.data);
  const types = found.map((f) => f.type);
  assert.deepEqual(types.filter((t) => t === SENSITIVE.TYPES.BAN).length, 1, 'deux fiches de la même section → une ligne');
  assert.ok(types.includes(SENSITIVE.TYPES.LOW) && types.includes(SENSITIVE.TYPES.TUNNEL));
  assert.ok(!types.includes(SENSITIVE.TYPES.BAN_BF), 'N66 à 11 km : rien');
  assert.equal(sensitivePointsAlongRoute(route('', LAT + dLat(20)), copy.data).length, 0);
  const north = { ...route(), coordinates: [[4.71, LAT - 0.01], [4.71, LAT + 0.01]], steps: [{ name: '', wayPoints: [0, 1] }] };
  assert.equal(sensitivePointsAlongRoute(north, copy.data).length, 0, 'tracé qui croise la voie : rien');
});

test('veto de référence : étape ORS ou repli 3a d\'une autre route → rien', () => {
  const copy = copyOf(built());
  assert.equal(sensitivePointsAlongRoute(route('D 306'), copy.data).length, 0);
  assert.ok(sensitivePointsAlongRoute(route('A 6'), copy.data).length > 0);
  const r = route();
  const geo = { status: 'ok', ref: new Array(40).fill('A7') };
  assert.equal(sensitivePointsAlongRoute(r, copy.data, { geo }).length, 0);
});

test('véhicule : hauteur ≤ véhicule + 0 m → signalée, plus haute → rien ; tonnage au-dessus du seuil seulement', () => {
  const low = { type: SENSITIVE.TYPES.LOW, value: 3.5 };
  const high = { type: SENSITIVE.TYPES.LOW, value: 4.5 };
  assert.equal(concernsVehicle(low, null, SEMI), true);
  assert.equal(concernsVehicle(high, null, SEMI), false);
  assert.equal(concernsVehicle({ type: SENSITIVE.TYPES.LOW, value: 4 }, null, SEMI), true, 'égale : signalée, comme les ponts 12a');
  assert.equal(concernsVehicle(high, null, {}), true, 'hauteur inconnue : gardée');
  const ban = { type: SENSITIVE.TYPES.BAN };
  assert.equal(concernsVehicle(ban, SECTIONS[0], SEMI), true);
  assert.equal(concernsVehicle(ban, SECTIONS[0], VAN), false, 'fourgon 3,5 t : pas concerné par > 7,5 t');
  assert.equal(concernsVehicle(ban, SECTIONS[0], {}), true, 'poids inconnu : gardé');
  assert.equal(concernsVehicle(ban, { nature: 'hauteur', valeur: 4.3 }, SEMI), false);
  assert.equal(concernsVehicle(ban, { nature: 'interdit' }, VAN), true, 'sans seuil lu : toujours');
});

test('textes : « à vérifier », « La signalisation fait foi. », source et arrêté, Bison Futé marqué', () => {
  const it = { type: SENSITIVE.TYPES.BAN, ref: 'A6', along: 12300, way: 11 };
  const t = sensitiveText(it, SECTIONS[0], { updated: '2026-11-24' });
  assert.match(t, /^Point sensible \(A 6, km 12\) : A6, Lissieu → Limonest/);
  assert.match(t, /En vigueur : à vérifier\. La signalisation fait foi\. Source : arrêté DDT_SST_2019_01_02 du 02\/04\/2019 ; OpenStreetMap way\/11, audit Gabarit du 24\/11\/2026\.$/);
  const bf = sensitiveText({ ...it, type: SENSITIVE.TYPES.BAN_BF, ref: 'N66' }, SECTIONS[1], { updated: '2026-11-24' });
  assert.match(bf, /Transit seulement : desserte locale possible, à vérifier\./);
  assert.match(bf, /Source Bison Futé, arrêté non lu ; OpenStreetMap way\/11/);
  assert.match(sensitiveText({ type: SENSITIVE.TYPES.LOW, value: 3.5, ref: 'A6', along: 0, way: 21 }, null, {}), /hauteur limitée à 3,5 m .*: à vérifier\. La signalisation fait foi\./);
  assert.match(sensitiveText({ type: SENSITIVE.TYPES.TUNNEL, ref: '', along: 0, way: 31 }, null, {}), /tunnel sans hauteur renseignée .*La signalisation fait foi\./);
});

test('fiche : résumé « N points sensibles à vérifier », lignes, ligne technique ; fourgon : pas d\'interdiction 7,5 t', () => {
  const copy = copyOf(built());
  const semi = sensitiveRules(route(), { vehicle: SEMI, copy });
  assert.equal(semi.items.length, 3, 'interdiction, hauteur 3,5 m, tunnel (hauteur 4,5 m ignorée)');
  assert.deepEqual(semi.short, ['3 points sensibles à vérifier']);
  assert.ok(semi.lines.every((l) => l.level === 'warn' && /La signalisation fait foi\./.test(l.text)));
  assert.match(semi.tech, /^Points sensibles : 3 \(interdictions 1, dont Bison Futé 0 ; hauteurs basses 1 ; tunnels sans hauteur 1 ; non concernés par le profil 1\)/);
  const van = sensitiveRules(route(), { vehicle: VAN, copy });
  assert.ok(!van.items.some((i) => i.type === SENSITIVE.TYPES.BAN));
  assert.equal(sensitiveRules(route(), { vehicle: SEMI, copy: { status: 'failed' } }).lines[0].text, SENSITIVE_UNAVAILABLE_TEXT);
  assert.equal(sensitiveRules(route(), { vehicle: SEMI, copy: null }).lines.length, 0, 'sans copie demandée : rien');
  // routeRules : lignes dans la fiche, résumé, aucun compteur de ponts en plus.
  const rules = routeRules(route(), { vehicle: SEMI, sensitive: copy });
  assert.ok(rules.short.includes('3 points sensibles à vérifier'));
  assert.ok(!rules.short.some((s) => /pont/.test(s)));
  assert.equal(rules.sensitive.items.length, 3);
  assert.match(routeDiagnosticText(route(), { rules }), /Points sensibles : 3/);
});

test('copie du dépôt : aucun pont, sections citées, tailles dans les limites', () => {
  const dir = new URL('../data/points-sensibles/', import.meta.url);
  const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
  assert.equal(index.license, 'ODbL — © contributeurs OpenStreetMap');
  assert.ok(index.count > 0);
  assert.ok(index.sections.every((s) => s.lu === 'arrêté' || s.lu === 'Bison Futé'));
  let total = 0;
  for (const f of readdirSync(dir)) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    total += Buffer.byteLength(text);
    assert.ok(Buffer.byteLength(text) <= SENSITIVE.MAX_FILE_BYTES, f);
    if (f === 'index.json') continue;
    const t = parseSensitiveTile(JSON.parse(text));
    assert.ok(t.points.every((p) => [0, 1, 2, 3].includes(p.type) && p.cap >= 0 && p.cap < 180), f);
  }
  assert.ok(total <= SENSITIVE.MAX_TOTAL_BYTES);
});

test('diagnostic : route retrouvée par étape sans nom (« A 13 »), « ambigu », « inconnue »', () => {
  const DIR = new URL('./fixtures/axes-osm-joigny/', import.meta.url);
  const data = mergeAxesTiles(readdirSync(DIR).filter((f) => f !== 'index.json')
    .map((f) => parseAxesTile(JSON.parse(readFileSync(new URL(f, DIR), 'utf8')))));
  const r = parseDirections(fixture('ors-directions-joigny-gonfreville.json'));
  const geo = matchRouteAxes(r, data, { copyTolerance: 3 });
  const unnamed = r.steps.filter((s) => !s.name && s.wayPoints && s.wayPoints[1] > s.wayPoints[0]);
  const labels = unnamed.map((s) => geoStepLabel(geo, s.wayPoints[0], s.wayPoints[1]));
  assert.ok(labels.some((l) => l.includes('A 6')), labels.join(' | '));
  assert.ok(labels.some((l) => l.includes('A 12')) && labels.some((l) => l.includes('A 13')), labels.join(' | '));
  const n = geo.ref.length;
  assert.equal(geoStepLabel({ status: 'ok', ref: new Array(n).fill(null), amb: new Array(n).fill(true) }, 0, 5), 'ambigu');
  assert.equal(geoStepLabel({ status: 'ok', ref: new Array(n).fill(null), amb: new Array(n).fill(false) }, 0, 5), 'inconnue');
  assert.equal(geoStepLabel(null, 0, 5), 'non chargée');
  const axes = { status: 'ok', data, updated: '2026-11-24', meta: { tolerance: 3 } };
  const rules = routeRules(r, { vehicle: SEMI, axes });
  const diag = routeDiagnosticText(r, { rules });
  assert.match(diag, /\| \(sans nom\) \| — \| [^|]+ \| géométrie : A 6/);
  assert.match(diag, /géométrie : A 12, A 13/, 'étape de 103 km : A12 puis A13');
  assert.ok(!/A 6 \| A6 \|[^\n]*géométrie/.test(diag), 'étape nommée : pas de colonne géométrie');
});

test('Mâcon → Valence (vraie réponse ORS, 44 t) : repli A6 puis N7 ; interdictions lyon-a6 et lyon-a7, aucune en 3,5 t', () => {
  // Vraie réponse ORS driving-hgv 44 t du 24/11/2026 (départ et arrivée arrondis à 0,01°) : ORS passe par l'A6 puis
  // l'A7 dans Lyon (hgv:conditional non lu, avoid_polygons refusé au-delà de 150 km à vol d'oiseau).
  const DIR = new URL('./fixtures/axes-osm-macon-valence/', import.meta.url);
  const data = mergeAxesTiles(readdirSync(DIR).filter((f) => f !== 'index.json')
    .map((f) => parseAxesTile(JSON.parse(readFileSync(new URL(f, DIR), 'utf8')))));
  const r = parseDirections(fixture('ors-directions-macon-valence.json'));
  assert.equal(r.distance, 179631.5);
  const geo = matchRouteAxes(r, data, { copyTolerance: 3 });
  assert.equal(geo.status, 'ok');
  const unnamed = r.steps.filter((s) => !s.name && s.wayPoints && s.wayPoints[1] > s.wayPoints[0]);
  const labels = unnamed.map((s) => geoStepLabel(geo, s.wayPoints[0], s.wayPoints[1]));
  const a6 = labels.indexOf('A 6');
  const n7 = labels.indexOf('N 7');
  assert.ok(a6 >= 0 && n7 > a6, labels.join(' | '));
  assert.ok(unnamed[a6].wayPoints[1] - unnamed[a6].wayPoints[0] > 200, 'A6 : la longue étape sans nom Mâcon → Limonest');
  // Couche points sensibles : copie du dépôt (data/points-sensibles/), cases du trajet.
  const dir = new URL('../data/points-sensibles/', import.meta.url);
  const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
  const tiles = ['4_44', '4_45', '4_46'].map((k) => parseSensitiveTile(JSON.parse(readFileSync(new URL(`${k}.json`, dir), 'utf8'))));
  const copy = { status: 'ok', data: mergeSensitiveTiles(tiles), updated: index.updated, meta: { sections: parseSensitiveSections(index) } };
  const bans = (vehicle) => sensitiveRules(r, { vehicle, copy, geo }).items
    .filter((i) => i.type === SENSITIVE.TYPES.BAN || i.type === SENSITIVE.TYPES.BAN_BF)
    .map((i) => copy.meta.sections[i.section]?.id);
  assert.deepEqual(bans({ weight: 44, height: 4 }).sort(), ['lyon-a6', 'lyon-a7']);
  assert.deepEqual(bans({ weight: 3.5, height: 2.8 }), [], 'fourgon 3,5 t : pas concerné par > 7,5 t');
  const semi = sensitiveRules(r, { vehicle: { weight: 44, height: 4 }, copy, geo });
  assert.ok(semi.lines.every((l) => /La signalisation fait foi\./.test(l.text)));
});
