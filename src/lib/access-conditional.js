// Accès des voies par tranches horaires (phase 5d) : lecture des étiquettes conditionnelles d'OpenStreetMap copiées
// dans data/acces-osm/ (tools/osm-update.mjs, src/lib/access-convert.js), rapprochement prudent avec le tracé,
// évaluation à l'heure de passage, textes des fiches et du guidage. Logique pure.
//
// Pourquoi une alerte et pas un évitement : OpenRouteService ne tient compte des accès conditionnels que si son graphe
// est construit avec l'option conditional_access (VehicleFlagEncoder : properties.getBool(ConditionalEdges.ACCESS,
// false), absente de la doc build.md), et son paramètre departure est caché (RouteRequest.java : hidden = true) —
// code GIScience/openrouteservice lu le 20/11/2026. Une voie interdite aux PL à certaines heures est donc acceptée par
// ORS : l'appli prévient, la signalisation fait foi.
//
// Étiquettes (wiki OSM « Conditional restrictions ») : « valeur @ condition ; valeur @ (condition) », condition =
// horaires au format opening_hours, ou condition sur le véhicule (weight>7.5), reliées par AND. Le moyen de transport
// le plus précis l'emporte : hgv > motor_vehicle > vehicle > access, même ordre que les accès lus par ORS
// (AccessRestrictionsParser : hgvTags = hgv, motor_vehicle, vehicle, access). Pour un moyen de transport, une
// condition vraie l'emporte sur l'étiquette sans condition ; plusieurs conditions vraies : la dernière écrite.
//
// Pouvoir de police : voir POLICE_TEXT (Code de la route, art. R411-8, texte cité plus bas).

import { prepareLine, pointAt } from './nav-geo.js';
import { timeAt } from './areas-route.js';
import { parseHours, hoursActive, hoursText } from './zfe.js';
import { indexLine, nearest } from './adr.js';
import { countryHolidayName, countryHolidays } from './holidays.js';
import { copyDateText } from './areas-osm-data.js';

export const ACCESS = Object.freeze({
  INDEX_PATH: './data/acces-osm/index.json',
  DIR: './data/acces-osm/',
  /** Ordre de priorité des moyens de transport (le plus précis d'abord). */
  MODES: Object.freeze(['hgv', 'motor_vehicle', 'vehicle', 'access']),
  /** Rapprochement : au moins 80 % de la longueur de la voie à moins de 15 m du tracé, dans l'ordre du tracé. */
  MATCH_M: 15,
  MATCH_SHARE: 0.8,
  /** Voie lue tous les 10 m au plus pour le rapprochement. */
  STEP_M: 10,
  /** Guidage : bandeau sous 10 km, annonce une fois vers 3 km (pas sous 1 km). */
  BANNER_M: 10000,
  ANNOUNCE_M: 3000,
  ANNOUNCE_MIN_M: 1000,
  SIGNAGE: 'la signalisation fait foi',
  UNAVAILABLE_TEXT: 'Restrictions horaires indisponibles (données non chargées).',
  LOADING_TEXT: 'Restrictions horaires : chargement des données…',
  SOURCE: 'Restrictions horaires : © contributeurs OpenStreetMap (ODbL), étiquettes hgv / motor_vehicle / vehicle / access / maxweight:conditional.',
});

/**
 * Code de la route, art. R411-8 (rédaction du décret n° 2013-938 du 18 octobre 2013, art. 1), texte lu le 21/11/2026
 * dans le PDF du code de codes.droit.org (édition du 27/10/2026, « droit positif », recalculé d'après Légifrance ;
 * Légifrance refuse le conteneur et l'Action GitHub, HTTP 403) par le job r411 de l'Action « Données OSM » :
 * « Les dispositions du présent code ne font pas obstacle au droit conféré par les lois et règlements aux préfets,
 * au président du Conseil exécutif de Corse, aux présidents de conseil départemental et aux maires de prescrire,
 * dans la limite de leurs pouvoirs, des mesures plus rigoureuses dès lors que la sécurité de la circulation routière
 * l'exige. Pour ce qui les concerne, les préfets et les maires peuvent également fonder leurs décisions sur l'intérêt
 * de l'ordre public.
 * Lorsqu'ils intéressent la police de la circulation sur les voies classées à grande circulation, les arrêtés du
 * président du conseil départemental ou du maire fondés sur le premier alinéa sont pris après avis du préfet. »
 * D'où les interdictions locales par tranches horaires et « sauf desserte » : arrêtés locaux, la signalisation fait foi.
 */
export const POLICE_TEXT = 'Restrictions locales (tranches horaires, desserte) : arrêtés du maire, du président du conseil départemental ou du préfet (Code de la route, art. R411-8), la signalisation fait foi.';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const RAD = Math.PI / 180;

// ───────── Lecture des étiquettes ─────────

/** Découpe « a @ (x; y); b @ z » aux « ; » hors parenthèses. */
function splitTop(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const VEHICLE_KEYS = { weight: 'weight', maxweight: 'weight', length: 'length', width: 'width', height: 'height', axleload: 'axleload' };

/**
 * Une condition « Mo-Fr 07:00-19:00 AND weight>7.5 » → { hours, vehicle:[{ key, op, value }], unknown }.
 * unknown : saison, météo, lever du soleil… (non lue : jamais d'alerte, compté « à vérifier »).
 */
export function parseCondition(text) {
  let t = String(text ?? '').trim();
  while (t.startsWith('(') && t.endsWith(')')) t = t.slice(1, -1).trim();
  const out = { hours: null, vehicle: [], unknown: false };
  if (!t) { out.unknown = true; return out; }
  for (const piece of t.split(/\s+AND\s+/i)) {
    const p = piece.trim();
    const v = /^(weight|maxweight|length|width|height|axleload)\s*(>=|<=|>|<)\s*(\d+(?:[.,]\d+)?)\s*(?:t|m)?$/i.exec(p);
    if (v) { out.vehicle.push({ key: VEHICLE_KEYS[v[1].toLowerCase()], op: v[2], value: Number(v[3].replace(',', '.')) }); continue; }
    const h = parseHours(p);
    if (h && !out.hours) { out.hours = h; out.hoursRaw = p; continue; }
    out.unknown = true;
  }
  return out;
}

/** « no @ (Mo-Fr 07:00-19:00); destination @ (Sa) » → [{ value, cond, raw }] ; valeur sans « @ » : ignorée. */
export function parseConditional(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const out = [];
  for (const part of splitTop(text)) {
    const at = part.indexOf('@');
    if (at < 0) continue;
    const value = part.slice(0, at).trim().toLowerCase();
    if (!value) continue;
    out.push({ value, cond: parseCondition(part.slice(at + 1)), raw: part });
  }
  return out;
}

/** Valeur d'accès → 'no' (interdit), 'local' (desserte, livraison, clients) ou 'ok'. */
export function accessClass(value) {
  const v = String(value ?? '').toLowerCase();
  if (v === 'no' || v === 'private' || v === 'restricted' || v === 'military') return 'no';
  if (v === 'destination' || v === 'delivery' || v === 'customers') return 'local';
  return 'ok';
}

/** Condition sur le véhicule : vraie, fausse, ou null (champ du profil non renseigné). */
function vehicleMatch(list, vehicle) {
  let unknown = false;
  for (const c of list) {
    const x = vehicle?.[c.key];
    if (!isNum(x) || !(x > 0)) { unknown = true; continue; }
    const ok = c.op === '>' ? x > c.value : c.op === '>=' ? x >= c.value : c.op === '<' ? x < c.value : x <= c.value;
    if (!ok) return false;
  }
  return unknown ? null : true;
}

const usesHolidays = (h) => !!h && (h.holidaysOff || h.rules.some((r) => r.ph));

/**
 * Une condition s'applique-t-elle ? true / false / null (non lue : saison, PH sans calendrier du pays, profil
 * incomplet).
 * @param {{ date:Date, vehicle:object, holiday:((d:Date)=>boolean)|null }} ctx
 */
export function conditionMatch(cond, { date, vehicle, holiday }) {
  if (!cond || cond.unknown) return null;
  const v = vehicleMatch(cond.vehicle, vehicle);
  if (v === false) return false;
  let h = true;
  if (cond.hours) {
    if (usesHolidays(cond.hours) && !holiday) return null;
    h = hoursActive(cond.hours, date, { holiday: holiday ?? (() => false) });
  }
  if (!h) return false;
  return v === null ? null : true;
}

/** Valeur d'une étiquette selon le sens de passage (« hgv:forward » avant « hgv »). */
const tagFor = (tags, key, dir, suffix = '') => (dir ? tags[`${key}:${dir}${suffix}`] : undefined) ?? tags[`${key}${suffix}`];

/**
 * Accès de la voie pour ce véhicule à cet instant, dans ce sens.
 * @param {object} tags étiquettes OSM gardées (access-convert.js)
 * @param {{ date:Date, vehicle:object, holiday:((d:Date)=>boolean)|null, dir:'forward'|'backward'|null }} ctx
 * @returns {{ state:'no'|'local'|'ok'|'unknown', mode:string|null, value:string|null, kind:'access'|'weight'|null,
 *   item:object|null }}
 */
export function evaluateWay(tags, ctx) {
  const t = tags ?? {};
  let res = { state: 'ok', mode: null, value: null, kind: null, item: null };
  for (const mode of ACCESS.MODES) {
    const items = [
      ...parseConditional(ctx.dir ? t[`${mode}:${ctx.dir}:conditional`] : undefined),
      ...parseConditional(t[`${mode}:conditional`]),
    ];
    let hit = null;
    let unknown = false;
    // Plusieurs conditions vraies : la dernière écrite l'emporte (étiquette du sens de passage d'abord).
    for (const item of items) {
      const m = conditionMatch(item.cond, ctx);
      if (m === null) unknown = true;
      else if (m) hit = item;
    }
    if (hit) { res = { state: accessClass(hit.value), mode, value: hit.value, kind: 'access', item: hit }; break; }
    if (unknown) { res = { state: 'unknown', mode, value: null, kind: 'access', item: null }; break; }
    const base = tagFor(t, mode, ctx.dir);
    if (base !== undefined) { res = { state: accessClass(base), mode, value: String(base), kind: 'access', item: null }; break; }
  }
  if (res.state === 'no' || res.state === 'local') return res;
  // Poids limité par tranche horaire (maxweight:conditional = « 3.5 @ (Mo-Fr 07:00-19:00) »).
  const weight = ctx.vehicle?.weight;
  const wItems = [
    ...parseConditional(ctx.dir ? t[`maxweight:${ctx.dir}:conditional`] : undefined),
    ...parseConditional(t['maxweight:conditional']),
  ];
  let wHit = null;
  let wUnknown = false;
  for (const item of wItems) {
    const limit = Number(String(item.value).replace(',', '.'));
    if (!isNum(limit)) { wUnknown = true; continue; }
    const m = conditionMatch(item.cond, ctx);
    if (m === null) wUnknown = true;
    else if (m) wHit = { ...item, limit };
  }
  if (wHit) {
    if (!isNum(weight)) return { state: 'unknown', mode: 'maxweight', value: null, kind: 'weight', item: wHit };
    if (weight > wHit.limit) return { state: 'no', mode: 'maxweight', value: wHit.value, kind: 'weight', item: wHit };
    return res;
  }
  if (wUnknown && isNum(weight)) return { state: 'unknown', mode: 'maxweight', value: null, kind: 'weight', item: null };
  return res;
}

/**
 * Restrictions qui peuvent concerner ce véhicule sur cette voie (conditions non retenues : moyen de transport masqué
 * par une étiquette sans condition plus précise, véhicule hors condition, poids sous la limite) ; sert à décider
 * si la voie est « signalée » et à écrire ses horaires.
 * @returns {{ restrictive:object[], permissive:object[], unknown:boolean }}
 */
export function wayRestrictions(tags, { vehicle, dir = null } = {}) {
  const t = tags ?? {};
  const out = { restrictive: [], permissive: [], unknown: false };
  for (const mode of ACCESS.MODES) {
    const items = [
      ...parseConditional(dir ? t[`${mode}:${dir}:conditional`] : undefined),
      ...parseConditional(t[`${mode}:conditional`]),
    ];
    for (const item of items) {
      if (item.cond.unknown) { if (accessClass(item.value) !== 'ok') out.unknown = true; continue; }
      if (vehicleMatch(item.cond.vehicle, vehicle) === false) continue;
      (accessClass(item.value) === 'ok' ? out.permissive : out.restrictive).push({ ...item, mode, kind: 'access' });
    }
    if (tagFor(t, mode, dir) !== undefined) break; // étiquette sans condition : les moyens moins précis ne comptent plus
  }
  for (const item of [...parseConditional(dir ? t[`maxweight:${dir}:conditional`] : undefined), ...parseConditional(t['maxweight:conditional'])]) {
    const limit = Number(String(item.value).replace(',', '.'));
    if (!isNum(limit) || item.cond.unknown) { out.unknown = true; continue; }
    if (isNum(vehicle?.weight) && vehicle.weight <= limit) continue;
    if (vehicleMatch(item.cond.vehicle, vehicle) === false) continue;
    out.restrictive.push({ ...item, mode: 'maxweight', kind: 'weight', limit });
  }
  return out;
}

// ───────── Données (data/acces-osm/, écrites par access-convert.js) ─────────

/**
 * Case `E_N.json` → voies { id, name, tags, coords } ; null si illisible.
 * Format : { t:[étiquettes…], n:[noms…], w:[[id, i_t, i_n, x0, y0, dx1, dy1, …]] }, coordonnées en 1e-5 degré,
 * chaque point en écart au précédent.
 */
export function parseAccessTile(json) {
  if (!Array.isArray(json?.w) || !Array.isArray(json?.t)) return null;
  const names = Array.isArray(json.n) ? json.n : [];
  const out = [];
  for (const w of json.w) {
    if (!Array.isArray(w) || w.length < 7 || !w.every((x) => Number.isInteger(x))) continue;
    const tags = json.t[w[1]];
    if (!tags || typeof tags !== 'object' || Array.isArray(tags)) continue;
    const coords = [];
    let x = 0; let y = 0;
    for (let i = 3; i + 1 < w.length; i += 2) {
      x += w[i]; y += w[i + 1];
      coords.push([x / 1e5, y / 1e5]);
    }
    if (coords.length < 2) continue;
    const name = typeof names[w[2]] === 'string' ? names[w[2]].slice(0, 80) : '';
    out.push({ id: `w${w[0]}`, name, tags, coords });
  }
  return out;
}

// ───────── Rapprochement avec le tracé ─────────

/** Points de la voie tous les `step` mètres au plus, avec la longueur que chacun représente. */
function densify(coords, step) {
  const pts = [];
  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = coords[i]; const b = coords[i + 1];
    const kx = Math.cos(((a[1] + b[1]) / 2) * RAD) * 111320;
    const d = Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 110540);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < n; k += 1) {
      const f = (k + 0.5) / n;
      pts.push({ p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], len: d / n });
    }
  }
  return pts;
}

const isOneway = (tags) => (/^(yes|true|1)$/i.test(tags?.oneway ?? '') ? 1 : tags?.oneway === '-1' ? -1 : 0);

/**
 * La voie suit-elle vraiment le tracé ? Au moins 80 % de sa longueur à moins de 15 m, points dans l'ordre du tracé,
 * dans le sens autorisé (sens unique) : une route parallèle, l'autre chaussée d'une 2 × 2 voies ou une route sous un
 * pont ne comptent pas.
 * @returns {{ enter:number, exit:number, dir:'forward'|'backward' }|null}
 */
export function wayAlongRoute(line, grid, way) {
  const pts = densify(way.coords, ACCESS.STEP_M);
  const total = pts.reduce((s, x) => s + x.len, 0);
  if (!(total > 0)) return null;
  let missed = 0;
  const alongs = [];
  for (const { p, len } of pts) {
    const n = nearest(line, grid, p);
    if (!n || n.distance > ACCESS.MATCH_M) {
      missed += len;
      if (missed > total * (1 - ACCESS.MATCH_SHARE)) return null;
      continue;
    }
    alongs.push(n.along);
  }
  if (alongs.length < 2) return null;
  const up = alongs.every((a, i) => i === 0 || a >= alongs[i - 1] - 5);
  const down = alongs.every((a, i) => i === 0 || a <= alongs[i - 1] + 5);
  if (up === down) return null; // désordre (lacet, demi-tour) ou un seul point
  const dir = up ? 'forward' : 'backward';
  const one = isOneway(way.tags);
  if ((one === 1 && dir === 'backward') || (one === -1 && dir === 'forward')) return null; // autre chaussée
  return { enter: Math.min(...alongs), exit: Math.max(...alongs), dir };
}

/** Jour férié du pays traversé (holidays.js), ou null si le calendrier du pays n'est pas connu. */
export function holidayFor(code) {
  if (typeof code !== 'string' || !countryHolidays(code, 2026).size) return null;
  return (d) => countryHolidayName(code, d) !== null;
}

/**
 * Voies conditionnelles de la copie que l'itinéraire suit, évaluées à l'heure de passage.
 * @param {object} route itinéraire (coordinates, steps, duration, countries)
 * @param {{ ways:object[], vehicle:object, departure?:Date, elapsed?:(t:number)=>number,
 *   countryAt?:(along:number)=>string|null }} ctx
 *   countryAt : pays à cette distance (countryinfo d'ORS) ; null → France
 * @returns {{ passages:object[], unknown:number }} passages triés depuis le départ :
 *   { id, name, enter, exit, at, time, state:'no'|'local'|'ok', restrictive, permissive, hit }
 */
export function conditionalAlongRoute(route, { ways = [], vehicle = null, departure = new Date(), elapsed = (t) => t, countryAt = null } = {}) {
  const out = { passages: [], unknown: 0 };
  if (!Array.isArray(route?.coordinates) || route.coordinates.length < 2 || !ways?.length) return out;
  const line = prepareLine(route.coordinates);
  const grid = indexLine(line);
  const CELL = 0.01;
  const near = (p) => grid.has(`${Math.floor(p[0] / CELL)}:${Math.floor(p[1] / CELL)}`);
  const seen = new Set();
  for (const way of ways) {
    if (seen.has(way.id)) continue;
    seen.add(way.id);
    const c = way.coords;
    if (!near(c[0]) && !near(c[c.length - 1]) && !near(c[Math.floor(c.length / 2)])) continue;
    const pass = wayAlongRoute(line, grid, way);
    if (!pass) continue;
    const r = wayRestrictions(way.tags, { vehicle, dir: pass.dir });
    if (!r.restrictive.length) {
      if (r.unknown) out.unknown += 1;
      continue;
    }
    const time = elapsed(timeAt(route, line, pass.enter));
    const at = new Date(departure.getTime() + time * 1000);
    const code = countryAt ? countryAt(pass.enter) : 'FR';
    const holiday = holidayFor(code ?? 'FR');
    const ev = evaluateWay(way.tags, { date: at, vehicle, holiday, dir: pass.dir });
    if (ev.state === 'unknown') { out.unknown += 1; continue; }
    out.passages.push({
      id: way.id, name: way.name, enter: pass.enter, exit: pass.exit, dir: pass.dir, time, at, state: ev.state,
      hit: ev, restrictive: r.restrictive, permissive: r.permissive, tags: way.tags, country: code ?? 'FR', holiday,
      mid: pointAt(line, (pass.enter + pass.exit) / 2).point,
    });
  }
  out.passages.sort((a, b) => a.enter - b.enter);
  return out;
}

// ───────── Textes ─────────

const km = (m) => `km ${Math.round(m / 1000)}`;
const hhmm = (d) => `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (x) => String(x).replace('.', ',');

/** Nom affiché : nom OSM, sinon « Voie sans nom ». */
export const wayName = (p) => p.name || 'Voie sans nom';

const WHO = { hgv: 'aux PL', motor_vehicle: 'aux véhicules à moteur', vehicle: 'aux véhicules', access: 'à la circulation' };

/** Une condition en français : « lun. mar. … 7 h–19 h », « plus de 7,5 t ». */
function condText(item) {
  const parts = [];
  for (const v of item.cond.vehicle) {
    const unit = v.key === 'weight' || v.key === 'axleload' ? 't' : 'm';
    parts.push(`${v.op.startsWith('>') ? 'plus de' : 'moins de'} ${num(v.value)} ${unit}${v.key === 'axleload' ? ' par essieu' : ''}`);
  }
  if (item.cond.hours) parts.push(hoursText(item.cond.hours, item.cond.hoursRaw));
  return parts.join(', ');
}

/** Une restriction en français : « interdite aux PL lun. … 7 h–19 h », « limitée à 3,5 t … ». */
function itemText(item) {
  if (item.kind === 'weight') return `limitée à ${num(item.limit)} t ${condText(item)}`;
  const what = accessClass(item.value) === 'local' ? `réservée à la desserte locale${item.value === 'delivery' ? ' (livraisons)' : ''}` : 'interdite';
  return `${what} ${WHO[item.mode] ?? ''} ${condText(item)}`.replace(/\s+/g, ' ').trim();
}

/** Horaires de la voie : restrictions, puis exceptions (« sauf PL … »). */
export function restrictionText(p) {
  const r = p.restrictive.map(itemText).join(' ; ');
  const ok = p.permissive.filter((i) => i.mode === 'hgv').map((i) => condText(i)).filter(Boolean);
  return ok.length ? `${r} (PL autorisés ${ok.join(', ')})` : r;
}

/** Fiche : voie suivie par l'itinéraire, restriction en vigueur ou non à l'heure de passage. */
export function describeConditional(p) {
  const when = `vous y seriez vers ${km(p.enter)} (vers ${hhmm(p.at)})`;
  const state = p.state === 'ok' ? 'pas en vigueur à votre passage' : 'en vigueur à votre passage';
  return `${wayName(p)} ${restrictionText(p)} : ${when}, ${state}. ${capital(ACCESS.SIGNAGE)}.`;
}

/** Aucune voie signalée : jamais « aucune restriction ». */
export function noConditionalText(updated) {
  const d = copyDateText(updated);
  return `Aucune restriction horaire signalée dans les données${d ? ` (copie du ${d.slice(0, 5)})` : ''}, ${ACCESS.SIGNAGE}.`;
}

/** Une seule ligne pour les conditions non lues (saison, météo…) : jamais d'alerte. */
export const unknownText = (n) => `${n} ${n > 1 ? 'voies' : 'voie'} avec conditions non lues, à vérifier.`;

/** Morceaux du tracé hors de la zone copiée : non vérifiés. */
export const UNCOVERED_TEXT = 'Restrictions horaires non vérifiées sur une partie du trajet (hors de la zone copiée), la signalisation fait foi.';

// ───────── Guidage ─────────

const distText = (m) => (m >= 1000 ? `${(Math.round(m / 100) / 10).toString().replace('.', ',')} km` : `${Math.round(m)} m`);

/**
 * Voies conditionnelles devant : bandeau sous 10 km (d'abord la plus proche interdite à l'heure où on y sera) ; voix
 * une fois vers 3 km seulement si la voie est interdite à cette heure (heure de la tablette + temps restant).
 * @param {object[]} passages conditionalAlongRoute().passages
 * @param {{ along:number, now:number, timeTo:(along:number)=>number, vehicle:object }} ctx timeTo en s
 * @returns {{ view:{ name, distance, text, forbidden }|null, speak:string|null, announced:object }}
 */
export function guidanceConditional(passages, announced = {}, { along, now, timeTo, vehicle }) {
  const ahead = (passages ?? []).filter((p) => p.exit >= along);
  const evalAt = (p) => evaluateWay(p.tags, {
    date: new Date(now + Math.max(0, timeTo(p.enter)) * 1000), vehicle, holiday: p.holiday, dir: p.dir,
  });
  const isForbidden = (ev) => ev.state === 'no' || ev.state === 'local';
  // Voix : chaque voie interdite à l'heure où on y sera, une fois vers 3 km (même si une autre voie est plus proche).
  const out = { ...announced };
  let speak = null;
  for (const p of ahead) {
    const d = p.enter - along;
    const key = `${p.id}:${Math.round(p.enter)}`;
    if (out[key] || d > ACCESS.ANNOUNCE_M || d < ACCESS.ANNOUNCE_MIN_M) continue;
    const ev = evalAt(p);
    if (!isForbidden(ev)) continue;
    out[key] = true;
    speak = `Attention, dans ${Math.round(d / 1000)} kilomètres, ${wayName(p).toLowerCase()} ${ev.state === 'local' ? 'réservée à la desserte locale' : 'interdite aux poids lourds'} à cette heure. Suivez la signalisation.`;
    break;
  }
  // Bandeau : sous 10 km, la voie interdite à l'heure de passage la plus proche, sinon la voie la plus proche.
  const near = ahead.filter((p) => p.enter - along <= ACCESS.BANNER_M).map((p) => ({ p, ev: evalAt(p) }));
  if (!near.length) return { view: null, speak, announced: out };
  const { p: next, ev } = near.find((x) => isForbidden(x.ev)) ?? near[0];
  const distance = Math.max(0, next.enter - along);
  const forbidden = isForbidden(ev);
  const head = distance > 0 ? `${wayName(next)} dans ${distText(distance)}` : wayName(next);
  const what = ev.state === 'unknown' ? 'horaires à vérifier' : forbidden ? `${ev.state === 'local' ? 'desserte locale' : 'interdite'} à votre passage` : 'hors tranche à votre passage';
  return { view: { name: wayName(next), distance, forbidden, text: `${head} : ${what} · ${ACCESS.SIGNAGE}` }, speak, announced: out };
}
