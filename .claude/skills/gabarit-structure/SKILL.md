---
name: gabarit-structure
description: Carte détaillée des fichiers de Gabarit : rôle de chaque module de src/lib et src/ui, tests et fixtures, outils et Actions GitHub de mise à jour des données. À lire pour trouver où se trouve une logique, une fixture ou une Action.
---

# Structure détaillée

(Texte déplacé tel quel depuis CLAUDE.md.)

- `index.html`, `manifest.webmanifest`, `sw.js` (service worker module), `icons/`
- `src/lib/` : logique pure, sans DOM, testable sous Node (requêtes ORS, lecture des réponses, erreurs, profils, stockage)
  - guidage : `nav-geo.js` (cap, projection sur le tracé), `nav-guidance.js` (manœuvres, paliers d'annonce, phrases,
    pictos, voix fr), `navigation.js` (moteur : `updateNavigation(state, fix)` → `{ state, view, events }`, seuils dans `NAV`),
    `nav-sim.js` (fausse position GPS pour la simulation)
  - itinéraires proposés : `route-options.js` (Recommandé + `alternative_routes` ou variantes, budget de requêtes,
    doublons, noms, écarts, textes des fiches, tracé touché sur la carte)
  - phase 7 : `map-layers.js` (Plan / Satellite IGN, zone France, guidage démarré en plan, `carryOverlay` au changement
    de thème ; phase 7d : registre `SATELLITE_SOURCES` des orthophotos voisines, `satelliteSourceAt`, `satelliteCredits`),
    `satellite-zones.js` (7d, généré par `tools/satellite-zones.mjs` depuis Natural Earth, domaine public : zones LU,
    BE-BRU, CH, ES, DE-NW, DE-RP), `share.js` (lien d'itinéraire dans le #, validation des liens reçus, GPX 1.1, lien OpenStreetMap, choix
    partage / copie / téléchargement, guide d'installation `INSTALL_STEPS`)
  - phase 7c : `prefs.js` (couleur de la flèche, vitesse / volume / nom de la voix), `nav-anim.js` (interpolation de la
    flèche entre deux positions GPS) ; nom de la route (`currentRoadName`) et `overviewBbox` (vue d'ensemble)
  - phase 2c-a : `contrast.js` (contraste WCAG, variables CSS lues par `tests/contrast.test.js`), `map-palette.js`
    (fond de carte recoloré jour/nuit, largeurs du tracé ; fixtures `style-liberty-layers.json`, `style-dark-layers.json`)
  - phase 2c : `nav-layout.js` (écran de guidage : alertes et leur ordre, « à l'arrêt », caméra `followPadding`, colonne
    de boutons, compteur, texte du bandeau, partie parcourue), `road-badge.js` (badges D/N/A/E des références de route),
    `sun.js` (lever / coucher du soleil, NOAA ; mode nuit auto par `theme.js`), `map-palette.js` (bulles des noms de
    rues, photos assombries la nuit)
  - phase 2d : `areas-route.js` (liste du guidage : `LIST_COUNT`, `areaRowsPlan`, `AREA_LIST`), `nav-layout.js`
    (`areaListBox`), `map-palette.js` (nuit Sombre / Normal / Clair : `NIGHT_PALETTES`, `NIGHT_BUBBLES`,
    `SATELLITE_NIGHT_BRIGHTNESS`, `sanitizeNightLevel` ; réglage `settings.nightMapLevel` de `store.js`)
  - phase 5e : `weights.js` (PTAC > 40 t sur un trajet international : alerte avant le départ, transport combiné) ;
    poids total maximal national et hauteur maximale des pays (bloc `limits` de `data/pays/*.json`, `country-rules.js`)
  - phase 5f : `winter.js` (communes de `data/hiver/` coupées exactement par le tracé, période 1er novembre – 31 mars,
    consigne selon la remorque), `winter-convert.js` (liste Sécurité routière + contours → `data/hiver/`) ; UI
    `src/ui/winter.js` ; bloc `winter` des fiches pays
  - phase 5g : `euro.js` (classe Euro du profil : tunnels du Mont-Blanc et du Fréjus par les tubes de `KNOWN_TUNNELS`,
    statuts confirmé / exploitant / à vérifier, tableau EEV `EURO_EEV`, lignes « Normes Euro » des fiches pays, bloc
    `euro` de `data/pays/*.json`)
  - phase 5h : `hgv-tolls.js` (taxes PL régionales de `data/taxes-pl.json` : R-Pass, écocontribution Grand Est ;
    références de route dans le cadre de la région, heure de passage, statuts confirmé / annoncé / à vérifier, taux
    de la grille officielle pour la classe du profil) ; lignes « Changements au 1er janvier 2027 » des fiches pays
  - phase 2g : `road-class.js` (extras `waycategory` + `waytype` d'ORS et référence de l'étape → classe A / N / autre
    par tronçon, km inconnus, part A/N, `ROUTE_PREF`, `pickRecommendedIndex`) ; `promoteRecommended` dans
    `route-options.js` (« Recommandé » / « Préférence ORS ») ; fixtures `ors-directions-an-alternatives.json`
    (Besançon → Belfort : D 683, A 36 + N 1019, N 57 + D 9) et `ors-directions-an-unnamed.json` (étapes sans nom),
    écrites d'après la doc ORS (extra-info waycategory.md, waytype.md)
  - phase 12a : `bridges-convert.js` (Action : ponts bridge=yes|viaduct routes et rail, layer ≥ 1 ou absent, hors
    piétons / cycles, ≥ 6 m ; tronçons maxheight ; cases de 1° `data/ponts-osm/`, limites 5 Mo / 60 Mo, France seule),
    `bridge-check.js` (appli : cases lues, croisement en X avec le tracé, point de croisement exposé, hauteur connue
    dessous à 40 m, classe de la route dessous, textes, `bridgeRules`) ; UI `src/ui/bridges.js` (cases du trajet comme
    `access.js`) ; fixtures `osm-ponts-colombier.geojsonseq` et `ors-directions-colombier.json` (**synthétiques** :
    api.openstreetmap.org bloqué ; id 243477938 du constat)
  - phase 11a : `speed-convert.js` (Action : voies motorway à tertiary et bretelles avec `maxspeed:hgv` / `maxspeed`
    en km/h, sens → la plus basse, drapeau conditions, voies mises bout à bout, `data/vitesses-osm/` mêmes cases que
    les ponts, 5 Mo / 40 Mo, 3 → 8 → 20 m, puis copie réduite, sinon rien), `speed-rules.js` (règles générales PL :
    `FR_SPEED_RULES` vérifiées sur le Code de la route ou vides ; autres pays : `speeds.bands` des fiches ; voie rapide
    = la plus basse), `speed-limit.js` (appli : intervalles le long du tracé, 5 m, 15 m, cap modulo 180°, voie la plus
    proche puis la plus basse, `limitAt` à curseur, couverture, `speedRules` : ligne de fiche et ligne technique) ; UI
    `src/ui/speed-limits.js` (`createTileCopy`) ; moteur : `startNavigation({ speeds })`, `setNavigationSpeeds`,
    `view.speedLimit` / `speedLimitSource` ; fixture **synthétique** `osm-vitesses-colombier.geojsonseq` ; tests
    `tests/speed.test.js`
  - phase 11b : `directions-convert.js` (Action : bretelles `motorway_link` / `trunk_link` avec `destination` ou
    `destination:ref`, `;` → « , », `destination:lanes` seule ignorée, oneway=-1 retourné, oneway=no → deux sens,
    300 premiers mètres, `data/directions-osm/` mêmes cases, 5 Mo / 40 Mo), `directions.js` (appli :
    `directionsForManeuvers` — 60 m du point de manœuvre, cap du tracé sur 30 m, ≤ 30° — une seule bretelle →
    complément, `speak` si aucune autre bretelle à 60 m ; `withDirections`) ; `prepareRoute(route, directions)`,
    `setNavigationDirections` ; UI `src/ui/directions.js` ; fixtures **synthétiques** `ors-directions-sortie.json`,
    `osm-directions-sortie.geojsonseq` ; tests `tests/directions.test.js` ; v53 : sorties (nœuds `motorway_junction`
    ref / name, `junction:ref` et `exit_to` des bretelles, champs `j` et `e` des cases, `exitOfLink`, `exitText`),
    fixture **synthétique** `osm-sorties.geojsonseq`
  - phases 11d et 11c, données (PR A, v59) : `lanes-convert.js` (Action : `turn:lanes` + `lanes` à sens unique,
    motorway / motorway_link sens unique implicite, `turn:lanes:forward|backward` + `lanes:forward|backward` à double
    sens, backward retourné ; nombre de valeurs = nombre de voies exigé ; refus comptés par motif : rond-point,
    oneway=-1, sans suffixe à double sens, lanes absent, nombre ≠, `none` / vide (compteur à part), valeur inconnue ;
    v63 : `none` / vide gardé sur motorway / motorway_link (`LANES.NONE_HIGHWAYS`, valeur « none », `none` = nombre de
    voies sans flèche), toutes `none` → motif `allnone` ; journal avant / après (`laneSkipLog(skips, kept)`) ;
    200 derniers mètres avant le carrefour, `data/voies-osm/` cases `{ t, v:[[i_turn, n, x0, y0, dx, dy…]] }`, 5 Mo /
    40 Mo, plafond du volume lu 1 Go) ; `places-convert.js` (nœuds `place=city|town|village` avec `name`,
    `data/lieux-osm/` cases `{ t, p:[[i_nom, rang, x, y]] }`, 5 Mo / 40 Mo, plafond lu 256 Mo) ; fixtures
    **synthétiques** `osm-voies.geojsonseq` (autoroute vers le point 20 de `ors-directions-sortie.json`),
    `osm-lieux.geojsonseq` ; tests `tests/lanes-convert.test.js`, `tests/places-convert.test.js`. Lecture dans
    l'appli : PR B (11c, « vers X », jamais dit) et PR C (11d, pictogrammes sous « Puis », jamais dits)
  - phase 11c, appli (v60) : `places.js` (`parsePlaceTile`, `mergePlaceTiles`, `placesAlongRoute` — cases de 0,02°,
    projection sur chaque segment —, `placesForManeuvers`, `withPlaces`) ; `prepareRoute(route, directions, places)`,
    `setNavigationPlaces`, `placesData` de l'état ; `maneuverText` ajoute « , vers X » si `!spoken` ; `bannerText` :
    consigne entière si `place` ; UI `src/ui/places.js` (`createTileCopy`) ; tests `tests/places.test.js`, fixture
    **synthétique** `osm-lieux-sortie.geojsonseq` (lieux le long de `ors-directions-sortie.json`) ; ui-check
    `directions` : cas lieux `fixture` / `egalite` / absente
  - phase 11d, appli (v61) : `lanes.js` (`parseLaneTile` revérifie n = nombre de valeurs, `mergeLaneTiles`, `lanesFor`
    — `VALID_TURNS` par type ORS —, `lanesForManeuvers` — `indexLinks` / `linksNear` exportés de `directions.js` —,
    `withLanes`, `lanesRow` 1 km) ; `prepareRoute(route, directions, places, lanes)`, `setNavigationLanes` ; UI
    `src/ui/lanes.js`, `src/ui/lane-icons.js` (dessin maison) ; tests `tests/lanes.test.js` (fixture `osm-voies.geojsonseq`,
    w7001 finit au point 20 de `ors-directions-sortie.json`) ; ui-check `voies`
  - v53 : `route-save.js` (mémoire de l'itinéraire : `buildSave`, `checkSave`, `shouldSave`, `restoredChoice`,
    `withoutSecrets`), UI `src/ui/route-save.js` (IndexedDB), `resumeNavigation` de `navigation.js` ; tests
    `tests/route-save.test.js`, `tests/route-store.test.js` (faux IndexedDB : absent, refusé, bloqué, plein) ; `src/ui/route-arrows.js` (chevrons et pastilles de manœuvre), `maneuverMarks`,
    `roadPillBox`, `exitLine` de `nav-layout.js`
  - phase 12a bis : `weight-convert.js` (Action : voies maxweight / maxweight:hgv en tonnes, drapeau desserte
    hgv=destination|delivery ou maxweight:conditional, mêmes filtrage osmium et cases de 1° que les ponts,
    `data/poids-osm/`, 5 Mo / 30 Mo, simplification 3 → 8 → 20 m si trop gros, chemin 190520091 écrit dans le journal),
    `weight-check.js` (appli : tronçons suivis par le tracé — points tous les 5 m, 15 m, cap modulo 180°, projection
    sur le segment, 25 m ou 60 % d'un tronçon court — limite < PTAC, textes, `weightRules`) ; UI
    `src/ui/weight-limits.js` (`createTileCopy` de `src/ui/bridges.js`) ; repères `.weight-marker` (« 3,5 t ») par
    `map.showBridges` ; « Éviter ce passage » → `fromWeight` (restriction poids, origine `osm-weight`) ; fixture
    `osm-poids-colombier.geojsonseq` (**synthétique** : étiquettes réelles du chemin 190520091 non lisibles depuis le
    conteneur)
  - phase 12b : `restrictions.js` (Mes restrictions : modèle, validation, doublons à 5 m, `applies`, polygones de
    30 m, zone du trajet, limite des 150 km, `mergeAvoid`, textes, `fromBridge` au point de croisement) ; UI
    `src/ui/restrictions.js` (Réglages › Mes restrictions, panneau `#bridge-panel`) ; `withBlockedHint` dans
    `route-options.js` (échec avec restrictions → phrase au conditionnel)
  - phase 4 : `fuel-stations.js` (carburant : `routeBoxes` (tronçons de 20 km, 60 boîtes au plus, élargies de 2 km,
    France seulement d'après `route.countries`), `fuelQueryUrl` (une requête `/exports/json`, `in_bbox`), `parseStations`,
    `stationsAlongRoute` (≤ 2 km, devant la position en guidage), `describeStation` (« ancien » > 48 h, détour à vol
    d'oiseau), `tripFuelCost`, `sanitizeFuelStations` / `toggleFuelStation` (champ `fuelStations` de `gabarit.data`),
    `lazyLoader`) ; URL `FUEL_API` de `config.js` ; UI `src/ui/fuel.js` (panneau `#fuel-panel`, chargé par `import()`,
    hors `APP_FILES` : `LAZY_APP_FILES` de `sw-routing.js`, bypass) ; boutons `#btn-fuel` (fiche) et `#btn-nav-fuel`
    (rangée de la loupe) ; tests `tests/fuel-stations.test.js`, fixture `carburants-v2.json` (forme réelle de l'export
    lue par l'Action « Textes officiels » le 23/11/2026, valeurs **synthétiques**) ; ui-check `carburant`
  - v55 (étapes, reste de la phase 8) : `stops.js` (`STOPS.MAX` = 10, `sanitizeStops`, `moveStop`, `removeStop`,
    `insertStopByRoute` (rang selon la projection sur le tracé), `crowPath` (somme des distances à vol d'oiseau, mesure
    d'ORS), `legLines` (fiche)) ; `route.legs` / `route.wayPoints` lus par `ors-response.js` ; `via` de
    `computeRouteOptions` / `computeAvoidRoute` / `fetchRoute` ; `diagnoseWithStops` (2009) ; `placeStops`,
    `remainingStops`, `STOP_REACHED_TEXT` (navigation) ; `pathCrow` (`zfe.js`) pour les 150 km ; champs `choice.stops`
    et `progress.nextStop` de `route-save.js` ; UI : lignes `#stops-list` de `route-form.js` (`attachAutocomplete`
    exporté), `showStops` de `map.js` (`.stop-marker`), « Ajouter comme étape » de `fuel.js` (`onAddStop`), champ
    `#alts-stop-input` de « Autres itinéraires » ; tests `tests/stops.test.js`, fixture `ors-directions-etapes.json`
    (itinéraire de `ors-directions-nav.json` coupé en deux tronçons, way_points [0, 14, 33]) ; ui-check `etapes`
  - v62 : `legLines` → une ligne `{ title, detail }` par tronçon, `nextStopLine` (ligne `#nav-stop` du guidage) dans
    `stops.js` ; `area-cluster.js` (P selon le zoom, `clusterAreas`, `drawAreas` de `map.js` sur `moveend`,
    `areaDrawCount`) ; `suggest.js` (`createSuggester` : 400 ms, annulation, lignes, états « Aucun résultat » /
    « Pas de connexion » / plafond), `geocode-quota.js` (`createGeocodeBudget` : `gabarit.geocodeCount`, minute en
    mémoire ; `createTextCache` : 20 textes en mémoire), `place-resolve.js` (texte validé sans choix → `/search`) ;
    `attachAutocomplete` de `route-form.js` renvoie `{ resolve }`, `keyboardState` (classe `.app.kbd-open`, `--vvh`) ;
    poignée `#btn-panel-grip` / `#panel-body` (app.js, `settings.panelCollapsed`) ; `parseAutocomplete` → `name`,
    `place` ; `buildAutocompleteUrl({ endpoint: 'search' })` ; tests `tests/area-cluster.test.js`,
    `tests/suggest.test.js`, fixtures `ors-directions-2-etapes.json` (254 km, épingle de 80 km, 100 km),
    `pelias-suggest-5.json`, `pelias-suggest-vide.json`, `pelias-homonymes.json`, `pelias-sans-code.json` (valeurs
    synthétiques, champs de la doc Pelias) ; `homonymDetails` (`suggest.js`) ; ui-check `preparation`, `suggestions`
  - v63 : `recent-places.js` (recherches récentes : `addRecent`, `matchRecent`, `samePlace`, `createRecentStore`
    sur la clé localStorage `gabarit.recentPlaces`, jamais bloquant) ; tests `tests/recent-places.test.js`.
  - phase 6 (v56) : `trip-history.js` (historique : `buildTrip` à l'arrivée seulement, jamais en simulation, aucune
    coordonnée (`safeLabel`), `sanitizeHistory` (1 000 au plus), `mergeHistory`, `monthlyStats`, `describeTrip`),
    IndexedDB `src/ui/trip-history.js` (base `gabarit-history`, magasin `trips`, clé `list`, jamais bloquant),
    Réglages › Historique `src/ui/history.js` (`#history-card`, relevé `#history-print` + `@media print`,
    `body.printing-history`) ; km et début du trajet dans l'état du guidage (`drivenBefore`, `tripStartedAt`,
    `stopsDone`, `tripSoFar`, `carry` de « Autres itinéraires ») ; export `exportData(data, now, history)` /
    `readExport` (`store.js`) ; `area-notes.js` (notes d'aires, `areaNotes`) ; tests `tests/trip-history.test.js` ;
    ui-check `historique`
  - v57 : `ambiguous` de `wayLimit` / `speedLimitsAlongRoute` / `limitAt` (`speed-limit.js`), `overRule` de
    `speedStatus` (`nav-layout.js`) ; tests `tests/speed-ambiguous.test.js` ; ui-check `limites`
  - phase 5h bis : `route-diagnostic.js` (texte de diagnostic du trajet à copier depuis la fiche)
  - phase 5h ter : `hgv-tolls-geo.js` (réseau des taxes PL en géométrie : périmètre, copie `data/taxes-pl-osm.json`,
    comparaison au tracé), `hgv-tolls-convert.js` (voies OSM → `data/taxes-pl-osm.json`, journal par référence)
  - phase 8 : `coords.js` (coordonnées GPS saisies : décimal et degrés-minutes-secondes)
  - phase 5 (réglementation) : `zfe.js` (ZFE : lecture de `data/zfe.json`, vignette, horaires, passage du tracé,
    polygones à éviter, guidage), `zfe-convert.js` (BNZFE → `data/zfe.json`), `holidays.js` (jours fériés),
    `hgv-bans.js` (interdictions PL week-ends / jours fériés, calendrier annuel, Île-de-France, guidage),
    `route-samples.js` (points du tracé avec heure de passage et route), `route-rules.js` (réunit le tout pour les fiches),
    `driving-time.js` (temps de conduite et pauses, CE 561/2006), `wind.js` (vent fort, Open-Meteo)
  - phase 5c (frontières) : `countries.js` (extra `countryinfo` d'ORS → pays traversés, km et heure des frontières),
    `country-rules.js` (lecture de `data/pays/*.json`, vitesses selon le PTAC, interdictions « en vigueur à votre
    passage ? », fiches, bandeau et voix du guidage) ; jours fériés des pays voisins dans `holidays.js`
  - phase 5b (ADR) : `adr.js` (code tunnel du véhicule, catégorie OSM, ADR 8.6.4, tunnels en dur, passage du tracé,
    textes, guidage, « Éviter le tunnel »), `adr-settings.js` (réglage global `settings.adr` : classes en clair, code
    tunnel saisi, reprise des anciens profils, `withAdr`), `tunnels-convert.js` (extraits Geofabrik filtrés par osmium dans l'Action → `data/tunnels-adr.json`)
  - phase 5d (accès) : `access-local.js` (extra `roadaccessrestrictions` d'ORS → routes « sauf desserte », acceptées
    près du départ ou de l'arrivée, « Éviter la desserte locale »), `access-conditional.js` (étiquettes `*:conditional`,
    priorité, rapprochement avec le tracé, heure de passage, textes, guidage), `access-convert.js` (export osmium →
    `data/acces-osm/`)
  - phase 9 (aires et parkings PL) : `areas-osm.js` (requête Overpass, serveurs, lecture), `areas-official.js` (jeu
    officiel : lecture xlsx/ods, colonnes par mots-clés, Lambert 93, `data/aires-pl.json`), `areas-route.js` (fusion,
    placement sur le tracé, côté, prochaines aires, annonce, textes), `areas-avis.js` (« Mon avis »), `areas-cache.js`
  - phase 9b (aires sur les longs trajets) : `areas-osm-data.js` (copie `data/aires-osm/` : export osmium → aires,
    contours `.poly` → zone couverte, cases de 1°, `routePlan` : cases touchées et morceaux hors copie)
- `src/ui/` : interface (DOM, MapLibre, fetch) ; `src/app.js` assemble le tout
  - `navigation.js` (écran de guidage : GPS ou simulation → moteur → voix/carte ; disposition `layoutGuidance`, phase 2c),
    `voice.js`, `wake-lock.js`, `nav-icon.js` (flèches de manœuvre maison), `nav-symbols.js` (pictogrammes Material
    Symbols, Apache 2.0), `vehicle-icon.js` (repère du véhicule, registre d'icônes)
  - `layer-switch.js` (boutons Plan / Satellite à l'arrêt), `share.js` (fenêtre « Partager »)
  - `areas.js` (aires du trajet : copie `data/aires-osm/`, Overpass hors copie, liste, repères HTML sur la carte, fiche et
    « Mon avis »)
  - `access.js` (cases `data/acces-osm/` du trajet, 'failed' si index ou case illisible)
  - `weather.js` (une requête Open-Meteo par calcul, copie sur l'appareil, « Météo indisponible »)
  - `map.js` : flèche animée (`navigateTo`, boucle requestAnimationFrame arrêtée à la fin de chaque interpolation ;
    à l'arrêt < 3 km/h, dérive < 100 m, même suivi et mêmes marges : aucune image, `holdStill` — sinon MapLibre
    remet à jour chaque repère d'aire à chaque position : 144 images pour 8 positions en v20),
    vue d'ensemble, appui long (600 ms, ou clic droit) → panneau « Aller ici / Partir d'ici » (`app.js`)
- `tests/` : `*.test.js` + `fixtures/` (réponses ORS/Pelias écrites d'après la doc ; `ors-directions-nav.json` et
  `ors-directions-uturn.json` reprennent les textes français d'ORS `ors_fr-FR.resources` ;
  `ors-directions-alternatives.json` = 3 itinéraires, `ors-variant-*.json` = variantes, Recommandé et Plus court identiques)
- `tools/ui-check.mjs` : vérification de l'interface dans Chromium (voir « Tester »)
- `tools/satellite-zones.mjs` (7d) : zones des photos aériennes hors de France (`src/lib/satellite-zones.js`) depuis les
  GeoJSON Natural Earth 1:10m (raw.githubusercontent.com/nvkelso/natural-earth-vector, joignable du conteneur), lancé à
  la main avec les ID des sources codées ; simplification ~300 m.
- `tools/textes-officiels.mjs` : entrées `tiles` (7d) : tuile réelle demandée avec `Origin: https://timgo211.github.io`,
  journal : statut, type, taille, `access-control-allow-origin` → UTILISABLE / NON UTILISABLE ; champ `run` du JSON :
  entrées lues (toutes si absent).
- `tools/aires-pl-update.mjs` + `.github/workflows/aires-pl.yml` : copie hebdomadaire du jeu officiel des aires PL
  dans `data/aires-pl.json` (lançable à la main ; fichiers locaux en arguments pour essayer)
- `tools/osm-update.mjs` + `.github/workflows/osm-data.yml` (Action « Données OSM (tunnels ADR, aires PL, accès) ») :
  copie mensuelle (le 1er, 3 h 17 UTC) des tunnels signalés aux matières dangereuses (`data/tunnels-adr.json`), des
  aires et parkings PL (`data/aires-osm/`) et des voies à accès conditionnel (`data/acces-osm/`) ; par pays, un seul
  téléchargement Geofabrik, un seul `osmium tags-filter` (tunnels + aires + voies), un seul export lu ligne à ligne ;
  un pays en échec → rien d'écrit ; job à part `known` : recoupement Fourvière / Fréjus / Mont-Blanc (API OSM +
  Nominatim) ; job `r411` (à la main seulement, case « r411 », groupe de concurrence à part : n'annule jamais une
  copie) : texte du Code de la route art. R411-8 dans le journal ; lancée aussi à chaque envoi qui modifie l'outil,
  `tunnels-convert.js`, `areas-osm-data.js` ou `access-convert.js` (toute branche) et à la main ;
  `node tools/osm-update.mjs fichier.osm contour.poly` en local (osmium installé) ; téléchargements : délai par essai
  (60 s pour un `.poly`, 20 min pour un `.pbf`), 5 essais (attentes 30 s, 1 min, 2 min, 4 min) ; contours `.poly`
  gardés dans `data/osm-poly/` (hors `APP_FILES`, dates dans `dates.json`, écrits à chaque copie réussie) et utilisés
  si leur téléchargement échoue (journal : « copie du dépôt utilisée », avec la date) ; attribution ODbL dans Réglages ;
  phase 12a : ponts de l'extrait France (filtrage osmium à part, `filterBridges`) dans `data/ponts-osm/`, écrits
  seulement dans les limites de taille (sinon ancienne copie gardée, journal « ⚠ data/ponts-osm/ non modifié ») ;
  phase 12a bis : limites de poids dans le même filtrage (`data/poids-osm/`, « ⚠ data/poids-osm/ non modifié » si trop
  gros) ; phase 11a : limitations de vitesse dans le même filtrage (`data/vitesses-osm/`, copie complète puis réduite,
  « ⚠ data/vitesses-osm/ non modifié » si trop gros) ; phase 11b : directions des bretelles dans le même filtrage
  (`data/directions-osm/`) ; phases 11d / 11c : voies à flèches (`data/voies-osm/`) et lieux (`data/lieux-osm/`) dans
  le même filtrage, chacune écrite à part (« ⚠ data/voies-osm/ non modifié » si trop grosse, repli : retirer
  residential et unclassified), journal : taille de l'extrait filtré, temps du filtrage et de l'export, volume lu
  pour les voies et les lieux, voies ignorées à cause de « none » (compteur à part) et par autre motif ; case manuelle « r413 » : lecture du Code de la route,
  art. R413-1 à R413-10, dans le journal (pour `speed-rules.js`) ; l'étape « Enregistrer » n'ajoute que les chemins qui existent (une copie absente ne bloque pas les autres)
- `tools/hiver-update.mjs` + `.github/workflows/hiver.yml` (Action « Équipements d'hiver (loi Montagne) ») : copie
  annuelle (15 octobre, à la main, à chaque envoi qui modifie l'outil, `winter-convert.js` ou le workflow, toute
  branche) de la liste Sécurité routière (xlsx du 22/10/2022) et des contours 2022 (2021 en secours) dans
  `data/hiver/` ; échec (job rouge, rien d'écrit) si plus de 2 % des codes INSEE sans contour ; job `austria` : KFG
  § 102 (RIS) dans le journal ; `node tools/hiver-update.mjs liste.xlsx contours.geojson.gz` en local
- `tools/zfe-update.mjs` + `.github/workflows/zfe.yml` : copie hebdomadaire de la BNZFE dans `data/zfe.json` (adresses
  lues dans l'API data.gouv.fr ; `node tools/zfe-update.mjs aires.geojson voies.geojson ids.csv AAAA-MM-JJ` en local)
- fixtures phase 5 : `bnzfe-aires.json` / `bnzfe-voies.json` / `bnzfe-ids.csv` (extraits réels de la BNZFE du 26/03/2026)
- fixture phase 5b : `overpass-tunnels.json` (voies au format « out tags geom » écrites d'après la doc : tunnels C, E, D double,
  hazmat=no à côté, catégorie A, hazmat:E=yes, le long de la ligne de test à 45,05° N)
- fixtures phase 5f : `hiver-liste-sheet.xml` (lignes réelles de la liste du 22/10/2022), `hiver-contours.geojson`
  (contours écrits autour de `ors-directions-nav.json` : petite commune sur 155 m sans point du tracé, trou, en partie)
- fixtures phase 5g : `ors-directions-mont-blanc.json` (Le Fayet → tunnel du Mont-Blanc → Courmayeur) et
  `ors-directions-frejus.json` (Modane → tunnel du Fréjus → Bardonecchia), countryinfo FR 70 / IT 97, tubes de
  `KNOWN_TUNNELS`, écrites d'après la doc ORS
- fixtures phase 5h : `ors-directions-cernay-erstein.json` (D 83 Cernay → Colmar → Sélestat → Erstein, noms
  « name, ref » des étiquettes OSM du 21/11/2026), `ors-directions-alsace.json` (Mulhouse → A 36, A 35 → M 35 de l'Eurométropole → Strasbourg), `ors-directions-belfort-mulhouse.json` et
  `ors-directions-besancon-belfort.json` (A 36 puis D 83 dans Belfort), `ors-directions-metz-nancy.json`
  (A 31), `ors-directions-muenchen-innsbruck.json` (countryinfo DE 74 / AT 11), écrites d'après la doc ORS
- fixture phase 5h ter : `osm-tolls.geojsonseq` (voies au format de l'export osmium sur les tracés Alsace et
  Metz–Nancy : deux chaussées de l'A35 dont une à rebours à 20 m, M35 et ancienne « A 35 » dans l'Eurométropole,
  bretelle, A36 et A31 toll=yes, route sans référence)
- fixture phase 5c : `ors-directions-fr-ch-it.json` (Saint-Julien → Genève → Grand-Saint-Bernard → Aoste, countryinfo
  70 / 193 / 97, écrite d'après la doc ORS)
- fixture phase 5 B : `open-meteo-wind.json` (3 points, format de la doc : liste de structures, heures UNIX)
- fixtures phase 5d : `ors-directions-access.json` (31 km plein est à 45,6° N, `roadaccessrestrictions` 4 / 12 / 8
  près du départ, vers km 16 et près de l'arrivée, d'après la doc ORS), `osm-access.geojsonseq` (voies au format de
  l'export osmium le long de ce tracé : tranche 7 h–19 h, parallèle à 25 m, pont, hgv yes + motor_vehicle no, wet,
  22 h–6 h, maxweight Su,PH, chemin, hgv=yes masquant, sens unique à contresens)
- fixtures phase 9 : `overpass-aires.json` (aires le long de `ors-directions-nav.json`, une à gauche), `aires-pl.json`
  (jeu converti), `official-*.xml` (feuille xlsx, chaînes partagées, content.xml d'un ods ; `official-sca-2025-*` = lignes
  réelles du xlsx concédé 2025)
- `docs/ROADMAP.md` : feuille de route ; `tools/make-icons.mjs` : génère les PNG
