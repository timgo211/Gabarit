// Interdictions de circulation des poids lourds les week-ends et jours fériés (phase 5). Logique pure.
//
// Sources officielles (lues sur www.bison-fute.gouv.fr, rubrique Transporteurs › Interdictions de circulation ›
// Régime général, qui renvoie aux textes publiés au Journal officiel) :
// - Arrêté du 16 avril 2021 relatif à l'interdiction de circulation des véhicules de transport de marchandises à
//   certaines périodes (NOR TRAT2031119A, JORF du 24 avril 2021, texte 37 ; il abroge l'arrêté du 2 mars 2015) :
//   « Art. 1er. […] la circulation des véhicules ou ensembles de véhicules de plus de 7,5 tonnes de poids total
//   autorisé en charge affectés aux transports routiers de marchandises, à l'exclusion des véhicules spécialisés et
//   des véhicules et matériels agricoles tels que définis à l'annexe II du présent arrêté, est interdite sur
//   l'ensemble du réseau routier les samedis et veilles de jours fériés à partir de 22 heures et jusqu'à 22 heures les
//   dimanches et jours fériés. Cette interdiction ne s'applique pas aux véhicules effectuant des transports
//   mentionnés à l'article 4 […] »
//   « Art. 2. Les horaires d'interdiction de circulation fixés à l'article 1er sont, pour les samedis non fériés dont
//   les dates sont arrêtées conformément au présent article, remplacés par les horaires suivants : – en période
//   estivale, sur l'ensemble du réseau routier métropolitain, durant sept samedis au plus, de 7 heures à 19 heures.
//   La circulation est autorisée de 0 heure à 7 heures et de 19 heures à 24 heures les samedis concernés ; – en
//   période hivernale, sur le réseau routier « Auvergne-Rhône-Alpes », durant cinq samedis au plus, de 7 heures à
//   18 heures, ainsi que de 22 heures jusqu'à 24 heures. »
//   « Art. 3. […] Ile-de-France […] sections autoroutières suivantes : A6A et A6B, du boulevard périphérique de Paris
//   à leur raccordement avec les autoroutes A6 et A10 (Wissous) ; A106 jusqu'à l'aéroport d'Orly ; A6 jusqu'à la
//   RN 104-Est (Lisses) ; A10 jusqu'à la RN 20 (Champlan) ; A13 du boulevard périphérique jusqu'à l'échangeur de
//   Poissy-Orgeval ; A12 du triangle de Rocquencourt jusqu'à la RN 10 (Montigny-le-Bretonneux) […] est interdite :
//   a) Dans le sens Paris-province : les vendredis, de 16 heures à 21 heures ; les veilles de jours fériés, de
//   16 heures à 22 heures ; les samedis, de 10 heures à 18 heures ; les dimanches ou jours fériés, de 22 heures à
//   24 heures. b) Dans le sens province-Paris : les dimanches ou jours fériés, de 22 heures à 24 heures ; les lundis
//   ou lendemains de jours fériés, de 6 heures à 10 heures. Les dispositions de l'article 4 ne s'appliquent pas au
//   présent article. »
//   Art. 4 (véhicules non concernés par les art. 1er et 2) : animaux vivants, denrées périssables de l'annexe I
//   (au moins la moitié du chargement), récoltes, manifestations, presse, déménagements, vente ambulante, fret
//   aérien, établissements de santé, dépannage des réseaux, citernes de stations d'autoroute, déchets…
//   Annexe II : véhicules spécialisés = genre VASP, SRSP ou RESP sur le certificat d'immatriculation ; véhicules et
//   matériels agricoles = TRA, REA, SREA, MAGA, MIAR.
// - Arrêté du 26 décembre 2025 relatif aux interdictions complémentaires de circulation des véhicules de transport
//   de marchandises pour l'année 2026 (NOR TRAT2529272A, JORF du 8 janvier 2026, texte 28) : « I. – En période
//   hivernale, de 7 heures à 18 heures, sur les routes du réseau routier « Auvergne-Rhône-Alpes » mentionnées en
//   annexe, les samedis 7 février, 14 février, 21 février, 28 février et 7 mars 2026 ; II. – En période estivale,
//   de 7 heures à 19 heures, les samedis 11 juillet, 18 juillet, 25 juillet, 1er août et 8 août 2026, sur
//   l'ensemble du réseau routier de France métropolitaine. »
// Vérifié avec le tableau « Calendrier 2026 » de la brochure Bison Futé « Véhicules lourds » (26056_BROCHURE_2026_FR.pdf).
// Les dérogations préfectorales (art. 5 à 7 : crise, départements frontaliers…) ne sont pas connues de l'appli.

import { isHoliday, addDays, dayKey } from './holidays.js';
import { haversine } from './nav-geo.js';
import { isInFrance, isInMetropole } from './map-layers.js';
import { sampleRoute } from './route-samples.js';
import { BAN_STATUS_VALUES } from './vehicle.js';

export const HGV_BANS = Object.freeze({
  /** Art. 1er : « plus de 7,5 tonnes de poids total autorisé en charge ». */
  MIN_WEIGHT_T: 7.5,
  /** Annonces vocales en guidage : 60 min puis 15 min avant le début de l'interdiction. */
  ANNOUNCE_MIN: Object.freeze([60, 15]),
  /** Écart entre deux points du tracé examinés (m). */
  SAMPLE_M: 500,
  /** Fenêtres d'interdiction préparées au début du guidage (h). */
  HORIZON_H: 72,
  SOURCE: 'Arrêté du 16 avril 2021 (interdictions PL) et arrêté du 26 décembre 2025 (calendrier 2026)',
});

/** Art. 2 + arrêté annuel : samedis d'été, sur tout le réseau métropolitain, 7 h – 19 h. */
export const SUMMER_SATURDAYS = Object.freeze({
  2026: Object.freeze(['2026-07-11', '2026-07-18', '2026-07-25', '2026-08-01', '2026-08-08']),
});

/** Art. 2 + arrêté annuel : samedis d'hiver, réseau « Auvergne-Rhône-Alpes », 7 h – 18 h et 22 h – 24 h. */
export const WINTER_AURA_SATURDAYS = Object.freeze({
  2026: Object.freeze(['2026-02-07', '2026-02-14', '2026-02-21', '2026-02-28', '2026-03-07']),
});

/**
 * Routes du réseau « Auvergne-Rhône-Alpes » de l'annexe de l'arrêté du 26 décembre 2025 (références seulement : les
 * sections exactes et les sens sont dans l'annexe ; l'appli prévient « à vérifier »).
 */
export const AURA_ROADS = Object.freeze([
  'A40', 'D1084', 'D1206', 'D1205', 'N205', 'A43', 'A430', 'D1090', 'N90', 'D306', 'D1006', 'N201', 'A48', 'A480',
  'N85', 'D1091', 'A41', 'D1201', 'D1508', 'D3508', 'D1212', 'A410', 'D1203',
]);
/** Cadre de la région Auvergne-Rhône-Alpes [ouest, sud, est, nord] (approximatif). */
export const AURA_BBOX = Object.freeze([2.06, 44.11, 7.19, 46.81]);

/**
 * Art. 3 : sections autoroutières d'Île-de-France, chacune bornée par sa distance au centre de Paris (parvis de
 * Notre-Dame) jusqu'à la limite citée par l'arrêté (Wissous, Orly, Lisses, Champlan, Orgeval, Montigny), + 2 km.
 */
export const PARIS_CENTER = Object.freeze([2.3488, 48.8534]);
export const IDF_ROADS = Object.freeze({ A6A: 15000, A6B: 15000, A106: 16000, A6: 32000, A10: 21000, A13: 30000, A12: 27000 });

/** Situation du véhicule (profil) : concerné, transport de l'art. 4 (seul l'art. 3 s'applique), non concerné. */
export const BAN_STATUS = Object.freeze({
  concerned: 'Concerné',
  art4: 'Transport de l\'article 4 (denrées périssables, animaux vivants…)',
  exempt: 'Véhicule spécialisé (VASP, SRSP, RESP) ou agricole',
});

/** Quelles interdictions s'appliquent au véhicule ? { general (art. 1er et 2), idf (art. 3) } */
export function vehicleBanScope(vehicle) {
  const heavy = typeof vehicle?.weight === 'number' && vehicle.weight > HGV_BANS.MIN_WEIGHT_T;
  const status = BAN_STATUS_VALUES.includes(vehicle?.banStatus) ? vehicle.banStatus : 'concerned';
  return { general: heavy && status === 'concerned', idf: heavy && status !== 'exempt' };
}

const H = 60;
const isSaturday = (d) => d.getDay() === 6;
const isSunday = (d) => d.getDay() === 0;
const listed = (table, d) => (table[d.getFullYear()] ?? []).includes(dayKey(d));

/** Le calendrier des interdictions complémentaires de cette année est-il connu ? */
export function calendarKnown(year) {
  return Object.hasOwn(SUMMER_SATURDAYS, year) && Object.hasOwn(WINTER_AURA_SATURDAYS, year);
}

/**
 * Plages interdites d'une journée (minutes depuis minuit, heure locale) pour un réseau :
 * 'france' (art. 1er, + samedis d'été en métropole), 'aura' (réseau Auvergne-Rhône-Alpes, samedis d'hiver),
 * 'idf-out' / 'idf-in' (art. 3, sens Paris-province / province-Paris, en plus de l'art. 1er).
 * @returns {{ from:number, to:number, kind:'general'|'summer'|'winter'|'idf' }[]}
 */
export function dayBans(date, network = 'france', { metropole = true, idfOnly = false } = {}) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const holiday = isHoliday(day);
  const eve = isHoliday(addDays(day, 1));
  const after = isHoliday(addDays(day, -1));
  const out = [];
  const summer = metropole && isSaturday(day) && !holiday && listed(SUMMER_SATURDAYS, day);
  const winter = network === 'aura' && isSaturday(day) && !holiday && listed(WINTER_AURA_SATURDAYS, day);
  if (isSunday(day) || holiday) out.push({ from: 0, to: 22 * H, kind: 'general' });
  if (summer) out.push({ from: 7 * H, to: 19 * H, kind: 'summer' });
  else if (winter) out.push({ from: 7 * H, to: 18 * H, kind: 'winter' }, { from: 22 * H, to: 24 * H, kind: 'winter' });
  else if (isSaturday(day) || eve) out.push({ from: 22 * H, to: 24 * H, kind: 'general' });
  if (network === 'idf-out') {
    if (day.getDay() === 5) out.push({ from: 16 * H, to: 21 * H, kind: 'idf' });
    if (eve) out.push({ from: 16 * H, to: 22 * H, kind: 'idf' });
    if (isSaturday(day)) out.push({ from: 10 * H, to: 18 * H, kind: 'idf' });
    if (isSunday(day) || holiday) out.push({ from: 22 * H, to: 24 * H, kind: 'idf' });
  } else if (network === 'idf-in') {
    if (isSunday(day) || holiday) out.push({ from: 22 * H, to: 24 * H, kind: 'idf' });
    if (day.getDay() === 1 || after) out.push({ from: 6 * H, to: 10 * H, kind: 'idf' });
  }
  // Véhicule de l'art. 4 : seules les plages de l'art. 3 (« Les dispositions de l'article 4 ne s'appliquent pas au
  // présent article »).
  return idfOnly ? out.filter((b) => b.kind === 'idf') : out;
}

const KIND_ORDER = ['idf', 'winter', 'summer', 'general'];

/**
 * Fenêtres d'interdiction (dates absolues), plages contiguës réunies (samedi 22 h → dimanche 22 h = une fenêtre).
 * @returns {{ start:Date, end:Date, kind:string }[]}
 */
export function banWindows(from, to, network = 'france', opts = {}) {
  const raw = [];
  for (let d = addDays(from, -1); d <= addDays(to, 1); d = addDays(d, 1)) {
    for (const b of dayBans(d, network, opts)) {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, b.from).getTime();
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, b.to).getTime();
      if (end > start) raw.push({ start, end, kind: b.kind });
    }
  }
  raw.sort((a, b) => a.start - b.start);
  const out = [];
  for (const w of raw) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
      if (KIND_ORDER.indexOf(w.kind) < KIND_ORDER.indexOf(last.kind)) last.kind = w.kind;
    } else out.push({ ...w });
  }
  return out
    .filter((w) => w.end > from.getTime() && w.start < to.getTime() + 24 * 3600e3)
    .map((w) => ({ start: new Date(w.start), end: new Date(w.end), kind: w.kind }));
}

/** Fenêtre qui contient l'instant t (ms), ou null. */
function windowAt(t, network, opts) {
  const d = new Date(t);
  return banWindows(addDays(d, -2), addDays(d, 2), network, opts).find((w) => w.start.getTime() <= t && t < w.end.getTime()) ?? null;
}

/** Réseau d'un point du tracé : Île-de-France (art. 3, avec le sens), Auvergne-Rhône-Alpes, sinon France. */
function networkOf(sample, prev, next) {
  const [lon, lat] = sample.lonlat;
  for (const r of sample.roads) {
    const max = IDF_ROADS[r];
    if (!max) continue;
    const d = haversine(sample.lonlat, PARIS_CENTER);
    if (d > max) continue;
    // Sens : on s'éloigne de Paris (Paris-province) ou on s'en rapproche, d'après le point suivant (sinon le précédent).
    if (next) return haversine(next.lonlat, PARIS_CENTER) >= d ? 'idf-out' : 'idf-in';
    const d0 = prev ? haversine(prev.lonlat, PARIS_CENTER) : d;
    return d >= d0 ? 'idf-out' : 'idf-in';
  }
  const [w, s, e, n] = AURA_BBOX;
  if (lon >= w && lon <= e && lat >= s && lat <= n && sample.roads.some((r) => AURA_ROADS.includes(r))) return 'aura';
  return 'france';
}

/**
 * Interdictions rencontrées sur un itinéraire, d'après l'heure de passage estimée (durées ORS, sans pause).
 * @param {object} route itinéraire (parseDirections)
 * @param {{ vehicle:object, departure:Date, elapsed?:(t:number)=>number }} ctx elapsed : pauses conseillées comprises
 * @returns {{ applies:boolean, calendarKnown:boolean, conflicts:{ kind:string, along:number, time:Date,
 *   start:Date, end:Date, roads:string[], approximate:boolean }[] }}
 *   un conflit par fenêtre (le premier point du trajet qui y tombe) ; approximate : réseau AURA ou Île-de-France
 *   reconnu d'après le nom de la route (sections exactes : voir les arrêtés)
 */
export function bansAlongRoute(route, { vehicle, departure = new Date(), elapsed = (t) => t } = {}) {
  const scope = vehicleBanScope(vehicle);
  const years = [departure.getFullYear(), new Date(departure.getTime() + elapsed(route?.duration ?? 0) * 1000).getFullYear()];
  const known = years.every(calendarKnown);
  if (!scope.general && !scope.idf) return { applies: false, calendarKnown: known, conflicts: [] };
  const samples = sampleRoute(route, HGV_BANS.SAMPLE_M);
  const conflicts = [];
  const seen = new Set();
  let prev = null;
  for (const [i, sm] of samples.entries()) {
    if (!isInFrance(sm.lonlat)) { prev = sm; continue; }
    const opts = { metropole: isInMetropole(sm.lonlat) };
    const t = departure.getTime() + elapsed(sm.time) * 1000;
    const net = networkOf(sm, prev, samples[i + 1]);
    prev = sm;
    const nets = [];
    if (scope.general) nets.push(net === 'aura' ? 'aura' : 'france');
    if (scope.idf && net.startsWith('idf')) nets.push(net);
    for (const n of nets) {
      const w = windowAt(t, n, { ...opts, idfOnly: !scope.general });
      if (!w) continue;
      const key = `${n}:${w.start.getTime()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Une seule entrée par fenêtre générale, même vue depuis l'Île-de-France ou l'AURA.
      if (conflicts.some((c) => c.start.getTime() === w.start.getTime() && c.end.getTime() === w.end.getTime())) continue;
      conflicts.push({
        kind: n.startsWith('idf') ? 'idf' : w.kind, network: n, along: sm.along, time: new Date(t), start: w.start, end: w.end,
        roads: sm.roads, approximate: n !== 'france',
      });
    }
  }
  conflicts.sort((a, b) => a.along - b.along);
  return { applies: true, calendarKnown: known, conflicts };
}

// ───────── Textes ─────────

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** « samedi 22 h », « dimanche 7 h 30 ». */
export function dayTime(d) {
  const m = d.getMinutes();
  return `${DAYS[d.getDay()]} ${d.getHours()} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
}

const KIND_TEXT = {
  general: 'Interdiction PL',
  summer: 'Interdiction PL (samedi d\'été)',
  winter: 'Interdiction PL (samedi d\'hiver, réseau Auvergne-Rhône-Alpes)',
  idf: 'Interdiction PL Île-de-France (A6, A10, A12, A13, A106)',
};

/**
 * Ligne de la fiche d'itinéraire.
 * « Interdiction PL samedi 22 h → dimanche 22 h : vous y seriez vers km 412 (samedi 23 h 10). »
 */
export function describeBanConflict(c) {
  const where = `km ${Math.round(c.along / 1000)}`;
  const check = c.approximate ? ' Section et sens à vérifier dans l\'arrêté.' : '';
  return `${KIND_TEXT[c.kind] ?? KIND_TEXT.general} ${dayTime(c.start)} → ${dayTime(c.end)} : vous y seriez vers ${where} (${dayTime(c.time)}).${check}`;
}

/**
 * Libellé court de la fiche d'itinéraire (phase 2e), même formulation que le bandeau du guidage :
 * « Interdiction PL en cours jusqu'à dimanche 22 h » si le départ du trajet calculé (heure choisie, sinon maintenant)
 * tombe pendant l'interdiction, sinon « Interdiction PL à partir de samedi 22 h ».
 * @param {{ start:Date, end:Date }} c conflit de bansAlongRoute
 * @param {Date} departure départ du trajet calculé
 */
export function banShortText(c, departure) {
  const t = departure instanceof Date ? departure.getTime() : Date.now();
  if (t >= c.start.getTime() && t < c.end.getTime()) return `Interdiction PL en cours jusqu'à ${dayTime(c.end)}`;
  return `Interdiction PL à partir de ${dayTime(c.start)}`;
}

/** Fiche : rappel si le calendrier de l'année n'est pas dans l'appli. */
export const CALENDAR_UNKNOWN_TEXT = 'Calendrier des interdictions complémentaires (samedis d\'été et d\'hiver) inconnu pour cette année : vérifie sur bison-fute.gouv.fr.';

/** Annonce vocale avant le début d'une interdiction. */
export function banAnnounceText(window, minutes) {
  const h = window.start.getHours();
  const m = window.start.getMinutes();
  const at = `${h} heure${h > 1 ? 's' : ''}${m ? ` ${m}` : ''}`;
  const lead = minutes >= 60 ? 'dans une heure' : `dans ${minutes} minutes`;
  return `Interdiction poids lourds à partir de ${at}, ${lead}. Pensez à vous garer.`;
}

/** Bandeau du guidage : « Interdiction PL dans 45 min (22 h) » ou « Interdiction PL jusqu'à dimanche 22 h ». */
export function banBannerText(view) {
  if (!view) return '';
  if (view.active) return `Interdiction PL en cours jusqu'à ${dayTime(view.end)}`;
  return `Interdiction PL dans ${view.minutes} min (${dayTime(view.start)})`;
}

/**
 * Guidage (réseau général seulement : France, samedis d'été en métropole).
 * @param {{ windows:{start:Date,end:Date}[], announced:Record<string,true> }} bans état préparé par prepareGuidanceBans
 * @param {{ now:number, arrival:number, lonlat:number[] }} p arrival : heure d'arrivée estimée (ms)
 * @returns {{ view:object|null, speak:string|null, announced:Record<string,true> }}
 */
export function guidanceBan(bans, { now, arrival, lonlat }) {
  if (!bans?.windows?.length || !isInFrance(lonlat)) return { view: null, speak: null, announced: bans?.announced ?? {} };
  const announced = { ...bans.announced };
  const w = bans.windows.find((x) => x.end.getTime() > now);
  if (!w) return { view: null, speak: null, announced };
  const start = w.start.getTime();
  if (now >= start) {
    const key = `${start}:now`;
    const speak = announced[key] ? null : `Interdiction poids lourds en cours jusqu'à ${dayTime(w.end).replace(' h', ' heures')}.`;
    announced[key] = true;
    return { view: { active: true, start: w.start, end: w.end }, speak, announced };
  }
  if (arrival <= start) return { view: null, speak: null, announced };
  const minutes = Math.ceil((start - now) / 60000);
  if (minutes > HGV_BANS.ANNOUNCE_MIN[0]) return { view: null, speak: null, announced };
  let speak = null;
  for (const lead of HGV_BANS.ANNOUNCE_MIN) {
    const key = `${start}:${lead}`;
    if (minutes <= lead && !announced[key]) {
      // Seule la plus proche annonce manquée est dite (guidage démarré à 10 min : pas l'annonce « une heure »).
      for (const l of HGV_BANS.ANNOUNCE_MIN) if (l >= lead) announced[`${start}:${l}`] = true;
      speak = banAnnounceText(w, lead);
    }
  }
  return { view: { active: false, start: w.start, end: w.end, minutes }, speak, announced };
}

/** Fenêtres préparées au début du guidage (aucune si le véhicule n'est pas concerné). */
export function prepareGuidanceBans(vehicle, now) {
  if (!vehicleBanScope(vehicle).general) return { windows: [], announced: {} };
  const from = new Date(now);
  return { windows: banWindows(from, new Date(now + HGV_BANS.HORIZON_H * 3600e3), 'france'), announced: {} };
}
