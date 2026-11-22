// Badges de référence de route du bandeau de guidage (phase 2c). Logique pure, sans DOM.
// Le nom d'une étape ORS mêle parfois nom de rue et référence (« D 83 », « A89 », « Route de Lyon, D 906 ») : on en
// sort les références pour les montrer dans un cartouche aux couleurs de la signalisation, le reste est le nom de rue.
//
// Couleurs des cartouches (signalisation de direction, France) : Instruction interministérielle sur la signalisation
// routière (IISR), 7e partie, art. 79 — routes départementales : cartouche jaune, chiffres noirs ; routes nationales
// et autoroutes : cartouche rouge, chiffres blancs ; routes européennes : cartouche vert, chiffres blancs.
// Arrêté du 24 novembre 1967 modifié (legifrance.gouv.fr). Autres références (M métropolitaines, C communales,
// étrangères) : gris neutre.

export const BADGE_COLORS = Object.freeze({
  D: Object.freeze({ bg: '#FFD200', fg: '#000000', border: '#FFE680' }),
  N: Object.freeze({ bg: '#C8102E', fg: '#FFFFFF', border: '#E8707F' }),
  A: Object.freeze({ bg: '#C8102E', fg: '#FFFFFF', border: '#E8707F' }),
  E: Object.freeze({ bg: '#007A3D', fg: '#FFFFFF', border: '#5FB58A' }),
  other: Object.freeze({ bg: '#5C5F69', fg: '#FFFFFF', border: '#A9A79E' }),
});

/**
 * Référence seule : lettre(s) puis chiffres, avec ou sans espace ou tiret (« D 83 », « A89 », « RN7 », « E 25 »), et
 * suffixe éventuel (phase 2e) : lettre collée ou séparée, suivie ou non d'un chiffre (« D 1083a », « D 120 E »,
 * « D 57e2 »), « bis » ou « ter » (« N 83 bis »).
 */
const REF = /^(RN|RD|[ADNEMCRT])\s*[-.]?\s*(\d{1,4})(?:\.(\d+))?(?:\s*(bis|ter|[A-Za-z]\d{0,2}))?$/i;

/** Espace insécable : une référence n'est jamais coupée en deux lignes (« D 120 E »). */
const NBSP = '\u00A0';

function badgeOf(token) {
  const m = REF.exec(token.trim());
  if (!m) return null;
  let letter = m[1].toUpperCase();
  if (letter === 'RN') letter = 'N';
  if (letter === 'RD') letter = 'D';
  const kind = Object.hasOwn(BADGE_COLORS, letter) ? letter : 'other';
  const num = m[3] ? `${m[2]}.${m[3]}` : m[2];
  const suffix = !m[4] ? '' : /^(bis|ter)$/i.test(m[4]) ? `${NBSP}${m[4].toLowerCase()}`
    : /^\d/.test(m[4]) || !/\s/.test(token.slice(token.search(/\d/))) ? m[4].toUpperCase() : `${NBSP}${m[4].toUpperCase()}`;
  const ref = `${letter}${NBSP}${num}${suffix}`;
  return { ref, kind, ...BADGE_COLORS[kind] };
}

/**
 * @param {string|null|undefined} name nom de l'étape ORS
 * @returns {{ badges:{ ref:string, kind:string, bg:string, fg:string, border:string }[], street:string }}
 */
export function roadLabel(name) {
  const s = typeof name === 'string' ? name.trim() : '';
  if (!s || s === '-') return { badges: [], street: '' };
  // Morceaux séparés par virgule, point-virgule, barre oblique ou entre parenthèses.
  const parts = s.replace(/[()]/g, ',').split(/[,;/]/).map((p) => p.trim()).filter(Boolean);
  const badges = [];
  const street = [];
  for (const p of parts) {
    const b = badgeOf(p);
    if (b) {
      if (!badges.some((x) => x.ref === b.ref)) badges.push(b);
    } else if (!street.includes(p)) {
      street.push(p);
    }
  }
  return { badges, street: street.join(', ') };
}

const REF_IN_TEXT = /\b(RN|RD|[ADNEMCRT])[ \t]?[-.]?[ \t]?(\d{1,4})(?:[ \t](bis|ter|[A-Z]\d{0,2})\b)?/g;

/**
 * Consigne sans badge (« Prenez la D 120 E en direction de Metz ») : espaces insécables à l'intérieur des références,
 * pour qu'elles ne soient jamais coupées entre deux lignes. Le reste du texte est inchangé.
 * @param {string} text
 */
export function keepRefsTogether(text) {
  if (typeof text !== 'string') return '';
  return text.replace(REF_IN_TEXT, (all) => all.replace(/[ \t]/g, NBSP));
}
