// Réglementation d'un itinéraire (phase 5) : ZFE et interdictions PL, réunies pour les fiches d'itinéraire, les notes
// et le guidage. Logique pure ; les règles et leurs sources sont dans zfe.js et hgv-bans.js.

import { zfeAlongRoute, describeZfePassage, describeZfeAllowed, ZFE } from './zfe.js';
import { bansAlongRoute, describeBanConflict, dayTime, CALENDAR_UNKNOWN_TEXT } from './hgv-bans.js';

/**
 * @param {object} route itinéraire (parseDirections)
 * @param {{ vehicle:object, departure?:Date, zfe?:{ zones:object[], voies:object[] }|null }} ctx
 * @returns {{ passages:object[], banned:object[], bans:object, lines:{ level:'warn'|'info', text:string, url?:string|null }[],
 *   short:string[] }}
 *   banned : passages interdits ; lines : notes complètes ; short : résumé pour la fiche (« ZFE Lyon interdite »)
 */
export function routeRules(route, { vehicle, departure = new Date(), zfe = null } = {}) {
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
  return { passages, banned, bans, lines, short };
}

/** Note de source, sous les règles (données ZFE et date de la copie). */
export function rulesSourceText(zfe) {
  const date = zfe?.updated ? ` (copie du ${zfe.updated.split('-').reverse().join('/')})` : '';
  return `Réglementation : ${ZFE.SOURCE}${date} ; interdictions PL : arrêté du 16 avril 2021 et calendrier annuel. Heures estimées sans les pauses. La signalisation et les arrêtés font foi.`;
}
