// Matières dangereuses (phase 5b) : réglage global de l'appli, pas du profil véhicule.
// L'ADR dépend de ce que l'on transporte, pas du camion : un seul chargement (case, classe, numéro ONU, code tunnel)
// dans Réglages (`settings.adr`), appliqué au véhicule actif au moment du calcul (`withAdr`). Logique pure.
//
// Accord ADR (UNECE) : 2.1.1.1 (classes de danger), 8.6.4 (code de restriction en tunnel, inscrit sur le document
// de transport, 5.4.1.1.1 k) ; la classe seule ne donne pas le code (il dépend de la matière et de l'emballage,
// colonne 15 du tableau A du 3.2) : jamais déduit ici, saisi à la main.

/** Codes tunnel proposés : vide (non renseigné, aucune alerte), B, C, D, E. 'none' = « sans code », repris d'un ancien profil. */
export const ADR_TUNNEL_CODES = Object.freeze(['', 'B', 'C', 'D', 'E']);
const KNOWN_CODES = Object.freeze([...ADR_TUNNEL_CODES, 'none']);

/** Classes de danger (ADR 2.1.1.1), avec un nom en clair pour la cabine. */
export const ADR_CLASSES = Object.freeze([
  Object.freeze({ value: '1', label: '1 — Explosibles' }),
  Object.freeze({ value: '2', label: '2 — Gaz (GPL…)' }),
  Object.freeze({ value: '3', label: '3 — Liquides inflammables (gazole, essence…)' }),
  Object.freeze({ value: '4.1', label: '4.1 — Solides inflammables' }),
  Object.freeze({ value: '4.2', label: '4.2 — Matières sujettes à l\'inflammation spontanée' }),
  Object.freeze({ value: '4.3', label: '4.3 — Dégageant des gaz inflammables au contact de l\'eau' }),
  Object.freeze({ value: '5.1', label: '5.1 — Comburantes (ammonitrates…)' }),
  Object.freeze({ value: '5.2', label: '5.2 — Peroxydes organiques' }),
  Object.freeze({ value: '6.1', label: '6.1 — Toxiques' }),
  Object.freeze({ value: '6.2', label: '6.2 — Infectieuses' }),
  Object.freeze({ value: '7', label: '7 — Radioactives' }),
  Object.freeze({ value: '8', label: '8 — Corrosives (acides…)' }),
  Object.freeze({ value: '9', label: '9 — Divers (batteries lithium…)' }),
]);
const CLASS_VALUES = ADR_CLASSES.map((c) => c.value);

/** Aide sous le code tunnel (Réglages). */
export const TUNNEL_CODE_HELP = 'Lettre indiquée sur le document de transport ; la classe seule ne la donne pas. Vide : aucune alerte tunnel.';

export function emptyAdrSettings() {
  return { enabled: false, adrClass: '', unNumber: '', tunnelCode: '' };
}

/** Numéro ONU tel que saisi (« UN 1202 », « 1202 ») → « 1202 » ; '' si vide. */
export function cleanUnNumber(text) {
  return String(text ?? '').replace(/^\s*UN\s*/i, '').trim();
}

/** Numéro ONU : vide ou 4 chiffres. Renvoie un message d'erreur, ou null. */
export function unNumberError(text) {
  const un = cleanUnNumber(text);
  return un && !/^\d{4}$/.test(un) ? 'Numéro ONU : 4 chiffres (ex. 1202).' : null;
}

/** Nettoie `settings.adr` (stockage ou import) ; valeur inconnue → vide. Les champs sont gardés même case décochée. */
export function sanitizeAdrSettings(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const un = cleanUnNumber(o.unNumber);
  return {
    enabled: o.enabled === true,
    adrClass: CLASS_VALUES.includes(String(o.adrClass ?? '')) ? String(o.adrClass) : '',
    unNumber: /^\d{4}$/.test(un) ? un : '',
    tunnelCode: KNOWN_CODES.includes(String(o.tunnelCode ?? '')) ? String(o.tunnelCode ?? '') : '',
  };
}

const isOn = (x) => x === true || x === 'on' || x === 'true';

/**
 * Reprise des anciens profils (avant v19 : hazmat, tunnelCode, adrClass, unNumber dans chaque véhicule) : profil actif
 * s'il est ADR, sinon le premier profil ADR, sinon rien. `settings.adr` déjà présent : gardé tel quel.
 * @param {object|undefined} rawAdr  settings.adr lu
 * @param {object[]} rawVehicles  profils bruts (avant nettoyage)
 * @param {string} activeId
 */
export function migrateAdrSettings(rawAdr, rawVehicles, activeId) {
  if (rawAdr && typeof rawAdr === 'object') return sanitizeAdrSettings(rawAdr);
  const list = Array.isArray(rawVehicles) ? rawVehicles.filter((v) => v && typeof v === 'object') : [];
  const from = list.find((v) => v.id === activeId && isOn(v.hazmat)) ?? list.find((v) => isOn(v.hazmat));
  if (!from) return emptyAdrSettings();
  return sanitizeAdrSettings({ enabled: true, adrClass: from.adrClass, unNumber: from.unNumber, tunnelCode: from.tunnelCode });
}

/**
 * Véhicule tel que le lisent ORS (restrictions.hazmat), les alertes tunnels, le résumé et les notes : profil +
 * chargement des Réglages. Case décochée : aucun champ ADR.
 */
export function withAdr(vehicle, adr) {
  if (!vehicle) return vehicle;
  const a = sanitizeAdrSettings(adr);
  return a.enabled
    ? { ...vehicle, hazmat: true, tunnelCode: a.tunnelCode, adrClass: a.adrClass, unNumber: a.unNumber }
    : { ...vehicle, hazmat: false, tunnelCode: '', adrClass: '', unNumber: '' };
}

/** Résumé court (« ADR (code E, classe 3, UN 1202) ») ou '' sans ADR. */
export function adrSummary(adr) {
  const a = sanitizeAdrSettings(adr);
  if (!a.enabled) return '';
  const code = a.tunnelCode === 'none' ? 'sans code tunnel' : a.tunnelCode ? `code ${a.tunnelCode}` : null;
  const extra = [code, a.adrClass ? `classe ${a.adrClass}` : null, a.unNumber ? `UN ${a.unNumber}` : null].filter(Boolean);
  return extra.length ? `ADR (${extra.join(', ')})` : 'ADR';
}
