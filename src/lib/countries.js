// Pays traversés par un itinéraire (phase 5c) : extra « countryinfo » d'ORS, segments par pays, frontières avec le km
// et l'heure de passage. Logique pure.
//
// Source ORS (lue le 20/11/2026 sur raw.githubusercontent.com/GIScience/openrouteservice) :
// - docs/api-reference/endpoints/directions/extra-info/index.md : `countryinfo` disponible pour driving-hgv, réponse
//   dans `extras.countryinfo` ({ values:[[début, fin, id]], summary }) ;
// - docs/technical-details/country-list.md : identifiants des pays (France 70, Belgique 17, Luxembourg 117,
//   Allemagne 74, Suisse 193, Italie 97, Espagne 187…) ; 75 « Germany - Belgium » et 141 « Netherlands - Belgium »
//   sont des zones partagées : rattachées au pays voisin sur le tracé ;
// - ors-engine/…/ExtraInfoProcessor.java : extra absent du graphe → avertissement « skipped extras » et pas de
//   `countryinfo` ; morceaux sans pays (id 0) non écrits (trous comblés par les voisins) ;
// - ors-engine/…/RouteResultBuilder.java : avec alternative_routes, chaque itinéraire a ses propres extras.
// La même requête sert aux variantes (phase 2b) et au recalcul en guidage : aucune requête en plus.

import { prepareLine } from './nav-geo.js';
import { timeAt } from './areas-route.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Identifiant ORS → code ISO. 75 et 141 (zones partagées) : null, rattachés au voisin. */
export const ORS_COUNTRIES = Object.freeze({
  70: 'FR', 17: 'BE', 117: 'LU', 74: 'DE', 193: 'CH', 97: 'IT', 187: 'ES', 130: 'MC', 4: 'AD', 11: 'AT', 115: 'LI',
  200: 'NL', 75: null, 141: null,
});

export const COUNTRY_NAMES = Object.freeze({
  FR: 'France', BE: 'Belgique', LU: 'Luxembourg', DE: 'Allemagne', CH: 'Suisse', IT: 'Italie', ES: 'Espagne',
  MC: 'Monaco', AD: 'Andorre', AT: 'Autriche', LI: 'Liechtenstein', NL: 'Pays-Bas',
});

/** Article devant le nom (« en Suisse », « au Luxembourg », « aux Pays-Bas »). */
const IN_COUNTRY = Object.freeze({
  LU: 'au Luxembourg', NL: 'aux Pays-Bas', LI: 'au Liechtenstein',
});

export const COUNTRIES = Object.freeze({
  UNAVAILABLE_TEXT: 'Pays traversés indisponibles (information absente de la réponse d\'OpenRouteService) : vérifie les règles des pays traversés ; la signalisation fait foi.',
});

export function countryName(code) {
  return COUNTRY_NAMES[code] ?? (typeof code === 'string' && code.startsWith('#') ? `pays n° ${code.slice(1)}` : String(code));
}

export function inCountry(code) {
  return IN_COUNTRY[code] ?? `en ${countryName(code)}`;
}

/**
 * Extra « countryinfo » d'une réponse ORS → morceaux [{ from, to, code }] (indices de la géométrie), voisins du même
 * pays réunis. null si l'extra manque ou ne contient rien de lisible (→ « Pays traversés indisponibles »).
 */
export function parseCountryInfo(extras) {
  const values = extras?.countryinfo?.values;
  if (!Array.isArray(values) || !values.length) return null;
  const raw = [];
  for (const v of values) {
    if (!Array.isArray(v) || v.length < 3 || !Number.isInteger(v[0]) || !Number.isInteger(v[1]) || !isNum(v[2])) continue;
    if (v[1] < v[0]) continue;
    const id = Math.round(v[2]);
    const code = Object.prototype.hasOwnProperty.call(ORS_COUNTRIES, id) ? ORS_COUNTRIES[id] : `#${id}`;
    raw.push({ from: v[0], to: v[1], code });
  }
  if (!raw.length) return null;
  raw.sort((a, b) => a.from - b.from);
  // Zones partagées (null) : pays précédent, sinon suivant.
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i].code !== null) continue;
    const prev = raw.slice(0, i).reverse().find((r) => r.code !== null);
    const next = raw.slice(i + 1).find((r) => r.code !== null);
    raw[i].code = prev?.code ?? next?.code ?? null;
  }
  const out = [];
  for (const r of raw) {
    if (r.code === null) continue;
    const last = out[out.length - 1];
    if (last && last.code === r.code) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out.length ? out : null;
}

/**
 * Pays traversés, dans l'ordre, avec la distance et l'heure d'entrée et de sortie.
 * @param {object} route itinéraire (parseDirections : coordinates, steps, countries)
 * @param {{ departure?:Date, elapsed?:(t:number)=>number }} ctx elapsed : pauses conseillées comprises (breakSchedule)
 * @returns {{ ok:boolean, segments:{ code:string, name:string, enter:number, exit:number, enterTime:Date,
 *   exitTime:Date, prev:string|null, next:string|null }[], crossings:{ from:string, to:string, along:number,
 *   time:Date }[] }}
 */
export function countriesAlongRoute(route, { departure = new Date(), elapsed = (t) => t } = {}) {
  const parts = route?.countries;
  if (!Array.isArray(parts) || !parts.length || !Array.isArray(route?.coordinates) || route.coordinates.length < 2) {
    return { ok: false, segments: [], crossings: [] };
  }
  const line = prepareLine(route.coordinates);
  const last = route.coordinates.length - 1;
  const at = (i) => line.cum[Math.max(0, Math.min(last, i))] ?? 0;
  const dateAt = (along) => new Date(departure.getTime() + elapsed(timeAt(route, line, along)) * 1000);
  const segments = parts.map((p, i) => {
    // Frontière au milieu d'un trou éventuel entre deux morceaux ; premier et dernier morceaux jusqu'aux extrémités.
    const enter = i === 0 ? 0 : (at(parts[i - 1].to) + at(p.from)) / 2;
    const exit = i === parts.length - 1 ? line.total : (at(p.to) + at(parts[i + 1].from)) / 2;
    return {
      code: p.code, name: countryName(p.code), enter, exit, enterTime: dateAt(enter), exitTime: dateAt(exit),
      prev: i > 0 ? parts[i - 1].code : null, next: i < parts.length - 1 ? parts[i + 1].code : null,
    };
  });
  const crossings = segments.slice(1).map((s, i) => ({ from: segments[i].code, to: s.code, along: s.enter, time: s.enterTime }));
  return { ok: true, segments, crossings };
}
