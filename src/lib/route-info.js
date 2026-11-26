// Menu « Informations du trajet » (v84) : niveau de chaque ligne de la fiche (interdit, alerte, à vérifier, info),
// tri des lignes (interdits d'abord, ordre d'origine gardé dans un même niveau), récap de l'en-tête et pire niveau.
// Aucune logique réglementaire ici : le niveau vient du champ `sev` posé par chaque règle (route-rules.js et
// voisins), sinon de `level` (warn → alerte, info → info). Textes des lignes jamais modifiés.
// Donnée de sécurité manquante (ponts, poids, points sensibles, ZFE, calendrier, tunnels ADR) : « à vérifier ».

export const SEV = Object.freeze({ BAN: 'ban', ALERT: 'alert', CHECK: 'check', INFO: 'info' });
const ORDER = [SEV.BAN, SEV.ALERT, SEV.CHECK, SEV.INFO];

/** Symbole et mot de chaque niveau (jamais la couleur seule). */
export const SEV_LABEL = Object.freeze({
  ban: Object.freeze({ icon: '⛔', word: 'interdit', plural: 'interdits' }),
  alert: Object.freeze({ icon: '⚠', word: 'alerte', plural: 'alertes' }),
  check: Object.freeze({ icon: '?', word: 'à vérifier', plural: 'à vérifier' }),
  info: Object.freeze({ icon: 'ℹ', word: 'info', plural: 'infos' }),
});

export const TRIP_INFO = Object.freeze({
  TITLE: 'Informations du trajet',
  NONE_TEXT: 'Aucune alerte',
});

/** Niveau d'une ligne de la fiche. */
export function lineSeverity(line) {
  if (ORDER.includes(line?.sev)) return line.sev;
  return line?.level === 'warn' ? SEV.ALERT : SEV.INFO;
}

/** Lignes triées par niveau (interdits, alertes, à vérifier, infos), ordre d'origine gardé dans un niveau. */
export function sortLines(lines = []) {
  return (lines ?? []).map((l, i) => ({ l, i, r: ORDER.indexOf(lineSeverity(l)) }))
    .sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.l);
}

/** Nombre de lignes par niveau. */
export function countSeverities(lines = []) {
  const c = { ban: 0, alert: 0, check: 0, info: 0 };
  for (const l of lines ?? []) c[lineSeverity(l)] += 1;
  return c;
}

/** « 1 interdit · 2 alertes · 3 à vérifier » (niveaux présents seulement), sinon « Aucune alerte ». */
export function recapText(lines = []) {
  const c = countSeverities(lines);
  const parts = [SEV.BAN, SEV.ALERT, SEV.CHECK].filter((k) => c[k] > 0)
    .map((k) => `${c[k]} ${c[k] > 1 ? SEV_LABEL[k].plural : SEV_LABEL[k].word}`);
  return parts.length ? parts.join(' · ') : TRIP_INFO.NONE_TEXT;
}

/** Pire niveau présent (info si aucune ligne). */
export function worstSeverity(lines = []) {
  const c = countSeverities(lines);
  return ORDER.find((k) => c[k] > 0) ?? SEV.INFO;
}

/**
 * Menu replié à chaque nouveau calcul, état gardé pendant le même calcul seulement (rien sauvegardé).
 * @returns {{ isOpen:(calc:unknown)=>boolean, set:(calc:unknown, open:boolean)=>void }}
 */
export function createTripInfoState() {
  let calc = null;
  let open = false;
  return {
    isOpen(c) { if (c !== calc) { calc = c; open = false; } return open; },
    set(c, o) { calc = c; open = o === true; },
  };
}
