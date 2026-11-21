// Taxes kilométriques PL régionales en France (phase 5h) : R-Pass (Collectivité européenne d'Alsace) et
// écocontribution poids lourds du Grand Est. Information avant le départ, jugée sur l'heure de passage (pauses
// conseillées comprises) ; jamais de voix, de bandeau ni d'annonce dans le guidage. Logique pure.
//
// Données : data/taxes-pl.json (petit fichier dans APP_FILES). Chaque taxe a sa source (clé de `sources`) et sa date
// de lecture (`verified`) ; `status` :
// - 'confirmed' : texte officiel lu (délibération, arrêté) → alerte si la taxe s'applique à l'heure de passage ;
// - 'check' : rien d'officiel lu → ligne d'information « annoncé », « taxe possible », « à vérifier », jamais une
//   alerte, jamais un montant.
// Un montant (`rates`) n'est écrit que s'il a une source officielle datée ; jamais d'estimation.
// Périmètre : références de route des étapes ORS (comme l'Île-de-France et le réseau AURA, hgv-bans.js) dans le
// cadre géographique de la taxe, en France d'après countryinfo (sinon cadre seul, « à vérifier »).

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
    const source = str(t.source) && sources[t.source] ? t.source : null;
    const verified = isDate(t.verified) ? t.verified : null;
    const confirmed = t.status === 'confirmed' && !!source && !!verified;
    const rates = confirmed && Array.isArray(t.rates) ? t.rates.filter((r) => str(r?.text)) : null;
    taxes.push({
      id, name, short: str(t.short) ?? name, start: t.start, bbox, roads,
      status: confirmed ? 'confirmed' : 'check', source, verified, url: str(t.url),
      scope: str(t.scope), note: str(t.note), rates: rates?.length ? rates : null,
    });
  }
  return { verified: isDate(json.verified) ? json.verified : null, sources, taxes };
}

const inBox = ([lon, lat], [w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n;

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
      const hit = s.roads.filter((r) => tax.roads.includes(r));
      if (!hit.length || !inBox(s.lonlat, tax.bbox) || !inFrance(s.along)) continue;
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
  if (tax.status !== 'confirmed') {
    return {
      inForce,
      text: `Taxe possible : ${tax.name}, ${when}, ${km} (${roads}) : périmètre officiel non lu, ${TOLLS.CHECK}.`
        + `${tax.note ? ` ${tax.note}` : ''} Aucun montant connu.${where} ${TOLLS.FOOTER}`,
    };
  }
  const date = inForce ? `en vigueur depuis le ${longDate(tax.start)}` : `à partir du ${longDate(tax.start)}`;
  const src = tax.source ? ` Source : ${tax.sources?.[tax.source]?.name ?? tax.source}, lue le ${shortDate(tax.verified)}.` : '';
  const rates = tax.rates ? ` ${tax.rates.map((r) => r.text).join(' ; ')}.` : '';
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
    const d = describeToll(p);
    const alert = p.tax.status === 'confirmed' && d.inForce;
    out.lines.push({ level: alert ? 'warn' : 'info', text: d.text, url: p.tax.url, linkText: 'Site officiel' });
    if (alert) out.short.push(p.tax.short);
  }
  return out;
}
