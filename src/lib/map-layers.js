// Couche de fond (phases 7, 7c et 7d) : « Plan » (fond vectoriel OpenFreeMap / VersaTiles) ou « Satellite » (photos
// aériennes IGN en France, orthophotos ouvertes voisines ailleurs, phase 7d).
// Logique pure : choix mémorisé, zone couverte, message. L'affichage est dans src/ui/map.js.
//
// Photos aériennes : couche ORTHOIMAGERY.ORTHOPHOTOS de la Géoplateforme IGN (data.geopf.fr), gratuite et sans clé,
// sous Licence Ouverte Etalab 2.0 (https://www.etalab.gouv.fr/licence-ouverte-open-licence/) : réutilisation libre,
// y compris personnelle, à condition de citer la source (« IGN »). Service : https://geoservices.ign.fr/services-web-experts-ortho
// Paramètres du GetCapabilities WMTS (https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0) :
// TileMatrixSet « PM » (Web Mercator, tuiles 256 px), format image/jpeg, style « normal », niveaux 2 à 19.
// data.geopf.fr n'étant pas joignable depuis le conteneur de développement, ces valeurs ont été relevées dans des
// copies générées depuis ce GetCapabilities (geopandas/xyzservices providers.json, iTowns Ortho.json) et recoupées
// avec osmlab/editor-layer-index (BDOrthoIGN : zoom maximal 19, zone couverte).
//
// Hors de France (phase 7d) : orthophotos nationales ou régionales ouvertes, codées seulement si leurs conditions
// d'usage ont été lues (licence, attribution, usage dans une appli web publique) ET si une tuile réelle a répondu
// (HTTP 200, image, en-tête CORS access-control-allow-origin pour https://timgo211.github.io : MapLibre charge les
// tuiles raster par fetch). Lecture et essai : Action « Textes officiels » (tools/textes-officiels.json, entrées sat-*),
// journal du 23/11/2026. Registre SATELLITE_SOURCES ci-dessous ; zones : src/lib/satellite-zones.js (Natural Earth,
// domaine public). Ailleurs (et pour les sources non codées) : plan gardé, avec un message. v58 (restes, journal de
// l'Action du 23/11/2026, entrées sat7d-*) : Bade-Wurtemberg, Bavière, Hesse codées (ci-dessous). Non codées :
// Flandre (tuile WMTS 200 + CORS « * », service « kosteloos » et « door iedereen gebruikt », mais les conditions
// d'usage des données renvoient à un texte non lu en entier : licence et mention non confirmées), Wallonie (tuile
// 200 + CORS, aucune condition lisible : pages du géoportail en 404, GetCapabilities sans licence), Sarre (tuile 200 +
// CORS « * », GetCapabilities « opendata », Fees « None », AccessConstraints « noLimitations », mais aucune licence
// ni mention écrite lisible : pages de conditions vides ou 403), NGI (non demandé).
// Esri World Imagery : compte ArcGIS exigé ; Sentinel-2 cloudless d'EOX : 10 m par pixel, licence non commerciale.

import { SATELLITE_ZONES } from './satellite-zones.js';

export const MAP_LAYERS = Object.freeze(['plan', 'satellite']);
export const DEFAULT_MAP_LAYER = 'plan';

export const IGN_ORTHO = Object.freeze({
  tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS'
    + '&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'],
  tileSize: 256,
  minzoom: 2,
  maxzoom: 19, // au-delà, MapLibre agrandit les tuiles du niveau 19
  attribution: '<a href="https://www.ign.fr/" target="_blank" rel="noopener">© IGN – Géoplateforme</a>',
});

/** Message hors de toute source codée (v7d : plus seulement la France ; liste dans Réglages › crédits). */
export const SATELLITE_OUTSIDE_TEXT = 'Vue satellite indisponible à cet endroit';

const READ_ON = 'lu le 23/11/2026 (journal de l\'Action Textes officiels)';
/** v58 : même requête en WMS 1.1.1 (SRS au lieu de CRS), seule version qui répond pour le DOP20 du LGL-BW. */
const wms111 = (base, layer, format) => `${base}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${layer}&STYLES=`
  + `&FORMAT=${format}&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}`;
/** Requête WMS d'une tuile 256 px en Web Mercator (MapLibre remplace {bbox-epsg-3857}). */
const wms = (base, layer, format) => `${base}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=`
  + `&FORMAT=${format}&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}`;

/**
 * Sources de photos aériennes, dans l'ordre de priorité (la France d'abord). `zone` : clé de SATELLITE_ZONES
 * (null : zone de la France, isInFrance). `attribution` : texte affiché sur la carte (contrôle MapLibre) et dans
 * Réglages › crédits. Aucune n'a de clé ; aucune tuile n'est mise en cache (sw-routing.js : autre origine = réseau).
 */
export const SATELLITE_SOURCES = Object.freeze([
  Object.freeze({
    id: 'ign', layer: 'ign-ortho', place: 'France', zone: null,
    tiles: IGN_ORTHO.tiles, tileSize: 256, minzoom: 2, maxzoom: 19, attribution: IGN_ORTHO.attribution,
    attributionText: '© IGN – Géoplateforme',
    licence: 'Licence Ouverte Etalab 2.0', licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
  }),
  // Luxembourg : BD-L-ORTHO, Administration du cadastre et de la topographie (ACT), WMTS opendata geoportail.lu.
  // https://data.public.lu/fr/datasets/bd-l-ortho-webservices-wms-et-wmts/ (lu le 23/11/2026, journal de l'Action
  // Textes officiels) : « Licence Creative Commons Zero (CC0) », producteur « Administration du cadastre et de la
  // topographie ». Tuile ortho_latest : HTTP 200 image/jpeg, access-control-allow-origin « * ».
  Object.freeze({
    id: 'lu', layer: 'sat-lu', place: 'Luxembourg', zone: 'LU',
    tiles: ['https://wmts.geoportail.lu/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg'],
    tileSize: 256, minzoom: 2, maxzoom: 19,
    attribution: '© ACT Luxembourg (BD-L-ORTHO, CC0)', attributionText: '© ACT Luxembourg (BD-L-ORTHO, CC0)',
    licence: 'CC0', licenceUrl: 'https://data.public.lu/fr/datasets/bd-l-ortho-webservices-wms-et-wmts/',
  }),
  // Belgique, Région de Bruxelles-Capitale : orthophotos UrbIS (Paradigm, ex-CIRB), WMS urbisgrid, couche « Ortho ».
  // GetCapabilities https://geoservices-grid.irisnet.be/geoserver/urbisgrid/ows?SERVICE=WMS&REQUEST=GetCapabilities
  // (lu le 23/11/2026, journal de l'Action Textes officiels) : « Creative Commons (CC-0) - no conditions for reuse,
  // the data is in the public domain », « No limitations to public access ». Tuile WMS EPSG:3857 : HTTP 200
  // image/jpeg, access-control-allow-origin « * ».
  Object.freeze({
    id: 'be-bru', layer: 'sat-be-bru', place: 'Bruxelles', zone: 'BE-BRU',
    tiles: [wms('https://geoservices-grid.irisnet.be/geoserver/urbisgrid/ows', 'Ortho', 'image/jpeg')],
    tileSize: 256, minzoom: 2, maxzoom: 20,
    attribution: '© Brussels UrbIS – Paradigm (CC0)', attributionText: '© Brussels UrbIS – Paradigm (CC0)',
    licence: 'CC0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode',
  }),
  // Suisse : swisstopo SWISSIMAGE, WMTS geo.admin.ch. Conditions générales de l'IFDG
  // https://www.geo.admin.ch/en/general-terms-of-use-fsdi (lues le 23/11/2026, journal de l'Action Textes
  // officiels) : « Use of the geoservices of the FSDI does not require registration and is free-of-charge. » ;
  // « The integration of geoservices in web applications with an average of 20,000 users per day … corresponds to fair
  // use. » ; source « © Data: swisstopo ». SWISSIMAGE (swisstopo.admin.ch, swissimage10) : centre des grands lacs en
  // images RapidEye, mention « Includes material © (2016-2018) Planet. All rights reserved ». Tuile : HTTP 200
  // image/jpeg, access-control-allow-origin « * ».
  Object.freeze({
    id: 'ch', layer: 'sat-ch', place: 'Suisse', zone: 'CH',
    tiles: ['https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg'],
    tileSize: 256, minzoom: 2, maxzoom: 19,
    attribution: '© Data: swisstopo ; Includes material © (2016-2018) Planet. All rights reserved',
    attributionText: '© Data: swisstopo ; Includes material © (2016-2018) Planet. All rights reserved',
    licence: 'Conditions de l\'IFDG (gratuit, sans inscription, usage raisonnable)',
    licenceUrl: 'https://www.geo.admin.ch/en/general-terms-of-use-fsdi',
  }),
  // Espagne : PNOA (Plan Nacional de Ortofotografía Aérea), IGN España, WMTS www.ign.es/wmts/pnoa-ma.
  // https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf et https://www.ign.es/web/ign/portal/info-aviso-legal
  // (lus le 23/11/2026, journal de l'Action Textes officiels) : usage « libre y gratuito, siempre que se mencione el
  // origen y propiedad de los datos » ; « licencia CC-BY 4.0 » ; services web : « siempre que se mencionen la autoría
  // y propiedad del IGN del siguiente modo: «© Instituto Geográfico Nacional de España» », mention visible « a pie de
  // mapa ». Tuile WMTS GoogleMapsCompatible : HTTP 200 image/jpeg, access-control-allow-origin « * ».
  Object.freeze({
    id: 'es', layer: 'sat-es', place: 'Espagne', zone: 'ES',
    tiles: ['https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&Format=image/jpeg'
      + '&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}'],
    tileSize: 256, minzoom: 2, maxzoom: 19,
    attribution: 'PNOA © Instituto Geográfico Nacional de España (CC BY 4.0 scne.es)',
    attributionText: 'PNOA © Instituto Geográfico Nacional de España (CC BY 4.0 scne.es)',
    licence: 'CC BY 4.0', licenceUrl: 'https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf',
  }),
  // Allemagne, Rhénanie-du-Nord-Westphalie : DOP Geobasis NRW, WMS wms_nw_dop. Conditions
  // https://www.bezreg-koeln.nrw.de/system/files/media/document/file/lizenzbedingungen_geobasis_nrw.pdf (lues le
  // 23/11/2026, journal de l'Action Textes officiels) : « Datenlizenz Deutschland – Zero » ; « Jede Nutzung ist ohne
  // Einschränkungen oder Bedingungen zulässig. » Tuile WMS EPSG:3857 : HTTP 200 image/jpeg,
  // access-control-allow-origin « https://timgo211.github.io ».
  Object.freeze({
    id: 'de-nw', layer: 'sat-de-nw', place: 'Rhénanie-du-Nord-Westphalie', zone: 'DE-NW',
    tiles: [wms('https://www.wms.nrw.de/geobasis/wms_nw_dop', 'nw_dop_rgb', 'image/jpeg')],
    tileSize: 256, minzoom: 2, maxzoom: 20,
    attribution: '© Geobasis NRW (dl-de/zero-2-0)', attributionText: '© Geobasis NRW (dl-de/zero-2-0)',
    licence: 'Datenlizenz Deutschland – Zero 2.0', licenceUrl: 'https://www.govdata.de/dl-de/zero-2-0',
  }),
  // Allemagne, Rhénanie-Palatinat : DOP20 LVermGeo RP, WMS rp_dop20. https://www.lvermgeo.rlp.de/geodaten-geoshop/open-data
  // (lu le 23/11/2026, journal de l'Action Textes officiels) : « Datenlizenz Deutschland – Namensnennung – Version 2.0
  // geldleistungsfrei zum Download und zur Online-Nutzung » ; mention « ©GeoBasis-DE / LVermGeoRP<Jahr des
  // Datenbezugs>, dl-de/by-2-0, www.lvermgeo.rlp.de ». Tuile WMS EPSG:3857 : HTTP 200 image/png,
  // access-control-allow-origin « * ».
  Object.freeze({
    id: 'de-rp', layer: 'sat-de-rp', place: 'Rhénanie-Palatinat', zone: 'DE-RP',
    tiles: [wms('https://geo4.service24.rlp.de/wms/rp_dop20.fcgi', 'rp_dop20', 'image/png')],
    tileSize: 256, minzoom: 2, maxzoom: 20,
    attribution: '©GeoBasis-DE / LVermGeoRP2026, dl-de/by-2-0, www.lvermgeo.rlp.de',
    attributionText: '©GeoBasis-DE / LVermGeoRP2026, dl-de/by-2-0, www.lvermgeo.rlp.de',
    licence: 'Datenlizenz Deutschland – Namensnennung 2.0', licenceUrl: 'https://www.govdata.de/dl-de/by-2-0',
  }),
  // v58 — Bade-Wurtemberg : DOP20 du LGL, WMS WMS_LGL-BW_ATKIS_DOP_20_C (couche IMAGES_DOP_20_RGB). GetCapabilities
  // (lu le 23/11/2026, journal de l'Action) : « Unentgeltliche Nutzung nach Open Data Lizenz. Es gelten die
  // Lizenzbedingungen „Datenlizenz Deutschland - Namensnennung - Version 2.0" […] Als Rechteinhaber und Bereitsteller
  // ist die Datenhaltende Stelle, sowie das Jahr des Datenbezugs in Klammern anzugeben. Beispiel für Quellenvermerk:
  // LGL-BW (2024) Datenlizenz Deutschland - Namensnennung - Version 2.0, www.lgl-bw.de » ; page
  // https://www.lgl-bw.de/Produkte/Open-Data/ (« Rechtliches » : dl-de/by-2-0, unentgeltlich). Tuile WMS 1.1.1
  // EPSG:3857 (chemin /owsproxy/ows/) : HTTP 200 image/jpeg, access-control-allow-origin « * » (la version 1.3.0 du
  // chemin /owsproxy/wms/ : 404).
  Object.freeze({
    id: 'de-bw', layer: 'sat-de-bw', place: 'Bade-Wurtemberg', zone: 'DE-BW',
    tiles: [wms111('https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C', 'IMAGES_DOP_20_RGB', 'image/jpeg')],
    tileSize: 256, minzoom: 2, maxzoom: 20,
    attribution: 'LGL-BW (2026) Datenlizenz Deutschland – Namensnennung – Version 2.0, www.lgl-bw.de',
    attributionText: 'LGL-BW (2026) Datenlizenz Deutschland – Namensnennung – Version 2.0, www.lgl-bw.de',
    licence: 'Datenlizenz Deutschland – Namensnennung 2.0', licenceUrl: 'https://www.govdata.de/dl-de/by-2-0',
  }),
  // v58 — Bavière : DOP20 de la Bayerische Vermessungsverwaltung (LDBV), WMS open data dop20 (couche by_dop20c).
  // GetCapabilities (lu le 23/11/2026, journal de l'Action) : « <Fees>kostenfrei</Fees> », « <AccessConstraints>CC BY 4.0
  // vgl. https://creativecommons.org/licenses/by/4.0/deed.de</AccessConstraints> », mots-clés « kostenfrei »,
  // « opendata ». Tuile WMS EPSG:3857 : HTTP 200 image/jpeg, access-control-allow-origin « https://timgo211.github.io ».
  Object.freeze({
    id: 'de-by', layer: 'sat-de-by', place: 'Bavière', zone: 'DE-BY',
    tiles: [wms('https://geoservices.bayern.de/od/wms/dop/v1/dop20', 'by_dop20c', 'image/jpeg')],
    tileSize: 256, minzoom: 2, maxzoom: 20,
    attribution: '© Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (CC BY 4.0)',
    attributionText: '© Bayerische Vermessungsverwaltung – www.geodaten.bayern.de (CC BY 4.0)',
    licence: 'Creative Commons BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/deed.de',
  }),
  // v58 — Hesse : DOP20 de la HVBG, WMS ogc-free-images (couche he_dop20_rgb). Conditions de la HVBG (gds.hessen.de,
  // « Nutzungsbedingungen », Stand 24.08.2026, lu le 23/11/2026, journal de l'Action) : « Mit dem Gesetz über die
  // Bereitstellung offener Geobasisdaten vom 30. September 2021 werden die Geobasisdaten der HVBG […] unter
  // OpenData-Grundsätzen bereitgestellt. Damit ist jede Nutzung dieser Daten ohne Einschränkung oder Bedingung
  // erlaubt » (§ 18 HVGG) ; GetCapabilities : « Geobasisdaten © Hessische Verwaltung für Bodenmanagement und
  // Geoinformation ». Tuile WMS EPSG:3857 : HTTP 200 image/jpeg, access-control-allow-origin « * ».
  Object.freeze({
    id: 'de-he', layer: 'sat-de-he', place: 'Hesse', zone: 'DE-HE',
    tiles: [wms('https://www.gds-srv.hessen.de/cgi-bin/lika-services/ogc-free-images.ows', 'he_dop20_rgb', 'image/jpeg')],
    tileSize: 256, minzoom: 2, maxzoom: 20,
    attribution: 'Geobasisdaten © Hessische Verwaltung für Bodenmanagement und Geoinformation',
    attributionText: 'Geobasisdaten © Hessische Verwaltung für Bodenmanagement und Geoinformation',
    licence: 'Open Data Hessen (§ 18 HVGG, nutzung ohne Bedingung)', licenceUrl: 'https://gds.hessen.de/',
  }),
]);
/** Date de lecture des conditions de toutes les sources étrangères (phase 7d). */
export const SATELLITE_READ = READ_ON;

/**
 * France métropolitaine, contour simplifié (lon, lat), un peu large sur la mer, au plus près des frontières terrestres
 * (Belgique, Luxembourg, Allemagne, Suisse, Italie, Espagne ; Andorre et les îles Anglo-Normandes laissées dehors).
 * Approximation à quelques kilomètres près le long des frontières.
 */
const METROPOLE = [
  [2.55, 51.09], [2.63, 50.95], [2.6, 50.82], [2.87, 50.7], [3.15, 50.78], [3.3, 50.52], [3.65, 50.36], [4.05, 50.34], [4.2, 50.1],
  [4.68, 49.99], [4.8, 50.15], [4.88, 50.12], [4.86, 49.8], [5.4, 49.62], [5.8, 49.55], [6.15, 49.47],
  [6.37, 49.46], [6.6, 49.2], [6.85, 49.17], [7.1, 49.13], [7.5, 49.06], [8.2, 48.97], [7.83, 48.6],
  [7.57, 48.1], [7.55, 47.58], [7.3, 47.44], [6.95, 47.48], [6.95, 47.25], [6.65, 47.0], [6.4, 46.75],
  [6.1, 46.4], [5.96, 46.2], [6.0, 46.13], [6.2, 46.15], [6.3, 46.25], [6.8, 46.4], [6.8, 46.12], [7.03, 45.92], [6.8, 45.68],
  [7.1, 45.46], [6.88, 45.13], [6.62, 45.1], [6.98, 44.83], [6.85, 44.5], [7.0, 44.22], [7.67, 44.15],
  [7.55, 43.78], [7.6, 43.5], [6.5, 42.9], [4.5, 43.2], [3.3, 42.8], [3.3, 42.42], [2.6, 42.33],
  [1.79, 42.36], [1.8, 42.62], [1.44, 42.7], [0.7, 42.8], [-0.3, 42.78], [-1.4, 43.03], [-1.8, 43.35],
  [-2.0, 43.6], [-1.5, 45.0], [-1.8, 46.0], [-2.6, 46.8], [-3.4, 47.2], [-5.0, 47.7], [-5.3, 48.5],
  [-4.0, 48.95], [-2.5, 48.75], [-1.75, 48.72], [-1.68, 49.2], [-2.05, 49.75], [-1.2, 49.8], [-0.2, 49.4],
  [0.0, 49.75], [1.1, 50.05], [1.5, 50.9], [1.85, 51.1], [2.4, 51.15],
];

/** Corse, outre-mer et collectivités couverts par la BD ORTHO (cadres [ouest, sud, est, nord]). */
const BOXES = [
  [8.4, 41.3, 9.7, 43.1], // Corse
  [-61.95, 15.75, -60.9, 16.6], // Guadeloupe
  [-61.3, 14.35, -60.7, 14.9], // Martinique
  [-54.8, 2.0, -51.5, 6.0], // Guyane
  [55.1, -21.5, 55.95, -20.8], // La Réunion
  [44.9, -13.1, 45.35, -12.6], // Mayotte
  [-56.5, 46.7, -56.0, 47.2], // Saint-Pierre-et-Miquelon
  [-63.2, 17.85, -62.78, 18.13], // Saint-Martin, Saint-Barthélemy
];

/** Point dans un polygone (lancer de rayon). */
function inPolygon([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point dans une zone de SATELLITE_ZONES : un des polygones, hors de ses trous. */
function inZone([lon, lat], polygons) {
  return (polygons ?? []).some(([outer, ...holes]) => inPolygon([lon, lat], outer) && !holes.some((h) => inPolygon([lon, lat], h)));
}

/**
 * Source de photos à ce point (phase 7d) : la première du registre dont la zone le contient (France d'abord), sinon
 * null (plan et message).
 */
export function satelliteSourceAt(lonlat) {
  if (!Array.isArray(lonlat) || lonlat.length < 2 || !Number.isFinite(lonlat[0]) || !Number.isFinite(lonlat[1])) return null;
  return SATELLITE_SOURCES.find((src) => (src.zone === null ? isInFrance(lonlat) : inZone(lonlat, SATELLITE_ZONES[src.zone]))) ?? null;
}

/** Crédits des photos pour Réglages : « Lieu : attribution — licence ». */
export function satelliteCredits() {
  return SATELLITE_SOURCES.map((src) => ({ id: src.id, text: `${src.place} : ${src.attributionText} — ${src.licence}`, url: src.licenceUrl }));
}

/** Vrai si le point [lon, lat] est dans la zone couverte par les photos aériennes IGN. */
export function isInFrance(lonlat) {
  if (!Array.isArray(lonlat) || lonlat.length < 2) return false;
  const [lon, lat] = lonlat;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  if (BOXES.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n)) return true;
  return inPolygon([lon, lat], METROPOLE);
}

/** Vrai si le point [lon, lat] est en France métropolitaine (continent et Corse, même contour approximatif). */
export function isInMetropole(lonlat) {
  if (!Array.isArray(lonlat) || lonlat.length < 2) return false;
  const [lon, lat] = lonlat;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  const [w, s, e, n] = BOXES[0];
  if (lon >= w && lon <= e && lat >= s && lat <= n) return true;
  return inPolygon([lon, lat], METROPOLE);
}

/** Couche mémorisée lisible, sinon le plan. */
export function sanitizeMapLayer(x) {
  return MAP_LAYERS.includes(x) ? x : DEFAULT_MAP_LAYER;
}

/**
 * Phase 7c : le guidage démarre toujours en plan (lisibilité) ; un bouton passe en satellite pour ce guidage
 * seulement (choix non mémorisé, le choix à l'arrêt `settings.mapLayer` ne change pas).
 */
export const GUIDANCE_START_LAYER = 'plan';

/**
 * Ce que la carte doit montrer. Satellite hors de toute source codée : plan + message ; le choix reste et les photos
 * reviennent quand la carte revient au-dessus d'une zone couverte. `source` : id de la source (phase 7d) choisie
 * d'après le centre de la carte. `button` : boutons « Plan / Satellite » de l'arrêt (en guidage, l'écran de guidage a
 * son propre bouton).
 * @param {{ layer:string, center:number[]|null, navigating?:boolean }} p
 * @returns {{ photos:boolean, message:string, button:boolean, source:string|null }}
 */
export function satelliteView({ layer, center, navigating = false }) {
  const satellite = sanitizeMapLayer(layer) === 'satellite';
  const src = satellite ? satelliteSourceAt(center) : null;
  return {
    photos: !!src,
    message: satellite && !src ? SATELLITE_OUTSIDE_TEXT : '',
    button: !navigating,
    source: src?.id ?? null,
  };
}

/** Bouton du guidage : il propose l'autre couche. */
export function guidanceLayerButton(layer) {
  return sanitizeMapLayer(layer) === 'satellite'
    ? { next: 'plan', text: '🗺 Plan', label: 'Passer en plan' }
    : { next: 'satellite', text: '🛰 Satellite', label: 'Passer en vue satellite' };
}

/**
 * Changement de fond (thème jour / nuit) : MapLibre compare l'ancien et le nouveau style (setStyle en « diff ») et
 * retire tout ce qui n'est pas dans le nouveau, sans émettre « style.load ». Cette fonction (option transformStyle de
 * setStyle, MapLibre ≥ 3) recopie nos couches dans le nouveau style : `below` sous le premier libellé (photos IGN),
 * `above` tout en haut (tracés), avec leurs sources et, si donnée, une nouvelle peinture (couleurs du thème).
 * @param {{ sources?:object, layers?:object[] }|undefined} prev style sérialisé en cours
 * @param {{ sources?:object, layers?:object[] }} next nouveau style
 * @param {{ below?:string[], above?:string[], paint?:Object<string,object> }} opts
 */
export function carryOverlay(prev, next, { below = [], above = [], paint = {} } = {}) {
  const prevLayers = Array.isArray(prev?.layers) ? prev.layers : [];
  const ours = new Set([...below, ...above]);
  const pick = (ids) => ids
    .map((id) => prevLayers.find((l) => l.id === id))
    .filter(Boolean)
    .map((l) => (paint[l.id] ? { ...l, paint: { ...l.paint, ...paint[l.id] } } : l));
  const lower = pick(below);
  const upper = pick(above);
  const layers = (Array.isArray(next?.layers) ? next.layers : []).filter((l) => !ours.has(l.id));
  const sources = { ...(next?.sources ?? {}) };
  for (const l of [...lower, ...upper]) {
    if (l.source && !sources[l.source] && prev?.sources?.[l.source]) sources[l.source] = prev.sources[l.source];
  }
  let at = layers.findIndex((l) => l.type === 'symbol');
  if (at < 0) at = layers.length;
  layers.splice(at, 0, ...lower);
  layers.push(...upper);
  return { ...next, sources, layers };
}
