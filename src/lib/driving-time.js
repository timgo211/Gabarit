// Temps de conduite et pauses (phase 5, PR B). Logique pure : décompte de la conduite d'après les positions du
// guidage, pauses, alertes, plan des pauses d'un itinéraire, lecture et écriture sur l'appareil.
//
// AIDE SEULEMENT : le chronotachygraphe fait foi. Gabarit ne voit que les trajets faits avec son guidage ; un trajet
// sans l'appli, le travail et la disponibilité ne sont pas connus. Le décompte reste sur l'appareil (jamais exporté).
//
// Source officielle : règlement (CE) n° 561/2006 du Parlement européen et du Conseil du 15 mars 2006 relatif à
// l'harmonisation de certaines dispositions de la législation sociale dans le domaine des transports par route
// (version consolidée, modifiée par le règlement (UE) 2020/1054), EUR-Lex CELEX 32006R0561 :
// https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32006R0561
// (eur-lex.europa.eu est bloqué depuis le conteneur de développement : articles repris du texte publié au JOUE.)
// - Art. 4 d) « pause » : toute période pendant laquelle un conducteur n'a pas le droit de conduire ou d'effectuer
//   d'autres tâches et qui doit uniquement lui permettre de se reposer. → un arrêt marqué « travail » n'est pas une
//   pause (bouton « Pas une pause (travail) »).
// - Art. 4 g) temps de repos journalier : normal (au moins 11 heures, ou 3 heures + 9 heures) ou réduit (au moins
//   9 heures et moins de 11 heures). → un arrêt d'au moins 9 heures termine la journée de conduite.
// - Art. 4 i) « semaine » : la période comprise entre lundi 00 h 00 et dimanche 24 h 00.
// - Art. 6 § 1 : la durée de conduite journalière ne dépasse pas neuf heures ; elle peut être prolongée jusqu'à
//   dix heures au maximum deux fois au cours de la semaine. § 2 : la durée de conduite hebdomadaire ne dépasse pas
//   56 heures. § 3 : la durée de conduite totale accumulée au cours de deux semaines consécutives ne dépasse pas
//   90 heures.
// - Art. 7 : « Après un temps de conduite de quatre heures et demie, un conducteur observe une pause ininterrompue
//   d'au moins quarante-cinq minutes, à moins qu'il ne prenne un temps de repos. Cette pause peut être remplacée
//   par une pause d'au moins quinze minutes suivie d'une pause d'au moins trente minutes réparties au cours de la
//   période de manière à se conformer aux dispositions du premier alinéa. » → ordre imposé : 15 min PUIS 30 min
//   (30 min puis 15 min ne suffit pas : la pause de 30 min compte alors comme la première partie).
//
// Détection : « conduite » = vitesse d'au moins 5 km/h ; un arrêt compte comme pause à partir de 15 minutes. La
// reprise de la conduite n'est retenue qu'après 30 s au-dessus de 5 km/h (un saut du GPS à l'arrêt ne coupe pas une
// pause) ; elle est alors comptée depuis son début. Positions interrompues plus de 60 s (appli fermée, guidage
// arrêté, GPS perdu) : intervalle compté comme arrêt.

import { sampleRoute } from './route-samples.js';
import { formatDuration } from './format.js';

export const DRIVING = Object.freeze({
  /** Vitesse à partir de laquelle on conduit (km/h). */
  MOVING_KMH: 5,
  /** Reprise de la conduite confirmée après 30 s au-dessus de MOVING_KMH. */
  MOVE_CONFIRM_MS: 30000,
  /** Positions espacées de plus de 60 s : l'intervalle est un arrêt. */
  GAP_MS: 60000,
  /** Art. 7 : 4 h 30 de conduite, pause de 45 min, ou 15 min puis 30 min. */
  CONTINUOUS_MAX_S: 4.5 * 3600,
  BREAK_FULL_S: 45 * 60,
  BREAK_FIRST_S: 15 * 60,
  BREAK_SECOND_S: 30 * 60,
  /** Art. 4 g) / art. 8 : repos journalier réduit d'au moins 9 h. */
  DAILY_REST_S: 9 * 3600,
  /** Art. 6 § 1 : 9 h par jour, 10 h deux fois par semaine. */
  DAY_MAX_S: 9 * 3600,
  DAY_EXTENDED_S: 10 * 3600,
  EXTENSIONS_PER_WEEK: 2,
  /** Art. 6 § 2 et § 3 : 56 h par semaine, 90 h sur deux semaines consécutives. */
  WEEK_MAX_S: 56 * 3600,
  FORTNIGHT_MAX_S: 90 * 3600,
  /** Alerte (bandeau orange et voix) 30 min avant une limite. */
  WARN_BEFORE_S: 30 * 60,
  /** Semaine affichée quand il reste moins de 5 h. */
  WEEK_SHOW_LEFT_S: 5 * 3600,
  /** Bouton « Pas une pause (travail) » : visible seulement sous 10 km/h. */
  WORK_BUTTON_KMH: 10,
  STORAGE_KEY: 'gabarit.driving',
  NOTICE: 'Aide seulement : le chronotachygraphe fait foi. Compté seulement pendant le guidage de Gabarit.',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const DAY_MS = 86400000;

/** Lundi 00 h 00 (heure locale de la tablette) de la semaine qui contient t (art. 4 i). */
export function weekStart(t) {
  const d = new Date(t);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return monday.getTime();
}

/** Décompte vide (première utilisation, ou remise à zéro dans Réglages). */
export function emptyDriving() {
  return {
    v: 1,
    at: null, // dernière position comptée (ms)
    mode: 'stop', // 'drive' | 'stop'
    stopStart: null, // début de l'arrêt en cours (ms)
    stopWork: false, // arrêt en cours marqué « travail »
    moveSince: null, // reprise de la conduite pas encore confirmée (ms)
    sinceBreak: 0, // conduite depuis la dernière pause valable (s)
    split: false, // 15 min déjà faites (art. 7, 2e alinéa)
    breakFrom: 0, // fin de la dernière pause valable (ms) : identifie la période pour les annonces
    day: 0, // conduite depuis le dernier repos journalier (s)
    dayExtended: false, // journée passée au-delà de 9 h
    dayFrom: 0,
    week: { start: null, driving: 0, extensions: 0 },
    prevWeek: 0, // conduite de la semaine précédente (art. 6 § 3)
    last: null, // dernier arrêt d'au moins 15 min : { start, end, work, before, pause, drivenSince }
    announced: {},
  };
}

/** Nettoie un décompte lu sur l'appareil (rien d'illisible ne passe). */
export function sanitizeDriving(raw) {
  const e = emptyDriving();
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return e;
  const num = (x, d = 0) => (isNum(x) && x >= 0 ? x : d);
  const ts = (x) => (isNum(x) && x > 0 ? x : null);
  const snap = (s) => (s && typeof s === 'object' ? {
    sinceBreak: num(s.sinceBreak), split: s.split === true, breakFrom: num(s.breakFrom), day: num(s.day),
    dayExtended: s.dayExtended === true, dayFrom: num(s.dayFrom),
  } : null);
  const last = raw.last && typeof raw.last === 'object' && ts(raw.last.start) && ts(raw.last.end)
    && snap(raw.last.before) && snap(raw.last.pause)
    ? { start: raw.last.start, end: raw.last.end, work: raw.last.work === true, before: snap(raw.last.before),
      pause: snap(raw.last.pause), drivenSince: num(raw.last.drivenSince) }
    : null;
  const announced = {};
  if (raw.announced && typeof raw.announced === 'object') {
    for (const [k, v] of Object.entries(raw.announced).slice(-50)) if (v === true && k.length < 60) announced[k] = true;
  }
  return {
    ...e,
    at: ts(raw.at),
    mode: raw.mode === 'drive' ? 'drive' : 'stop',
    stopStart: ts(raw.stopStart),
    stopWork: raw.stopWork === true,
    moveSince: ts(raw.moveSince),
    sinceBreak: num(raw.sinceBreak),
    split: raw.split === true,
    breakFrom: num(raw.breakFrom),
    day: num(raw.day),
    dayExtended: raw.dayExtended === true,
    dayFrom: num(raw.dayFrom),
    week: {
      start: ts(raw.week?.start), driving: num(raw.week?.driving),
      extensions: Math.min(7, Math.floor(num(raw.week?.extensions))),
    },
    prevWeek: num(raw.prevWeek),
    last,
    announced,
  };
}

const snapshot = (d) => ({
  sinceBreak: d.sinceBreak, split: d.split, breakFrom: d.breakFrom, day: d.day, dayExtended: d.dayExtended, dayFrom: d.dayFrom,
});

function clone(d) {
  return { ...d, week: { ...d.week }, last: d.last ? { ...d.last } : null, announced: { ...d.announced } };
}

/** Nouvelle semaine (lundi 00 h 00) : la précédente est gardée pour la limite de deux semaines (90 h). */
function rollWeek(d, t) {
  const ws = weekStart(t);
  if (d.week.start === ws) return;
  const consecutive = d.week.start !== null && ws - d.week.start <= 7 * DAY_MS + 2 * 3600e3 && ws > d.week.start;
  d.prevWeek = consecutive ? d.week.driving : 0;
  d.week = { start: ws, driving: 0, extensions: 0 };
}

function addDriving(d, seconds) {
  if (!(seconds > 0)) return;
  d.sinceBreak += seconds;
  d.day += seconds;
  d.week.driving += seconds;
  if (d.last) d.last.drivenSince += seconds;
  if (!d.dayExtended && d.day > DRIVING.DAY_MAX_S) {
    d.dayExtended = true;
    d.week.extensions += 1;
  }
}

/**
 * Effet d'un arrêt de `seconds` terminé à `end` sur les compteurs (art. 7 et art. 4 g), sans le noter.
 * @returns {object} compteurs après l'arrêt (snapshot)
 */
export function applyStop(counters, seconds, end) {
  const c = { ...counters };
  if (seconds >= DRIVING.DAILY_REST_S) {
    return { ...c, sinceBreak: 0, split: false, breakFrom: end, day: 0, dayExtended: false, dayFrom: end };
  }
  if (seconds >= DRIVING.BREAK_FULL_S || (c.split && seconds >= DRIVING.BREAK_SECOND_S)) {
    return { ...c, sinceBreak: 0, split: false, breakFrom: end };
  }
  if (seconds >= DRIVING.BREAK_FIRST_S) return { ...c, split: true };
  return c;
}

function endStop(d, end) {
  if (d.stopStart === null) return;
  const seconds = Math.max(0, (end - d.stopStart) / 1000);
  const before = snapshot(d);
  const pause = applyStop(before, seconds, end);
  if (!d.stopWork) Object.assign(d, pause);
  if (seconds >= DRIVING.BREAK_FIRST_S) {
    d.last = { start: d.stopStart, end, work: d.stopWork, before, pause, drivenSince: 0 };
  }
  d.stopStart = null;
  d.stopWork = false;
  pruneAnnounced(d);
}

/** Annonces gardées seulement pour la période en cours (pause, journée, semaine, arrêt). */
function pruneAnnounced(d) {
  const keep = {};
  for (const k of Object.keys(d.announced)) {
    const [kind, id] = k.split(':');
    const cur = kind === 'b' ? d.breakFrom : kind === 'd' ? d.dayFrom : kind === 'w' ? d.week.start : kind === 's' ? d.stopStart : null;
    if (String(cur) === id) keep[k] = true;
  }
  d.announced = keep;
}

/**
 * Une position du guidage.
 * @param {object} state décompte (emptyDriving / sanitizeDriving)
 * @param {number} t heure de la position (ms)
 * @param {number|null} speedKmh vitesse (km/h)
 * @returns {object} nouveau décompte
 */
export function trackDriving(state, t, speedKmh) {
  if (!isNum(t)) return state;
  const d = clone(state ?? emptyDriving());
  rollWeek(d, t);
  const moving = isNum(speedKmh) && speedKmh >= DRIVING.MOVING_KMH;
  if (d.at === null || t < d.at) {
    d.at = t;
    if (d.mode === 'stop' && d.stopStart === null) d.stopStart = t;
  }
  const gap = t - d.at > DRIVING.GAP_MS;
  if (d.mode === 'drive') {
    if (gap) { // plus de positions : arrêt depuis la dernière
      d.mode = 'stop';
      d.stopStart = d.at;
      d.stopWork = false;
      d.moveSince = null;
    } else addDriving(d, (t - d.at) / 1000);
  } else if (gap) d.moveSince = null;
  d.at = t;
  if (d.mode === 'drive') {
    if (!moving) {
      d.mode = 'stop';
      d.stopStart = t;
      d.stopWork = false;
      d.moveSince = null;
    }
  } else if (moving) {
    if (d.moveSince === null) d.moveSince = t;
    if (t - d.moveSince >= DRIVING.MOVE_CONFIRM_MS) {
      const from = d.moveSince;
      endStop(d, from);
      d.mode = 'drive';
      d.moveSince = null;
      addDriving(d, (t - from) / 1000);
    }
  } else d.moveSince = null;
  return d;
}

/**
 * Bouton « Pas une pause (travail) » (à l'arrêt, sous 10 km/h) : l'arrêt en cours, sinon le dernier arrêt d'au
 * moins 15 min, ne compte plus comme pause (chargement, attente au quai…). Un second appui le recompte.
 */
export function toggleStopWork(state) {
  if (!state) return state;
  const d = clone(state);
  if (d.mode === 'stop' && d.stopStart !== null) {
    d.stopWork = !d.stopWork;
    return d;
  }
  if (!d.last) return d;
  const work = !d.last.work;
  const base = work ? d.last.before : d.last.pause;
  const extra = d.last.drivenSince;
  Object.assign(d, base, {
    sinceBreak: base.sinceBreak + extra,
    day: base.day + extra,
    dayExtended: base.dayExtended || base.day + extra > DRIVING.DAY_MAX_S,
  });
  d.last = { ...d.last, work };
  return d;
}

/** Décompte vu à l'heure `t` : l'arrêt en cours compté comme s'il finissait maintenant (fiches avant le départ). */
export function drivingAt(state, t) {
  const d = clone(state ?? emptyDriving());
  if (!isNum(t)) return d;
  rollWeek(d, t);
  let stopStart = d.mode === 'stop' ? d.stopStart : d.at;
  if (d.mode === 'drive' && d.at !== null && t - d.at <= DRIVING.GAP_MS) stopStart = null; // on roule encore
  if (stopStart !== null && t > stopStart && !(d.mode === 'stop' && d.stopWork)) {
    Object.assign(d, applyStop(snapshot(d), (t - stopStart) / 1000, t));
  }
  return d;
}

/** Prolongation à 10 h permise aujourd'hui (la journée déjà prolongée compte parmi les 2 de la semaine). */
export function canExtend(d) {
  return d.dayExtended ? d.week.extensions <= DRIVING.EXTENSIONS_PER_WEEK : d.week.extensions < DRIVING.EXTENSIONS_PER_WEEK;
}

/** Limite du jour (art. 6 § 1) : 10 h si la journée est déjà prolongée ou s'il reste une prolongation cette semaine. */
export function dayLimit(d) {
  return canExtend(d) ? DRIVING.DAY_EXTENDED_S : DRIVING.DAY_MAX_S;
}

/** Limite de la semaine : 56 h, moins si la semaine précédente rapproche des 90 h (art. 6 § 2 et § 3). */
export function weekLimit(d) {
  return Math.max(0, Math.min(DRIVING.WEEK_MAX_S, DRIVING.FORTNIGHT_MAX_S - d.prevWeek));
}

/** Pause à faire : 30 min si les 15 min sont déjà faites, sinon 45 min (art. 7). */
export const breakNeeded = (d) => (d.split ? DRIVING.BREAK_SECOND_S : DRIVING.BREAK_FULL_S);

const hm = (s) => formatDuration(Math.max(0, s));
const minutes = (s) => `${Math.round(s / 60)} min`;
/** « 4 heures 30 », « 45 minutes » (voix). */
function spoken(s) {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m > 1 ? 's' : ''}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h} heure${h > 1 ? 's' : ''}${r ? ` ${r}` : ''}`;
}

/**
 * Ce que montre le guidage (bandeau `#nav-drive`) : une ligne principale, une ligne secondaire, le niveau et le
 * bouton « travail ».
 * @returns {{ level:'ok'|'soon'|'over', main:string, detail:string, stopped:boolean, canMarkWork:boolean,
 *   workLabel:string, sinceBreak:number, left:number, day:number, dayLeft:number }}
 */
export function drivingView(state, t, speedKmh) {
  const d = state ?? emptyDriving();
  const stopped = d.mode === 'stop' && d.stopStart !== null;
  const cur = stopped && isNum(t) ? Math.max(0, (t - d.stopStart) / 1000) : 0;
  const need = breakNeeded(d);
  const left = DRIVING.CONTINUOUS_MAX_S - d.sinceBreak;
  const dLimit = dayLimit(d);
  const dayLeft = (d.day > DRIVING.DAY_MAX_S ? dLimit : DRIVING.DAY_MAX_S) - d.day;
  const wLimit = weekLimit(d);
  const wLeft = wLimit - d.week.driving;
  let level = 'ok';
  let main;
  if (stopped && d.stopWork) {
    main = `Arrêt ${cur >= 60 ? `${minutes(cur)} ` : ''}compté comme travail (pas une pause)`;
  } else if (stopped && cur >= 60 && d.sinceBreak > 0) {
    if (cur >= DRIVING.DAILY_REST_S) main = `Repos ${hm(cur)} : repos journalier fait`;
    else if (cur >= need) main = `Pause ${minutes(cur)} faite : 4 h 30 de conduite possibles`;
    else if (!d.split && cur >= DRIVING.BREAK_FIRST_S) main = `Pause ${minutes(cur)} : encore ${minutes(need - cur)} pour 45 min (15 min déjà comptées)`;
    else main = `Pause ${minutes(cur)} : encore ${minutes(need - cur)} pour ${minutes(need)}`;
    if (left <= 0) level = 'over';
  } else if (left <= 0) {
    level = 'over';
    main = `Pause de ${minutes(need)} obligatoire : 4 h 30 de conduite dépassées de ${minutes(-left)}`;
  } else {
    if (left <= DRIVING.WARN_BEFORE_S) level = 'soon';
    main = `Conduite ${hm(d.sinceBreak)} · pause de ${minutes(need)} dans ${hm(left)}`;
  }
  let detail;
  if (d.day >= DRIVING.DAY_EXTENDED_S || (d.day >= DRIVING.DAY_MAX_S && dLimit === DRIVING.DAY_MAX_S)) {
    level = 'over';
    detail = `Jour ${hm(d.day)} : maximum atteint, repos journalier`;
  } else if (d.day >= DRIVING.DAY_MAX_S) {
    if (level === 'ok') level = 'soon';
    detail = `Jour ${hm(d.day)} / 10 h (prolongation, 2 fois par semaine)`;
  } else {
    if (dayLeft <= DRIVING.WARN_BEFORE_S && level === 'ok') level = 'soon';
    detail = `Jour ${hm(d.day)} / 9 h`;
  }
  if (wLeft <= DRIVING.WEEK_SHOW_LEFT_S) {
    detail += ` · semaine ${hm(d.week.driving)} / ${hm(wLimit)}`;
    if (wLeft <= 0) level = 'over';
  }
  const slow = !isNum(speedKmh) || speedKmh < DRIVING.WORK_BUTTON_KMH;
  const target = stopped ? { work: d.stopWork } : d.last;
  return {
    level, main, detail, stopped,
    canMarkWork: slow && !!target,
    workLabel: target?.work ? 'Compter comme pause' : 'Pas une pause (travail)',
    sinceBreak: d.sinceBreak, left, day: d.day, dayLeft,
  };
}

/**
 * Annonces vocales du décompte (une fois par période) : 30 min avant 4 h 30, à 4 h 30, 30 min avant 9 h, à 9 h et
 * 10 h, 56 h de la semaine ; à l'arrêt, 15 min comptées et pause faite.
 * @param {{ nextArea?:{ name:string, distance:number }|null }} opts aire proposée dans l'annonce « dans 30 minutes »
 * @returns {{ state:object, speak:string[] }}
 */
export function drivingAnnouncements(state, t, { nextArea = null } = {}) {
  const d = clone(state);
  const speak = [];
  const once = (key, text) => {
    if (d.announced[key]) return;
    d.announced[key] = true;
    speak.push(text);
  };
  const need = breakNeeded(d);
  const left = DRIVING.CONTINUOUS_MAX_S - d.sinceBreak;
  if (d.mode === 'drive') {
    const b = `b:${d.breakFrom}`;
    if (left <= 0) {
      once(`${b}:over`, `4 heures 30 de conduite : faites une pause de ${spoken(need)} dès que possible.`);
      d.announced[`${b}:soon`] = true;
    } else if (left <= DRIVING.WARN_BEFORE_S) {
      const area = nextArea && nextArea.distance > 0
        ? ` Prochaine aire : ${nextArea.name}, dans ${Math.max(1, Math.round(nextArea.distance / 1000))} kilomètres.` : '';
      once(`${b}:soon`, `Pause de ${spoken(need)} à faire dans ${spoken(left)}.${area}`);
    }
    const day = `d:${d.dayFrom}`;
    const others = DRIVING.EXTENSIONS_PER_WEEK - d.week.extensions; // prolongations restantes après aujourd'hui
    if (d.day >= DRIVING.DAY_EXTENDED_S) {
      once(`${day}:10`, '10 heures de conduite aujourd\'hui : maximum atteint. Prévoyez le repos journalier.');
    } else if (d.day >= DRIVING.DAY_MAX_S) {
      once(`${day}:9`, canExtend(d)
        ? `9 heures de conduite aujourd'hui. Prolongation possible jusqu'à 10 heures${others > 0 ? ', encore une autre cette semaine' : ', la dernière de la semaine'}.`
        : '9 heures de conduite aujourd\'hui : plus de prolongation cette semaine. Prévoyez le repos journalier.');
      d.announced[`${day}:soon`] = true;
    } else if (DRIVING.DAY_MAX_S - d.day <= DRIVING.WARN_BEFORE_S) {
      once(`${day}:soon`, `Conduite du jour : 9 heures dans ${spoken(DRIVING.DAY_MAX_S - d.day)}.`);
    }
    if (d.week.driving >= weekLimit(d)) once(`w:${d.week.start}:max`, 'Limite de conduite de la semaine atteinte.');
  } else if (d.stopStart !== null && !d.stopWork && d.sinceBreak > 0 && isNum(t)) {
    const cur = (t - d.stopStart) / 1000;
    const s = `s:${d.stopStart}`;
    if (cur >= need) {
      once(`${s}:done`, `Pause de ${spoken(need)} faite.`);
      d.announced[`${s}:15`] = true;
    } else if (!d.split && cur >= DRIVING.BREAK_FIRST_S) {
      once(`${s}:15`, '15 minutes de pause comptées. Il faudra encore 30 minutes, maintenant ou plus tard, avant 4 heures 30 de conduite.');
    }
  }
  return { state: d, speak };
}

/**
 * Avant le départ (fiche de l'itinéraire) : où tomberont la pause de 4 h 30 et la limite du jour, d'après le décompte
 * et la durée ORS (sans les pauses).
 * @returns {{ level:'warn'|'info', text:string }[]}
 */
export function planDriving(state, route, now = Date.now()) {
  if (!state || !isNum(route?.duration)) return [];
  const d = drivingAt(state, now);
  const lines = [];
  const samples = sampleRoute(route, 1000);
  const kmAt = (s) => {
    const p = samples.find((x) => x.time >= s);
    return p ? Math.round(p.along / 1000) : null;
  };
  const need = breakNeeded(d);
  const left = Math.max(0, DRIVING.CONTINUOUS_MAX_S - d.sinceBreak);
  if (d.sinceBreak > 0 || d.day > 0) {
    lines.push({ level: 'info', text: `Temps de conduite : ${hm(d.sinceBreak)} depuis la dernière pause, ${hm(d.day)} aujourd'hui. ${DRIVING.NOTICE}` });
  }
  if (route.duration > left) {
    const km = kmAt(left);
    lines.push({
      level: 'warn',
      text: left <= 0
        ? `Pause de ${minutes(need)} à faire avant de partir (4 h 30 de conduite atteintes).`
        : `Pause de ${minutes(need)} à prévoir après ${hm(left)} de route${km !== null ? ` (vers km ${km})` : ''}.`,
    });
  }
  const dayLeft = DRIVING.DAY_MAX_S - d.day;
  if (route.duration > dayLeft) {
    const km = kmAt(Math.max(0, dayLeft));
    const ext = canExtend(d);
    lines.push({
      level: 'warn',
      text: `Conduite du jour : 9 h atteintes${km !== null && dayLeft > 0 ? ` vers km ${km}` : ''}${ext ? ' (10 h possibles 2 fois par semaine)' : ' ; plus de prolongation cette semaine'}.`,
    });
  }
  const wLeft = weekLimit(d) - d.week.driving;
  if (route.duration > wLeft) lines.push({ level: 'warn', text: `Conduite de la semaine : limite atteinte pendant ce trajet (${hm(weekLimit(d))}).` });
  return lines;
}

/** Lecture sur l'appareil (localStorage injectable). */
export function loadDriving(storage) {
  try {
    return sanitizeDriving(JSON.parse(storage.getItem(DRIVING.STORAGE_KEY) ?? 'null'));
  } catch {
    return emptyDriving();
  }
}

export function saveDriving(storage, state) {
  try {
    storage.setItem(DRIVING.STORAGE_KEY, JSON.stringify(sanitizeDriving(state)));
  } catch {
    // stockage plein ou bloqué : le décompte reste en mémoire pendant ce guidage
  }
}
