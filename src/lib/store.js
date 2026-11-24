// Données locales (véhicules, lieux, signalements, trajets, avis sur les aires, réglages) + export/import JSON.
// Stockage injectable (localStorage dans le navigateur, objet en mémoire dans les tests).
// La clé ORS est rangée à part et n'est JAMAIS exportée.

import { normalizeVehicle, validateVehicle, defaultVehicle, parseNumber } from './vehicle.js';
import { THEME_MODES } from './theme.js';
import { isSimSpeed, SIM_DEFAULT_SPEED } from './nav-sim.js';
import { sanitizeMapLayer, DEFAULT_MAP_LAYER } from './map-layers.js';
import {
  sanitizeArrowColor, sanitizeVehicleIcon, DEFAULT_VEHICLE_ICON, sanitizeVoiceRate, sanitizeVoiceVolume, sanitizeVoiceName, DEFAULT_ARROW_COLOR, VOICE_RATE, VOICE_VOLUME,
} from './prefs.js';
import { sanitizeAreaReports } from './areas-avis.js';
import { sanitizeRestrictions } from './restrictions.js';
import { sanitizeFuelStations } from './fuel-stations.js';
import { sanitizeAreaNotes } from './area-notes.js';
import { sanitizeHistory } from './trip-history.js';
import { sanitizeRecent } from './recent-places.js';
import { sanitizeReports } from './reports.js';
import { sanitizePlaces } from './saved-places.js';
import { sanitizeNightLevel, DEFAULT_NIGHT_LEVEL } from './map-palette.js';
import { sanitizeWindGust, WIND } from './wind.js';
import { emptyAdrSettings, migrateAdrSettings, withAdr } from './adr-settings.js';

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
    restrictions: [],
    fuelStations: [],
    areaNotes: [],
    settings: {
      theme: 'auto', nightMapLevel: DEFAULT_NIGHT_LEVEL, avoidTolls: false, avoidFerries: false, voice: true, simSpeed: SIM_DEFAULT_SPEED, dieselPrice: null,
      mapLayer: DEFAULT_MAP_LAYER,
      arrowColor: DEFAULT_ARROW_COLOR, vehicleIcon: DEFAULT_VEHICLE_ICON, voiceName: '', voiceRate: VOICE_RATE.default, voiceVolume: VOICE_VOLUME.default,
      areaVoice: false,
      speedVoice: false,
      reportVoice: false,
      ruleVoice: true,
      driveVoice: true,
      windVoice: true,
      windGust: WIND.GUST.default,
      bridgeWarnings: true,
      weightWarnings: true,
      panelCollapsed: false,
      creditsOpen: false,
      adr: emptyAdrSettings(),
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
    places: sanitizePlaces(raw.places), // mes lieux (phase 3b) : données personnelles, champs connus seulement, 50 au plus
    reports: sanitizeReports(raw.reports), // mes signalements (phase 3a) : champs connus seulement, 500 au plus
    trips: arr(raw.trips).slice(0, MAX_TRIPS),
    areaReports: sanitizeAreaReports(raw.areaReports), // « Mon avis » sur les aires (phase 9)
    restrictions: sanitizeRestrictions(raw.restrictions).list, // Mes restrictions (phase 12b) : invalides et doublons écartés
    fuelStations: sanitizeFuelStations(raw.fuelStations), // Mes stations « OK camion » (phase 4)
    areaNotes: sanitizeAreaNotes(raw.areaNotes), // notes perso sur les aires (phase 6)
    settings: {
      theme: THEME_MODES.includes(s.theme) ? s.theme : 'auto',
      nightMapLevel: sanitizeNightLevel(s.nightMapLevel), // luminosité de la carte la nuit (phase 2d), Normal par défaut
      avoidTolls: s.avoidTolls === true,
      avoidFerries: s.avoidFerries === true,
      voice: s.voice !== false, // guidage vocal activé par défaut
      simSpeed: isSimSpeed(s.simSpeed) ? s.simSpeed : SIM_DEFAULT_SPEED,
      dieselPrice: isDieselPrice(s.dieselPrice) ? s.dieselPrice : null, // vide par défaut ; prix des stations : fiche « Carburant » (phase 4)
      mapLayer: sanitizeMapLayer(s.mapLayer), // « plan » ou « satellite » (phase 7)
      arrowColor: sanitizeArrowColor(s.arrowColor), // phase 7c
      vehicleIcon: sanitizeVehicleIcon(s.vehicleIcon), // v45 : camion par défaut, anciens réglages compris
      voiceName: sanitizeVoiceName(s.voiceName),
      voiceRate: sanitizeVoiceRate(s.voiceRate),
      voiceVolume: sanitizeVoiceVolume(s.voiceVolume),
      areaVoice: s.areaVoice === true, // annonce vocale des aires PL (phase 9), désactivée par défaut
      speedVoice: s.speedVoice === true, // « Limite X » au dépassement (phase 11a), désactivé par défaut
      reportVoice: s.reportVoice === true, // mes signalements confirmés dits à l'approche (phase 3a), désactivé par défaut
      ruleVoice: s.ruleVoice !== false, // alertes vocales ZFE et interdictions PL (phase 5), activées par défaut
      driveVoice: s.driveVoice !== false, // annonces des pauses (temps de conduite, phase 5), activées par défaut
      windVoice: s.windVoice !== false, // annonce du vent fort (phase 5), activée par défaut
      windGust: sanitizeWindGust(s.windGust), // seuil de rafales (km/h), 70 par défaut
      bridgeWarnings: s.bridgeWarnings !== false, // ponts sans hauteur connue (phase 12a), signalés par défaut
      weightWarnings: s.weightWarnings !== false, // limites de poids d'OSM (phase 12a bis), signalées par défaut
      panelCollapsed: s.panelCollapsed === true, // v62 : panneau de préparation replié (carte seule), déplié par défaut
      creditsOpen: s.creditsOpen === true, // v64 : « Sources et licences » de Réglages dépliée ; repliée par défaut
      // Matières dangereuses (phase 5b, réglage global depuis la v19) ; ancien fichier : repris des profils.
      adr: migrateAdrSettings(s.adr, raw.vehicles, raw.activeVehicleId),
    },
  };
}

/**
 * JSON d'export : toutes les données, jamais la clé ORS. history (phase 6) : trajets terminés lus dans IndexedDB
 * (src/ui/trip-history.js), sans coordonnées ; null → champ absent (historique indisponible).
 * recent (v64) : recherches récentes (clé gabarit.recentPlaces, src/lib/recent-places.js) ; null → champ absent.
 */
export function exportData(data, now = new Date(), history = null, recent = null) {
  const clean = sanitizeData(data);
  const extra = Array.isArray(history) ? { history: sanitizeHistory(history) } : {};
  if (Array.isArray(recent)) extra.recentPlaces = sanitizeRecent(recent);
  return JSON.stringify({ app: 'gabarit', exportedAt: now.toISOString(), ...clean, ...extra }, null, 2);
}

/**
 * Phase 6 : lit un export complet → { data (gabarit.data), history (trajets, [] si absent : ancien export),
 * recentPlaces (v64, [] si absent) }. Ni l'un ni l'autre n'entre dans gabarit.data.
 */
export function readExport(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Fichier illisible : ce n'est pas du JSON valide.");
  }
  return { data: sanitizeData(raw), history: sanitizeHistory(raw?.history), recentPlaces: sanitizeRecent(raw?.recentPlaces) };
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

/** Profil actif, avec le chargement ADR des Réglages (hazmat, tunnelCode, adrClass, unNumber : withAdr). */
export function activeVehicle(data) {
  const v = data.vehicles.find((o) => o.id === data.activeVehicleId) ?? data.vehicles[0] ?? null;
  return withAdr(v, data.settings?.adr);
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
