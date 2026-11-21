// Phase 5c : pays traversés (extra « countryinfo » d'ORS) et règles PL des pays voisins (data/pays). Fixture
// ors-directions-fr-ch-it.json : Saint-Julien (France) → Genève → Martigny → tunnel du Grand-Saint-Bernard → Aoste
// (Italie), écrite d'après le format de la doc ORS. Positions envoyées comme le vrai GPS (une par seconde, vitesse
// fournie) pour l'annonce à la frontière.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, runFixes } from './helpers.js';
import { parseDirections, parseAllDirections } from '../src/lib/ors-response.js';
import { buildDirectionsRequest } from '../src/lib/ors-request.js';
import { parseCountryInfo, countriesAlongRoute, COUNTRIES } from '../src/lib/countries.js';
import {
  parseCountryData, countryRules, countryCard, banWindowsBetween, speedBand, isConfirmed, COUNTRY_RULES,
  guidanceBorder, prepareGuidanceBorders,
} from '../src/lib/country-rules.js';
import { countryHolidays } from '../src/lib/holidays.js';
import { routeRules } from '../src/lib/route-rules.js';
import { startNavigation, updateNavigation } from '../src/lib/navigation.js';
import { createSimulator } from '../src/lib/nav-sim.js';

const FILES = COUNTRY_RULES.FILES;
const raw = (code) => JSON.parse(readFileSync(new URL(`../data/pays/${code}.json`, import.meta.url), 'utf8'));
const loaded = (codes = FILES, patch = {}) => new Map(codes.map((c) => [c, { status: 'ok', data: parseCountryData(patch[c] ?? raw(c)) }]));
const semi = { name: 'Semi', weight: 40, critair: '4', banStatus: 'concerned', hazmat: false };
const route = () => parseDirections(fixture('ors-directions-fr-ch-it.json'));

test('ORS : countryinfo demandé dans la même requête (variantes et recalcul compris)', () => {
  const req = buildDirectionsRequest({ start: [6.08, 46.14], end: [7.32, 45.74], vehicle: semi, apiKey: 'x', alternatives: 3 });
  assert.deepEqual(req.body.extra_info, ['tollways', 'countryinfo', 'roadaccessrestrictions']);
  assert.equal(buildDirectionsRequest({ start: [6.08, 46.14], end: [7.32, 45.74], vehicle: semi, preference: 'shortest' }).body.extra_info.length, 3);
});

test('countryinfo lu : France → Suisse → Italie, km et heure de chaque frontière', () => {
  const r = route();
  assert.deepEqual(r.countries.map((c) => c.code), ['FR', 'CH', 'IT']);
  const dep = new Date(2026, 10, 18, 8, 0); // mercredi 8 h
  const a = countriesAlongRoute(r, { departure: dep });
  assert.equal(a.ok, true);
  assert.deepEqual(a.crossings.map((c) => `${c.from}>${c.to}`), ['FR>CH', 'CH>IT']);
  assert.ok(Math.abs(a.crossings[0].along - 3803) < 1, `${a.crossings[0].along}`);
  assert.ok(Math.abs(a.crossings[1].along - 152200) < 1);
  assert.ok(a.crossings[1].time > a.crossings[0].time);
  // Pauses conseillées : les heures sont recalées (elapsed de breakSchedule).
  const late = countriesAlongRoute(r, { departure: dep, elapsed: (t) => t + 2700 });
  assert.equal(late.crossings[1].time - a.crossings[1].time, 2700 * 1000);
});

test('zones partagées (75, 141) rattachées au voisin, ids inconnus gardés, morceaux voisins réunis', () => {
  assert.deepEqual(parseCountryInfo({ countryinfo: { values: [[0, 5, 17], [5, 7, 75], [7, 20, 74], [20, 22, 74]] } }),
    [{ from: 0, to: 7, code: 'BE' }, { from: 7, to: 22, code: 'DE' }]);
  assert.equal(parseCountryInfo({ countryinfo: { values: [[0, 3, 999]] } })[0].code, '#999');
  assert.equal(parseCountryInfo({ tollways: { values: [[0, 3, 0]] } }), null);
  assert.equal(parseCountryInfo(null), null);
});

test('countryinfo absent : « Pays traversés indisponibles », jamais un silence', () => {
  const r = parseDirections(fixture('ors-directions-nav.json'));
  assert.equal(r.countries, null);
  const rules = routeRules(r, { vehicle: semi, departure: new Date(2026, 10, 18, 8), countries: loaded() });
  assert.ok(rules.lines.some((l) => l.text === COUNTRIES.UNAVAILABLE_TEXT));
  assert.equal(rules.countries.ok, false);
});

test('alternative_routes : chaque itinéraire garde ses propres pays', () => {
  const j = fixture('ors-directions-fr-ch-it.json');
  const second = structuredClone(j.features[0]);
  second.properties.extras.countryinfo.values = [[0, 79, 70]];
  const routes = parseAllDirections({ ...j, features: [j.features[0], second] });
  assert.deepEqual(routes.map((r) => r.countries.map((c) => c.code).join('>')), ['FR>CH>IT', 'FR']);
});

test('fichiers data/pays : lisibles, chaque règle a sa source connue et sa date, vitesses de source nationale', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const code of FILES) {
    const j = raw(code);
    const d = parseCountryData(j);
    assert.ok(d, code);
    assert.equal(d.code, code);
    assert.ok(sw.includes(`'./data/pays/${code}.json'`), `${code} absent d'APP_FILES`);
    const rules = [...(d.speeds ? [d.speeds] : []), ...(d.speeds?.notes ?? []), ...(d.speeds?.adr ?? []), ...d.bans, ...d.toll, ...d.lez, ...d.adr, ...(d.holidays ? [d.holidays] : [])];
    for (const r of rules) {
      if (r.source === null) { assert.equal(r.verified, null, `${code} : règle sans source mais datée`); continue; }
      assert.ok(d.sources[r.source]?.url?.startsWith('https://'), `${code} : source ${r.source} inconnue`);
      assert.match(r.verified, /^\d{4}-\d{2}-\d{2}$/);
    }
    // Autriche (phase 5f) : fiche minimale, tout « à vérifier » (RIS non lu) ; les autres pays ont leurs vitesses.
    if (code === 'AT') assert.equal(d.speeds, null);
    else assert.ok(isConfirmed(d.speeds, d, { national: true }), `${code} : vitesses sans source nationale`);
    for (const w of d.winter) {
      if (w.source === null) { assert.equal(w.verified, null); assert.match(w.text, /à vérifier/); continue; }
      assert.ok(d.sources[w.source]?.url?.startsWith('https://'), `${code} : source hiver ${w.source} inconnue`);
    }
    for (const b of d.bans) if (b.voice) assert.ok(isConfirmed(b, d), `${code} : ${b.id} dit à voix haute sans source`);
  }
});

test('passage un dimanche : interdictions suisse (dimanche) et italienne (calendrier 2026) en vigueur', () => {
  const dep = new Date(2026, 10, 22, 7, 0); // dimanche 22 novembre 2026, 7 h
  const res = countryRules(route(), { vehicle: semi, departure: dep, countries: loaded() });
  const [ch, it] = res.cards;
  assert.equal(ch.code, 'CH');
  assert.equal(ch.items.find((i) => /dimanche et les jours fériés/.test(i.text)).inForce, 'yes');
  assert.equal(ch.items.find((i) => /la nuit, de 22 h à 5 h/.test(i.text)).inForce, 'no');
  assert.equal(it.items.find((i) => /calendrier annuel/.test(i.text)).inForce, 'yes');
  assert.ok(res.lines.some((l) => l.level === 'warn' && /^Suisse, interdiction PL \(Dimanche et jours fériés\) dimanche 0 h → dimanche 24 h/.test(l.text)));
  assert.ok(res.lines.every((l) => l.level !== 'warn' || /La signalisation fait foi\.$/.test(l.text)));
  assert.ok(res.short.includes('Interdiction PL Suisse'));
  for (const c of res.cards) assert.equal(c.footer, 'La signalisation fait foi.');
  // Vitesses selon le PTAC, source nommée.
  assert.equal(ch.items[0].text, 'PL de 40 t : autoroute 80 km/h, hors agglomération 80 km/h, agglomération 50 km/h.');
  assert.equal(ch.items[0].source.kind, 'national');
  assert.equal(it.items[0].text, 'PL de 40 t : autoroute 80 km/h, hors agglomération 70 km/h, agglomération 50 km/h.');
});

test('passage de nuit en semaine : interdiction de nuit suisse en vigueur, Italie non', () => {
  const dep = new Date(2026, 10, 18, 21, 30); // mercredi 21 h 30 : Suisse vers 21 h 32 → 23 h 30
  const res = countryRules(route(), { vehicle: semi, departure: dep, countries: loaded() });
  const [ch, it] = res.cards;
  assert.equal(ch.items.find((i) => /la nuit/.test(i.text)).inForce, 'yes');
  assert.equal(ch.items.find((i) => /dimanche et les jours fériés/.test(i.text)).inForce, 'no');
  assert.equal(it.items.find((i) => /calendrier annuel/.test(i.text)).inForce, 'no');
  assert.ok(ch.labels.includes('Nuit (en vigueur)'));
});

test('véhicule de 3,5 t ou moins non concerné ; PTAC italien : 10 t → 100 / 80', () => {
  const dep = new Date(2026, 10, 22, 7, 0);
  const small = countryRules(route(), { vehicle: { ...semi, weight: 3.5 }, departure: dep, countries: loaded() });
  assert.ok(!small.lines.some((l) => l.level === 'warn'));
  const it = parseCountryData(raw('IT'));
  assert.equal(speedBand(it, { weight: 10 }).motorway, 100);
  assert.equal(speedBand(it, { weight: 10 }).road, 80);
  assert.equal(speedBand(it, { weight: 12 }).motorway, 100);
  assert.equal(speedBand(it, { weight: 12.1 }).motorway, 80);
  assert.equal(speedBand(parseCountryData(raw('LU')), { weight: 7 }).motorway, 130);
});

test('règle « à vérifier » : marquée sur la fiche, jamais dite ; source nommée (nationale ou Bison Futé)', () => {
  const ch = raw('CH');
  const night = ch.bans.find((b) => b.id === 'night');
  night.source = null;
  night.verified = null;
  const res = countryRules(route(), { vehicle: semi, departure: new Date(2026, 10, 18, 21, 30), countries: loaded(FILES, { CH: ch }) });
  const card = res.cards[0];
  const item = card.items.find((i) => /la nuit/.test(i.text));
  assert.equal(item.confirmed, false);
  assert.match(item.text, /\(à vérifier\)$/);
  assert.equal(item.inForce, null);
  assert.ok(!card.voice.some((v) => /nuit/.test(v)));
  assert.ok(!res.lines.some((l) => /nuit/i.test(l.text)));
  // Bison Futé suffit pour « pas d'interdiction » en Belgique ; jamais dit à voix haute.
  const be = parseCountryData(raw('BE'));
  const seg = { code: 'BE', name: 'Belgique', enter: 0, exit: 50000, enterTime: new Date(2026, 10, 22, 10), exitTime: new Date(2026, 10, 22, 11), prev: 'FR', next: 'NL' };
  const bc = countryCard(be, seg, { vehicle: semi });
  const none = bc.items.find((i) => /Pas d'interdiction/.test(i.text));
  assert.equal(none.confirmed, true);
  assert.equal(none.source.kind, 'bisonfute');
  assert.ok(!bc.voice.some((v) => /interdi/.test(v)));
  assert.deepEqual(bc.voice, ['poids lourds : 90 kilomètres heure sur autoroute, 60 sur route']);
  // Speeds BE : source nationale (code de la route).
  assert.equal(bc.items[0].source.kind, 'national');
});

test('annonce vocale vers 3 km de la frontière, règles confirmées seulement, bandeau ; voix coupée : rien', () => {
  const r = route();
  const t0 = new Date(2026, 10, 18, 21, 50).getTime(); // mercredi 21 h 50 : entrée en Suisse pendant la nuit
  const sim = createSimulator(r.coordinates, { speedKmh: 90 });
  const fixes = Array.from({ length: 260 }, (_, i) => sim.next(t0 + i * 1000));
  const s0 = startNavigation(r, { now: t0, rules: { vehicle: semi, zfe: null, voice: true, countries: loaded() } });
  assert.equal(s0.borders.length, 2);
  const { events, views } = runFixes(updateNavigation, s0, fixes);
  const said = events.filter((e) => e.type === 'speak' && /entrée en Suisse/.test(e.text));
  assert.equal(said.length, 1);
  assert.equal(said[0].text, 'Dans 3 kilomètres, entrée en Suisse. Poids lourds : 80 kilomètres heure. Interdiction le dimanche et les jours fériés. Interdiction de nuit de 22 heures à 5 heures, en vigueur à votre passage. La signalisation fait foi.');
  const dist = said[0].view.rules.border.distance;
  assert.ok(dist <= 3000 && dist >= 2900, `annonce à ${dist} m`);
  assert.match(views[0].rules.border.text, /^Suisse dans 4 km · PL 80 km\/h · Dimanche et jours fériés · Nuit \(en vigueur\)$/);
  assert.ok(views.some((v) => /^Entrée en Suisse/.test(v.rules.border?.text ?? '')));
  const muted = runFixes(updateNavigation, startNavigation(r, { now: t0, rules: { vehicle: semi, voice: false, countries: loaded() } }), fixes);
  assert.ok(!muted.events.some((e) => /entrée en/.test(e.text ?? '')));
  assert.ok(muted.views.some((v) => v.rules.border));
});

test('pays sans fichier chargé : bandeau « règles à vérifier », annonce sans aucune règle', () => {
  const r = route();
  const borders = prepareGuidanceBorders(r, { countries: new Map() });
  const g = guidanceBorder(borders, {}, { along: 1000, now: new Date(2026, 10, 18, 10).getTime(), timeTo: () => 100, vehicle: semi });
  assert.equal(g.view.text, 'Suisse dans 3 km · règles à vérifier');
  assert.equal(g.speak, 'Dans 3 kilomètres, entrée en Suisse. La signalisation fait foi.');
  const card = countryCard(null, { code: 'AT', name: 'Autriche', enter: 0, exit: 1, enterTime: new Date(), exitTime: new Date() }, { vehicle: semi });
  assert.equal(card.items[0].text, 'Règles PL en Autriche non chargées : à vérifier.');
});

test('calendrier italien de l\'année absent : rappel dès le 1er janvier, avec le lien, rien de calculé', () => {
  const dep = new Date(2027, 0, 1, 0, 5); // 1er janvier 2027
  const res = countryRules(route(), { vehicle: semi, departure: dep, countries: loaded() });
  const it = res.cards.find((c) => c.code === 'IT');
  const reminder = it.items.find((i) => /Calendrier italien des interdictions PL 2027 absent/.test(i.text));
  assert.ok(reminder);
  assert.equal(reminder.url, 'https://www.gazzettaufficiale.it/');
  assert.equal(it.items.find((i) => /calendrier annuel/.test(i.text)).inForce, null);
  // Espagne : même rappel pour la résolution annuelle.
  const es = parseCountryData(raw('ES'));
  const seg = { code: 'ES', name: 'Espagne', enter: 0, exit: 1000, enterTime: dep, exitTime: dep, prev: 'FR', next: null };
  const card = countryCard(es, seg, { vehicle: semi, now: dep });
  assert.ok(card.items.some((i) => /Résolution espagnole 2027 des restrictions PL absente/.test(i.text) && i.url === 'https://www.boe.es/'));
});

test('Allemagne : samedis d\'été jamais calculés ni dits ; dimanche et fériés 0 h → 22 h au-delà de 7,5 t', () => {
  const de = parseCountryData(raw('DE'));
  const sat = new Date(2026, 6, 4, 10); // samedi 4 juillet 2026
  const seg = { code: 'DE', name: 'Allemagne', enter: 0, exit: 50000, enterTime: sat, exitTime: new Date(sat.getTime() + 3600e3), prev: 'FR', next: 'AT' };
  const card = countryCard(de, seg, { vehicle: semi });
  const summer = card.items.find((i) => /possible sur certaines autoroutes \(FerReiseV\)/.test(i.text));
  assert.equal(summer.inForce, null);
  assert.equal(summer.url, 'https://www.gesetze-im-internet.de/ferreisev_1985/__1.html');
  assert.ok(!card.voice.some((v) => /samedi/.test(v)));
  assert.equal(card.items.find((i) => /0 h à 22 h/.test(i.text)).inForce, 'no');
  const sun = { ...seg, enterTime: new Date(2026, 6, 5, 21), exitTime: new Date(2026, 6, 5, 21, 30) };
  assert.equal(countryCard(de, sun, { vehicle: semi }).items.find((i) => /0 h à 22 h/.test(i.text)).inForce, 'yes');
  const late = { ...seg, enterTime: new Date(2026, 6, 5, 22, 10), exitTime: new Date(2026, 6, 5, 23) };
  assert.equal(countryCard(de, late, { vehicle: semi }).items.find((i) => /0 h à 22 h/.test(i.text)).inForce, 'no');
  assert.equal(countryCard(de, sun, { vehicle: { ...semi, weight: 7.5 } }).items.find((i) => /0 h à 22 h/.test(i.text)).inForce, null);
});

test('Luxembourg : interdiction de transit selon le pays de sortie (veille 21 h 30 vers la France)', () => {
  const lu = parseCountryData(raw('LU'));
  const sat = (h, m = 0) => new Date(2026, 10, 21, h, m); // samedi 21 novembre 2026
  const seg = (prev, next, t) => ({ code: 'LU', name: 'Luxembourg', enter: 0, exit: 30000, enterTime: t, exitTime: new Date(t.getTime() + 1800e3), prev, next });
  const toFr = countryCard(lu, seg('DE', 'FR', sat(21, 40)), { vehicle: semi });
  assert.equal(toFr.items.find((i) => /vers la France interdit/.test(i.text)).inForce, 'yes');
  assert.match(toFr.items.find((i) => /vers l'Allemagne interdit/.test(i.text)).text, /Non concerné : pas en transit vers Allemagne\./);
  const toDe = countryCard(lu, seg('FR', 'DE', sat(21, 40)), { vehicle: semi });
  assert.equal(toDe.items.find((i) => /vers l'Allemagne interdit/.test(i.text)).inForce, 'no');
  const start = countryCard(lu, seg(null, 'FR', sat(22)), { vehicle: semi });
  assert.equal(start.items.find((i) => /vers la France interdit/.test(i.text)).inForce, null);
  // Vers l'Allemagne : Fête-Dieu comptée (liste de la police grand-ducale).
  const corpus = new Date(2026, 5, 4, 10);
  assert.equal(countryCard(lu, seg('FR', 'DE', corpus), { vehicle: semi }).items.find((i) => /vers l'Allemagne interdit/.test(i.text)).inForce, 'yes');
});

test('Espagne ADR : dimanche et fériés nationaux 8 h → 24 h, veille mercredi ou jeudi 16 h ; vitesse −10 dite', () => {
  const es = parseCountryData(raw('ES'));
  const adr = { ...semi, hazmat: true, adrClass: '3', tunnelCode: 'D' };
  const ban = es.bans.find((b) => b.id === 'adr-sunday');
  // Mardi 8 décembre 2026 (Immaculée Conception) : veille lundi 7 → pas de fenêtre la veille ; 6 décembre dimanche.
  const w = banWindowsBetween(ban, es, new Date(2026, 11, 5), new Date(2026, 11, 9));
  assert.ok(w.some((x) => x.start.getTime() === new Date(2026, 11, 6, 8).getTime()));
  assert.ok(w.some((x) => x.start.getTime() === new Date(2026, 11, 8, 8).getTime()));
  assert.ok(!w.some((x) => x.start.getTime() === new Date(2026, 11, 7, 16).getTime()));
  // Jeudi 31 décembre → vendredi 1er janvier 2027 férié : veille jeudi 16 h.
  const ny = banWindowsBetween(ban, es, new Date(2026, 11, 30), new Date(2027, 0, 2));
  assert.ok(ny.some((x) => x.start.getTime() === new Date(2026, 11, 31, 16).getTime()));
  const seg = { code: 'ES', name: 'Espagne', enter: 0, exit: 1000, enterTime: new Date(2026, 11, 6, 9), exitTime: new Date(2026, 11, 6, 10), prev: 'FR', next: null };
  const card = countryCard(es, seg, { vehicle: adr, now: new Date(2026, 11, 6) });
  assert.equal(card.items.find((i) => /Véhicules ADR/.test(i.text)).inForce, 'yes');
  assert.ok(card.voice.includes('matières dangereuses : 10 kilomètres heure de moins'));
  assert.ok(!countryCard(es, seg, { vehicle: semi }).items.some((i) => /Véhicules ADR/.test(i.text)));
});

test('jours fériés nationaux : Suisse (26 décembre selon le jour de Noël), Luxembourg vers l\'Allemagne', () => {
  assert.ok(!countryHolidays('CH', 2026).has('2026-12-26')); // Noël un vendredi
  assert.ok(countryHolidays('CH', 2027).has('2027-12-26')); // Noël un samedi
  assert.ok(countryHolidays('DE', 2026).has('2026-04-03'));
  assert.ok(!countryHolidays('DE', 2026).has('2026-06-04')); // Fête-Dieu : régionale en Allemagne
  assert.ok(countryHolidays('LU_DE', 2026).has('2026-06-04'));
  assert.equal(countryHolidays('XX', 2026).size, 0);
  assert.equal(countryHolidays('IT', 2026).size, 11);
  assert.equal(countryHolidays('ES', 2026).size, 10);
});

test('ADR : tunnels du pays repris de la copie (phase 5b), sans recopier les catégories', () => {
  const ch = parseCountryData(raw('CH'));
  const seg = { code: 'CH', name: 'Suisse', enter: 4000, exit: 152000, enterTime: new Date(2026, 10, 18, 10), exitTime: new Date(2026, 10, 18, 12), prev: 'FR', next: 'IT' };
  const adr = { ...semi, hazmat: true, adrClass: '3', tunnelCode: 'D' };
  const card = countryCard(ch, seg, { vehicle: adr, tunnels: [{ id: 't1', name: 'Tunnel du Grand-Saint-Bernard', enter: 150000, exit: 151000, forbidden: true }] });
  assert.ok(card.items.some((i) => /Tunnels signalés sur ce trajet : Tunnel du Grand-Saint-Bernard \(interdit à votre code\)/.test(i.text)));
  assert.ok(!JSON.stringify(raw('CH')).includes('"category"'));
});

test('München → Innsbruck (phase 5h) : Allemagne puis Autriche, fiche Autriche « à vérifier »', () => {
  const r = parseDirections(fixture('ors-directions-muenchen-innsbruck.json'));
  assert.deepEqual(r.countries.map((c) => c.code), ['DE', 'AT']);
  const rules = routeRules(r, { vehicle: semi, departure: new Date(2026, 10, 25, 9, 0), countries: loaded() });
  const at = rules.countries.cards.find((c) => c.code === 'AT');
  assert.ok(at, 'fiche Autriche absente');
  assert.ok(at.items.length > 0);
  assert.ok(at.items.every((i) => !i.confirmed), 'règle autrichienne confirmée sans source lue');
  assert.ok(at.items.some((i) => /à vérifier/.test(i.text)));
});
