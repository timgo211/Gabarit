// Équipements d'hiver en France (phase 5f, loi Montagne) : communes de la copie data/hiver/ traversées par le tracé,
// alerte avant le départ si le passage tombe du 1er novembre au 31 mars. Jamais de voix ni de bandeau. Logique pure.
//
// Sources lues le 21/11/2026 :
// - Réponse ministérielle à la question écrite AN n° 3489 (JO du 21/03/2023, p. 2703) : « le décret n° 2020-1264 du
//   16 octobre 2020 […] prévoit que, dans les massifs de montagne, le préfet de département détermine, par arrêté pris
//   après avis du comité de massif, la liste des communes sur lesquelles des obligations d'équipement des véhicules en
//   circulation s'appliquent du 1er novembre au 31 mars. Les conducteurs […] de poids lourds sans remorque ni semi
//   remorque, ont le choix entre détenir des dispositifs antidérapants amovibles (chaînes à neige métalliques ou
//   textiles) permettant d'équiper au moins deux roues motrices, ou être équipés de quatre pneus hiver. Les poids
//   lourds avec remorque ou semi-remorque doivent quant à eux détenir des chaînes à neige permettant d'équiper au moins
//   deux roues motrices, même s'ils sont équipés de pneus hiver. » ; panneau B26 : « sur des routes enneigées, y
//   compris hors période hivernale, le port – et non la simple détention – de chaînes est obligatoire. Les véhicules
//   possédant les équipements prévus par la nouvelle réglementation sur les pneumatiques (marquage 3PMSF) sont réputés
//   satisfaire à l'obligation instaurée par le panneau B26, sauf lorsque le port de chaînes est explicitement précisé
//   sur un panonceau. »
// - Réponse ministérielle à la question écrite AN n° 10745 (JO du 17/02/2026, p. 1492) : mesure « appliquée de
//   manière pédagogique, sans sanction » ; le décret des sanctions « n'a pas pu être publié en 2025 ».
// - Réponse ministérielle n° 26018 (JO du 12/01/2021) : dérogations possibles sur certaines sections de routes et
//   itinéraires de délestage.
// - Liste des communes : Sécurité routière, fichier du 22/10/2022 (voir winter-convert.js). Arrêtés préfectoraux
//   plus récents : non lus (« à vérifier »).
// Légifrance (décret n° 2020-1264, art. R314-1 et suivants du code de la route) répond 403 au conteneur.

import { prepareLine } from './nav-geo.js';
import { timeAt } from './areas-route.js';
import { dayTime } from './hgv-bans.js';
import { expandRing } from './winter-convert.js';
import { countriesAlongRoute } from './countries.js';

export const WINTER = Object.freeze({
  DIR: 'data/hiver/',
  INDEX_PATH: 'data/hiver/index.json',
  /** Passages d'une même commune réunis à moins de 50 m ; communes voisines réunies en une zone à moins de 2 km. */
  MERGE_M: 50,
  ZONE_GAP_M: 2000,
  /** Noms de communes écrits dans une alerte. */
  MAX_NAMES: 3,
  FOOTER: 'La signalisation fait foi.',
  SHORT: "Équipements d'hiver",
  SOURCE_URL: 'https://www.securite-routiere.gouv.fr/equipements-hivernaux-departements-et-communes',
  UNAVAILABLE_TEXT: "Équipements d'hiver indisponibles (données non chargées) : du 1er novembre au 31 mars, certaines communes de montagne exigent chaînes ou pneus hiver ; la signalisation fait foi.",
  B26_TEXT: "Panneau B26 : chaînes à monter sur route enneigée, même hors de la période du 1er novembre au 31 mars ; pneus 3PMSF admis sauf panonceau « chaînes ». La signalisation fait foi.",
  SANCTION_TEXT: "Sanctions du défaut d'équipement d'hiver : décret pas encore publié au 17/02/2026 (réponse ministérielle), à vérifier.",
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isDate = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const frDate = (iso) => iso.split('-').reverse().join('/');

/** Période d'application en France : du 1er novembre au 31 mars (heure locale de la tablette). */
export function inWinterPeriod(date) {
  const m = date.getMonth();
  return m >= 10 || m <= 2;
}

/** index.json → { updated, listDate, count, departments, tiles } ; null si illisible. */
export function parseWinterIndex(json) {
  const tiles = json?.tiles && typeof json.tiles === 'object' && !Array.isArray(json.tiles) ? json.tiles : null;
  if (!tiles || !Object.keys(tiles).length || !(json.count > 0) || !isDate(json.listDate)) return null;
  return {
    updated: isDate(json.updated) ? json.updated : null, listDate: json.listDate, count: json.count,
    departments: Array.isArray(json.departments) ? json.departments.filter((d) => typeof d === 'string') : [], tiles,
  };
}

/** Case → communes { code, name, dept, partial, bbox, rings } ; null si illisible. */
export function parseWinterTile(json) {
  if (!Array.isArray(json?.communes)) return null;
  const out = [];
  for (const c of json.communes) {
    if (typeof c?.c !== 'string' || !Array.isArray(c.r) || !Array.isArray(c.b) || c.b.length !== 4 || !c.b.every(isNum)) continue;
    const rings = c.r.filter((r) => Array.isArray(r) && r.length >= 6 && r.every(isNum)).map(expandRing);
    if (!rings.length) continue;
    out.push({ code: c.c, name: typeof c.n === 'string' ? c.n : c.c, dept: typeof c.d === 'string' ? c.d : '', partial: c.p === 1, bbox: c.b, rings });
  }
  return out;
}

/**
 * Cases de 1° traversées par le tracé (parcours exact de la grille, segment par segment), parmi celles de l'index.
 * @returns {string[]}
 */
export function routeTiles(coords, index) {
  const keys = new Set();
  const pts = (Array.isArray(coords) ? coords : []).filter((p) => isNum(p?.[0]) && isNum(p?.[1]));
  const add = (x, y) => keys.add(`${Math.floor(x)}_${Math.floor(y)}`);
  if (pts.length === 1) add(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const ts = [0, 1];
    for (const [a, b] of [[ax, bx], [ay, by]]) {
      if (a === b) continue;
      for (let g = Math.ceil(Math.min(a, b)); g <= Math.floor(Math.max(a, b)); g += 1) ts.push((g - a) / (b - a));
    }
    ts.sort((u, v) => u - v);
    for (let k = 1; k < ts.length; k += 1) {
      const t = (ts[k - 1] + ts[k]) / 2;
      add(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  }
  return [...keys].filter((k) => Object.hasOwn(index?.tiles ?? {}, k)).sort();
}

/** Point dans les anneaux (règle pair-impair : trous compris). */
function inside(x, y, rings) {
  let odd = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
  }
  return odd;
}

/** Paramètres t ∈ ]0, 1[ où le segment a→b coupe un côté des anneaux. */
function crossings(ax, ay, bx, by, rings) {
  const out = [];
  const dx = bx - ax;
  const dy = by - ay;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [px, py] = ring[j];
      const ex = ring[i][0] - px;
      const ey = ring[i][1] - py;
      const den = dx * ey - dy * ex;
      if (den === 0) continue;
      const t = ((px - ax) * ey - (py - ay) * ex) / den;
      const u = ((px - ax) * dy - (py - ay) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) out.push(t);
    }
  }
  return out;
}

/**
 * Communes traversées : intersection exacte de chaque segment du tracé avec les contours (aucun échantillonnage :
 * une commune traversée sur quelques mètres est retenue).
 * @param {object} route itinéraire (coordinates)
 * @param {object[]} communes parseWinterTile (toutes cases réunies, doublons de cases permis)
 * @returns {{ code, name, dept, partial, enter:number, exit:number, length:number }[]} triés par entrée
 */
export function communesAlongRoute(route, communes) {
  const coords = route?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || !Array.isArray(communes) || !communes.length) return [];
  const line = prepareLine(coords);
  const uniq = [...new Map(communes.map((c) => [c.code, c])).values()];
  const passes = [];
  for (const c of uniq) {
    const [x0, y0, x1, y1] = c.bbox;
    let cur = null;
    for (let i = 1; i < coords.length; i += 1) {
      const [ax, ay] = coords[i - 1];
      const [bx, by] = coords[i];
      if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) continue;
      const seg = line.cum[i] - line.cum[i - 1];
      const ts = [0, ...crossings(ax, ay, bx, by, c.rings), 1].sort((u, v) => u - v);
      for (let k = 1; k < ts.length; k += 1) {
        if (ts[k] - ts[k - 1] < 1e-12) continue;
        const t = (ts[k - 1] + ts[k]) / 2;
        if (!inside(ax + (bx - ax) * t, ay + (by - ay) * t, c.rings)) continue;
        const from = line.cum[i - 1] + seg * ts[k - 1];
        const to = line.cum[i - 1] + seg * ts[k];
        if (cur && from - cur.exit <= WINTER.MERGE_M) cur.exit = to;
        else {
          cur = { code: c.code, name: c.name, dept: c.dept, partial: c.partial, enter: from, exit: to };
          passes.push(cur);
        }
      }
    }
  }
  for (const p of passes) p.length = p.exit - p.enter;
  return passes.sort((a, b) => a.enter - b.enter);
}

/** Passages → zones (communes voisines à moins de 2 km). */
export function winterZones(passes) {
  const zones = [];
  for (const p of passes) {
    const z = zones[zones.length - 1];
    if (z && p.enter - z.exit <= WINTER.ZONE_GAP_M) {
      z.exit = Math.max(z.exit, p.exit);
      z.passes.push(p);
    } else zones.push({ enter: p.enter, exit: p.exit, passes: [p] });
  }
  return zones;
}

/** Consigne selon la remorque du profil (non précisée : les deux cas). */
export function equipmentText(trailer) {
  if (trailer === 'with') return 'PL avec remorque ou semi-remorque : chaînes à neige pour au moins deux roues motrices à bord, même avec des pneus hiver.';
  if (trailer === 'none') return 'PL sans remorque : chaînes à neige (au moins deux roues motrices) à bord, ou pneus hiver (3PMSF).';
  return 'Avec remorque ou semi-remorque : chaînes à neige pour au moins deux roues motrices à bord, même avec des pneus hiver ; sans remorque : chaînes à bord ou pneus hiver (3PMSF).';
}

const kmOf = (m) => Math.round(m / 1000);

function zoneText(z, { trailer, listDate, enterTime }) {
  const names = [];
  for (const p of z.passes) {
    const label = p.partial ? `${p.name} (en partie, à vérifier)` : p.name;
    if (!names.some((n) => n.code === p.code)) names.push({ code: p.code, label });
  }
  const shown = names.slice(0, WINTER.MAX_NAMES).map((n) => n.label);
  const more = names.length - shown.length;
  const depts = [...new Set(z.passes.map((p) => p.dept).filter(Boolean))].join(', ');
  const a = kmOf(z.enter);
  const b = kmOf(z.exit);
  const where = a === b ? `vers km ${a}` : `de km ${a} à km ${b}`;
  const list = `${shown.join(', ')}${more > 0 ? ` et ${more} autre${more > 1 ? 's' : ''} commune${more > 1 ? 's' : ''}` : ''}${depts ? ` — ${depts}` : ''}`;
  return `Équipements d'hiver exigés du 1er novembre au 31 mars ${where} (${list}), vers ${dayTime(enterTime)} : ${equipmentText(trailer)} Liste nationale du ${frDate(listDate)} : arrêtés préfectoraux plus récents et routes exclues à vérifier. ${WINTER.FOOTER}`;
}

/**
 * Alertes avant le départ.
 * @param {object} route itinéraire
 * @param {{ vehicle?:object, winter?:{ status:string, communes:object[], index:object|null }|null, departure?:Date,
 *   elapsed?:(t:number)=>number }} ctx winter : état du chargement de data/hiver/ (ui/winter.js)
 * @returns {{ lines:{ level:string, text:string, url?:string }[], short:string[], zones:object[] }}
 */
export function winterRules(route, { vehicle = null, winter = null, departure = new Date(), elapsed = (t) => t } = {}) {
  const out = { lines: [], short: [], zones: [] };
  if (!Array.isArray(route?.coordinates) || route.coordinates.length < 2) return out;
  const line = prepareLine(route.coordinates);
  const dateAt = (along) => new Date(departure.getTime() + elapsed(timeAt(route, line, along)) * 1000);
  const along = countriesAlongRoute(route, { departure, elapsed });
  const france = !along.ok || along.segments.some((s) => s.code === 'FR');
  if (!france) return out;
  const anyPeriod = inWinterPeriod(departure) || inWinterPeriod(dateAt(line.total));
  if (winter?.status !== 'ok' || !winter.index) {
    if (anyPeriod && winter?.status !== 'loading') out.lines.push({ level: 'info', text: WINTER.UNAVAILABLE_TEXT, url: WINTER.SOURCE_URL, linkText: 'Liste des communes' });
    return out;
  }
  const zones = winterZones(communesAlongRoute(route, winter.communes));
  for (const z of zones) {
    z.enterTime = dateAt(z.enter);
    z.exitTime = dateAt(z.exit);
    z.inPeriod = inWinterPeriod(z.enterTime) || inWinterPeriod(z.exitTime);
  }
  out.zones = zones;
  const active = zones.filter((z) => z.inPeriod);
  for (const z of active) {
    out.lines.push({
      level: 'warn', url: WINTER.SOURCE_URL, linkText: 'Liste des communes',
      text: zoneText(z, { trailer: vehicle?.trailer ?? '', listDate: winter.index.listDate, enterTime: z.enterTime }),
    });
  }
  if (active.length) {
    out.short.push(WINTER.SHORT);
    out.lines.push({ level: 'info', text: WINTER.B26_TEXT });
    out.lines.push({ level: 'info', text: WINTER.SANCTION_TEXT });
  } else if (anyPeriod && !zones.length) {
    out.lines.push({
      level: 'info',
      text: `Aucune commune soumise aux équipements d'hiver signalée sur ce trajet (liste nationale du ${frDate(winter.index.listDate)}), la signalisation fait foi.`,
    });
  }
  return out;
}
