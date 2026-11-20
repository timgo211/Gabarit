// Données locales (véhicules, lieux, signalements, trajets, avis sur les aires, réglages) + export/import JSON.
// Stockage injectable (localStorage dans le navigateur, objet en mémoire dans les tests).
// La clé ORS est rangée à part et n'est JAMAIS exportée.

import { normalizeVehicle, validateVehicle, defaultVehicle, parseNumber } from './vehicle.js';
import { THEME_MODES } from './theme.js';
import { isSimSpeed, SIM_DEFAULT_SPEED } from './nav-sim.js';
import { sanitizeMapLayer, DEFAULT_MAP_LAYER } from './map-layers.js';
import {
  sanitizeArrowColor, sanitizeVoiceRate, sanitizeVoiceVolume, sanitizeVoiceName, DEFAULT_ARROW_COLOR, VOICE_RATE, VOICE_VOLUME,
} from './prefs.js';
import { sanitizeAreaReports } from './areas-avis.js';
import { sanitizeWindGust, WIND } from './wind.js';

export const DATA_KEY = 'gabarit.data';
export const API_KEY_KEY = 'gabarit.orsKey';
export const SCHEMA_VERSION = 1;
export const MAX_TRIPS = 50;

/** Prix du gazole saisi dans Réglages (€/L) : bornes larges, qui écartent surtout les fautes de frappe. */
export const DIESEL_PRICE = Object.freeze({ min: 0.5, max: 5 });

export function isDieselPrice(x) {
  return typeof x === 'number' && Number.isFinite(x) && x >= DIESEL_PRICE.min && x <= DIESEL_PRICE.max;
}

/**
 * Lit le prix saisi (« 1,85 » ou « 1.85 »). Vide → pas de prix (null), sans erreur.
 * @returns {{ value:number|null, error:string|null }}
 */
export function parseDieselPrice(text) {
  const n = parseNumber(text);
  if (n === null) return { value: null, error: null };
  if (Number.isNaN(n)) return { value: null, error: 'Prix du gazole : nombre attendu (ex. 1,85).' };
  if (!isDieselPrice(n)) return { value: null, error: 'Prix du gazole : entre 0,50 et 5 €/L.' };
  return { value: Math.round(n * 1000) / 1000, error: null };
}

export function emptyData() {
  const v = defaultVehicle();
  return {
    version: SCHEMA_VERSION,
    vehicles: [v],
    activeVehicleId: v.id,
    places: [],
    reports: [],
    trips: [],
    areaReports: [],
    settings: {
      theme: 'auto', avoidTolls: false, avoidFerries: false, voice: true, simSpeed: SIM_DEFAULT_SPEED, dieselPrice: null,
      mapLayer: DEFAULT_MAP_LAYER,
      arrowColor: DEFAULT_ARROW_COLOR, voiceName: '', voiceRate: VOICE_RATE.default, voiceVolume: VOICE_VOLUME.default,
      areaVoice: false,
      ruleVoice: true,
      driveVoice: true,
      windVoice: true,
      windGust: WIND.GUST.default,
    },
  };
}

/** Vérifie et nettoie des données (chargées ou importées). Lève une Error en français si illisibles. */
export function sanitizeData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Fichier illisible : objet JSON attendu.');
  if (raw.app !== undefined && raw.app !== 'gabarit') throw new Error("Ce fichier ne vient pas de l'appli Gabarit.");
  if (typeof raw.version === 'number' && raw.version > SCHEMA_VERSION) {
    throw new Error('Fichier créé par une version plus récente de Gabarit.');
  }
  if (!Array.isArray(raw.vehicles)) throw new Error('Fichier illisible : liste de véhicules absente.');

  const vehicles = [];
  raw.vehicles.forEach((rv, i) => {
    const v = normalizeVehicle(rv);
    const { valid, errors } = validateVehicle(v);
    if (!valid) throw new Error(`Véhicule n°${i + 1} invalide : ${Object.values(errors).join(' ')}`);
    if (vehicles.some((o) => o.id === v.id)) v.id = `${v.id}-${i}`;
    vehicles.push(v);
  });
  if (!vehicles.length) vehicles.push(defaultVehicle());

  const activeVehicleId = vehicles.some((v) => v.id === raw.activeVehicleId) ? raw.activeVehicleId : vehicles[0].id;
  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const arr = (x) => (Array.isArray(x) ? x.filter((e) => e && typeof e === 'object') : []);

  return {
    version: SCHEMA_VERSION,
    vehicles,
    activeVehicleId,
    places: arr(raw.places),
    reports: arr(raw.reports),
    trips: arr(raw.trips).slice(0, MAX_TRIPS),
    areaReports: sanitizeAreaReports(raw.areaReports), // « Mon avis » sur les aires (phase 9)
    settings: {
      theme: THEME_MODES.includes(s.theme) ? s.theme : 'auto',
      avoidTolls: s.avoidTolls === true,
      avoidFerries: s.avoidFerries === true,
      voice: s.voice !== false, // guidage vocal activé par défaut
      simSpeed: isSimSpeed(s.simSpeed) ? s.simSpeed : SIM_DEFAULT_SPEED,
      dieselPrice: isDieselPrice(s.dieselPrice) ? s.dieselPrice : null, // vide par défaut (vrais prix : phase 4)
      mapLayer: sanitizeMapLayer(s.mapLayer), // « plan » ou « satellite » (phase 7)
      arrowColor: sanitizeArrowColor(s.arrowColor), // phase 7c
      voiceName: sanitizeVoiceName(s.voiceName),
      voiceRate: sanitizeVoiceRate(s.voiceRate),
      voiceVolume: sanitizeVoiceVolume(s.voiceVolume),
      areaVoice: s.areaVoice === true, // annonce vocale des aires PL (phase 9), désactivée par défaut
      ruleVoice: s.ruleVoice !== false, // alertes vocales ZFE et interdictions PL (phase 5), activées par défaut
      driveVoice: s.driveVoice !== false, // annonces des pauses (temps de conduite, phase 5), activées par défaut
      windVoice: s.windVoice !== false, // annonce du vent fort (phase 5), activée par défaut
      windGust: sanitizeWindGust(s.windGust), // seuil de rafales (km/h), 80 par défaut
    },
  };
}

/** JSON d'export : toutes les données, jamais la clé ORS. */
export function exportData(data, now = new Date()) {
  const clean = sanitizeData(data);
  return JSON.stringify({ app: 'gabarit', exportedAt: now.toISOString(), ...clean }, null, 2);
}

/** Lit un JSON d'export. Toute propriété inconnue (dont une éventuelle clé) est ignorée. */
export function importData(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Fichier illisible : ce n'est pas du JSON valide.");
  }
  return sanitizeData(raw);
}

export function activeVehicle(data) {
  return data.vehicles.find((v) => v.id === data.activeVehicleId) ?? data.vehicles[0] ?? null;
}

/** Ajoute un trajet en tête de l'historique (borné). Renvoie de nouvelles données. */
export function addTrip(data, trip) {
  return { ...data, trips: [trip, ...data.trips].slice(0, MAX_TRIPS) };
}

/** Accès au stockage. */
export function createStore(storage) {
  return {
    load() {
      const text = storage.getItem(DATA_KEY);
      if (!text) return emptyData();
      try {
        return sanitizeData(JSON.parse(text));
      } catch {
        return emptyData();
      }
    },
    save(data) {
      storage.setItem(DATA_KEY, JSON.stringify(sanitizeData(data)));
    },
    getApiKey() {
      return (storage.getItem(API_KEY_KEY) ?? '').trim();
    },
    setApiKey(key) {
      const k = String(key ?? '').trim();
      if (k) storage.setItem(API_KEY_KEY, k);
      else storage.removeItem(API_KEY_KEY);
    },
  };
}

/** Stockage en mémoire, compatible localStorage (tests, ou repli si localStorage est bloqué). */
export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
