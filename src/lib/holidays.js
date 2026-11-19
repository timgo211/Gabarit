// Jours fériés français (phase 5) : interdictions PL des jours fériés et horaires « PH off » des ZFE. Logique pure.
//
// Source : Code du travail, art. L3133-1 (« Les fêtes légales ci-après désignées sont des jours fériés : le 1er
// janvier ; le lundi de Pâques ; le 1er mai ; le 8 mai ; l'Ascension ; le lundi de Pentecôte ; le 14 juillet ;
// l'Assomption ; la Toussaint ; le 11 novembre ; le jour de Noël »). Légifrance n'étant pas lisible depuis le
// conteneur de développement, la liste a été vérifiée sur le calendrier officiel « Véhicules lourds — Calendrier des
// interdictions complémentaires de circuler 2026 » (Bison Futé, www.bison-fute.gouv.fr/IMG/pdf/26056_BROCHURE_2026_FR.pdf),
// qui donne les mêmes 11 jours pour 2026 (Pâques le 5 avril, Ascension le 14 mai, Pentecôte le 24 mai).
// Les jours fériés locaux d'Alsace-Moselle (Vendredi saint, 26 décembre) ne figurent pas dans ce calendrier national
// des interdictions PL : ils ne sont pas comptés.
//
// Heures et dates : heure locale de l'appareil (une tablette utilisée en France est à l'heure de Paris).

const pad = (n) => String(n).padStart(2, '0');

/** Clé « AAAA-MM-JJ » d'une date, en heure locale. */
export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Dimanche de Pâques (calendrier grégorien, algorithme de Meeus / Jones / Butcher) : [mois 1-12, jour]. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const cache = new Map();

/** Jours fériés d'une année : Map « AAAA-MM-JJ » → nom. */
export function frenchHolidays(year) {
  if (cache.has(year)) return cache.get(year);
  const [em, ed] = easterSunday(year);
  const fromEaster = (days) => dayKey(new Date(year, em - 1, ed + days));
  const list = [
    [`${year}-01-01`, 'Jour de l\'an'],
    [fromEaster(1), 'Lundi de Pâques'],
    [`${year}-05-01`, 'Fête du travail'],
    [`${year}-05-08`, 'Victoire 1945'],
    [fromEaster(39), 'Ascension'],
    [fromEaster(50), 'Lundi de Pentecôte'],
    [`${year}-07-14`, 'Fête nationale'],
    [`${year}-08-15`, 'Assomption'],
    [`${year}-11-01`, 'Toussaint'],
    [`${year}-11-11`, 'Armistice 1918'],
    [`${year}-12-25`, 'Noël'],
  ];
  const map = new Map(list);
  cache.set(year, map);
  return map;
}

/** Nom du jour férié de cette date (heure locale), ou null. */
export function holidayName(date) {
  return frenchHolidays(date.getFullYear()).get(dayKey(date)) ?? null;
}

export const isHoliday = (date) => holidayName(date) !== null;

/** Même date, décalée de `days` jours (heure locale, minuit). */
export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
