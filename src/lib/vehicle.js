// Profils véhicule : schéma, normalisation, validation. Logique pure.

export const CRITAIR_VALUES = ['0', '1', '2', '3', '4', '5', 'NC'];

/**
 * Interdictions PL des week-ends et jours fériés (phase 5, arrêté du 16 avril 2021) : véhicule concerné, transport de
 * l'article 4 (denrées périssables, animaux vivants… : seule la réglementation Île-de-France de l'art. 3 s'applique),
 * ou véhicule spécialisé / agricole de l'annexe II (non concerné). Libellés : BAN_STATUS de hgv-bans.js.
 */
export const BAN_STATUS_VALUES = ['concerned', 'art4', 'exempt'];

/**
 * Transport combiné (phase 5e) : conteneurs ou caisses mobiles en opération de transport intermodal (directive
 * 96/53/CE art. 2, annexe I 2.2.2 c et d, modifiée par la directive (UE) 2015/719). Seul cas où l'on peut dépasser
 * 40 t en trafic international (42 t avec un tracteur à 2 essieux, 44 t avec un tracteur à 3 essieux). Voir weights.js.
 */
export const COMBINED_LABEL = 'Transport combiné (conteneurs ou caisses mobiles, opération intermodale)';

/**
 * Remorque (phase 5f, équipements d'hiver) : non précisée (défaut, les deux consignes sont données), sans remorque,
 * avec remorque ou semi-remorque (chaînes à bord même avec des pneus hiver). Voir winter.js.
 */
export const TRAILER_VALUES = Object.freeze(['', 'none', 'with']);
export const TRAILER_LABELS = Object.freeze({ '': 'Non précisé', none: 'Sans remorque', with: 'Avec remorque ou semi-remorque' });

/**
 * Classe d'émissions Euro du moteur (phase 5g, servira aussi à la phase 5h) : '' = non précisée (défaut, les deux cas
 * sont affichés), 0 à 6, ou EEV (« véhicule plus respectueux de l'environnement », directive 2005/55/CE, valeurs
 * limites de la ligne C). Correspondances par règle et sources : EURO_EEV dans euro.js.
 */
export const EURO_VALUES = Object.freeze(['', '0', '1', '2', '3', '4', '5', 'EEV', '6']);
export const EURO_LABELS = Object.freeze({
  '': 'Non précisé', 0: 'Euro 0 (ou antérieur)', 1: 'Euro 1 (I)', 2: 'Euro 2 (II)', 3: 'Euro 3 (III)', 4: 'Euro 4 (IV)',
  5: 'Euro 5 (V)', EEV: 'EEV', 6: 'Euro 6 (VI)',
});

// Matières dangereuses (phase 5b) : réglage global (Réglages, settings.adr), plus dans le profil depuis la v19.
// Voir src/lib/adr-settings.js (reprise des anciens profils, withAdr).

/**
 * Champs numériques : unité, bornes acceptées, obligatoire ou non.
 * Les bornes sont larges (convois exceptionnels possibles) mais écartent les fautes de frappe.
 */
export const NUMERIC_FIELDS = {
  height: { label: 'Hauteur', unit: 'm', min: 1, max: 6, required: true },
  width: { label: 'Largeur', unit: 'm', min: 1, max: 5, required: true },
  length: { label: 'Longueur', unit: 'm', min: 2, max: 40, required: true },
  weight: { label: 'PTAC', unit: 't', min: 1, max: 100, required: true },
  axleload: { label: "Charge à l'essieu", unit: 't', min: 1, max: 30, required: false },
  maxSpeed: { label: 'Vitesse max', unit: 'km/h', min: 30, max: 130, required: true },
  consumption: { label: 'Consommation', unit: 'L/100 km', min: 1, max: 100, required: false },
};

let idCounter = 0;
/** Identifiant court et unique (pas besoin de crypto ici). */
export function newId(prefix = 'v') {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** Profil par défaut : semi-remorque standard 44 t. */
export function defaultVehicle() {
  return {
    id: newId(),
    name: 'Semi 44 t',
    height: 4,
    width: 2.55,
    length: 16.5,
    weight: 44,
    axleload: 11.5,
    maxSpeed: 90,
    consumption: 32,
    critair: '1',
    banStatus: 'concerned',
    combined: false,
    trailer: '',
    euroClass: '',
  };
}

/** Convertit « 3,85 » ou « 3.85 » en nombre ; renvoie null si vide ou illisible. */
export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return Number.NaN;
  return Number(s);
}

/** Normalise un profil brut (formulaire ou import) sans le valider. */
export function normalizeVehicle(raw) {
  const v = {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : newId(),
    name: typeof raw?.name === 'string' ? raw.name.trim() : '',
    critair: CRITAIR_VALUES.includes(String(raw?.critair)) ? String(raw.critair) : 'NC',
    banStatus: BAN_STATUS_VALUES.includes(raw?.banStatus) ? raw.banStatus : 'concerned',
    // Case du formulaire (« on ») ou booléen d'un export ; anciens profils : non.
    combined: raw?.combined === true || raw?.combined === 'on',
    trailer: TRAILER_VALUES.includes(raw?.trailer) ? raw.trailer : '',
    // Anciens profils et valeur inconnue : non précisée.
    euroClass: EURO_VALUES.includes(String(raw?.euroClass ?? '')) ? String(raw?.euroClass ?? '') : '',
  };
  // Anciens champs ADR (hazmat, tunnelCode, adrClass, unNumber) : non gardés, repris dans settings.adr (store.js).
  for (const key of Object.keys(NUMERIC_FIELDS)) {
    v[key] = parseNumber(raw?.[key]);
  }
  return v;
}

/**
 * Valide un profil normalisé.
 * @returns {{ valid: boolean, errors: Record<string,string> }}
 */
export function validateVehicle(v) {
  const errors = {};
  if (!v || typeof v !== 'object') return { valid: false, errors: { name: 'Profil illisible.' } };
  if (!v.name) errors.name = 'Donne un nom au véhicule.';
  else if (v.name.length > 40) errors.name = 'Nom trop long (40 caractères max).';

  for (const [key, def] of Object.entries(NUMERIC_FIELDS)) {
    const val = v[key];
    if (val === null || val === undefined) {
      if (def.required) errors[key] = `${def.label} obligatoire.`;
      continue;
    }
    if (typeof val !== 'number' || Number.isNaN(val)) {
      errors[key] = `${def.label} : nombre attendu.`;
    } else if (val < def.min || val > def.max) {
      errors[key] = `${def.label} : entre ${def.min} et ${def.max} ${def.unit}.`;
    }
  }
  if (!errors.axleload && !errors.weight && v.axleload && v.weight && v.axleload > v.weight) {
    errors.axleload = "La charge à l'essieu ne peut pas dépasser le PTAC.";
  }
  if (!CRITAIR_VALUES.includes(v.critair)) errors.critair = 'Vignette Crit\'Air inconnue.';
  if (!BAN_STATUS_VALUES.includes(v.banStatus)) errors.banStatus = 'Valeur invalide.';
  if (v.euroClass !== undefined && !EURO_VALUES.includes(v.euroClass)) errors.euroClass = 'Classe Euro inconnue.';
  return { valid: Object.keys(errors).length === 0, errors };
}
