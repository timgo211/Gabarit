// Réglementation d'un itinéraire (phase 5) : ZFE, interdictions PL, temps de conduite et vent fort, réunis pour les
// fiches d'itinéraire, les notes et le guidage. Logique pure ; les règles et leurs sources sont dans zfe.js,
// hgv-bans.js, driving-time.js et wind.js. Les heures de passage (ZFE, interdictions, vent) tiennent compte des pauses
// conseillées (breakSchedule().elapsed).

import { zfeAlongRoute, describeZfePassage, describeZfeAllowed, ZFE } from './zfe.js';
import { bansAlongRoute, describeBanConflict, dayTime, CALENDAR_UNKNOWN_TEXT } from './hgv-bans.js';
import { planDriving, breakSchedule } from './driving-time.js';
import { windAlongRoute, describeWindZone, windCalmText, WIND } from './wind.js';
import {
  ADR, effectiveCode, tunnelsAlongRoute, describeForbidden, describeAllowed, noTunnelText, tunnelName,
} from './adr.js';

/**
 * Tunnels du trajet (phase 5b) pour un véhicule ADR. Code tunnel vide : aucune alerte. Données absentes ou vides :
 * UNAVAILABLE_TEXT (jamais un silence) ; les trois tunnels gardés en dur sont vérifiés dans tous les cas.
 * @param {{ status:'ok'|'loading'|'failed', data:object|null }|null} tunnels
 */
export function tunnelRules(route, { vehicle, tunnels = null, departure = new Date(), elapsed = (t) => t } = {}) {
  const out = { passages: [], forbidden: [], lines: [], short: [] };
  if (!vehicle?.hazmat) return out;
  const code = effectiveCode(vehicle);
  if (!code) {
    out.lines.push({ level: 'info', text: ADR.NO_CODE_TEXT });
    return out;
  }
  const ok = tunnels?.status === 'ok' && tunnels.data?.ok;
  out.passages = tunnelsAlongRoute(route, { data: ok ? tunnels.data : null, vehicle, departure, elapsed });
  out.forbidden = out.passages.filter((p) => p.forbidden);
  if (!ok) {
    out.lines.push(tunnels?.status === 'loading'
      ? { level: 'info', text: ADR.LOADING_TEXT }
      : { level: 'warn', text: ADR.UNAVAILABLE_TEXT });
  }
  for (const p of out.passages) {
    if (p.forbidden) {
      out.lines.push({ level: 'warn', text: describeForbidden(p) });
      out.short.push(`${tunnelName(p)} interdit`);
    } else out.lines.push({ level: 'info', text: describeAllowed(p) });
  }
  if (ok && !out.passages.length) out.lines.push({ level: 'info', text: noTunnelText(tunnels.data.updated) });
  return out;
}

/**
 * @param {object} route itinéraire (parseDirections)
 * @param {{ vehicle:object, departure?:Date, zfe?:{ zones:object[], voies:object[] }|null, driving?:object|null,
 *   wind?:{ status:string, forecast:object|null, threshold:number }|null }} ctx
 *   driving : décompte du temps de conduite (driving-time.js) ; wind : prévisions Open-Meteo et seuil de rafales ;
 *   areas : aires placées sur ce tracé (placeAlongRoute), pour proposer la pause sur une aire du bon sens
 * @returns {{ passages:object[], banned:object[], bans:object, lines:{ level:'warn'|'info', text:string, url?:string|null }[],
 *   short:string[] }}
 *   banned : passages interdits ; lines : notes complètes ; short : résumé pour la fiche (« ZFE Lyon interdite »)
 */
export function routeRules(route, {
  vehicle, departure = new Date(), zfe = null, driving = null, wind = null, areas = [], tunnels = null,
} = {}) {
  const schedule = driving ? breakSchedule(driving, route, departure.getTime(), { areas }) : null;
  const elapsed = schedule?.elapsed ?? ((t) => t);
  const passages = zfe ? zfeAlongRoute(route, { data: zfe, vehicle, departure, elapsed }) : [];
  const banned = passages.filter((p) => p.banned);
  const bans = bansAlongRoute(route, { vehicle, departure, elapsed });
  const lines = [];
  const short = [];
  // Tunnels interdits en premier : ils se contournent avant le départ, pas sur place.
  const tun = tunnelRules(route, { vehicle, tunnels, departure, elapsed });
  lines.push(...tun.lines.filter((l) => l.level === 'warn'));
  short.push(...tun.short);
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
    const w = windAlongRoute(route, wind.forecast, { departure, threshold, elapsed });
    windZones = w.zones;
    for (const z of w.zones) lines.push({ level: 'warn', text: describeWindZone(z) });
    if (w.zones.length) short.push(`Rafales ${Math.round(Math.max(...w.zones.map((z) => z.gust)))} km/h`);
    else if (w.checked) lines.push({ level: 'info', text: windCalmText(threshold) });
  } else if (wind?.status === 'failed') lines.push({ level: 'info', text: WIND.UNAVAILABLE_TEXT });
  lines.push(...tun.lines.filter((l) => l.level !== 'warn'));
  if (vehicle?.hazmat) lines.push({ level: 'info', text: ADR.REMINDER_TEXT });
  if (driving) {
    const plan = planDriving(driving, route, departure.getTime(), { schedule });
    lines.push(...plan);
    if (plan.some((l) => l.level === 'warn')) short.push('Pause conseillée');
  }
  return { passages, banned, bans, lines, short, windZones, tunnels: tun.passages, forbiddenTunnels: tun.forbidden };
}

/** Note de source, sous les règles (données ZFE et date de la copie). */
export function rulesSourceText(zfe, { hazmat = false, tunnelsUpdated = null } = {}) {
  const date = zfe?.updated ? ` (copie du ${zfe.updated.split('-').reverse().join('/')})` : '';
  const tun = hazmat ? ` ${ADR.SOURCE}${tunnelsUpdated ? ` Copie OSM du ${tunnelsUpdated.split('-').reverse().join('/')}.` : ''}` : '';
  return `Réglementation : ${ZFE.SOURCE}${date} ; interdictions PL : arrêté du 16 avril 2021 et calendrier annuel. Temps de conduite : règlement (CE) 561/2006, aide seulement, le chronotachygraphe fait foi. Heures estimées avec les pauses conseillées. La signalisation et les arrêtés font foi.${tun}`;
}
