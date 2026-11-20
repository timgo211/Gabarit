// Moteur de navigation guidée. Logique pure : chaque position GPS (réelle ou simulée) passe par
// updateNavigation(state, fix), qui renvoie le nouvel état, ce qu'il faut afficher et les événements
// (phrase à dire, recalcul à lancer, arrivée). L'interface (src/ui/navigation.js) ne décide rien d'autre.
//
// Position (fix) : { lon, lat, accuracy (m), speed (m/s ou null), heading (degrés ou null), timestamp (ms) },
// comme GeolocationPosition.coords (heading vaut null à l'arrêt, speed peut être null :
// https://developer.mozilla.org/docs/Web/API/GeolocationCoordinates).

import { prepareLine, locateOnLine, segmentBearing, bearing as bearingTo, haversine, pointAt } from './nav-geo.js';
import {
  buildManeuvers, nextManeuver, stageToAnnounce, announcementText, arrivedText, maneuverText, maneuverIcon,
  firstManeuverIndex, isDepart, STEP_TYPES, UTURN_SAFE_TEXT, THEN_MAX_GAP_M, currentRoadName,
} from './nav-guidance.js';
import { ERROR_KINDS } from './ors-errors.js';
import { placeAlongRoute, nextAreas, areaToAnnounce, announceAreaText } from './areas-route.js';
import { zfeAlongRoute, guidanceZfe } from './zfe.js';
import { prepareGuidanceBans, guidanceBan, banBannerText } from './hgv-bans.js';
import { emptyDriving, trackDriving, drivingView, drivingAnnouncements, toggleStopWork, DRIVING } from './driving-time.js';
import { prepareGuidanceWind, guidanceWind, placeWind } from './wind.js';
import { tunnelsAlongRoute, guidanceTunnel } from './adr.js';

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
  /**
   * Phase 7b (retour terrain : à l'arrêt sur une aire, un GPS qui dérive a changé l'itinéraire, 138 → 159 km) :
   * aucune détection « hors itinéraire » sous 10 km/h ni avec une précision moins bonne que 30 m. À l'arrêt hors du
   * tracé (aire, parking), le recalcul est seulement proposé (bouton) : l'itinéraire ne change pas sans accord.
   */
  OFF_ROUTE_MIN_SPEED: 10 / 3.6,
  OFF_ROUTE_MAX_ACCURACY_M: 30,
  /** Vitesse calculée entre deux positions au-delà de 150 km/h : saut de position (bruit), ignorée. */
  MAX_COMPUTED_SPEED: 150 / 3.6,
  /** Proposition « Recalculer d'ici » après 3 positions hors tracé, à l'arrêt. */
  STOPPED_OFF_FIXES: 3,
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

/** Aires (phase 9) placées sur l'itinéraire du guidage ; aucune si la liste n'est pas encore arrivée. */
function placeAreas(pool, route) {
  return Array.isArray(pool) && pool.length ? placeAlongRoute(pool, route) : [];
}

/** ZFE interdites sur un itinéraire (phase 5), d'après l'heure de passage estimée depuis `now`. */
function placeZfe(rules, route, now) {
  if (!rules?.zfe || !rules.vehicle) return [];
  return zfeAlongRoute(route, { data: rules.zfe, vehicle: rules.vehicle, departure: new Date(now || Date.now()) })
    .filter((p) => p.banned);
}

/** Tunnels interdits au code du véhicule sur un itinéraire (phase 5b ; les trois tunnels en dur même sans données). */
function placeTunnels(rules, route) {
  if (!rules?.vehicle) return [];
  return tunnelsAlongRoute(route, { data: rules.tunnels ?? null, vehicle: rules.vehicle }).filter((p) => p.forbidden);
}

/**
 * Démarre le guidage.
 * @param {object} route itinéraire lu par parseDirections
 * @param {{ destination?:number[]|null, now?:number, areas?:object[]|null, announceAreas?:boolean,
 *   rules?:{ vehicle:object, zfe?:object|null, voice?:boolean }|null }} opts
 *   destination choisie [lon, lat] (peut être hors route) ; areas : aires trouvées au calcul (phase 9, mergeAreas) ;
 *   announceAreas : annonce vocale vers 10 km avant une aire (réglage, désactivé par défaut) ;
 *   rules (phase 5) : profil véhicule et ZFE (parseZfeData) pour les alertes ZFE et interdictions PL, voice :
 *   alertes dites à voix haute (réglage, activé par défaut) ;
 *   driving (phase 5, PR B) : décompte du temps de conduite lu sur l'appareil (driving-time.js), driveVoice : annonces
 *   des pauses ; wind : prévisions Open-Meteo (parseWind) ou null, windGust : seuil de rafales (km/h), windVoice
 */
export function startNavigation(route, {
  destination = null, now = 0, areas = null, announceAreas = false, rules = null,
  driving = null, driveVoice = true, wind = null, windGust = undefined, windVoice = true,
} = {}) {
  return {
    driving: driving ?? emptyDriving(),
    driveVoice: driveVoice !== false,
    wind: prepareGuidanceWind(wind, route, windGust),
    windVoice: windVoice !== false,
    rules: rules?.vehicle ? {
      vehicle: rules.vehicle, zfe: rules.zfe ?? null, voice: rules.voice !== false, tunnels: rules.tunnels ?? null,
    } : null,
    zfe: placeZfe(rules, route, now),
    zfeAnnounced: {},
    tunnels: placeTunnels(rules, route),
    tunnelsAnnounced: {},
    bans: rules?.vehicle ? prepareGuidanceBans(rules.vehicle, now || Date.now()) : { windows: [], announced: {} },
    route: prepareRoute(route),
    source: route,
    areaPool: Array.isArray(areas) ? areas : [],
    areas: placeAreas(areas, route),
    areasAnnounced: {},
    announceAreas: announceAreas === true,
    destination: Array.isArray(destination) && destination.every(isNum) ? destination : null,
    segIndex: null,
    along: 0,
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
    stoppedOffCount: 0,
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
  const s = { ...state, announced: { ...state.announced }, areasAnnounced: { ...(state.areasAnnounced ?? {}) } };
  const events = [];
  const { line, maneuvers } = s.route;
  const p = [fix.lon, fix.lat];
  const t = isNum(fix.timestamp) ? fix.timestamp : (s.lastFixAt ?? s.startedAt) + 1000;

  const accuracy = isNum(fix.accuracy) && fix.accuracy >= 0 ? fix.accuracy : 0;

  // Vitesse : celle du GPS, sinon calculée entre deux positions ; lissée. Un déplacement plus petit que la
  // précision annoncée est du bruit (GPS qui dérive à l'arrêt) : vitesse nulle.
  let raw = isNum(fix.speed) && fix.speed >= 0 ? fix.speed : null;
  const dt = s.lastFixAt !== null ? (t - s.lastFixAt) / 1000 : 0;
  if (raw === null && s.lastFix && dt > 0 && dt <= 10) {
    const moved = haversine(s.lastFix, p);
    raw = moved > accuracy ? moved / dt : 0;
    if (raw > NAV.MAX_COMPUTED_SPEED) raw = null;
  }
  if (raw !== null) s.speed = s.speed === null ? raw : s.speed + NAV.SPEED_SMOOTHING * (raw - s.speed);
  const speed = s.speed ?? 0;

  const loc = locateOnLine(line, p, s.segIndex);
  s.segIndex = loc.segIndex;
  s.along = loc.along;
  const reliable = accuracy <= NAV.MAX_ACCURACY_M;
  const precise = isNum(fix.accuracy) && fix.accuracy <= NAV.OFF_ROUTE_MAX_ACCURACY_M;
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

  // Hors itinéraire → recalcul (jamais près de la destination ni après l'arrivée), seulement en roulant
  // (≥ 10 km/h) avec une position précise (≤ 30 m). À l'arrêt hors du tracé : proposition seulement.
  const rolling = speed >= NAV.OFF_ROUTE_MIN_SPEED;
  const offCandidate = !s.arrived && toDest >= NAV.NO_REROUTE_NEAR_DEST_M && !onRoute;
  s.stoppedOffCount = offCandidate && !rolling && reliable ? s.stoppedOffCount + 1 : 0;
  if (!offCandidate || !rolling || !precise) {
    s.offCount = 0;
    s.offSince = null;
  } else {
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

  // Aires (phase 9) : annonce optionnelle vers 10 km, une fois par aire, dans le sens de circulation seulement.
  if (s.announceAreas && !s.arrived && onRoute && !s.rerouting) {
    const a = areaToAnnounce(s.areas, loc.along, s.areasAnnounced);
    if (a) {
      s.areasAnnounced[a.area.id] = true;
      events.push({ type: 'speak', text: announceAreaText(a.area, a.distance) });
    }
  }

  // Réglementation (phase 5) : ZFE interdite devant, interdiction PL qui commence avant l'arrivée. Affichage et voix
  // seulement, rien à toucher.
  const rules = { zfe: null, ban: null, wind: null, tunnel: null };
  if (s.rules && !s.arrived) {
    // Tunnel interdit au code du véhicule (phase 5b) : bandeau sous 20 km, voix une fois vers 5 km.
    const tn = guidanceTunnel(s.tunnels, loc.along, s.tunnelsAnnounced);
    s.tunnelsAnnounced = tn.announced;
    rules.tunnel = tn.view;
    if (s.rules.voice && tn.speak && onRoute && !s.rerouting) events.push({ type: 'speak', text: tn.speak });
    const z = guidanceZfe(s.zfe, loc.along, s.zfeAnnounced);
    s.zfeAnnounced = z.announced;
    rules.zfe = z.view;
    const b = guidanceBan(s.bans, { now: t, arrival: t + remainingDuration(s.route, loc.along) * 1000, lonlat: p });
    s.bans = { ...s.bans, announced: b.announced };
    rules.ban = b.view ? { ...b.view, text: banBannerText(b.view) } : null;
    if (s.rules.voice) {
      if (z.speak && onRoute && !s.rerouting) events.push({ type: 'speak', text: z.speak });
      if (b.speak) events.push({ type: 'speak', text: b.speak });
    }
  }

  // Vent fort (phase 5, PR B) : rafales au-dessus du seuil devant, à l'heure où on y sera. Affichage et voix.
  const w = guidanceWind(s.wind, {
    along: loc.along, now: t, timeTo: (al) => remainingDuration(s.route, loc.along) - remainingDuration(s.route, al),
  });
  s.wind = { ...s.wind, announced: w.announced };
  rules.wind = s.arrived ? null : w.view;
  if (w.speak && s.windVoice && !s.arrived) events.push({ type: 'speak', text: w.speak });

  // Temps de conduite et pauses (phase 5, PR B, règlement CE 561/2006, aide seulement) : chaque position compte, même
  // hors du tracé ou après l'arrivée (manœuvres au dépôt).
  s.driving = trackDriving(s.driving, t, speed * 3.6);
  const areasAhead = s.arrived ? [] : nextAreas(s.areas, loc.along, (al) => remainingDuration(s.route, al));
  const da = drivingAnnouncements(s.driving, t, { nextArea: areasAhead.find((a) => a.distance > 0) ?? null });
  s.driving = da.state;
  if (s.driveVoice) for (const text of da.speak) events.push({ type: 'speak', text });

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
    /** À l'arrêt hors du tracé : proposer « Recalculer d'ici » (bouton), sans rien changer tout seul. */
    offRouteStopped: s.stoppedOffCount >= NAV.STOPPED_OFF_FIXES,
    canRequestReroute: s.stoppedOffCount >= NAV.STOPPED_OFF_FIXES && canReroute(s, t),
    /** Nom de la route en cours (étape ORS), seulement sur l'itinéraire. */
    roadName: onRoute && !s.arrived ? currentRoadName(maneuvers, line.cum, loc.along) : null,
    /** Les 3 prochaines aires du sens de circulation (phase 9) : nom, distance, temps (s) jusqu'à l'aire, places PL. */
    nextAreas: areasAhead,
    /**
     * Réglementation (phase 5) : { zfe:{ name, distance, text }|null, ban:{ active, start, end, minutes?, text }|null,
     * wind:{ gust, distance, text }|null, tunnel:{ name, distance, text }|null (phase 5b) }.
     */
    rules,
    /** Temps de conduite (drivingView) : lignes du bandeau, niveau, bouton « Pas une pause (travail) ». */
    driving: drivingView(s.driving, t, speed * 3.6),
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

/**
 * Cadre de la « Vue d'ensemble » (phase 7c) : le trajet restant (depuis le point atteint sur le tracé) et la position.
 * @returns {number[]|null} [ouest, sud, est, nord]
 */
export function overviewBbox(state) {
  const line = state?.route?.line;
  if (!line?.coords?.length) return null;
  const along = isNum(state.along) ? state.along : 0;
  const pts = [pointAt(line, along).point];
  for (let i = 0; i < line.coords.length; i += 1) if (line.cum[i] > along) pts.push(line.coords[i]);
  if (state.lastFix) pts.push(state.lastFix);
  if (state.destination) pts.push(state.destination);
  let [w, so, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    if (!isNum(x) || !isNum(y)) continue;
    w = Math.min(w, x); e = Math.max(e, x); so = Math.min(so, y); n = Math.max(n, y);
  }
  return Number.isFinite(w) ? [w, so, e, n] : null;
}

/**
 * Marges de la vue d'ensemble (px), réduites si besoin pour laisser au moins 30 % de l'écran au trajet : MapLibre
 * renonce à cadrer (fitBounds sans effet) quand les marges ne laissent plus de place.
 * @param {{ width:number, height:number }} size taille de la carte
 * @param {{ top:number, bottom:number, left:number, right:number }} wanted marges souhaitées (bandeau, barre du bas…)
 */
export function overviewPadding(size, wanted, minFree = 0.3) {
  const fit = (total, a, b) => {
    if (!(total > 0)) return [0, 0];
    const room = total * (1 - minFree);
    const x = Math.max(0, a || 0);
    const y = Math.max(0, b || 0);
    if (x + y <= room) return [x, y];
    const k = room / (x + y);
    return [Math.floor(x * k), Math.floor(y * k)];
  };
  const [top, bottom] = fit(size?.height, wanted?.top, wanted?.bottom);
  const [left, right] = fit(size?.width, wanted?.left, wanted?.right);
  return { top, bottom, left, right };
}

/**
 * Taille des boutons de carte du guidage (px) : la taille voulue (56 tablette, 48 téléphone) si la colonne tient dans
 * la hauteur disponible entre le bandeau et la barre du bas, sinon plus petite, jamais sous `min` (44 px : cible
 * tactile minimale des recommandations d'accessibilité WCAG 2.5.5 et Material Design 48 dp ramenée au plus serré).
 * @param {{ available:number, count:number, gap:number, preferred:number, min?:number }} p
 */
export function mapButtonSize({ available, count, gap, preferred, min = 44 }) {
  if (!isNum(available) || !(count > 0)) return preferred;
  const fit = Math.floor((available - Math.max(0, gap) * (count - 1)) / count);
  return Math.max(min, Math.min(preferred, fit));
}

function canReroute(state, now) {
  const cooled = state.lastRerouteAt === null || now - state.lastRerouteAt >= NAV.REROUTE_COOLDOWN_MS;
  return !state.rerouting && !state.rerouteBlocked && !state.arrived && cooled && !!state.lastFix;
}

/**
 * Recalcul demandé par le conducteur (bouton « Recalculer d'ici », à l'arrêt hors du tracé). Même délai de 30 s
 * entre deux recalculs (quota HeiGIT). Sans position, pendant un recalcul ou après un refus de clé : rien.
 */
export function requestReroute(state, now) {
  if (!state || !canReroute(state, now)) return { state, events: [] };
  const s = { ...state, rerouting: true, lastRerouteAt: now };
  return { state: s, events: [{ type: 'reroute', from: state.lastFix, bearing: state.bearing, manual: true }] };
}

/** Le signal GPS est-il perdu (aucune position depuis GPS_LOST_MS) ? */
export function gpsLost(state, now) {
  const ref = state.lastFixAt ?? state.startedAt;
  return isNum(now) && isNum(ref) && now - ref > NAV.GPS_LOST_MS;
}

/**
 * Aires arrivées après le début du guidage (requête Overpass plus lente que « Démarrer »), ou mises à jour.
 * Les aires déjà annoncées ne le sont pas une seconde fois.
 */
export function setNavigationAreas(state, areas) {
  if (!state) return state;
  const pool = Array.isArray(areas) ? areas : [];
  return { ...state, areaPool: pool, areas: placeAreas(pool, state.source) };
}

/** Fichier des tunnels arrivé après « Démarrer » (phase 5b) : tunnels interdits replacés sur le tracé suivi. */
export function setNavigationTunnels(state, data) {
  if (!state?.rules) return state;
  const rules = { ...state.rules, tunnels: data ?? null };
  return { ...state, rules, tunnels: placeTunnels(rules, state.source) };
}

/** Prévisions de vent arrivées après « Démarrer » (requête Open-Meteo plus lente) : placées sur le tracé suivi. */
export function setNavigationWind(state, forecast) {
  if (!state) return state;
  return { ...state, wind: { ...prepareGuidanceWind(forecast, state.source, state.wind?.threshold), announced: state.wind?.announced ?? {} } };
}

/**
 * Bouton « Pas une pause (travail) » (à l'arrêt, sous 10 km/h) : l'arrêt en cours, ou le dernier arrêt d'au moins
 * 15 min, ne compte plus comme pause ; un second appui le recompte. Sans effet en roulant.
 * @returns {{ state:object, driving:object|null }} driving : nouvelle vue du décompte (null si rien n'a changé)
 */
export function markStopAsWork(state, now) {
  const kmh = (state?.speed ?? 0) * 3.6;
  if (!state || kmh >= DRIVING.WORK_BUTTON_KMH) return { state, driving: null };
  const driving = toggleStopWork(state.driving ?? emptyDriving());
  return { state: { ...state, driving }, driving: drivingView(driving, now, kmh) };
}

/** Nouvel itinéraire reçu après un recalcul. Les aires déjà trouvées sont replacées sur le nouveau tracé (sans requête). */
export function rerouteDone(state, route) {
  const s = {
    ...state,
    route: prepareRoute(route),
    source: route,
    areas: placeAreas(state.areaPool, route),
    zfe: placeZfe(state.rules, route, state.lastFixAt ?? state.startedAt),
    tunnels: placeTunnels(state.rules, route),
    wind: state.wind ? { ...state.wind, placed: placeWind(state.wind.forecast, route) } : state.wind,
    segIndex: null,
    along: 0,
    announced: {},
    started: true,
    offCount: 0,
    offSince: null,
    stoppedOffCount: 0,
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
