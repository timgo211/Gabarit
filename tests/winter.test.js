// Phase 5f : équipements d'hiver. Fixtures : hiver-liste-sheet.xml (lignes réelles de la liste Sécurité routière du
// 22/10/2022) et hiver-contours.geojson (contours écrits autour du tracé de ors-directions-nav.json, à 45,73° N :
// grande commune au départ, petite commune traversée sur 155 m sans aucun point du tracé dedans, commune à trou
// (anneau de 78 m sur le tracé), commune « en partie » sur la branche sud-est, commune à 500 m au nord, commune loin).
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { parseXlsxSheet } from '../src/lib/areas-official.js';
import { parseCommuneList, buildTiles, buildIndex, compactRing, expandRing, WINTER_DATA } from '../src/lib/winter-convert.js';
import {
  WINTER, parseWinterIndex, parseWinterTile, routeTiles, communesAlongRoute, winterRules, inWinterPeriod, equipmentText,
} from '../src/lib/winter.js';
import { routeRules } from '../src/lib/route-rules.js';
import { parseCountryData, countryCard, COUNTRY_RULES } from '../src/lib/country-rules.js';
import { normalizeVehicle, defaultVehicle } from '../src/lib/vehicle.js';

const sheet = readFileSync(new URL('./fixtures/hiver-liste-sheet.xml', import.meta.url), 'utf8');
const contoursJson = JSON.parse(readFileSync(new URL('./fixtures/hiver-contours.geojson', import.meta.url), 'utf8'));
const route = () => parseDirections(fixture('ors-directions-nav.json'));

/** Copie data/hiver/ construite comme par l'Action, puis relue comme par l'appli. */
function copy() {
  const list = parseCommuneList(parseXlsxSheet(sheet));
  const contours = new Map(contoursJson.features.map((f) => [f.properties.code, { name: f.properties.nom, geometry: f.geometry }]));
  const built = buildTiles(list.communes, contours);
  const index = parseWinterIndex(JSON.parse(JSON.stringify(buildIndex({ updated: '2026-10-15', communes: list.communes, ...built }))));
  const communes = Object.values(built.tiles).flatMap((t) => parseWinterTile(JSON.parse(JSON.stringify({ communes: t }))));
  return { list, built, index, communes, state: { status: 'ok', index, communes } };
}

const semi = (patch = {}) => ({ name: 'Semi', weight: 44, trailer: '', ...patch });

test('liste Sécurité routière : titres, codes INSEE, communes en partie, ligne illisible écartée', () => {
  const l = parseCommuneList(parseXlsxSheet(sheet));
  assert.equal(l.communes.length, 6);
  assert.deepEqual(l.communes[0], { code: '01002', name: 'L’ABERGEMENT-DE-VAREY', dept: 'Ain', massif: 'Jura', partial: false });
  assert.equal(l.communes.find((c) => c.code === '09004').partial, true);
  assert.deepEqual(l.skipped, ['x12 Ligne illisible']);
  assert.equal(parseCommuneList([['a', 'b']]).communes.length, 0);
  // Code à 4 chiffres (zéro perdu par le tableur) : complété.
  assert.equal(parseCommuneList([['Nom Commune', 'Code INSEE Commune'], ['X', '1002']]).communes[0].code, '01002');
});

test('copie : contours compactés au mètre, cases de 1°, index avec la date de la liste', () => {
  const ring = [[4.950001, 45.730004], [4.96, 45.73], [4.96, 45.74], [4.950001, 45.730004]];
  assert.deepEqual(expandRing(compactRing(ring)), [[4.95, 45.73], [4.96, 45.73], [4.96, 45.74], [4.95, 45.73]]);
  const { built, index } = copy();
  assert.equal(built.placed, 6);
  assert.deepEqual(built.missing, []);
  assert.deepEqual(Object.keys(index.tiles), ['4_45', '6_45']);
  assert.equal(index.listDate, WINTER_DATA.LIST_DATE);
  assert.equal(index.listDate, '2022-10-22');
  assert.equal(index.count, 6);
  assert.equal(parseWinterIndex({ tiles: {}, count: 0 }), null);
  assert.equal(parseWinterTile({}), null);
});

test('Action : plus de 2 % de codes sans contour = échec (seuil), journal des codes', () => {
  const { list } = copy();
  const one = new Map([['01002', { name: 'x', geometry: contoursJson.features[0].geometry }]]);
  const r = buildTiles(list.communes, one);
  assert.equal(r.missing.length, 5);
  assert.ok(r.missing.length / list.communes.length > WINTER_DATA.MAX_MISSING);
  assert.equal(WINTER_DATA.MAX_MISSING, 0.02);
});

test('cases traversées : parcours exact de la grille', () => {
  const index = { tiles: { '4_45': 1, '5_45': 1, '5_46': 1 } };
  assert.deepEqual(routeTiles([[4.9, 45.5], [5.1, 45.5]], index), ['4_45', '5_45']);
  // Coin de case coupé sur quelques mètres : case retenue.
  assert.deepEqual(routeTiles([[4.99, 45.9999], [5.0001, 46.01]], { tiles: { '4_45': 1, '5_46': 1, '4_46': 1, '5_45': 1 } }).sort(), ['4_45', '4_46', '5_46'].sort());
});

test('communes traversées : intersection exacte, petite commune sur moins de 300 m, trou, commune voisine absente', () => {
  const { communes } = copy();
  const passes = communesAlongRoute(route(), communes);
  const byCode = Object.fromEntries(passes.map((p) => [p.code, p]));
  assert.ok(byCode['01002'], 'grande commune du départ');
  assert.ok(byCode['01002'].length > 1000);
  // Ambléon : 0,002° de large (≈ 155 m), aucun point du tracé dedans.
  const small = byCode['01006'];
  assert.ok(small, 'petite commune traversée sur moins de 300 m retenue');
  assert.ok(small.length > 100 && small.length < 300, `${small.length}`);
  // Anglefort : départ dans le trou, seul l'anneau (≈ 78 m) compte.
  assert.ok(byCode['01010'].length > 60 && byCode['01010'].length < 100, `${byCode['01010'].length}`);
  assert.equal(byCode['09004'].partial, true);
  assert.equal(byCode['01009'], undefined, 'commune à 500 m du tracé');
  assert.equal(byCode['11017'], undefined);
  // Ordre du tracé.
  assert.deepEqual(passes.map((p) => p.code), ['01002', '01010', '01006', '09004']);
});

test('novembre : alerte avant le départ, date de la liste, consigne selon la remorque, signalisation, sans voix', () => {
  const { state } = copy();
  const dep = new Date(2026, 10, 18, 8, 0);
  const r = winterRules(route(), { vehicle: semi(), winter: state, departure: dep });
  const warns = r.lines.filter((l) => l.level === 'warn');
  assert.equal(warns.length, 2); // zone du départ, puis commune en partie au sud (à plus de 2 km)
  assert.match(warns[0].text, /^Équipements d'hiver exigés du 1er novembre au 31 mars de km 0 à km 2 \(L'Abergement-de-Varey, Anglefort, Ambléon — Ain\), vers mercredi 8 h( \d\d)? : /);
  assert.match(warns[0].text, /Avec remorque ou semi-remorque : chaînes à neige pour au moins deux roues motrices à bord, même avec des pneus hiver ; sans remorque : chaînes à bord ou pneus hiver \(3PMSF\)\./);
  assert.match(warns[0].text, /Liste nationale du 22\/10\/2022 : arrêtés préfectoraux plus récents et routes exclues à vérifier\. La signalisation fait foi\.$/);
  assert.match(warns[1].text, /Albiès \(en partie, à vérifier\) — Ariège/);
  assert.ok(r.lines.every((l) => /La signalisation fait foi\.$|à vérifier\.$/.test(l.text)));
  assert.ok(r.lines.some((l) => l.text === WINTER.B26_TEXT));
  assert.ok(r.lines.some((l) => l.text === WINTER.SANCTION_TEXT));
  assert.deepEqual(r.short, ["Équipements d'hiver"]);
  assert.ok(r.lines.every((l) => l.voice === undefined));
  // Remorque précisée : une seule consigne.
  const w = winterRules(route(), { vehicle: semi({ trailer: 'with' }), winter: state, departure: dep }).lines[0].text;
  assert.match(w, /PL avec remorque ou semi-remorque : chaînes à neige pour au moins deux roues motrices à bord, même avec des pneus hiver\./);
  assert.doesNotMatch(w, /sans remorque/);
  assert.match(equipmentText('none'), /^PL sans remorque : chaînes à neige \(au moins deux roues motrices\) à bord, ou pneus hiver \(3PMSF\)\.$/);
  // Dans les règles du trajet.
  const all = routeRules(route(), { vehicle: semi(), departure: dep, winter: state });
  assert.ok(all.short.includes("Équipements d'hiver"));
  assert.ok(all.lines.some((l) => l.level === 'warn' && /^Équipements d'hiver exigés/.test(l.text)));
});

test('hors période (juillet) : rien ; copie absente : message en période seulement ; hors de France : rien', () => {
  const { state } = copy();
  assert.deepEqual(winterRules(route(), { vehicle: semi(), winter: state, departure: new Date(2026, 6, 10, 8) }).lines, []);
  const failed = winterRules(route(), { vehicle: semi(), winter: { status: 'failed', communes: [], index: null }, departure: new Date(2026, 11, 2, 8) });
  assert.deepEqual(failed.lines.map((l) => l.text), [WINTER.UNAVAILABLE_TEXT]);
  assert.deepEqual(winterRules(route(), { winter: { status: 'failed' }, departure: new Date(2026, 6, 2, 8) }).lines, []);
  assert.deepEqual(winterRules(route(), { winter: { status: 'loading' }, departure: new Date(2026, 11, 2, 8) }).lines, []);
  const ch = { ...route(), countries: [{ from: 0, to: 33, code: 'CH' }] };
  assert.deepEqual(winterRules(ch, { winter: state, departure: new Date(2026, 11, 2, 8) }).lines, []);
  // Période : commune absente du tracé → « aucune commune signalée », jamais « pas d'obligation ».
  const far = { ...state, communes: state.communes.filter((c) => c.code === '11017') };
  const none = winterRules(route(), { winter: far, departure: new Date(2026, 11, 2, 8) });
  assert.match(none.lines[0].text, /^Aucune commune soumise aux équipements d'hiver signalée sur ce trajet \(liste nationale du 22\/10\/2022\), la signalisation fait foi\.$/);
});

test('limites de la période (Europe/Paris) : départ 31/10 23 h → passage 1/11 1 h, départ 31/03 23 h → 1/04 1 h', () => {
  const { state } = copy();
  const twoHours = () => 7200; // heure de passage = départ + 2 h (pauses comprises)
  assert.equal(inWinterPeriod(new Date(2026, 9, 31, 23, 59)), false);
  assert.equal(inWinterPeriod(new Date(2026, 10, 1, 0, 0)), true);
  assert.equal(inWinterPeriod(new Date(2027, 2, 31, 23, 59)), true);
  assert.equal(inWinterPeriod(new Date(2027, 3, 1, 0, 0)), false);
  const nov = winterRules(route(), { vehicle: semi(), winter: state, departure: new Date(2026, 9, 31, 23, 0), elapsed: twoHours });
  assert.ok(nov.lines.some((l) => l.level === 'warn' && /vers dimanche 1 h :/.test(l.text)), nov.lines.map((l) => l.text).join(' | '));
  const apr = winterRules(route(), { vehicle: semi(), winter: state, departure: new Date(2027, 2, 31, 23, 0), elapsed: twoHours });
  assert.ok(!apr.lines.some((l) => l.level === 'warn'), apr.lines.map((l) => l.text).join(' | '));
  assert.ok(!apr.lines.some((l) => /Aucune commune/.test(l.text)), 'communes sur le tracé, hors période : pas « aucune commune »');
  // Départ le 31/03 à 22 h 30 : passage à 0 h 30 le 1/04 → rien ; sans pause (passage à 22 h 3x) → alerte.
  const late = winterRules(route(), { vehicle: semi(), winter: state, departure: new Date(2027, 2, 31, 22, 30) });
  assert.ok(late.lines.some((l) => l.level === 'warn'));
});

test('profil : remorque à 3 états (non précisé par défaut), sauvegardée', () => {
  assert.equal(defaultVehicle().trailer, '');
  assert.equal(normalizeVehicle({ name: 'a' }).trailer, '');
  assert.equal(normalizeVehicle({ name: 'a', trailer: 'with' }).trailer, 'with');
  assert.equal(normalizeVehicle({ name: 'a', trailer: 'none' }).trailer, 'none');
  assert.equal(normalizeVehicle({ name: 'a', trailer: 'oui' }).trailer, '');
  assert.equal(normalizeVehicle(JSON.parse(JSON.stringify(normalizeVehicle({ name: 'a', trailer: 'with' })))).trailer, 'with');
});

const raw = (code) => JSON.parse(readFileSync(new URL(`../data/pays/${code}.json`, import.meta.url), 'utf8'));
const seg = (code) => ({ code, name: code, enter: 0, exit: 1000, enterTime: new Date(2026, 6, 1, 8), exitTime: new Date(2026, 6, 1, 9) });

test('fiches pays : « Équipements d\'hiver » toute l\'année, sources, IT période à vérifier, AT à vérifier, jamais dit', () => {
  for (const code of ['DE', 'LU', 'CH', 'ES', 'BE', 'IT']) {
    const card = countryCard(parseCountryData(raw(code)), seg(code), { vehicle: semi() }); // juillet : affiché quand même
    const items = card.items.filter((i) => i.section === "Équipements d'hiver");
    assert.ok(items.length >= 1, code);
    assert.ok(items.some((i) => i.confirmed && i.source?.kind === 'national'), `${code} : une règle sourcée`);
    if (code !== 'IT') assert.ok(items.some((i) => /Selon la météo \/ les panneaux, pas de période légale\.|en cas de neige ou de verglas/.test(i.text)), code);
    assert.ok(!card.voice.some((v) => /chaîne|pneu|hiver/i.test(v)), `${code} : rien de dit`);
    assert.ok(!card.warnings.some((w) => /hiver/i.test(w)), `${code} : pas d'alerte`);
  }
  const it = countryCard(parseCountryData(raw('IT')), seg('IT'), { vehicle: semi() }).items.filter((i) => i.section === "Équipements d'hiver");
  const period = it.find((i) => /15 novembre au 15 avril/.test(i.text));
  assert.equal(period.confirmed, false);
  assert.match(period.text, /à vérifier/);
  assert.equal(period.level, 'info');
  assert.ok(COUNTRY_RULES.FILES.includes('AT'));
  const at = countryCard(parseCountryData(raw('AT')), seg('AT'), { vehicle: semi() });
  assert.ok(at.items.filter((i) => i.section === "Équipements d'hiver").every((i) => !i.confirmed && /à vérifier/.test(i.text)));
  assert.equal(at.footer, 'La signalisation fait foi.');
});
