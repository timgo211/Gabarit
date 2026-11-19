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
  - phase 8 : `coords.js` (coordonnées GPS saisies : décimal et degrés-minutes-secondes)
- `src/ui/` : interface (DOM, MapLibre, fetch) ; `src/app.js` assemble le tout
  - `navigation.js` (écran de guidage : GPS ou simulation → moteur → voix/carte), `voice.js`, `wake-lock.js`, `nav-icon.js`
  - `layer-switch.js` (boutons Plan / Satellite à l'arrêt), `share.js` (fenêtre « Partager »)
  - `map.js` : flèche animée (`navigateTo`, boucle requestAnimationFrame arrêtée à la fin de chaque interpolation),
    vue d'ensemble, appui long (600 ms, ou clic droit) → panneau « Aller ici / Partir d'ici » (`app.js`)
- `tests/` : `*.test.js` + `fixtures/` (réponses ORS/Pelias écrites d'après la doc ; `ors-directions-nav.json` et
  `ors-directions-uturn.json` reprennent les textes français d'ORS `ors_fr-FR.resources` ;
  `ors-directions-alternatives.json` = 3 itinéraires, `ors-variant-*.json` = variantes, Recommandé et Plus court identiques)
- `tools/ui-check.mjs` : vérification de l'interface dans Chromium (voir « Tester »)
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
```
Largeur 360 / 412 / 800 / 1280 px sans défilement horizontal, textes du guidage dans leurs cases, satellite après
changement de thème, perte du contexte WebGL, camion arrêté hors du tracé, boutons et réglages 7c, appui long et
coordonnées (phase 8). Captures dans `tools/ui-shots/` (ignoré).

## Conventions
- HTML/CSS/JS vanilla, modules ES, sans framework, sans build, sans dépendance npm.
- Dépendances CDN à version épinglée (MapLibre GL JS 4.7.1 : `index.html`, `config.js`, `sw-routing.js`).
- Chemins **relatifs** partout (site servi sous un sous-dossier).
- URL d'API dans `src/lib/config.js`, sans slash final : `api.heigit.org/openrouteservice/v2` et `/pelias/v1`.
- ORS : profil `driving-hgv`, `options.vehicle_type: "hgv"`, `profile_params.restrictions`, `maximum_speed` ≥ 80.
- Interface et messages en français, pensés pour la cabine (gros boutons, contraste, mode nuit).
- Toute modif de fichier mis en cache → incrémenter `VERSION` dans `sw.js` et ajouter le fichier à `APP_FILES`.
- Nouvelle logique → dans `src/lib/` avec ses tests ; règles réglementaires citées en commentaire avec la source officielle.
- Guidage : toute position (GPS réel ou simulation) passe par `updateNavigation` ; l'UI ne prend aucune décision.
  Hors itinéraire (`NAV`) : détection seulement à ≥ 10 km/h avec une précision ≤ 30 m ; à l'arrêt hors du tracé,
  recalcul seulement proposé (bouton « Recalculer d'ici », `requestReroute`) : l'itinéraire ne change jamais sans
  accord hors d'une vraie sortie de route en roulant.
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
- Boutons de carte en guidage (Vue d'ensemble, Recentrer, Plan/Satellite) : actifs à toutes les vitesses, un seul
  appui, sans menu ni confirmation ; retour automatique au suivi après 15 s seulement en roulant. data.geopf.fr est bloqué
  depuis le conteneur : GetCapabilities lu via xyzservices / iTowns / osmlab editor-layer-index sur GitHub.
- Partage : liste blanche des champs (jamais clé ni véhicule) ; départ « Ma position » exclu sauf case cochée (GPX : tracé
  dès le premier carrefour après 500 m) ; lien reçu validé par `decodeRouteLink` (ne lève jamais), affiché en textContent,
  # effacé après lecture, jamais de calcul ni de guidage automatique.
- Réglages 7c : `arrowColor` (auto, bleu, vert, orange, violet → `--arrow-fill` / `--arrow-stroke`), `voiceName`,
  `voiceRate`, `voiceVolume`. Musique : `navigator.audioSession` absent de Chrome (Safari seulement, MDN
  browser-compat-data) → phrase dans Réglages.
- Coordonnées saisies (départ / arrivée) : proposées sans appel Pelias ; appui long et coordonnées ne lancent jamais
  de calcul.
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
