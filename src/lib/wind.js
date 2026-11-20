// Alerte vent fort (phase 5, PR B). Logique pure : points du trajet envoyés à Open-Meteo (une requête par calcul,
// pour tous les itinéraires proposés), lecture de la réponse, rafales prévues à l'heure de passage, textes des
// fiches et du guidage, copie sur l'appareil.
//
// Source des prévisions : Open-Meteo (https://open-meteo.com/), API Forecast /v1/forecast, sans clé. Documentation
// lue dans le dépôt du site (github.com/open-meteo/open-meteo-website, src/routes/en/docs, terms et licence ;
// open-meteo.com est bloqué depuis le conteneur de développement) :
// - « Multiple coordinates can be comma separated. E.g. &latitude=52.52,48.85&longitude=13.41,2.35. To return data
//   for multiple locations the JSON output changes to a list of structures. »
// - wind_gusts_10m : « Gusts at 10 meters above ground as a maximum of the preceding hour » (km/h par défaut) →
//   la valeur de l'heure H couvre (H − 1 h, H] : pour un passage à 14 h 20, c'est celle de 15 h.
// - timeformat=unixtime : heures en secondes UNIX (GMT).
// - Conditions d'utilisation (API gratuite, usage non commercial) : moins de 10 000 appels par jour, 5 000 par heure,
//   600 par minute ; chaque lieu demandé compte comme un appel → 40 points au plus par calcul.
// - Licence des données : CC BY 4.0, attribution « Weather data by Open-Meteo.com » avec un lien vers le site et la
//   licence (affichée sous les fiches, dans Réglages et « (Open-Meteo) » dans le bandeau du guidage).
// Seuil : aucune règle nationale unique pour les poids lourds (fermetures de ponts et de viaducs décidées localement
// et signalées sur place) ; seuil de rafales choisi dans Réglages, 70 km/h par défaut. Aide seulement : la
// signalisation, les consignes des gestionnaires et la vigilance Météo-France font foi.

import { prepareLine, locateOnLine, pointAt, haversine } from './nav-geo.js';
import { timeAt } from './areas-route.js';
import { routeKey } from './areas-cache.js';
import { OPEN_METEO_BASE } from './config.js';

export const WIND = Object.freeze({
  /** Un point de prévision tous les 15 km (modèles de 2 à 11 km de maille). */
  SAMPLE_M: 15000,
  /** Points envoyés au plus (chacun compte comme un appel : quota gratuit 10 000 par jour). */
  MAX_POINTS: 40,
  /** Deux points à moins de 7 km (itinéraires proposés qui se superposent) : un seul. */
  MERGE_M: 7000,
  /** Un point sert à un itinéraire qui passe à moins de 10 km. */
  NEAR_M: 10000,
  /** Zone couverte par un point de part et d'autre (m) : début de la zone annoncée. */
  ZONE_HALF_M: 5000,
  FORECAST_DAYS: 3,
  /** Seuil de rafales (km/h) : réglable dans Réglages. */
  GUST: Object.freeze({ min: 40, max: 150, step: 5, default: 70 }),
  /** Guidage : bandeau sous 30 km, annonce une fois vers 15 km. */
  BANNER_M: 30000,
  ANNOUNCE_M: 15000,
  TIMEOUT_MS: 15000,
  CACHE_KEY: 'gabarit.windCache',
  /** Prévisions gardées 3 h (modèles mis à jour toutes les 1 à 6 h), 3 trajets. */
  CACHE_MAX_AGE_MS: 3 * 3600e3,
  CACHE_MAX_ENTRIES: 3,
  ATTRIBUTION: 'Weather data by Open-Meteo.com',
  ATTRIBUTION_URL: 'https://open-meteo.com/',
  LICENSE: 'CC BY 4.0',
  LICENSE_URL: 'https://creativecommons.org/licenses/by/4.0/',
  UNAVAILABLE_TEXT: 'Météo indisponible : vent non vérifié sur ce trajet.',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const round3 = (x) => Math.round(x * 1000) / 1000;

/** Seuil lu dans les réglages (pas de 5 km/h, borné). */
export function sanitizeWindGust(x) {
  const n = typeof x === 'string' ? Number(x.replace(',', '.')) : x;
  const g = WIND.GUST;
  if (!isNum(n)) return g.default;
  return Math.min(g.max, Math.max(g.min, Math.round(n / g.step) * g.step));
}

/**
 * Points de prévision de tous les itinéraires proposés : un tous les 15 km (départ et arrivée compris), doublons à
 * moins de 7 km retirés, 40 au plus (écart agrandi si besoin). Arrondis à 0,001° (≈ 100 m).
 * @param {{ coordinates:number[][] }[]} routes
 * @returns {number[][]} [lon, lat]
 */
export function windPoints(routes, { maxPoints = WIND.MAX_POINTS } = {}) {
  const lines = (Array.isArray(routes) ? routes : [])
    .filter((r) => Array.isArray(r?.coordinates) && r.coordinates.length >= 2)
    .map((r) => prepareLine(r.coordinates));
  for (let step = WIND.SAMPLE_M; ; step *= 1.25) {
    const pts = [];
    for (const line of lines) {
      const n = Math.max(1, Math.round(line.total / step));
      for (let k = 0; k <= n; k += 1) {
        const p = pointAt(line, (line.total * k) / n).point;
        if (!pts.some((q) => haversine(q, p) < Math.min(WIND.MERGE_M, step / 2))) pts.push([round3(p[0]), round3(p[1])]);
      }
    }
    if (pts.length <= maxPoints || step > 1e6) return pts.slice(0, maxPoints);
  }
}

/** Requête Open-Meteo (GET) pour ces points : rafales et vent moyen à 10 m, heures UNIX. */
export function windUrl(points) {
  const lat = points.map((p) => p[1]).join(',');
  const lon = points.map((p) => p[0]).join(',');
  return `${OPEN_METEO_BASE}/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_gusts_10m`
    + `&wind_speed_unit=kmh&timeformat=unixtime&timezone=GMT&forecast_days=${WIND.FORECAST_DAYS}`;
}

/**
 * Lit la réponse (un objet pour un point, une liste pour plusieurs), dans l'ordre des points demandés.
 * @returns {{ points:{ lon:number, lat:number, time:number[], gust:(number|null)[], speed:(number|null)[] }[] }|null}
 *   time en ms ; null si la réponse est illisible
 */
export function parseWind(json, points) {
  const list = Array.isArray(json) ? json : json && typeof json === 'object' ? [json] : [];
  if (!Array.isArray(points) || list.length !== points.length || !list.length) return null;
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const h = list[i]?.hourly;
    if (!h || !Array.isArray(h.time) || !Array.isArray(h.wind_gusts_10m)) return null;
    const n = h.time.length;
    if (h.wind_gusts_10m.length !== n) return null;
    const val = (x) => (isNum(x) && x >= 0 && x < 500 ? x : null);
    out.push({
      lon: points[i][0],
      lat: points[i][1],
      time: h.time.map((x) => (isNum(x) ? x * 1000 : NaN)),
      gust: h.wind_gusts_10m.map(val),
      speed: Array.isArray(h.wind_speed_10m) && h.wind_speed_10m.length === n ? h.wind_speed_10m.map(val) : h.time.map(() => null),
    });
  }
  return { points: out };
}

/**
 * Rafale prévue à l'heure `ms` en ce point : valeur de la première heure ≥ ms (maximum de l'heure qui précède).
 * null hors de la période prévue.
 */
export function gustAt(point, ms) {
  if (!point || !isNum(ms)) return null;
  const { time, gust } = point;
  if (!time.length || ms < time[0] - 3600e3 || ms > time[time.length - 1]) return null;
  for (let i = 0; i < time.length; i += 1) if (time[i] >= ms) return gust[i];
  return null;
}

/**
 * Points de prévision placés sur un itinéraire (à moins de 10 km), triés depuis le départ.
 * @returns {{ along:number, time:number, point:object }[]} time : secondes depuis le départ (durées ORS)
 */
export function placeWind(forecast, route) {
  if (!forecast?.points?.length || !Array.isArray(route?.coordinates) || route.coordinates.length < 2) return [];
  const line = prepareLine(route.coordinates);
  const out = [];
  for (const point of forecast.points) {
    const loc = locateOnLine(line, [point.lon, point.lat]);
    if (loc.distance > WIND.NEAR_M) continue;
    out.push({ along: loc.along, time: timeAt(route, line, loc.along), point });
  }
  return out.sort((a, b) => a.along - b.along);
}

/**
 * Vent fort sur un itinéraire, à l'heure de passage estimée depuis `departure` (elapsed : pauses conseillées comprises).
 * @returns {{ checked:number, zones:{ from:number, to:number, gust:number, at:Date, points:number }[] }}
 *   zones : passages consécutifs au-dessus du seuil (km de départ et de fin, rafale la plus forte et son heure)
 */
export function windAlongRoute(route, forecast, { departure = new Date(), threshold = WIND.GUST.default, elapsed = (t) => t } = {}) {
  const placed = placeWind(forecast, route);
  const zones = [];
  let cur = null;
  let checked = 0;
  for (const p of placed) {
    const at = departure.getTime() + elapsed(p.time) * 1000;
    const g = gustAt(p.point, at);
    if (g === null) { cur = null; continue; }
    checked += 1;
    if (g >= threshold) {
      if (!cur) {
        cur = { from: Math.max(0, p.along - WIND.ZONE_HALF_M), to: p.along, gust: g, at: new Date(at), points: 1 };
        zones.push(cur);
      } else {
        cur.to = p.along;
        cur.points += 1;
        if (g > cur.gust) { cur.gust = g; cur.at = new Date(at); }
      }
    } else cur = null;
  }
  return { checked, zones };
}

const hhmm = (d) => `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;

/** Ligne de la fiche : « Vent fort : rafales jusqu'à 95 km/h vers km 120 (vers 14 h 20). » */
export function describeWindZone(z) {
  const a = Math.round(z.from / 1000);
  const b = Math.round(z.to / 1000);
  const where = z.points > 1 ? `entre km ${a} et km ${b}` : `vers km ${b}`;
  return `Vent fort : rafales jusqu'à ${Math.round(z.gust)} km/h ${where} (vers ${hhmm(z.at)}). Prudence, véhicule vide ou bâché surtout.`;
}

/** Note quand rien ne dépasse le seuil (prévision lue). */
export function windCalmText(threshold) {
  return `Vent : pas de rafales de ${threshold} km/h ou plus prévues sur ce trajet.`;
}

/** Préparation pour le guidage : points placés sur l'itinéraire suivi, seuil, annonces déjà faites. */
export function prepareGuidanceWind(forecast, route, threshold) {
  return { forecast: forecast ?? null, placed: placeWind(forecast, route), threshold: sanitizeWindGust(threshold), announced: {} };
}

/**
 * Guidage : rafales au-dessus du seuil dans les 30 km devant, à l'heure où on y sera.
 * @param {{ placed:object[], threshold:number, announced:object }} wind
 * @param {{ along:number, now:number, timeTo:(along:number)=>number }} p timeTo : secondes jusqu'à ce point
 * @returns {{ view:{ gust:number, distance:number, text:string }|null, speak:string|null, announced:object }}
 */
export function guidanceWind(wind, { along, now, timeTo }) {
  const announced = { ...(wind?.announced ?? {}) };
  if (!wind?.placed?.length || !isNum(along)) return { view: null, speak: null, announced };
  let first = null;
  let gust = 0;
  for (const p of wind.placed) {
    const start = p.along - WIND.ZONE_HALF_M;
    if (p.along + WIND.ZONE_HALF_M < along) continue;
    if (start - along > WIND.BANNER_M) break;
    const g = gustAt(p.point, now + Math.max(0, timeTo(p.along)) * 1000);
    if (g === null || g < wind.threshold) {
      if (first) break; // fin de la zone
      continue;
    }
    if (!first) first = p;
    gust = Math.max(gust, g);
  }
  if (!first) return { view: null, speak: null, announced };
  const distance = Math.max(0, first.along - WIND.ZONE_HALF_M - along);
  const g = Math.round(gust);
  const text = distance > 0
    ? `Rafales ${g} km/h dans ${distance >= 1000 ? `${Math.round(distance / 1000)} km` : `${Math.round(distance / 100) * 100} m`} (Open-Meteo)`
    : `Rafales jusqu'à ${g} km/h ici (Open-Meteo)`;
  let speak = null;
  const key = String(Math.round(first.along));
  if (!announced[key] && distance <= WIND.ANNOUNCE_M) {
    announced[key] = true;
    speak = distance >= 1000
      ? `Attention, rafales de vent jusqu'à ${g} kilomètres heure dans ${Math.round(distance / 1000)} kilomètres.`
      : `Attention, rafales de vent jusqu'à ${g} kilomètres heure sur cette partie du trajet.`;
  }
  return { view: { gust: g, distance, text }, speak, announced };
}

/** Empreinte d'une liste de points (copie sur l'appareil). */
export const windKey = (points) => routeKey(points);

/** Prévisions gardées sur l'appareil (localStorage, jamais dans le cache du service worker, jamais exportées). */
export function createWindCache(storage) {
  const readAll = () => {
    try {
      const v = JSON.parse(storage.getItem(WIND.CACHE_KEY) ?? '[]');
      return Array.isArray(v) ? v.filter((e) => e && typeof e.key === 'string' && typeof e.at === 'number' && e.forecast?.points) : [];
    } catch {
      return [];
    }
  };
  return {
    get(key, now = Date.now()) {
      const e = readAll().find((x) => x.key === key);
      return e && now - e.at <= WIND.CACHE_MAX_AGE_MS && now >= e.at ? e.forecast : null;
    },
    set(key, forecast, now = Date.now()) {
      const list = readAll().filter((x) => x.key !== key && now - x.at <= WIND.CACHE_MAX_AGE_MS);
      list.unshift({ key, at: now, forecast });
      try {
        storage.setItem(WIND.CACHE_KEY, JSON.stringify(list.slice(0, WIND.CACHE_MAX_ENTRIES)));
      } catch {
        try { storage.setItem(WIND.CACHE_KEY, JSON.stringify([{ key, at: now, forecast }])); } catch { /* tant pis */ }
      }
    },
  };
}
