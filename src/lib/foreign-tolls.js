// Péages PL au kilomètre à l'étranger (phase 5h) : taux de la classe du profil et estimation sur les km à péage du
// trajet. Information seulement (ligne grise de la fiche, notes) : jamais de voix, de bandeau ni d'alerte ; montants
// toujours « à vérifier », jamais présentés comme une facture. Logique pure.
//
// Autriche — GO-Maut (ASFINAG), sources lues le 23/11/2026 par l'Action « Textes officiels » (PDF texte, sans OCR) :
// - « GO-Maut-Tarife 2026 », go-maut.at/media/c55axkil/go-maut-tarife-2026_de.pdf : « Fahrleistungsabhängige Maut für
//   Kraftfahrzeuge über 3,5 t technisch zulässiger Gesamtmasse (tzGm) inklusive der Zuschläge für Luftverschmutzung
//   und Lärmbelastung sowie für CO₂-Emissionen gültig ab 1.1.2026 », « Tarife in Euro pro Kilometer, exkl. 20 %
//   Umsatzsteuer » ; colonnes « 2 Achsen Kategorie 2 | 3 Achsen Kategorie 3 | 4 und mehr Achsen Kategorie 4+ »,
//   ligne du haut « Lkw und Wohnmobil ».
// - Seconde lecture indépendante, même jour : page HTML go-maut.at/en/paying-the-go-toll/go-toll-rates/ (« GO toll
//   rates 2026 », mêmes totaux) ; contrôle de cohérence : chaque total = infrastructure + supplément air et bruit +
//   supplément CO₂ (composantes du même PDF, test tests/foreign-tolls.test.js).
// - Même page : « Separate rates apply on section toll segments and A 12 » (A 9 tunnels Gleinalm et Bosruck, A 10
//   Tauern et Katschberg, A 11 Karawanken, A 13 Brenner, S 16 Arlberg ; A 12 Unterinntal +25 %) : non calculés.
// - Base légale citée par la page : Mauttarifverordnung 2025 (BGBl. II Nr. 298/2025) ; texte du RIS illisible
//   (503 pour le conteneur et l'Action).
// Classe CO₂ : absente du profil ; pour un Euro VI, de la classe 4 (la moins chère) à la classe 1 (la plus chère) ;
// les classes Euro V et antérieures n'existent qu'en classe CO₂ 1 dans la grille. Zéro émission : hors profil.
//
// Allemagne — Lkw-Maut : seule la grille Toll Collect « Mautsätze pro Kilometer ab 1. Juli 2024 » a été lue (PDF
// texte) ; le BFStrMG (annexe 1, gesetze-im-internet.de) et la grille du ministère (bmv.de) n'ont pas répondu, et la
// validité de la grille en 2026 n'a pas été lue : aucun montant (à vérifier).

import { prepareLine } from './nav-geo.js';

export const FOREIGN_TOLLS = Object.freeze({
  MIN_PTAC_T: 3.5,
  FOOTER: 'La signalisation fait foi.',
  AT: Object.freeze({
    name: 'GO-Maut (Autriche)',
    source: 'tarifs GO-Maut 2026 d\'ASFINAG (valables dès le 1/01/2026, HT), lus le 23/11/2026',
    url: 'https://www.go-maut.at/media/c55axkil/go-maut-tarife-2026_de.pdf',
    // € par km hors TVA : [catégorie 2, catégorie 3, catégorie 4+] (Lkw und Wohnmobil).
    total: Object.freeze({
      'VI-co2-4': Object.freeze([0.2486, 0.3440, 0.5091]),
      'VI-co2-3': Object.freeze([0.2724, 0.3788, 0.5625]),
      'VI-co2-2': Object.freeze([0.2740, 0.3810, 0.5657]),
      'VI-co2-1': Object.freeze([0.2774, 0.3856, 0.5724]),
      'V-co2-1': Object.freeze([0.2924, 0.4086, 0.6024]),
      'IV-co2-1': Object.freeze([0.3114, 0.4296, 0.6324]),
      '0-III-co2-1': Object.freeze([0.3274, 0.4536, 0.6654]),
    }),
    // Composantes du même PDF (contrôle de cohérence) : infrastructure (classes CO₂ 1 à 4), air et bruit par classe
    // Euro, CO₂ par classe CO₂ (Lkw).
    parts: Object.freeze({
      infrastructure: Object.freeze([0.2186, 0.3060, 0.4591]),
      air: Object.freeze({
        VI: Object.freeze([0.0060, 0.0090, 0.0100]), V: Object.freeze([0.0210, 0.0320, 0.0400]),
        IV: Object.freeze([0.0400, 0.0530, 0.0700]), '0-III': Object.freeze([0.0560, 0.0770, 0.1030]),
      }),
      co2: Object.freeze({
        1: Object.freeze([0.0528, 0.0706, 0.1033]), 2: Object.freeze([0.0494, 0.0660, 0.0966]),
        3: Object.freeze([0.0478, 0.0638, 0.0934]), 4: Object.freeze([0.0240, 0.0290, 0.0400]),
      }),
    }),
    // Tronçons à tarif propre (même page) : références d'étape qui empêchent l'estimation.
    special: Object.freeze(['A 9', 'A 10', 'A 11', 'A 12', 'A 13', 'S 16']),
    specialText: 'tarifs propres non calculés : A 9 (Gleinalm, Bosruck), A 10 (Tauern, Katschberg), A 11 (Karawanken), A 13 (Brenner), S 16 (Arlberg) et A 12 (Unterinntal, +25 %)',
  }),
});

/** Un montant codé dépend du nombre d'essieux (champ « Essieux » du profil montré seulement dans ce cas). */
export const AXLE_AMOUNTS = !!FOREIGN_TOLLS.AT;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Catégories d'essieux du profil (index 0 = cat. 2, 1 = cat. 3, 2 = cat. 4+) ; non précisé → les trois. */
export function axleCategories(axles) {
  if (axles === '2') return [0];
  if (axles === '3') return [1];
  if (axles === '4' || axles === '5+') return [2];
  return [0, 1, 2];
}

/** Lignes de la grille autrichienne pour la classe Euro du profil ; non précisée → toutes. */
export function atRows(euroClass) {
  const all = Object.keys(FOREIGN_TOLLS.AT.total);
  if (euroClass === '6') return all.filter((k) => k.startsWith('VI-'));
  if (euroClass === '5' || euroClass === 'EEV') return ['V-co2-1'];
  if (euroClass === '4') return ['IV-co2-1'];
  if (['0', '1', '2', '3'].includes(euroClass)) return ['0-III-co2-1'];
  return all;
}

/** Fourchette de taux (€/km HT) pour le profil : { min, max }. */
export function atRate(vehicle) {
  const cats = axleCategories(vehicle?.axles ?? '');
  const rates = [];
  for (const r of atRows(vehicle?.euroClass ?? '')) for (const c of cats) rates.push(FOREIGN_TOLLS.AT.total[r][c]);
  return { min: Math.min(...rates), max: Math.max(...rates) };
}

/** Mètres du tracé entre deux indices de points (inclus). */
function lengthBetween(cum, from, to) {
  const a = Math.max(0, Math.min(from, cum.length - 1));
  const b = Math.max(0, Math.min(to, cum.length - 1));
  return Math.max(0, cum[b] - cum[a]);
}

/**
 * Km à péage du trajet dans un pays (extras tollways × countryinfo, indices de points). null si l'un des deux est
 * absent : aucune estimation.
 */
export function tolledMetersIn(route, code) {
  if (!Array.isArray(route?.countries) || !Array.isArray(route?.tollRanges) || !Array.isArray(route?.coordinates) || route.coordinates.length < 2) return null;
  const { cum } = prepareLine(route.coordinates);
  let m = 0;
  for (const c of route.countries) {
    if (c.code !== code) continue;
    for (const t of route.tollRanges) {
      const from = Math.max(c.from, t.from);
      const to = Math.min(c.to, t.to);
      if (to > from) m += lengthBetween(cum, from, to);
    }
  }
  return m;
}

/** Mètres du trajet dans un pays (countryinfo) ; 0 si le pays n'est pas traversé, null si inconnu. */
export function metersIn(route, code) {
  if (!Array.isArray(route?.countries) || !Array.isArray(route?.coordinates) || route.coordinates.length < 2) return null;
  const { cum } = prepareLine(route.coordinates);
  return route.countries.filter((c) => c.code === code).reduce((s, c) => s + lengthBetween(cum, c.from, c.to), 0);
}

/** Une étape du trajet en Autriche porte la référence d'un tronçon à tarif propre ? */
export function crossesSpecial(route, refs = FOREIGN_TOLLS.AT.special) {
  const at = (route?.countries ?? []).filter((c) => c.code === 'AT');
  const inAt = (wp) => Array.isArray(wp) && at.some((c) => wp[1] > c.from && wp[0] < c.to);
  const re = new RegExp(`(^|[^A-Z0-9])(${refs.map((r) => r.replace(' ', ' ?')).join('|')})(?![0-9])`);
  return (route?.steps ?? []).some((s) => inAt(s.wayPoints) && re.test(`${s.name ?? ''} ${s.instruction ?? ''}`));
}

const euro2 = (x) => x.toFixed(2).replace('.', ',');
const euro0 = (x) => String(Math.round(x));
const rateText = ({ min, max }) => (Math.abs(max - min) < 1e-9 ? `${euro2(min)} €/km` : `de ${euro2(min)} à ${euro2(max)} €/km`);

/** Profil décrit pour la ligne : essieux et classe (non précisés : « les deux cas »). */
function profileText(vehicle) {
  const ax = vehicle?.axles ?? '';
  const axText = ax === '' ? 'essieux non précisés (2, 3, 4 et plus)' : ax === '2' ? '2 essieux' : ax === '3' ? '3 essieux' : '4 essieux et plus';
  const e = vehicle?.euroClass ?? '';
  const eText = e === '' ? 'classe Euro non précisée'
    : e === '6' ? 'Euro VI, classe CO₂ non saisie (classes 4 à 1)'
      : e === 'EEV' ? 'EEV' : e === '5' ? 'Euro V' : e === '4' ? 'Euro IV' : 'Euro 0 à III';
  return `${axText}, ${eText}`;
}

/**
 * Lignes « péage au km » des pays traversés (Autriche seulement : seule grille lue). PTAC ≤ 3,5 t : rien.
 * @returns {{ lines:{ level:'info', text:string, url:string, linkText:string }[], at:object|null }}
 */
export function foreignTollRules(route, { vehicle } = {}) {
  const out = { lines: [], at: null };
  if (isNum(vehicle?.weight) && vehicle.weight <= FOREIGN_TOLLS.MIN_PTAC_T) return out;
  const inAt = metersIn(route, 'AT');
  if (!inAt) return out;
  const A = FOREIGN_TOLLS.AT;
  const rate = atRate(vehicle);
  const tolled = tolledMetersIn(route, 'AT');
  const special = crossesSpecial(route);
  let estimate = '';
  if (special) estimate = ' Tronçon à tarif propre sur le trajet : estimation non calculée.';
  else if (isNum(tolled) && tolled > 0) {
    const km = tolled / 1000;
    const lo = rate.min * km;
    const hi = rate.max * km;
    const amount = Math.round(lo) === Math.round(hi) ? `environ ${euro0(lo)} € HT` : `environ ${euro0(lo)} à ${euro0(hi)} € HT`;
    estimate = ` Estimation : ${amount} pour ${Math.round(km)} km à péage en Autriche (à vérifier, pas une facture).`;
  } else if (tolled === 0) estimate = ' Aucun km à péage signalé par OpenRouteService en Autriche : estimation non calculée.';
  else estimate = ' Km à péage inconnus : estimation non calculée.';
  out.at = { rate, tolledMeters: tolled, special };
  out.lines.push({
    level: 'info',
    text: `${A.name} : péage au km des plus de 3,5 t sur autoroutes et voies rapides, ${rateText(rate)} HT pour votre profil (${profileText(vehicle)}).${estimate} Source : ${A.source} ; ${A.specialText}. Montants à vérifier. ${FOREIGN_TOLLS.FOOTER}`,
    url: A.url,
    linkText: 'Tarifs',
  });
  return out;
}
