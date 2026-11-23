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
- `src/lib/` : logique pure, sans DOM, testable sous Node ; `src/ui/` : interface (DOM, MapLibre, fetch) ; `src/app.js` assemble le tout
- `tests/` : `*.test.js` + `fixtures/` ; `tools/` : outils et mises à jour des données ; `.github/workflows/` : Actions
- `data/` : gros fichiers générés par les Actions — ne pas les lire en entier (utiliser `node -e`, `grep` ou `head`)
- `docs/ROADMAP.md` : feuille de route
- Détail de chaque module, fixture et Action : skill `gabarit-structure`.

## Tester
```
node --test
```
(lancé aussi par `.github/workflows/tests.yml` à chaque push). Doit rester 100 % vert. Un hook Stop le relance tout seul à la fin de chaque tour où le code a changé.

Interface : `node tools/ui-check.mjs [scénario]` (Playwright, hors CI, à relancer après toute modif d'interface) — mode d'emploi et scénarios : skill `gabarit-tests-interface`.
Aucun test sur le temps d'horloge (machine chargée = échec au hasard) : mesurer le travail (compteur) à la place ;
adresse d'import unique = compteur, jamais `Date.now()`.

## Modèles (choisis automatiquement)
- Mode plan → Opus ; exécution → Sonnet (`"model": "opusplan"` dans `.claude/settings.json`).
- Recherches dans le code → sous-agent `Explore` (Haiku). Vérifications après modif → sous-agent `verificateur` (Haiku) : ne pas lancer les tests dans la conversation principale.
- Tâche vraiment simple (texte, renommage, petite correction) : rester en exécution, pas de mode plan.

## Règles détaillées par domaine (skills, à charger avant de toucher au domaine)
- `gabarit-interface` : carte, guidage à l'écran, mise en page téléphone/tablette, satellite, partage, réglages 7c, coordonnées
- `gabarit-aires` : aires et parkings PL (phases 9, 9b)
- `gabarit-zfe-acces-hiver-taxes` : ZFE et interdictions PL (5), accès (5d), hiver (5f), taxes PL (5h)
- `gabarit-tunnels-frontieres-poids` : ADR (5b), frontières (5c), poids (5e), normes Euro (5g)
- `gabarit-conduite-vent` : temps de conduite et vent fort (5 B)
- Nouvelle règle propre à un domaine → l'écrire dans le skill du domaine (nouveau skill si nouveau domaine), pas ici. Ce fichier reste court : il est relu à chaque message.

## Conventions
- HTML/CSS/JS vanilla, modules ES, sans framework, sans build, sans dépendance npm.
- Dépendances CDN à version épinglée (MapLibre GL JS 4.7.1 : `index.html`, `config.js`, `sw-routing.js`).
- Chemins **relatifs** partout (site servi sous un sous-dossier).
- URL d'API dans `src/lib/config.js`, sans slash final : `api.heigit.org/openrouteservice/v2` et `/pelias/v1`.
- ORS : profil `driving-hgv`, `options.vehicle_type: "hgv"`, `profile_params.restrictions`, `maximum_speed` ≥ 80.
- Interface et messages en français, pensés pour la cabine (gros boutons, contraste, mode nuit).
- Couleurs Panier Perdu (2c-a) : noir #14161C, ambre #E8A93B, crème #EDEAE3 ; variables de `src/styles.css` seulement
  (contraste AA vérifié par `tests/contrast.test.js`), fond de carte dans `src/lib/map-palette.js`. Couleurs réglementaires inchangées.
- Toute modif de fichier mis en cache → incrémenter `VERSION` dans `sw.js` et ajouter le fichier à `APP_FILES`.
- Version en bas de Réglages (`#app-version`) : demandée au service worker qui contrôle la page (`GET_VERSION`, `src/lib/app-version.js`), seule source `VERSION` de `sw.js` ; sans réponse → « version inconnue ».
- Nouvelle logique → dans `src/lib/` avec ses tests ; règles réglementaires citées en commentaire avec la source officielle.
- Guidage : toute position (GPS réel ou simulation) passe par `updateNavigation` ; l'UI ne prend aucune décision.
  Hors itinéraire (`NAV`) : détection seulement à ≥ 10 km/h avec une précision ≤ 30 m ; à l'arrêt hors du tracé,
  recalcul seulement proposé (bouton « Recalculer d'ici », `requestReroute`) : l'itinéraire ne change jamais sans
  accord hors d'une vraie sortie de route en roulant.
- Ponts sans hauteur connue (12a, `bridge-check.js`, copie `data/ponts-osm/` de l'Action « Données OSM », jamais
  précachée) : fiche et carte à l'arrêt seulement, jamais dits à voix haute ni dans le guidage ; « à vérifier ».
- Mes restrictions (12b, `restrictions.js`, champ `restrictions` de `gabarit.data`, exporté) : polygone de
  `RESTR_RADIUS_M` = 30 m par restriction applicable proche du trajet, avec les ZFE dans `avoid_polygons` ; limite ORS
  « 150 km à vol d'oiseau avec zones évitées » → au-delà, rien n'est envoyé et la fiche dit « non évitées… À vérifier ».
  Ajout / modification à l'arrêt seulement ; jamais « sûr » ; rien dans le guidage ni la voix.
- Limites de poids (12a bis, `weight-check.js`, copie `data/poids-osm/` des mêmes Action et cases que les ponts, jamais
  précachée, 5 Mo par fichier / 30 Mo en tout) : tronçon suivi (15 m, cap modulo 180°, jamais un croisement) dont la
  limite est < PTAC ; fiche et carte à l'arrêt seulement, jamais dit ni dans le guidage ; « à vérifier ».
- Limitation de vitesse (11a, `speed-limit.js`, copie `data/vitesses-osm/` mêmes Action et cases, jamais précachée,
  5 Mo / 40 Mo, copie réduite au-delà) : `maxspeed:hgv`, sinon `maxspeed` plafonné par la règle PL vérifiée
  (`speed-rules.js`), sinon inconnue (aucun panneau, rien d'inventé ; agglomération jamais déduite). Calculée une fois
  par itinéraire. Alerte visuelle ; « Limite X » dit seulement si `settings.speedVoice` (non par défaut) et étiquette OSM.
- Limite d'une règle générale (v51) : mention « règle » neutre sous le panneau, couleurs du panneau inchangées.
- Directions (11b, `directions.js`, copie `data/directions-osm/` mêmes Action et cases, jamais précachée) : « direction X »
  seulement si UNE bretelle à 60 m du point de manœuvre au cap cohérent ; dit seulement sans autre bretelle à 60 m ;
  sinon consigne inchangée (jamais devinée). `maneuverText(m, { spoken })` : affiché ≠ dit.
- Écran de navigation v53 : boutons ronds de la colonne 48 px (zone tactile ≥ 40 px, ces boutons seulement), pastille
  de la rue sous le véhicule, ligne de sortie (règle 11b, jamais dite), mémoire de l'itinéraire en IndexedDB (question
  > 12 h seulement à l'arrêt). Détail : skill `gabarit-interface`.
- Historique (phase 6, v56, `trip-history.js`) : trajet gardé à l'arrivée seulement (jamais en simulation), IndexedDB
  `gabarit-history` jamais bloquant, aucune coordonnée, inclus dans l'export (`history`) ; notes d'aires (`areaNotes`)
  saisies à l'arrêt seulement, jamais dites ; relevé PDF par `@media print`.
- Pendant le guidage, aucune saisie à l'écran (Code de la route art. R412-6-2 : écran permis s'il aide à la navigation),
  sauf une étape ajoutée à l'arrêt seulement (v55 ci-dessous).
- Étapes (v55, `stops.js`) : 10 au plus, un seul calcul ORS avec tous les points (budget 3, jamais
  `alternative_routes`) ; 150 km = somme des tronçons à vol d'oiseau (`crowPath`, mesure d'ORS) ; « Étape atteinte. »
  phrase fixe ; recalcul, « Autres itinéraires » et mémoire (`choice.stops`, optionnel) gardent les étapes restantes.
- « Éviter le tunnel » (5b, v48 aussi classe Euro interdite 5g) : à l'arrêt seulement (`avoidTunnelAllowed`, relevés GPS
  hors guidage `plan-park.js`, vitesse inconnue = grisé), une requête dans le budget de 3 avec les diagnostics 2f
  (`computeAvoidRoute`), carré 80 m, 150 km à vol d'oiseau ; jamais dit, rien dans le guidage.
- Textes officiels illisibles depuis le conteneur : Action « Textes officiels » (`tools/textes-officiels.json`, journal
  seulement, ne relance pas l'Action OSM) ; chiffre lu par OCR codé seulement s'il est recoupé.
- Satellite hors de France (7d, `SATELLITE_SOURCES`) : source codée seulement si conditions lues ET tuile réelle 200 +
  CORS vérifiées par l'Action (entrée `tiles`) ; sinon message, jamais une couche vide. Détail : skill `gabarit-interface`.
- « Autres itinéraires » (v44, `openAlternatives` d'`app.js`, panneau `#nav-alts`) : seulement à l'arrêt (`parkedState`),
  depuis la dernière position reçue vers l'arrivée, profil actif, même calcul que le départ (`fetchRouteOptions`,
  restrictions, tunnels v43) ; fermé dès que le véhicule roule (`onParkChange`) ; échec : message, rien de guidé.
- ORS : `bearings` n'est accepté que pour les profils vélo (pas de cap imposé au recalcul camion).
  Quota gratuit : 2 000 itinéraires/jour (dépassé → HTTP 403), 40/min (→ 429) ; recalcul au plus toutes les 30 s.
- Chrome n'autorise la voix qu'après une action de l'utilisateur : première phrase dans le geste « Démarrer ».
- Repère du véhicule (v45, `src/ui/vehicle-icon.js`) : camion vu de dessus par défaut (dessin maison, jamais un logo ni
  une icône copiée) ou flèche (`settings.vehicleIcon`) ; même taille, même centre, couleurs `--arrow-*`.
- Itinéraires alternatifs (`route-options.js`) : 3 requêtes ORS au plus par calcul. Le Recommandé est toujours la
  première fiche et la référence des écarts (préférence d'ORS, sauf choix A/N ci-dessous → « Préférence ORS »). `alternative_routes` (`target_count` ≤ 3,
  2 points seulement) uniquement si départ–arrivée ≤ 100 km **à vol d'oiseau** (ORS mesure ainsi, sinon erreur 2004) ;
  sinon, ou si ORS ne renvoie qu'un itinéraire : Plus court + Sans péage (Plus rapide si péages évités ou absents).
  Le choix se fait à l'arrêt ; le recalcul en guidage garde `preference`/péages de la variante choisie.
- « Recommandé » (2g, `road-class.js`) : parmi les itinéraires déjà calculés, la plus forte part autoroute + nationale
  (waycategory bit 1 = A ; N = waytype 1 + référence N de l'étape ; inconnu jamais N) à ≤ 15 % de durée du plus rapide
  (`ROUTE_PREF`), égalité → le plus rapide ; > 30 % de km sans nom ni référence → part inconnue, ordre d'ORS gardé.
  Péages hors calcul. Jamais une garantie : « la signalisation fait foi ».
  v43 : jamais un itinéraire par un tunnel interdit confirmé pour le profil (`confirmedTunnelBans` : Euro texte
  officiel ou exploitant, ADR avec matières dangereuses ; « à vérifier », « annoncée », classe vide : non) si une autre
  option calculée l'évite ; toutes → choix gardé + `ALL_TUNNELS_NOTE`. Sans requête de plus ; fiche, jamais la voix.
- Péages PL à l'étranger (5h, v49, `foreign-tolls.js`) : Autriche (GO-Maut 2026) seulement, taux du profil (champ
  « Essieux » `axles`, non précisé = les deux cas) et estimation « à vérifier, pas une facture », ligne grise, jamais dite.
- Contours des taxes PL (`data/taxes-pl.json`, v50) : Admin Express COG 2026 (Action « Contours IGN ») ; tout changement
  de contours doit laisser vert `tests/taxes-contours.test.js` (résultats 5h ter figés), sinon contours non remplacés.
- Carburant (phase 4, `fuel-stations.js`, `src/ui/fuel.js` chargé à la demande, jamais en cache) : data.economie.gouv.fr
  sans clé (CORS *, 50 000/jour), une requête par itinéraire (boîtes du trajet seulement), à l'arrêt seulement, jamais dit ;
  `settings.dieselPrice` (Réglages) reste le prix des fiches. Détail : skill `gabarit-interface`.
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
