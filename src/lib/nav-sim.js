// Simulation de trajet : fausse position GPS qui avance le long de l'itinéraire à vitesse constante.
// Logique pure. Les positions produites ont la même forme que fixFromPosition (navigation.js) et passent
// par le même moteur de navigation que le vrai GPS. Sert à tester voix, flèches, zoom, recalcul et arrivée
// sans rouler (véhicule à l'arrêt).

import { prepareLine, pointAt, destinationPoint, normalizeBearing } from './nav-geo.js';

export const SIM_SPEEDS = Object.freeze([30, 50, 90]);
export const SIM_DEFAULT_SPEED = 50;
/** « Sortir de la route » : on part de biais (60° à droite de la route)… */
export const SIM_OFFROAD_ANGLE = 60;
/** …sur 400 m au plus, puis on attend le nouvel itinéraire. */
export const SIM_OFFROAD_MAX_M = 400;
export const SIM_ACCURACY_M = 5;
/** Pas de temps maximal (onglet en pause, etc.) pour éviter les sauts. */
export const SIM_MAX_STEP_S = 5;

export function isSimSpeed(kmh) {
  return SIM_SPEEDS.includes(kmh);
}

/**
 * @param {number[][]} coordinates tracé de l'itinéraire [lon, lat]
 * @param {{ speedKmh?:number }} opts
 */
export function createSimulator(coordinates, { speedKmh = SIM_DEFAULT_SPEED } = {}) {
  let line = prepareLine(coordinates);
  let speed = isSimSpeed(speedKmh) ? speedKmh : SIM_DEFAULT_SPEED;
  let along = 0;
  let mode = 'route'; // 'route' | 'offroad' | 'parked'
  let off = null;
  let lastTime = null;

  return {
    /** Position à l'instant now (ms). Le premier appel donne le départ. */
    next(now) {
      const dt = lastTime === null ? 0 : Math.min(SIM_MAX_STEP_S, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      const v = speed / 3.6;
      let point;
      let heading = null;
      let moving = false;
      if (mode === 'route') {
        along = Math.min(line.total, along + v * dt);
        const at = pointAt(line, along);
        point = at.point;
        if (along >= line.total) mode = 'parked';
        else {
          moving = true;
          heading = at.bearing;
        }
      } else if (mode === 'offroad') {
        off.traveled = Math.min(SIM_OFFROAD_MAX_M, off.traveled + v * dt);
        point = destinationPoint(off.origin, off.bearing, off.traveled);
        moving = off.traveled < SIM_OFFROAD_MAX_M;
        heading = moving ? off.bearing : null;
      } else {
        point = line.coords[line.coords.length - 1];
      }
      return {
        lon: point[0],
        lat: point[1],
        accuracy: SIM_ACCURACY_M,
        speed: moving ? v : 0,
        heading,
        timestamp: now,
      };
    },
    /** Change la vitesse (30, 50 ou 90 km/h). */
    setSpeed(kmh) {
      if (!isSimSpeed(kmh)) return false;
      speed = kmh;
      return true;
    },
    get speedKmh() {
      return speed;
    },
    get mode() {
      return mode;
    },
    get along() {
      return along;
    },
    /** Quitte la route (pour déclencher un recalcul). Sans effet hors de l'itinéraire ou à l'arrivée. */
    leaveRoad() {
      if (mode !== 'route') return false;
      const at = pointAt(line, along);
      off = { origin: at.point, bearing: normalizeBearing(at.bearing + SIM_OFFROAD_ANGLE), traveled: 0 };
      mode = 'offroad';
      return true;
    },
    /** Reprend sur le nouvel itinéraire (après recalcul), depuis son départ. */
    setRoute(coords) {
      line = prepareLine(coords);
      along = 0;
      off = null;
      mode = 'route';
    },
  };
}
