// Contrôle camion TomTom (phase 12) : comparaison d'un itinéraire ORS avec le trajet camion proposé par TomTom.
// Logique pure, aucun appel réseau. Points en [longitude, latitude], distances en mètres, durées en secondes.
//
// TomTom n'indique pas, dans sa réponse Calculate Route v1, quelle restriction il a évitée (aucun champ de ce type
// dans la doc ni dans le code du SDK, lus le 22/11/2026 — voir src/lib/tomtom.js). On compare donc la forme des
// tracés : contourner un pont bas ou une route limitée en poids donne un détour LOCAL (le tracé TomTom quitte celui
// d'ORS puis le rejoint par un chemin nettement plus long). Une simple différence de préférence entre moteurs
// (nationale contre autoroute) donne de longs tronçons parallèles de longueur voisine : pas d'alerte.
// Le résultat est toujours formulé au conditionnel : la signalisation fait foi.

import { prepareLine, projectOnSegment } from './nav-geo.js';
import { formatDistance, formatDistanceDelta, formatDurationDelta } from './format.js';

export const ROUTE_CHECK = Object.freeze({
  /** Écart entre deux points d'échantillonnage du tracé ORS (m). */
  STEP_M: 100,
  /** Point ORS « commun » s'il est à moins de cette distance du tracé TomTom (m) : deux cartes différentes
   *  (OSM / TomTom) décalent les routes de 5 à 20 m ; les deux sens d'une 2 × 2 voies sont à moins de 40 m. */
  CORRIDOR_M: 50,
  /** Tronçon divergent ignoré en dessous (m) : échangeurs, giratoires, voies parallèles. */
  MIN_RUN_M: 300,
  /** Début et fin du tracé ignorés (m) : départ et arrivée accrochés à des routes différentes selon le moteur. */
  EDGE_M: 500,
  /** Alerte si un tronçon divergent remplit l'une de ces conditions (détour en m, rapport TomTom / ORS). */
  ALERT_RULES: Object.freeze([
    Object.freeze({ minDetourM: 500, minRatio: 1.5 }),
    Object.freeze({ minDetourM: 1000, minRatio: 1.3 }),
  ]),
  /** Taille d'une case de l'index du tracé TomTom (degrés, ≈ 1 km). */
  GRID_DEG: 0.01,
});

export const CHECK_PENDING_TEXT = 'Contrôle TomTom en cours…';
export const CHECK_NEUTRAL_TEXT = 'Contrôle TomTom : aucune différence significative trouvée. La signalisation fait foi.';
export const CHECK_INCONCLUSIVE_TEXT = "Contrôle TomTom non concluant : TomTom n'a pas trouvé de passage pour camion sur une partie du trajet. La signalisation fait foi.";
export const CHECK_CREDIT_TEXT = 'Contrôle camion : © TomTom.';

/** Index en grille des segments d'une ligne préparée (prepareLine), pour trouver vite le point le plus proche. */
function indexSegments(line, cell) {
  const grid = new Map();
  const key = (x, y) => `${x},${y}`;
  for (let i = 0; i < line.coords.length - 1; i += 1) {
    const a = line.coords[i];
    const b = line.coords[i + 1];
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell);
    const x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell);
    const y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const k = key(x, y);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  }
  return (p) => {
    const cx = Math.floor(p[0] / cell);
    const cy = Math.floor(p[1] / cell);
    const seen = new Set();
    let best = null;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const i of grid.get(key(cx + dx, cy + dy)) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const r = projectOnSegment(p, line.coords[i], line.coords[i + 1]);
          if (!best || r.distance < best.distance) {
            best = { distance: r.distance, along: line.cum[i] + r.t * (line.cum[i + 1] - line.cum[i]) };
          }
        }
      }
    }
    return best; // null : aucun segment à moins d'environ une case (≈ 700 m au moins)
  };
}

/** Point de la ligne à la distance `along` depuis le départ. */
function pointAt(line, along) {
  const { coords, cum } = line;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < along) i += 1;
  const seg = cum[i] - cum[i - 1];
  const t = seg > 0 ? Math.min(1, Math.max(0, (along - cum[i - 1]) / seg)) : 0;
  const a = coords[i - 1];
  const b = coords[i];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

const isLine = (c) => Array.isArray(c) && c.length >= 2;

/**
 * Compare un itinéraire ORS au trajet TomTom.
 * @param {{ coordinates:number[][], distance:number, duration:number }} ors itinéraire d'une fiche
 * @param {{ coordinates:number[][], distance:number, duration:number, otherSections?:{start:number,end:number}[] }} tt
 *   trajet TomTom lu par parseTomTomRoute ; otherSections : indices de points où TomTom n'a pas pu rester en camion
 * @returns {{ share:number, alert:boolean, inconclusive:boolean, firstDivergence:{along:number,lonlat:number[]}|null,
 *   largest:{along:number,orsLength:number,ttLength:number,detour:number,ratio:number,other:boolean}|null,
 *   runs:number, otherSections:number, distanceDelta:number, durationDelta:number }|null}
 *   null si un des tracés est inutilisable.
 */
export function compareWithTomTom(ors, tt) {
  if (!isLine(ors?.coordinates) || !isLine(tt?.coordinates)) return null;
  const C = ROUTE_CHECK;
  const orsLine = prepareLine(ors.coordinates);
  const ttLine = prepareLine(tt.coordinates);
  const nearest = indexSegments(ttLine, C.GRID_DEG);
  const other = (tt.otherSections ?? [])
    .filter((s) => Number.isInteger(s?.start) && Number.isInteger(s?.end))
    .map((s) => [ttLine.cum[Math.max(0, Math.min(s.start, ttLine.cum.length - 1))],
      ttLine.cum[Math.max(0, Math.min(s.end, ttLine.cum.length - 1))]]);

  const total = orsLine.total;
  const n = Math.max(1, Math.ceil(total / C.STEP_M));
  const samples = [];
  for (let k = 0; k <= n; k += 1) {
    const along = Math.min(total, k * (total / n));
    const lonlat = pointAt(orsLine, along);
    const near = nearest(lonlat);
    const close = !!near && near.distance <= C.CORRIDOR_M;
    const edge = along < C.EDGE_M || along > total - C.EDGE_M;
    samples.push({ along, lonlat, near, inside: close || edge, close });
  }

  // Part commune (bouts compris : ils comptent comme ORS les mesure).
  let common = 0;
  for (let k = 1; k < samples.length; k += 1) {
    if (samples[k - 1].close && samples[k].close) common += samples[k].along - samples[k - 1].along;
  }
  const share = total > 0 ? common / total : 1;

  // Tronçons divergents : suites de points hors du couloir, bornées par les derniers points communs.
  const runs = [];
  let k = 0;
  while (k < samples.length) {
    if (samples[k].inside) { k += 1; continue; }
    const from = Math.max(0, k - 1);
    let to = k;
    while (to < samples.length && !samples[to].inside) to += 1;
    to = Math.min(samples.length - 1, to);
    const a = samples[from];
    const b = samples[to];
    const orsLength = b.along - a.along;
    if (orsLength >= C.MIN_RUN_M) {
      // Points de reprise sur TomTom (point commun le plus proche ; départ ou arrivée TomTom à défaut).
      const ta = a.close ? a.near.along : (a.along < C.EDGE_M ? 0 : a.near?.along ?? 0);
      const tb = b.close ? b.near.along : (b.along > total - C.EDGE_M ? ttLine.total : b.near?.along ?? ttLine.total);
      const ttLength = tb - ta;
      const detour = ttLength - orsLength;
      const ratio = orsLength > 0 ? ttLength / orsLength : 1;
      const lo = Math.min(ta, tb);
      const hi = Math.max(ta, tb);
      runs.push({
        along: a.along, lonlat: samples[Math.min(from + 1, to)].lonlat, orsLength, ttLength, detour, ratio,
        other: other.some(([s, e]) => e >= lo && s <= hi),
      });
    }
    k = to + 1;
  }

  const meets = (r) => C.ALERT_RULES.some((rule) => r.detour >= rule.minDetourM && r.ratio >= rule.minRatio);
  const flagged = runs.filter(meets);
  const alert = flagged.some((r) => !r.other);
  const inconclusive = !alert && flagged.some((r) => r.other);
  const largest = runs.reduce((best, r) => (!best || r.detour > best.detour ? r : best), null);
  const first = runs[0] ?? null;
  return {
    share,
    alert,
    inconclusive,
    firstDivergence: first ? { along: first.along, lonlat: first.lonlat } : null,
    largest: largest ? {
      along: largest.along, orsLength: largest.orsLength, ttLength: largest.ttLength,
      detour: largest.detour, ratio: largest.ratio, other: largest.other,
    } : null,
    runs: runs.length,
    otherSections: other.length,
    distanceDelta: (Number(tt.distance) || 0) - (Number(ors.distance) || 0),
    durationDelta: (Number(tt.duration) || 0) - (Number(ors.duration) || 0),
  };
}

/** Alerte de la fiche (au conditionnel, jamais en voix). */
export function checkAlertText(cmp) {
  return `À vérifier : un autre service propose un trajet différent (${formatDistanceDelta(cmp.distanceDelta)}, ${formatDurationDelta(cmp.durationDelta)}), peut-être pour une limite de hauteur ou de poids. La signalisation fait foi.`;
}

/** Ligne discrète d'un contrôle impossible. */
export function checkUnavailableText(reason) {
  return `Contrôle TomTom indisponible : ${reason || 'erreur du service'}.`;
}

/**
 * Ligne discrète sous les fiches, d'après l'état du contrôle et les comparaisons de chaque fiche.
 * @param {{ status:'pending'|'done'|'failed', reason?:string }|null} check
 * @param {(object|null)[]} comparisons résultats de compareWithTomTom, dans l'ordre des fiches
 * @returns {string} vide sans contrôle (pas de clé TomTom)
 */
export function checkSummaryText(check, comparisons = []) {
  if (!check) return '';
  if (check.status === 'pending') return CHECK_PENDING_TEXT;
  if (check.status === 'failed') return checkUnavailableText(check.reason);
  const list = comparisons.filter(Boolean);
  if (!list.length) return `${checkUnavailableText('tracé illisible')} ${CHECK_CREDIT_TEXT}`;
  if (list.some((c) => c.alert)) return CHECK_CREDIT_TEXT;
  if (list.some((c) => c.inconclusive)) return `${CHECK_INCONCLUSIVE_TEXT} ${CHECK_CREDIT_TEXT}`;
  return `${CHECK_NEUTRAL_TEXT} ${CHECK_CREDIT_TEXT}`;
}

const pct = (x) => `${Math.round(x * 100)} %`;
const coord = (p) => `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;

/**
 * Lignes du « Diagnostic du trajet (à copier) » : toujours données quand le contrôle a tourné, même sans alerte,
 * pour régler les seuils sur un trajet réel. Aucune clé, aucune URL.
 * @param {{ status:string, reason?:string }|null} check
 * @param {object|null} cmp compareWithTomTom de l'itinéraire affiché
 */
export function checkDiagnosticLines(check, cmp) {
  if (!check || check.status === 'pending') return [];
  if (check.status === 'failed') return [`Contrôle TomTom : indisponible (${check.reason || 'erreur du service'}).`];
  if (!cmp) return ['Contrôle TomTom : tracé illisible.'];
  const verdict = cmp.alert ? 'alerte' : cmp.inconclusive ? 'non concluant' : 'aucune différence significative';
  const lines = [
    `Contrôle TomTom : ${verdict} ; part du tracé commune ${pct(cmp.share)} (couloir ${ROUTE_CHECK.CORRIDOR_M} m) ; écart TomTom ${formatDistanceDelta(cmp.distanceDelta)}, ${formatDurationDelta(cmp.durationDelta)} ; tronçons divergents ${cmp.runs}.`,
  ];
  if (cmp.firstDivergence) {
    lines.push(`Contrôle TomTom : première divergence au km ${(cmp.firstDivergence.along / 1000).toFixed(1).replace('.', ',')} (${coord(cmp.firstDivergence.lonlat)}).`);
  }
  if (cmp.largest) {
    const l = cmp.largest;
    lines.push(`Contrôle TomTom : plus grand détour ${formatDistanceDelta(l.detour)} (ORS ${formatDistance(l.orsLength)}, TomTom ${formatDistance(l.ttLength)}, rapport ${l.ratio.toFixed(2).replace('.', ',')}) au km ${(l.along / 1000).toFixed(1).replace('.', ',')}${l.other ? ', passage non camion chez TomTom' : ''}.`);
  }
  if (cmp.otherSections) lines.push(`Contrôle TomTom : ${cmp.otherSections} section(s) où TomTom n'a pas pu rester en mode camion.`);
  return lines;
}
