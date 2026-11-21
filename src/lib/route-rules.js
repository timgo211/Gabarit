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
import { countryRules } from './country-rules.js';
import { weightRules } from './weights.js';
import { euroRules } from './euro.js';
import { winterRules } from './winter.js';
import { tollRules } from './hgv-tolls.js';
import { localAlongRoute, describeLocal, describeLocalAccepted, LOCAL } from './access-local.js';
import {
  ACCESS, POLICE_TEXT, conditionalAlongRoute, describeConditional, noConditionalText, unknownText, UNCOVERED_TEXT,
} from './access-conditional.js';
import { countriesAlongRoute } from './countries.js';

/**
 * Accès (phase 5d) : routes réservées à la desserte locale (extra roadaccessrestrictions d'ORS) et voies à accès
 * conditionnel de la copie data/acces-osm/ (tranches horaires, poids limité par tranche), à l'heure de passage.
 * @param {{ status:'idle'|'loading'|'ok'|'failed', ways:object[], updated:string|null, uncovered?:boolean }|null} access
 * @returns {{ lines:object[], short:string[], localTransit:object[], local:object[], conditional:object[] }}
 */
export function accessRules(route, { vehicle, access = null, departure = new Date(), elapsed = (t) => t } = {}) {
  const out = { lines: [], short: [], localTransit: [], local: [], conditional: [] };
  const loc = localAlongRoute(route, { departure, elapsed });
  out.local = loc.passages;
  if (!loc.ok) out.lines.push({ level: 'info', text: LOCAL.UNAVAILABLE_TEXT });
  for (const p of loc.passages) {
    if (p.accepted) { out.lines.push({ level: 'info', text: describeLocalAccepted(p) }); continue; }
    out.localTransit.push(p);
    out.lines.push({ level: 'warn', text: describeLocal(p) });
    out.short.push(`Desserte locale km ${Math.round(p.enter / 1000)}`);
  }
  if (access?.status !== 'ok') {
    out.lines.push(access?.status === 'loading' || access?.status === 'idle'
      ? { level: 'info', text: ACCESS.LOADING_TEXT }
      : { level: 'warn', text: ACCESS.UNAVAILABLE_TEXT });
    return out;
  }
  const ctry = countriesAlongRoute(route, { departure, elapsed });
  const countryAt = ctry.ok ? (al) => ctry.segments.find((s) => al >= s.enter && al <= s.exit)?.code ?? null : null;
  const cond = conditionalAlongRoute(route, { ways: access.ways, vehicle, departure, elapsed, countryAt });
  out.conditional = cond.passages;
  for (const p of cond.passages) {
    const active = p.state === 'no' || p.state === 'local';
    out.lines.push({ level: active ? 'warn' : 'info', text: describeConditional(p) });
    if (active) out.short.push(`Accès PL limité km ${Math.round(p.enter / 1000)}`);
  }
  if (!cond.passages.length) out.lines.push({ level: 'info', text: noConditionalText(access.updated) });
  if (cond.unknown) out.lines.push({ level: 'info', text: unknownText(cond.unknown) });
  if (access.uncovered) out.lines.push({ level: 'info', text: UNCOVERED_TEXT });
  return out;
}

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
 *   countries?:Map<string,{ status:string, data:object|null }>|null,
 *   wind?:{ status:string, forecast:object|null, threshold:number }|null }} ctx
 *   driving : décompte du temps de conduite (driving-time.js) ; wind : prévisions Open-Meteo et seuil de rafales ;
 *   areas : aires placées sur ce tracé (placeAlongRoute), pour proposer la pause sur une aire du bon sens
 * @returns {{ passages:object[], banned:object[], bans:object, lines:{ level:'warn'|'info', text:string, url?:string|null }[],
 *   short:string[] }}
 *   banned : passages interdits ; lines : notes complètes ; short : résumé pour la fiche (« ZFE Lyon interdite »)
 */
export function routeRules(route, {
  vehicle, departure = new Date(), zfe = null, driving = null, wind = null, areas = [], tunnels = null, countries = null,
  access = null, winter = null, tolls = null,
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
  // Normes Euro (phase 5g) : tunnels du Mont-Blanc et du Fréjus selon la classe Euro du profil, jamais dit.
  const euro = euroRules(route, { vehicle });
  lines.push(...euro.lines.filter((l) => l.level === 'warn'));
  short.push(...euro.short);
  // Poids en trafic international (phase 5e) : alerte avant le départ, jamais dite.
  const weight = weightRules(route, { vehicle });
  lines.push(...weight.lines.filter((l) => l.level === 'warn'));
  // Équipements d'hiver en France (phase 5f) : communes de data/hiver/ traversées du 1er novembre au 31 mars.
  const win = winterRules(route, { vehicle, winter, departure, elapsed });
  lines.push(...win.lines.filter((l) => l.level === 'warn'));
  short.push(...win.short);
  short.push(...weight.short);
  // Taxes PL régionales (phase 5h) : R-Pass, écocontribution du Grand Est ; « à vérifier » = information seulement.
  const toll = tollRules(route, { vehicle, tolls, departure, elapsed });
  lines.push(...toll.lines.filter((l) => l.level === 'warn'));
  short.push(...toll.short);
  for (const p of passages) {
    if (p.banned) {
      lines.push({ level: 'warn', text: describeZfePassage(p, vehicle), url: p.url });
      short.push(`ZFE ${p.name} interdite`);
    } else lines.push({ level: 'info', text: describeZfeAllowed(p), url: p.url });
  }
  // Accès (phase 5d) : desserte locale traversée, voie interdite à l'heure de passage.
  const acc = accessRules(route, { vehicle, access, departure, elapsed });
  lines.push(...acc.lines.filter((l) => l.level === 'warn'));
  short.push(...acc.short);
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
  lines.push(...euro.lines.filter((l) => l.level !== 'warn'));
  lines.push(...acc.lines.filter((l) => l.level !== 'warn'));
  lines.push(...weight.lines.filter((l) => l.level !== 'warn'));
  lines.push(...win.lines.filter((l) => l.level !== 'warn'));
  lines.push(...toll.lines.filter((l) => l.level !== 'warn'));
  if (vehicle?.hazmat) lines.push({ level: 'info', text: ADR.REMINDER_TEXT });
  // Pays traversés (phase 5c) : frontières (km, heure recalée par les pauses), une fiche par pays hors France.
  const ctry = countryRules(route, { vehicle, departure, elapsed, countries, tunnels: tun.passages });
  lines.push(...ctry.lines);
  short.push(...ctry.short);
  if (driving) {
    const plan = planDriving(driving, route, departure.getTime(), { schedule });
    lines.push(...plan);
    if (plan.some((l) => l.level === 'warn')) short.push('Pause conseillée');
  }
  return {
    passages, banned, bans, lines, short, windZones, tunnels: tun.passages, forbiddenTunnels: tun.forbidden,
    countries: ctry, weight, winter: win, euro, tolls: toll,
    localTransit: acc.localTransit, local: acc.local, conditional: acc.conditional,
  };
}

/** Note de source, sous les règles (données ZFE et date de la copie). */
export function rulesSourceText(zfe, { hazmat = false, tunnelsUpdated = null, accessUpdated = null } = {}) {
  const date = zfe?.updated ? ` (copie du ${zfe.updated.split('-').reverse().join('/')})` : '';
  const tun = hazmat ? ` ${ADR.SOURCE}${tunnelsUpdated ? ` Copie OSM du ${tunnelsUpdated.split('-').reverse().join('/')}.` : ''}` : '';
  return `Réglementation : ${ZFE.SOURCE}${date} ; interdictions PL : arrêté du 16 avril 2021 et calendrier annuel. Temps de conduite : règlement (CE) 561/2006, aide seulement, le chronotachygraphe fait foi. Heures estimées avec les pauses conseillées. La signalisation et les arrêtés font foi. ${ACCESS.SOURCE}${accessUpdated ? ` Copie OSM du ${accessUpdated.split('-').reverse().join('/')}.` : ''} ${POLICE_TEXT}${tun}`;
}
