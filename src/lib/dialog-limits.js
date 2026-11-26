// Limites officielles DiaLog (phase 12c) : interdictions d'accès avec une limite de hauteur ou de poids de la Base
// nationale de la réglementation de circulation (DiaLog, DGITM, Licence Ouverte 2.0), copiées chaque semaine dans
// data/dialog/ par l'Action « DiaLog (copie) » (tools/dialog-update.mjs), lues par cases du trajet, jamais précachées.
// Avertissement du producteur : « Les restrictions diffusées par DiaLog n'ont pas de valeur juridique. Seul l'arrêté
// fait foi. » Le fichier ne donne que le titre de l'arrêté, jamais son texte.
//
// Lecture (docs/etude-ponts-sources.md §8) : la valeur est le MAXIMUM AUTORISÉ (opérateur du XML ignoré, toujours
// lessThanOrEqualTo) : les véhicules au-dessus sont visés. Hauteur : visée si hauteur du profil + 0,1 m ≥ valeur
// (marge de Mes restrictions, RESTR.HEIGHT_MARGIN_M) ; poids : visée si PTAC > valeur ; donnée du profil inconnue →
// montrée (donnée de sécurité manquante = à vérifier). Mesure temporaire finie : ignorée ; début futur : jamais « en
// vigueur ». Tronçon suivi par le tracé (followedRuns de weight-check.js : 15 m, cap modulo 180°, jamais un croisement).
// Fiche et repères à l'arrêt seulement, jamais dits ni dans le guidage ; « à vérifier ».

import { decodeLine, followedRuns } from './weight-check.js';
import { RESTR } from './restrictions.js';
import { pointAt } from './nav-geo.js';

export const DIALOG_LIMITS = Object.freeze({
  DIR: './data/dialog/',
  INDEX_PATH: './data/dialog/index.json',
  MAX_SHOWN: 5,
  SAME_GAP_M: 15,          // passage OSM de même valeur à 15 m sur le tracé : même passage
  MAX_TITLE: 300,
  MAX_ORG: 120,
  CAUTION: 'À vérifier — seul l\'arrêté fait foi — la signalisation fait foi.',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const fmt = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
const text = (s, max) => (typeof s === 'string' ? s.replace(/\p{C}+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** « 2026-12-31 » → « 31/12/2026 ». */
export function frDate(day) {
  return isDay(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : '';
}

/** Jour local « AAAA-MM-JJ » d'une date. */
export function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Case de data/dialog/ → { ways:[{ id, mid, k:'h'|'w', value, rec, negate, title, org, start, end, coords }] } ;
 * null si illisible. Lignes ou métadonnées mal formées : ignorées une par une.
 */
export function parseDialogTile(json) {
  if (!json || !Array.isArray(json.o) || !Array.isArray(json.m)) return null;
  const meta = json.o.map((o) => (Array.isArray(o) && typeof o[0] === 'string' && typeof o[1] === 'string'
    && (o[2] === null || isDay(o[2])) && (o[3] === null || isDay(o[3]))
    ? { title: text(o[0], DIALOG_LIMITS.MAX_TITLE), org: text(o[1], DIALOG_LIMITS.MAX_ORG), start: o[2], end: o[3] } : null));
  const ways = [];
  for (const r of json.m) {
    if (!Array.isArray(r) || !Number.isInteger(r[0]) || !Number.isInteger(r[1]) || (r[2] !== 0 && r[2] !== 1)) continue;
    if (!isNum(r[3]) || r[3] <= 0 || !Number.isInteger(r[4]) || !meta[r[4]] || !Number.isInteger(r[5])) continue;
    const coords = decodeLine(r, 6);
    if (!coords) continue;
    ways.push({
      id: r[0], mid: r[1], k: r[2] === 0 ? 'h' : 'w', value: r[3], rec: (r[5] & 1) === 1, negate: (r[5] & 2) === 2,
      ...meta[r[4]], coords,
    });
  }
  return { ways };
}

/** Plusieurs cases (une ligne à cheval sur deux cases y est deux fois) → une seule liste, sans doublon. */
export function mergeDialogTiles(tiles) {
  const m = new Map();
  for (const t of tiles ?? []) for (const w of t?.ways ?? []) m.set(w.id, w);
  return { ways: [...m.values()] };
}

/** La mesure concerne-t-elle le profil ce jour-là ? (valeur = maximum autorisé) */
export function dialogApplies(m, vehicle, today) {
  if (isDay(m.end) && isDay(today) && m.end < today) return false; // temporaire finie
  if (m.k === 'h') return !isNum(vehicle?.height) || vehicle.height + RESTR.HEIGHT_MARGIN_M >= m.value;
  return !isNum(vehicle?.weight) || vehicle.weight > m.value;
}

/** Période affichée : « permanent », « du JJ/MM/AAAA au JJ/MM/AAAA », « à partir du JJ/MM/AAAA » (jamais « en vigueur »). */
export function periodText(m, today) {
  let out;
  if (isDay(m.end)) out = isDay(m.start) ? `du ${frDate(m.start)} au ${frDate(m.end)}` : `jusqu'au ${frDate(m.end)}`;
  else if (isDay(m.start) && isDay(today) && m.start > today) out = `à partir du ${frDate(m.start)}`;
  else out = 'permanent';
  if (m.rec) out += ', sur période';
  return out;
}

/** Texte d'un passage (affiché en textContent, jamais dit). */
export function dialogText(it, today) {
  const what = it.k === 'h' ? `Hauteur limitée à ${fmt(it.value)} m` : `Poids limité à ${fmt(it.value)} t`;
  const src = it.osm ? 'DiaLog et OpenStreetMap' : 'DiaLog';
  const parts = [`${what} (${src})`];
  if (it.title) parts.push(`« ${it.title} »`);
  if (it.org) parts.push(it.org);
  parts.push(periodText(it, today));
  if (it.negate) parts.push('dérogations possibles');
  return `${parts.join(' — ')}. ${DIALOG_LIMITS.CAUTION}`;
}

/**
 * Passages du tracé sur des mesures DiaLog qui concernent le profil.
 * @returns {{ items:object[], counts:{ h:number, w:number } }} items dans l'ordre du trajet : { id (mesure), k, value,
 *   title, org, start, end, rec, negate, along, length, point, osm:false }
 */
export function dialogAlongRoute(route, data, { vehicle = null, today = localDay() } = {}) {
  const counts = { h: 0, w: 0 };
  const coords = route?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || !data?.ways?.length) return { items: [], counts };
  const ways = data.ways.filter((w) => dialogApplies(w, vehicle, today));
  if (!ways.length) return { items: [], counts };
  const { line, runs } = followedRuns(coords, ways);
  runs.sort((x, y) => x.enter - y.enter);
  // Lignes d'une même mesure mises bout à bout (une rue découpée en morceaux) : un seul passage.
  const merged = [];
  for (const r of runs) {
    const last = merged.findLast((m) => m.w.mid === r.way.mid && m.w.k === r.way.k);
    if (last && r.enter - last.exit <= DIALOG_LIMITS.SAME_GAP_M) { last.exit = Math.max(last.exit, r.exit); continue; }
    merged.push({ w: r.way, enter: r.enter, exit: r.exit });
  }
  merged.sort((a, b) => a.enter - b.enter);
  const items = merged.map(({ w, enter, exit }) => {
    const mid = pointAt(line, (enter + exit) / 2).point;
    counts[w.k] += 1;
    return {
      id: w.mid, k: w.k, value: w.value, title: w.title, org: w.org, start: w.start, end: w.end, rec: w.rec,
      negate: w.negate, along: enter, length: Math.round(exit - enter), osm: false,
      point: [Math.round(mid[0] * 1e6) / 1e6, Math.round(mid[1] * 1e6) / 1e6],
    };
  });
  return { items, counts };
}

/**
 * Même passage déjà connu par OSM (limite de poids de même valeur, passages à 15 m l'un de l'autre sur le tracé) :
 * une seule ligne (DiaLog, sources « DiaLog et OpenStreetMap »). Renvoie les items DiaLog marqués et les items OSM
 * absorbés.
 */
export function mergeWithOsm(items, osmItems) {
  const absorbed = new Set();
  const out = items.map((it) => {
    if (it.k !== 'w') return it;
    const twin = (osmItems ?? []).find((o) => !absorbed.has(o) && o.limit === it.value
      && o.along <= it.along + it.length + DIALOG_LIMITS.SAME_GAP_M && it.along <= o.along + o.length + DIALOG_LIMITS.SAME_GAP_M);
    if (!twin) return it;
    absorbed.add(twin);
    return { ...it, osm: true, osmId: twin.id };
  });
  return { items: out, absorbed };
}

/** Lignes de la fiche : 5 au plus, puis « +N ». */
export function dialogLines(items, today) {
  const shown = (items ?? []).slice(0, DIALOG_LIMITS.MAX_SHOWN).map((it) => ({
    level: 'warn', sev: 'check', text: `${dialogText(it, today)} (km ${Math.round(it.along / 1000)})`,
  }));
  const more = (items?.length ?? 0) - shown.length;
  if (more > 0) shown.push({ level: 'warn', sev: 'check', text: `+${more} limite${more > 1 ? 's' : ''} officielle${more > 1 ? 's' : ''} (DiaLog) à vérifier (voir la carte).` });
  return shown;
}

/**
 * Réglementation de la fiche (phase 12c). Copie absente, illisible ou hors France : rien, aucun message.
 * @param {{ vehicle?:object, copy?:{ status:string, data:object, updated?:string|null }|null, enabled?:boolean,
 *   osmItems?:object[], today?:string }} ctx
 * @returns {{ lines:object[], short:string[], items:object[], absorbed:Set<object>, tech:string }}
 */
export function dialogRules(route, { vehicle = null, copy = null, enabled = true, osmItems = [], today = localDay() } = {}) {
  const out = { lines: [], short: [], items: [], absorbed: new Set(), tech: '' };
  if (!enabled) { out.tech = 'Limites DiaLog : affichage désactivé dans Réglages'; return out; }
  if (!copy || copy.status !== 'ok') return out;
  const res = dialogAlongRoute(route, copy.data, { vehicle, today });
  const m = mergeWithOsm(res.items, osmItems);
  out.items = m.items;
  out.absorbed = m.absorbed;
  const date = frDate(copy.updated);
  out.tech = `Limites DiaLog : ${res.items.length} (hauteur ${res.counts.h}, poids ${res.counts.w})${date ? ` ; copie du ${date}` : ''}`;
  out.lines.push(...dialogLines(out.items, today));
  if (out.items.length) out.short.push(`${out.items.length} limite${out.items.length > 1 ? 's' : ''} officielle${out.items.length > 1 ? 's' : ''} à vérifier`);
  return out;
}
