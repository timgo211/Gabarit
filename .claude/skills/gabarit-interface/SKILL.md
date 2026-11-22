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
