// Constantes de configuration. URL de base SANS slash final.
// api.openrouteservice.org a été arrêtée début novembre 2026 : on passe par api.heigit.org.

/** Itinéraires ORS (clé dans l'en-tête Authorization). */
export const ORS_BASE = 'https://api.heigit.org/openrouteservice/v2';

/** Géocodage Pelias (clé dans l'en-tête Authorization ; api_key en URL seulement en repli). */
export const PELIAS_BASE = 'https://api.heigit.org/pelias/v1';

/** ORS refuse maximum_speed < 80 km/h. */
export const ORS_MIN_MAX_SPEED = 80;

// Itinéraires alternatifs (source : GIScience/openrouteservice sur GitHub, lu sur raw.githubusercontent.com) :
// - ors-api/src/main/resources/application.yml : endpoints.routing.maximum_alternative_routes = 3,
//   profiles service.maximum_distance_alternative_routes = 100000 (docs/run-instance/configuration/engine/profiles/service.md) ;
// - ors-api/.../services/RoutingService.java : cette distance est mesurée À VOL D'OISEAU entre les points
//   (calculateTotalDistance), alternative_routes n'accepte que 2 points, dépassement → erreur 2004.

/** target_count maximal de alternative_routes (itinéraire principal compris). */
export const ORS_MAX_ALTERNATIVE_ROUTES = 3;

/** Distance maximale (m, à vol d'oiseau entre départ et arrivée) pour alternative_routes. */
export const ORS_ALTERNATIVE_ROUTES_MAX_DISTANCE_M = 100000;

/** Valeurs de « preference » acceptées par ORS (APIEnums.RoutePreference ; « recommended » par défaut). */
export const ORS_PREFERENCES = ['recommended', 'fastest', 'shortest'];

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
