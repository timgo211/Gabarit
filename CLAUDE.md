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
- Toute modif de fichier mis en cache → incrémenter `VERSION` dans `sw.js` et ajouter le fichier à `APP_FILES`.
- Version en bas de Réglages (`#app-version`) : demandée au service worker qui contrôle la page (`GET_VERSION`, `src/lib/app-version.js`), seule source `VERSION` de `sw.js` ; sans réponse → « version inconnue ».
- Nouvelle logique → dans `src/lib/` avec ses tests ; règles réglementaires citées en commentaire avec la source officielle.
- Guidage : toute position (GPS réel ou simulation) passe par `updateNavigation` ; l'UI ne prend aucune décision.
  Hors itinéraire (`NAV`) : détection seulement à ≥ 10 km/h avec une précision ≤ 30 m ; à l'arrêt hors du tracé,
  recalcul seulement proposé (bouton « Recalculer d'ici », `requestReroute`) : l'itinéraire ne change jamais sans
  accord hors d'une vraie sortie de route en roulant.
- Pendant le guidage, aucune saisie à l'écran (Code de la route art. R412-6-2 : écran permis s'il aide à la navigation).
- ORS : `bearings` n'est accepté que pour les profils vélo (pas de cap imposé au recalcul camion).
  Quota gratuit : 2 000 itinéraires/jour (dépassé → HTTP 403), 40/min (→ 429) ; recalcul au plus toutes les 30 s.
- Chrome n'autorise la voix qu'après une action de l'utilisateur : première phrase dans le geste « Démarrer ».
- Itinéraires alternatifs (`route-options.js`) : 3 requêtes ORS au plus par calcul. Le Recommandé (préférence par
  défaut d'ORS) est toujours la première fiche et la référence des écarts. `alternative_routes` (`target_count` ≤ 3,
  2 points seulement) uniquement si départ–arrivée ≤ 100 km **à vol d'oiseau** (ORS mesure ainsi, sinon erreur 2004) ;
  sinon, ou si ORS ne renvoie qu'un itinéraire : Plus court + Sans péage (Plus rapide si péages évités ou absents).
  Le choix se fait à l'arrêt ; le recalcul en guidage garde `preference`/péages de la variante choisie.
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
