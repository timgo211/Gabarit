// Temps de conduite et pauses (phase 5, PR B) : règlement (CE) 561/2006, art. 6 et 7. Traces de positions une par
// seconde, vitesse fournie, comme le vrai GPS.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRIVING, emptyDriving, trackDriving, toggleStopWork, drivingView, drivingAnnouncements, drivingAt, planDriving,
  sanitizeDriving, loadDriving, saveDriving, weekStart, applyStop, breakSchedule,
} from '../src/lib/driving-time.js';
import { memoryStorage } from '../src/lib/store.js';
import { routeRules } from '../src/lib/route-rules.js';
import { windAlongRoute } from '../src/lib/wind.js';

const H = 3600;
const MIN = 60;

/** Fait passer `seconds` positions (une par seconde) à `kmh` ; renvoie le décompte et l'heure suivante. */
function run(d, t, seconds, kmh, { announce = null } = {}) {
  let s = d;
  for (let i = 0; i < seconds; i += 1) {
    s = trackDriving(s, t + i * 1000, kmh);
    if (announce) {
      const a = drivingAnnouncements(s, t + i * 1000, announce.opts);
      s = a.state;
      for (const text of a.speak) announce.out.push({ t: t + i * 1000, text });
    }
  }
  return [s, t + seconds * 1000];
}

const monday8h = new Date(2026, 10, 16, 8).getTime(); // lundi 16 novembre 2026, 8 h

test('4 h 30 de conduite puis 45 min d\'arrêt : compteur remis à zéro (art. 7, 1er alinéa)', () => {
  let [d, t] = run(emptyDriving(), monday8h, 4.5 * H + 60, 90);
  assert.ok(Math.abs(d.sinceBreak - 4.5 * H) < 100, `${d.sinceBreak}`);
  assert.equal(drivingView(d, t, 90).level, 'over');
  [d, t] = run(d, t, 45 * MIN, 0);
  assert.match(drivingView(d, t, 0).main, /^Pause 45 min faite/);
  [d, t] = run(d, t, 60, 80); // reprise confirmée après 30 s, comptée depuis son début
  assert.ok(d.sinceBreak >= 59 && d.sinceBreak <= 61, `${d.sinceBreak}`);
  assert.ok(Math.abs(d.day - (4.5 * H + 120)) < 40, `${d.day}`);
  assert.equal(d.split, false);
});

test('fractionnement : 15 min PUIS 30 min remet à zéro ; 30 min puis 15 min ne suffit pas (art. 7, 2e alinéa)', () => {
  let [d, t] = run(emptyDriving(), monday8h, 2 * H, 90);
  [d, t] = run(d, t, 15 * MIN, 0);
  [d, t] = run(d, t, H, 90);
  assert.equal(d.split, true);
  assert.match(drivingView(d, t, 90).main, /pause de 30 min conseillée dans 1 h 30/);
  [d, t] = run(d, t, 30 * MIN, 0);
  [d, t] = run(d, t, 60, 90);
  assert.ok(d.sinceBreak < 70, 'remis à zéro après 15 + 30');

  let [e, u] = run(emptyDriving(), monday8h, 2 * H, 90);
  [e, u] = run(e, u, 30 * MIN, 0); // compte comme première partie seulement
  [e, u] = run(e, u, H, 90);
  [e, u] = run(e, u, 15 * MIN, 0);
  [e, u] = run(e, u, 60, 90);
  assert.ok(e.sinceBreak > 3 * H - 60, `30 puis 15 : pas de remise à zéro (${e.sinceBreak})`);
  assert.equal(e.split, true);
  [e, u] = run(e, u, 30 * MIN, 0);
  [e, u] = run(e, u, 60, 90);
  assert.ok(e.sinceBreak < 70, 'la pause de 30 min qui suit les 15 min complète');
});

test('arrêt de moins de 15 min : ni pause ni conduite ; saut du GPS pendant une pause : pause gardée', () => {
  let [d, t] = run(emptyDriving(), monday8h, H, 90);
  [d, t] = run(d, t, 14 * MIN, 0);
  [d, t] = run(d, t, 60, 90);
  assert.ok(Math.abs(d.sinceBreak - (H + 60)) < 40, `${d.sinceBreak}`);
  assert.equal(d.split, false);
  assert.equal(d.last, null);
  // Pause de 45 min avec 10 s à 8 km/h au milieu (position qui saute) : toujours une seule pause.
  [d, t] = run(d, t, 20 * MIN, 0);
  [d, t] = run(d, t, 10, 8);
  [d, t] = run(d, t, 25 * MIN, 0);
  [d, t] = run(d, t, 60, 90);
  assert.ok(d.sinceBreak < 70, `${d.sinceBreak}`);
});

test('positions interrompues (guidage arrêté, appli fermée) : l\'intervalle est un arrêt', () => {
  let [d, t] = run(emptyDriving(), monday8h, 3 * H, 90);
  t += 50 * MIN * 1000; // plus de position pendant 50 min
  [d, t] = run(d, t, 60, 90);
  assert.ok(d.sinceBreak < 70);
  assert.ok(Math.abs(d.day - (3 * H + 60)) < 40);
  // Vu avant le départ (fiche) : l'arrêt en cours compte comme s'il finissait maintenant.
  const later = drivingAt(trackDriving(d, t, 0), t + 46 * MIN * 1000);
  assert.equal(later.sinceBreak, 0);
});

test('« Pas une pause (travail) » : arrêt en cours, puis dernier arrêt terminé, second appui = pause', () => {
  let [d, t] = run(emptyDriving(), monday8h, 3 * H, 90);
  [d, t] = run(d, t, 5 * MIN, 0);
  assert.equal(drivingView(d, t, 0).canMarkWork, true);
  assert.equal(drivingView(d, t, 0).workLabel, 'Pas une pause (travail)');
  d = toggleStopWork(d); // chargement au quai
  [d, t] = run(d, t, 50 * MIN, 0);
  assert.match(drivingView(d, t, 0).main, /compté comme travail/);
  [d, t] = run(d, t, 10 * MIN, 90);
  assert.ok(d.sinceBreak > 3 * H + 9 * MIN, `travail : pas de remise à zéro (${d.sinceBreak})`);
  assert.equal(drivingView(d, t, 90).canMarkWork, false, 'jamais en roulant');
  // Second cas : arrêt déjà terminé et compté comme pause, puis retiré du décompte au feu suivant (sous 10 km/h).
  let [e, u] = run(emptyDriving(), monday8h, 3 * H, 90);
  [e, u] = run(e, u, 45 * MIN, 0);
  [e, u] = run(e, u, 20 * MIN, 90);
  assert.ok(e.sinceBreak < 21 * MIN);
  assert.equal(drivingView(e, u, 7).canMarkWork, true);
  e = toggleStopWork(e);
  assert.ok(Math.abs(e.sinceBreak - (3 * H + 20 * MIN)) < 60, `${e.sinceBreak}`);
  assert.equal(e.last.work, true);
  assert.equal(drivingView(e, u, 7).workLabel, 'Compter comme pause');
  e = toggleStopWork(e);
  assert.ok(e.sinceBreak < 21 * MIN, 'recompté comme pause');
});

test('journée : 9 h, 10 h deux fois par semaine, repos de 9 h, nouvelle semaine le lundi (art. 4, 6, 8)', () => {
  const p = (d) => applyStop(d, 45 * MIN, 0);
  let d = emptyDriving();
  let t = monday8h;
  const day = (hours) => {
    for (let k = 0; k < Math.ceil(hours / 4); k += 1) {
      const block = Math.min(4, hours - k * 4);
      [d, t] = run(d, t, block * H, 90);
      [d, t] = run(d, t, 45 * MIN, 0);
    }
    t += 10 * H * 1000; // repos journalier (appli fermée)
    [d, t] = run(d, t, 60, 90);
  };
  assert.equal(p({ sinceBreak: 10, split: false }).sinceBreak, 0);
  const said = [];
  [d, t] = run(d, t, 4 * H, 90);
  [d, t] = run(d, t, 45 * MIN, 0);
  [d, t] = run(d, t, 4 * H, 90);
  [d, t] = run(d, t, 45 * MIN, 0);
  [d, t] = run(d, t, 1.5 * H, 90, { announce: { out: said } });
  assert.equal(d.dayExtended, true);
  assert.equal(d.week.extensions, 1);
  assert.match(drivingView(d, t, 90).detail, /^Jour 9 h 30 \/ 10 h/);
  assert.ok(said.some((x) => /^9 heures de conduite aujourd'hui\. Prolongation possible jusqu'à 10 heures, encore une autre/.test(x.text)));
  t += 10 * H * 1000;
  [d, t] = run(d, t, 60, 90);
  assert.ok(d.day < 70, 'repos journalier : nouvelle journée');
  day(9.5); // 2e prolongation
  assert.equal(d.week.extensions, 2);
  [d, t] = run(d, t, 4 * H, 90);
  [d, t] = run(d, t, 45 * MIN, 0);
  [d, t] = run(d, t, 5 * H + 5 * MIN, 90);
  const v = drivingView(d, t, 90);
  assert.equal(v.level, 'over');
  assert.match(v.detail, /maximum atteint/);
  // Semaine suivante : compteur hebdomadaire remis à zéro, la précédente gardée (90 h sur deux semaines).
  const before = d.week.driving;
  d = trackDriving(d, new Date(2026, 10, 23, 8).getTime(), 0);
  assert.equal(d.week.start, weekStart(new Date(2026, 10, 23, 12).getTime()));
  assert.equal(d.week.driving, 0);
  assert.equal(d.prevWeek, before);
});

test('annonces : 30 min avant 4 h 30 (avec la prochaine aire), à 4 h 30, à l\'arrêt 15 min puis pause faite — une fois chacune', () => {
  const said = [];
  const area = { name: 'Aire de Saint-Rambert', distance: 12400 };
  let [d, t] = run(emptyDriving(), monday8h, 4.5 * H + 2 * MIN, 90, { announce: { out: said, opts: { nextArea: area } } });
  assert.deepEqual(said.map((x) => x.text), [
    'Pause de 45 minutes conseillée dans 30 minutes. Prochaine aire : Aire de Saint-Rambert, dans 12 kilomètres.',
    '4 heures 30 de conduite : pause de 45 minutes conseillée dès que possible.',
  ]);
  assert.ok(Math.abs((said[0].t - monday8h) / 1000 - 4 * H) < 40);
  said.length = 0;
  [d, t] = run(d, t, 50 * MIN, 0, { announce: { out: said } });
  assert.deepEqual(said.map((x) => x.text), [
    '15 minutes de pause comptées. Encore 30 minutes conseillées, maintenant ou plus tard, avant 4 heures 30 de conduite.',
    'Pause de 45 minutes faite.',
  ]);
  said.length = 0;
  [d, t] = run(d, t, H, 90, { announce: { out: said } });
  assert.deepEqual(said, []);
});

test('fiche avant le départ : pause et 9 h placées sur le trajet', () => {
  let [d] = run(emptyDriving(), monday8h, 3 * H, 90);
  const n = 400;
  const coords = Array.from({ length: n + 1 }, (_, i) => [2 + (6 * i) / n, 47]);
  const route = { coordinates: coords, steps: [{ name: 'A 31', type: 11, wayPoints: [0, n], duration: 7 * H, distance: 450000 }], duration: 7 * H, distance: 450000 };
  const lines = planDriving(trackDriving(d, monday8h + 3 * H * 1000 + 1000, 90), route, monday8h + 3 * H * 1000 + 1000);
  assert.match(lines[0].text, /^Temps de conduite : 3 h 00 depuis la dernière pause, 3 h 00 aujourd'hui\. Aide seulement : le chronotachygraphe fait foi/);
  assert.match(lines[1].text, /^Pause de 45 min conseillée après 1 h 30 de route \(vers km \d+\)\.$/);
  const km = Number(lines[1].text.match(/km (\d+)/)[1]);
  assert.ok(Math.abs(km - 96) <= 3, `${km}`); // 1 h 30 sur 7 h de 456 km environ
  assert.match(lines[2].text, /^Conduite du jour : 9 h atteintes vers km \d+ \(10 h possibles 2 fois par semaine\)\.$/);
  assert.deepEqual(planDriving(emptyDriving(), { ...route, duration: 2 * H }, monday8h), []);
});

/** Trajet plein est à la latitude 47 : `km` kilomètres en `seconds` secondes. */
function eastRoute(km, seconds, lon0 = 2) {
  const n = Math.max(10, Math.round(km));
  const dLon = km / (111.32 * Math.cos((47 * Math.PI) / 180));
  const coords = Array.from({ length: n + 1 }, (_, i) => [lon0 + (dLon * i) / n, 47]);
  return {
    coordinates: coords, distance: km * 1000, duration: seconds,
    steps: [{ name: 'A 71', type: 11, wayPoints: [0, n], duration: seconds, distance: km * 1000 }],
  };
}

test('pause conseillée sur une aire du bon sens atteinte dans l\'heure avant 4 h 30 ; jamais « obligatoire »', () => {
  const route = eastRoute(560, 7 * H);
  const areas = [
    { id: 'a', name: 'Aire de Test', kind: 'rest', along: 326667, otherSide: false }, // 4 h 05 : gardée
    { id: 'b', name: 'Aire autre sens', kind: 'rest', along: 346667, otherSide: true }, // autre sens : ignorée
    { id: 'c', name: 'Aire trop loin', kind: 'rest', along: 370000, otherSide: false }, // après 4 h 30 : ignorée
    { id: 'd', name: 'Aire trop tôt', kind: 'rest', along: 200000, otherSide: false }, // 2 h 30 : trop tôt
  ];
  const plan = breakSchedule(emptyDriving(), route, monday8h, { areas });
  assert.equal(plan.breaks.length, 1);
  assert.equal(plan.breaks[0].area.id, 'a');
  assert.equal(plan.rest, null);
  const lines = planDriving(emptyDriving(), route, monday8h, { areas });
  assert.match(lines[0].text, /^Pause de 45 min conseillée après 4 h 05 de route : Aire de Test \(km 327\)\.$/);
  // Sans aire : à 4 h 30.
  const bare = breakSchedule(emptyDriving(), route, monday8h);
  assert.ok(Math.abs(bare.breaks[0].drive - DRIVING.CONTINUOUS_MAX_S) < 2);
  // Temps écoulé : pause de 45 min après, repos de 11 h au-delà de 9 h.
  assert.equal(bare.elapsed(H), H);
  assert.ok(Math.abs(bare.elapsed(5 * H) - (5 * H + 45 * MIN)) < 1);
  const long = breakSchedule(emptyDriving(), eastRoute(1000, 12 * H), monday8h);
  assert.equal(long.breaks.length, 1); // la deuxième tomberait après la limite du jour
  assert.ok(long.rest && long.rest.drive === 9 * H);
  assert.ok(Math.abs(long.elapsed(10 * H) - (10 * H + 45 * MIN + 11 * H)) < 1);
  // Aucun texte ne dit « obligatoire ».
  let [d] = run(emptyDriving(), monday8h, 4 * H + 40 * MIN, 90);
  assert.ok(!/obligatoire/i.test(drivingView(d, monday8h + (4 * H + 40 * MIN) * 1000, 90).main));
  assert.match(drivingView(d, monday8h + (4 * H + 40 * MIN) * 1000, 90).main, /^Pause de 45 min conseillée : 4 h 30 de conduite dépassées/);
});

test('heures des règles recalées avec les pauses conseillées (interdiction PL samedi 22 h, vent)', () => {
  // Nantes → Besançon (en France), départ samedi 15 h 30 : avec la pause, 22 h tombe à 5 h 45 de conduite (km 460) ;
  // sans pause, ce serait 6 h 30 (km 520).
  const route = eastRoute(560, 7 * H, -1.5);
  const dep = new Date(2026, 10, 21, 15, 30);
  const vehicle = { name: 'Semi', weight: 44, critair: '1', banStatus: 'concerned' };
  const without = routeRules(route, { vehicle, departure: dep });
  const withPauses = routeRules(route, { vehicle, departure: dep, driving: emptyDriving() });
  assert.ok(Math.abs(without.bans.conflicts[0].along - 520000) < 1500, String(without.bans.conflicts[0].along));
  assert.ok(Math.abs(withPauses.bans.conflicts[0].along - 460000) < 1500, String(withPauses.bans.conflicts[0].along));
  assert.ok(withPauses.short.includes('Pause conseillée'));
  // Vent : rafales fortes seulement de 19 h à 20 h (heure de Paris) ; point à 5 h de conduite = 20 h 30 sans pause,
  // 21 h 15 avec : hors de la fenêtre dans les deux cas ; point à 3 h 45 = 19 h 15 : dans la fenêtre.
  const t0 = Date.UTC(2026, 10, 21, 0) / 1000;
  const time = Array.from({ length: 48 }, (_, i) => (t0 + i * 3600) * 1000);
  const p = { lon: 0, lat: 47, time, gust: time.map((t) => (new Date(t).getHours() === 20 ? 100 : 30)), speed: time.map(() => null) };
  const at = (h) => eastRoute(560, 7 * H, -1.5).coordinates[Math.round((560 * h) / 7)];
  const forecast = { points: [{ ...p, lon: at(4.25)[0], lat: at(4.25)[1] }] };
  const calm = windAlongRoute(route, forecast, { departure: dep, threshold: 70 });
  const shifted = windAlongRoute(route, forecast, { departure: dep, threshold: 70, elapsed: (t) => (t > 3600 ? t + 45 * 60 : t) });
  assert.equal(calm.zones.length, 1); // 4 h 15 de conduite → 19 h 45, heure de 20 h : rafales
  assert.equal(shifted.zones.length, 0); // avec 45 min de pause → 20 h 30, heure de 21 h : calme
});

test('lecture et écriture sur l\'appareil : décompte nettoyé, illisible → vide', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadDriving(storage), emptyDriving());
  let [d] = run(emptyDriving(), monday8h, 600, 90);
  saveDriving(storage, d);
  const back = loadDriving(storage);
  assert.equal(back.sinceBreak, d.sinceBreak);
  assert.equal(back.mode, 'drive');
  storage.setItem(DRIVING.STORAGE_KEY, '{pas du json');
  assert.deepEqual(loadDriving(storage), emptyDriving());
  assert.deepEqual(sanitizeDriving({ v: 1, sinceBreak: -5, mode: 'vol', announced: { '<x>': 'oui' } }).sinceBreak, 0);
  assert.equal(sanitizeDriving({ v: 2 }).at, null);
});
