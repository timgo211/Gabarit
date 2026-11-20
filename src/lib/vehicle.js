// Profils véhicule : schéma, normalisation, validation. Logique pure.

export const CRITAIR_VALUES = ['0', '1', '2', '3', '4', '5', 'NC'];

/**
 * Interdictions PL des week-ends et jours fériés (phase 5, arrêté du 16 avril 2021) : véhicule concerné, transport de
 * l'article 4 (denrées périssables, animaux vivants… : seule la réglementation Île-de-France de l'art. 3 s'applique),
 * ou véhicule spécialisé / agricole de l'annexe II (non concerné). Libellés : BAN_STATUS de hgv-bans.js.
 */
export const BAN_STATUS_VALUES = ['concerned', 'art4', 'exempt'];

/**
 * Matières dangereuses (phase 5b, accord ADR 8.6.4) : code de restriction en tunnel du chargement ('' = non renseigné,
 * aucune alerte ; 'none' = chargement sans code), classe et numéro ONU facultatifs. Voir src/lib/adr.js.
 */
export const TUNNEL_CODE_VALUES = ['', 'B', 'C', 'D', 'E', 'none'];
export const ADR_CLASS_VALUES = ['', '1', '2', '3', '4.1', '4.2', '4.3', '5.1', '5.2', '6.1', '6.2', '7', '8', '9'];

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
    hazmat: false,
    maxSpeed: 90,
    consumption: 32,
    critair: '1',
    banStatus: 'concerned',
    tunnelCode: '',
    adrClass: '',
    unNumber: '',
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
    hazmat: raw?.hazmat === true || raw?.hazmat === 'on' || raw?.hazmat === 'true',
    critair: CRITAIR_VALUES.includes(String(raw?.critair)) ? String(raw.critair) : 'NC',
    banStatus: BAN_STATUS_VALUES.includes(raw?.banStatus) ? raw.banStatus : 'concerned',
  };
  // Champs ADR : facultatifs, gardés seulement avec « Matières dangereuses » coché.
  const code = String(raw?.tunnelCode ?? '');
  const cls = String(raw?.adrClass ?? '');
  const un = String(raw?.unNumber ?? '').replace(/^\s*UN\s*/i, '').trim();
  v.tunnelCode = v.hazmat ? code : '';
  v.adrClass = v.hazmat ? cls : '';
  v.unNumber = v.hazmat ? un : '';
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
  if (typeof v.hazmat !== 'boolean') errors.hazmat = 'Valeur invalide.';
  if (!BAN_STATUS_VALUES.includes(v.banStatus)) errors.banStatus = 'Valeur invalide.';
  if (!TUNNEL_CODE_VALUES.includes(v.tunnelCode ?? '')) errors.tunnelCode = 'Code tunnel inconnu.';
  if (!ADR_CLASS_VALUES.includes(v.adrClass ?? '')) errors.adrClass = 'Classe ADR inconnue.';
  if (v.unNumber && !/^\d{4}$/.test(v.unNumber)) errors.unNumber = 'Numéro ONU : 4 chiffres (ex. 1202).';
  return { valid: Object.keys(errors).length === 0, errors };
}
