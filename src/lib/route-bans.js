// Interdictions connues sur le trajet (v78, PR B du plan « contournement automatique des interdictions »).
// Logique pure, sans DOM, testée sous Node.
//
// Sections d'interdiction de la copie des points sensibles (data/points-sensibles/, PR 3b : audit OpenStreetMap en
// lecture seule, tools/audit-osm-interdictions.json, © contributeurs OSM, ODbL) rencontrées par un itinéraire et
// concernées par le profil (concernsVehicle : poids, hauteur). Lyon (lyon-a6, lyon-a7) a sa règle propre
// (lyon-bypass.js, contour de la Métropole).
// v80 (PR D) : sections de hauteur (Mont-Blanc 4,70 m, Fréjus 4,30 m, arrêtés lus : la plupart des voies du tunnel sont
// sans étiquette maxheight dans OSM, ORS ne les connaît donc pas) retenues seulement si la hauteur du profil est connue
// et STRICTEMENT supérieure à la valeur de l'arrêté (« hauteur maximale 4,70 m » : 4,70 m passe) ; hauteur égale ou
// inconnue → ligne « point sensible » seule (v74). Hauteurs basses ponctuelles (type 2, étiquettes OSM qu'ORS applique
// déjà) : jamais ici (faux positif constaté : A86 Duplex 2 m sous la N 12 à Vélizy, vraie réponse ORS
// Joigny → Gonfreville) ; ligne « point sensible » seule.
//
// Règle d'affichage (choisie par le propriétaire, 25/11/2026) : interdiction sans alternative → itinéraire en rouge et
// confirmation avant le départ ; source citée, « à vérifier », « la signalisation fait foi ». Interdiction « en transit
// seulement » ou « sauf desserte locale » : question « Desserte locale dans la zone … ? » (Non par défaut), réponse
// gardée pour ce trajet seulement (choice.localAnswers), jamais dans les réglages ni l'export. Jamais dit, rien dans le
// guidage (Code de la route art. R412-6-2).
//
// Sens : la copie ne garde que le cap modulo 180° (sens de circulation inconnu). Une section à sens unique de la source
// (« nord → sud », « sud → nord ») est retenue seulement si l'itinéraire y roule dans ce sens (latitude 1 km avant et
// 1 km après le point) ; sens illisible → retenue (prudence).

import { SENSITIVE } from './sensitive-points.js';
import { LYON_BYPASS } from './lyon-bypass.js';

export const BANS = Object.freeze({
  /** Sections traitées ailleurs : Lyon (rocade Est, v76 / v77). */
  EXCLUDED: Object.freeze([...LYON_BYPASS.SECTIONS]),
  /** Écart (m) le long du tracé pour lire le sens de marche à la section. */
  HEADING_SPAN_M: 1000,
  MAX_ANSWERS: 30,
  SHORT_TEXT: 'Interdiction connue sur le trajet',
  CONFIRM_PREFIX: 'Itinéraire par une interdiction connue',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const RAD = Math.PI / 180;
const KY = 110540;
const kxAt = (lat) => Math.cos(lat * RAD) * 111320;

/** Point du tracé à `along` mètres du départ (interpolé), ou null. */
export function pointAt(coords, along) {
  if (!Array.isArray(coords) || coords.length < 2 || !isNum(along)) return null;
  let cum = 0;
  if (along <= 0) return coords[0];
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1]; const b = coords[i];
    const d = Math.hypot((b[0] - a[0]) * kxAt(a[1]), (b[1] - a[1]) * KY);
    if (cum + d >= along) {
      const t = d > 0 ? (along - cum) / d : 0;
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
    cum += d;
  }
  return coords[coords.length - 1];
}

/** Sens de marche nord / sud à `along` : 'south', 'north' ou null (illisible, est-ouest). */
export function travelAt(coords, along) {
  const a = pointAt(coords, along - BANS.HEADING_SPAN_M);
  const b = pointAt(coords, along + BANS.HEADING_SPAN_M);
  if (!a || !b) return null;
  const dy = (b[1] - a[1]) * KY;
  const dx = (b[0] - a[0]) * kxAt(a[1]);
  if (Math.abs(dy) < Math.abs(dx) * 0.5) return null; // plutôt est-ouest : sens nord / sud illisible
  return dy < 0 ? 'south' : 'north';
}

/** Sens de la source : 'south' (« nord → sud »), 'north' (« sud → nord ») ou null (deux sens, inconnu). */
export function oneWayOf(sens) {
  const s = String(sens ?? '').toLowerCase();
  if (/nord\s*→\s*sud/.test(s)) return 'south';
  if (/sud\s*→\s*nord/.test(s)) return 'north';
  return null;
}

/** Nom de la zone pour la question et la confirmation : début du texte de la section (avant « : »). */
export function zoneLabel(section) {
  const t = String(section?.texte ?? '').trim();
  const head = t.split(' : ')[0].trim();
  return head || section?.id || 'zone inconnue';
}

/** Desserte locale possible (« en transit », « sauf desserte », « desserte locale autorisée ») ? */
export function localPossible(section) {
  return section?.nature === 'transit' || /desserte/i.test(String(section?.texte ?? ''));
}

const km = (m) => `km ${Math.round(m / 1000)}`;

/**
 * Interdictions d'un itinéraire.
 * @param {object} route itinéraire (parseDirections)
 * @param {object[]} items points sensibles concernés par le profil (sensitiveRules(...).items)
 * @param {object[]} sections sections de la copie (meta.sections)
 * @param {{ vehicle?:object }} [opts] profil (hauteur, v80) ; absent : sections de hauteur ignorées
 * @returns {{ id:string, label:string, along:number, local:boolean, ref:string, text:string, source:string }[]}
 */
export function routeBans(route, items, sections, { vehicle = null } = {}) {
  const out = [];
  const seen = new Set();
  const h = isNum(vehicle?.height) ? vehicle.height : null;
  for (const it of items ?? []) {
    if (!(it?.type <= SENSITIVE.TYPES.BAN_BF)) continue;
    const s = sections?.[it.section];
    if (!s?.id || BANS.EXCLUDED.includes(s.id) || seen.has(s.id)) continue;
    if (s.nature === 'hauteur' && !(h !== null && isNum(s.valeur) && h > s.valeur)) continue; // v80
    const want = oneWayOf(s.sens);
    if (want) {
      const dir = travelAt(route?.coordinates, it.along);
      if (dir && dir !== want) continue; // autre sens : non concerné
    }
    seen.add(s.id);
    const source = it.type === SENSITIVE.TYPES.BAN ? `Source : ${s.arrete ?? 'arrêté'}.` : 'Source : Bison Futé, arrêté non lu.';
    out.push({
      id: s.id, label: zoneLabel(s), along: it.along, local: localPossible(s), ref: it.ref ?? '',
      text: `Interdiction connue sur le trajet (${km(it.along)}) : ${s.texte}. En vigueur : à vérifier. La signalisation fait foi. ${source}`,
      source,
    });
  }
  return out;
}

/** Desserte locale déclarée pour cette zone (réponse « Oui » gardée pour le trajet) ? */
export const declared = (answers, id) => !!answers && answers[id] === true;

/** Interdictions encore en vigueur pour ce trajet (desserte déclarée retirée). */
export function activeBans(bans, answers) {
  return (bans ?? []).filter((b) => !(b.local && declared(answers, b.id)));
}

/** Questions à poser (zones à desserte possible), avec la réponse en cours (false = Non, par défaut). */
export function localQuestions(bans, answers) {
  return (bans ?? []).filter((b) => b.local).map((b) => ({
    id: b.id, label: b.label, yes: declared(answers, b.id),
    text: `Desserte locale dans la zone ${b.label} ?`,
  }));
}

/** Ligne de la fiche pour une desserte déclarée. */
export function declaredText(ban) {
  return `Desserte locale déclarée dans la zone ${ban.label} : interdiction non appliquée pour ce trajet. Vérifie l'arrêté et la signalisation. La signalisation fait foi. ${ban.source}`;
}

/** Texte de la confirmation avant le départ. */
export function confirmText(bans) {
  const names = [...new Set((bans ?? []).map((b) => b.label))];
  return `${BANS.CONFIRM_PREFIX} (${names.join(' ; ')}). Aucune alternative trouvée. À vérifier. Démarrer quand même ?`;
}

/** Réponses gardées (mémoire v53) : { id: true|false } pour 30 zones au plus, identifiants courts seulement. */
export function sanitizeAnswers(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return {};
  const out = {};
  for (const [k, v] of Object.entries(a).slice(0, BANS.MAX_ANSWERS)) {
    if (/^[a-z0-9-]{1,40}$/.test(k) && typeof v === 'boolean') out[k] = v;
  }
  return out;
}
