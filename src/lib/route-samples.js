// Points régulièrement espacés le long d'un itinéraire, avec l'heure de passage estimée et la route empruntée
// (phase 5 : ZFE, interdictions PL). Logique pure.

import { prepareLine, pointAt } from './nav-geo.js';
import { timeAt } from './areas-route.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * Références de route d'un nom d'étape ORS (« A 6a, E 15 » → ['A6A', 'E15'] ; « RD 1084 » → ['D1084']).
 * Les routes départementales et nationales s'écrivent « D 306 », « N 90 » dans OpenStreetMap ; les arrêtés
 * écrivent aussi « RD 306 », « RN 90 » : les deux formes donnent la même référence.
 */
export function roadRefs(name) {
  if (typeof name !== 'string' || !name) return [];
  const out = [];
  for (const m of name.matchAll(/(?:^|[^A-Za-z0-9])(RN|RD|A|N|D|M|E)\s?(\d{1,4})(?:\s?([A-Za-z])(?![A-Za-z]))?/g)) {
    const prefix = m[1] === 'RN' ? 'N' : m[1] === 'RD' ? 'D' : m[1];
    const ref = `${prefix}${Number(m[2])}${m[3] ? m[3].toUpperCase() : ''}`;
    if (!out.includes(ref)) out.push(ref);
  }
  return out;
}

/**
 * @param {{ coordinates:number[][], steps?:{ name?:string, wayPoints?:number[], duration?:number }[], duration?:number }} route
 * @param {number} stepM écart entre deux points (m)
 * @returns {{ along:number, lonlat:number[], time:number, roads:string[], index:number }[]}
 *   time : secondes depuis le départ ; roads : références de la route (étape ORS en cours) ;
 *   index : segment du tracé
 */
export function sampleRoute(route, stepM = 200) {
  if (!Array.isArray(route?.coordinates) || route.coordinates.length < 2) return [];
  const line = prepareLine(route.coordinates);
  const steps = (Array.isArray(route.steps) ? route.steps : []).filter((s) => Array.isArray(s?.wayPoints));
  const refs = steps.map((s) => roadRefs(s.name));
  const out = [];
  const total = line.total;
  const n = Math.max(1, Math.ceil(total / stepM));
  let si = 0;
  for (let k = 0; k <= n; k += 1) {
    const along = Math.min(total, k * (total / n));
    const at = pointAt(line, along);
    while (si < steps.length - 1 && isNum(line.cum[steps[si].wayPoints[1]]) && line.cum[steps[si].wayPoints[1]] < along) si += 1;
    out.push({ along, lonlat: at.point, time: timeAt(route, line, along), roads: refs[si] ?? [], index: at.segIndex ?? 0 });
  }
  return out;
}
