// Taxes kilométriques PL régionales en France (phase 5h) : R-Pass (Collectivité européenne d'Alsace) et
// écocontribution poids lourds du Grand Est. Information avant le départ, jugée sur l'heure de passage (pauses
// conseillées comprises) ; jamais de voix, de bandeau ni d'annonce dans le guidage. Logique pure.
//
// Données : data/taxes-pl.json (petit fichier dans APP_FILES). Chaque taxe a sa source (clé de `sources`) et sa date
// de lecture (`verified`) ; `status` :
// - 'confirmed' : texte officiel lu (délibération, arrêté) → alerte si la taxe s'applique à l'heure de passage ;
// - 'announced' : site officiel de la taxe lu (date « prévue », réseau officiel), délibération non lue ou recours en
//   cours → ligne d'information « prévue à partir du … », jamais une alerte, jamais un montant ;
// - 'check' : rien d'officiel lu → ligne d'information « annoncé », « taxe possible », « à vérifier », jamais une
//   alerte, jamais un montant.
// Un montant (`rates`, `grid`) n'est écrit que s'il a une source officielle datée ; jamais d'estimation ni de total
// du trajet (sections exactes, réductions et exonérations inconnues) : seulement le taux de la catégorie du profil.
// Périmètre : références de route des étapes ORS (comme l'Île-de-France et le réseau AURA, hgv-bans.js) dans le
// cadre géographique de la taxe, en France d'après countryinfo (sinon cadre seul, « à vérifier »).

//
// Sources lues le 21/11/2026 (Action GitHub temporaire : sites refusés au conteneur) :
// - R-Pass, site officiel (r-pass.eu, opérateur désigné par la Collectivité européenne d'Alsace) : « En application de
//   l'article L.421-189 du code des impositions sur les biens et services et conformément à la délibération du Conseil
//   d'Alsace n° CD-2025-4-7-1 du 20 octobre 2025, le poids-lourd […] sera taxé : 1° Sa masse en charge maximale
//   techniquement admissible est supérieure à 3,5 tonnes ; 2° […] catégorie N » ; réseau : « L'A35 et l'A36 pour leurs
//   parties non concédées et situées hors du territoire de l'Eurométropole de Strasbourg, La RD83 entre Colmar et
//   Sélestat, la RD1363, la RD502 et la RD 504 » ; « La taxe R-PASS entrera en vigueur le 1er janvier 2027 » ;
//   dépliant (V02) : grille en centimes par km selon le PTRA (A < 12 t, B 12-18 t, C 18-32 t, D > 32 t) et la classe
//   Euro (0 à VII), réduction à partir de 20 trajets par mois pour les abonnés.
// - Tribunal administratif de Strasbourg (dernières décisions) : aucun communiqué sur le R-Pass ; recours de l'Union
//   régionale du transport d'Alsace connu par la presse seulement → « effet suspensif non établi ».
// - ECPL, site officiel (ecpl.fr) : « L'entrée en vigueur de l'ECPL est prévue le 2 avril 2027 » ; réseau : « A30 en
//   intégralité, A31 de la frontière luxembourgeoise à limite de la concession « Autoroute Paris Rhin Rhône » située au
//   Sud de Toul, A33, A313, RN4, RN44, RN431 en intégralité, RN52 […] pour sa section Meurthe-et-Mosellane » ; grille
//   selon la classe de masse, la classe Euro et la classe d'émissions de CO2 (absente du profil : aucun montant).

import { sampleRoute } from './route-samples.js';
import { countriesAlongRoute } from './countries.js';

export const TOLLS = Object.freeze({
  PATH: 'data/taxes-pl.json',
  /** Écart entre deux points lus sur le tracé (m) ; passages d'une même taxe réunis à moins de 2 km. */
  STEP_M: 200,
  GAP_M: 2000,
  /** Taxes réservées aux véhicules de plus de 3,5 t (PTAC). */
  MIN_WEIGHT_T: 3.5,
  CHECK: 'à vérifier',
  FOOTER: 'La signalisation fait foi.',
  UNAVAILABLE_TEXT: 'Taxes PL régionales indisponibles (données non chargées) : R-Pass en Alsace et écocontribution du Grand Est annoncés en 2027, à vérifier. La signalisation fait foi.',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isDate = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const str = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « 2027-01-01 » → « 1er janvier 2027 ». */
export function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d === 1 ? '1er' : d} ${MONTHS[m - 1]} ${y}`;
}
const shortDate = (iso) => iso.split('-').reverse().join('/');

/** Début de la journée `iso` à l'heure locale de la tablette (comme l'hiver et les interdictions PL). */
function startOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * data/taxes-pl.json → { verified, sources, taxes } ; null si illisible. Une taxe sans nom, date, références de
 * route ou cadre valides est écartée ; `rates` est gardé seulement avec une source et une date de lecture.
 */
export function parseTollData(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.taxes)) return null;
  const sources = json.sources && typeof json.sources === 'object' && !Array.isArray(json.sources) ? json.sources : {};
  const taxes = [];
  for (const t of json.taxes) {
    const id = str(t?.id);
    const name = str(t?.name);
    const bbox = Array.isArray(t?.bbox) && t.bbox.length === 4 && t.bbox.every(isNum) ? t.bbox : null;
    const roads = Array.isArray(t?.roads) ? t.roads.filter((r) => typeof r === 'string' && r) : [];
    if (!id || !name || !isDate(t?.start) || !bbox || !roads.length) continue;
    // Cadre propre à une route (ex. A36 : partie alsacienne seulement, jamais vers Belfort), en plus du cadre général.
    // Contour de la collectivité (anneaux [lon, lat]) : toute route de la taxe doit être dedans (le cadre `bbox`
    // déborde : Territoire de Belfort, Moselle). Anneau illisible → ignoré ; aucun anneau lisible → cadre seul.
    const rings = Array.isArray(t.area?.rings)
      ? t.area.rings.filter((r) => Array.isArray(r) && r.length >= 4 && r.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNum)))
      : [];
    const roadBoxes = {};
    for (const [r, b] of Object.entries(t.roadBoxes && typeof t.roadBoxes === 'object' ? t.roadBoxes : {})) {
      if (Array.isArray(b) && b.length === 4 && b.every(isNum)) roadBoxes[r] = b;
    }
    const source = str(t.source) && sources[t.source] ? t.source : null;
    const verified = isDate(t.verified) ? t.verified : null;
    const sourced = !!source && !!verified;
    const status = sourced && (t.status === 'confirmed' || t.status === 'announced') ? t.status : 'check';
    const confirmed = status === 'confirmed';
    const rates = confirmed && Array.isArray(t.rates) ? t.rates.filter((r) => str(r?.text)) : null;
    const grid = status !== 'check' ? parseGrid(t.grid, sources) : null;
    taxes.push({
      id, name, short: str(t.short) ?? name, start: t.start, bbox, roads, roadBoxes, rings, areaSource: str(t.area?.source),
      status, basis: str(t.basis), source, verified, url: str(t.url),
      scope: str(t.scope), note: str(t.note), rates: rates?.length ? rates : null, grid,
    });
  }
  return { verified: isDate(json.verified) ? json.verified : null, sources, taxes };
}

/**
 * Grille officielle par classe de poids (PTRA) et classe Euro : { source, verified, unit, classes, euro, reduction } ;
 * null sans source datée ou si une ligne n'a pas une valeur par classe.
 */
function parseGrid(g, sources) {
  if (!g || !str(g.source) || !sources[g.source] || !isDate(g.verified) || !Array.isArray(g.classes) || !g.classes.length) return null;
  const classes = g.classes.filter((c) => str(c?.code) && str(c?.label) && (c.max === null || isNum(c.max)))
    .map((c) => ({ code: c.code, label: c.label, max: c.max, maxIncluded: typeof c.maxIncluded === 'boolean' ? c.maxIncluded : null }));
  if (classes.length !== g.classes.length || classes[classes.length - 1].max !== null) return null;
  const euro = {};
  for (const [k, v] of Object.entries(g.euro ?? {})) {
    if (!Array.isArray(v) || v.length !== classes.length || !v.every(isNum)) return null;
    euro[k] = v;
  }
  if (!Object.keys(euro).length) return null;
  return { source: g.source, verified: g.verified, unit: str(g.unit) ?? 'centimes par km', classes, euro, reduction: str(g.reduction) };
}

const fr = (x) => String(x).replace('.', ',');
const EURO_NAMES = { 0: 'Euro 0', 1: 'Euro I', 2: 'Euro II', 3: 'Euro III', 4: 'Euro IV', 5: 'Euro V', 6: 'Euro VI', 7: 'Euro VII' };

/**
 * Taux de la grille pour le profil (poids total et classe Euro). Classe Euro ou poids non précisés : fourchette.
 * Poids sur une limite de classe imprécise : les deux classes, « à vérifier ».
 */
export function gridText(grid, vehicle, sources = {}) {
  const w = isNum(vehicle?.weight) ? vehicle.weight : null;
  const e = typeof vehicle?.euroClass === 'string' ? vehicle.euroClass : '';
  const idx = [];
  if (w !== null) {
    // Limite de classe : `maxIncluded` true → classe du dessous, false → classe du dessus, null (« 12-18T »,
    // « 18-32T » sans précision) → les deux.
    grid.classes.forEach((c, i) => {
      const lo = i ? grid.classes[i - 1] : null;
      const aboveLo = !lo || w > lo.max || (w === lo.max && lo.maxIncluded !== true);
      const belowHi = c.max === null || w < c.max || (w === c.max && c.maxIncluded !== false);
      if (aboveLo && belowHi) idx.push(i);
    });
  }
  const rows = Object.entries(grid.euro);
  const values = (cols) => rows.flatMap(([, v]) => cols.map((i) => v[i]));
  const range = (vals) => `de ${fr(Math.min(...vals))} à ${fr(Math.max(...vals))} ${grid.unit}`;
  const cls = idx.map((i) => `classe ${grid.classes[i].code} (${grid.classes[i].label})`).join(' ou ');
  const edge = idx.length > 1 ? ', limite de classe à vérifier' : '';
  const src = sources[grid.source]?.name ?? grid.source;
  let head;
  if (w === null) head = `poids non précisé dans le profil : ${range(values(grid.classes.map((_, i) => i)))} selon le poids et la classe Euro`;
  else if (e === '' || !(e in grid.euro)) {
    const why = e === 'EEV' ? 'EEV absent de la grille, à vérifier' : 'classe Euro non précisée';
    head = `poids du profil ${fr(w)} t (${cls}${edge}), ${why} : ${range(values(idx))}`;
  } else {
    const v = idx.map((i) => fr(grid.euro[e][i]));
    head = `poids du profil ${fr(w)} t, ${EURO_NAMES[e] ?? `Euro ${e}`} (${cls}${edge}) : ${[...new Set(v)].join(' ou ')} ${grid.unit}`;
  }
  return `Tarif annoncé, ${head} (${src}, lu le ${shortDate(grid.verified)})${grid.reduction ? ` ; ${grid.reduction}` : ''}. Aucun total calculé pour le trajet.`;
}

const inBox = ([lon, lat], [w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n;

/** Point dans un anneau (règle pair-impair). */
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point dans le contour de la taxe (un des anneaux) ; sans contour : vrai (cadre `bbox` seul). */
export function inTaxArea(point, tax) {
  return !tax.rings?.length || tax.rings.some((r) => inRing(point, r));
}

/**
 * Passages du tracé sur chaque taxe : points sur une route de la liste, dans le cadre, en France.
 * @returns {{ tax:object, enter:number, exit:number, enterTime:Date, roads:string[], countryKnown:boolean }[]}
 */
export function tollsAlongRoute(route, { data, departure = new Date(), elapsed = (t) => t } = {}) {
  if (!data?.taxes?.length) return [];
  const samples = sampleRoute(route, TOLLS.STEP_M);
  if (!samples.length) return [];
  const ctry = countriesAlongRoute(route, { departure, elapsed });
  const inFrance = (along) => !ctry.ok || ctry.segments.some((s) => s.code === 'FR' && along >= s.enter && along <= s.exit);
  const out = [];
  for (const tax of data.taxes) {
    let cur = null;
    for (const s of samples) {
      const hit = s.roads.filter((r) => tax.roads.includes(r) && (!tax.roadBoxes?.[r] || inBox(s.lonlat, tax.roadBoxes[r])));
      if (!hit.length || !inBox(s.lonlat, tax.bbox) || !inTaxArea(s.lonlat, tax) || !inFrance(s.along)) continue;
      if (cur && s.along - cur.exit <= TOLLS.GAP_M) {
        cur.exit = s.along;
        for (const r of hit) if (!cur.roads.includes(r)) cur.roads.push(r);
        continue;
      }
      cur = {
        tax, enter: s.along, exit: s.along, roads: [...hit], countryKnown: ctry.ok,
        enterTime: new Date(departure.getTime() + elapsed(s.time) * 1000),
      };
      out.push(cur);
    }
  }
  return out.sort((a, b) => a.enter - b.enter);
}

/** Texte d'un passage. `inForce` : l'heure de passage tombe après la date de début. */
export function describeToll(p) {
  const { tax } = p;
  const km = `de km ${Math.round(p.enter / 1000)} à km ${Math.max(Math.round(p.exit / 1000), Math.round(p.enter / 1000))}`;
  const roads = p.roads.join(', ');
  const inForce = p.enterTime.getTime() >= startOf(tax.start).getTime();
  const when = inForce ? `annoncée depuis le ${longDate(tax.start)}` : `annoncée à partir du ${longDate(tax.start)}`;
  const where = p.countryKnown ? '' : ' Pays traversés non lus : à vérifier.';
  const src = tax.source ? ` Source : ${tax.sources?.[tax.source]?.name ?? tax.source}, lue le ${shortDate(tax.verified)}.` : '';
  if (tax.status === 'announced') {
    const due = inForce ? `prévue depuis le ${longDate(tax.start)}` : `prévue à partir du ${longDate(tax.start)}`;
    return {
      inForce,
      text: `${tax.name[0].toUpperCase()}${tax.name.slice(1)} ${due}, ${km} (${roads}).${tax.scope ? ` ${tax.scope}` : ''}`
        + `${tax.basis ? ` ${tax.basis}` : ''}${tax.note ? ` ${tax.note}` : ''}`
        + ` ${tax.grid ? gridText(tax.grid, p.vehicle, tax.sources) : 'Aucun montant calculé.'}${src}${where} ${TOLLS.FOOTER}`,
    };
  }
  if (tax.status !== 'confirmed') {
    return {
      inForce,
      text: `Taxe possible : ${tax.name}, ${when}, ${km} (${roads}) : périmètre officiel non lu, ${TOLLS.CHECK}.`
        + `${tax.note ? ` ${tax.note}` : ''} Aucun montant connu.${where} ${TOLLS.FOOTER}`,
    };
  }
  const date = inForce ? `en vigueur depuis le ${longDate(tax.start)}` : `à partir du ${longDate(tax.start)}`;
  const rates = `${tax.rates ? ` ${tax.rates.map((r) => r.text).join(' ; ')}.` : ''}${tax.grid ? ` ${gridText(tax.grid, p.vehicle, tax.sources)}` : ''}`;
  return {
    inForce,
    text: `${tax.name} ${date}, ${km} (${roads}).${tax.scope ? ` ${tax.scope}` : ''}${rates}${tax.note ? ` ${tax.note}` : ''}${src}${where} ${TOLLS.FOOTER}`,
  };
}

/**
 * Lignes des notes et des fiches. Véhicule de 3,5 t ou moins : rien. Statut « à vérifier » : information seulement.
 * @param {{ status:'loading'|'ok'|'failed', data:object|null }|null} tolls
 * @returns {{ passages:object[], lines:{ level:'warn'|'info', text:string, url?:string|null }[], short:string[] }}
 */
export function tollRules(route, { vehicle, tolls = null, departure = new Date(), elapsed = (t) => t } = {}) {
  const out = { passages: [], lines: [], short: [] };
  const ptac = isNum(vehicle?.weight) ? vehicle.weight : null;
  if (ptac !== null && ptac <= TOLLS.MIN_WEIGHT_T) return out;
  if (!tolls || tolls.status === 'loading') return out;
  if (tolls.status !== 'ok' || !tolls.data) {
    // Fichier absent : seulement si le tracé passe en France (countryinfo), sinon rien à dire.
    const ctry = countriesAlongRoute(route, { departure, elapsed });
    if (!ctry.ok || ctry.segments.some((s) => s.code === 'FR')) out.lines.push({ level: 'info', text: TOLLS.UNAVAILABLE_TEXT });
    return out;
  }
  const data = { ...tolls.data, taxes: tolls.data.taxes.map((t) => ({ ...t, sources: tolls.data.sources })) };
  out.passages = tollsAlongRoute(route, { data, departure, elapsed });
  for (const p of out.passages) {
    const d = describeToll({ ...p, vehicle });
    const alert = p.tax.status === 'confirmed' && d.inForce;
    out.lines.push({ level: alert ? 'warn' : 'info', text: d.text, url: p.tax.url, linkText: 'Site officiel' });
    if (alert) out.short.push(p.tax.short);
  }
  return out;
}
