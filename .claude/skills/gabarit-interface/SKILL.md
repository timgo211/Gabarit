---
name: gabarit-interface
description: Règles de la carte, du guidage à l'écran, de la mise en page téléphone/tablette, du satellite, du partage, des réglages 7c et des coordonnées saisies. À utiliser avant de toucher src/ui, map.js, navigation.js ou la mise en page.
---

# Carte, guidage à l'écran et mise en page

(Texte déplacé tel quel depuis CLAUDE.md.)

- Carte : sources et couches ajoutées dès que `map.getStyle()` répond (`styleReady`), jamais selon
  `map.isStyleLoaded()` (faux tant qu'une tuile se charge, « style.load » ne revient pas → tracé absent, v17).
- Carte : changement de thème par `setStyle(url, { transformStyle })` (`carryOverlay` recopie photos IGN et tracés) ;
  contexte WebGL perdu et non rendu → carte recréée à l'identique (`src/ui/map.js`), le guidage continue.
- Téléphone (≤ 600 px) : rien ne dépasse en largeur (`min-width: 0` sur les éléments flexibles, champs compris) ;
  tablette inchangée.
  Tester un comportement de guidage = une trace de positions simulées dans `tests/navigation.test.js` ou `nav-sim.test.js`.
- Vue satellite : IGN `ORTHOIMAGERY.ORTHOPHOTOS` (WMTS `data.geopf.fr`, PM, JPEG, zoom 2–19, sans clé, attribution IGN)
  en France (`isInFrance`), choix à l'arrêt dans `settings.mapLayer`. Guidage : démarre toujours en plan ; un
  bouton passe en satellite pour ce guidage seulement (non mémorisé).
- Phase 7d (satellite hors de France) : registre `SATELLITE_SOURCES` de `src/lib/map-layers.js` (France d'abord, puis
  Luxembourg ACT CC0, Bruxelles UrbIS CC0, Suisse swisstopo, Espagne PNOA IGN CC BY 4.0, NRW dl-de/zero, Rhénanie-Palatinat
  dl-de/by ; v58 : Bade-Wurtemberg LGL dl-de/by (WMS 1.1.1, `wms111`), Bavière LDBV CC BY 4.0, Hesse HVBG open data ;
  non codées : Flandre, Wallonie, Sarre (licence non lisible, raisons dans l'en-tête de `map-layers.js`)) ; source choisie d'après le centre de la carte (`satelliteSourceAt`, zones `satellite-zones.js`). Une
  source n'est codée que si ses conditions sont lues (citées en commentaire avec URL et date) ET qu'une tuile réelle a
  répondu 200 image/* avec `access-control-allow-origin` (Action « Textes officiels », entrée `tiles`). Journal lu par
  l'outil GitHub `get_job_logs` (`tail_lines`) : garder les tours courts (tuiles seules ; `span` / `max` / `maxDocs`
  par entrée pour les pages de conditions), sinon le journal est trop long à lire. Carte : une
  couche par source (`sat-<id>`, IGN garde `ign-ortho`), toutes dans `below` de `carryOverlay`, nuit à 3 niveaux sur
  toutes ; bascule sans trou (`showSatLayer` : nouvelle couche visible, ancienne masquée au premier `idle`, 1,5 s au
  plus). Hors de toute source : plan + « Vue satellite indisponible à cet endroit », jamais une couche vide.
  v65 : photos montrées → aplats du style au-dessus des photos masqués (`photoCoverPatches` de `src/lib/photo-cover.js` :
  fill, fill-extrusion, background, hillshade, contours de bâtiments ; liberty : `building`, `building-3d` ; dark :
  `building`, `aeroway-area`, `road_area_pier`), rendus en plan / hors zone, rappliqués après chaque style
  (`applyGuidanceStyle`) ; routes, libellés et nos couches jamais touchés. Vérifié par `ui-check satellite` (bâtiments).
  Attribution : contrôle MapLibre (sources visibles) et Réglages › Sources et licences (`#satellite-credit-list`,
  `satelliteCredits`, textContent). Tuiles jamais en cache (autre origine = réseau, `sw-routing.js`).
- Écran de guidage (phase 2c, façon GPS de téléphone, `src/ui/navigation.js` + décisions dans `src/lib/nav-layout.js`) :
  bandeau de manœuvre en haut (rayon 24 px, marges 12 px, noir jour et nuit : flèche, distance, badge de route
  `roadLabel` de `src/lib/road-badge.js` + nom de rue, ou la consigne entière si elle donne une direction, `bannerText`),
  « Puis » (≤ 200 m, `THEN_MAX_GAP_M`, comme la voix), 2 alertes au plus (`guidanceAlerts` : système, tunnel, ZFE, accès,
  interdiction, conduite dépassée, frontière, vent, pause bientôt) et « +N » (≥ 56 px, ouvre les détails). Temps de
  conduite : carte seulement « bientôt » / « dépassé » et s'il reste une place, sinon dans les détails.
  Colonne de boutons ronds à droite (`buttonColumn` : 48 px, plancher 40 — v53, ces boutons ronds seulement ; panneau du bas 64 / 56 px —, 45–85 % de la hauteur, remonte sous le
  bandeau, deux colonnes en dernier recours) : boussole, Recentrer (seulement carte déplacée), loupe (rangée « Aires
  PL », « Plan / Satellite », fermée seule après 8 s, aucune saisie), son, autres itinéraires (actif seulement à
  l'arrêt, `parkedState` : < 5 km/h pendant 3 s ; v44 : vue d'ensemble + panneau `#nav-alts`), place du signalement
  (`.nav-slot`, phase 3). Liste « Aires et parkings PL » (phase 2d) : voir plus bas. Compteur en bas à gauche (`speedStatus` ; panneau de limitation seulement si la limite PL
  est connue). Panneau du bas : ✕ (confirmation Quitter / Continuer, sauf à l'arrivée), temps restant (--ok),
  « km • heure » (--muted), vue d'ensemble ; poignée touchée ou tirée : détails en lecture seule. Paysage
  (`isLandscape`) : bandeau et panneau du bas dans la colonne gauche (40 %). Écran bas : `nav-tight`, mesuré après
  chaque changement (le panneau du bas rétrécit aussi). `layoutGuidance` place tout (rien ne se chevauche), jamais
  la caméra. Vérifié par `node tools/ui-check.mjs guidage` (et `foot`, `drive`, `long`).
- Caméra du guidage : `followPadding` ne dépend que de la taille de l'écran (véhicule à 78 % de la hauteur en
  portrait, 75 % et à droite de la colonne en paysage ; v53 : plus haut si la pastille de la rue ne tient pas dessous,
  `PILL_ROOM` 150 px portrait / 40 px paysage) : une alerte ou le compteur qui change à l'arrêt ne redessine
  jamais la carte (`parked`). Boussole : `navigateTo({ northUp })`, comparé par `holdStill`.
- Carte en guidage : tracé épais `ROUTE_WIDTH_NAV` (bord 2 px), partie parcourue grise (source `route-done`, mise à jour
  par `traveledUpdate` : en roulant, tous les 25 m), noms des rues en bulles (`streetBubblePatches`, image
  `gabarit-bubble` redessinée sur `styleimagemissing` après setStyle), photos IGN `raster-brightness-max` la nuit selon le niveau (0,6 / 0,85 / 1, phase 2d, v65)
  et libellés clairs (`photoLabelPatches`). Réglages du style appliqués par `applyGuidanceStyle` (chargement de
  style, thème, entrée / sortie du guidage), jamais à chaque position. Repère : `src/ui/vehicle-icon.js` (registre
  d'icônes : flèche, camion vu de dessus — dessin maison, formes simples, jamais un logo ni une icône copiée ; v45),
  `settings.vehicleIcon` (`truck` par défaut, `sanitizeVehicleIcon` de `prefs.js`), Réglages › Affichage « Repère du
  véhicule » ; `map.setVehicleIcon` recrée le repère à la même place et au même cap. 60 px, couleurs `--arrow-*`. Pictogrammes des boutons : `src/ui/nav-symbols.js` (Material Symbols,
  Apache 2.0, recopiés ; crédit dans Réglages).
- Thème auto (phase 2c) : nuit entre coucher et lever du soleil à la dernière position (`src/lib/sun.js`, NOAA) ;
  sans position, 20 h – 7 h ; position du guidage reprise au plus toutes les 5 min (`THEME_RECHECK_NAV_MS`) ; choix
  manuel prioritaire. Changement de style : voile `.map-veil` de la couleur `--bg` du nouveau thème (fondu 150 ms,
  retiré au premier `idle`, 1,5 s au plus), jamais de blanc.
- Boutons de carte en guidage (vue d'ensemble, recentrer, boussole, loupe, Plan / Satellite, son) : actifs à toutes
  les vitesses, sans saisie ; retour automatique au suivi après 15 s seulement en roulant. Vue d'ensemble :
  marge de la carte remise à zéro et `overviewPadding` (MapLibre additionne la marge du suivi à celle de fitBounds et
  abandonne le cadrage s'il ne tient pas). data.geopf.fr est bloqué
  depuis le conteneur : GetCapabilities lu via xyzservices / iTowns / osmlab editor-layer-index sur GitHub.
- Partage : liste blanche des champs (jamais clé ni véhicule) ; départ « Ma position » exclu sauf case cochée (GPX : tracé
  dès le premier carrefour après 500 m) ; lien reçu validé par `decodeRouteLink` (ne lève jamais), affiché en textContent,
  # effacé après lecture, jamais de calcul ni de guidage automatique.
  v89 : Chromium refuse `.gpx` et tout type XML au partage Web (extension ET type vérifiés) → GPX téléchargé,
  `GPX_DOWNLOAD_TEXT` ; nom jamais en `.txt` ; types essayés `GPX_SHARE_TYPES` (`pickShareType`) ; aide
  `#share-gpx-hint` (`GPX_LINK_HINT`, textContent) sous « Fichier GPX ». ui-check `partage`.
- Réglages 7c : `arrowColor` (auto, bleu, vert, orange, violet → `--arrow-fill` / `--arrow-stroke`), `voiceName`,
  `voiceRate`, `voiceVolume`. Musique : `navigator.audioSession` absent de Chrome (Safari seulement, MDN
  browser-compat-data) → phrase dans Réglages.
- Coordonnées saisies (départ / arrivée) : proposées sans appel Pelias ; appui long et coordonnées ne lancent jamais
  de calcul. Toute saisie dans un champ oublie le point choisi (et le repère de l'appui long) ; la liste de
  suggestions est remplacée dès la frappe (`suggestionPlan`), jamais d'ancienne suggestion à toucher.
- Couleurs du fond de carte (2c-a) : style OpenFreeMap / VersaTiles recoloré par `src/lib/map-palette.js` (seules les
  propriétés « *-color », jamais nos couches tracé / ZFE / IGN) : `recolorBase` au `style.load` (setPaintProperty),
  `recolorStyle` dans `transformStyle` au changement de thème. Tracé toujours au-dessus des ZFE ; bord du tracé
  `ROUTE_WIDTH` (2 px de chaque côté), #14161C sur les photos IGN. Bandeau de manœuvre noir jour et nuit.
  Vérifié par `node tools/ui-check.mjs palette` (jour, nuit, satellite, 412 × 900 et 900 × 412, zoom 17).
- Flèche à l'arrêt (< 3 km/h, `src/lib/nav-anim.js`) : la dérive du GPS se mesure depuis le point d'arrêt
  (`stillPoint` : moyenne des 20 dernières positions reçues à l'arrêt), jamais depuis la dernière position dessinée
  (± 60 m de dérive = jusqu'à 120 m entre deux mesures). Rien n'est redessiné tant que la position reste à moins de
  100 m de ce point et que lui reste à moins de 50 m de la flèche (`stillDrift`) ; un redessin à l'arrêt (bandeau,
  suivi) place flèche et caméra sur le point d'arrêt. Vérifié par `node tools/ui-check.mjs parked` (0 image attendue).
- Liste des aires en guidage (phase 2d, `#nav-areas`) : 15 aires au plus (`AREAS.LIST_COUNT`, `nextAreas` du moteur,
  aucun appel réseau), lignes mises à jour sur place (`areaRowsPlan`, jamais `replaceChildren` : `parked` reste à 0 image),
  figées à l'arrêt (`nextAreasChanged`). Place : `areaListBox` (`src/lib/nav-layout.js`) — portrait au-dessus du compteur,
  ≤ 40 % de la hauteur, jamais sur la pile du bandeau ; paysage dans la colonne de gauche, ou sur la carte entre
  la colonne et les boutons si la colonne a moins de 180 px (téléphone en paysage, `inMap`, message bref dessous). Pastille de la rue masquée
  en portrait tant qu'elle est ouverte, message bref au-dessus d'elle. Appui : `map.highlightArea` (classe CSS) + fiche
  courte ; caméra déplacée (`map.showPlace`) seulement à l'arrêt ; « Y aller » / « Fiche complète » `aria-disabled`
  hors `parkedState`. Fermée après 20 s sans toucher (`AREA_LIST.AUTO_CLOSE_MS`) ou par « Fermer ». Aucune saisie.
- Luminosité de la carte la nuit (phase 2d) : `settings.nightMapLevel` (`dark` = v35, `normal` par défaut, `light`),
  palettes `NIGHT_PALETTES` / `NIGHT_BUBBLES` de `src/lib/map-palette.js` (gris de la gamme Panier Perdu seulement),
  `map.setNightLevel` : voile `.map-veil` puis `setPaintProperty`, jamais setStyle. Interface (variables CSS) identique aux
  trois niveaux. Tests : textes AA aux trois niveaux, tracé ambre et routes ≥ 3:1 sur le fond Clair (`contrast.test.js`).
- « À l'arrêt » (`parkedState`, boutons réservés à l'arrêt, « Mon avis ») : vitesse du GPS, sinon déduite des deux
  dernières positions (`view.parkSpeedKmh` du moteur, dérive sous max(précision, `NAV.PARK_DRIFT_MIN_M` = 5 m) = 0) ;
  inconnue (premier point, trou > 10 s, saut) = en mouvement. La vitesse du moteur (`speedKmh` : zoom, voix, recalcul)
  n'en dépend pas. En guidage, un repère d'aire touché ouvre la liste et la fiche courte (`navigation.pickArea`),
  jamais la fiche complète.

- Phase 2e : barre d'échelle cachée en guidage (`.app.navigating .maplibregl-ctrl-scale`), attribution toujours
  visible. Consigne du bandeau jamais sous 70 % de sa taille (`BANNER_MIN_SCALE`, `fitText` / `shrinkUntil` de
  `src/ui/dom.js`, appelés par `fitBanner`) ; au-delà, la pile du haut défile. Références de route : suffixes reconnus
  (`D 120 E`, `D 57e2`, `N 83 bis`), espaces insécables (`roadLabel`, `keepRefsTogether`). Bouton rond indisponible :
  `--nav-off-bg` / `--nav-off-fg` / `--nav-off-border` (opaques, AA testé), jamais d'opacité.

- Phase 2g : fiche d'itinéraire, ligne `.route-card-an` « Autoroute et nationale : 82 % » (« inconnue » sans extras ou
  > 30 % de km sans nom) sous les faits ; « Recommandé » choisi pour sa part A/N : note `AN_PREFERRED_NOTE`, ancien
  premier renommé « Préférence ORS » (clé `ors-default`, partageable). Diagnostic du trajet : ligne « Classes de
  route : A … km, N … km, autre … km ; km inconnus … ; part A/N … ».
- Phase 2g : message d'un code 2009 au diagnostic précis (départ sans sortie, départ isolé, arrivée inaccessible) :
  `NO_ROUTE_BASE_TEXT` + précision, sans le conseil péages / ferries (gardé seulement sans conclusion).
- Phase 12a : ponts sans hauteur connue — lignes `warn` de la fiche (5 au plus + « +N »), résumé « N ponts à vérifier »,
  repères `.bridge-marker` (`map.showBridges`, retirés par `setNavigating(true)`, jamais en guidage), repère touché →
  message (texte du pont), jamais de voix ; Réglages › Ponts, case `#bridge-warnings` (`settings.bridgeWarnings`,
  activée par défaut). Texte fixe `BRIDGE.TEXT` ; « à vérifier », « la signalisation fait foi ».
- v44 : « Autres itinéraires » — bouton rond à l'arrêt : vue d'ensemble puis `ctx.onAlternatives(dernière position
  reçue)` ; `app.js` calcule comme au départ (profil actif, `restrictionsForTrip`, `isForbidden` v43, 3 requêtes au
  plus) et affiche les fiches de `renderRouteChoice` dans `#nav-alts` (par-dessus le guidage, z-index 6), choix d'une
  fiche, « Guider par cet itinéraire » (refusé hors de l'arrêt) → `startGuidance` (même mode : GPS ou simulation).
  `navigation` appelle `onParkChange(false)` dès que le véhicule roule : panneau fermé, message. Échec : texte du
  calcul de départ (diagnostic 2f), aucune fiche (vidées à chaque ouverture), rien de guidé. « Y aller » d'une aire :
  « Y aller : bientôt ».
- Phase 12a bis : limites de poids — lignes `warn` de la fiche (5 au plus + « +N »), résumé « N limites de poids à
  vérifier », repères `.bridge-marker.weight-marker` (texte « 3,5 t », même calque que les ponts, retirés en guidage),
  repère touché → `#bridge-panel` (`restrictionsUi.openWeight`, aide `WEIGHT_AVOID_HELP`) ; Réglages › Limites de poids,
  case `#weight-warnings` (`settings.weightWarnings`, activée par défaut). Jamais de voix ni de bandeau.
- Phase 12c (v86) : limites officielles DiaLog — copie `data/dialog/` (`src/ui/dialog-limits.js`, `createTileCopy`),
  règles `dialogRules` (`src/lib/dialog-limits.js`) appelées par `routeRules` après les poids OSM (poids OSM de même
  valeur à 15 m absorbé) ; lignes `warn` / `sev:'check'` (5 + « +N »), repères `.bridge-marker.weight-marker.dialog-marker`
  (bord pointillé, texte « 3,4 m » / « 3,5 t »), toucher → `restrictionsUi.openDialog` (textContent, `DIALOG_AVOID_HELP`,
  `fromDialog`) ; Réglages › Limites de poids, case `#dialog-warnings` (`settings.dialogWarnings`, oui par défaut) ;
  crédit `#dialog-credit` + `#dialog-copy-date` (index.json lu à l'ouverture de Réglages). Copie absente : rien.
- Phase 12b : Réglages › Mes restrictions (`#restrictions-card` : type, valeur, note, « Ajouter au centre de la carte »,
  liste Modifier / Supprimer) ; repère de pont touché → `#bridge-panel` (texte, aide `BRIDGE_AVOID_HELP`, « Éviter ce
  passage », fermé au démarrage du guidage). Boutons refusés si `canEditRestrictions` faux (en guidage hors
  `navigation.parked`). Fiche : « Évite N restrictions saisies par toi. » ; trajet > 150 km : `TOO_FAR_TEXT`.
- Phase 11a : limitation de vitesse — compteur en bas à gauche (`speedStatus`), panneau `#nav-limit` (rond blanc, bord
  #C8102E, chiffres noirs : couleurs réglementaires, jamais la palette) seulement si `view.speedLimit` est connu ;
  dépassement (vitesse arrondie > limite) : classe `over` sur `#nav-speedo` (chiffre `--danger`, bord du compteur 4 px),
  alerte visuelle seulement. Réglages › Guidage vocal : `#speed-voice` « Annoncer les dépassements de limite »
  (`settings.speedVoice`, désactivé par défaut : « Limite X » une fois par tronçon, étiquette OSM sans conditions,
  jamais une règle générale) et texte fixe `#speed-hint`. Fiche : `.route-card-speed` « Limites de vitesse connues :
  N % du trajet » (ou « inconnues ») ; note « conditions… à vérifier » ; diagnostic « Limites de vitesse : … ».
- v53, écran de navigation :
  - pastille de la rue SOUS le véhicule, centrée (`roadPillBox` : bornée par le compteur, la colonne de boutons et la
    colonne de gauche ; cachée si elle toucherait le panneau du bas) ; écusson du numéro de route à gauche
    (`roadLabel` du nom d'étape ORS, `BADGE_COLORS` réglementaires) ; sans numéro, le nom seul ; « … » si trop long ;
  - ligne de sortie `#nav-exit` sous la consigne : écusson de la route suivie + « Sortie 12 · Vallorbe » (`exitLine`,
    `m.exit` de `directions.js` : bretelle unique au cap cohérent ET un seul nœud `motorway_junction` à 60 m de son
    début, sinon `junction:ref` / `exit_to` de la bretelle) ; élément manquant caché ; jamais dite ;
  - flèches sur le tracé (`src/ui/route-arrows.js`, dessins maison, bord #14161C) : chevrons blancs `route-chevrons`
    (symbol-placement line, 90 px, zoom ≥ 13) et pastilles des manœuvres `route-turns` (source `route-turns`,
    `maneuverMarks` calculé une fois par itinéraire, `map.showTurns`), sous la partie parcourue, guidage seulement ;
  - compteur 57 px (police 1,43 rem) ; panneau de limitation et mention « règle » inchangés ;
  - v85 : itinéraire montré avant la création de la carte (reprise pendant le chargement du style) : repères et cadrage
    rejoués une fois par `build()` (`src/lib/route-replay.js`), aucun doublon ;
  - mémoire de l'itinéraire (`src/lib/route-save.js` + `src/ui/route-save.js`, IndexedDB `gabarit-route`) : itinéraire
    en préparation et guidage GPS (jamais la simulation) gardés sur visibilitychange / pagehide et à chaque
    changement, 30 s au plus en guidage ; profil par identifiant, aucune clé ; < 12 h → repris tel quel (guidage :
    `resumeNavigation`, « Guidage repris. ») ; > 12 h → `#resume-panel` « Reprendre l'itinéraire ? » seulement à
    l'arrêt (`createPlanPark`) ; format différent, illisible, profil supprimé → effacé ; effacé à l'arrivée et par
    ✕ + « Quitter ». IndexedDB absent, refusé, bloqué (délai 2 s) ou plein : rien gardé, aucune erreur, guidage
    normal (`tests/route-store.test.js`, ui-check `reprise`). Navigation en arrière-plan (voix, GPS) : non faite (impossible en PWA, voir la PR v53).
- Phase 4 (v54) : « Carburant sur le trajet » — bouton `#btn-fuel` sous « Démarrer » (préparation, `aria-disabled`
  hors de l'arrêt : relevés `createPlanPark` dès qu'un itinéraire est affiché, vitesse inconnue = grisé) et puce
  `#btn-nav-fuel` dans la rangée de la loupe (guidage, `parkedState`, stations devant la dernière position reçue).
  Touché en roulant : « disponible à l'arrêt », aucune requête. Panneau `#fuel-panel` (fixe, z-index 45) : texte fixe
  « Prix indicatifs : vérifie à la pompe. » + source, liste triée par prix (prix, badges « Piste PL » / « OK camion » /
  « ancien », adresse, « à N km · détour ≈ X à vol d'oiseau », date), filtres « Piste PL seulement » (si une station en
  a) et « OK camion seulement » (si la liste n'est pas vide), station touchée → `#fuel-cost`, ★ → `fuelStations`.
  Fermé dès que le véhicule roule (`onParkChange`, `planPark.onChange`) et au démarrage du guidage. Module
  `src/ui/fuel.js` chargé à la demande (`lazyLoader`) : import refusé → « Pas de connexion : prix indisponibles. »
  (message de la fiche ou bref du guidage), jamais un bouton muet. Rien dans le bandeau ni à voix haute, rien sur la carte.
- v55 : étapes (10 au plus) — préparation : bouton « + Ajouter une étape » (`#btn-add-stop`, entre départ et arrivée),
  une ligne par étape (`.stop-row` : champ avec la recherche de l'arrivée, ↑ ↓ ✕ de 48 px), étape non choisie dans la
  liste → message, pas de calcul. Fiche : `.route-card-leg` « Étape 1 · Metz — 14:35 (1 h 12) » puis « Arrivée »,
  note « N étape(s) : Heures sans temps passé aux étapes. ». Carte : repères numérotés `.stop-marker` (accent), aussi
  en guidage (étapes restantes). Guidage : « Vous arrivez à l'étape » (arrivée ORS type 10 au milieu), « Étape
  atteinte. » (phrase fixe, sans nom) à 50 m de l'étape, puis la suite ; « Prochaine étape (k/n) : libellé · km · heure »
  dans les détails (`#nav-facts`), jamais dit. Ajout en route à l'arrêt seulement (R412-6-2, `parkedState`) :
  « Ajouter comme étape » de la fiche carburant (préparation : nouveau calcul ; guidage : « Autres itinéraires » avec
  l'étape) et champ « Ajouter une étape » du panneau `#nav-alts` (fermé dès que le véhicule roule) ; étape rangée selon
  sa place sur le tracé. Recalcul et « Autres itinéraires » : étapes non atteintes gardées.
- Phase 6 (v56) : Réglages › « Historique des trajets » (`#history-card`) : phrase « Gardé seulement sur cet appareil.
  Inclus dans l'export. », statistiques par mois, 30 derniers trajets, « Relevé PDF (imprimer) » (`window.print`, seule
  la section `#history-print` imprimée, noir sur blanc, tableau de tous les trajets), « Effacer l'historique »
  (confirmation). IndexedDB refusé ou plein : message, rien de bloqué. Fiche d'une aire : carte « Ma note » (3 groupes
  de boutons `aria-pressed`, remarque, « Enregistrer la note »), grisée hors de l'arrêt.
- Phase 11b : directions — bandeau : la consigne avec « direction X » (`maneuverText`, `spoken: false`) remplace le nom
  de rue (règle `bannerText` inchangée) ; voix (`announcementText`, `spoken: true`) : complément seulement si
  `m.direction.speak`. Copie absente ou ambiguë : rien de plus qu'avant. Aucune saisie, rien dans la fiche.
- Phase 11c (v60) : « vers X » — manœuvre sans direction 11b : bandeau et ligne « Puis » avec « , vers X » (consigne
  entière, `bannerText` traite `maneuver.place` comme une direction) ; jamais dit (`spoken: true` sans le lieu) ; jamais
  « direction X » pour un lieu (point OSM, pas un panneau). Copie `data/lieux-osm/` absente ou vide : consigne
  inchangée, aucun message. Crédit fixe `#places-credit` dans Réglages › Sources et licences. Vérifié par
  `node tools/ui-check.mjs directions` (cas lieux).
- Phase 11d (v61 ; v63 : voie sans flèche `.nav-lane.none` sur autoroute, trait horizontal sans pointe, couleur
  `--lane-off`, jamais `ok`) : voies à prendre — rangée `#nav-lanes` dans la pile du haut, sous « Puis », pour la manœuvre du
  bandeau à 1 km au plus (`lanesRow`) ; une case par voie (pictogramme maison `lane-icons.js`, flèches superposées pour
  « through;right »), voies valides `--nav-fg`, autres `--lane-off` (#6B6E77, ≥ 3:1 sur le bandeau, `contrast.test.js`),
  séparateurs pointillés ; cachée en `nav-tight` (comme « Puis ») ; mise à jour sur place seulement quand les voies
  changent ; `aria-label` « Voies conseillées : N sur M. La signalisation fait foi. » ; jamais dite. Copie absente,
  ambiguë ou refusée : aucune rangée, aucun message. Vérifié par `node tools/ui-check.mjs voies`.
- v51 : petit paysage (hauteur < 400 px, media query) : bouton « Pas une pause (travail) » sur deux lignes (7em) pour
  que l'alerte de conduite tienne au-dessus du panneau du bas ; panneau de limitation : mention « règle » (`#nav-limit-src`,
  `speedStatus(…).rule`) sous le panneau quand la limite vient d'une règle générale, couleur `--muted`, jamais dite.
- v57 : règle générale **ambiguë** (`ambiguous` de `wayLimit` : source `rule` et classe ≠ 0 autoroute, porté par les
  intervalles et `limitAt`, vue `speedLimitAmbiguous`) dépassée → `speedStatus(…).overRule`, classe `.over-rule` :
  chiffres normaux, bord du compteur en pointillés `--fg` 3 px, jamais `--danger`. Règle d'autoroute (90, 80 ADR) ou
  étiquette OSM (avec ou sans condition) dépassée → `.over` (rouge) comme avant. Panneau B14 jamais recoloré. Voix
  inchangée (une règle n'est jamais dite).
- v62, retours de test des étapes :
  - fiche : une ligne par tronçon (`legLines` : titre « Tronçon k : Départ → Étape 1 … → Arrivée », détail gris
    « « nom » · durée · km · arrivée hh:mm »), lue dans `segments` ; somme = total, dernière heure = arrivée de la fiche ;
  - guidage : `#nav-stop` « Étape k/n : durée · km » sous « km • heure » (`nextStopLine`, distance le long du tracé),
    cachée après la dernière étape ; jamais dite ; `layoutGuidance` relit la hauteur ;
  - carte : `.stop-marker` 32 px, z-index 4 au-dessus des P (1, choisie 2) ; règle des P : skill `gabarit-aires` ;
  - panneau de préparation : poignée `#btn-panel-grip` (48 px, sticky) ; replié (`.app.panel-collapsed`) = carte seule
    (portrait : barre de 48 px ; paysage : colonne de 56 px, texte vertical) ; `settings.panelCollapsed` gardé et
    exporté ; `map.resize()` après chaque changement ; jamais replié tout seul ;
  - suggestions (un seul composant, `attachAutocomplete` + `createSuggester`) : 3 caractères, 400 ms après la
    dernière frappe, requête précédente annulée, 5 lignes (`.suggest-name` + `.suggest-sub` en `--muted`, ≥ 48 px),
    ✕ `.suggest-close` en tête (48 px, collé en haut), fermée au choix (click, pas pointerdown : glisser dans la
    liste ne choisit rien), au ✕, au toucher dehors (un écouteur `pointerdown` pour toutes les listes), Échap ; plus
    au `blur` ; « Aucun résultat » / « Pas de connexion » / plafond du jour : ligne non choisissable ;
  - clavier ouvert (Android et iPhone ne réduisent que `visualViewport`) : `keyboardState` met `.app.kbd-open` et
    `--vvh` (hauteur visible) pendant une saisie dans `.panel` hors guidage ; en portrait la carte cède sa place,
    `padding-bottom: 60vh` du panneau pour remonter le champ sous la poignée (`scroll-margin-top`), `max-height` de la
    liste jusqu'au bas visible (`fitList`) ;
  - homonymes : ligne grise « 88600 Bruyères · Vosges, France » (code postal + commune · département, pays ;
    `parseAutocomplete`) ; sans code postal (communes de Who's On First) : « Vosges, France » ; département = `region`
    (France : département dans Who's On First), sinon `county` ; deux lignes de même nom et même code (ou
    département) : `homonymDetails` ajoute rue, puis second niveau (`county`, arrondissement), puis `localadmin` ;
    rien qui les sépare → rien ajouté ; jamais un appel de plus ;
  - texte validé sans choix : une requête `/search` par champ (`place-resolve.js`) ; 1 lieu pris, plusieurs → liste,
    rien de deviné ; plafond de recherche : appui long ou coordonnées. Champ « Ajouter une étape » du guidage :
    toujours seulement à l'arrêt.
- v64, recherches récentes (`src/lib/recent-places.js`, objet `recentPlaces` exporté par `route-form.js`, une seule
  liste pour départ, arrivée, étapes et « Ajouter une étape » d'Autres itinéraires) :
  - `suggestionRows({ status, items, recent })` : titre `.suggest-title` (`--muted`) « Recherches récentes » dans la barre du ✕ (`.suggest-head`, une ligne
    de gagnée clavier ouvert), lignes
    `li.suggest-row.suggest-recent` (✕ `.suggest-remove` 48 px, retire sans fermer la liste), puis ORS sans les lieux
    déjà proposés (`samePlace` : coordonnées à 4 décimales ou libellé normalisé) ; « Aucun résultat » omis si un
    récent correspond ; focus champ vide → les 5 derniers ; filtre dès 1 caractère, tous les mots tapés présents ;
  - ajout seulement dans `choose()` (choix dans la liste) ; jamais dans `resolve()` (texte validé), ni « Ma
    position », ni des coordonnées tapées (`recentEntry` → null) ; 20 au plus ;
  - stockage `gabarit.recentPlaces` (`createRecentStore`, injectable) : lecture ou écriture refusée, plein, JSON
    abîmé → liste en mémoire pour la session, aucune erreur ; export `recentPlaces` (`exportData(…, recent)`),
    `readExport` → `recentPlaces` ([] si absent), fusion `mergeRecent` (mes lieux d'abord) ;
  - ✕ d'une ligne et « Effacer » : en guidage, à l'arrêt seulement (`recentEditAllowed`, comme
    `canEditRestrictions` ; vitesse inconnue = en mouvement, R412-6-2) ; garde `setRecentEditGuard` posée par app.js ;
  - Réglages : carte `#recent-card` (phrase « Gardé seulement sur cet appareil. Inclus dans l'export. »,
    `#btn-recent-clear` + `window.confirm`, grisé si vide).
- v64, « Sources et licences » : titre = `button#btn-credits.section-toggle` (≥ 48 px, chevron CSS selon
  `aria-expanded`), contenu `#credits-body` (hidden si replié) inchangé ; `settings.creditsOpen` (false par défaut,
  exporté). ui-check : `openCredits(page)` avant de lire un crédit.
- v84, repliables (composant `src/ui/collapsible.js` : `collapsible({ button, body })` pour le HTML existant,
  `makeCollapsible` pour un bloc créé en JS ; bouton natif, aria-expanded / aria-controls, corps `hidden`) :
  - Réglages : chaque `section[data-section]` (clés `SECTION_KEYS` de `src/lib/settings-sections.js`, ordre de l'écran),
    titre `#btn-sec-<clé>` + sous-ligne `#sec-<clé>-sub` (`sectionSummary`, réglages de conduite seulement), corps
    `#sec-<clé>-body` ; « Sources et licences » garde `#btn-credits` / `#credits-body`. État `settings.sectionsOpen`
    ({ clé: true }, exporté, seule source) ; ancienne sauvegarde avec `creditsOpen: true` → `credits` ouverte. Clé vide ou
    refusée au test (`invalidKey` de `summarizeKeyTest`) → « Clé : manquante » dans le titre. `#app-version` hors sections.
  - Fiche : `tripInfoMenu` de `summary.js` dans `#route-notes` (et `#nav-alts-notes`) : en-tête `.trip-info` (pire niveau
    `.trip-info-level` symbole + mot, « Informations du trajet », récap `recapText`), corps = lignes `sortLines`
    (`li[data-sev]`, classe `level` inchangée), fiches pays, notes véhicule, diagnostic, sources. Couleurs `--lvl-ban`,
    `--lvl-alert`, `--lvl-check`, `--lvl-info` (AA testé). Replié à chaque `choice.calcId` (compteur `nextCalcId`).
  - ui-check : `openSettings(page)` (déplie tout sauf « Sources et licences »), `openTripInfo(page, root)` ; scénarios
    `reglages` et `fiche-infos`.
- Phase 3a (v66), mes signalements (`src/lib/reports.js`, `src/ui/reports.js`) :
  - bouton rond `#btn-nav-report` (drapeau Material Symbols `flag`, à la place de `.nav-slot`) : un appui → `markReport`
    du moteur (dernière position reçue, cap du moment ; doublon < 20 m refusé ; jamais annoncé pendant ce guidage),
    message bref « Repère posé. Type et note à l'arrêt. » ; aucun choix, aucune saisie, à toutes les vitesses ;
  - repères `.report-marker` (`map.showReports`, aussi en guidage ; pointillés = à vérifier, plein = confirmé) ;
    touché en roulant (guidage) → « Disponible à l'arrêt » ; sinon fiche `#report-panel` (fixe, z-index 45) ;
  - fiche et Réglages › Mes signalements (`#reports-card`) : boutons grisés hors de l'arrêt confirmé (en guidage
    `navigation.parked`, hors guidage `reportPark` = `createPlanPark` relevé tant que la fiche ou Réglages est ouvert) ;
    fiche fermée en roulant (`onParkChange`) et au départ du guidage ; textes en textContent ;
  - encart d'alerte : `view.report` → `guidanceAlerts` kind `report` (rang entre frontière et vent, carte `#nav-rule`).
- Phase 3b (v67), mes lieux (`src/lib/saved-places.js`, `src/ui/saved-places.js`, carte `#places-card` de Réglages) :
  - `suggestionRows({ …, saved })` : titre « Mes lieux » (dans la barre du ✕) + lignes `li.suggest-saved` (nom, puis
    « Dépôt · libellé » en `--muted`, aucun ✕), puis second titre `li.suggest-title-row` « Recherches récentes » et
    les récents qui ne sont pas des lieux enregistrés, puis ORS sans doublon ; source `setSavedPlaces` (app.js) ;
  - un toucher = `choose(savedToPick(p))` (comme une suggestion) ; Entrée prend la première ligne choisissable ;
  - ajout depuis `form.getPlace('to')` (arrivée choisie dans la liste) ou le centre de la carte (nom obligatoire) ;
    boutons grisés en guidage hors de l'arrêt (`recentEditAllowed`).
- Phase 3c (v68), signalements pour un ami (`src/lib/reports-share.js`, bas de `#reports-card`) : `#btn-reports-share`
  (`buildShareFile`, `pickShareMethod` fichier : partage Android ou téléchargement `gabarit-signalements-AAAA-MM-JJ.txt`, v87 : `text/plain` car Chromium refuse `application/json` au partage, même JSON, `shareFileSpec` ; import `.txt`/`.json` vérifié sur le contenu seulement),
  case `#reports-share-notes` (décochée) ; `#reports-import-file` → `parseShareFile` (ne lève jamais) → `previewImport` +
  `window.confirm(previewText)` → `mergeImported` ; refus → rien. Vérifié par `node tools/ui-check.mjs ami`.
- v69 : import à l'arrêt seulement : `#btn-reports-import` (label, `aria-disabled`) et `#reports-import-file` grisés + `#reports-import-hint` « Disponible à l'arrêt » hors `canImportShare` (getParked de 3a) ; aperçu dans la page `#reports-import-preview` (« Importer » / « Annuler », remplace `window.confirm`) ; « Importer » → `confirmImport`, camion reparti → « Import annulé : camion en mouvement. », rien fusionné.
