// Vent fort (Open-Meteo, fixture écrite d'après la doc : liste de structures pour plusieurs points, heures UNIX) et
// temps de conduite dans le moteur de guidage, avec des positions envoyées comme le vrai GPS (une par seconde,
// vitesse fournie). Aucun appel réseau.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, runFixes } from './helpers.js';
import {
  WIND, sanitizeWindGust, windPoints, windUrl, parseWind, gustAt, windAlongRoute, describeWindZone, guidanceWind,
  prepareGuidanceWind, createWindCache, windKey,
} from '../src/lib/wind.js';
import { startNavigation, updateNavigation, rerouteDone, markStopAsWork, setNavigationWind } from '../src/lib/navigation.js';
import { createSimulator } from '../src/lib/nav-sim.js';
import { routeRules } from '../src/lib/route-rules.js';
import { emptyDriving, trackDriving } from '../src/lib/driving-time.js';
import { memoryStorage } from '../src/lib/store.js';

const POINTS = [[4.9, 45.05], [5.15, 45.05], [5.4, 45.05]];
const forecast = () => parseWind(fixture('open-meteo-wind.json'), POINTS);
const semi = { name: 'Semi', weight: 44, critair: '4', banStatus: 'concerned' };

/** 39 km plein est à la latitude 45,05, 30 min : le point de rafales (5,15) est vers le km 19,7. */
function eastRoute() {
  const n = 400;
  const coords = Array.from({ length: n + 1 }, (_, i) => [4.9 + (0.5 * i) / n, 45.05]);
  return { coordinates: coords, steps: [{ name: 'D 1', instruction: 'Suivez la D 1', type: 11, wayPoints: [0, n], duration: 1800, distance: 39000 }], duration: 1800, distance: 39000, bbox: [4.9, 45.05, 5.4, 45.05] };
}

function drive(route, t0, seconds, speedKmh = 90) {
  const sim = createSimulator(route.coordinates, { speedKmh });
  return Array.from({ length: seconds }, (_, i) => sim.next(t0 + i * 1000));
}

test('réglages : seuil de rafales par pas de 5, borné, 70 par défaut', () => {
  assert.equal(sanitizeWindGust(undefined), 70);
  assert.equal(sanitizeWindGust('92'), 90);
  assert.equal(sanitizeWindGust(10), 40);
  assert.equal(sanitizeWindGust(400), 150);
});

test('points : un tous les 15 km, itinéraires superposés fusionnés, 40 au plus ; requête GET sans clé', () => {
  const r = eastRoute();
  const pts = windPoints([r, r]);
  assert.equal(pts.length, 4); // 39 km → 0, 13, 26, 39 km
  const long = { coordinates: Array.from({ length: 2001 }, (_, i) => [0 + (12 * i) / 2000, 46]) }; // ≈ 930 km
  const far = { coordinates: Array.from({ length: 2001 }, (_, i) => [0 + (12 * i) / 2000, 47.5]) };
  const many = windPoints([long, far]);
  assert.ok(many.length <= WIND.MAX_POINTS && many.length >= 30, `${many.length}`);
  const url = windUrl(POINTS);
  assert.equal(url, 'https://api.open-meteo.com/v1/forecast?latitude=45.05,45.05,45.05&longitude=4.9,5.15,5.4&hourly=wind_speed_10m,wind_gusts_10m&wind_speed_unit=kmh&timeformat=unixtime&timezone=GMT&forecast_days=3');
});

test('lecture : liste ou objet seul, dans l\'ordre des points ; réponse incomplète → null', () => {
  const f = forecast();
  assert.equal(f.points.length, 3);
  assert.deepEqual([f.points[1].lon, f.points[1].lat], [5.15, 45.05]); // point demandé, pas la maille du modèle
  assert.equal(f.points[1].time[0], Date.UTC(2026, 10, 18));
  const one = parseWind(fixture('open-meteo-wind.json')[0], [POINTS[0]]);
  assert.equal(one.points.length, 1);
  assert.equal(parseWind({ error: true, reason: 'x' }, [POINTS[0]]), null);
  assert.equal(parseWind(fixture('open-meteo-wind.json'), POINTS.slice(0, 2)), null);
});

test('rafale à l\'heure de passage : maximum de l\'heure qui précède (valeur de l\'heure suivante)', () => {
  const p = forecast().points[1];
  assert.equal(gustAt(p, Date.UTC(2026, 10, 18, 8, 20)), 95); // 9 h UTC couvre 8 h – 9 h
  assert.equal(gustAt(p, Date.UTC(2026, 10, 18, 9, 30)), 102.6);
  assert.equal(gustAt(p, Date.UTC(2026, 10, 18, 13, 30)), 45);
  assert.equal(gustAt(p, Date.UTC(2026, 10, 25)), null); // au-delà de la prévision
});

test('fiche : zone de vent fort au-dessus du seuil, heure de passage ; seuil plus haut → rien', () => {
  const route = eastRoute();
  const departure = new Date(Date.UTC(2026, 10, 18, 9, 0)); // 10 h à Paris
  const w = windAlongRoute(route, forecast(), { departure, threshold: 80 });
  assert.equal(w.checked, 3);
  assert.equal(w.zones.length, 1);
  assert.equal(w.zones[0].gust, 102.6);
  assert.match(describeWindZone(w.zones[0]), /^Vent fort : rafales jusqu'à 103 km\/h vers km 20 \(vers 10 h 15\)\./);
  assert.equal(windAlongRoute(route, forecast(), { departure, threshold: 110 }).zones.length, 0);
  const rules = routeRules(route, { vehicle: semi, departure, wind: { status: 'ok', forecast: forecast(), threshold: 80 } });
  assert.ok(rules.short.includes('Rafales 103 km/h'));
  assert.ok(rules.lines.some((l) => l.level === 'warn' && /^Vent fort/.test(l.text)));
  const calm = routeRules(route, { vehicle: semi, departure, wind: { status: 'ok', forecast: forecast(), threshold: 120 } });
  assert.ok(calm.lines.some((l) => l.text === 'Vent : pas de rafales de 120 km/h ou plus prévues sur ce trajet.'));
  const failed = routeRules(route, { vehicle: semi, departure, wind: { status: 'failed', forecast: null, threshold: 80 } });
  assert.ok(failed.lines.some((l) => l.text === 'Météo indisponible : vent non vérifié sur ce trajet.'));
});

test('guidage : bandeau sous 30 km, une seule annonce vers 15 km ; voix coupée : bandeau seulement', () => {
  const route = eastRoute();
  const t0 = Date.UTC(2026, 10, 18, 9, 0);
  const s0 = startNavigation(route, { now: t0, wind: forecast(), windGust: 80, windVoice: true });
  const { events, views } = runFixes(updateNavigation, s0, drive(route, t0, 900));
  const said = events.filter((e) => /rafales/.test(e.text ?? ''));
  assert.equal(said.length, 1);
  assert.match(said[0].text, /^Attention, rafales de vent jusqu'à 10\d kilomètres heure dans 1[0-5] kilomètres\.$/);
  assert.match(views[0].rules.wind.text, /^Rafales 10\d km\/h dans 1\d km \(Open-Meteo\)$/);
  assert.ok(views.some((v) => /ici \(Open-Meteo\)$/.test(v.rules.wind?.text ?? '')));
  const muted = runFixes(updateNavigation, startNavigation(route, { now: t0, wind: forecast(), windGust: 80, windVoice: false }), drive(route, t0, 900));
  assert.ok(!muted.events.some((e) => /rafales/.test(e.text ?? '')));
  assert.ok(muted.views.some((v) => v.rules.wind));
  // Prévisions arrivées après « Démarrer », puis recalcul : points replacés, sans requête.
  let s = startNavigation(route, { now: t0, windGust: 80 });
  assert.equal(s.wind.placed.length, 0);
  s = setNavigationWind(s, forecast());
  assert.equal(s.wind.placed.length, 3);
  const back = { ...route, coordinates: [...route.coordinates].reverse() };
  assert.equal(rerouteDone(s, back).state.wind.placed.length, 3);
  // Rien sans prévision.
  assert.equal(guidanceWind(prepareGuidanceWind(null, route, 80), { along: 0, now: t0, timeTo: () => 0 }).view, null);
});

test('copie sur l\'appareil : 3 h, puis nouvelle requête', () => {
  const storage = memoryStorage();
  const cache = createWindCache(storage);
  const key = windKey(POINTS);
  cache.set(key, forecast(), 1000);
  assert.equal(cache.get(key, 1000 + 2 * 3600e3).points.length, 3);
  assert.equal(cache.get(key, 1000 + 4 * 3600e3), null);
  storage.setItem(WIND.CACHE_KEY, 'illisible');
  assert.equal(cache.get(key, 1000), null);
});

test('moteur : temps de conduite à chaque position, annonce 30 min avant 4 h 30, bouton « travail » refusé en roulant', () => {
  const route = eastRoute();
  const t0 = new Date(2026, 10, 18, 10).getTime();
  // 4 h de conduite déjà comptées (guidages précédents).
  let driving = emptyDriving();
  for (let i = 0; i <= 4 * 3600 - 120; i += 1) driving = trackDriving(driving, t0 - (4 * 3600 - i) * 1000, 90);
  const s0 = startNavigation(route, { now: t0, driving, driveVoice: true });
  const { state, events, views } = runFixes(updateNavigation, s0, drive(route, t0, 300));
  const said = events.filter((e) => /^Pause de 45 minutes/.test(e.text ?? ''));
  assert.equal(said.length, 1);
  assert.match(views[299].driving.main, /^Conduite 4 h 0\d · pause 45 min conseillée dans 2\d min$/);
  assert.equal(views[299].driving.level, 'soon');
  assert.equal(views[299].driving.canMarkWork, false);
  assert.equal(markStopAsWork(state, t0 + 300000).driving, null, 'en roulant : rien');
  const quiet = runFixes(updateNavigation, startNavigation(route, { now: t0, driving, driveVoice: false }), drive(route, t0, 300));
  assert.ok(!quiet.events.some((e) => /^Pause/.test(e.text ?? '')));
  // À l'arrêt : bouton proposé, l'arrêt devient « travail ».
  let s = state;
  const p = views[299].rawPosition;
  for (let i = 0; i < 20; i += 1) s = updateNavigation(s, { lon: p[0], lat: p[1], accuracy: 5, speed: 0, heading: null, timestamp: t0 + 300000 + i * 1000 }).state;
  const r = markStopAsWork(s, t0 + 320000);
  assert.equal(r.driving.canMarkWork, true);
  assert.equal(r.state.driving.stopWork, true);
  assert.equal(r.driving.workLabel, 'Compter comme pause');
});
