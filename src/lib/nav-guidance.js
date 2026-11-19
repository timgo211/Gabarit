// Guidage : manœuvres de l'itinéraire, paliers d'annonce selon la vitesse, phrases en français, flèches.
// Logique pure.
// Types de manœuvre ORS (champ steps[].type), d'après la documentation officielle
// https://github.com/GIScience/openrouteservice/blob/main/docs/api-reference/endpoints/directions/instruction-types.md
// Textes français d'ORS (language: 'fr') : ors-engine/src/main/resources/resources/locales/ors_fr-FR.resources

export const STEP_TYPES = Object.freeze({
  LEFT: 0,
  RIGHT: 1,
  SHARP_LEFT: 2,
  SHARP_RIGHT: 3,
  SLIGHT_LEFT: 4,
  SLIGHT_RIGHT: 5,
  STRAIGHT: 6,
  ENTER_ROUNDABOUT: 7,
  EXIT_ROUNDABOUT: 8,
  UTURN: 9,
  GOAL: 10,
  DEPART: 11,
  KEEP_LEFT: 12,
  KEEP_RIGHT: 13,
});

/**
 * Paliers d'annonce : distance = vitesse × durée, bornée. Un camion a besoin d'être prévenu tôt.
 * À 90 km/h (25 m/s) : 60 s → 1 500 m, 20 s → 500 m, 4,8 s → 120 m.
 */
export const ANNOUNCE_STAGES = Object.freeze({
  far: { seconds: 60, min: 400, max: 2500 },
  near: { seconds: 20, min: 150, max: 800 },
  now: { seconds: 4.8, min: 30, max: 200 },
});
const STAGE_RANK = { far: 1, near: 2, now: 3 };
/** Pas d'annonce « loin » si on est presque au palier « proche » (et idem proche/maintenant). */
const FAR_MARGIN_M = 100;
const NEAR_MARGIN_M = 40;
/** Deux manœuvres plus proches que cela sont annoncées ensemble (« …, puis … »). */
export const THEN_MAX_GAP_M = 200;

export const UTURN_SAFE_TEXT = 'Faites demi-tour dès que possible, en sécurité';
export const ARRIVED_TEXT = 'Destination atteinte';

/** Distances des trois paliers pour une vitesse en m/s. */
export function announceDistances(speedMs) {
  const v = typeof speedMs === 'number' && Number.isFinite(speedMs) && speedMs > 0 ? speedMs : 0;
  const out = {};
  for (const [k, s] of Object.entries(ANNOUNCE_STAGES)) out[k] = Math.min(s.max, Math.max(s.min, v * s.seconds));
  return out;
}

/** Rang d'un palier (0 = rien d'annoncé). */
export function stageRank(stage) {
  return STAGE_RANK[stage] ?? 0;
}

/**
 * Palier à annoncer maintenant pour une manœuvre, ou null.
 * @param {number} distance distance restante jusqu'à la manœuvre (m)
 * @param {number} speedMs vitesse (m/s)
 * @param {string|null} done palier le plus urgent déjà annoncé pour cette manœuvre
 * @param {boolean} isGoal l'arrivée n'a pas de palier « maintenant » (remplacé par « Destination atteinte »)
 */
export function stageToAnnounce(distance, speedMs, done = null, isGoal = false) {
  if (!(distance >= 0)) return null;
  const d = announceDistances(speedMs);
  let stage = null;
  if (distance <= d.now) stage = isGoal ? null : 'now';
  else if (distance <= d.near) stage = distance - d.now >= NEAR_MARGIN_M || isGoal ? 'near' : null;
  else if (distance <= d.far) stage = distance - d.near >= FAR_MARGIN_M ? 'far' : null;
  if (!stage || stageRank(stage) <= stageRank(done)) return null;
  return stage;
}

/**
 * Manœuvres annonçables d'un itinéraire (étape de départ exclue), avec leur position sur le tracé.
 * La manœuvre d'une étape a lieu au début de l'étape (way_points[0]) ; l'arrivée, à la fin du tracé.
 * @param {object[]} steps étapes lues par parseDirections
 * @param {number[]} cum distances cumulées du tracé (nav-geo prepareLine)
 * @returns {{ step:number, type:number|null, instruction:string, name:string, exitNumber:number|null,
 *   at:number, startIndex:number, endIndex:number, duration:number }[]}
 */
export function buildManeuvers(steps, cum) {
  const last = cum.length - 1;
  const out = [];
  (steps ?? []).forEach((s, i) => {
    if (!s?.wayPoints) return;
    const startIndex = Math.min(Math.max(0, s.wayPoints[0]), last);
    const endIndex = Math.min(Math.max(startIndex, s.wayPoints[1]), last);
    const goal = s.type === STEP_TYPES.GOAL;
    out.push({
      step: i,
      type: s.type,
      instruction: s.instruction ?? '',
      name: s.name ?? '',
      exitNumber: s.exitNumber ?? null,
      at: goal ? cum[endIndex] : cum[startIndex],
      startIndex,
      endIndex,
      duration: typeof s.duration === 'number' ? s.duration : 0,
    });
  });
  return out;
}

/** La première manœuvre est-elle l'étape de départ (type 11, ou toute première étape) ? */
export function isDepart(m, index) {
  return m.type === STEP_TYPES.DEPART || (index === 0 && m.at === 0 && m.type !== STEP_TYPES.UTURN && m.type !== STEP_TYPES.GOAL);
}

/**
 * Prochaine manœuvre après la distance parcourue « along » (et la suivante, pour « puis »).
 * @returns {{ index:number, distance:number, then:number|null, thenGap:number|null }|null}
 */
export function nextManeuver(maneuvers, along) {
  for (let i = 0; i < maneuvers.length; i += 1) {
    const m = maneuvers[i];
    if (isDepart(m, i)) continue;
    const isGoal = m.type === STEP_TYPES.GOAL;
    if (m.at > along + 0.5 || (isGoal && i === maneuvers.length - 1)) {
      const nxt = maneuvers[i + 1];
      return {
        index: i,
        distance: Math.max(0, m.at - along),
        then: nxt ? i + 1 : null,
        thenGap: nxt ? Math.max(0, nxt.at - m.at) : null,
      };
    }
  }
  return null;
}

/** Première manœuvre réelle d'un itinéraire (après le départ), ou -1. */
export function firstManeuverIndex(maneuvers) {
  return maneuvers.findIndex((m, i) => !isDepart(m, i));
}

/** « 500 mètres », « 1,5 kilomètre », « 2 kilomètres » : arrondi lisible à l'oral. */
export function spokenDistance(meters) {
  const m = Math.max(0, meters);
  if (m < 100) return `${Math.max(10, Math.round(m / 10) * 10)} mètres`;
  if (m < 975) return `${Math.round(m / 50) * 50} mètres`;
  const km = Math.max(1, Math.round(m / 500) / 2);
  const txt = String(km).replace('.', ',');
  return `${txt} ${km < 2 ? 'kilomètre' : 'kilomètres'}`;
}

function lcFirst(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** Côté de la destination tiré de l'instruction ORS d'arrivée (« …, sur la droite »). */
export function arrivalSide(instruction) {
  const m = /(sur la droite|sur la gauche|droit devant)/i.exec(instruction ?? '');
  return m ? m[1].toLowerCase() : '';
}

/** Texte d'une manœuvre à l'impératif, tel qu'affiché et prononcé. */
export function maneuverText(m, { uturnSafe = false } = {}) {
  if (!m) return '';
  if (uturnSafe && m.type === STEP_TYPES.UTURN) return UTURN_SAFE_TEXT;
  if (m.type === STEP_TYPES.GOAL) {
    const side = arrivalSide(m.instruction);
    return side ? `Vous arrivez à destination, ${side}` : 'Vous arrivez à destination';
  }
  return (m.instruction || '').trim() || 'Continuez';
}

/** Phrase « Destination atteinte » (avec le côté si ORS le donne). */
export function arrivedText(goal) {
  const side = arrivalSide(goal?.instruction);
  return side ? `${ARRIVED_TEXT}, ${side}.` : `${ARRIVED_TEXT}.`;
}

/**
 * Phrase d'annonce.
 * @param {{ maneuver:object, stage:'far'|'near'|'now', distance:number, then?:object|null, thenGap?:number|null, uturnSafe?:boolean }} p
 */
export function announcementText({ maneuver, stage, distance, then = null, thenGap = null, uturnSafe = false }) {
  const main = maneuverText(maneuver, { uturnSafe });
  let text = stage === 'now' ? main : `Dans ${spokenDistance(distance)}, ${lcFirst(main)}`;
  if (then && stage !== 'far' && typeof thenGap === 'number' && thenGap <= THEN_MAX_GAP_M) {
    text += `, puis ${lcFirst(maneuverText(then))}`;
  }
  return `${text}.`;
}

/**
 * Pictogramme d'une manœuvre : flèche orientée (angle en degrés, 0 = tout droit, positif = à droite),
 * rond-point (avec numéro de sortie), demi-tour ou arrivée.
 * @returns {{ kind:'arrow'|'roundabout'|'uturn'|'goal', angle:number, exit:number|null }}
 */
export function maneuverIcon(type, exitNumber = null) {
  const T = STEP_TYPES;
  const angles = {
    [T.LEFT]: -90, [T.RIGHT]: 90, [T.SHARP_LEFT]: -135, [T.SHARP_RIGHT]: 135,
    [T.SLIGHT_LEFT]: -45, [T.SLIGHT_RIGHT]: 45, [T.STRAIGHT]: 0, [T.DEPART]: 0,
    [T.KEEP_LEFT]: -30, [T.KEEP_RIGHT]: 30, [T.EXIT_ROUNDABOUT]: 0,
  };
  if (type === T.ENTER_ROUNDABOUT) return { kind: 'roundabout', angle: 0, exit: Number.isInteger(exitNumber) ? exitNumber : null };
  if (type === T.UTURN) return { kind: 'uturn', angle: 0, exit: null };
  if (type === T.GOAL) return { kind: 'goal', angle: 0, exit: null };
  return { kind: 'arrow', angle: angles[type] ?? 0, exit: null };
}

/**
 * Choisit une voix française parmi speechSynthesis.getVoices() :
 * fr-FR installée sur l'appareil d'abord, puis fr-FR en ligne, puis toute voix « fr ».
 * @param {{ lang:string, localService?:boolean, default?:boolean, name?:string }[]} voices
 */
export function pickFrenchVoice(voices) {
  const list = Array.isArray(voices) ? voices.filter((v) => v && typeof v.lang === 'string') : [];
  const lang = (v) => v.lang.replace('_', '-').toLowerCase();
  const score = (v) => {
    const l = lang(v);
    if (!l.startsWith('fr')) return -1;
    return (l === 'fr-fr' ? 4 : 0) + (v.localService ? 2 : 0) + (v.default ? 1 : 0);
  };
  let best = null;
  let bestScore = -1;
  for (const v of list) {
    const s = score(v);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Nom de la route où l'on roule (phase 7c) : nom de l'étape ORS en cours. Une étape ORS va d'une manœuvre à la
 * suivante et porte le nom de la voie prise (« name », « - » ou vide si la voie n'a pas de nom).
 * @param {object[]} maneuvers buildManeuvers()
 * @param {number[]} cum distances cumulées du tracé
 * @param {number} along distance parcourue sur le tracé (m)
 * @returns {string|null}
 */
export function currentRoadName(maneuvers, cum, along) {
  if (!Array.isArray(maneuvers) || !Array.isArray(cum) || !Number.isFinite(along)) return null;
  let cur = null;
  for (const m of maneuvers) {
    if (m.type === STEP_TYPES.GOAL) continue;
    if (cum[m.startIndex] <= along + 0.5) cur = m;
    else break;
  }
  const name = typeof cur?.name === 'string' ? cur.name.trim() : '';
  return name && name !== '-' ? name : null;
}

/** Voix françaises installées, triées (France d'abord, puis locales, puis par nom), sans doublon de nom. */
export function frenchVoices(voices) {
  const list = Array.isArray(voices) ? voices : [];
  const seen = new Set();
  const out = [];
  for (const v of list) {
    if (!v || typeof v.lang !== 'string' || typeof v.name !== 'string' || !v.name) continue;
    if (!v.lang.replace('_', '-').toLowerCase().startsWith('fr') || seen.has(v.name)) continue;
    seen.add(v.name);
    out.push(v);
  }
  const rank = (v) => (v.lang.replace('_', '-').toLowerCase() === 'fr-fr' ? 0 : 2) + (v.localService ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr'));
}

/** Voix choisie dans Réglages si elle est encore installée, sinon la meilleure voix française. */
export function pickVoice(voices, name) {
  const fr = frenchVoices(voices);
  return (name && fr.find((v) => v.name === name)) || pickFrenchVoice(voices);
}
