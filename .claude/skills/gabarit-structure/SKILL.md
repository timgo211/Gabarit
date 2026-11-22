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
    de thème), `share.js` (lien d'itinéraire dans le #, validation des liens reçus, GPX 1.1, lien OpenStreetMap, choix
    partage / copie / téléchargement, guide d'installation `INSTALL_STEPS`)
  - phase 7c : `prefs.js` (couleur de la flèche, vitesse / volume / nom de la voix), `nav-anim.js` (interpolation de la
    flèche entre deux positions GPS) ; nom de la route (`currentRoadName`) et `overviewBbox` (vue d'ensemble)
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
  - phase 5h bis : `route-diagnostic.js` (texte de diagnostic du trajet à copier depuis la fiche)
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
- fixtures phase 5g : `ors-directions-mont-blanc.json` (Le Fayet → tunnel du Mont-Blanc → Courmayeur) et
  `ors-directions-frejus.json` (Modane → tunnel du Fréjus → Bardonecchia), countryinfo FR 70 / IT 97, tubes de
  `KNOWN_TUNNELS`, écrites d'après la doc ORS
- fixtures phase 5h : `ors-directions-cernay-erstein.json` (D 83 Cernay → Colmar → Sélestat → Erstein, noms
  « name, ref » des étiquettes OSM du 21/11/2026), `ors-directions-alsace.json` (Mulhouse → A 36, A 35 → M 35 de l'Eurométropole → Strasbourg), `ors-directions-belfort-mulhouse.json` et
  `ors-directions-besancon-belfort.json` (A 36 puis D 83 dans Belfort), `ors-directions-metz-nancy.json`
  (A 31), `ors-directions-muenchen-innsbruck.json` (countryinfo DE 74 / AT 11), écrites d'après la doc ORS
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
