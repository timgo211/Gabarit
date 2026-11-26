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

import { SENSITIVE, sensitivePointsAlongRoute, concernsVehicle } from './sensitive-points.js';
import { LYON_BYPASS } from './lyon-bypass.js';
import { formatDurationDelta, formatDistanceDelta } from './format.js';

export const BANS = Object.freeze({
  /** Sections traitées ailleurs : Lyon (rocade Est, v76 / v77). */
  EXCLUDED: Object.freeze([...LYON_BYPASS.SECTIONS]),
  /** Écart (m) le long du tracé pour lire le sens de marche à la section. */
  HEADING_SPAN_M: 1000,
  MAX_ANSWERS: 30,
  SHORT_TEXT: 'Interdiction connue sur le trajet',
  CONFIRM_PREFIX: 'Itinéraire par une interdiction connue',
  /**
   * v81 : plages « Accès PL limité » (voies OSM à accès conditionnel, access-conditional.js) réunies à la section si
   * elles la touchent à 5 km près, de proche en proche : sur la N59 (test tablette Nancy → Colmar du 26/11/2026), la
   * copie des points n'avait que Raon-l'Étape → tunnel (voies déjà étiquetées hgv:conditional exclues de l'audit) et
   * les voies étiquetées se suivent avec des trous de 3 à 5 km (rapprochement à 80 % de la longueur).
   */
  ABSORB_GAP_M: 5000,
  /**
   * v83 (test tablette Nancy → Colmar 44 t du 26/11/2026, fiche « Sans péage » par la N59 sans aucune ligne ⛔) : section
   * traversée lue par la géométrie seule, sans le veto du nom d'étape ORS (une étape garde le nom de son premier
   * tronçon : « A 46 » sur 84 km d'A7, v81). Retenue si au moins GEO_MIN_POINTS points de la copie sont sur le tracé
   * (15 m, cap ≤ 30° modulo 180°) et s'étalent sur GEO_MIN_M le long du tracé : un pont ou un croisement n'en touche
   * qu'un ou deux, jamais au même cap sur 1 km.
   */
  GEO_MIN_POINTS: 3,
  GEO_MIN_M: 1000,
  /** v83 : profil jusqu'à 3,5 t : jamais de fiche « non proposée » (interdictions PL au-delà de 3,5 t). */
  LIGHT_MAX_T: 3.5,
  NOT_OFFERED_TEXT: 'trajet non proposé',
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
const num = (x) => String(x).replace('.', ',');

/** Points de la copie d'une section (par son identifiant). */
export function sectionPoints(copy, id) {
  const si = (copy?.meta?.sections ?? []).findIndex((s) => s?.id === id);
  if (si < 0) return [];
  return (copy?.data?.points ?? []).filter((p) => p.section === si && Array.isArray(p.point) && isNum(p.point[0]) && isNum(p.point[1]));
}

/** Entrée et sortie (m depuis le départ) des points de la section sur le tracé, ou null. */
export function sectionSpan(route, points, { geo = null } = {}) {
  // Chaque point compté à part (le regroupement par section n'en garderait qu'un).
  const one = (points ?? []).map((p) => ({ ...p, type: SENSITIVE.TYPES.TUNNEL, section: -1 }));
  const hits = sensitivePointsAlongRoute(route, { points: one }, { geo });
  if (!hits.length) return null;
  return { from: hits[0].along, to: hits[hits.length - 1].along };
}

/** Plage « Accès PL limité » en vigueur à l'heure de passage (voie interdite ou réservée à la desserte). */
export const activePlage = (p) => p?.state === 'no' || p?.state === 'local';

/**
 * Plage de la section sur le tracé (v81) : points de la copie, réunis de proche en proche (5 km) avec les plages
 * « Accès PL limité » actives qui la touchent. Même zone pour l'affichage et pour le contournement (ban-detour.js).
 * @param {{ from:number, to:number }} base plage des points (ou du premier point rencontré)
 * @param {object[]} plages mergePassages() de access-conditional.js
 * @returns {{ from:number, to:number, plages:object[] }}
 */
export function widenRange(base, plages, { gap = BANS.ABSORB_GAP_M } = {}) {
  let { from, to } = base;
  const taken = [];
  const rest = (plages ?? []).filter(activePlage);
  for (let changed = true; changed;) {
    changed = false;
    for (let i = rest.length - 1; i >= 0; i -= 1) {
      const p = rest[i];
      if (p.enter > to + gap || p.exit < from - gap) continue;
      from = Math.min(from, p.enter);
      to = Math.max(to, p.exit);
      taken.push(p);
      rest.splice(i, 1);
      changed = true;
    }
  }
  taken.sort((a, b) => a.enter - b.enter);
  return { from, to, plages: taken };
}

/** « N59 / N159 (Lunéville – Sélestat) » : routes puis lieux de la source, sans parenthèse. */
export function sectionTitle(section) {
  const head = zoneLabel(section);
  const i = head.indexOf(', ');
  const roads = i > 0 ? head.slice(0, i) : head;
  const where = i > 0 ? head.slice(i + 2).replace(/\s*\([^)]*\)/g, '').replace(/\s*→\s*/g, ' – ').trim() : '';
  return where ? `${roads} (${where})` : roads;
}

/** « interdite aux plus de 3,5 t en transit » d'après la nature et la valeur de la source ; sinon son texte. */
export function sectionRule(section) {
  const t = String(section?.texte ?? '');
  const tail = t.includes(' : ') ? t.slice(t.indexOf(' : ') + 3).trim() : t.trim();
  const m = /(\d+(?:[.,]\d+)?)\s*t\b/.exec(tail);
  const v = isNum(section?.valeur) ? section.valeur : m ? Number(m[1].replace(',', '.')) : null;
  const local = section?.nature !== 'transit' && /desserte/i.test(tail) ? ', sauf desserte locale' : '';
  const sens = oneWayOf(section?.sens) ? ` (sens ${section.sens})` : '';
  let rule = null;
  if (section?.nature === 'hauteur' && v !== null) rule = `hauteur maximale ${num(isNum(section.valeur) ? section.valeur.toFixed(2) : v)} m`;
  else if (section?.nature === 'transit' && v !== null) rule = `interdite aux plus de ${num(v)} t en transit`;
  else if ((section?.nature === 'poids' || section?.nature === 'interdit') && v !== null) {
    rule = /marchandises/i.test(tail) ? `interdite aux transports de marchandises de plus de ${num(v)} t` : `interdite aux plus de ${num(v)} t`;
  }
  return rule ? `${rule}${local}${sens}` : `${tail}${sens}`;
}

/** « km 39 à 110 » (ou « km 39 »). */
export function rangeText({ from, to }) {
  const a = Math.round(from / 1000); const b = Math.round(to / 1000);
  return b > a ? `km ${a} à ${b}` : `km ${a}`;
}

/**
 * Interdictions d'un itinéraire.
 * @param {object} route itinéraire (parseDirections)
 * @param {object[]} items points sensibles concernés par le profil (sensitiveRules(...).items)
 * @param {object[]} sections sections de la copie (meta.sections)
 * @param {{ vehicle?:object, copy?:object|null, plages?:object[] }} [opts] profil (hauteur, v80) ; absent : sections de
 *   hauteur ignorées. v81 : copy (points de la section) et plages « Accès PL limité » (mergePassages) pour la plage km.
 * @returns {{ id:string, label:string, title:string, rule:string, along:number, range:{ from:number, to:number },
 *   span:{ from:number, to:number }|null, plages:object[], local:boolean, ref:string, text:string, short:string,
 *   source:string }[]}
 */
export function routeBans(route, items, sections, { vehicle = null, copy = null, plages = [] } = {}) {
  const out = [];
  const seen = new Set();
  const h = isNum(vehicle?.height) ? vehicle.height : null;
  const known = new Set((items ?? []).filter((it) => it?.type <= SENSITIVE.TYPES.BAN_BF).map((it) => it.section));
  const all = [...(items ?? []), ...geoSectionItems(route, copy, vehicle, known)].sort((a, b) => a.along - b.along);
  for (const it of all) {
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
    const src = it.type === SENSITIVE.TYPES.BAN ? `Source : ${s.arrete ?? 'arrêté'}` : 'Source : Bison Futé, arrêté non lu';
    const pts = copy ? sectionPoints(copy, s.id) : [];
    const span = pts.length ? sectionSpan(route, pts) : null;
    const wide = widenRange(span ?? { from: it.along, to: it.along }, plages);
    const range = { from: wide.from, to: wide.to };
    const title = sectionTitle(s);
    const rule = sectionRule(s);
    out.push({
      id: s.id, label: zoneLabel(s), title, rule, along: it.along, range, span, plages: wide.plages,
      local: localPossible(s), ref: it.ref ?? '', section: it.section,
      // v81 : une seule ligne par section (titre, règle, plage km, source), sur la fiche et dans les notes.
      text: `${title} : ${rule} · ${rangeText(range)} · ${src} · À vérifier. La signalisation fait foi.`,
      short: `${title} : ${rule} · ${rangeText(range).replace(' à ', '–')}`,
      source: `${src}.`,
    });
  }
  return out;
}

/**
 * v83 : sections d'interdiction traversées d'après la géométrie seule (sans veto du nom d'étape), absentes de `known`
 * (indices de section déjà trouvés par sensitiveRules). Un élément par section, au premier point rencontré.
 * @returns {{ type:number, section:number, ref:string, point:number[], along:number, geoOnly:true }[]}
 */
export function geoSectionItems(route, copy, vehicle = null, known = new Set()) {
  const sections = copy?.meta?.sections ?? [];
  const pts = (copy?.data?.points ?? []).filter((p) => p?.type <= SENSITIVE.TYPES.BAN_BF && p.section >= 0 && !known.has(p.section)
    && !BANS.EXCLUDED.includes(sections[p.section]?.id) && Array.isArray(p.point) && isNum(p.point[0]) && isNum(p.point[1]));
  if (!pts.length) return [];
  // Chaque point compté à part (way = indice : le regroupement par voie n'en garderait qu'un).
  const one = pts.map((p, k) => ({ ...p, type: SENSITIVE.TYPES.TUNNEL, section: -1, way: k, sec: p.section, ptype: p.type }));
  const hits = sensitivePointsAlongRoute(route, { points: one }, { veto: false });
  const bySec = new Map();
  for (const hh of hits) {
    const g = bySec.get(hh.sec) ?? [];
    g.push(hh);
    bySec.set(hh.sec, g);
  }
  const out = [];
  for (const [si, g] of bySec) {
    if (g.length < BANS.GEO_MIN_POINTS || g[g.length - 1].along - g[0].along < BANS.GEO_MIN_M) continue;
    const first = g[0];
    const it = { type: first.ptype, ref: first.ref ?? '', point: first.point, along: first.along, section: si, geoOnly: true };
    if (!concernsVehicle(it, sections[si], vehicle)) continue;
    out.push(it);
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

/**
 * v81 (choix du propriétaire du 26/11/2026 : indiquer sans promouvoir) : sur une fiche rouge, l'autre fiche calculée qui
 * n'a ni interdiction connue ni autre rouge (la plus rapide). L'ordre, le « Recommandé » et la confirmation ne changent
 * pas : arrêtés Bison Futé non lus, l'autre fiche peut passer par des routes secondaires.
 * @param {{ label:string, blocked:boolean, bans:object[], clean:boolean, duration:number, distance:number }[]} cards
 * @param {number} i fiche rouge
 * @returns {string} ligne, ou '' si aucune autre fiche ne convient
 */
export function avoidingBansText(cards, i) {
  const me = cards?.[i];
  if (!me?.blocked || !me.bans?.length) return '';
  const ok = cards.map((c, j) => ({ c, j })).filter(({ c, j }) => j !== i && c && !c.blocked && !c.bans?.length && c.clean
    && isNum(c.duration) && isNum(c.distance));
  if (!ok.length) return '';
  const { c } = ok.sort((a, b) => a.c.duration - b.c.duration)[0];
  const names = [...new Set(me.bans.map((b) => b.title ?? b.label))].join(' ; ');
  const delta = isNum(me.duration) && isNum(me.distance)
    ? ` : ${formatDurationDelta(c.duration - me.duration)}, ${formatDistanceDelta(c.distance - me.distance)}` : '';
  return `${c.label} évite ${names}${delta}. Touche la fiche pour la choisir. À vérifier, la signalisation fait foi.`;
}

/** v81 : morceau du tracé entre `from` et `to` (m depuis le départ), pour le trait rouge de la carte ; [] si vide. */
export function rangeCoords(coords, from, to) {
  if (!Array.isArray(coords) || coords.length < 2 || !isNum(from) || !isNum(to) || to <= from) return [];
  const out = [pointAt(coords, from)];
  let cum = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1]; const b = coords[i];
    cum += Math.hypot((b[0] - a[0]) * kxAt(a[1]), (b[1] - a[1]) * KY);
    if (cum > from && cum < to) out.push(b);
    if (cum >= to) break;
  }
  out.push(pointAt(coords, to));
  return out.filter(Boolean);
}

/** v83 : nom d'une fiche « non proposée » : « N59 / N159 (Lunéville – Sélestat) interdite : trajet non proposé ». */
export function notOfferedText(names) {
  const list = [...new Set((names ?? []).filter(Boolean))];
  if (!list.length) return `${BANS.SHORT_TEXT} : ${BANS.NOT_OFFERED_TEXT}`;
  return `${list.join(' ; ')} interdite${list.length > 1 ? 's' : ''} : ${BANS.NOT_OFFERED_TEXT}`;
}

/**
 * v83 (règle du propriétaire du 26/11/2026, non négociable : un trajet qui traverse une interdiction connue n'est pas
 * proposé) : fiche qui traverse une interdiction connue active (desserte « Oui » déjà retirée) remplacée par une ligne
 * non sélectionnable, sans « Démarrer », dès qu'au moins une autre fiche n'en traverse aucune — même mécanisme que les
 * fiches par Lyon retirées après la rocade (v77). Toutes interdites (aucune alternative) → rien ici : fiche rouge et
 * confirmation (v77 / v78). Pas pendant un contournement en cours (« Démarrer » déjà grisé), ni pour un profil
 * ≤ 3,5 t. L'autre fiche (« Plus court » par des routes secondaires) n'est ni promue ni renommée.
 * @param {{ blocked:boolean, names:string[] }[]} cards
 * @param {{ pending?:boolean, vehicle?:object|null }} [opts]
 * @returns {string[]} texte de la ligne par fiche, '' si proposée
 */
export function notOfferedCards(cards, { pending = false, vehicle = null } = {}) {
  const list = cards ?? [];
  const none = list.map(() => '');
  const w = isNum(vehicle?.weight) ? vehicle.weight : null;
  if (pending || (w !== null && w <= BANS.LIGHT_MAX_T)) return none;
  if (!list.some((c) => c && !c.blocked)) return none;
  return list.map((c) => (c?.blocked ? notOfferedText(c.names) : ''));
}

/** v83 : première fiche proposée (la fiche choisie si elle l'est), -1 si aucune. */
export function firstOffered(notOffered, selected = 0) {
  if (!notOffered?.[selected]) return selected;
  return notOffered.findIndex((t) => !t);
}
