// Moteur de navigation guidée. Logique pure : chaque position GPS (réelle ou simulée) passe par
// updateNavigation(state, fix), qui renvoie le nouvel état, ce qu'il faut afficher et les événements
// (phrase à dire, recalcul à lancer, arrivée). L'interface (src/ui/navigation.js) ne décide rien d'autre.
//
// Position (fix) : { lon, lat, accuracy (m), speed (m/s ou null), heading (degrés ou null), timestamp (ms) },
// comme GeolocationPosition.coords (heading vaut null à l'arrêt, speed peut être null :
// https://developer.mozilla.org/docs/Web/API/GeolocationCoordinates).

import { prepareLine, locateOnLine, segmentBearing, bearing as bearingTo, haversine } from './nav-geo.js';
import {
  buildManeuvers, nextManeuver, stageToAnnounce, announcementText, arrivedText, maneuverText, maneuverIcon,
  firstManeuverIndex, isDepart, STEP_TYPES, UTURN_SAFE_TEXT, THEN_MAX_GAP_M,
} from './nav-guidance.js';
import { ERROR_KINDS } from './ors-errors.js';

export const NAV = Object.freeze({
  /** Inclinaison de la carte en guidage (MapLibre accepte 0 à 60° par défaut). */
  PITCH: 50,
  /** En dessous (≈ 7 km/h), le cap GPS n'est pas fiable : on garde le précédent. */
  MIN_MOVING_SPEED: 2,
  /** Hors itinéraire : écart au tracé > 50 m + précision GPS (plafonnée à 50 m)… */
  OFF_ROUTE_BASE_M: 50,
  OFF_ROUTE_ACCURACY_CAP_M: 50,
  /** …sur au moins 3 positions et 5 s. Les positions moins précises que 100 m ne comptent pas. */
  OFF_ROUTE_FIXES: 3,
  OFF_ROUTE_MS: 5000,
  MAX_ACCURACY_M: 100,
  /** Au plus un recalcul toutes les 30 s (quota gratuit HeiGIT : 2 000 itinéraires/jour, 40/min). */
  REROUTE_COOLDOWN_MS: 30000,
  /** Arrivée à 50 m de la destination ; aucun recalcul à moins de 150 m (entrée de dépôt souvent à côté du point). */
  ARRIVAL_RADIUS_M: 50,
  NO_REROUTE_NEAR_DEST_M: 150,
  /** Évite une fausse arrivée quand l'itinéraire longe la destination avant d'y revenir (boucle). */
  ARRIVAL_MAX_REMAINING_M: 250,
  /** Signal GPS perdu au bout de 10 s sans position. */
  GPS_LOST_MS: 10000,
  /** Lissage de la vitesse (moyenne exponentielle) pour le zoom et les annonces. */
  SPEED_SMOOTHING: 0.5,
});

/** Zoom de la carte selon la vitesse (km/h → niveau MapLibre), interpolé entre ces points. */
export const ZOOM_BY_SPEED = Object.freeze([[0, 17], [30, 16.5], [50, 16], [70, 15.5], [90, 15], [110, 14.5]]);

/** Échecs de recalcul inutiles à réessayer (clé ou quota) : on arrête de redemander. */
const FATAL_REROUTE_ERRORS = new Set([
  ERROR_KINDS.NO_KEY, ERROR_KINDS.INVALID_KEY, ERROR_KINDS.DAILY_QUOTA, ERROR_KINDS.KEY_OR_QUOTA,
]);

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function zoomForSpeed(kmh) {
  const v = isNum(kmh) && kmh > 0 ? kmh : 0;
  const t = ZOOM_BY_SPEED;
  if (v <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i += 1) {
    if (v <= t[i][0]) {
      const [s0, z0] = t[i - 1];
      const [s1, z1] = t[i];
      return z0 + ((v - s0) / (s1 - s0)) * (z1 - z0);
    }
  }
  return t[t.length - 1][1];
}

/** Convertit une GeolocationPosition en position du moteur. */
export function fixFromPosition(pos) {
  const c = pos?.coords ?? {};
  return {
    lon: c.longitude,
    lat: c.latitude,
    accuracy: isNum(c.accuracy) ? c.accuracy : null,
    speed: isNum(c.speed) && c.speed >= 0 ? c.speed : null,
    heading: isNum(c.heading) ? c.heading : null,
    timestamp: isNum(pos?.timestamp) ? pos.timestamp : null,
  };
}

/** Itinéraire (lu par parseDirections) prêt pour le guidage. */
export function prepareRoute(route) {
  const line = prepareLine(route.coordinates);
  return {
    line,
    maneuvers: buildManeuvers(route.steps, line.cum),
    duration: isNum(route.duration) ? route.duration : 0,
    end: line.coords[line.coords.length - 1],
  };
}

/** Temps restant (s) : durées ORS des étapes, au prorata de ce qui reste de l'étape en cours. */
export function remainingDuration(prepared, along) {
  const { cum, total } = prepared.line;
  let sum = 0;
  let counted = false;
  for (const m of prepared.maneuvers) {
    const a = cum[m.startIndex];
    const b = cum[m.endIndex];
    if (!(b - a > 0) || !(m.duration > 0)) continue;
    counted = true;
    if (b <= along) continue;
    sum += m.duration * (a >= along ? 1 : (b - along) / (b - a));
  }
  if (!counted) return total > 0 ? prepared.duration * Math.max(0, total - along) / total : 0;
  return sum;
}

function goalOf(prepared) {
  return prepared.maneuvers.find((m) => m.type === STEP_TYPES.GOAL) ?? null;
}

/** Si la première manœuvre est un demi-tour : phrase prudente, dite une seule fois. */
function uturnCheck(prepared) {
  const i = firstManeuverIndex(prepared.maneuvers);
  return i >= 0 && prepared.maneuvers[i].type === STEP_TYPES.UTURN ? i : -1;
}

/**
 * Démarre le guidage.
 * @param {object} route itinéraire lu par parseDirections
 * @param {{ destination?:number[]|null, now?:number }} opts destination choisie [lon, lat] (peut être hors route)
 */
export function startNavigation(route, { destination = null, now = 0 } = {}) {
  return {
    route: prepareRoute(route),
    destination: Array.isArray(destination) && destination.every(isNum) ? destination : null,
    segIndex: null,
    lastFix: null,
    lastFixAt: null,
    startedAt: now,
    speed: null,
    bearing: null,
    announced: {},
    started: false,
    uturnIndex: -1,
    offCount: 0,
    offSince: null,
    rerouting: false,
    lastRerouteAt: null,
    rerouteBlocked: false,
    failNotified: false,
    arrived: false,
  };
}

/**
 * Traite une position.
 * @returns {{ state:object, view:object|null, events:{type:'speak'|'reroute'|'arrived', text?:string, interrupt?:boolean, from?:number[]}[] }}
 */
export function updateNavigation(state, fix) {
  if (!fix || !isNum(fix.lon) || !isNum(fix.lat)) return { state, view: null, events: [] };
  const s = { ...state, announced: { ...state.announced } };
  const events = [];
  const { line, maneuvers } = s.route;
  const p = [fix.lon, fix.lat];
  const t = isNum(fix.timestamp) ? fix.timestamp : (s.lastFixAt ?? s.startedAt) + 1000;

  // Vitesse : celle du GPS, sinon calculée entre deux positions ; lissée.
  let raw = isNum(fix.speed) && fix.speed >= 0 ? fix.speed : null;
  const dt = s.lastFixAt !== null ? (t - s.lastFixAt) / 1000 : 0;
  if (raw === null && s.lastFix && dt > 0 && dt <= 10) raw = haversine(s.lastFix, p) / dt;
  if (raw !== null) s.speed = s.speed === null ? raw : s.speed + NAV.SPEED_SMOOTHING * (raw - s.speed);
  const speed = s.speed ?? 0;

  const loc = locateOnLine(line, p, s.segIndex);
  s.segIndex = loc.segIndex;
  const accuracy = isNum(fix.accuracy) && fix.accuracy >= 0 ? fix.accuracy : 0;
  const reliable = accuracy <= NAV.MAX_ACCURACY_M;
  const threshold = NAV.OFF_ROUTE_BASE_M + Math.min(accuracy, NAV.OFF_ROUTE_ACCURACY_CAP_M);
  const onRoute = loc.distance <= threshold;
  const remaining = Math.max(0, line.total - loc.along);
  const toDest = Math.min(haversine(p, s.route.end), s.destination ? haversine(p, s.destination) : Infinity);

  // Cap : GPS en mouvement, sinon direction du déplacement, sinon le précédent, sinon celui de la route.
  const moving = speed >= NAV.MIN_MOVING_SPEED;
  let heading;
  if (moving && isNum(fix.heading)) heading = fix.heading;
  else if (moving && s.lastFix && haversine(s.lastFix, p) >= 5) heading = bearingTo(s.lastFix, p);
  else if (s.bearing !== null) heading = s.bearing;
  else heading = segmentBearing(line, loc.segIndex);
  s.bearing = heading;
  s.lastFix = p;
  s.lastFixAt = t;

  // Arrivée.
  if (!s.arrived && toDest <= NAV.ARRIVAL_RADIUS_M && (!onRoute || remaining <= NAV.ARRIVAL_MAX_REMAINING_M)) {
    s.arrived = true;
    events.push({ type: 'speak', text: arrivedText(goalOf(s.route)), interrupt: true }, { type: 'arrived' });
  }

  // Hors itinéraire → recalcul (jamais près de la destination ni après l'arrivée).
  if (s.arrived || toDest < NAV.NO_REROUTE_NEAR_DEST_M || onRoute) {
    s.offCount = 0;
    s.offSince = null;
  } else if (reliable) {
    s.offCount += 1;
    if (s.offSince === null) s.offSince = t;
    const cooled = s.lastRerouteAt === null || t - s.lastRerouteAt >= NAV.REROUTE_COOLDOWN_MS;
    if (!s.rerouting && !s.rerouteBlocked && cooled
      && s.offCount >= NAV.OFF_ROUTE_FIXES && t - s.offSince >= NAV.OFF_ROUTE_MS) {
      s.rerouting = true;
      s.lastRerouteAt = t;
      events.push({ type: 'reroute', from: p, bearing: heading });
    }
  }

  // Annonces (seulement sur l'itinéraire, pas pendant un recalcul).
  if (!s.started) {
    s.started = true;
    s.uturnIndex = uturnCheck(s.route);
    if (s.uturnIndex >= 0) {
      s.announced[s.uturnIndex] = 'now';
      events.push({ type: 'speak', text: `${UTURN_SAFE_TEXT}.` });
    } else if (maneuvers[0] && isDepart(maneuvers[0], 0) && maneuvers[0].instruction) {
      events.push({ type: 'speak', text: `${maneuverText(maneuvers[0])}.` });
    }
  }
  const nm = nextManeuver(maneuvers, loc.along);
  if (nm && !s.arrived && onRoute && !s.rerouting) {
    const m = maneuvers[nm.index];
    const stage = stageToAnnounce(nm.distance, speed, s.announced[nm.index] ?? null, m.type === STEP_TYPES.GOAL);
    if (stage) {
      s.announced[nm.index] = stage;
      events.push({
        type: 'speak',
        interrupt: stage === 'now',
        text: announcementText({
          maneuver: m, stage, distance: nm.distance, uturnSafe: nm.index === s.uturnIndex,
          then: nm.then !== null ? maneuvers[nm.then] : null, thenGap: nm.thenGap,
        }),
      });
    }
  }

  const view = {
    position: onRoute ? loc.point : p,
    rawPosition: p,
    accuracy: isNum(fix.accuracy) ? fix.accuracy : null,
    bearing: heading,
    zoom: zoomForSpeed(speed * 3.6),
    pitch: NAV.PITCH,
    speedKmh: speed * 3.6,
    onRoute,
    distanceFromRoute: loc.distance,
    maneuver: null,
    then: null,
    remainingDistance: s.arrived ? 0 : remaining,
    remainingDuration: s.arrived ? 0 : remainingDuration(s.route, loc.along),
    arrived: s.arrived,
    rerouting: s.rerouting,
    rerouteBlocked: s.rerouteBlocked,
  };
  if (nm) {
    const m = maneuvers[nm.index];
    view.maneuver = {
      index: nm.index,
      type: m.type,
      text: maneuverText(m, { uturnSafe: nm.index === s.uturnIndex }),
      name: m.name,
      exitNumber: m.exitNumber,
      distance: nm.distance,
      icon: maneuverIcon(m.type, m.exitNumber),
    };
    if (nm.then !== null && nm.thenGap <= THEN_MAX_GAP_M) {
      const n = maneuvers[nm.then];
      view.then = { text: maneuverText(n), icon: maneuverIcon(n.type, n.exitNumber), gap: nm.thenGap };
    }
  }
  return { state: s, view, events };
}

/** Le signal GPS est-il perdu (aucune position depuis GPS_LOST_MS) ? */
export function gpsLost(state, now) {
  const ref = state.lastFixAt ?? state.startedAt;
  return isNum(now) && isNum(ref) && now - ref > NAV.GPS_LOST_MS;
}

/** Nouvel itinéraire reçu après un recalcul. */
export function rerouteDone(state, route) {
  const s = {
    ...state,
    route: prepareRoute(route),
    segIndex: null,
    announced: {},
    started: true,
    offCount: 0,
    offSince: null,
    rerouting: false,
    failNotified: false,
  };
  s.uturnIndex = uturnCheck(s.route);
  let text = 'Itinéraire recalculé.';
  if (s.uturnIndex >= 0) {
    s.announced[s.uturnIndex] = 'now';
    text += ` ${UTURN_SAFE_TEXT}.`;
  }
  return { state: s, events: [{ type: 'speak', text, interrupt: true }] };
}

/**
 * Échec du recalcul. Réseau, serveur, point introuvable : nouvel essai après le délai.
 * Clé refusée ou quota du jour : plus de recalcul pendant ce guidage.
 */
export function rerouteFailed(state, kind) {
  const s = { ...state, rerouting: false };
  if (FATAL_REROUTE_ERRORS.has(kind)) s.rerouteBlocked = true;
  const events = [];
  if (!s.failNotified) {
    s.failNotified = true;
    events.push({ type: 'speak', text: 'Recalcul impossible. Rejoignez l’itinéraire dès que possible.' });
  }
  return { state: s, events };
}
