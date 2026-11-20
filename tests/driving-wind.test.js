// Phase 5 (PR B) : temps de conduite et pauses conseillées (CE 561/2006, aide seulement), vent fort (Open-Meteo).
// Le guidage est vérifié avec des positions envoyées comme le vrai GPS (une par seconde, vitesse fournie).
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, runFixes } from './helpers.js';
import {
  DRIVE, parseDriveTime, driveTimeText, normalizeDriven, planBreaks, describeBreaks, shortBreaks, startDrive, stepDrive,
  guidanceDrive, driveLog, resumeDriveLog, driveApplies,
} from '../src/lib/driving-time.js';
import {
  WIND, windPoints, buildWindUrl, parseWind, windAlongRoute, describeWindAlert, guidanceWind, createWindCache,
  sanitizeWindThreshold, windPlanFromRoute, shortWind,
} from '../src/lib/wind.js';
import { routeRules } from '../src/lib/route-rules.js';
import { startNavigation, updateNavigation, rerouteDone, setNavigationWind } from '../src/lib/navigation.js';
import { createSimulator } from '../src/lib/nav-sim.js';
import { memoryStorage, emptyData, sanitizeData } from '../src/lib/store.js';
import { cacheStrategy } from '../src/lib/sw-routing.js';

const semi = { name: 'Semi', weight: 44, critair: '1', banStatus: 'concerned' };
const H = 3600;

/** Trajet plein est à la latitude 47, `km` kilomètres en `seconds` secondes (une étape). */
function eastRoute(km, seconds, lon0 = 2) {
  const n = Math.max(10, Math.round(km));
  const dLon = km / (111.32 * Math.cos((47 * Math.PI) / 180));
  const coords = Array.from({ length: n + 1 }, (_, i) => [lon0 + (dLon * i) / n, 47]);
  return {
    coordinates: coords, distance: km * 1000, duration: seconds, bbox: [lon0, 47, lon0 + dLon, 47],
    steps: [{ name: 'A 71', instruction: 'Suivez l\'A71', type: 11, wayPoints: [0, n], duration: seconds, distance: km * 1000 }],
  };
}

// ───────── Temps de conduite ─────────

test('saisie de la conduite déjà faite : formats acceptés, erreurs', () => {
  assert.equal(parseDriveTime('2 h 15'), 2 * H + 15 * 60);
  assert.equal(parseDriveTime('2:15'), 2 * H + 15 * 60);
  assert.equal(parseDriveTime('4h'), 4 * H);
  assert.equal(parseDriveTime('45 min'), 45 * 60);
  assert.equal(parseDriveTime('45'), 45 * 60);
  assert.equal(parseDriveTime('4,5'), 4.5 * H);
  assert.equal(parseDriveTime(''), 0);
  assert.equal(parseDriveTime('2h75'), null);
  assert.equal(parseDriveTime('beaucoup'), null);
  assert.equal(driveTimeText(2 * H + 5 * 60), '2 h 05');
  assert.equal(driveTimeText(40 * 60), '40 min');
  // Depuis la dernière pause fait partie de la journée.
  assert.deepEqual(normalizeDriven({ today: 0, sinceBreak: 2 * H }), { today: 2 * H, sinceBreak: 2 * H });
});

test('pauses conseillées : une pause à 4 h 30 sur 7 h de route, sur une aire du bon sens', () => {
  const route = eastRoute(560, 7 * H);
  const dep = new Date(2026, 10, 18, 6, 0);
  const bare = planBreaks(route, { vehicle: semi, departure: dep });
  assert.equal(bare.applies, true);
  assert.equal(bare.breaks.length, 1);
  assert.ok(Math.abs(bare.breaks[0].drive - DRIVE.BLOCK_S) < 2);
  assert.ok(Math.abs(bare.breaks[0].along - 360000) < 1000); // 4 h 30 à 80 km/h
  assert.equal(bare.dayLimit, null);
  assert.equal(bare.arrival.getTime(), dep.getTime() + (7 * H + 45 * 60) * 1000);
  // Aires : une à 4 h 05 (gardée), une de l'autre sens à 4 h 20 (ignorée), une après la limite (ignorée).
  const areas = [
    { id: 'a', name: 'Aire de Test', along: 326667, otherSide: false },
    { id: 'b', name: 'Aire autre sens', along: 346667, otherSide: true },
    { id: 'c', name: 'Aire trop loin', along: 370000, otherSide: false },
  ];
  const plan = planBreaks(route, { vehicle: semi, departure: dep, areas });
  assert.equal(plan.breaks[0].area.id, 'a');
  const lines = describeBreaks(plan);
  assert.match(lines[0], /^Pause conseillée \(45 min\) : Aire de Test, km 327, vers 10 h 05\.$/);
  assert.match(lines.at(-1), /^Arrivée estimée avec les pauses : 13 h 45\.$/);
  assert.equal(shortBreaks(plan), '1 pause conseillée');
  assert.ok(lines.every((l) => !/obligatoire/i.test(l)), 'jamais « obligatoire »');
  // Temps écoulé : la pause décale la suite.
  assert.equal(plan.elapsed(H), H);
  assert.ok(Math.abs(plan.elapsed(5 * H) - (5 * H + 45 * 60)) < 1);
});

test('conduite déjà faite : pause plus tôt, repos journalier à 9 h de conduite', () => {
  const route = eastRoute(560, 7 * H);
  const dep = new Date(2026, 10, 18, 13, 0);
  const plan = planBreaks(route, { vehicle: semi, departure: dep, driven: { today: 5 * H, sinceBreak: 2 * H } });
  assert.equal(plan.breaks.length, 1);
  assert.ok(Math.abs(plan.breaks[0].drive - 2.5 * H) < 2);
  assert.ok(plan.dayLimit && Math.abs(plan.dayLimit.drive - 4 * H) < 1);
  const lines = describeBreaks(plan);
  assert.ok(lines.some((l) => /^Repos journalier conseillé vers km 320, vers 17 h 45 : 9 h de conduite/.test(l)), lines.join('\n'));
  // Arrivée : 7 h + 45 min + 11 h de repos → le lendemain 7 h 45.
  assert.equal(plan.arrival.getTime(), dep.getTime() + (7 * H + 45 * 60 + 11 * H) * 1000);
  assert.match(lines.at(-1), /repos de 11 h compris, jeudi/);
  assert.equal(shortBreaks(plan), '1 pause conseillée + repos journalier');
});

test('3,5 t ou moins : pas de pause calculée ; trajet court : rien à dire', () => {
  assert.equal(driveApplies({ weight: 3.5 }), false);
  assert.equal(driveApplies({ weight: 7.5 }), true);
  const p = planBreaks(eastRoute(560, 7 * H), { vehicle: { ...semi, weight: 3.5 } });
  assert.equal(p.applies, false);
  assert.deepEqual(describeBreaks(p), []);
  assert.deepEqual(describeBreaks(planBreaks(eastRoute(100, H), { vehicle: semi })), []);
});

test('les pauses décalent les heures des interdictions PL (samedi 22 h)', () => {
  // Départ samedi 15 h 30, 7 h de route (pause comprise : arrivée 23 h 15) : sans pause l'arrivée serait 22 h 30.
  const route = eastRoute(560, 7 * H, -1.5); // Nantes → Besançon, en France
  const dep = new Date(2026, 10, 21, 15, 30);
  const r = routeRules(route, { vehicle: semi, departure: dep });
  assert.equal(r.bans.conflicts.length, 1);
  const c = r.bans.conflicts[0];
  // Point du trajet à 22 h (pauses comprises) : 5 h 45 de conduite → km 460 (sans pause : km 520).
  assert.ok(Math.abs(c.along - 460000) < 1000, `along ${c.along}`);
});

test('compteur du guidage : 15 min puis 30 min, 45 min d\'un coup, 30 min seules ne suffisent pas, 9 h = nouvelle journée', () => {
  const t0 = Date.UTC(2026, 10, 18, 6);
  const run = (c, seconds, speed, step = 10) => {
    let x = c;
    for (let i = 0; i < seconds; i += step) x = stepDrive(x, { t: x.at + step * 1000, speed });
    return x;
  };
  let c = startDrive({}, t0);
  c = run(c, 4 * H, 22);
  assert.ok(Math.abs(c.block - 4 * H) < 20);
  // 30 min d'arrêt seules : pas une pause valable.
  c = run(c, 30 * 60, 0);
  c = run(c, 60, 22);
  assert.ok(c.block > 4 * H, 'pause de 30 min non comptée');
  // 15 min puis plus tard 30 min : pause valable.
  const d = run(startDrive({ sinceBreak: 2 * H }, t0), 15 * 60, 0);
  let e = run(d, 60, 22);
  assert.equal(e.split, true);
  e = run(e, H, 22);
  e = run(e, 30 * 60, 0);
  assert.equal(e.block, 0);
  assert.equal(guidanceDrive(e).view.text, 'Pause faite');
  e = run(e, 60, 22);
  assert.ok(e.block > 0 && e.block < 120 && e.split === false);
  // 45 min d'un coup.
  let f = run(startDrive({ sinceBreak: 4 * H }, t0), 45 * 60, 0);
  assert.equal(f.block, 0);
  assert.ok(f.day >= 4 * H);
  f = run(f, 9 * H, 0, 60);
  assert.equal(f.day, 0);
  // Ralentissement à 3 km/h (bouchon) : compte comme arrêt, mais 10 min ne font pas une pause.
  const g = run(run(startDrive({ sinceBreak: 3 * H }, t0), 10 * 60, 0.8), 60, 22);
  assert.ok(g.block > 3 * H);
});

test('guidage (GPS émulé) : « Pause conseillée dans 30 minutes » puis 10 minutes, jamais « obligatoire »', () => {
  const route = eastRoute(40, 1600, 4.9);
  const t0 = new Date(2026, 10, 18, 10).getTime();
  const sim = createSimulator(route.coordinates, { speedKmh: 90 });
  const fixes = Array.from({ length: 1700 }, (_, i) => sim.next(t0 + i * 1000));
  const s0 = startNavigation(route, { now: t0, rules: { vehicle: semi, voice: true, driven: { today: 3.9 * H, sinceBreak: 3.9 * H } } });
  const { events, views } = runFixes(updateNavigation, s0, fixes);
  const said = events.filter((e) => e.type === 'speak' && /[Pp]ause/.test(e.text)).map((e) => e.text);
  assert.deepEqual(said, ['Pause conseillée dans 30 minutes.', 'Pause conseillée dans 10 minutes.']);
  assert.ok(views.some((v) => /^Pause conseillée dans \d+ min$/.test(v.rules.drive?.text ?? '')));
  assert.ok(events.every((e) => !/obligatoire/i.test(e.text ?? '')));
  assert.ok(views.every((v) => !/obligatoire/i.test(v.rules.drive?.text ?? '')));
  // Journal : conduite du trajet ajoutée.
  const log = views.at(-1).driveLog;
  assert.ok(log.block > 3.9 * H + 1500 && log.block < 3.9 * H + 1700, String(log.block));
  // Voix coupée : bandeau seulement.
  const muted = runFixes(updateNavigation, startNavigation(route, { now: t0, rules: { vehicle: semi, voice: false, driven: { sinceBreak: 3.9 * H } } }), fixes);
  assert.ok(!muted.events.some((e) => /Pause/.test(e.text ?? '')));
  // 3,5 t : rien.
  const light = runFixes(updateNavigation, startNavigation(route, { now: t0, rules: { vehicle: { ...semi, weight: 3.5 }, voice: true, driven: { sinceBreak: 3.9 * H } } }), fixes);
  assert.ok(light.views.every((v) => v.rules.drive === null));
});

test('journal du compteur : repris sur l\'appareil, le temps passé depuis compte comme arrêt', () => {
  const now = Date.UTC(2026, 10, 18, 12);
  const c = { block: 4 * H, day: 6 * H, stop: 0, split: false, at: now - 50 * 60 * 1000, announced: {} };
  const log = driveLog(c);
  assert.deepEqual(resumeDriveLog(log, now), { today: 6 * H, sinceBreak: 0 });
  assert.deepEqual(resumeDriveLog(log, now - 49 * 60 * 1000), { today: 6 * H, sinceBreak: 4 * H });
  assert.deepEqual(resumeDriveLog(log, now + 10 * H * 1000), { today: 0, sinceBreak: 0 });
  assert.equal(resumeDriveLog(log, now + 30 * H * 1000), null);
  assert.equal(resumeDriveLog({ at: 'x' }, now), null);
});

// ───────── Vent ─────────

test('Open-Meteo : une requête de 100 points au plus pour 3 itinéraires, points communs fusionnés', () => {
  const a = eastRoute(1200, 14 * H);
  const b = eastRoute(1200, 14 * H, 2.02); // presque le même tracé
  const c = { ...eastRoute(900, 10 * H), coordinates: eastRoute(900, 10 * H).coordinates.map(([x, y]) => [x, y + 1]) };
  const { points, plan } = windPoints([a, b, c]);
  assert.ok(points.length <= WIND.MAX_POINTS, `${points.length} points`);
  assert.equal(plan.length, 3);
  assert.ok(plan.every((p) => p.every((x) => x.point >= 0 && x.point < points.length)));
  // a et b partagent leurs points.
  assert.equal(new Set(plan[1].map((x) => x.point)).size <= plan[0].length, true);
  const url = new URL(buildWindUrl(points));
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(url.searchParams.get('latitude').split(',').length, points.length);
  assert.equal(url.searchParams.get('hourly'), 'wind_gusts_10m,wind_speed_10m');
  assert.equal(url.searchParams.get('wind_speed_unit'), 'kmh');
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  assert.ok(!/key|apikey/i.test(url.search), 'aucune clé');
  // Trajet court : un point tous les 25 km.
  const short = windPoints([eastRoute(100, 4500)]);
  assert.equal(short.points.length, 5);
});

test('lecture de la réponse : liste de lieux, lieu seul, réponse illisible', () => {
  const list = parseWind(fixture('open-meteo-wind.json'), 5);
  assert.equal(list.length, 5);
  assert.equal(list[0].times.length, 72);
  assert.equal(list[0].times[0], Date.UTC(2026, 10, 18));
  assert.equal(parseWind(fixture('open-meteo-wind-single.json'), 1).length, 1);
  assert.equal(parseWind(fixture('open-meteo-wind.json'), 4), null);
  assert.equal(parseWind({ error: true, reason: 'x' }, 1), null);
  assert.equal(parseWind(null, 1), null);
});

test('rafales sur le trajet à l\'heure de passage (pauses comprises), textes et seuil', () => {
  const route = eastRoute(100, 4500);
  const { points, plan } = windPoints([route]);
  assert.equal(points.length, 5);
  const forecast = parseWind(fixture('open-meteo-wind.json'), 5);
  const dep = new Date(Date.UTC(2026, 10, 18, 8, 30)); // km 75 vers 9 h 26 UTC → rafales 88 km/h (heure de 10 h UTC)
  const w = windAlongRoute(plan[0], forecast, { departure: dep, threshold: 70 });
  assert.equal(w.alerts.length, 1);
  assert.equal(w.alerts[0].gust, 88);
  assert.equal(w.max, 88);
  assert.equal(w.covered, true);
  assert.match(describeWindAlert(w.alerts[0]), /^Vent fort : rafales jusqu'à 88 km\/h vers km 75 \(A71, vers 10 h\)\. Prudence/);
  assert.equal(shortWind(w), 'Vent 88 km/h');
  // Seuil plus haut : rien.
  assert.equal(windAlongRoute(plan[0], forecast, { departure: dep, threshold: 90 }).alerts.length, 0);
  // Départ 3 h plus tard : calme.
  assert.equal(windAlongRoute(plan[0], forecast, { departure: new Date(dep.getTime() + 3 * H * 1000) }).alerts.length, 0);
  // Pause de 2 h avant le km 75 (elapsed) : passage à 11 h 26 UTC → heure de 12 h UTC, calme.
  const late = windAlongRoute(plan[0], forecast, { departure: dep, elapsed: (t) => (t > 1000 ? t + 2 * H : t) });
  assert.equal(late.alerts.length, 0);
  // Hors de la prévision : prévision partielle.
  assert.equal(windAlongRoute(plan[0], forecast, { departure: new Date(Date.UTC(2026, 10, 21)) }).covered, false);
  // Seuil des réglages.
  assert.equal(sanitizeWindThreshold('85'), 85);
  assert.equal(sanitizeWindThreshold(500), WIND.THRESHOLD_MAX_KMH);
  assert.equal(sanitizeWindThreshold('abc'), 70);
  assert.equal(emptyData().settings.windGust, 70);
  assert.equal(sanitizeData({ vehicles: [], settings: { windGust: 95 } }).settings.windGust, 95);
});

test('fiche d\'itinéraire : vent, pauses, Open-Meteo indisponible', () => {
  const route = eastRoute(100, 4500);
  const { plan } = windPoints([route]);
  const forecast = parseWind(fixture('open-meteo-wind.json'), 5);
  const dep = new Date(Date.UTC(2026, 10, 18, 8, 30));
  const r = routeRules(route, { vehicle: semi, departure: dep, wind: { plan: plan[0], forecast, threshold: 70 } });
  assert.ok(r.lines.some((l) => l.level === 'warn' && /^Vent fort : rafales jusqu'à 88 km\/h/.test(l.text)));
  assert.ok(r.short.includes('Vent 88 km/h'));
  const calm = routeRules(route, { vehicle: semi, departure: dep, wind: { plan: plan[0], forecast, threshold: 100 } });
  assert.ok(calm.lines.some((l) => /sous le seuil d'alerte de 100 km\/h/.test(l.text)));
  const failed = routeRules(route, { vehicle: semi, departure: dep, wind: { failed: true } });
  assert.ok(failed.lines.some((l) => /Prévision du vent indisponible/.test(l.text)));
  const long = routeRules(eastRoute(560, 7 * H), { vehicle: semi, departure: dep });
  assert.ok(long.lines.some((l) => /^Pause conseillée/.test(l.text)));
  assert.ok(long.lines.some((l) => /chronotachygraphe fait foi/.test(l.text)));
});

test('guidage (GPS émulé) : bandeau sous 30 km avec Open-Meteo, une annonce vers 20 km, gardé après un recalcul', () => {
  const route = eastRoute(100, 4500);
  const { points } = windPoints([route]);
  const forecast = parseWind(fixture('open-meteo-wind.json'), 5);
  const t0 = Date.UTC(2026, 10, 18, 9, 0); // km 75 vers 9 h 50 UTC à 90 km/h
  const wind = { points, forecast, threshold: 70 };
  const s0 = startNavigation(route, { now: t0, rules: { vehicle: semi, voice: true, wind } });
  assert.equal(s0.wind.length, 1);
  const sim = createSimulator(route.coordinates, { speedKmh: 90 });
  const fixes = Array.from({ length: 3400 }, (_, i) => sim.next(t0 + i * 1000));
  const { events, views, state } = runFixes(updateNavigation, s0, fixes);
  const said = events.filter((e) => /Vent fort/.test(e.text ?? ''));
  assert.equal(said.length, 1);
  assert.match(said[0].text, /^Vent fort dans 20 kilomètres : rafales jusqu'à 88 kilomètres heure\.$/);
  assert.ok(views.some((v) => /^Rafales 88 km\/h dans \d+ km \(Open-Meteo\)$/.test(v.rules.wind?.text ?? '')));
  assert.ok(views.some((v) => /^Vent fort : rafales 88 km\/h \(Open-Meteo\)$/.test(v.rules.wind?.text ?? '')));
  assert.equal(views[0].rules.wind, null); // à plus de 30 km
  // Recalcul : rafales replacées sur le nouveau tracé avec les points déjà demandés (aucune requête).
  const re = rerouteDone(startNavigation(route, { now: t0, rules: { vehicle: semi, voice: true, wind } }), route);
  assert.equal(re.state.wind.length, 1);
  // Nouvelle prévision en guidage.
  assert.equal(setNavigationWind(state, null).wind.length, 0);
  // Autre tracé à plus de 15 km des points demandés : pas de prévision là.
  const far = { ...route, coordinates: route.coordinates.map(([x, y]) => [x, y + 0.5]) };
  assert.ok(windPlanFromRoute(far, points).every((p) => p.point === -1));
});

test('guidanceWind : rien après le tronçon, annonce une seule fois', () => {
  const alerts = [{ from: 50000, to: 52000, gust: 80, speed: 40, time: new Date(), roads: [] }];
  assert.equal(guidanceWind(alerts, 10000).view, null);
  const a = guidanceWind(alerts, 31000);
  assert.equal(a.speak, 'Vent fort dans 19 kilomètres : rafales jusqu\'à 80 kilomètres heure.');
  assert.equal(guidanceWind(alerts, 32000, a.announced).speak, null);
  assert.equal(guidanceWind(alerts, 53000).view, null);
});

test('cache du vent sur l\'appareil : 1 h, jamais dans le service worker', () => {
  const st = memoryStorage();
  const cache = createWindCache(st);
  const t = Date.UTC(2026, 10, 18, 8);
  cache.set('u1', { a: 1 }, t);
  assert.deepEqual(cache.get('u1', t + 59 * 60 * 1000), { a: 1 });
  assert.equal(cache.get('u1', t + 61 * 60 * 1000), null);
  assert.ok(st.getItem(WIND.CACHE_KEY).includes('u1'));
  assert.equal(cacheStrategy('GET', buildWindUrl([[2, 47]]), 'https://exemple.github.io'), 'bypass');
});
