// Phase 3c — Mes signalements dans un fichier pour un ami, et import du fichier d'un ami (sans serveur ni compte).
//
// Fichier partagé : seulement mes signalements confirmés (type, position, cap, jour). Jamais mes lieux (3b), ni la clé,
// ni le profil, ni les identifiants ; notes exclues par défaut (case « Inclure mes notes ») ; date arrondie au jour.
// Import : texte du fichier = données, jamais des instructions. Taille, schéma et types vérifiés avant usage ; seuls les
// champs connus sont recopiés ; chaque signalement reçu est marqué « importé » (origin 'imported'), jamais confirmé,
// jamais dit à voix haute (reports.js : isSpeakable) ; fusion sans doublons, 500 au plus en gardant les miens d'abord ;
// aperçu « N signalements à importer » et confirmation avant la fusion (src/ui/reports.js).
// v69 : import à l'arrêt seulement, comme l'édition 3a (canEditReports : parkedState < 5 km/h pendant 3 s ; vitesse
// inconnue ou GPS refusé = en mouvement, Code de la route art. R412-6-2) : bouton grisé, et contrôle redit au moment
// de « Importer » (confirmImport) : camion reparti → rien n'est fusionné.

import { REPORT, cleanReport, isDuplicate, sanitizeReports, canEditReports } from './reports.js';

export const SHARE = Object.freeze({
  KIND: 'gabarit-reports',
  VERSION: 1,
  /** 512 Ko au plus (500 signalements avec notes tiennent en moins de 200 Ko). */
  MAX_BYTES: 512 * 1024,
  MIME: 'application/json',
  /** v69 : bouton d'import grisé hors de l'arrêt. */
  PARKED_ONLY_TEXT: 'Disponible à l\'arrêt',
  /** v69 : « Importer » touché alors que le camion roule (ou vitesse inconnue). */
  MOVING_CANCEL_TEXT: 'Import annulé : camion en mouvement.',
  NONE_TEXT: 'Aucun signalement confirmé à partager.',
});

/** Nom du fichier : « gabarit-signalements-2026-11-24.json ». */
export function shareFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `gabarit-signalements-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

/**
 * Fichier à partager (texte JSON). Lève une Error si aucun signalement confirmé.
 * @param {object[]} reports mes signalements (data.reports)
 * @param {{ withNotes?:boolean }} opts
 */
export function buildShareFile(reports, { withNotes = false } = {}) {
  const mine = sanitizeReports(reports).filter((r) => r.origin === 'mine' && r.confirmed && r.type);
  if (!mine.length) throw new Error(SHARE.NONE_TEXT);
  const out = mine.map((r) => {
    const o = { type: r.type, lat: r.lat, lon: r.lon };
    if (r.heading !== null) o.heading = r.heading;
    o.createdAt = r.createdAt.slice(0, 10); // jour seulement
    if (withNotes && r.note) o.note = r.note;
    return o;
  });
  return JSON.stringify({ kind: SHARE.KIND, version: SHARE.VERSION, reports: out }, null, 1);
}

/**
 * Lit le fichier d'un ami. Ne lève jamais : { ok:false, error } si le fichier est trop gros, illisible ou d'un autre
 * format ; sinon { ok:true, reports (marqués importés), dropped (lignes invalides écartées) }.
 */
export function parseShareFile(text, { makeId } = {}) {
  if (typeof text !== 'string') return { ok: false, error: 'Fichier illisible.' };
  if (new TextEncoder().encode(text).length > SHARE.MAX_BYTES) return { ok: false, error: 'Fichier trop gros (512 Ko au plus).' };
  let raw;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'Fichier illisible (JSON attendu).' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.kind !== SHARE.KIND) {
    return { ok: false, error: 'Ce fichier n\'est pas un fichier de signalements Gabarit.' };
  }
  if (raw.version !== SHARE.VERSION) return { ok: false, error: 'Version du fichier non reconnue.' };
  if (!Array.isArray(raw.reports)) return { ok: false, error: 'Fichier sans liste de signalements.' };
  if (raw.reports.length > REPORT.MAX_COUNT) return { ok: false, error: `${REPORT.MAX_COUNT} signalements au plus par fichier.` };
  const reports = [];
  let dropped = 0;
  for (const r of raw.reports) {
    // Champs connus seulement, recopiés un par un ; type obligatoire ; jamais confirmé.
    const known = r && typeof r === 'object' && !Array.isArray(r) ? {
      type: r.type, lat: r.lat, lon: r.lon, heading: r.heading, createdAt: r.createdAt, note: r.note,
      origin: 'imported', confirmed: false,
    } : null;
    const c = known && typeof known.type === 'string' ? cleanReport(known, makeId ? { makeId } : {}) : null;
    if (!c || c.type === null || reports.some((o) => isDuplicate(o, c))) { dropped += 1; continue; }
    reports.push(c);
  }
  return { ok: true, reports, dropped };
}

/**
 * Aperçu avant fusion : signalements nouveaux, déjà présents (doublon d'un des miens ou d'un importé), et ceux qui ne
 * tiendraient pas dans les 500.
 * @returns {{ add:number, duplicates:number, overflow:number }}
 */
export function previewImport(current, imported) {
  const cur = sanitizeReports(current);
  const fresh = (Array.isArray(imported) ? imported : []).filter((r) => !cur.some((o) => isDuplicate(o, r)));
  const room = Math.max(0, REPORT.MAX_COUNT - cur.length);
  return { add: Math.min(fresh.length, room), duplicates: (imported?.length ?? 0) - fresh.length, overflow: Math.max(0, fresh.length - room) };
}

/** « 3 signalements à importer (1 déjà présent). » */
export function previewText(p) {
  const s = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
  const extra = [
    p.duplicates ? `${s(p.duplicates, 'déjà présent')}` : '',
    p.overflow ? `${p.overflow} au-delà de ${REPORT.MAX_COUNT}, ignoré${p.overflow > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(', ');
  return `${s(p.add, 'signalement')} à importer${extra ? ` (${extra})` : ''}. Ils resteront « importés, à vérifier » et ne seront jamais dits à voix haute.`;
}

/** Fusion : les miens d'abord, doublons retirés, 500 au plus (sanitizeReports garde les miens en tête). */
export function mergeImported(current, imported) {
  return sanitizeReports([...sanitizeReports(current), ...(Array.isArray(imported) ? imported : [])]);
}

/**
 * v69 : import permis seulement à l'arrêt confirmé (même règle que l'édition 3a, canEditReports). `parked` vient de
 * parkedState (en guidage) ou des relevés GPS hors guidage (plan-park.js) : vitesse inconnue, GPS refusé → false.
 */
export function canImportShare({ parked = false } = {}) {
  return canEditReports({ parked });
}

/**
 * v69 : « Importer » touché après l'aperçu. À l'arrêt → liste fusionnée ; sinon → rien ne change (même liste) et
 * message « Import annulé : camion en mouvement. ».
 * @returns {{ ok:boolean, list:object[], text?:string }}
 */
export function confirmImport(current, imported, { parked = false } = {}) {
  if (!canImportShare({ parked })) return { ok: false, list: current, text: SHARE.MOVING_CANCEL_TEXT };
  return { ok: true, list: mergeImported(current, imported) };
}
