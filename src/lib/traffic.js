// Trafic (phase 10 A, PR 2, v88) : événements du réseau routier national non concédé (DIR, Bison Futé) proches du
// tracé choisi, montrés À L'ARRÊT seulement (fiche et repères), jamais dits, jamais dans le guidage, sans aucun effet
// sur le calcul : un événement de trafic n'est jamais une interdiction et ne déclenche aucun contournement.
// Source : copie de l'Action « Trafic » (tools/trafic-update.mjs, tools/trafic-convert.mjs) publiée sur la branche
// trafic-data et lue via raw.githubusercontent.com (CORS *, mesuré par l'Action) : un fichier national, le même pour
// tous, aucune position envoyée ; le tri se fait sur la tablette. Licence Ouverte Etalab 2.0
// (https://www.etalab.gouv.fr/licence-ouverte-open-licence/) : citer la source et la date de dernière mise à jour.
// Couverture : routes nationales et autoroutes non concédées ; les autoroutes à péage ne sont pas couvertes.
// Étude et chiffres des premiers lancements : docs/etude-trafic.md.
//
// Logique pure (sans DOM ni réseau) : lecture vérifiée du JSON (schéma, tailles, types), distance au tracé (index par
// cases, mesure à la polyligne), sens, ancienneté, textes. Les lignes de la source sont des DROITES du point de départ
// au point d'arrivée (jamais un itinéraire) : sur une route courbe la droite peut s'écarter de plus de 100 m de la
// route ; l'événement est alors gardé par ses extrémités ou parce que la droite suit le tracé, et marqué « tracé
// approximatif ».

import { prepareLine } from './nav-geo.js';

export const TRAFFIC = Object.freeze({
  FORMAT: 'gabarit-trafic',
  VERSION: 1,
  NEAR_M: 100,                 // événement à 100 m au plus du tracé
  OLD_MS: 3 * 3600e3,          // « Ancien » au-delà de 3 h
  MAX_BYTES: 1024 * 1024,      // 1 Mo au plus
  MAX_EVENTS: 3000,
  SAMPLE_M: 20,                // pas d'échantillonnage d'une droite
  MAX_SAMPLES: 500,
  FOLLOW_DEG: 30,              // droite qui suit le tracé : cap ≤ 30° (modulo 180°), jamais un simple croisement
  SAME_DEG: 45,                // sens : ≤ 45° du tracé = votre sens, ≥ 135° = sens opposé
  OPPOSITE_DEG: 135,
  CELL_DEG: 0.01,              // cases de l'index du tracé (≈ 1 km)
  // Boîte large (France métropolitaine et bords) : une position hors de cette boîte est écartée.
  BOX: Object.freeze({ south: 41, north: 51.5, west: -5.5, east: 10 }),
  TITLE: 'Trafic sur le trajet',
  COVERAGE_TEXT: 'Routes nationales et autoroutes non concédées : les autoroutes à péage ne sont pas couvertes.',
  EMPTY_TEXT: 'Aucun événement trouvé dans la source. Ce n\'est pas une garantie : la signalisation fait foi.',
  OLD_TEXT: 'Ancien',
  APPROX_TEXT: 'tracé approximatif',
  PARKED_TEXT: 'Trafic : disponible à l\'arrêt.',
  LOADING_TEXT: 'Lecture du trafic…',
  OFFLINE_TEXT: 'Pas de connexion : trafic indisponible.',
  ERROR_TEXT: 'Trafic indisponible pour l\'instant.',
  CREDIT_DATE_TEXT: (when) => ` Dernière mise à jour lue : ${when}.`,
});

export const KIND_LABELS = Object.freeze({
  fermeture: 'Fermeture', accident: 'Accident', obstacle: 'Obstacle', bouchon: 'Bouchon', chantier: 'Chantier',
});
// Texte court des repères (bord pointillé : à vérifier).
export const KIND_GLYPHS = Object.freeze({
  fermeture: 'Fermé', accident: 'Accident', obstacle: 'Obstacle', bouchon: 'Bouchon', chantier: 'Travaux',
});
// Sous-types DATEX II vus dans le flux (runs 1 et 2 de l'Action, 26/11/2026) ; inconnu = rien ajouté (jamais d'anglais).
const SUBTYPE_LABELS = Object.freeze({
  roadClosed: 'route fermée', carriagewayClosures: 'chaussée fermée', closedPermanentlyForTheWinter: 'fermée pour l\'hiver',
  queuingTraffic: 'file d\'attente', slowTraffic: 'ralentissement', stationaryTraffic: 'circulation arrêtée',
  heavyTraffic: 'trafic dense',
  maintenanceWork: 'entretien', repairWork: 'réparation', constructionWork: 'travaux', roadworks: 'travaux',
  grassCuttingWork: 'fauchage', resurfacingWork: 'réfection de chaussée', roadMarkingWork: 'marquage',
  roadsideWork: 'travaux en bord de route',
  subsidence: 'affaissement', damagedRoadSurface: 'chaussée dégradée', rockfalls: 'chute de pierres',
  incident: 'incident', obstructionOnTheRoad: 'obstacle sur la route', animalsOnTheRoad: 'animaux sur la route',
  brokenDownVehicle: 'véhicule en panne', abandonedVehicle: 'véhicule abandonné', vehicleStuck: 'véhicule bloqué',
  objectsFallingFromMovingVehicle: 'chute d\'objets', objectOnTheRoad: 'objet sur la route',
});
const COMPASS = Object.freeze({
  northBound: 0, northEastBound: 45, eastBound: 90, southEastBound: 135,
  southBound: 180, southWestBound: 225, westBound: 270, northWestBound: 315,
});
export const DIRECTION_TEXTS = Object.freeze({
  both: 'deux sens',
  same: 'dans votre sens d\'après la source',
  opposite: 'sens opposé d\'après la source',
  one: 'un seul sens, lequel : à vérifier',
  unknown: 'sens non précisé',
});

// ── Lecture vérifiée du fichier ────────────────────────────────────────────────────────────────────────────────────

const str = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
const timeMs = (v) => {
  if (typeof v !== 'string' || v.length > 40) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};
function inBox(p) {
  const b = TRAFFIC.BOX;
  return Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
    && p[1] >= b.south && p[1] <= b.north && p[0] >= b.west && p[0] <= b.east;
}

/** Un événement du fichier, vérifié champ par champ, ou null. */
export function cleanEvent(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const id = str(e.id, 80);
  if (!id || !Object.hasOwn(KIND_LABELS, e.k) || !inBox(e.p)) return null;
  const l = e.l == null ? null : Array.isArray(e.l) && e.l.length === 2 && e.l.every(inBox) ? [e.l[0], e.l[1]] : undefined;
  if (l === undefined) return null;
  const d = e.d === 'both' || e.d === 'one' ? e.d : null;
  return {
    id, k: e.k, st: str(e.st, 60), p: [e.p[0], e.p[1]], l,
    s: timeMs(e.s), e: timeMs(e.e), d, dv: str(e.dv, 30), r: str(e.r, 20), c: str(e.c, 200),
  };
}

/**
 * Texte du fichier national → { ok, publication, events, dropped } ou { ok:false, reason }.
 * Jamais d'exception : taille, JSON, format, version et chaque champ sont vérifiés avant usage.
 */
export function parseTrafficJson(text) {
  if (typeof text !== 'string') return { ok: false, reason: 'format' };
  if (text.length > TRAFFIC.MAX_BYTES) return { ok: false, reason: 'taille' };
  let j;
  try { j = JSON.parse(text); } catch { return { ok: false, reason: 'json' }; }
  if (!j || typeof j !== 'object' || j.format !== TRAFFIC.FORMAT || j.version !== TRAFFIC.VERSION || !Array.isArray(j.events)) {
    return { ok: false, reason: 'format' };
  }
  if (j.events.length > TRAFFIC.MAX_EVENTS) return { ok: false, reason: 'taille' };
  const events = [];
  let dropped = 0;
  for (const e of j.events) {
    const ev = cleanEvent(e);
    if (ev) events.push(ev); else dropped += 1;
  }
  const publication = timeMs(j.publication) ?? timeMs(j.lastModified) ?? timeMs(j.copied);
  return { ok: true, publication, events, dropped };
}

/** Copie de plus de 3 h (ou sans date) : « Ancien ». */
export function isOld(publication, now) {
  return !Number.isFinite(publication) || now - publication > TRAFFIC.OLD_MS;
}

// ── Géométrie locale (mètres, projection équirectangulaire : précise à quelques mètres sous 100 m) ───────────────────

const RAD = Math.PI / 180;
const R = 6371008.8;
function toXY(p, lat0) {
  return [p[0] * RAD * R * Math.cos(lat0 * RAD), p[1] * RAD * R];
}
/** Cap (degrés, 0 = nord) de a vers b, en plan local. */
export function planBearing(a, b) {
  const lat0 = (a[1] + b[1]) / 2;
  const [ax, ay] = toXY(a, lat0);
  const [bx, by] = toXY(b, lat0);
  return (Math.atan2(bx - ax, by - ay) / RAD + 360) % 360;
}
const angleDiff = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };
const axisDiff = (a, b) => { const d = angleDiff(a, b); return d > 90 ? 180 - d : d; };

/**
 * Index du tracé par cases : chaque segment est rangé dans les cases de sa boîte élargie de `margin` mètres.
 * @returns {{ line, cells:Map, lat0:number, near:(p)=>{ dist, along, seg, point }|null, work:{ n:number } }}
 */
export function indexRoute(coords, margin = TRAFFIC.NEAR_M) {
  const line = prepareLine(coords);
  const lat0 = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const cell = TRAFFIC.CELL_DEG;
  const padLat = margin / (RAD * R);
  const padLon = padLat / Math.max(0.2, Math.cos(lat0 * RAD));
  const cells = new Map();
  const key = (i, j) => `${i}:${j}`;
  for (let s = 0; s < coords.length - 1; s += 1) {
    const a = coords[s];
    const b = coords[s + 1];
    const i0 = Math.floor((Math.min(a[0], b[0]) - padLon) / cell);
    const i1 = Math.floor((Math.max(a[0], b[0]) + padLon) / cell);
    const j0 = Math.floor((Math.min(a[1], b[1]) - padLat) / cell);
    const j1 = Math.floor((Math.max(a[1], b[1]) + padLat) / cell);
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const k = key(i, j);
        let list = cells.get(k);
        if (!list) { list = []; cells.set(k, list); }
        list.push(s);
      }
    }
  }
  const work = { n: 0 };
  /** Point du tracé le plus proche parmi les segments de la case (null si aucun segment à moins de `margin`). */
  function near(p) {
    const list = cells.get(key(Math.floor(p[0] / cell), Math.floor(p[1] / cell)));
    if (!list) return null;
    const [px, py] = toXY(p, lat0);
    let best = null;
    for (const s of list) {
      work.n += 1;
      const [ax, ay] = toXY(coords[s], lat0);
      const [bx, by] = toXY(coords[s + 1], lat0);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const qx = ax + t * dx;
      const qy = ay + t * dy;
      const dist = Math.hypot(px - qx, py - qy);
      if (!best || dist < best.dist) {
        best = {
          dist, seg: s, along: line.cum[s] + t * (line.cum[s + 1] - line.cum[s]),
          point: [coords[s][0] + t * (coords[s + 1][0] - coords[s][0]), coords[s][1] + t * (coords[s + 1][1] - coords[s][1])],
        };
      }
    }
    return best && best.dist <= margin ? best : null;
  }
  return { line, cells, lat0, near, work };
}

const segBearing = (coords, s) => planBearing(coords[s], coords[s + 1]);

/**
 * Une droite départ → arrivée touche-t-elle le tracé ? Gardée si une extrémité est à ≤ 100 m, ou si au moins deux
 * échantillons consécutifs de la droite sont à ≤ 100 m avec un cap ≤ 30° (modulo 180°) de celui du tracé (la droite
 * suit la route) ; un simple croisement (cap différent) n'est jamais gardé. Renvoie le premier point touché ou null.
 */
function lineHit(l, idx, coords) {
  const ends = [idx.near(l[0]), idx.near(l[1])].filter(Boolean);
  if (ends.length) return ends.reduce((a, b) => (b.along < a.along ? b : a));
  const [ax, ay] = toXY(l[0], idx.lat0);
  const [bx, by] = toXY(l[1], idx.lat0);
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.min(TRAFFIC.MAX_SAMPLES, Math.max(2, Math.ceil(len / TRAFFIC.SAMPLE_M)));
  const brg = planBearing(l[0], l[1]);
  let run = 0;
  let first = null;
  for (let i = 1; i < n; i += 1) {
    const t = i / n;
    const hit = idx.near([l[0][0] + t * (l[1][0] - l[0][0]), l[0][1] + t * (l[1][1] - l[0][1])]);
    if (hit && axisDiff(brg, segBearing(coords, hit.seg)) <= TRAFFIC.FOLLOW_DEG) {
      run += 1;
      if (!first || hit.along < first.along) first = hit;
      if (run >= 2) return first;
    } else {
      run = 0;
      first = null;
    }
  }
  return null;
}

/**
 * Sens par rapport au trajet : deux sens ; un sens confirmé (droite départ → arrivée dans le sens cardinal publié,
 * puis comparée au cap du tracé : ≤ 45° votre sens, ≥ 135° sens opposé) ; sinon un sens sans savoir lequel, ou non
 * précisé. Jamais caché : seulement un texte « d'après la source ».
 */
export function trafficDirection(ev, routeBearing) {
  if (ev.d === 'both') return 'both';
  if (ev.d !== 'one') return 'unknown';
  if (!ev.l || !(ev.dv in COMPASS) || !Number.isFinite(routeBearing)) return 'one';
  const lb = planBearing(ev.l[0], ev.l[1]);
  if (angleDiff(lb, COMPASS[ev.dv]) >= 60) return 'one'; // droite contraire au sens publié : on ne sait pas
  const d = angleDiff(lb, routeBearing);
  return d <= TRAFFIC.SAME_DEG ? 'same' : d >= TRAFFIC.OPPOSITE_DEG ? 'opposite' : 'one';
}

/**
 * Événements à 100 m au plus du tracé, terminés retirés, triés par distance depuis le départ.
 * @returns {{ items:{ ev, along:number, point:number[], approx:boolean, dir:string }[], ended:number, work:number }}
 */
export function eventsNearRoute(events, coords, { now, maxM = TRAFFIC.NEAR_M } = {}) {
  if (!Array.isArray(coords) || coords.length < 2 || !Array.isArray(events)) return { items: [], ended: 0, work: 0 };
  const idx = indexRoute(coords, maxM);
  const items = [];
  let ended = 0;
  for (const ev of events) {
    if (Number.isFinite(ev.e) && Number.isFinite(now) && ev.e < now) { ended += 1; continue; }
    const hit = ev.l ? lineHit(ev.l, idx, coords) : idx.near(ev.p);
    if (!hit) continue;
    items.push({ ev, along: hit.along, point: hit.point, approx: !!ev.l, dir: trafficDirection(ev, segBearing(coords, hit.seg)) });
  }
  items.sort((a, b) => a.along - b.along || (a.ev.id < b.ev.id ? -1 : 1));
  return { items, ended, work: idx.work.n };
}

// ── Textes (affichés seulement, jamais dits) ───────────────────────────────────────────────────────────────────────

function parts(ms, timeZone) {
  const f = new Intl.DateTimeFormat('fr-FR', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${o.day}/${o.month}`, year: o.year, time: `${o.hour}:${o.minute}` };
}
/** « 17:24 » (heure de la tablette). */
export function hhmm(ms, timeZone) {
  if (!Number.isFinite(ms)) return '--:--';
  return parts(ms, timeZone).time;
}
/** « 17:24 » le jour même, sinon « 25/11 à 17:24 ». */
export function whenText(ms, now, timeZone) {
  const a = parts(ms, timeZone);
  const b = Number.isFinite(now) ? parts(now, timeZone) : null;
  return b && a.day === b.day && a.year === b.year ? a.time : `${a.day} à ${a.time}`;
}

/** Ligne de la source : « Source : Bison Futé (DIR), mis à jour à HH:MM — à vérifier, la signalisation fait foi ». */
export function sourceText(publication, now, timeZone) {
  const when = Number.isFinite(publication) ? whenText(publication, now, timeZone) : 'heure inconnue';
  return `Source : Bison Futé (DIR), mis à jour à ${when} — à vérifier, la signalisation fait foi.`;
}

/** « N0125 » → « N 125 », « A0013 » → « A 13 » (espace insécable) ; autre texte inchangé. */
export function roadText(r) {
  if (!r) return '';
  const m = /^([ANDM])0*(\d+)([A-Za-z]{0,3})$/.exec(r);
  return m ? `${m[1]} ${m[2]}${m[3] ? ` ${m[3]}` : ''}` : r;
}

/** « à 300 m du départ », « à 4,2 km du départ », « à 37 km du départ ». */
export function fromStartText(along) {
  if (!(along >= 0)) return '';
  if (along < 1000) return `à ${Math.max(0, Math.round(along / 100) * 100)} m du départ`;
  const km = along / 1000;
  return `à ${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km du départ`;
}

/**
 * Textes d'une ligne de la fiche : titre (type, sous-type, route), faits (départ, sens, tracé approximatif),
 * dates (début / fin), commentaire de la source (affiché en textContent).
 */
export function itemTexts(item, now, timeZone) {
  const { ev } = item;
  const sub = SUBTYPE_LABELS[ev.st] ?? '';
  const road = roadText(ev.r);
  const title = [`${KIND_LABELS[ev.k]}${sub ? ` (${sub})` : ''}`, road].filter(Boolean).join(' · ');
  const facts = [fromStartText(item.along), DIRECTION_TEXTS[item.dir] ?? DIRECTION_TEXTS.unknown];
  if (item.approx) facts.push(TRAFFIC.APPROX_TEXT);
  const dates = [];
  if (Number.isFinite(ev.s)) dates.push(`${ev.s > now ? 'à partir du' : 'depuis le'} ${whenText(ev.s, null, timeZone)}`);
  dates.push(Number.isFinite(ev.e) ? `fin prévue le ${whenText(ev.e, null, timeZone)}` : 'fin non précisée');
  return { title, facts: facts.join(' · '), dates: dates.join(' · '), comment: ev.c ?? '', future: Number.isFinite(ev.s) && ev.s > now };
}
