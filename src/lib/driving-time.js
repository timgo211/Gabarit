// Temps de conduite et pauses (phase 5, PR B). Logique pure : pauses conseillées sur le trajet (avant le départ) et
// compteur de conduite pendant le guidage. Présenté comme une AIDE : « Pause conseillée », jamais « obligatoire ».
// Le chronotachygraphe et le conducteur font foi (l'appli ne voit ni le travail hors conduite ni les autres jours).
//
// Source officielle (lue le 20/11/2026) : ministère de la Transition écologique, page « Temps de travail des
// conducteurs routiers – transport de marchandises » (www.ecologie.gouv.fr/politiques-publiques/
// temps-travail-conducteurs-routiers-transport-marchandises, mise à jour du 04/05/2022), qui résume le règlement (CE)
// n° 561/2006 du 15 mars 2006 (art. 6, 7 et 8 ; EUR-Lex n'est pas lisible depuis le conteneur, page anti-robot) :
//   « Pour les conducteurs de véhicules de plus de 3,5T, le règlement (CE) n° 561/2006 du 15 mars 2006 prévoit :
//   l'obligation, après un temps de conduite de 4h30, de prendre une pause de 45 mn pouvant être fractionnée en une
//   pause d'au moins 15 min suivie d'une pause d'au moins 30 mn ; une durée de conduite journalière limitée à 9 heures
//   pouvant être portée à 10 heures deux fois par semaine ; une durée de conduite hebdomadaire limitée à 56heures et
//   90 heures sur deux semaines consécutives. »
//   « Temps de repos normal : période d'au moins 11 heures avec possibilité de fractionnement en une première tranche
//   de 3 heures et deuxième tranche de 9 heures ; Temps de repos réduit : période d'une durée d'au moins 9 heures et de
//   moins de 11 heures (possible trois fois maximum entre deux temps de repos hebdomadaires). »
// Les limites hebdomadaires (56 h, 90 h) ne sont pas suivies : l'appli ne connaît pas les jours précédents.

import { prepareLine } from './nav-geo.js';
import { timeAt } from './areas-route.js';
import { formatDuration } from './format.js';

export const DRIVE = Object.freeze({
  /** Le règlement vise les véhicules de plus de 3,5 t. */
  MIN_WEIGHT_T: 3.5,
  /** Art. 7 : pause après 4 h 30 de conduite. */
  BLOCK_S: 4.5 * 3600,
  /** Pause de 45 min, ou 15 min puis 30 min. */
  BREAK_S: 45 * 60,
  SPLIT_FIRST_S: 15 * 60,
  SPLIT_SECOND_S: 30 * 60,
  /** Art. 6 : 9 h de conduite par jour (10 h deux fois par semaine). */
  DAY_S: 9 * 3600,
  DAY_EXTENDED_S: 10 * 3600,
  /** Art. 8 : repos journalier normal 11 h, réduit 9 h (au plus trois fois). */
  DAILY_REST_S: 11 * 3600,
  REDUCED_REST_S: 9 * 3600,
  /** Guidage : on roule à partir de 5 km/h (en dessous, arrêt : file, aire, livraison). */
  MOVING_MS: 5 / 3.6,
  /** Écart entre deux positions compté au plus (signal perdu) : au-delà, le temps compte comme un arrêt. */
  MAX_GAP_S: 120,
  /** Aire conseillée pour la pause : atteinte au plus 1 h avant la limite des 4 h 30. */
  AREA_WINDOW_S: 3600,
  /** Annonces vocales avant la limite des 4 h 30 (min). */
  ANNOUNCE_MIN: Object.freeze([30, 10]),
  /** Bandeau du guidage affiché à moins d'une heure de la limite. */
  BANNER_BEFORE_S: 3600,
  /** Journal du guidage gardé sur l'appareil (localStorage) pour reprendre le compteur. */
  LOG_KEY: 'gabarit.drive',
  SOURCE: 'Règlement (CE) n° 561/2006 (résumé du ministère de la Transition écologique, page du 04/05/2022)',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const clampS = (x) => (isNum(x) && x > 0 ? x : 0);

/** Le règlement s'applique au véhicule (plus de 3,5 t) ? PTAC inconnu → oui (profil PL). */
export function driveApplies(vehicle) {
  return !isNum(vehicle?.weight) || vehicle.weight > DRIVE.MIN_WEIGHT_T;
}

/** « 4:30 », « 4 h 30 », « 4h », « 45 », « 4,5 » → secondes ; vide → 0 ; illisible → null. */
export function parseDriveTime(text) {
  if (text === null || text === undefined) return 0;
  const s = String(text).trim().toLowerCase().replace(/\s+/g, '');
  if (s === '') return 0;
  let m = s.match(/^(\d{1,2})(?:h|:)(\d{1,2})?(?:min|mn|m)?$/);
  if (m) {
    const min = m[2] ? Number(m[2]) : 0;
    return min < 60 ? Number(m[1]) * 3600 + min * 60 : null;
  }
  m = s.match(/^(\d{1,3})(?:min|mn|m)$/);
  if (m) return Number(m[1]) * 60;
  m = s.match(/^(\d{1,2})(?:[.,](\d{1,2}))?$/);
  if (m) {
    // Un nombre seul : heures (« 4,5 ») jusqu'à 15, minutes au-delà (« 45 »).
    const v = Number(`${m[1]}.${m[2] ?? '0'}`);
    return v <= 15 ? Math.round(v * 3600) : (m[2] ? null : v * 60);
  }
  return null;
}

/** Secondes → « 4 h 30 » / « 45 min » (champ prérempli). */
export function driveTimeText(seconds) {
  const s = clampS(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (!h) return `${m} min`;
  return `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
}

/** Conduite déjà faite (saisie à l'arrêt) normalisée : depuis la dernière pause ≤ aujourd'hui. */
export function normalizeDriven({ today = 0, sinceBreak = 0 } = {}) {
  const since = Math.min(clampS(sinceBreak), DRIVE.DAY_EXTENDED_S);
  // La conduite depuis la dernière pause fait partie de celle du jour.
  return { today: Math.min(Math.max(clampS(today), since), DRIVE.DAY_EXTENDED_S), sinceBreak: since };
}

/** Distance (m) du tracé où la conduite cumulée atteint `seconds` (recherche sur timeAt, qui croît avec la distance). */
function alongAtTime(route, line, seconds) {
  let lo = 0;
  let hi = line.total;
  if (timeAt(route, line, hi) <= seconds) return null;
  for (let k = 0; k < 40; k += 1) {
    const mid = (lo + hi) / 2;
    if (timeAt(route, line, mid) < seconds) lo = mid; else hi = mid;
  }
  return hi;
}

/**
 * Pauses conseillées le long d'un itinéraire (avant le départ).
 * @param {object} route itinéraire (parseDirections : coordinates, steps, duration)
 * @param {{ vehicle?:object, driven?:{ today:number, sinceBreak:number }, areas?:object[], departure?:Date }} ctx
 *   areas : aires placées sur ce tracé (placeAlongRoute, phase 9) ; driven : conduite déjà faite aujourd'hui (s)
 * @returns {{ applies:boolean, breaks:{ along:number, drive:number, time:Date, area:object|null }[],
 *   dayLimit:{ along:number, drive:number, time:Date }|null, breakS:number, restS:number, arrival:Date,
 *   elapsed:(t:number)=>number }}
 *   drive : secondes de conduite depuis le départ au moment de la pause ; time : heure estimée (pauses précédentes
 *   comprises) ; elapsed(t) : temps écoulé (s, pauses comprises) quand t secondes de conduite sont faites
 */
export function planBreaks(route, { vehicle = null, driven = {}, areas = [], departure = new Date() } = {}) {
  const duration = isNum(route?.duration) ? route.duration : 0;
  const identity = (t) => t;
  const base = {
    applies: false, breaks: [], dayLimit: null, breakS: 0, restS: 0,
    arrival: new Date(departure.getTime() + duration * 1000), elapsed: identity,
  };
  if (!driveApplies(vehicle) || !Array.isArray(route?.coordinates) || route.coordinates.length < 2) return base;
  const d = normalizeDriven(driven);
  const line = prepareLine(route.coordinates);
  const usable = (Array.isArray(areas) ? areas : []).filter((a) => a && isNum(a.along) && !a.otherSide)
    .sort((a, b) => a.along - b.along);

  // Limite du jour (9 h), comptée depuis le départ.
  const dayLeft = Math.max(0, DRIVE.DAY_S - d.today);
  const dayAt = dayLeft < duration ? dayLeft : null;

  const pauses = [];
  let next = Math.max(0, DRIVE.BLOCK_S - d.sinceBreak);
  while (next < duration && (dayAt === null || next < dayAt)) {
    const limitAlong = alongAtTime(route, line, next);
    if (limitAlong === null) break;
    // Aire du bon sens atteinte au plus tard à la limite, et pas plus d'une heure avant : la plus proche de la limite.
    let area = null;
    for (const a of usable) {
      if (a.along > limitAlong) break;
      const t = timeAt(route, line, a.along);
      if (t >= next - DRIVE.AREA_WINDOW_S && t > (pauses.length ? pauses[pauses.length - 1].drive : 0)) area = a;
    }
    const at = area ? timeAt(route, line, area.along) : next;
    pauses.push({ along: area ? area.along : limitAlong, drive: at, area });
    next = at + DRIVE.BLOCK_S;
  }

  const elapsed = (t) => {
    let e = t;
    for (const p of pauses) if (t > p.drive) e += DRIVE.BREAK_S;
    if (dayAt !== null && t > dayAt) e += DRIVE.DAILY_REST_S;
    return e;
  };
  const breaks = pauses.map((p) => ({ ...p, time: new Date(departure.getTime() + elapsed(p.drive) * 1000) }));
  let dayLimit = null;
  if (dayAt !== null) {
    const along = alongAtTime(route, line, dayAt) ?? line.total;
    dayLimit = { along, drive: dayAt, time: new Date(departure.getTime() + elapsed(dayAt) * 1000) };
  }
  return {
    applies: true,
    breaks,
    dayLimit,
    breakS: breaks.length * DRIVE.BREAK_S,
    restS: dayLimit ? DRIVE.DAILY_REST_S : 0,
    arrival: new Date(departure.getTime() + elapsed(duration) * 1000),
    elapsed,
  };
}

// ───────── Textes de la fiche ─────────

const hourText = (d) => `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
const kmText = (m) => `km ${Math.round(m / 1000)}`;

/** Lignes de la fiche : pauses conseillées, repos journalier, arrivée avec pauses. */
export function describeBreaks(plan, { areaName = (a) => a?.name ?? 'aire' } = {}) {
  if (!plan?.applies) return [];
  const lines = [];
  for (const b of plan.breaks) {
    lines.push(b.area
      ? `Pause conseillée (45 min) : ${areaName(b.area)}, ${kmText(b.along)}, vers ${hourText(b.time)}.`
      : `Pause conseillée (45 min) vers ${kmText(b.along)}, vers ${hourText(b.time)} (4 h 30 de conduite).`);
  }
  if (plan.dayLimit) {
    lines.push(`Repos journalier conseillé vers ${kmText(plan.dayLimit.along)}, vers ${hourText(plan.dayLimit.time)} : `
      + '9 h de conduite (10 h possible deux fois par semaine).');
  }
  if (plan.breaks.length || plan.dayLimit) {
    const day = plan.dayLimit ? ` (repos de 11 h compris, ${plan.arrival.toLocaleDateString('fr-FR', { weekday: 'long' })})` : '';
    lines.push(`Arrivée estimée avec les pauses : ${hourText(plan.arrival)}${day}.`);
  }
  return lines;
}

/** Résumé court pour la fiche d'itinéraire. */
export function shortBreaks(plan) {
  if (!plan?.applies || (!plan.breaks.length && !plan.dayLimit)) return null;
  const n = plan.breaks.length;
  const parts = [];
  if (n) parts.push(`${n} pause${n > 1 ? 's' : ''} conseillée${n > 1 ? 's' : ''}`);
  if (plan.dayLimit) parts.push('repos journalier');
  return parts.join(' + ');
}

export const DRIVE_NOTE = 'Temps de conduite : aide seulement, le chronotachygraphe fait foi.';

// ───────── Compteur du guidage ─────────

/**
 * Compteur de départ. `driven` : saisie à l'arrêt (ou reprise du journal).
 * block : conduite depuis la dernière pause valable ; day : conduite du jour ; stop : arrêt en cours (s) ;
 * split : une pause d'au moins 15 min déjà faite (il reste 30 min à prendre).
 */
export function startDrive(driven = {}, now = 0) {
  const d = normalizeDriven(driven);
  return { block: d.sinceBreak, day: d.today, stop: 0, split: false, rested: false, at: isNum(now) ? now : 0, announced: {} };
}

/** Arrêt terminé (ou en cours) : pause valable ? */
function applyStop(c) {
  // Arrêt d'au moins 9 h (repos réduit) : nouvelle journée de conduite.
  if (c.stop >= DRIVE.REDUCED_REST_S) return { ...c, block: 0, day: 0, split: false, rested: true, announced: {} };
  if (c.stop >= DRIVE.BREAK_S || (c.split && c.stop >= DRIVE.SPLIT_SECOND_S)) {
    return { ...c, block: 0, split: false, rested: true, announced: {} };
  }
  if (c.stop >= DRIVE.SPLIT_FIRST_S) return { ...c, split: true };
  return c;
}

/**
 * Une position du guidage. speed en m/s (lissée par le moteur), t en ms.
 * @returns compteur mis à jour
 */
export function stepDrive(c, { t, speed }) {
  if (!c || !isNum(t)) return c;
  const dt = c.at ? Math.max(0, (t - c.at) / 1000) : 0;
  const moving = isNum(speed) && speed >= DRIVE.MOVING_MS && dt <= DRIVE.MAX_GAP_S;
  let n = { ...c, at: t };
  if (moving) {
    if (n.stop > 0 && !n.rested) n = applyStop(n);
    n.stop = 0;
    n.rested = false;
    n.block += dt;
    n.day += dt;
  } else {
    n.stop += dt;
    // Pause complète pendant l'arrêt : comptée tout de suite (« Pause faite »), puis repos journalier après 9 h.
    // (la première tranche de 15 min n'est comptée qu'à la fin de l'arrêt).
    const full = n.stop >= DRIVE.BREAK_S || (n.split && n.stop >= DRIVE.SPLIT_SECOND_S);
    if ((full && !n.rested) || n.stop >= DRIVE.REDUCED_REST_S) n = applyStop(n);
  }
  return n;
}

const minText = (s) => formatDuration(Math.max(0, Math.round(s / 60) * 60));

/**
 * Vue et annonce du guidage. nextArea : prochaine aire du sens (nom, distance) ou null.
 * @returns {{ view:{ blockLeft:number, dayLeft:number, stopped:number, text:string|null }|null, speak:string|null,
 *   announced:object }}
 */
export function guidanceDrive(c, { applies = true, nextArea = null } = {}) {
  if (!c || !applies) return { view: null, speak: null, announced: c?.announced ?? {} };
  const blockLeft = DRIVE.BLOCK_S - c.block;
  const dayLeft = DRIVE.DAY_S - c.day;
  const left = Math.min(blockLeft, dayLeft);
  const announced = { ...c.announced };
  let speak = null;
  let text = null;
  const wanted = c.split ? DRIVE.SPLIT_SECOND_S : DRIVE.BREAK_S;
  if (c.rested && c.stop > 0) {
    text = 'Pause faite';
  } else if (c.stop >= DRIVE.SPLIT_FIRST_S || (c.stop >= 60 && blockLeft <= DRIVE.BANNER_BEFORE_S)) {
    text = `Pause : ${minText(c.stop)} sur ${minText(wanted)}`;
  } else if (left <= 0) {
    text = dayLeft <= 0 ? 'Repos journalier conseillé (9 h de conduite)' : 'Pause conseillée (4 h 30 de conduite)';
    if (!announced.zero) {
      announced.zero = true;
      speak = dayLeft <= 0
        ? 'Neuf heures de conduite aujourd\'hui : repos conseillé.'
        : 'Quatre heures trente de conduite : pause conseillée.';
    }
  } else if (left <= DRIVE.BANNER_BEFORE_S) {
    text = `Pause conseillée dans ${minText(left)}`;
    for (const m of DRIVE.ANNOUNCE_MIN) {
      if (left <= m * 60 && !announced[m]) {
        for (const k of DRIVE.ANNOUNCE_MIN) if (k >= m) announced[k] = true;
        const area = nextArea ? ` Prochaine aire : ${nextArea.name}, dans ${Math.max(1, Math.round(nextArea.distance / 1000))} kilomètres.` : '';
        speak = `Pause conseillée dans ${m} minutes.${area}`;
        break;
      }
    }
  }
  return { view: { blockLeft, dayLeft, stopped: c.stop, text }, speak, announced };
}

// ───────── Journal sur l'appareil ─────────

/** Journal à enregistrer (localStorage) : compteur et heure de la dernière position. */
export function driveLog(c) {
  if (!c) return null;
  return { block: Math.round(c.block), day: Math.round(c.day), stop: Math.round(c.stop), split: !!c.split, at: c.at };
}

/**
 * Reprise du journal : le temps passé depuis la dernière position compte comme un arrêt (pause, repos).
 * @returns {{ today:number, sinceBreak:number }|null} null si illisible ou ancien (plus de 24 h)
 */
export function resumeDriveLog(log, now = Date.now()) {
  if (!log || !isNum(log.at) || !isNum(log.block) || !isNum(log.day) || now < log.at || now - log.at > 24 * 3600e3) return null;
  let c = {
    block: clampS(log.block), day: clampS(log.day), stop: clampS(log.stop) + (now - log.at) / 1000, split: !!log.split,
    rested: false, at: now, announced: {},
  };
  c = applyStop(c);
  return { today: Math.round(c.day), sinceBreak: Math.round(c.block) };
}
