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
- Vue satellite : IGN `ORTHOIMAGERY.ORTHOPHOTOS` (WMTS `data.geopf.fr`, PM, JPEG, zoom 2–19, sans clé, attribution IGN),
  France seulement (`isInFrance`), choix à l'arrêt dans `settings.mapLayer`. Guidage : démarre toujours en plan ; un
  bouton passe en satellite pour ce guidage seulement (non mémorisé).
- Écran de guidage (phase 2c, façon GPS de téléphone, `src/ui/navigation.js` + décisions dans `src/lib/nav-layout.js`) :
  bandeau de manœuvre en haut (rayon 24 px, marges 12 px, noir jour et nuit : flèche, distance, badge de route
  `roadLabel` de `src/lib/road-badge.js` + nom de rue, ou la consigne entière si elle donne une direction, `bannerText`),
  « Puis » (≤ 200 m, `THEN_MAX_GAP_M`, comme la voix), 2 alertes au plus (`guidanceAlerts` : système, tunnel, ZFE, accès,
  interdiction, conduite dépassée, frontière, vent, pause bientôt) et « +N » (≥ 56 px, ouvre les détails). Temps de
  conduite : carte seulement « bientôt » / « dépassé » et s'il reste une place, sinon dans les détails.
  Colonne de boutons ronds à droite (`buttonColumn` : 64 px, plancher 56, 45–85 % de la hauteur, remonte sous le
  bandeau, deux colonnes en dernier recours) : boussole, Recentrer (seulement carte déplacée), loupe (rangée « Aires
  PL », « Plan / Satellite », fermée seule après 8 s, aucune saisie), son, autres itinéraires (actif seulement à
  l'arrêt, `parkedState` : < 5 km/h pendant 3 s ; pour l'instant vue d'ensemble + « bientôt »), place du signalement
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
  d'icônes, flèche seule pour l'instant). Pictogrammes des boutons : `src/ui/nav-symbols.js` (Material Symbols,
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
