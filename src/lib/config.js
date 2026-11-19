// Constantes de configuration. URL de base SANS slash final.
// api.openrouteservice.org a été arrêtée début novembre 2026 : on passe par api.heigit.org.

/** Itinéraires ORS (clé dans l'en-tête Authorization). */
export const ORS_BASE = 'https://api.heigit.org/openrouteservice/v2';

/** Géocodage Pelias (clé dans l'en-tête Authorization ; api_key en URL seulement en repli). */
export const PELIAS_BASE = 'https://api.heigit.org/pelias/v1';

/** ORS refuse maximum_speed < 80 km/h. */
export const ORS_MIN_MAX_SPEED = 80;

/** Pays proposés par l'autocomplétion (France + voisins). */
export const GEOCODE_COUNTRIES = ['FR', 'BE', 'LU', 'DE', 'CH', 'IT', 'ES', 'AD', 'MC'];

/** Fonds de carte gratuits sans clé, dans l'ordre d'essai. */
export const MAP_STYLES = {
  day: [
    'https://tiles.openfreemap.org/styles/liberty',
    'https://tiles.versatiles.org/assets/styles/colorful/style.json',
  ],
  night: [
    'https://tiles.openfreemap.org/styles/dark',
    'https://tiles.versatiles.org/assets/styles/eclipse/style.json',
    'https://tiles.openfreemap.org/styles/liberty',
  ],
};

/** Version épinglée de MapLibre GL JS (aussi dans index.html et sw.js). */
export const MAPLIBRE_VERSION = '4.7.1';
