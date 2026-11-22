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

/** Référence seule : lettre(s) puis chiffres, avec ou sans espace ou tiret (« D 83 », « A89 », « RN7 », « E 25 »). */
const REF = /^(RN|RD|[ADNEMCRT])\s*[-.]?\s*(\d{1,4}[A-Za-z]?(?:\.\d+)?)$/i;

function badgeOf(token) {
  const m = REF.exec(token.trim());
  if (!m) return null;
  let letter = m[1].toUpperCase();
  if (letter === 'RN') letter = 'N';
  if (letter === 'RD') letter = 'D';
  const kind = Object.hasOwn(BADGE_COLORS, letter) ? letter : 'other';
  const ref = `${letter} ${m[2].toUpperCase()}`;
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
