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

// ───────── Jours fériés des pays voisins (phase 5c) ─────────
//
// Listes nationales seulement ; les fêtes régionales (Länder, cantons, communautés autonomes, provinces) restent
// « à vérifier » (REGIONAL_HOLIDAYS). Sources (lues le 20/11/2026) :
// - BE, LU, IT, ES : Bison Futé, « Restrictions pays limitrophes », listes « Les jours fériés 2026 en … »
//   (www.bison-fute.gouv.fr/IMG/pdf/Jours-feries_Europe-BE_2026.pdf, -LU_2026-2.pdf, -IT_2026.pdf, _ES_2026.pdf).
//   IT : Pâques est un dimanche (absent de la liste Bison Futé) ; ES : les fêtes nationales tombant un dimanche
//   peuvent être reportées par chaque communauté autonome (à vérifier).
// - DE : StVO § 30 (4) (www.gesetze-im-internet.de/stvo_2013/__30.html) : jours fériés de l'interdiction du dimanche,
//   valables dans toute l'Allemagne (Fête-Dieu, Réformation et Toussaint seulement dans certains Länder : régionaux).
// - CH : OCR art. 91 al. 1 (RS 741.11, fedlex) : Nouvel An, Vendredi saint, lundi de Pâques, Ascension, lundi de
//   Pentecôte, 1er août, Noël et le 26 décembre lorsque Noël ne tombe pas un lundi ou un vendredi ; un canton où l'un
//   de ces jours n'est pas férié n'applique pas l'interdiction ce jour-là (régional, à vérifier).
// - LU_DE / LU_FR : police grand-ducale, « Routiers / poids lourds » (police.public.lu, mise à jour 31/07/2025) :
//   jours fériés de l'interdiction de transit selon la direction (vers l'Allemagne / vers la France).

const fixed = (year, mmdd) => `${year}-${mmdd}`;

const HOLIDAY_LISTS = {
  FR: (y, e) => [...frenchHolidays(y)],
  BE: (y, e) => [[fixed(y, '01-01'), 'Nouvel An'], [e(1), 'Lundi de Pâques'], [fixed(y, '05-01'), 'Fête du travail'],
    [e(39), 'Ascension'], [e(50), 'Lundi de Pentecôte'], [fixed(y, '07-21'), 'Fête nationale'],
    [fixed(y, '08-15'), 'Assomption'], [fixed(y, '11-01'), 'Toussaint'], [fixed(y, '11-11'), 'Armistice'],
    [fixed(y, '12-25'), 'Noël']],
  LU: (y, e) => [[fixed(y, '01-01'), 'Nouvel An'], [e(1), 'Lundi de Pâques'], [fixed(y, '05-01'), 'Fête du travail'],
    [fixed(y, '05-09'), 'Journée de l\'Europe'], [e(39), 'Ascension'], [e(50), 'Lundi de Pentecôte'],
    [fixed(y, '06-23'), 'Fête nationale'], [fixed(y, '08-15'), 'Assomption'], [fixed(y, '11-01'), 'Toussaint'],
    [fixed(y, '12-25'), 'Noël'], [fixed(y, '12-26'), 'Saint-Étienne']],
  DE: (y, e) => [[fixed(y, '01-01'), 'Nouvel An'], [e(-2), 'Vendredi saint'], [e(1), 'Lundi de Pâques'],
    [fixed(y, '05-01'), 'Fête du travail'], [e(39), 'Ascension'], [e(50), 'Lundi de Pentecôte'],
    [fixed(y, '10-03'), 'Fête de l\'unité allemande'], [fixed(y, '12-25'), 'Noël'], [fixed(y, '12-26'), '2e jour de Noël']],
  CH: (y, e) => {
    const list = [[fixed(y, '01-01'), 'Nouvel An'], [e(-2), 'Vendredi saint'], [e(1), 'Lundi de Pâques'],
      [e(39), 'Ascension'], [e(50), 'Lundi de Pentecôte'], [fixed(y, '08-01'), 'Fête nationale'], [fixed(y, '12-25'), 'Noël']];
    const xmas = new Date(y, 11, 25).getDay();
    if (xmas !== 1 && xmas !== 5) list.push([fixed(y, '12-26'), 'Saint-Étienne']);
    return list;
  },
  IT: (y, e) => [[fixed(y, '01-01'), 'Capodanno'], [fixed(y, '01-06'), 'Épiphanie'], [e(1), 'Lundi de Pâques'],
    [fixed(y, '04-25'), 'Libération'], [fixed(y, '05-01'), 'Fête du travail'], [fixed(y, '06-02'), 'Fête de la République'],
    [fixed(y, '08-15'), 'Ferragosto'], [fixed(y, '11-01'), 'Toussaint'], [fixed(y, '12-08'), 'Immaculée Conception'],
    [fixed(y, '12-25'), 'Noël'], [fixed(y, '12-26'), 'Saint-Étienne']],
  ES: (y, e) => [[fixed(y, '01-01'), 'Nouvel An'], [fixed(y, '01-06'), 'Épiphanie'], [e(-2), 'Vendredi saint'],
    [fixed(y, '05-01'), 'Fête du travail'], [fixed(y, '08-15'), 'Assomption'], [fixed(y, '10-12'), 'Fête nationale'],
    [fixed(y, '11-01'), 'Toussaint'], [fixed(y, '12-06'), 'Constitution'], [fixed(y, '12-08'), 'Immaculée Conception'],
    [fixed(y, '12-25'), 'Noël']],
  // Interdiction de transit au Luxembourg vers l'Allemagne : jours fériés allemands de la liste de la police.
  LU_DE: (y, e) => [[fixed(y, '01-01'), 'Nouvel An'], [e(-2), 'Vendredi saint'], [e(1), 'Lundi de Pâques'],
    [fixed(y, '05-01'), 'Fête du travail'], [e(39), 'Ascension'], [e(50), 'Lundi de Pentecôte'], [e(60), 'Fête-Dieu'],
    [fixed(y, '10-03'), 'Fête de l\'unité allemande'], [fixed(y, '11-01'), 'Toussaint'], [fixed(y, '12-25'), 'Noël'],
    [fixed(y, '12-26'), '2e jour de Noël']],
  // Vers la France : les 11 jours fériés français (même liste que la police grand-ducale).
  LU_FR: (y, e) => [...frenchHolidays(y)],
};

/** Fêtes régionales non comptées : affichées « à vérifier » sur la fiche du pays. */
export const REGIONAL_HOLIDAYS = Object.freeze({
  BE: 'Fêtes des communautés (27 septembre, 11 juillet, 15 novembre) non comptées : à vérifier.',
  LU: '',
  DE: 'Fêtes de certains Länder non comptées (Fête-Dieu, Réformation, Toussaint, Épiphanie…) : à vérifier.',
  CH: 'Fêtes cantonales non comptées ; un canton où l\'un des jours n\'est pas férié n\'applique pas l\'interdiction : à vérifier.',
  IT: 'Fêtes patronales locales non comptées ; 4 octobre (saint François) : à vérifier.',
  ES: 'Fêtes des communautés autonomes et reports du dimanche non comptés : à vérifier.',
});

const countryCache = new Map();

/**
 * Jours fériés nationaux d'un pays (codes ci-dessus) : Map « AAAA-MM-JJ » → nom ; pays inconnu → Map vide.
 * @param {string} code 'FR', 'BE', 'LU', 'DE', 'CH', 'IT', 'ES', 'LU_DE', 'LU_FR'
 */
export function countryHolidays(code, year) {
  const make = HOLIDAY_LISTS[code];
  if (!make) return new Map();
  const key = `${code}:${year}`;
  if (countryCache.has(key)) return countryCache.get(key);
  const [em, ed] = easterSunday(year);
  const e = (days) => dayKey(new Date(year, em - 1, ed + days));
  const map = new Map(make(year, e));
  countryCache.set(key, map);
  return map;
}

/** Nom du jour férié national de cette date dans ce pays (heure locale), ou null. */
export function countryHolidayName(code, date) {
  return countryHolidays(code, date.getFullYear()).get(dayKey(date)) ?? null;
}
