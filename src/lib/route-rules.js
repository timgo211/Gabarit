// Réglementation d'un itinéraire (phase 5) : ZFE, interdictions PL, pauses conseillées (temps de conduite) et vent
// fort, réunis pour les fiches d'itinéraire, les notes et le guidage. Logique pure ; les règles et leurs sources sont
// dans zfe.js, hgv-bans.js, driving-time.js et wind.js.
// Les heures de passage (ZFE, interdictions, vent) tiennent compte des pauses conseillées (planBreaks().elapsed).

import { zfeAlongRoute, describeZfePassage, describeZfeAllowed, ZFE } from './zfe.js';
import { bansAlongRoute, describeBanConflict, dayTime, CALENDAR_UNKNOWN_TEXT } from './hgv-bans.js';
import { planBreaks, describeBreaks, shortBreaks, DRIVE_NOTE } from './driving-time.js';
import {
  windAlongRoute, describeWindAlert, shortWind, windOkText, WIND, WIND_UNAVAILABLE_TEXT,
} from './wind.js';
import { areaName } from './areas-route.js';

/**
 * @param {object} route itinéraire (parseDirections)
 * @param {{ vehicle:object, departure?:Date, zfe?:{ zones:object[], voies:object[] }|null,
 *   driven?:{ today:number, sinceBreak:number }, areas?:object[],
 *   wind?:{ plan:object[], forecast:object[]|null, threshold?:number, failed?:boolean }|null }} ctx
 *   driven : conduite déjà faite aujourd'hui (s) ; areas : aires placées sur ce tracé (placeAlongRoute) ;
 *   wind : points du tracé (windPoints().plan[i]) et prévision (parseWind), failed si Open-Meteo a échoué
 * @returns {{ passages:object[], banned:object[], bans:object, breaks:object, wind:object|null,
 *   lines:{ level:'warn'|'info', text:string, url?:string|null }[], short:string[] }}
 *   banned : passages interdits ; lines : notes complètes ; short : résumé pour la fiche (« ZFE Lyon interdite »)
 */
export function routeRules(route, {
  vehicle, departure = new Date(), zfe = null, driven = {}, areas = [], wind = null,
} = {}) {
  const breaks = planBreaks(route, { vehicle, driven, areas, departure });
  const { elapsed } = breaks;
  const passages = zfe ? zfeAlongRoute(route, { data: zfe, vehicle, departure, elapsed }) : [];
  const banned = passages.filter((p) => p.banned);
  const bans = bansAlongRoute(route, { vehicle, departure, elapsed });
  const threshold = wind?.threshold ?? WIND.THRESHOLD_KMH;
  const windResult = wind?.forecast ? windAlongRoute(wind.plan, wind.forecast, { departure, threshold, elapsed }) : null;
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
  if (windResult) {
    for (const a of windResult.alerts) lines.push({ level: 'warn', text: describeWindAlert(a) });
    const ok = windResult.alerts.length ? null : windOkText(windResult, threshold);
    if (ok) lines.push({ level: 'info', text: ok });
    const sw = shortWind(windResult);
    if (sw) short.push(sw);
  } else if (wind?.failed) lines.push({ level: 'info', text: WIND_UNAVAILABLE_TEXT });
  const breakLines = describeBreaks(breaks, { areaName });
  for (const t of breakLines) lines.push({ level: 'info', text: t });
  if (breakLines.length) lines.push({ level: 'info', text: DRIVE_NOTE });
  const sb = shortBreaks(breaks);
  if (sb) short.push(sb);
  return { passages, banned, bans, breaks, wind: windResult, lines, short };
}

/** Note de source, sous les règles (données ZFE et date de la copie). */
export function rulesSourceText(zfe) {
  const date = zfe?.updated ? ` (copie du ${zfe.updated.split('-').reverse().join('/')})` : '';
  return `Réglementation : ${ZFE.SOURCE}${date} ; interdictions PL : arrêté du 16 avril 2021 et calendrier annuel. Heures estimées avec les pauses conseillées. La signalisation et les arrêtés font foi.`;
}
