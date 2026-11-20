// Alerte vent fort (phase 5, PR B) : rafales prévues le long du trajet, à l'heure de passage. Logique pure : points
// du tracé, adresse de la requête, lecture de la réponse, rafales sur le trajet, textes. L'appel réseau est dans
// src/ui/weather.js, le résultat gardé sur l'appareil (localStorage), jamais dans le cache du service worker.
//
// API Open-Meteo (vérifiée le 20/11/2026 dans le README de github.com/open-meteo/open-meteo et la documentation du
// site, dépôt github.com/open-meteo/open-meteo-website, src/routes/en/docs) :
// - https://api.open-meteo.com/v1/forecast, sans clé, CORS autorisé ; « Free for non-commercial use with data under
//   Attribution 4.0 International (CC BY 4.0) » ; « Less than 10'000 API calls per day, 5'000 per hour and 600 per
//   minute » (open-meteo.com/en/terms) ; attribution à afficher près des données (ATTRIBUTION ci-dessous).
// - « Multiple coordinates can be comma separated. E.g. &latitude=52.52,48.85&longitude=13.41,2.35. To return data
//   for multiple locations the JSON output changes to a list of structures » ; « Up to 100 coordinates can be
//   requested at once ».
// - wind_gusts_10m : « Gusts at 10 meters above ground as a maximum of the preceding hour », km/h par défaut
//   (wind_speed_unit=kmh) ; timeformat=unixtime : heures en secondes UTC ; forecast_days (16 au plus).
// Aucun seuil réglementaire de vent n'existe pour la circulation des PL (fermetures décidées localement, ex. ponts) :
// l'alerte est une aide, seuil réglable (WIND.THRESHOLD_KMH par défaut).

import { sampleRoute } from './route-samples.js';
import { haversine } from './nav-geo.js';

export const WIND = Object.freeze({
  ENDPOINT: 'https://api.open-meteo.com/v1/forecast',
  /** Seuil d'alerte par défaut : rafales de 70 km/h ou plus. */
  THRESHOLD_KMH: 70,
  THRESHOLD_MIN_KMH: 40,
  THRESHOLD_MAX_KMH: 130,
  /** Un point tous les 25 km (au moins), 100 points au plus par requête (limite d'Open-Meteo). */
  STEP_M: 25000,
  MAX_POINTS: 100,
  /** Deux points à moins de 5 km (itinéraires qui se superposent) : un seul point demandé. */
  MERGE_M: 5000,
  /** Autre tracé rattaché aux points déjà demandés jusqu'à 15 km. */
  REUSE_M: 15000,
  /** Prévision sur 3 jours (trajet + repos journalier). */
  FORECAST_DAYS: 3,
  /** Résultat gardé 1 h sur l'appareil ; en guidage, nouvelle requête au plus une fois par heure. */
  CACHE_KEY: 'gabarit.windCache',
  CACHE_MAX_AGE_MS: 3600 * 1000,
  CACHE_MAX_ENTRIES: 4,
  REFRESH_MS: 3600 * 1000,
  CLIENT_TIMEOUT_MS: 20000,
  /** Guidage : bandeau à moins de 30 km, annonce une fois vers 20 km. */
  BANNER_M: 30000,
  ANNOUNCE_M: 20000,
  ATTRIBUTION: 'Météo : Open-Meteo.com (CC BY 4.0)',
  ATTRIBUTION_URL: 'https://open-meteo.com/',
  LICENSE_URL: 'https://creativecommons.org/licenses/by/4.0/',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Seuil lu dans les réglages (km/h), borné ; illisible → défaut. */
export function sanitizeWindThreshold(x) {
  const n = typeof x === 'string' ? Number(x.replace(',', '.')) : x;
  if (!isNum(n)) return WIND.THRESHOLD_KMH;
  return Math.min(WIND.THRESHOLD_MAX_KMH, Math.max(WIND.THRESHOLD_MIN_KMH, Math.round(n)));
}

/**
 * Points demandés pour tous les itinéraires proposés (une seule requête par calcul).
 * @param {object[]} routes itinéraires (parseDirections)
 * @returns {{ points:number[][], plan:{ along:number, time:number, roads:string[], point:number }[][] }}
 *   points [lon, lat] arrondis à 0,01° (≈ 1 km : grille d'Open-Meteo plus large) ; plan[i] : points du tracé i et
 *   l'indice du point demandé correspondant
 */
export function windPoints(routes) {
  const list = (Array.isArray(routes) ? routes : []).filter((r) => Array.isArray(r?.coordinates) && r.coordinates.length >= 2);
  const totalM = list.reduce((s, r) => s + (isNum(r.distance) ? r.distance : 0), 0);
  // Pas élargi si les trajets sont longs : 100 points au plus en tout.
  let step = Math.max(WIND.STEP_M, Math.ceil(totalM / (WIND.MAX_POINTS - list.length * 2 - 1)));
  for (;;) {
    const points = [];
    const plan = list.map((r) => sampleRoute(r, step).map((sm) => {
      const p = [Math.round(sm.lonlat[0] * 100) / 100, Math.round(sm.lonlat[1] * 100) / 100];
      let k = points.findIndex((q) => haversine(q, p) <= WIND.MERGE_M);
      if (k < 0) { points.push(p); k = points.length - 1; }
      return { along: sm.along, time: sm.time, roads: sm.roads, point: k };
    }));
    if (points.length <= WIND.MAX_POINTS) return { points, plan };
    step = Math.ceil(step * 1.3);
  }
}

/**
 * Points d'un autre tracé (recalcul en guidage, itinéraire « Sans ZFE ») rattachés aux points déjà demandés, sans
 * nouvelle requête : point demandé le plus proche à moins de 15 km, sinon -1 (pas de prévision à cet endroit).
 */
export function windPlanFromRoute(route, points) {
  const pts = Array.isArray(points) ? points : [];
  if (!pts.length || !Array.isArray(route?.coordinates) || route.coordinates.length < 2) return [];
  return sampleRoute(route, WIND.STEP_M / 2).map((sm) => {
    let best = -1;
    let bestD = WIND.REUSE_M;
    for (const [k, q] of pts.entries()) {
      const d = haversine(q, sm.lonlat);
      if (d <= bestD) { bestD = d; best = k; }
    }
    return { along: sm.along, time: sm.time, roads: sm.roads, point: best };
  });
}

/** Adresse de la requête (GET) : rafales et vent moyen horaires, km/h, heures UTC en secondes. */
export function buildWindUrl(points) {
  const pts = (Array.isArray(points) ? points : []).slice(0, WIND.MAX_POINTS);
  const q = new URLSearchParams();
  q.set('latitude', pts.map((p) => p[1].toFixed(2)).join(','));
  q.set('longitude', pts.map((p) => p[0].toFixed(2)).join(','));
  q.set('hourly', 'wind_gusts_10m,wind_speed_10m');
  q.set('wind_speed_unit', 'kmh');
  q.set('timeformat', 'unixtime');
  q.set('timezone', 'GMT');
  q.set('forecast_days', String(WIND.FORECAST_DAYS));
  return `${WIND.ENDPOINT}?${q.toString()}`;
}

/**
 * Réponse Open-Meteo → une prévision par point demandé (un objet pour un point, une liste sinon).
 * @returns {{ times:number[], gusts:(number|null)[], speeds:(number|null)[] }[]|null} times en ms ; null si illisible
 */
export function parseWind(json, count) {
  const list = Array.isArray(json) ? json : json && typeof json === 'object' ? [json] : null;
  if (!list || (isNum(count) && list.length !== count)) return null;
  const out = [];
  for (const loc of list) {
    const h = loc?.hourly;
    if (!h || !Array.isArray(h.time) || !Array.isArray(h.wind_gusts_10m)) return null;
    const num = (x) => (isNum(x) ? x : null);
    out.push({
      times: h.time.map((t) => (isNum(t) ? t * 1000 : NaN)),
      gusts: h.wind_gusts_10m.map(num),
      speeds: Array.isArray(h.wind_speed_10m) ? h.wind_speed_10m.map(num) : [],
    });
  }
  return out;
}

/** Rafale prévue à l'instant t (ms) : heure suivante (maximum de l'heure précédente). */
function gustAt(f, t) {
  if (!f) return null;
  for (let i = 0; i < f.times.length; i += 1) {
    if (f.times[i] >= t) {
      if (i === 0 && f.times[0] - t > 3600e3) return null; // avant la prévision
      return { gust: f.gusts[i], speed: f.speeds[i] ?? null };
    }
  }
  return null; // après la fin de la prévision
}

/**
 * Rafales au-dessus du seuil le long d'un itinéraire, regroupées en tronçons.
 * @param {{ along:number, time:number, roads:string[], point:number }[]} plan points du tracé (windPoints().plan[i])
 * @param {object[]} forecast parseWind
 * @param {{ departure:Date, threshold?:number, elapsed?:(t:number)=>number }} ctx elapsed : pauses comprises (planBreaks)
 * @returns {{ alerts:{ from:number, to:number, gust:number, speed:number|null, time:Date, roads:string[] }[],
 *   max:number|null, covered:boolean }}
 *   max : plus forte rafale du trajet ; covered : prévision disponible pour tout le trajet
 */
export function windAlongRoute(plan, forecast, { departure = new Date(), threshold = WIND.THRESHOLD_KMH, elapsed = (t) => t } = {}) {
  const alerts = [];
  let max = null;
  let covered = Array.isArray(plan) && plan.length > 0 && Array.isArray(forecast);
  let cur = null;
  for (const sm of Array.isArray(plan) ? plan : []) {
    const t = departure.getTime() + elapsed(sm.time) * 1000;
    const g = gustAt(forecast?.[sm.point], t);
    if (!g || !isNum(g.gust)) { covered = false; cur = null; continue; }
    if (max === null || g.gust > max) max = g.gust;
    if (g.gust < threshold) { cur = null; continue; }
    if (!cur) {
      cur = { from: sm.along, to: sm.along, gust: g.gust, speed: g.speed, time: new Date(t), roads: sm.roads };
      alerts.push(cur);
    } else {
      cur.to = sm.along;
      if (g.gust > cur.gust) Object.assign(cur, { gust: g.gust, speed: g.speed, time: new Date(t), roads: sm.roads });
    }
  }
  return { alerts, max, covered };
}

// ───────── Textes ─────────

const hourText = (d) => `${d.getHours()} h`;
const roadText = (roads) => (roads?.length ? `${roads[0]}, ` : '');

/** Ligne de la fiche : « Rafales jusqu'à 85 km/h vers km 230 (A7, vers 15 h). » */
export function describeWindAlert(a) {
  const km = Math.round(a.from / 1000);
  const km2 = Math.round(a.to / 1000);
  const where = km2 - km >= 5 ? `entre km ${km} et km ${km2}` : `vers km ${km}`;
  return `Vent fort : rafales jusqu'à ${Math.round(a.gust)} km/h ${where} (${roadText(a.roads)}vers ${hourText(a.time)}). `
    + 'Prudence (véhicule vide, bâché, ponts et viaducs).';
}

/** Résumé court de la fiche d'itinéraire. */
export function shortWind(wind) {
  if (!wind?.alerts?.length) return null;
  return `Vent ${Math.round(Math.max(...wind.alerts.map((a) => a.gust)))} km/h`;
}

/** Ligne d'information quand rien ne dépasse le seuil. */
export function windOkText(wind, threshold) {
  if (!wind || wind.max === null) return null;
  const part = wind.covered ? '' : ' (prévision partielle)';
  return `Vent : rafales prévues jusqu'à ${Math.round(wind.max)} km/h, sous le seuil d'alerte de ${threshold} km/h${part}.`;
}

export const WIND_UNAVAILABLE_TEXT = 'Prévision du vent indisponible (Open-Meteo injoignable).';

/**
 * Guidage : tronçon venteux devant (bandeau sous 30 km, dedans aussi), annonce une fois vers 20 km.
 * @returns {{ view:{ distance:number, gust:number, text:string }|null, speak:string|null, announced:object }}
 */
export function guidanceWind(alerts, along, announced = {}) {
  const done = { ...announced };
  for (const [i, a] of (Array.isArray(alerts) ? alerts : []).entries()) {
    if (a.to < along) continue;
    const distance = Math.max(0, a.from - along);
    if (distance > WIND.BANNER_M) return { view: null, speak: null, announced: done };
    const g = Math.round(a.gust);
    const text = distance <= 500 ? `Vent fort : rafales ${g} km/h (Open-Meteo)` : `Rafales ${g} km/h dans ${Math.round(distance / 1000)} km (Open-Meteo)`;
    let speak = null;
    if (!done[i] && distance <= WIND.ANNOUNCE_M) {
      done[i] = true;
      speak = distance <= 1000
        ? `Vent fort : rafales jusqu'à ${g} kilomètres heure.`
        : `Vent fort dans ${Math.round(distance / 1000)} kilomètres : rafales jusqu'à ${g} kilomètres heure.`;
    }
    return { view: { distance, gust: a.gust, text }, speak, announced: done };
  }
  return { view: null, speak: null, announced: done };
}

// ───────── Cache sur l'appareil ─────────

function readCache(storage) {
  try {
    const v = JSON.parse(storage.getItem(WIND.CACHE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((e) => e && typeof e.url === 'string' && typeof e.at === 'number') : [];
  } catch {
    return [];
  }
}

/** Réponses Open-Meteo gardées 1 h (localStorage, ou objet en mémoire dans les tests). */
export function createWindCache(storage) {
  return {
    get(url, now = Date.now()) {
      const e = readCache(storage).find((x) => x.url === url);
      return e && now - e.at <= WIND.CACHE_MAX_AGE_MS ? e.json : null;
    },
    set(url, json, now = Date.now()) {
      const list = readCache(storage).filter((x) => x.url !== url && now - x.at <= WIND.CACHE_MAX_AGE_MS);
      list.unshift({ url, at: now, json });
      try {
        storage.setItem(WIND.CACHE_KEY, JSON.stringify(list.slice(0, WIND.CACHE_MAX_ENTRIES)));
      } catch {
        try { storage.setItem(WIND.CACHE_KEY, JSON.stringify([{ url, at: now, json }])); } catch { /* tant pis */ }
      }
    },
  };
}
