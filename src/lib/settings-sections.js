// Sections repliables de Réglages (v84) : clés, état ouvert / fermé (settings.sectionsOpen, seule source d'état,
// « Sources et licences » compris) et valeur courante en petit sous le titre des réglages de conduite.
// Aucune logique de réglage ici : mêmes clés, mêmes défauts que store.js.

import { formatPricePerLiter } from './format.js';

/** Ordre de l'écran Réglages (index.html : section[data-section]). */
export const SECTION_KEYS = Object.freeze([
  'key', 'display', 'voice', 'arrow', 'adr', 'driving', 'bans', 'bridges', 'weights',
  'places', 'reports', 'restrictions', 'diesel', 'history', 'recent', 'data', 'test', 'credits',
]);

/**
 * État des sections : { clé: true } pour les ouvertes seulement ; absent, abîmé ou clé inconnue → replié.
 * Ancienne sauvegarde v64 : `creditsOpen: true` (sans sectionsOpen.credits) → « Sources et licences » ouverte.
 */
export function sanitizeSectionsOpen(raw, legacyCreditsOpen = false) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const k of SECTION_KEYS) if (src[k] === true) out[k] = true;
  if (!Object.hasOwn(src, 'credits') && legacyCreditsOpen === true) out.credits = true;
  return out;
}

/** Nouvel état après un appui (objet neuf, seules les sections ouvertes gardées). */
export function toggleSection(open, key, value) {
  const next = { ...sanitizeSectionsOpen(open) };
  if (!SECTION_KEYS.includes(key)) return next;
  if (value === true) next[key] = true;
  else delete next[key];
  return next;
}

const THEME_TEXT = { auto: 'Auto', day: 'Jour', night: 'Nuit' };
const ARROW_TEXT = { auto: 'Auto', bleu: 'Bleu', vert: 'Vert', orange: 'Orange', violet: 'Violet' };
const yesNo = (b) => (b ? 'oui' : 'non');

/** Texte « Clé : manquante » (clé vide, ou refusée par le dernier test de cette session). */
export const KEY_MISSING_TEXT = 'Clé : manquante';

/**
 * Valeur courante sous le titre (une ligne courte), ou '' pour les sections de données.
 * @param {string} key
 * @param {object} settings data.settings (sanitizeData)
 * @param {{ hasKey?:boolean, keyInvalid?:boolean }} [o]
 */
export function sectionSummary(key, settings = {}, { hasKey = false, keyInvalid = false } = {}) {
  const s = settings ?? {};
  switch (key) {
    case 'key': return hasKey && !keyInvalid ? 'Clé : enregistrée' : KEY_MISSING_TEXT;
    case 'display': return `Mode nuit : ${THEME_TEXT[s.theme] ?? THEME_TEXT.auto}`;
    case 'voice': return `Annonces vocales : ${yesNo(s.voice !== false)}`;
    case 'arrow': return `Couleur : ${ARROW_TEXT[s.arrowColor] ?? ARROW_TEXT.auto}`;
    case 'adr': {
      const a = s.adr ?? {};
      if (!a.enabled) return 'Matières dangereuses : non';
      return a.tunnelCode && a.tunnelCode !== 'none' ? `Matières dangereuses : oui, code ${a.tunnelCode}` : 'Matières dangereuses : oui';
    }
    case 'driving': return `Alerte vent : ${s.windGust ?? 70} km/h`;
    case 'bans': return `Contournement automatique : ${yesNo(s.autoBypass !== false)}`;
    case 'bridges': return `Signaler : ${yesNo(s.bridgeWarnings !== false)}`;
    case 'weights': return `Signaler : ${yesNo(s.weightWarnings !== false)} · DiaLog : ${yesNo(s.dialogWarnings !== false)}`;
    case 'diesel': {
      const p = formatPricePerLiter(s.dieselPrice);
      return p ? `Prix : ${p} €/L` : 'Prix : non renseigné';
    }
    case 'test': return `Vitesse : ${s.simSpeed ?? 50} km/h`;
    default: return '';
  }
}
