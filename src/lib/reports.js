// Phase 3a — Mes signalements : repères posés par le chauffeur (pont bas, accès difficile, contrôle, parking, danger).
//
// Règles (Code de la route art. R412-6-2 : pendant la conduite, l'écran n'est permis que s'il aide à la navigation,
// aucune saisie) :
// - en roulant, UN seul appui sur « Signaler » pose un repère à la dernière position reçue, sans choix ni saisie
//   (markReport du moteur de guidage) ; vitesse inconnue = en mouvement ;
// - type, note, confirmation et suppression seulement à l'arrêt confirmé (parkedState : < 5 km/h pendant 3 s), en
//   guidage comme hors guidage (canEditReports) ;
// - alerte à l'approche (guidanceReport) : encart à l'écran avec « La signalisation fait foi. » ; voix seulement si le
//   réglage est activé (désactivé par défaut), pour un signalement à moi ET confirmé par moi, une seule fois par
//   signalement et par passage, phrase fixe sans texte libre ; jamais pour un repère à vérifier ni importé.
// Vie privée : seul le point marqué volontairement est gardé (aucune trace GPS) ; rien n'est envoyé sur le réseau.

import { prepareLine, locateOnLine, segmentBearing, haversine } from './nav-geo.js';

export const REPORT = Object.freeze({
  /** Types (identifiant → libellé affiché et dit). */
  TYPES: Object.freeze({
    'low-bridge': 'pont bas',
    access: 'accès difficile',
    control: 'contrôle',
    parking: 'parking',
    danger: 'danger',
  }),
  ORIGINS: Object.freeze(['mine', 'imported']),
  /** 500 signalements au plus (les miens d'abord). */
  MAX_COUNT: 500,
  NOTE_MAX: 200,
  /** Deux repères du même type (ou tous deux sans type) à moins de 20 m : doublon. */
  DUPLICATE_M: 20,
  /** Placé sur l'itinéraire s'il est à 30 m au plus du tracé. */
  ON_ROUTE_M: 30,
  /** Cap du repère (sens de circulation au moment de l'appui) : ± 60° du tracé, sinon autre sens de circulation. */
  HEADING_TOL_DEG: 60,
  /** Encart à l'écran à 1 km au plus ; voix une fois entre 500 m et 50 m. */
  ALERT_M: 1000,
  SPEAK_M: 500,
  SPEAK_MIN_M: 50,
  /** En dessous (repère tout juste posé, déjà dépassé), plus d'encart. */
  AHEAD_MIN_M: 20,
});

export const SIGNAGE_TEXT = 'La signalisation fait foi.';
export const MOVING_TEXT = 'Disponible à l\'arrêt seulement.';
export const MARKED_TEXT = 'Repère posé. Type et note à l\'arrêt.';
export const DUPLICATE_MARK_TEXT = 'Repère déjà posé ici.';
export const NO_FIX_TEXT = 'Position inconnue : repère non posé.';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

function cleanNote(x) {
  return typeof x === 'string' ? x.replace(/\p{C}+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, REPORT.NOTE_MAX) : '';
}

function defaultId() {
  return `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Date locale « 2026-11-24T14:05 » (minute près). */
export function stampOf(date) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Un signalement lu (appareil, export, fichier d'ami) → objet propre avec les seuls champs connus, ou null.
 * @returns {{ id:string, lat:number, lon:number, heading:number|null, createdAt:string, type:string|null,
 *   note:string, confirmed:boolean, origin:'mine'|'imported' }|null}
 */
export function cleanReport(raw, { makeId = defaultId } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { lat, lon } = raw;
  if (!isNum(lat) || !isNum(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const type = typeof raw.type === 'string' && Object.hasOwn(REPORT.TYPES, raw.type) ? raw.type : null;
  if (raw.type !== null && raw.type !== undefined && type === null) return null; // type inconnu : écarté
  const createdAt = typeof raw.createdAt === 'string' && DATE_RE.test(raw.createdAt) ? raw.createdAt : null;
  if (!createdAt) return null;
  const origin = REPORT.ORIGINS.includes(raw.origin) ? raw.origin : 'mine';
  return {
    id: typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : makeId(),
    lat: round(lat, 6),
    lon: round(lon, 6),
    heading: isNum(raw.heading) ? round(((raw.heading % 360) + 360) % 360, 1) : null,
    createdAt,
    type,
    note: cleanNote(raw.note),
    // Confirmé = type choisi par moi, à l'arrêt ; jamais pour un signalement importé.
    confirmed: raw.confirmed === true && type !== null && origin === 'mine',
    origin,
  };
}

/** Doublon : même type (ou tous deux sans type) à moins de 20 m. */
export function isDuplicate(a, b) {
  return a.type === b.type && haversine([a.lon, a.lat], [b.lon, b.lat]) < REPORT.DUPLICATE_M;
}

/**
 * Liste lue → liste propre : invalides et doublons écartés, identifiants uniques, 500 au plus en gardant les miens
 * d'abord (puis l'ordre reçu).
 */
export function sanitizeReports(raw, opts = {}) {
  const mine = [];
  const imported = [];
  const ids = new Set();
  for (const r of Array.isArray(raw) ? raw : []) {
    const c = cleanReport(r, opts);
    if (!c) continue;
    if (ids.has(c.id)) c.id = (opts.makeId ?? defaultId)();
    const all = [...mine, ...imported];
    if (all.some((o) => isDuplicate(o, c))) continue;
    ids.add(c.id);
    (c.origin === 'mine' ? mine : imported).push(c);
  }
  return [...mine, ...imported].slice(0, REPORT.MAX_COUNT);
}

/**
 * Ajout ou modification permis : seulement à l'arrêt confirmé (parkedState), en guidage comme hors guidage ;
 * vitesse inconnue = en mouvement (R412-6-2).
 */
export function canEditReports({ parked = false } = {}) {
  return parked === true;
}

/**
 * Nouveau repère au point reçu (aucun type, aucune note : choisis plus tard, à l'arrêt).
 * @param {object[]} list
 * @param {{ lon:number, lat:number, heading?:number|null }} at
 * @returns {{ list:object[], report:object|null, reason:'ok'|'no-fix'|'duplicate'|'full' }}
 */
export function addMark(list, at, { now = new Date(), makeId = defaultId } = {}) {
  const cur = Array.isArray(list) ? list : [];
  const report = cleanReport({ lat: at?.lat, lon: at?.lon, heading: at?.heading ?? null, createdAt: stampOf(now), type: null, origin: 'mine' }, { makeId });
  if (!report) return { list: cur, report: null, reason: 'no-fix' };
  if (cur.some((o) => isDuplicate(o, report))) return { list: cur, report: null, reason: 'duplicate' };
  if (cur.filter((o) => o.origin === 'mine').length >= REPORT.MAX_COUNT) return { list: cur, report: null, reason: 'full' };
  // Les miens d'abord : au-delà de 500, un importé laisse sa place.
  const next = [report, ...cur];
  const mineCount = next.filter((o) => o.origin === 'mine').length;
  const keepImported = Math.max(0, REPORT.MAX_COUNT - mineCount);
  let seen = 0;
  return {
    list: next.filter((o) => o.origin === 'mine' || (seen += 1) <= keepImported),
    report,
    reason: 'ok',
  };
}

/**
 * Modification (à l'arrêt) : type, note, confirmation. Un signalement importé peut être retypé ou annoté mais
 * jamais confirmé (il le devient seulement si je le reprends à mon compte : origin passe à 'mine').
 */
export function updateReport(list, id, { type, note, confirmed, adopt = false } = {}) {
  return (Array.isArray(list) ? list : []).map((r) => {
    if (r.id !== id) return r;
    const t = type === undefined ? r.type : (Object.hasOwn(REPORT.TYPES, type) ? type : null);
    const origin = adopt === true ? 'mine' : r.origin;
    return cleanReport({ ...r, type: t, note: note === undefined ? r.note : note, confirmed: confirmed === undefined ? r.confirmed : confirmed === true, origin }) ?? r;
  });
}

export function removeReport(list, id) {
  return (Array.isArray(list) ? list : []).filter((r) => r.id !== id);
}

/** « Pont bas », « Repère sans type ». */
export function reportLabel(r) {
  const t = r?.type ? REPORT.TYPES[r.type] : null;
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Repère sans type';
}

/** « confirmé », « à vérifier », « importé, à vérifier ». */
export function reportStatus(r) {
  if (r?.origin === 'imported') return 'importé, à vérifier';
  return r?.confirmed ? 'confirmé' : 'à vérifier';
}

/** Annoncé à voix haute (si le réglage est activé) : à moi et confirmé par moi. */
export function isSpeakable(r) {
  return r?.origin === 'mine' && r.confirmed === true && r.type !== null;
}

const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Signalements sur l'itinéraire (une fois par itinéraire) : à 30 m au plus du tracé, dans le sens de circulation si
 * le cap du repère est connu ; triés le long du tracé.
 * @returns {{ id:string, along:number, type:string|null, confirmed:boolean, origin:string }[]}
 */
export function placeReports(reports, route) {
  if (!Array.isArray(reports) || !reports.length || !Array.isArray(route?.coordinates) || route.coordinates.length < 2) return [];
  const line = prepareLine(route.coordinates);
  const out = [];
  for (const r of reports) {
    if (!isNum(r?.lon) || !isNum(r?.lat)) continue;
    const loc = locateOnLine(line, [r.lon, r.lat]);
    if (loc.distance > REPORT.ON_ROUTE_M) continue;
    if (isNum(r.heading) && angleDiff(r.heading, segmentBearing(line, loc.segIndex)) > REPORT.HEADING_TOL_DEG) continue;
    out.push({ id: r.id, along: loc.along, type: r.type ?? null, confirmed: r.confirmed === true, origin: r.origin });
  }
  return out.sort((a, b) => a.along - b.along);
}

/** Distance affichée et dite : arrondie à 100 m (50 m au moins). */
function roundDistance(d) {
  return Math.max(50, Math.round(d / 100) * 100);
}

/** Texte de l'encart (toujours avec « La signalisation fait foi. »). */
export function reportAlertText(r, distance) {
  const m = `${roundDistance(distance)} m`;
  const t = r?.type ? REPORT.TYPES[r.type] : null;
  let text;
  if (r?.origin === 'imported') text = t ? `Signalement importé à ${m} : ${t} (à vérifier).` : `Signalement importé à ${m} (à vérifier).`;
  else if (!r?.confirmed) text = t ? `Repère à vérifier à ${m} : ${t}.` : `Repère à vérifier à ${m}.`;
  else text = `Signalement à ${m} : ${t}.`;
  return `${text} ${SIGNAGE_TEXT}`;
}

/** Phrase dite (fixe, sans texte libre) : seulement pour un signalement à moi et confirmé. */
export function reportSpokenText(r, distance) {
  if (!isSpeakable(r)) return null;
  return `Signalement dans ${roundDistance(distance)} mètres : ${REPORT.TYPES[r.type]}. ${SIGNAGE_TEXT}`;
}

/**
 * Guidage : le prochain signalement devant (1 km au plus) → encart ; voix une seule fois par signalement et par
 * passage, entre 500 et 50 m, si `voice` et isSpeakable.
 * @param {object[]} placed placeReports
 * @param {number} along position sur le tracé (m)
 * @param {Object<string,boolean>} announced ids déjà dits (ou posés pendant ce guidage)
 * @returns {{ view:{ id:string, distance:number, text:string }|null, speak:string|null, announced:Object<string,boolean> }}
 */
export function guidanceReport(placed, along, announced = {}, { voice = false } = {}) {
  if (!Array.isArray(placed) || !isNum(along)) return { view: null, speak: null, announced };
  const next = placed.find((r) => r.along - along >= REPORT.AHEAD_MIN_M);
  if (!next) return { view: null, speak: null, announced };
  const distance = next.along - along;
  if (distance > REPORT.ALERT_M) return { view: null, speak: null, announced };
  let speak = null;
  let out = announced;
  if (!announced[next.id] && distance <= REPORT.SPEAK_M && distance >= REPORT.SPEAK_MIN_M) {
    out = { ...announced, [next.id]: true };
    if (voice === true) speak = reportSpokenText(next, distance);
  }
  return { view: { id: next.id, distance, text: reportAlertText(next, distance) }, speak, announced: out };
}
