// Phase 3b — Lieux enregistrés (domicile, dépôt, clients) : champ `places` de `gabarit.data`.
//
// Données personnelles : gardées seulement sur l'appareil, incluses dans l'export complet existant (Réglages ›
// Exporter) et JAMAIS dans le fichier de signalements partagé avec un ami (phase 3c : reports-share.js n'en lit
// aucun champ). Aucun appel réseau : proposés en tête des suggestions (champ vide ou mots tapés), un toucher = le lieu.
// Ajout, renommage, suppression : comme les recherches récentes (hors guidage ; en guidage, à l'arrêt seulement,
// R412-6-2) ; Réglages n'est pas ouvert pendant le guidage.

import { normalizeText, samePlace } from './recent-places.js';
import { haversine } from './nav-geo.js';
import { parseCoordinates } from './coords.js';

export const SAVED = Object.freeze({
  KINDS: Object.freeze({ home: 'Domicile', depot: 'Dépôt', client: 'Client' }),
  MAX: 50,
  NAME_MAX: 60,
  LABEL_MAX: 200,
  /** Même catégorie à moins de 30 m : doublon. */
  DUPLICATE_M: 30,
  /** Lignes proposées dans les suggestions. */
  SHOW: 5,
  TITLE: 'Mes lieux',
  PRIVACY_TEXT: 'Données personnelles : gardées seulement sur cet appareil, incluses dans l\'export complet, jamais dans un fichier de signalements partagé.',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const clean = (x, max) => (typeof x === 'string' ? x.replace(/\p{C}+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

function defaultId() {
  return `l-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * Lieu lu (appareil, export) → champs connus seulement, ou null (coordonnées invalides, ni nom ni libellé).
 * @returns {{ id:string, kind:'home'|'depot'|'client', name:string, label:string, lon:number, lat:number }|null}
 */
export function cleanPlace(raw, { makeId = defaultId } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { lon, lat } = raw;
  if (!isNum(lon) || !isNum(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  const label = clean(raw.label, SAVED.LABEL_MAX);
  const name = clean(raw.name, SAVED.NAME_MAX) || label.slice(0, SAVED.NAME_MAX);
  if (!name) return null;
  return {
    id: typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : makeId(),
    kind: Object.hasOwn(SAVED.KINDS, raw.kind) ? raw.kind : 'client',
    name,
    label: label || name,
    lon: Math.round(lon * 1e6) / 1e6,
    lat: Math.round(lat * 1e6) / 1e6,
  };
}

const isDuplicate = (a, b) => a.kind === b.kind && haversine([a.lon, a.lat], [b.lon, b.lat]) < SAVED.DUPLICATE_M;

/** Liste lue → liste propre : invalides et doublons écartés, identifiants uniques, 50 au plus. */
export function sanitizePlaces(raw, opts = {}) {
  const out = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const c = cleanPlace(r, opts);
    if (!c || out.some((o) => isDuplicate(o, c))) continue;
    if (out.some((o) => o.id === c.id)) c.id = (opts.makeId ?? defaultId)();
    out.push(c);
    if (out.length >= SAVED.MAX) break;
  }
  return out;
}

/**
 * Ajout (lieu choisi dans la liste de l'arrivée, ou centre de la carte). Lève une Error au texte prêt à afficher.
 * Coordonnées tapées comme nom : refusées (le nom sert à reconnaître le lieu).
 */
export function addPlace(list, raw, opts = {}) {
  const cur = sanitizePlaces(list);
  const c = cleanPlace(raw, opts);
  if (!c) throw new Error('Lieu illisible : choisis-le dans la liste ou place la carte dessus.');
  if (parseCoordinates(c.name)) throw new Error('Donne un nom au lieu (ex. Dépôt Sud).');
  if (cur.some((o) => isDuplicate(o, c))) throw new Error('Ce lieu est déjà enregistré dans cette catégorie.');
  if (cur.length >= SAVED.MAX) throw new Error(`${SAVED.MAX} lieux au plus.`);
  return [...cur, c];
}

/** Renommer ou changer la catégorie (position inchangée). Nom vide : nom gardé. */
export function editPlace(list, id, { name, kind } = {}) {
  return sanitizePlaces(list).map((p) => {
    if (p.id !== id) return p;
    const n = clean(name, SAVED.NAME_MAX);
    return cleanPlace({ ...p, name: n && !parseCoordinates(n) ? n : p.name, kind: kind ?? p.kind }) ?? p;
  });
}

export function removePlace(list, id) {
  return sanitizePlaces(list).filter((p) => p.id !== id);
}

/** « Dépôt · 12 rue des Lilas, Metz » (libellé seulement s'il diffère du nom). */
export function placeSub(p) {
  const kind = SAVED.KINDS[p?.kind] ?? '';
  return p?.label && p.label !== p.name ? `${kind} · ${p.label}` : kind;
}

/**
 * Lieux à proposer : champ vide → les 5 premiers (domicile, puis dépôts, puis clients) ; sinon ceux dont chaque mot tapé
 * est dans le nom, le libellé ou la catégorie (sans accents ni majuscules), 5 au plus.
 */
export function matchSaved(list, text) {
  const order = { home: 0, depot: 1, client: 2 };
  const all = sanitizePlaces(list).sort((a, b) => order[a.kind] - order[b.kind]);
  const words = normalizeText(text).split(' ').filter(Boolean);
  if (!words.length) return all.slice(0, SAVED.SHOW);
  return all.filter((p) => {
    const hay = normalizeText(`${p.name} ${p.label} ${SAVED.KINDS[p.kind]}`);
    return words.every((w) => hay.includes(w));
  }).slice(0, SAVED.SHOW);
}

/** Lieu choisi dans la liste → point du formulaire (même forme qu'une suggestion). */
export function savedToPick(p) {
  return { label: p.label || p.name, name: p.name, place: SAVED.KINDS[p.kind] ?? '', lon: p.lon, lat: p.lat };
}

/** Le lieu fait-il déjà partie de mes lieux ? (masque le doublon dans les récents et les suggestions). */
export function isSaved(list, item) {
  return (Array.isArray(list) ? list : []).some((p) => samePlace({ ...p, label: p.label || p.name }, item));
}
