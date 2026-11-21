# Gabarit — consignes pour Claude

**But** : PWA perso de GPS poids lourd (inspirée de POIDZ), utilisée sur une tablette Android.
Le propriétaire n'a pas de terminal : tout passe par ce dépôt et GitHub Pages (racine de `main`). Budget 0 €.

## Style des réponses (économie de tokens)
- Messages du chat en mode caveman (skill `caveman` si disponible, sinon même style) : phrases courtes, pas de blabla,
  pas de récapitulatif des étapes.
- Ne changent pas : le code, les commentaires et sources citées, les textes de l'appli, les commits, les docs du dépôt.
- Restent complets : le plan avant de coder et la liste « à vérifier sur la tablette » (phrases courtes, aucun point retiré).

## Structure
- `index.html`, `manifest.webmanifest`, `sw.js` (service worker module), `icons/`
- `src/lib/` : logique pure, sans DOM, testable sous Node (requêtes ORS, lecture des réponses, erreurs, profils, stockage)
  - guidage : `nav-geo.js` (cap, projection sur le tracé), `nav-guidance.js` (manœuvres, paliers d'annonce, phrases,
    pictos, voix fr), `navigation.js` (moteur : `updateNavigation(state, fix)` → `{ state, view, events }`, seuils dans `NAV`),
    `nav-sim.js` (fausse position GPS pour la simulation)
  - itinéraires proposés : `route-options.js` (Recommandé + `alternative_routes` ou variantes, budget de requêtes,
    doublons, noms, écarts, textes des fiches, tracé touché sur la carte)
  - phase 7 : `map-layers.js` (Plan / Satellite IGN, zone France, guidage démarré en plan, `carryOverlay` au changement
    de thème), `share.js` (lien d'itinéraire dans le #, validation des liens reçus, GPX 1.1, lien OpenStreetMap, choix
    partage / copie / téléchargement, guide d'installation `INSTALL_STEPS`)
  - phase 7c : `prefs.js` (couleur de la flèche, vitesse / volume / nom de la voix), `nav-anim.js` (interpolation de la
    flèche entre deux positions GPS) ; nom de la route (`currentRoadName`) et `overviewBbox` (vue d'ensemble)
  - phase 5e : `weights.js` (PTAC > 40 t sur un trajet international : alerte avant le départ, transport combiné) ;
    poids total maximal national et hauteur maximale des pays (bloc `limits` de `data/pays/*.json`, `country-rules.js`)
  - phase 5f : `winter.js` (communes de `data/hiver/` coupées exactement par le tracé, période 1er novembre – 31 mars,
    consigne selon la remorque), `winter-convert.js` (liste Sécurité routière + contours → `data/hiver/`) ; UI
    `src/ui/winter.js` ; bloc `winter` des fiches pays
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
  - `navigation.js` (écran de guidage : GPS ou simulation → moteur → voix/carte), `voice.js`, `wake-lock.js`, `nav-icon.js`
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
  si leur téléchargement échoue (journal : « copie du dépôt utilisée », avec la date) ; attribution ODbL dans Réglages
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

## Tester
```
node --test
```
(lancé aussi par `.github/workflows/tests.yml` à chaque push). Doit rester 100 % vert.

Interface dans Chromium (Playwright, hors CI, à relancer après toute modif d'interface) :
```
npm install --no-save --no-package-lock maplibre-gl@4.7.1   # une fois (node_modules/ ignoré par git)
node tools/ui-check.mjs            # ou un scénario : layout | long | satellite | context | parked | comfort | destinations
                                   #   | overview | press | areas | foot | rules | drive | adr | draw | border | access | winter
```
Largeur 360 / 412 / 800 / 1280 px sans défilement horizontal, textes du guidage dans leurs cases, satellite après
changement de thème, perte du contexte WebGL, camion arrêté hors du tracé, boutons et réglages 7c, appui long et
coordonnées (phase 8), vue d'ensemble avec des positions envoyées comme le vrai GPS (plan et satellite), saisie après
un appui long, aires (liste, repères, fiche, avis, copie `data/aires-osm/` sans Overpass, hors zone : serveur Overpass de secours et cache, copie absente, encart en guidage avec le GPS
émulé), réglementation (fiches, « Éviter la ZFE », bandeau du guidage, heure de la tablette décalée un samedi
21 h 57), ADR (`adr` : fiche, notes, « Éviter le tunnel », bandeau, fichier absent, code vide, profil, vrai service worker
« Gabarit v26 », Réglages ADR repris d'un ancien profil, profil sans champs ADR), temps de conduite et vent (`drive` : 4 h 25 déjà comptées, Open-Meteo simulé, bouton « travail » à l'arrêt,
bandeau jamais sous la barre du bas, 360 / 412 px, tablette, paysage ; Réglages, copie, échec), tracés (`draw` :
tuiles lentes comme le vrai fond, source `route` et couche `route-line` après calcul, autre fiche, Plan / Satellite,
rechargement), frontières (`border` : fiches Suisse / Italie un mercredi 21 h 50, nuit suisse en vigueur, sources,
« à vérifier », 360 / 412 / 800 / 1280 px, guidage avec le GPS émulé : bandeau et une annonce vers 3 km captée,
countryinfo absent, fichier pays absent), accès (`access` : desserte traversée vers km 16, desserte près du départ et
de l'arrivée acceptée, voie interdite / autorisée selon l'heure un mercredi 8 h, condition non lue sur une ligne,
« Éviter la desserte locale » = une requête ORS, 360 / 412 / 800 / 1280 px, guidage avec le GPS émulé à 360 et
1280 px : bandeau et une annonce vers 3 km captée, copie absente), équipements d'hiver (`winter` : mercredi de
novembre, alerte, date de la liste, B26, profil « Remorque » rechargé, crédits, juillet, copie absente, fiches Suisse /
Italie en juillet, guidage avec le GPS émulé à 360 et 1280 px : rien d'hiver dit ni affiché). Captures dans `tools/ui-shots/` (ignoré). Un comportement du guidage se vérifie avec le GPS émulé
(`setGeo`, une position par seconde, vitesse fournie), pas seulement en simulation.

## Conventions
- HTML/CSS/JS vanilla, modules ES, sans framework, sans build, sans dépendance npm.
- Dépendances CDN à version épinglée (MapLibre GL JS 4.7.1 : `index.html`, `config.js`, `sw-routing.js`).
- Chemins **relatifs** partout (site servi sous un sous-dossier).
- URL d'API dans `src/lib/config.js`, sans slash final : `api.heigit.org/openrouteservice/v2` et `/pelias/v1`.
- ORS : profil `driving-hgv`, `options.vehicle_type: "hgv"`, `profile_params.restrictions`, `maximum_speed` ≥ 80.
- Interface et messages en français, pensés pour la cabine (gros boutons, contraste, mode nuit).
- Toute modif de fichier mis en cache → incrémenter `VERSION` dans `sw.js` et ajouter le fichier à `APP_FILES`.
- Version en bas de Réglages (`#app-version`) : demandée au service worker qui contrôle la page (`GET_VERSION`, `src/lib/app-version.js`), seule source `VERSION` de `sw.js` ; sans réponse → « version inconnue ».
- Nouvelle logique → dans `src/lib/` avec ses tests ; règles réglementaires citées en commentaire avec la source officielle.
- Guidage : toute position (GPS réel ou simulation) passe par `updateNavigation` ; l'UI ne prend aucune décision.
  Hors itinéraire (`NAV`) : détection seulement à ≥ 10 km/h avec une précision ≤ 30 m ; à l'arrêt hors du tracé,
  recalcul seulement proposé (bouton « Recalculer d'ici », `requestReroute`) : l'itinéraire ne change jamais sans
  accord hors d'une vraie sortie de route en roulant.
- Carte : sources et couches ajoutées dès que `map.getStyle()` répond (`styleReady`), jamais selon
  `map.isStyleLoaded()` (faux tant qu'une tuile se charge, « style.load » ne revient pas → tracé absent, v17).
- Carte : changement de thème par `setStyle(url, { transformStyle })` (`carryOverlay` recopie photos IGN et tracés) ;
  contexte WebGL perdu et non rendu → carte recréée à l'identique (`src/ui/map.js`), le guidage continue.
- Téléphone (≤ 600 px) : rien ne dépasse en largeur (`min-width: 0` sur les éléments flexibles, champs compris) ;
  tablette inchangée.
  Tester un comportement de guidage = une trace de positions simulées dans `tests/navigation.test.js` ou `nav-sim.test.js`.
- Pendant le guidage, aucune saisie à l'écran (Code de la route art. R412-6-2 : écran permis s'il aide à la navigation).
- ORS : `bearings` n'est accepté que pour les profils vélo (pas de cap imposé au recalcul camion).
  Quota gratuit : 2 000 itinéraires/jour (dépassé → HTTP 403), 40/min (→ 429) ; recalcul au plus toutes les 30 s.
- Chrome n'autorise la voix qu'après une action de l'utilisateur : première phrase dans le geste « Démarrer ».
- Itinéraires alternatifs (`route-options.js`) : 3 requêtes ORS au plus par calcul. Le Recommandé (préférence par
  défaut d'ORS) est toujours la première fiche et la référence des écarts. `alternative_routes` (`target_count` ≤ 3,
  2 points seulement) uniquement si départ–arrivée ≤ 100 km **à vol d'oiseau** (ORS mesure ainsi, sinon erreur 2004) ;
  sinon, ou si ORS ne renvoie qu'un itinéraire : Plus court + Sans péage (Plus rapide si péages évités ou absents).
  Le choix se fait à l'arrêt ; le recalcul en guidage garde `preference`/péages de la variante choisie.
- Vue satellite : IGN `ORTHOIMAGERY.ORTHOPHOTOS` (WMTS `data.geopf.fr`, PM, JPEG, zoom 2–19, sans clé, attribution IGN),
  France seulement (`isInFrance`), choix à l'arrêt dans `settings.mapLayer`. Guidage : démarre toujours en plan ; un
  bouton passe en satellite pour ce guidage seulement (non mémorisé).
- Pied du guidage (`layoutFoot`, `src/ui/navigation.js`) : boutons de carte et encart des aires ne recouvrent jamais
  le bandeau ni la barre du bas. Le pied commence sous le bandeau quand ils se chevauchent en largeur (téléphone) ;
  taille des boutons par `mapButtonSize` (56 tablette, 48 téléphone, plancher 44) ; encart à gauche de la colonne de
  boutons, borné sous le bandeau, défilant ; paysage écran bas (≤ 500 px) : bandeau sur 52 % de la largeur, boutons
  en grille 2 × 2 (icônes), encart à droite du bandeau. Vérifié par `node tools/ui-check.mjs foot` (360, 412 px,
  760 × 360, 900 × 412, 1280 px, encart ouvert et fermé, consigne longue).
- Boutons de carte en guidage (Vue d'ensemble, Recentrer, Plan/Satellite, Aires) : actifs à toutes les vitesses, un seul
  appui, sans menu ni confirmation ; retour automatique au suivi après 15 s seulement en roulant. Vue d'ensemble :
  marge de la carte remise à zéro et `overviewPadding` (MapLibre additionne la marge du suivi à celle de fitBounds et
  abandonne le cadrage s'il ne tient pas). data.geopf.fr est bloqué
  depuis le conteneur : GetCapabilities lu via xyzservices / iTowns / osmlab editor-layer-index sur GitHub.
- Partage : liste blanche des champs (jamais clé ni véhicule) ; départ « Ma position » exclu sauf case cochée (GPX : tracé
  dès le premier carrefour après 500 m) ; lien reçu validé par `decodeRouteLink` (ne lève jamais), affiché en textContent,
  # effacé après lecture, jamais de calcul ni de guidage automatique.
- Réglages 7c : `arrowColor` (auto, bleu, vert, orange, violet → `--arrow-fill` / `--arrow-stroke`), `voiceName`,
  `voiceRate`, `voiceVolume`. Musique : `navigator.audioSession` absent de Chrome (Safari seulement, MDN
  browser-compat-data) → phrase dans Réglages.
- Coordonnées saisies (départ / arrivée) : proposées sans appel Pelias ; appui long et coordonnées ne lancent jamais
  de calcul. Toute saisie dans un champ oublie le point choisi (et le repère de l'appui long) ; la liste de
  suggestions est remplacée dès la frappe (`suggestionPlan`), jamais d'ancienne suggestion à toucher.
- Aires PL, copie (phase 9b) : Overpass échoue au-delà d'environ 500 km (mesuré sur 520 km) → `data/aires-osm/` :
  `index.json` (`updated`, `grid` : zone couverte en cellules de 0,1° en base64, cellule couverte si elle et ses 8
  voisines sont dans les contours `.poly` de Geofabrik ; `tiles` : cases non vides et leur nombre d'aires) + une case
  `E_N.json` par degré (coin sud-ouest), aires compactes (`compactArea` / `expandArea`). Filtre osmium
  `nwr/highway=rest_area,services`, `nwr/amenity=parking`, `nwr/capacity:hgv` (jamais `hgv=*` global : toutes les
  routes), parkings gardés en JS si `hgv=yes/designated` ou `capacity:hgv` (`isAreaTags`). Identifiants osmium « a » :
  voie = 2 × id, relation = 2 × id + 1 → mêmes identifiants qu'Overpass (`osm:w123`, ids des parkings rattachés
  gardés) : « Mon avis » reste sur la même aire. Appli : tracé lu tous les 500 m, cases à 1 km autour des points
  couverts, Overpass seulement pour les morceaux hors zone (une requête, `buildOverpassQuery(morceaux)`, cache
  `hors-copie:`), jamais dans la zone couverte ; index ou case absent / vide / illisible → « Aires indisponibles sur
  ce trajet (données non chargées) », sans repli Overpass ; date de la copie dans la note (« ODbL, copie du
  JJ/MM/AAAA ») et sur la fiche. Fichiers de `data/aires-osm/` hors `APP_FILES` (lus seulement pour les cases du
  trajet). ui-check : copie simulée (`osmCopy` : 'fixture', 'uncovered', null). Test statique : `grid.bits` de
  `index.json` exclu de la recherche de clés. Premier passage : 19 285 aires, 1,39 Mo, 72 min (13 pays).
- Aires PL (phase 9) : une seule requête Overpass par calcul (phase 9b : seulement hors copie), pour tous les
  itinéraires proposés (`combineRoutes` : A, B à l'envers, C ; tracé simplifié ≤ 400 points, écart ajouté au rayon) ; rayons 400 m (aires de repos / de
  service) et 800 m (parkings `hgv=yes/designated` ou `capacity:hgv`) ; `OVERPASS_ENDPOINTS` : overpass-api.de puis
  overpass.private.coffee (échec ou 30 s) avant « Aires indisponibles » ; résultat dans `localStorage`
  (`gabarit.areasCache`, 5 trajets, 7 jours), jamais dans le cache du service worker (POST ignoré). Changer
  d'itinéraire ou recalculer en route : aires replacées sans requête. Aire de repos / service / officielle à plus de
  25 m à gauche du tracé : gardée en gris « autre sens ? », hors des « Prochaines aires » et sans annonce (on roule à
  droite, R412-9) ; parking PL : des deux sens. Doublons OSM / officiel fusionnés à 300 m (places, prix, sécurité
  officiels). Guidage : `view.nextAreas` (3, une aire dépassée de moins de 500 m reste), annonce une fois sous 10 km
  (pas sous 2 km) si `settings.areaVoice` ; encart ouvert / fermé d'un appui, ligne = fiche,
  reconstruite seulement si ses textes changent (distance arrondie à 50 m sous 1 km) et, à l'arrêt, figée avec les
  mêmes aires (une fois par minute, `nextAreasChanged`) ; « Mon avis » (Plein,
  Quelques places, OK) sous 10 km/h en guidage (`canReport`), `data.areaReports` exporté, retrouvé par identifiant
  ou à 150 m. Jeu officiel : Bison Futé, Licence Ouverte ; tableurs non lisibles par le navigateur → Action ;
  titres cherchés dans les 5 premières lignes, en français ou en anglais (xlsx concédé 2025 : ligne 1 date + titres
  FR, ligne 2 titres EN du règlement 885/2013) ; colonnes par références de cellule (cellules vides) ; nom
  « Nom :: CP :: Ville » (`splitName`), position « 46°01821, 6°11771 » (° = virgule décimale, `parseOfficialPosition`),
  route « A41 N / GENEVE » (`splitRoad`), places gratuites + payantes ; identifiant sans colonne d'id = nom + route.
  Réseau non concédé (ods 2018) : sens « + » / « - » / « + / - » jamais affiché (`cleanDirection`), routes « A0016 »
  → « A16 » (`normalizeRoad`), appliqués aussi à la lecture de `data/aires-pl.json` ; positions non lues listées
  avec leur texte brut dans le journal de l'Action (`unreadable`), vides comptées à part (« position absente »).
  `data/` : exclu de l'heuristique « longue chaîne » du test statique pour les identifiants « mot_mot_… ».
  xlsx et ods traités à part (l'un en échec : l'autre enregistré, ancienne copie gardée, avertissement) ; l'Action
  n'échoue que si les deux échouent. Fixture `official-sca-2025-*.xml` = lignes réelles lues par l'Action ;
  bison-fute.gouv.fr, transport.data.gouv.fr et overpass-api.de sont bloqués depuis le conteneur. Pas d'occupation en
  temps réel gratuite en France (Allemagne : SID / Mobilithek, pour plus tard).
- Réglementation (phase 5) — ZFE : `data/zfe.json` (BNZFE, licence ODbL d'après data.gouv.fr, source citée dans les
  notes) ; seuil du schéma etalab (« V4 » = Crit'Air 4, 5 et non classés interdits, ordre EL < V1… V5 < NC), règles
  `pl_*` au-delà de 3,5 t sinon `vul_*`, null = pas de restriction ; tronçon spécial (voies.geojson) à 20 m prime sur
  la zone, dernière zone du fichier prioritaire ; horaires illisibles = restriction supposée, texte « à vérifier ».
  Base réelle : identifiants « 1 », codes commune, SIREN à 10 chiffres, horaires « NC » (noms : `zfe_ids.csv`, zone
  qui contient, sinon site web) ; tronçons sans effet (même règle que la zone) retirés. « Éviter la ZFE » : à
  l'arrêt, une requête ORS `options.avoid_polygons` ; API publique (giscience.github.io/openrouteservice/
  hosted-api-restrictions) : 150 km à vol d'oiseau avec zones à éviter, 200 km² et 20 km par polygone → zones
  découpées en carrés de 12 km, message clair sinon (distance, départ ou arrivée dans la zone) ; recalcul en guidage :
  zones gardées seulement sous 150 km. Interdictions PL : arrêté du 16 avril 2021 (pas celui de 2015, abrogé) + arrêté
  annuel (`SUMMER_SATURDAYS`, `WINTER_AURA_SATURDAYS`, à compléter chaque année ; année absente → rappel
  bison-fute.gouv.fr) ; heure locale de la tablette ; Île-de-France et réseau AURA reconnus par la référence de route
  des étapes ORS (« à vérifier ») ; `vehicle.banStatus`. Guidage : `view.rules` (bandeau `#nav-rule`, une ligne par
  alerte), voix si `settings.ruleVoice` (par défaut oui). legifrance.gouv.fr répond 403 depuis le conteneur : arrêtés
  lus en PDF du JO sur bison-fute.gouv.fr. Tests de dates : `process.env.TZ = 'Europe/Paris'` en tête du fichier.
- Temps de conduite (phase 5 B, `driving-time.js`) : règlement (CE) 561/2006 cité en commentaire (eur-lex bloqué
  depuis le conteneur). Aide seulement, « le chronotachygraphe fait foi » affiché ; toujours « Pause conseillée »
  (fiche, notes, bandeau, voix, tests), jamais « obligatoire ». Conduite ≥ 5 km/h (reprise retenue
  après 30 s, comptée depuis son début), pause ≥ 15 min, art. 7 dans l'ordre 15 puis 30 min, 45 min, arrêt ≥ 9 h =
  repos journalier ; 9 h / 10 h (2 fois par semaine, la journée prolongée compte), 56 h, 90 h sur deux semaines,
  semaine du lundi 0 h (heure de la tablette). Positions espacées de plus de 60 s = arrêt. Décompte dans le moteur
  (`state.driving`, `view.driving`), enregistré dans `localStorage` `gabarit.driving` (toutes les 15 s, fin du
  guidage, pagehide), jamais exporté ; simulation : décompte vide, rien d'enregistré. « Pas une pause (travail) » :
  `markStopAsWork`, refusé à 10 km/h et plus, bouton affiché seulement dessous ; second appui recompte. Voix si
  `settings.driveVoice`. Bandeau `#nav-drive` dans `.nav-top` ; `fitBanner` resserre le bandeau (`.nav-tight`) quand
  il passerait sous la barre du bas ou que la colonne de boutons ne tient plus (téléphone, plusieurs alertes).
  Avant le départ, `breakSchedule` : pause conseillée sur une aire du bon sens (aires de la phase 9 placées sur le
  tracé) atteinte dans l'heure avant 4 h 30, puis toutes les 4 h 30 ; repos de 11 h au-delà de 9 h ; `elapsed`
  recale les heures de passage des ZFE, interdictions PL et vent (option `elapsed` de `zfeAlongRoute`,
  `bansAlongRoute`, `windAlongRoute`).
- Vent fort (phase 5 B, `wind.js`) : Open-Meteo `/v1/forecast` (`OPEN_METEO_BASE`), sans clé, usage non commercial,
  < 10 000 appels/jour, chaque point compte → 40 points au plus ; doc lue sur raw.githubusercontent.com
  (open-meteo/open-meteo-website : `src/routes/en/docs`, `terms`, `licence`), open-meteo.com et api.open-meteo.com
  bloqués depuis le conteneur. Une requête GET par calcul (tous les itinéraires proposés), `wind_gusts_10m` = maximum
  de l'heure précédente (valeur de l'heure suivant le passage), seuil `settings.windGust` (40–150, pas de 5, 70 par
  défaut), voix `settings.windVoice`. Copie `localStorage` `gabarit.windCache` (3 trajets, 3 h), jamais dans le cache
  du service worker ; échec → « Météo indisponible », jamais bloquant. Attribution « Weather data by Open-Meteo.com »
  (CC BY 4.0, liens vers le site et la licence) sous les fiches et dans Réglages, « (Open-Meteo) » dans le bandeau.
  Guidage : `view.rules.wind`, bandeau sous 30 km, voix une
  fois vers 15 km ; recalcul / prévision tardive : `placeWind` sans requête.
- ADR (phase 5b, `adr.js`) : réglage global dans Réglages (« Matières dangereuses (ADR) », `settings.adr` :
  `enabled`, `adrClass`, `unNumber`, `tunnelCode`), jamais dans le profil véhicule (dépend du chargement). Code tunnel
  vide / B–E saisi à la main (« lettre indiquée sur le document de transport ; la classe seule ne la donne pas »),
  jamais déduit de la classe ; 'none' seulement s'il vient d'un ancien profil. Reprise (`migrateAdrSettings`, stockage
  et import d'un ancien JSON) : profil actif ADR, sinon premier profil ADR. `activeVehicle(data)` = profil + `withAdr`
  (hazmat, tunnelCode, adrClass, unNumber) : ORS, alertes, résumés et notes lisent ce véhicule. ORS ne reçoit que `hazmat` ; avec lui il évite toute voie `hazmat=no` / `hazmat:B…E=no`
  quelle que soit la lettre (code source HazmatAccessParser) et ignore `hazmat:adr_tunnel_cat` → phrase « l'itinéraire
  peut être plus long » dans les notes. Code tunnel (`tunnelCode` '', B–E, 'none'), `adrClass`, `unNumber`
  facultatifs, ignorés sans la case ADR ; code vide = aucune alerte (une ligne d'info seulement). Catégorie OSM = plus
  haute lettre `hazmat:X=no`, `hazmat:adr_tunnel_cat`, `hazmat=no` → 'X' (tout interdit) ; code interdit si lettre ≤
  catégorie. Tunnels : jamais d'Overpass (mesure 520 km : > 26 s ; Action en échec trois fois le 20/11/2026, serveurs pleins) :
  extraits Geofabrik + osmium dans l'Action, `data/tunnels-adr.json` chargé seulement
  pour un chargement ADR avec code ; absent / vide → « Alerte tunnels indisponible (données non chargées) », jamais un
  silence ; jamais « sans tunnel interdit » mais « Aucun tunnel signalé dans les données (copie du JJ/MM), la
  signalisation fait foi » ; chaque alerte tunnel finit par « la signalisation fait foi ». `KNOWN_TUNNELS` : Fourvière
  E, Fréjus C, Mont-Blanc E (Bison Futé), catégorie gardée face à OSM, vérifiés sans données. Tube sur le tracé : 5
  points à 35 m au plus, dans l'ordre ; tubes qui se chevauchent réunis. « Éviter le tunnel » : carré de 80 m au milieu
  (avoid_polygons ajouté aux ZFE évitées, 150 km), option « Contournement ». Guidage : `view.rules.tunnel`, bandeau
  sous 20 km, voix vers 5 km (`settings.ruleVoice`). Nom affiché : `tunnel:name` d'abord (Fourvière : name =
  « Autoroute du Soleil ») ; `hazmat=E` (lettre en valeur) = catégorie E. Overpass, Geofabrik, api.openstreetmap.org
  et unece.org refusent le conteneur (Action GitHub pour mesurer / copier).
- Frontières (phase 5c, `countries.js`, `country-rules.js`) : `extra_info: ['tollways', 'countryinfo']` dans toutes
  les requêtes (variantes 2b et recalcul : aucune requête en plus) ; ids ORS (docs/technical-details/country-list.md :
  FR 70, BE 17, LU 117, DE 74, CH 193, IT 97, ES 187 ; 75 et 141 zones partagées → pays voisin) ; extra absent →
  « Pays traversés indisponibles », jamais un silence. `data/pays/{BE,LU,DE,CH,IT,ES}.json` dans `APP_FILES` (hors
  ligne à l'étranger) : chaque règle a `source` (clé de `sources` : nom, lien, `national` ou `bisonfute`) et `verified`
  (date) ; sans source lue → « à vérifier » sur la fiche, jamais dite. Vitesses : source nationale obligatoire ;
  Bison Futé suffit pour les jours fériés et « BE : pas d'interdiction ». Fiche : source nommée (« source officielle »
  ou « Bison Futé »), « en vigueur à votre passage ? » seulement pour une règle sûre qui concerne le véhicule (PTAC
  strictement au-dessus du seuil, ADR / classe, transit LU selon le pays de sortie), heures recalées par `elapsed`,
  fin « La signalisation fait foi. ». DE samedis d'été (FerReiseV) : `kind: 'info'`, jamais calculés ni dits. CH :
  pas de vignette pour la RPLP (LVA art. 3 al. 2). Calendriers annuels IT (`calendar` par année) et ES
  (`calendarYears`) : année absente (aujourd'hui, entrée ou sortie) → rappel avec le lien dès le 1er janvier, rien
  de calculé ; à compléter chaque année. Fériés : `countryHolidays(code, année)` (BE, LU, DE, CH, IT, ES, LU_DE,
  LU_FR), régionaux « à vérifier » (`REGIONAL_HOLIDAYS`). Guidage : `view.rules.border` (bandeau de 20 km avant à
  1 km après, une ligne), voix une fois vers 3 km (`settings.ruleVoice`) : vitesse et interdictions confirmées
  seulement, jamais une absence d'interdiction. mit.gov.it coupe la connexion depuis le conteneur : décret lu dans la
  Gazzetta Ufficiale ; Fedlex et Legilux lus par leurs points SPARQL (fedlex.data.admin.ch, data.legilux.public.lu).
- Accès (phase 5d) — desserte locale (`access-local.js`) : `roadaccessrestrictions` dans `extra_info` de toutes les
  requêtes (aucune requête en plus) ; valeurs cumulées (bits : 2 Customers, 4 Destination, 8 Delivery, 16 Private
  ignoré car ORS l'interdit déjà) ; ORS (`HeavyVehicleFlagEncoder`) accepte `hgv=destination` / `delivery` partout,
  `vehicle_type` reste `hgv`. Tronçon accepté s'il touche le départ / l'arrivée ou s'en trouve à moins de
  `LOCAL.RADIUS_M` (3 km, à vol d'oiseau), sinon alerte « Route réservée à la desserte locale vers km X : vous la
  traversez. » et bouton « Éviter la desserte locale » à l'arrêt (une requête ORS sur appui, carré de 80 m,
  `avoid_polygons` ajouté aux zones déjà évitées, 150 km au plus, option « Sans desserte ») ; extra absent →
  « information indisponible ». Tranches horaires (`access-conditional.js`) : ORS n'applique les accès
  conditionnels que si son graphe est construit avec `conditional_access` (faux par défaut) et `departure` est caché
  → alerte seulement, jamais `departure`. Copie `data/acces-osm/` (même index que `data/aires-osm/` : `grid`,
  `tiles` ; case `{ t, n, w }`, coordonnées 1e-5° en écarts, simplifiées à 3 m), routes carrossables seulement
  (`HIGHWAYS`), conditions sans effet retirées (`canRestrict`), hors `APP_FILES`, cases lues seulement si le tracé
  les touche (`routePlan`), jamais d'Overpass. Priorité hgv > motor_vehicle > vehicle > access (comme ORS) : une
  condition vraie l'emporte sur l'étiquette sans condition du même moyen, la dernière écrite gagne, une étiquette sans
  condition d'un moyen plus précis masque les moins précis ; `:forward` / `:backward` selon le sens de passage.
  Rapprochement : 80 % de la longueur à moins de 15 m, points dans l'ordre du tracé, sens unique respecté (pas
  d'autre chaussée, de parallèle ni de pont). Horaires lus par `parseHours` (ZFE) : plages sans jours, passage de
  minuit (« Mo 22:00-06:00 » = lundi 22 h → mardi 6 h), « PH » avec les fériés du pays traversé (`holidayFor`,
  countryinfo) ; pays sans calendrier, saison, météo → non lue : aucune alerte, une ligne « N voies avec conditions
  non lues, à vérifier ». Messages : jamais « aucune restriction » mais « Aucune restriction horaire signalée dans les
  données (copie du JJ/MM), la signalisation fait foi » ; copie absente → « Restrictions horaires indisponibles
  (données non chargées) » ; chaque alerte finit par « La signalisation fait foi. ». Guidage : `view.rules.access`,
  bandeau sous 10 km (voie interdite à l'heure de passage d'abord, sinon la plus proche ; desserte comprise), voix une
  fois vers 3 km seulement si interdite à l'heure de passage (`settings.ruleVoice`). Pouvoir de police : Code de la
  route art. R411-8 (`POLICE_TEXT`, texte cité dans `access-conditional.js`) ; Légifrance répond 403 au conteneur et à
  l'Action → lu dans le PDF du code de codes.droit.org par le job `r411` (texte imprimé dans le journal).
- Poids et frontières (phase 5e, `weights.js`) : directive 96/53/CE (annexe I 2.2.2, modifiée par 2015/719, lue dans
  l'édition du JO reproduite par boe.es : EUR-Lex répond 202 vide aux lectures automatiques) et réponse ministérielle
  AN n° 1666 (JO du 7/02/2023) : 40 t en trafic international pour 5 essieux et plus, même entre deux pays à 44 t ;
  intermodal 42 t (tracteur 2 essieux) / 44 t (3 essieux). Trajet international = au moins deux pays dans
  `countryinfo` ; PTAC du profil > 40 t → alerte (texte : « Votre profil indique X t (PTAC, pas le poids réel) : … »),
  jamais de voix ; `vehicle.combined` (case « Transport combiné », anciens profils : non) → information jusqu'à 44 t,
  alerte au-delà ; countryinfo absent → ligne « à vérifier ». Fiches pays : `limits.weight` (`max`, `combinedMax`
  DE / CH 44 t) et `limits.height` (`max` en m), source nationale obligatoire, sinon « à vérifier » sans valeur (BE, LU :
  eJustice demande un captcha, Legilux en JavaScript) ; profil au-delà : `warn` sur la fiche, hauteur dépassée aussi
  dans les notes (« Hauteur max Pays »). Sites officiels à ajouter à l'environnement cloud « Gabarit ».
- Équipements d'hiver (phase 5f, `winter.js`) : réponses ministérielles AN n° 3489 (JO 21/03/2023) et n° 10745 (JO
  17/02/2026), décret n° 2020-1264 (Légifrance 403 au conteneur). Période 1er novembre – 31 mars (heure de la tablette,
  heure de passage recalée par les pauses : `inWinterPeriod` sur l'entrée ou la sortie de zone). Communes : copie
  `data/hiver/` (`index.json` : `listDate`, `tiles` ; case `E_N.json` : `{ communes: [{ c, n, d, p, b, r }] }`, anneaux
  en entiers 1e-5° en écarts, commune dans chaque case que son cadre touche), hors `APP_FILES`, cases lues si le tracé
  les traverse (`routeTiles`, parcours exact de la grille) ; intersection exacte segment / côtés (règle pair-impair,
  trous compris), jamais d'échantillonnage. Passages réunis à 50 m, zones à 2 km ; texte « Équipements d'hiver exigés
  du 1er novembre au 31 mars de km X à km Y (communes — département), vers … : consigne. Liste nationale du
  22/10/2022 : arrêtés préfectoraux plus récents et routes exclues à vérifier. La signalisation fait foi. » ; commune
  « en partie, à vérifier » ; `vehicle.trailer` ('' non précisé : deux consignes, 'none', 'with') ; rappel B26 et
  sanctions « à vérifier » ; copie absente en période → « Équipements d'hiver indisponibles (données non chargées) » ;
  aucune commune → « Aucune commune … signalée » (seulement si aucune commune sur le tracé). Jamais de voix, de bandeau
  ni d'annonce. Fiches pays : bloc `winter` (rubrique « Équipements d'hiver », toute l'année, « selon la météo / les
  panneaux, pas de période légale ») ; IT période « à vérifier » ; `data/pays/AT.json` minimal (tout « à vérifier »).
  Crédits dans Réglages (`#winter-credit` : liste du 22/10/2022, contours ODbL). Hôtes de l'Action :
  securite-routiere.gouv.fr, contours-administratifs.s3.rbx.io.cloud.ovh.net (bloqué au conteneur), ris.bka.gv.at.
- Prix du gazole : saisi dans Réglages (`settings.dieselPrice`, €/L, vide par défaut) en attendant la phase 4.
- Doc à jour : giscience.github.io, openrouteservice.org et legifrance.gouv.fr peuvent être bloqués depuis le conteneur ;
  lire la doc ORS sur raw.githubusercontent.com (GIScience/openrouteservice : dossier `docs/`, et le code `ors-api/` pour
  les paramètres et limites exacts), MDN sur raw.githubusercontent.com/mdn/content, MapLibre dans le paquet npm
  (`registry.npmjs.org`).
- Voir l'interface dans Chromium (Playwright) : unpkg et les fonds de carte sont bloqués depuis le conteneur ; servir
  MapLibre depuis le paquet npm, un style minimal, et répondre aux appels ORS/Pelias avec les fixtures (`page.route`).

## Interdits
- Jamais de clé API dans le code, les tests, les fixtures, les commits ou les logs (clé saisie dans Réglages, localStorage).
- La clé n'est jamais exportée. Pas de `console.log` dans `src/`.
- Aucun test n'appelle une vraie API : fixtures uniquement.
- Le service worker ne met jamais en cache les réponses d'API, les tuiles ou les styles de carte.
- Pas de service payant ni de clé pour la carte.
