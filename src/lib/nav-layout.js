// Écran de guidage façon « GPS de téléphone » (phase 2c) : décisions d'affichage, sans DOM.
// Alertes à montrer et leur ordre, règle « à l'arrêt » des boutons, place du véhicule sur l'écran, colonne de
// boutons ronds, vitesse au-dessus de la limite connue, partie du tracé déjà parcourue.
// Code de la route, art. R412-6-2 (legifrance.gouv.fr) : pendant la marche, l'écran ne sert qu'à la navigation ;
// aucune saisie, et ce qui change l'itinéraire (autres itinéraires) n'est actif qu'à l'arrêt.

import { pointAt, segmentAt, haversine, bearing } from './nav-geo.js';
import { STEP_TYPES } from './nav-guidance.js';
import { roadLabel, keepRefsTogether } from './road-badge.js';
import { exitText } from './directions.js';
import { isLongInstruction } from './format.js';

/** Alertes empilées sous le bandeau : 2 au plus, les autres dans le panneau du bas déplié. */
export const MAX_ALERTS = 2;
/** « À l'arrêt » pour les boutons réservés à l'arrêt : sous 5 km/h pendant 3 s. */
export const PARK = Object.freeze({ KMH: 5, MS: 3000 });
/**
 * Hauteur du véhicule sur l'écran (fraction depuis le haut) : bas de l'écran pour voir loin devant ; au plus haut
 * de quoi poser la pastille de la rue dessous (v53, followPadding).
 */
export const VEHICLE_Y = Object.freeze({ portrait: 0.78, landscape: 0.75 });
/** Paysage : bandeau et panneau du bas dans une colonne à gauche (fraction de la largeur). */
export const LANDSCAPE_COLUMN = 0.4;
/**
 * Colonne de boutons ronds : entre 45 % et 85 % de la hauteur, 48 px (40 px au moins). v53 : environ 25 % plus petits
 * qu'avant (64 / 56 px) ; 40 px reste la zone tactile minimale de ces boutons ronds seulement.
 */
export const BUTTONS = Object.freeze({ from: 0.45, to: 0.85, size: 48, min: 40, gap: 9, minGap: 5 });
/**
 * Pastille de la rue (v53) : juste sous le repère du véhicule (60 px, centré sur sa position), centrée sur lui.
 * GAP : écart sous le repère ; HEIGHT : hauteur réservée à la pastille (une ligne) ; MARGIN : écart aux autres éléments.
 */
export const ROAD_PILL = Object.freeze({ ICON_HALF: 30, GAP: 8, HEIGHT: 40, MARGIN: 8 });
/** Place réservée sous la pastille (px) : panneau du bas et mention du bas en portrait, marge et mention en paysage. */
export const PILL_ROOM = Object.freeze({ portrait: 150, landscape: 40 });
/** Tracé parcouru (gris) : redessiné tous les 25 m, seulement en roulant (≥ 3 km/h, comme la flèche). */
export const TRAVELED = Object.freeze({ STEP_M: 25, MIN_KMH: 3 });

/**
 * Texte du bandeau de manœuvre : badges de route et nom de rue (le plus gros), ou la consigne entière quand elle
 * donne une direction (« Prenez la sortie 34 en direction de Mâcon ») ou qu'il n'y a pas de nom.
 * @param {{ text:string, name?:string|null }|null} maneuver vue du moteur
 * @returns {{ badges:object[], text:string, long:boolean, full:string }}
 */
export function bannerText(maneuver) {
  // Références de route jamais coupées entre deux lignes (« D 120 E », phase 2e).
  const full = keepRefsTogether(String(maneuver?.text ?? ''));
  const label = roadLabel(maneuver?.name);
  const named = label.street !== '' || label.badges.length > 0;
  if (!named || /\bdirection\b/i.test(full)) return { badges: [], text: full, long: isLongInstruction(full), full };
  const street = keepRefsTogether(label.street);
  return { badges: label.badges, text: street, long: isLongInstruction(street), full };
}

/**
 * Ligne de sortie du bandeau (v53) : écusson de la route suivie (numéro du nom d'étape ORS, roadLabel) et « Sortie 12 ·
 * Vallorbe » (m.exit, directions.js : bretelle unique au cap cohérent, un seul nœud de sortie). Rien sans sortie
 * connue ; élément manquant caché. Jamais dit (voix inchangée, règle 11b).
 * @param {{ exit?:{ ref?:string, name?:string }|null }|null} maneuver vue du moteur
 * @param {string|null} roadName route actuelle (view.roadName)
 * @returns {{ badges:object[], text:string }|null}
 */
export function exitLine(maneuver, roadName) {
  const text = exitText(maneuver?.exit ?? null);
  if (!text) return null;
  return { badges: roadLabel(roadName).badges.slice(0, 1), text: keepRefsTogether(text) };
}

/** Ordre d'importance des alertes (plus petit = plus important). */
const RANK = Object.freeze({
  system: 0, tunnel: 1, zfe: 2, access: 3, ban: 4, drivingOver: 5, border: 6, wind: 7, drivingSoon: 8,
});

/**
 * Alerte du système (GPS, recalcul, hors itinéraire). Reprend les textes du bandeau d'avant la phase 2c.
 * @param {object|null} view vue du moteur (updateNavigation)
 * @param {{ gpsLost?:boolean, sim?:boolean, error?:string }} s
 * @returns {{ text:string, info:boolean, offer:boolean, canReroute:boolean }|null}
 */
export function systemAlert(view, { gpsLost = false, sim = false, error = '' } = {}) {
  if (view?.arrived) return null;
  let text = '';
  if (gpsLost) text = sim ? '' : 'Signal GPS perdu : la position n\'est plus à jour.';
  else if (view?.rerouting) text = 'Hors itinéraire : recalcul en cours…';
  else if (error && view && !view.onRoute) text = `Recalcul impossible : ${error}`;
  else if (view?.rerouteBlocked && !view.onRoute) text = 'Hors itinéraire. Recalcul indisponible : rejoins l\'itinéraire.';
  else if (view?.offRouteStopped) text = 'Hors itinéraire, à l\'arrêt : l\'itinéraire ne change pas sans ton accord.';
  if (!text) return null;
  const info = !!view?.offRouteStopped && !view.rerouting && !error && !gpsLost;
  // Proposition à l'arrêt hors du tracé : un seul bouton « Recalculer d'ici », jamais de recalcul tout seul.
  const offer = !gpsLost && !!view?.offRouteStopped && !view.rerouting && !view.rerouteBlocked;
  return { text, info, offer, canReroute: !!view?.canRequestReroute };
}

/**
 * Toutes les alertes actives, la plus importante en premier (à importance égale, la plus proche).
 * @param {object|null} view
 * @param {ReturnType<typeof systemAlert>} system
 * @returns {{ key:string, kind:string, text:string, detail?:string, level:string, info?:boolean, offer?:boolean,
 *   canReroute?:boolean, work?:boolean, workLabel?:string }[]}
 */
export function guidanceAlerts(view, system = null) {
  const out = [];
  if (system) out.push({ key: 'system', kind: 'system', level: system.info ? 'info' : 'danger', ...system, rank: RANK.system, distance: 0 });
  const r = view?.rules ?? {};
  for (const kind of ['tunnel', 'zfe', 'access', 'ban', 'border', 'wind']) {
    const a = r[kind];
    if (!a?.text) continue;
    const level = kind === 'border' || kind === 'wind' || (kind === 'ban' && !a.active) ? 'warn' : 'danger';
    out.push({ key: kind, kind, text: a.text, level, rank: RANK[kind], distance: Number.isFinite(a.distance) ? a.distance : 0 });
  }
  const d = view?.driving;
  if (d && (d.level === 'over' || d.level === 'soon')) {
    out.push({
      key: 'driving', kind: 'driving', text: d.main, detail: d.detail, level: d.level === 'over' ? 'danger' : 'warn',
      work: !!d.canMarkWork, workLabel: d.workLabel, rank: d.level === 'over' ? RANK.drivingOver : RANK.drivingSoon, distance: 0,
    });
  }
  out.sort((a, b) => a.rank - b.rank || a.distance - b.distance);
  return out.map(({ rank, distance, ...a }) => a);
}

/** Alertes empilées (2 au plus) et le reste (pastille « +N », panneau déplié). */
export function splitAlerts(list, max = MAX_ALERTS) {
  const all = Array.isArray(list) ? list : [];
  return { shown: all.slice(0, max), more: all.slice(max) };
}

/**
 * Arrêt « franc » pour les boutons réservés à l'arrêt : vitesse connue < 5 km/h depuis au moins 3 s.
 * Vitesse inconnue (null, NaN : premier point, GPS sans vitesse et pas de vitesse déduite) = en mouvement : aucune
 * saisie ni changement d'itinéraire possible en roulant (Code de la route, art. R412-6-2).
 * @param {{ since:number|null }|null} prev
 * @param {number|null} kmh vitesse du GPS ou déduite des deux dernières positions (view.parkSpeedKmh)
 * @param {number} now ms
 * @returns {{ since:number|null, parked:boolean }}
 */
export function parkedState(prev, kmh, now) {
  const slow = typeof kmh === 'number' && Number.isFinite(kmh) && kmh < PARK.KMH;
  if (!slow) return { since: null, parked: false };
  const since = prev?.since ?? now;
  return { since, parked: now - since >= PARK.MS };
}

/**
 * v48 : vitesse d'un relevé GPS hors guidage (« Éviter le tunnel » à l'arrêt) : vitesse du GPS si elle est donnée,
 * sinon déduite des deux derniers relevés s'ils ont entre 0,5 et 30 s d'écart et une précision ≤ 50 m ; sinon null
 * (inconnue = en mouvement pour parkedState).
 * @param {{ lonlat:number[], t:number, accuracy?:number }|null} prev
 * @param {{ lonlat:number[], t:number, accuracy?:number, speed?:number|null }} cur speed en m/s
 * @returns {number|null} km/h
 */
export function fixSpeedKmh(prev, cur) {
  if (typeof cur?.speed === 'number' && Number.isFinite(cur.speed) && cur.speed >= 0) return cur.speed * 3.6;
  if (!prev || !Array.isArray(prev.lonlat) || !Array.isArray(cur?.lonlat)) return null;
  const dt = (cur.t - prev.t) / 1000;
  const fine = (a) => typeof a !== 'number' || a <= 50;
  if (!(dt >= 0.5 && dt <= 30) || !fine(prev.accuracy) || !fine(cur.accuracy)) return null;
  return (haversine(prev.lonlat, cur.lonlat) / dt) * 3.6;
}

/** Liste des aires du guidage (phase 2d) : en portrait, 40 % de la hauteur de l'écran au plus. */
export const AREA_LIST_BOX = Object.freeze({ maxPortrait: 0.4, inset: 12, gap: 8, minColumn: 180, toastRoom: 72 });

/**
 * Place de la liste défilante des aires (phase 2d), en px depuis le bord de l'écran de guidage.
 * Portrait : au-dessus du compteur et du panneau du bas, à gauche de la colonne de boutons, ancrée en bas (elle monte
 * vers le haut), 40 % de la hauteur au plus, jamais au-dessus de la pile du bandeau (« Puis », alertes).
 * Paysage : dans la colonne de gauche, entre la pile du bandeau et le panneau du bas ; si la colonne n'a plus la place
 * (téléphone en paysage, moins de 180 px), sur la carte entre la colonne de gauche et les boutons, au-dessus du
 * compteur, en laissant la place du message bref.
 * @param {{ width:number, height:number, stackBottom:number, colLeft:number, speedoTop:number, sheetTop:number,
 *   columnRight?:number }} p stackBottom : bas du bandeau et de ses alertes ; colLeft : bord gauche de la colonne de
 *   boutons ; speedoTop : haut du compteur ; sheetTop : haut du panneau du bas ; columnRight : bord droit de la colonne
 *   de gauche (paysage)
 * @returns {{ left:number, right:number, bottom:number, top:number, maxHeight:number, inMap:boolean,
 *   toastBottom:number|null }} right et bottom : distances au bord droit et au bas de l'écran (CSS) ; inMap : posée sur
 *   la carte (paysage) ; toastBottom : place du message bref sous la liste (inMap), sinon null
 */
export function areaListBox({ width, height, stackBottom, colLeft, speedoTop, sheetTop, columnRight = 0 }) {
  const w = Math.max(0, width || 0);
  const h = Math.max(0, height || 0);
  const { inset, gap, maxPortrait, minColumn, toastRoom } = AREA_LIST_BOX;
  const land = isLandscape({ width: w, height: h });
  const box = (left, rightEdge, ceil, floor, max = Infinity, inMap = false) => {
    const maxHeight = Math.floor(Math.min(Math.max(0, floor - ceil), max));
    return {
      left, right: Math.round(w - Math.max(left, rightEdge)), bottom: Math.round(h - floor), top: Math.round(floor - maxHeight),
      maxHeight, inMap, toastBottom: inMap ? Math.round(h - speedoTop + gap) : null,
    };
  };
  if (!land) return box(inset, colLeft - gap, stackBottom + gap, speedoTop - gap, h * maxPortrait);
  const column = box(inset, columnRight - inset, stackBottom + gap, sheetTop - gap);
  if (column.maxHeight >= minColumn) return column;
  return box(columnRight + inset, colLeft - gap, inset, speedoTop - gap - toastRoom, Infinity, true);
}

/** Paysage : écran plus large que haut. */
export function isLandscape({ width, height }) {
  return width > height;
}

/**
 * Marge de la caméra en suivi : le véhicule à 78 % de la hauteur (portrait) ; en paysage, à 75 % et au milieu de la
 * carte à droite de la colonne de gauche. Ne dépend que de la taille de l'écran (jamais du bandeau ni des alertes) :
 * une alerte qui apparaît à l'arrêt ne redessine pas la carte.
 */
export function followPadding({ width, height }) {
  const w = Math.max(0, Math.round(width || 0));
  const h = Math.max(0, Math.round(height || 0));
  const land = isLandscape({ width: w, height: h });
  // v53 : place pour la pastille de la rue sous le véhicule, au-dessus du panneau du bas (portrait) ou du bord
  // (paysage) : sur un petit écran le véhicule remonte un peu. Toujours d'après la seule taille de l'écran.
  const room = (land ? PILL_ROOM.landscape : PILL_ROOM.portrait) + ROAD_PILL.ICON_HALF + ROAD_PILL.GAP + ROAD_PILL.HEIGHT + ROAD_PILL.MARGIN;
  const y = h > 0 ? Math.min(land ? VEHICLE_Y.landscape : VEHICLE_Y.portrait, (h - room) / h) : VEHICLE_Y.portrait;
  // Centre de la zone utile = position du véhicule : (top + (h - bottom)) / 2 = y·h, avec bottom = 0.
  const top = Math.max(0, Math.round((2 * y - 1) * h));
  const left = land ? Math.round(w * LANDSCAPE_COLUMN) : 0;
  return { top, bottom: 0, left, right: 0 };
}

/**
 * Colonne de boutons ronds à droite : taille, écart et haut de la colonne (px depuis le haut de l'écran).
 * Zone 45–85 % de la hauteur ; si elle est trop petite, la colonne remonte jusque sous le bandeau (`minTop`),
 * puis les boutons rétrécissent jusqu'à 56 px ; en dernier recours, deux colonnes.
 * @param {{ height:number, minTop?:number, maxBottom?:number, count:number }} p
 * @returns {{ size:number, gap:number, top:number, columns:number }}
 */
export function buttonColumn({ height, minTop = 0, maxBottom = null, count }) {
  const h = Math.max(0, height || 0);
  const n = Math.max(1, Math.round(count || 1));
  const bottom = Math.min(maxBottom ?? h, h * BUTTONS.to);
  const need = (size, gap, rows) => rows * size + (rows - 1) * gap;
  const lowTop = Math.max(minTop, h * BUTTONS.from);
  for (const columns of [1, 2]) {
    const rows = Math.ceil(n / columns);
    for (const [size, gap] of [[BUTTONS.size, BUTTONS.gap], [BUTTONS.min, BUTTONS.gap], [BUTTONS.min, BUTTONS.minGap]]) {
      const len = need(size, gap, rows);
      if (bottom - lowTop >= len) return { size, gap, top: Math.round(bottom - len), columns };
      if (bottom - minTop >= len) return { size, gap, top: Math.round(bottom - len), columns };
    }
  }
  const rows = Math.ceil(n / 2);
  return { size: BUTTONS.min, gap: BUTTONS.minGap, top: Math.round(Math.max(0, bottom - need(BUTTONS.min, BUTTONS.minGap, rows))), columns: 2 };
}

/**
 * Compteur et panneau de limitation (phase 11a). rule (v51) : la limite vient d'une règle générale (speed-rules.js,
 * plafond PL d'une étiquette maxspeed d'OSM) et non d'une limite PL écrite dans OSM : petite mention « règle » sous
 * le panneau, couleur neutre ; le panneau garde ses couleurs réglementaires.
 * @param {number|null} kmh vitesse
 * @param {number|null} limitKmh limite PL connue du tronçon
 * @param {'osm'|'rule'|null} source origine de la limite
 */
export function speedStatus(kmh, limitKmh = null, source = null) {
  const v = Number.isFinite(kmh) && kmh >= 0 ? Math.round(kmh) : null;
  const limit = Number.isFinite(limitKmh) && limitKmh > 0 ? Math.round(limitKmh) : null;
  return { value: v === null ? '—' : String(v), limit, over: v !== null && limit !== null && v > limit, rule: limit !== null && source === 'rule' };
}

/**
 * Place de la pastille de la rue (v53) : haut juste sous le véhicule, centrée sur lui ; largeur bornée par la colonne
 * de gauche (paysage), le compteur (s'il est à la même hauteur) et la colonne de boutons ; cachée si elle toucherait
 * le panneau du bas. La caméra n'en dépend jamais (followPadding).
 * @param {{ vx:number, vy:number, leftLimit:number, colLeft:number, sheetTop:number,
 *   speedo?:{ top:number, bottom:number, right:number }|null, buttonsTop?:number }} p px depuis le coin de l'écran
 * @returns {{ left:number, top:number, maxWidth:number, fits:boolean }}
 */
export function roadPillBox({ vx, vy, leftLimit = 0, colLeft, sheetTop, speedo = null, buttonsTop = null }) {
  const top = Math.round(vy + ROAD_PILL.ICON_HALF + ROAD_PILL.GAP);
  const bottom = top + ROAD_PILL.HEIGHT;
  let left = leftLimit;
  if (speedo && speedo.top < bottom && speedo.bottom > top) left = Math.max(left, speedo.right);
  // Colonne de boutons : seulement si elle descend jusqu'à la pastille.
  const right = buttonsTop === null || buttonsTop < bottom ? colLeft : Infinity;
  const room = Math.min(vx - left, right - vx) - ROAD_PILL.MARGIN;
  const maxWidth = Math.max(0, Math.round(2 * Math.min(room, 10000)));
  const fits = bottom + ROAD_PILL.MARGIN <= sheetTop && maxWidth >= 80;
  return { left: Math.round(vx), top, maxWidth, fits };
}

/** Flèches sur le tracé (v53) : chevrons cachés en deçà du zoom 13 (trop serrés), espacés de 90 px. */
export const ROUTE_ARROWS = Object.freeze({ MIN_ZOOM: 13, SPACING_PX: 90, TURN_MIN_ZOOM: 11, AHEAD_M: 20 });

/**
 * Pastilles de manœuvre (v53) : un point par manœuvre (ni départ ni arrivée), cap de la route juste après (20 m).
 * Calculé une fois par itinéraire (départ, recalcul), jamais par position.
 * @param {{ coords:number[][], cum:number[], total:number }} line prepareLine
 * @param {{ type:number, at:number }[]} maneuvers buildManeuvers
 * @returns {{ type:'FeatureCollection', features:object[] }}
 */
export function maneuverMarks(line, maneuvers) {
  const features = [];
  if (!line?.coords?.length || !Array.isArray(maneuvers)) return { type: 'FeatureCollection', features };
  maneuvers.forEach((m, i) => {
    if (!m || !Number.isFinite(m.at) || i === 0 || m.type === STEP_TYPES.DEPART || m.type === STEP_TYPES.GOAL) return;
    const p = pointAt(line, m.at).point;
    const ahead = pointAt(line, Math.min(line.total, m.at + ROUTE_ARROWS.AHEAD_M)).point;
    if (haversine(p, ahead) < 1) return;
    features.push({ type: 'Feature', properties: { bearing: Math.round(bearing(p, ahead)) }, geometry: { type: 'Point', coordinates: p } });
  });
  return { type: 'FeatureCollection', features };
}

/** Faut-il redessiner la partie parcourue ? Seulement en roulant, tous les 25 m (ou en arrière : recalcul). */
export function traveledUpdate(prevAlong, along, kmh) {
  if (!Number.isFinite(along)) return false;
  if (!Number.isFinite(prevAlong)) return true;
  if (!(kmh >= TRAVELED.MIN_KMH)) return false;
  return Math.abs(along - prevAlong) >= TRAVELED.STEP_M;
}

/**
 * Partie du tracé déjà parcourue : du départ jusqu'au point atteint.
 * @param {{ coords:number[][], cum:number[], total:number }} line (prepareLine)
 * @param {number} along m
 * @returns {number[][]} au moins 2 points, ou [] au départ
 */
export function traveledCoords(line, along) {
  if (!line?.coords?.length || !(along > 0)) return [];
  const i = segmentAt(line, along);
  return [...line.coords.slice(0, i + 1), pointAt(line, along).point];
}
