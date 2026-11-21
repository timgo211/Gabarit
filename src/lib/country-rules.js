// Réglementation PL des pays traversés (phase 5c) : fiches par pays avant le départ, ligne du bandeau et annonce
// vocale vers 3 km de la frontière pendant le guidage. Logique pure.
//
// Données : data/pays/{BE,LU,DE,CH,IT,ES}.json (petits fichiers, dans APP_FILES : lisibles hors ligne à l'étranger).
// Chaque règle porte "source" (clé de "sources" : nom, lien, "national" ou "bisonfute") et "verified" (date de lecture).
// Une règle sans source lue est affichée « à vérifier » et n'est jamais dite à voix haute. Les vitesses demandent une
// source nationale ; Bison Futé (« Restrictions pays limitrophes ») suffit pour les jours fériés et l'absence
// d'interdiction. La voix ne dit que les contraintes confirmées (jamais une absence d'interdiction).
// Sources lues le 20/11/2026 (détail dans chaque fichier) :
// - BE : code de la route, AR du 1/12/1975 art. 11 (texte publié par l'institut Vias) ; Viapass ; Bison Futé.
// - LU : code de la route art. 139 (texte coordonné du 12/06/2026, Legilux) ; police grand-ducale (interdiction
//   de transit, règlement grand-ducal du 19/07/1997) ; Guichet.lu (Eurovignette).
// - DE : StVO § 3, § 18, § 30 ; FerReiseV § 1 (samedis d'été : tronçons à vérifier, jamais calculé) ; BFStrMG § 1.
// - CH : OCR art. 5 et 91 (fedlex) ; OFROU ; OFDF (RPLP) ; LVA art. 3 al. 2 (pas de vignette pour la RPLP).
// - IT : Codice della strada art. 142 ; décret MIT du 12/12/2025 (GU n. 302), calendrier 2026, art. 3 et 12.
// - ES : Reglamento General de Circulación art. 48 ; résolution DGT du 14/01/2026 (BOE-A-2026-1255), annexes II, V.
// Poids total maximal national et hauteur maximale (phase 5e, bloc "limits", lus le 21/11/2026) :
// - DE : StVZO § 34 al. 6 (plus de 4 essieux 40 t ; intermodal 42 / 44 t) et § 32 al. 2 (4,00 m).
// - CH : LCR art. 9 al. 1 (version du 1/07/2026, Fedlex) : « 40 t ou de 44 t en cas de transport combiné ; la
//   hauteur maximale autorisée est de 4 m ».
// - IT : Codice della strada art. 62 al. 4 (« 44 t se a cinque o più assi ») et art. 61 al. 1 b (4 m), Normattiva.
// - ES : Orden PJC/780/2025 du 21/07/2025 (BOE du 23/07/2025), RGV annexe IX : articulés de 5 essieux et plus 44 t,
//   trois mois après la publication (23/10/2025 ; citernes six mois : 23/01/2026) ; hauteur 4,00 m (4,50 m pour
//   certains transports).
// - BE, LU : textes non lisibles depuis le conteneur (captcha eJustice, Legilux en JavaScript) → « à vérifier ».
// En trafic international : 40 t quel que soit le maximum national (weights.js).
// Équipements d'hiver (phase 5f, bloc "winter", lus le 21/11/2026) :
// - DE : StVO § 2 al. 3a (pneus d'hiver par verglas, neige, neige fondante ; M2, M3, N2, N3 : au moins les essieux
//   moteurs permanents et les essieux directeurs avant) et StVZO § 36 al. 4 (symbole Alpine, 3PMSF).
// - LU : code de la route art. 160 par. 4 (pneus M+S ou 3PMSF par verglas, neige ; N2, N3 : tous les essieux moteurs),
//   signal D,9 « Chaînes à neige obligatoires », art. 156 par. 2 (PL de plus de 7,5 t interdits sur autoroute par
//   verglas ou neige quand les panneaux l'affichent) — texte coordonné du 12/06/2026, Legilux (PDF).
// - CH : OSR (RS 741.21) art. 29, signal 2.48 « Chaînes à neige obligatoires » (Fedlex, version du 1/10/2026).
// - IT : Codice della strada art. 6 al. 4 e (ordonnance : pneus hiver ou chaînes à bord) ; période 15/11 – 15/04
//   (directive du MIT) non lue : mit.gov.it refuse le conteneur → « à vérifier ».
// - ES : Reglamento General de Circulación (BOE-A-2003-23514), messages « Obligatorio el uso de cadenas o neumáticos
//   de invierno » des panneaux.
// - BE : code de la route art. 81.4.4 (chaînes seulement en cas de neige ou de verglas), codedelaroute.be.
// - AT : KFG 1967 § 102 non lu (RIS refuse le conteneur ; lu dans le journal de l'Action « Équipements d'hiver »).
// Normes Euro (phase 5g, bloc "euro", lus le 21/11/2026) : voir euro.js et chaque fichier.
// - CH : ORPL (RS 641.811) art. 14 et annexe 1 (version du 1/01/2025, Fedlex, point SPARQL).
// - DE : BFStrMG annexe 1 ch. 2 (catégories A à F) ; 35. BImSchV annexe 2 (vignette verte, groupe 4).
// - AT : Tyrol (A12) texte RIS non lu → « à vérifier ». IT : interdictions régionales → « à vérifier ».
// Heures : heure locale de la tablette (les six pays sont à l'heure de Paris, Canaries exceptées).

import { countryHolidays, countryHolidayName, REGIONAL_HOLIDAYS, dayKey, addDays } from './holidays.js';
import { countriesAlongRoute, countryName, inCountry, COUNTRIES } from './countries.js';
import { dayTime } from './hgv-bans.js';
import { tunnelName } from './adr.js';
import { countryEuroText } from './euro.js';

export const COUNTRY_RULES = Object.freeze({
  FILES: Object.freeze(['BE', 'LU', 'DE', 'CH', 'IT', 'ES', 'AT']),
  /** Bandeau du guidage : de 20 km avant la frontière à 1 km après. */
  BANNER_M: 20000,
  BANNER_AFTER_M: 1000,
  /** Annonce vocale une fois vers 3 km (pas sous 300 m). */
  ANNOUNCE_M: 3000,
  ANNOUNCE_MIN_M: 300,
  FOOTER: 'La signalisation fait foi.',
  CHECK: 'à vérifier',
});

export const countryDataPath = (code) => `data/pays/${code}.json`;

const isStr = (x) => typeof x === 'string' && x.length > 0;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isTime = (x) => typeof x === 'string' && /^\d{2}:\d{2}$/.test(x);
const isDate = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s"<>]+$/.test(u) ? u : null);
const items = (a) => (Array.isArray(a) ? a.filter((x) => x && isStr(x.text)) : []);

/**
 * Lit un fichier data/pays/XX.json ; null s'il est illisible (code ou nom absent). Les règles mal formées sont
 * ignorées une à une.
 */
export function parseCountryData(json) {
  if (!json || typeof json !== 'object' || !/^[A-Z]{2}$/.test(json.code ?? '') || !isStr(json.name)) return null;
  const sources = {};
  for (const [k, s] of Object.entries(json.sources ?? {})) {
    if (s && isStr(s.name)) sources[k] = { name: s.name, url: safeUrl(s.url), kind: s.kind === 'bisonfute' ? 'bisonfute' : 'national' };
  }
  const bans = (Array.isArray(json.bans) ? json.bans : []).filter((b) => b && isStr(b.text) && isStr(b.kind));
  const speeds = json.speeds && Array.isArray(json.speeds.bands)
    ? { ...json.speeds, bands: json.speeds.bands.filter((b) => b && isNum(b.over)), notes: items(json.speeds.notes), adr: items(json.speeds.adr) }
    : null;
  return {
    code: json.code, name: json.name, verified: isDate(json.verified) ? json.verified : null, sources, speeds, bans,
    holidays: json.holidays && isStr(json.holidays.list) ? json.holidays : null,
    toll: items(json.toll), lez: items(json.lez), adr: items(json.adr),
    limits: parseLimits(json.limits),
    winter: items(json.winter),
    euro: items(json.euro),
  };
}

/** Bloc "limits" : { weight, height } avec max (t, m) facultatif ; règle sans texte ignorée. */
function parseLimits(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pos = (x) => (isNum(x) && x > 0 ? x : null);
  const one = (r) => (r && isStr(r.text) ? { ...r, max: pos(r.max), combinedMax: pos(r.combinedMax) } : null);
  const out = { weight: one(raw.weight), height: one(raw.height) };
  return out.weight || out.height ? out : null;
}

/** Source d'une règle : { name, url, kind } ou null. */
export function ruleSource(rule, data) {
  const s = rule && isStr(rule.source) ? data?.sources?.[rule.source] : null;
  return s ?? null;
}

/** Règle confirmée : source lue (avec lien) et date de vérification ; national=true exige une source nationale. */
export function isConfirmed(rule, data, { national = false } = {}) {
  const s = ruleSource(rule, data);
  if (!s || !s.url || !isDate(rule?.verified)) return false;
  return !national || s.kind === 'national';
}

// ───────── Vitesses selon le PTAC ─────────

const ptacOf = (vehicle) => (isNum(vehicle?.weight) ? vehicle.weight : null);
const kmh = (n) => `${n} km/h`;
const tons = (n) => `${String(n).replace('.', ',')} t`;

/** Tranche de vitesses du véhicule (PTAC strictement au-dessus de `over`, jusqu'à `upTo` compris). */
export function speedBand(data, vehicle) {
  const ptac = ptacOf(vehicle);
  if (ptac === null || !data?.speeds) return null;
  return data.speeds.bands.find((b) => ptac > b.over && (b.upTo === null || b.upTo === undefined || ptac <= b.upTo)) ?? null;
}

export function speedText(band, vehicle) {
  const parts = [`autoroute ${kmh(band.motorway)}`];
  const road = band.roadText ?? (isNum(band.road) ? kmh(band.road) : null);
  if (road) parts.push(`hors agglomération ${road}`);
  const town = band.townText ?? (isNum(band.town) ? kmh(band.town) : null);
  if (town) parts.push(`agglomération ${town}`);
  return `PL de ${tons(ptacOf(vehicle))} : ${parts.join(', ')}.`;
}

function speedVoice(band) {
  if (isNum(band.road) && band.road !== band.motorway) {
    return `poids lourds : ${band.motorway} kilomètres heure sur autoroute, ${band.road} sur route`;
  }
  return `poids lourds : ${band.motorway} kilomètres heure`;
}

// ───────── Interdictions : fenêtres horaires ─────────

const at = (day, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
};
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const DAY_MS = 86400000;

function findBan(data, id) {
  return data?.bans?.find((b) => b.id === id) ?? null;
}

/** Années du calendrier connues pour cette règle (calendar, calendarOf, calendarYears). */
function knownYears(ban, data) {
  if (Array.isArray(ban.calendarYears)) return ban.calendarYears.map(String);
  const cal = ban.calendarOf ? findBan(data, ban.calendarOf)?.calendar : ban.calendar;
  return Object.keys(cal ?? {});
}

/** Règle liée à un calendrier annuel (IT, ES). */
export const isAnnual = (ban) => ban.kind === 'calendar' || Array.isArray(ban.calendarYears);

/**
 * Fenêtres d'interdiction d'une règle entre deux dates (marge d'un jour de chaque côté).
 * @returns {{ start:Date, end:Date }[]}
 */
export function banWindowsBetween(ban, data, from, to, { holidayList = null } = {}) {
  const out = [];
  const first = addDays(midnight(from), -1);
  const last = addDays(midnight(to), 1);
  const list = holidayList ?? ban.holidays ?? null;
  const isHol = (d) => (list ? countryHolidays(list, d.getFullYear()).has(dayKey(d)) : false);
  for (let d = first; d <= last; d = addDays(d, 1)) {
    if (ban.kind === 'daily' && isTime(ban.from) && isTime(ban.to)) {
      const start = at(d, ban.from);
      let end = at(d, ban.to);
      if (end <= start) end = new Date(end.getTime() + DAY_MS);
      out.push({ start, end });
    } else if (ban.kind === 'weekly' && isTime(ban.from) && isTime(ban.to)) {
      const banned = (Array.isArray(ban.days) && ban.days.includes(d.getDay())) || isHol(d);
      if (!banned) continue;
      const end = ban.to === '24:00' ? addDays(d, 1) : at(d, ban.to);
      out.push({ start: at(d, ban.from), end });
      const eve = ban.eve;
      if (eve && isTime(eve.from)) {
        const prev = addDays(d, -1);
        const okHol = !eve.holidaysOnly || isHol(d);
        const okDow = !Array.isArray(eve.dows) || eve.dows.includes(prev.getDay());
        if (okHol && okDow) {
          const eveEnd = !eve.to || eve.to === '24:00' ? d : at(prev, eve.to);
          out.push({ start: at(prev, eve.from), end: eveEnd });
        }
      }
    } else if (ban.kind === 'calendar') {
      const year = String(d.getFullYear());
      const cal = (ban.calendarOf ? findBan(data, ban.calendarOf)?.calendar : ban.calendar)?.[year] ?? [];
      const mmdd = dayKey(d).slice(5);
      for (const e of cal) {
        if (Array.isArray(e) && e[0] === mmdd && isTime(e[1]) && isTime(e[2])) {
          out.push({ start: at(d, e[1]), end: e[2] === '24:00' ? addDays(d, 1) : at(d, e[2]) });
        }
      }
      const extra = ban.extra?.[year];
      if (extra && mmdd >= extra.from && mmdd <= extra.to) {
        for (const w of extra.windows ?? []) {
          if (w[0] === d.getDay() && isTime(w[1]) && isTime(w[2])) {
            out.push({ start: at(d, w[1]), end: w[2] === '24:00' ? addDays(d, 1) : at(d, w[2]) });
          }
        }
      }
    }
  }
  out.sort((a, b) => a.start - b.start);
  // Fenêtres qui se touchent (veille + jour, deux jours fériés) réunies.
  const merged = [];
  for (const w of out) {
    const lastW = merged[merged.length - 1];
    if (lastW && w.start <= lastW.end) { if (w.end > lastW.end) lastW.end = w.end; } else merged.push({ ...w });
  }
  return merged;
}

/** Première fenêtre qui chevauche le passage [enter, exit], ou null. */
export function windowDuring(windows, enter, exit) {
  return windows.find((w) => w.start < exit && w.end > enter) ?? null;
}

/**
 * Le véhicule est-il concerné par cette interdiction sur ce passage ?
 * @returns {{ concerned:boolean|null, reason:string|null }} null : dépend d'un réglage absent (classe ADR)
 */
export function banConcerns(ban, vehicle, segment) {
  if (ban.adr) {
    if (!vehicle?.hazmat) return { concerned: false, reason: null };
    if (Array.isArray(ban.adrClasses)) {
      if (!vehicle.adrClass) return { concerned: null, reason: 'classe ADR non renseignée dans Réglages' };
      if (!ban.adrClasses.includes(String(vehicle.adrClass).split('.')[0]) && !ban.adrClasses.includes(String(vehicle.adrClass))) {
        return { concerned: false, reason: `classe ${vehicle.adrClass} non concernée` };
      }
    }
  }
  const ptac = ptacOf(vehicle);
  if (isNum(ban.over) && ban.over > 0 && ptac !== null && !(ptac > ban.over)) {
    return { concerned: false, reason: `PTAC ${tons(ptac)}, jusqu'à ${tons(ban.over)} non concerné` };
  }
  if (isStr(ban.transitTo)) {
    const transit = segment?.prev && segment.prev !== segment.code && segment.next === ban.transitTo;
    if (!transit) return { concerned: false, reason: `pas en transit vers ${countryName(ban.transitTo)}` };
  }
  return { concerned: true, reason: null };
}

/** Fin à minuit : « dimanche 24 h » plutôt que « lundi 0 h ». */
const endText = (d) => (d.getHours() === 0 && d.getMinutes() === 0
  ? `${dayTime(new Date(d.getTime() - 60000)).replace(/ \d+ h \d+$/, '')} 24 h`
  : dayTime(d));
const winText = (w) => `${dayTime(w.start)} → ${endText(w.end)}`;
const kmOf = (m) => `km ${Math.round(m / 1000)}`;
const meters = (n) => `${n.toFixed(2).replace('.', ',')} m`;

function limitItems(data, vehicle, push, card, segment) {
  const { weight, height } = data.limits ?? {};
  if (weight) {
    const ok = weight.max !== null && isConfirmed(weight, data, { national: true });
    const ptac = ptacOf(vehicle);
    // Transport combiné : maximum propre au pays s'il existe (DE, CH : 44 t).
    const max = vehicle?.combined && weight.combinedMax ? weight.combinedMax : weight.max;
    const over = ok && ptac !== null && ptac > max;
    push('Poids et hauteur', weight, `${weight.text}${over ? ` Votre profil indique ${tons(ptac)} : au-delà du maximum national (${tons(max)}), vérifiez votre poids réel.` : ''}`,
      { confirmed: ok, level: over ? 'warn' : 'info' });
  }
  if (height) {
    const ok = height.max !== null && isConfirmed(height, data, { national: true });
    const h = isNum(vehicle?.height) ? vehicle.height : null;
    const over = ok && h !== null && h > height.max + 1e-9;
    push('Poids et hauteur', height, `${height.text}${over ? ` Votre profil indique ${meters(h)} : au-delà de la hauteur maximale (${meters(height.max)}).` : ''}`,
      { confirmed: ok, level: over ? 'warn' : 'info' });
    if (over) card.heightOver = true;
    if (over) card.warnings.push(`${segment.name} : hauteur maximale ${meters(height.max)}, votre profil indique ${meters(h)} (${kmOf(segment.enter)} → ${kmOf(segment.exit)}). ${COUNTRY_RULES.FOOTER}`);
  }
}


// ───────── Fiche d'un pays ─────────

/**
 * Fiche d'un pays traversé.
 * @param {object|null} data parseCountryData (null : fichier absent ou pays sans fiche)
 * @param {{ code:string, name:string, enter:number, exit:number, enterTime:Date, exitTime:Date, prev, next }} segment
 * @param {{ vehicle:object, now?:Date, tunnels?:object[]|null, status?:string }} ctx tunnels : passages de tunnels
 *   (tunnelRules, phase 5b) ; status : 'loading' | 'failed' | 'ok' du fichier du pays
 * @returns {{ code, name, enter, exit, enterTime, exitTime, items:{ section:string, text:string, confirmed:boolean,
 *   source:{ name, url, kind }|null, url:string|null, inForce:'yes'|'no'|null, level:'warn'|'info' }[],
 *   warnings:string[], voice:string[], labels:string[], footer:string }}
 */
export function countryCard(data, segment, { vehicle, now = new Date(), tunnels = null, status = 'ok' } = {}) {
  const card = {
    code: segment.code, name: segment.name, enter: segment.enter, exit: segment.exit,
    enterTime: segment.enterTime, exitTime: segment.exitTime, items: [], warnings: [], voice: [], labels: [],
    footer: COUNTRY_RULES.FOOTER,
  };
  const push = (section, rule, text, extra = {}) => {
    const confirmed = extra.confirmed ?? isConfirmed(rule, data);
    card.items.push({
      section, text: confirmed ? text : (/à vérifier/.test(text) ? text : `${text} (${COUNTRY_RULES.CHECK})`),
      confirmed, source: ruleSource(rule, data), url: safeUrl(extra.url ?? rule?.url) ?? null,
      inForce: extra.inForce ?? null, level: extra.level ?? 'info',
    });
  };
  if (!data) {
    const why = status === 'loading' ? 'en cours de chargement' : 'non chargées';
    card.items.push({
      section: 'Règles', text: `Règles PL ${inCountry(segment.code)} ${why} : ${COUNTRY_RULES.CHECK}.`, confirmed: false,
      source: null, url: null, inForce: null, level: 'warn',
    });
    return card;
  }

  // Vitesses (source nationale obligatoire).
  const band = speedBand(data, vehicle);
  const speedOk = band && isConfirmed(data.speeds, data, { national: true });
  if (band) {
    push('Vitesses', data.speeds, speedText(band, vehicle), { confirmed: speedOk });
    if (speedOk) {
      card.voice.push(speedVoice(band));
      card.labels.push(`PL ${band.motorway} km/h`);
    }
  } else if (data.speeds) {
    push('Vitesses', data.speeds, ptacOf(vehicle) === null ? 'PTAC du véhicule non renseigné : vitesses PL à lire sur la signalisation.' : 'Véhicule de 3,5 t ou moins : vitesses des voitures.', { confirmed: !!ptacOf(vehicle) });
  }
  for (const n of data.speeds?.notes ?? []) push('Vitesses', n, n.text);
  if (vehicle?.hazmat) {
    for (const n of data.speeds?.adr ?? []) {
      const cls = Array.isArray(n.classes) ? n.classes : null;
      if (cls && vehicle.adrClass && !cls.includes(String(vehicle.adrClass))) continue;
      push('ADR', n, cls && !vehicle.adrClass ? `${n.text} Selon la classe ADR (non renseignée).` : n.text);
      if (isConfirmed(n, data) && isStr(n.voice) && (!cls || cls.includes(String(vehicle.adrClass)))) card.voice.push(n.voice);
    }
  }

  // Poids et hauteur (phase 5e) : maximum national, rappel des 40 t en international, comparaison avec le profil.
  limitItems(data, vehicle, push, card, segment);

  // Interdictions.
  const years = [...new Set([now, segment.enterTime, segment.exitTime].map((d) => String(d.getFullYear())))];
  for (const ban of data.bans) {
    if (ban.adr && !vehicle?.hazmat) continue;
    const section = ban.adr ? 'ADR' : 'Interdictions';
    if (ban.kind === 'none') { push(section, ban, ban.text); continue; }
    const missing = isAnnual(ban) ? years.filter((y) => !knownYears(ban, data).includes(y)) : [];
    if (missing.length && ban.missing?.text) {
      // Rappel dès le 1er janvier : calendrier de l'année absent, lien vers le texte officiel à lire.
      card.items.push({
        section, text: ban.missing.text.replace('{year}', missing.join(', ')), confirmed: false, source: null,
        url: safeUrl(ban.missing.url), inForce: null, level: 'warn',
      });
    }
    if (ban.kind === 'info') { push(section, ban, ban.text, { url: ban.url }); continue; }
    const c = banConcerns(ban, vehicle, segment);
    if (c.concerned === false) {
      push(section, ban, `${ban.text}${c.reason ? ` Non concerné : ${c.reason}.` : ''}`);
      continue;
    }
    const confirmed = isConfirmed(ban, data);
    let inForce = null;
    let extraText = '';
    if (confirmed && c.concerned === true && !missing.length) {
      const w = windowDuring(banWindowsBetween(ban, data, segment.enterTime, segment.exitTime), segment.enterTime, segment.exitTime);
      inForce = w ? 'yes' : 'no';
      extraText = w
        ? ` En vigueur à votre passage ? Oui : ${winText(w)}, vous y seriez de ${dayTime(segment.enterTime)} à ${dayTime(segment.exitTime)} (${kmOf(segment.enter)} → ${kmOf(segment.exit)}).`
        : ` En vigueur à votre passage ? Non (${dayTime(segment.enterTime)} → ${dayTime(segment.exitTime)}).`;
      if (w) card.warnings.push(`${segment.name}, interdiction PL (${ban.label ?? 'règle du pays'}) ${winText(w)} pendant votre passage (${kmOf(segment.enter)} → ${kmOf(segment.exit)}, ${dayTime(segment.enterTime)} → ${dayTime(segment.exitTime)}). ${COUNTRY_RULES.FOOTER}`);
    } else if (c.concerned === null) extraText = ` ${c.reason ? `${c.reason[0].toUpperCase()}${c.reason.slice(1)} : ` : ''}${COUNTRY_RULES.CHECK}.`;
    push(section, ban, `${ban.text}${extraText}`, { inForce, level: inForce === 'yes' ? 'warn' : 'info' });
    if (confirmed && c.concerned === true && isStr(ban.voice)) {
      card.voice.push(inForce === 'yes' ? `${ban.voice}, en vigueur à votre passage` : ban.voice);
      if (isStr(ban.label)) card.labels.push(inForce === 'yes' ? `${ban.label} (en vigueur)` : ban.label);
    }
  }

  // Jours fériés nationaux pendant le passage, fêtes régionales à vérifier.
  if (data.holidays) {
    const list = data.holidays.list;
    const seen = [];
    for (let d = midnight(segment.enterTime); d <= segment.exitTime; d = addDays(d, 1)) {
      const name = countryHolidayName(list, d);
      if (name) seen.push(`${name} (${dayKey(d).split('-').reverse().slice(0, 2).join('/')})`);
    }
    if (seen.length) push('Jours fériés', data.holidays, `Jour férié national à votre passage : ${seen.join(', ')}.`);
    if (REGIONAL_HOLIDAYS[data.code]) push('Jours fériés', null, REGIONAL_HOLIDAYS[data.code]);
  }

  // Équipements d'hiver (phase 5f) : affichés toute l'année, jamais dits ; IT : période « à vérifier », sans alerte.
  for (const t of data.winter) push("Équipements d'hiver", t, t.text, { url: t.url });

  // Normes Euro (phase 5g) : catégorie de la classe du profil quand la règle la donne (rule.mine), jamais dit.
  for (const t of data.euro) push('Normes Euro', t, countryEuroText(t, vehicle), { url: t.url });

  for (const t of data.toll) push('Péage PL', t, t.text, { url: t.url });
  for (const t of data.lez) push('ZFE et vignettes', t, t.text, { url: t.url });
  if (vehicle?.hazmat) {
    for (const t of data.adr) push('ADR', t, t.text, { url: t.url });
    // Tunnels du tracé dans ce pays : passages de la copie data/tunnels-adr.json (phase 5b), catégories non recopiées.
    const tun = (tunnels ?? []).filter((p) => isNum(p.enter) && p.enter >= segment.enter && p.enter < segment.exit);
    if (tun.length) {
      const names = tun.map((p) => `${tunnelName(p)}${p.forbidden ? ' (interdit à votre code)' : ''}`);
      card.items.push({
        section: 'ADR', text: `Tunnels signalés sur ce trajet : ${names.join(', ')} (copie OpenStreetMap, voir l'alerte tunnels).`,
        confirmed: true, source: null, url: null, inForce: null, level: tun.some((p) => p.forbidden) ? 'warn' : 'info',
      });
    }
  }
  return card;
}

/**
 * Pays traversés et fiches (hors France, déjà couverte par la phase 5).
 * @param {{ vehicle:object, departure?:Date, elapsed?:Function, countries?:Map<string,{ status:string, data:object|null }>|null,
 *   tunnels?:object[]|null, now?:Date }} ctx countries : fichiers data/pays chargés, par code
 * @returns {{ ok:boolean, segments:object[], crossings:object[], cards:object[], lines:object[], short:string[] }}
 */
export function countryRules(route, { vehicle, departure = new Date(), elapsed = (t) => t, countries = null, tunnels = null, now = null } = {}) {
  const along = countriesAlongRoute(route, { departure, elapsed });
  const out = { ...along, cards: [], lines: [], short: [] };
  if (!along.ok) {
    out.lines.push({ level: 'info', text: COUNTRIES.UNAVAILABLE_TEXT });
    return out;
  }
  if (along.segments.every((s) => s.code === 'FR')) return out;
  const list = along.segments.map((s, i) => (i === 0
    ? s.name
    : `${s.name} (${kmOf(s.enter)}, vers ${dayTime(s.enterTime)})`));
  out.lines.push({ level: 'info', text: `Pays traversés : ${list.join(' → ')}. Une fiche par pays ci-dessous.` });
  for (const s of along.segments) {
    if (s.code === 'FR') continue;
    const entry = countries?.get?.(s.code) ?? null;
    const card = countryCard(entry?.status === 'ok' ? entry.data : null, s, {
      vehicle, now: now ?? departure, tunnels, status: entry?.status ?? 'failed',
    });
    out.cards.push(card);
    for (const w of card.warnings) out.lines.push({ level: 'warn', text: w });
    if (card.warnings.length > (card.heightOver ? 1 : 0)) out.short.push(`Interdiction PL ${s.name}`);
    if (card.heightOver) out.short.push(`Hauteur max ${s.name}`);
  }
  return out;
}

// ───────── Guidage : bandeau et annonce vocale ─────────

/**
 * Frontières du trajet suivi (pays de destination hors France) avec les fiches de chaque pays.
 * @returns {{ code, name, along, exit, segment }[]}
 */
export function prepareGuidanceBorders(route, { countries = null } = {}) {
  const along = countriesAlongRoute(route, {});
  if (!along.ok) return [];
  return along.segments.slice(1).filter((s) => s.code !== 'FR').map((s) => {
    const entry = countries?.get?.(s.code) ?? null;
    return { code: s.code, name: s.name, along: s.enter, exit: s.exit, prev: s.prev, next: s.next, data: entry?.status === 'ok' ? entry.data : null };
  });
}

/** « 12 km », « 800 m ». */
const distText = (m) => (m >= 1000 ? `${Math.round(m / 1000)} km` : `${Math.max(0, Math.round(m / 100) * 100)} m`);

/**
 * Prochaine frontière : ligne du bandeau sous 20 km (jusqu'à 1 km après), annonce une fois vers 3 km, avec les seules
 * règles confirmées. Aucune saisie.
 * @param {{ along:number, now:number, timeTo:(along:number)=>number, vehicle:object }} ctx timeTo : secondes jusqu'à
 */
export function guidanceBorder(borders, announced = {}, { along, now, timeTo, vehicle }) {
  const next = (borders ?? []).find((b) => b.along + COUNTRY_RULES.BANNER_AFTER_M >= along);
  if (!next) return { view: null, speak: null, announced };
  const distance = next.along - along;
  if (distance > COUNTRY_RULES.BANNER_M) return { view: null, speak: null, announced };
  const enterTime = new Date(now + Math.max(0, timeTo(next.along)) * 1000);
  const exitTime = new Date(now + Math.max(0, timeTo(next.exit)) * 1000);
  const card = countryCard(next.data, {
    code: next.code, name: next.name, enter: next.along, exit: next.exit, enterTime, exitTime, prev: next.prev, next: next.next,
  }, { vehicle, now: new Date(now) });
  const head = distance > 0 ? `${next.name} dans ${distText(distance)}` : `Entrée ${inCountry(next.code)}`;
  const text = [head, ...card.labels].join(' · ') + (next.data ? '' : ` · règles ${COUNTRY_RULES.CHECK}`);
  const key = `${next.code}:${Math.round(next.along)}`;
  const out = { ...announced };
  let speak = null;
  if (!out[key] && distance <= COUNTRY_RULES.ANNOUNCE_M && distance >= COUNTRY_RULES.ANNOUNCE_MIN_M) {
    out[key] = true;
    speak = borderAnnounceText(next, distance, card);
  }
  return { view: { code: next.code, name: next.name, distance, text }, speak, announced: out };
}

/** « Dans 3 kilomètres, entrée en Suisse. Poids lourds : 80 kilomètres heure. … La signalisation fait foi. » */
export function borderAnnounceText(border, distance, card) {
  const km = Math.max(1, Math.round(distance / 1000));
  const head = `Dans ${km} kilomètre${km > 1 ? 's' : ''}, entrée ${inCountry(border.code)}.`;
  const rules = card.voice.map((v) => `${v[0].toUpperCase()}${v.slice(1)}.`);
  return [head, ...rules, COUNTRY_RULES.FOOTER].join(' ');
}
