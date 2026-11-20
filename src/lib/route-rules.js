// Réglementation d'un itinéraire (phase 5) : ZFE, interdictions PL, temps de conduite et vent fort, réunis pour les
// fiches d'itinéraire, les notes et le guidage. Logique pure ; les règles et leurs sources sont dans zfe.js,
// hgv-bans.js, driving-time.js et wind.js.

import { zfeAlongRoute, describeZfePassage, describeZfeAllowed, ZFE } from './zfe.js';
import { bansAlongRoute, describeBanConflict, dayTime, CALENDAR_UNKNOWN_TEXT } from './hgv-bans.js';
import { planDriving } from './driving-time.js';
import { windAlongRoute, describeWindZone, windCalmText, WIND } from './wind.js';

/**
 * @param {object} route itinéraire (parseDirections)
 * @param {{ vehicle:object, departure?:Date, zfe?:{ zones:object[], voies:object[] }|null, driving?:object|null,
 *   wind?:{ status:string, forecast:object|null, threshold:number }|null }} ctx
 *   driving : décompte du temps de conduite (driving-time.js) ; wind : prévisions Open-Meteo et seuil de rafales
 * @returns {{ passages:object[], banned:object[], bans:object, lines:{ level:'warn'|'info', text:string, url?:string|null }[],
 *   short:string[] }}
 *   banned : passages interdits ; lines : notes complètes ; short : résumé pour la fiche (« ZFE Lyon interdite »)
 */
export function routeRules(route, { vehicle, departure = new Date(), zfe = null, driving = null, wind = null } = {}) {
  const passages = zfe ? zfeAlongRoute(route, { data: zfe, vehicle, departure }) : [];
  const banned = passages.filter((p) => p.banned);
  const bans = bansAlongRoute(route, { vehicle, departure });
  const lines = [];
  const short = [];
  for (const p of passages) {
    if (p.banned) {
      lines.push({ level: 'warn', text: describeZfePassage(p, vehicle), url: p.url });
      short.push(`ZFE ${p.name} interdite`);
    } else lines.push({ level: 'info', text: describeZfeAllowed(p), url: p.url });
  }
  for (const c of bans.conflicts) {
    lines.push({ level: 'warn', text: describeBanConflict(c) });
    short.push(`Interdiction PL ${dayTime(c.start)}`);
  }
  if (bans.applies && !bans.calendarKnown) lines.push({ level: 'info', text: CALENDAR_UNKNOWN_TEXT });
  let windZones = [];
  if (wind?.status === 'ok' && wind.forecast) {
    const threshold = wind.threshold ?? WIND.GUST.default;
    const w = windAlongRoute(route, wind.forecast, { departure, threshold });
    windZones = w.zones;
    for (const z of w.zones) lines.push({ level: 'warn', text: describeWindZone(z) });
    if (w.zones.length) short.push(`Rafales ${Math.round(Math.max(...w.zones.map((z) => z.gust)))} km/h`);
    else if (w.checked) lines.push({ level: 'info', text: windCalmText(threshold) });
  } else if (wind?.status === 'failed') lines.push({ level: 'info', text: WIND.UNAVAILABLE_TEXT });
  if (driving) {
    const plan = planDriving(driving, route, departure.getTime());
    lines.push(...plan);
    if (plan.some((l) => l.level === 'warn')) short.push('Pause à prévoir');
  }
  return { passages, banned, bans, lines, short, windZones };
}

/** Note de source, sous les règles (données ZFE et date de la copie). */
export function rulesSourceText(zfe) {
  const date = zfe?.updated ? ` (copie du ${zfe.updated.split('-').reverse().join('/')})` : '';
  return `Réglementation : ${ZFE.SOURCE}${date} ; interdictions PL : arrêté du 16 avril 2021 et calendrier annuel. Temps de conduite : règlement (CE) 561/2006, aide seulement, le chronotachygraphe fait foi. Heures estimées sans les pauses. La signalisation et les arrêtés font foi.`;
}
