# Gabarit — consignes pour Claude

**But** : PWA perso de GPS poids lourd (inspirée de POIDZ), utilisée sur une tablette Android.
Le propriétaire n'a pas de terminal : tout passe par ce dépôt et GitHub Pages (racine de `main`). Budget 0 €.

## Structure
- `index.html`, `manifest.webmanifest`, `sw.js` (service worker module), `icons/`
- `src/lib/` : logique pure, sans DOM, testable sous Node (requêtes ORS, lecture des réponses, erreurs, profils, stockage)
- `src/ui/` : interface (DOM, MapLibre, fetch) ; `src/app.js` assemble le tout
- `tests/` : `*.test.js` + `fixtures/` (réponses ORS/Pelias écrites d'après la doc)
- `docs/ROADMAP.md` : phases 1 à 6 ; `tools/make-icons.mjs` : génère les PNG

## Tester
```
node --test
```
(lancé aussi par `.github/workflows/tests.yml` à chaque push). Doit rester 100 % vert.

## Conventions
- HTML/CSS/JS vanilla, modules ES, sans framework, sans build, sans dépendance npm.
- Dépendances CDN à version épinglée (MapLibre GL JS 4.7.1 : `index.html`, `config.js`, `sw-routing.js`).
- Chemins **relatifs** partout (site servi sous un sous-dossier).
- URL d'API dans `src/lib/config.js`, sans slash final : `api.heigit.org/openrouteservice/v2` et `/pelias/v1`.
- ORS : profil `driving-hgv`, `options.vehicle_type: "hgv"`, `profile_params.restrictions`, `maximum_speed` ≥ 80.
- Interface et messages en français, pensés pour la cabine (gros boutons, contraste, mode nuit).
- Toute modif de fichier mis en cache → incrémenter `VERSION` dans `sw.js` et ajouter le fichier à `APP_FILES`.
- Nouvelle logique → dans `src/lib/` avec ses tests ; règles réglementaires citées en commentaire avec la source officielle.

## Interdits
- Jamais de clé API dans le code, les tests, les fixtures, les commits ou les logs (clé saisie dans Réglages, localStorage).
- La clé n'est jamais exportée. Pas de `console.log` dans `src/`.
- Aucun test n'appelle une vraie API : fixtures uniquement.
- Le service worker ne met jamais en cache les réponses d'API, les tuiles ou les styles de carte.
- Pas de service payant ni de clé pour la carte.
