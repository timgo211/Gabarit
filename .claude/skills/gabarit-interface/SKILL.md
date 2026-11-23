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
  dl-de/by) ; source choisie d'après le centre de la carte (`satelliteSourceAt`, zones `satellite-zones.js`). Une
  source n'est codée que si ses conditions sont lues (citées en commentaire avec URL et date) ET qu'une tuile réelle a
  répondu 200 image/* avec `access-control-allow-origin` (Action « Textes officiels », entrée `tiles`). Carte : une
  couche par source (`sat-<id>`, IGN garde `ign-ortho`), toutes dans `below` de `carryOverlay`, nuit à 3 niveaux sur
  toutes ; bascule sans trou (`showSatLayer` : nouvelle couche visible, ancienne masquée au premier `idle`, 1,5 s au
  plus). Hors de toute source : plan + « Vue satellite indisponible à cet endroit », jamais une couche vide.
  Attribution : contrôle MapLibre (sources visibles) et Réglages › Sources et licences (`#satellite-credit-list`,
  `satelliteCredits`, textContent). Tuiles jamais en cache (autre origine = réseau, `sw-routing.js`).
- Écran de guidage (phase 2c, façon GPS de téléphone, `src/ui/navigation.js` + décisions dans `src/lib/nav-layout.js`) :
  bandeau de manœuvre en haut (rayon 24 px, marges 12 px, noir jour et nuit : flèche, distance, badge de route
  `roadLabel` de `src/lib/road-badge.js` + nom de rue, ou la consigne entière si elle donne une direction, `bannerText`),
  « Puis » (≤ 200 m, `THEN_MAX_GAP_M`, comme la voix), 2 alertes au plus (`guidanceAlerts` : système, tunnel, ZFE, accès,
  interdiction, conduite dépassée, frontière, vent, pause bientôt) et « +N » (≥ 56 px, ouvre les détails). Temps de
  conduite : carte seulement « bientôt » / « dépassé » et s'il reste une place, sinon dans les détails.
  Colonne de boutons ronds à droite (`buttonColumn` : 64 px, plancher 56, 45–85 % de la hauteur, remonte sous le
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
  portrait, 75 % et à droite de la colonne en paysage) : une alerte ou le compteur qui change à l'arrêt ne redessine
  jamais la carte (`parked`). Boussole : `navigateTo({ northUp })`, comparé par `holdStill`.
- Carte en guidage : tracé épais `ROUTE_WIDTH_NAV` (bord 2 px), partie parcourue grise (source `route-done`, mise à jour
  par `traveledUpdate` : en roulant, tous les 25 m), noms des rues en bulles (`streetBubblePatches`, image
  `gabarit-bubble` redessinée sur `styleimagemissing` après setStyle), photos IGN `raster-brightness-max` la nuit selon le niveau (0,6 / 0,8 / 0,9, phase 2d)
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
- Phase 11b : directions — bandeau : la consigne avec « direction X » (`maneuverText`, `spoken: false`) remplace le nom
  de rue (règle `bannerText` inchangée) ; voix (`announcementText`, `spoken: true`) : complément seulement si
  `m.direction.speak`. Copie absente ou ambiguë : rien de plus qu'avant. Aucune saisie, rien dans la fiche.
- v51 : petit paysage (hauteur < 400 px, media query) : bouton « Pas une pause (travail) » sur deux lignes (7em) pour
  que l'alerte de conduite tienne au-dessus du panneau du bas ; panneau de limitation : mention « règle » (`#nav-limit-src`,
  `speedStatus(…).rule`) sous le panneau quand la limite vient d'une règle générale, couleur `--muted`, jamais dite.
