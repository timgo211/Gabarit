# Gabarit

GPS poids lourd personnel, en application web installable (PWA). Gabarit calcule des itinéraires adaptés au gabarit
du camion (hauteur, largeur, longueur, poids, charge à l'essieu, matières dangereuses) avec OpenRouteService, sur
un fond de carte OpenFreeMap. Gratuit, sans serveur, données gardées sur la tablette.

> Restrictions basées sur OpenStreetMap : la signalisation fait foi.

## 1. Activer GitHub Pages (une seule fois, depuis la tablette)

1. Sur GitHub, ouvre le dépôt → **Settings** (sur mobile : menu « … » → Settings).
2. Dans le menu de gauche : **Pages**.
3. **Source** : « Deploy from a branch ». **Branch** : `main`, dossier `/ (root)` → **Save**.
4. Attends 1 à 2 minutes : l'adresse du site s'affiche en haut de la page Pages, du type
   `https://<ton-compte>.github.io/<nom-du-dépôt>/` (respecte les majuscules du nom du dépôt).

Chaque fusion dans `main` republie le site automatiquement. L'onglet **Actions** montre aussi les tests
(coche verte = tout va bien).

## 2. Obtenir la clé OpenRouteService (gratuite)

1. Crée un compte gratuit sur le site HeiGIT / openrouteservice.
2. Dans ton tableau de bord, copie la clé (« API key » / token).
3. Dans Gabarit : **⚙ Réglages → Clé OpenRouteService** → colle la clé → **Tester**.
   La clé reste uniquement sur la tablette. Elle n'est jamais envoyée sur GitHub ni incluse dans les exports.

L'appli utilise `https://api.heigit.org/openrouteservice/v2` (itinéraires) et `https://api.heigit.org/pelias/v1`
(recherche d'adresses). Le quota gratuit est journalier : en cas de dépassement, un message l'indique.

## 3. Installer l'appli sur la tablette Android

1. Ouvre l'adresse du site dans **Chrome**.
2. Menu **⋮** → **Installer l'application** (ou « Ajouter à l'écran d'accueil »).
3. Lance **Gabarit** depuis l'écran d'accueil : elle s'ouvre en plein écran, en portrait ou en paysage.
4. Autorise la **localisation** quand Chrome la demande (départ = ta position GPS).

**Mises à jour** : quand une nouvelle version est publiée, un bandeau jaune
« Nouvelle version disponible, toucher pour recharger » apparaît. Touche-le.

**Sauvegarde** : Réglages → **Exporter (JSON)** enregistre véhicules, lieux, signalements et trajets dans
Téléchargements. **Importer…** les restaure (par exemple sur une nouvelle tablette). Pense à ressaisir la clé.

## 4. Utilisation

- **🚚 (en haut)** : choisir, créer ou modifier un profil véhicule. Le profil actif sert au calcul.
- **Départ** : vide = ta position GPS (📍 pour la rafraîchir), ou tape une adresse et choisis dans la liste.
- **Arrivée** : tape au moins 3 lettres, puis choisis une suggestion.
- **Éviter péages / ferries**, puis **Calculer l'itinéraire** : la carte et le résumé s'affichent (distance, durée,
  heure d'arrivée, km à péage, gazole estimé).
- **Réglementation** : chaque fiche d'itinéraire signale les ZFE interdites à ta vignette Crit'Air (Base nationale
  des ZFE, mise à jour chaque lundi par l'onglet Actions) et les interdictions PL des week-ends et jours fériés
  (plus de 7,5 t) ; **Éviter la ZFE** propose un itinéraire qui la contourne. En guidage : bandeau et voix, sans rien
  à toucher. Situation du camion (concerné, article 4, véhicule spécialisé) dans le profil 🚚. La signalisation et
  les arrêtés font foi.
- **Temps de conduite et pauses** (règlement CE 561/2006) : pendant le guidage, une ligne indique la conduite depuis
  la dernière pause et la journée (« Conduite 3 h 12 · pause de 45 min dans 1 h 18 ») ; voix 30 min avant 4 h 30.
  À l'arrêt, **Pas une pause (travail)** retire l'arrêt du décompte (chargement…). Aide seulement : le
  chronotachygraphe fait foi.
- **Vent fort** : rafales prévues à l'heure de passage (Open-Meteo), seuil réglable (80 km/h par défaut) ; fiche,
  bandeau et voix. « Météo indisponible » si la prévision ne répond pas.
- **Mode nuit** : automatique de 20 h à 7 h, ou forcé dans Réglages.

## Pour le développement

- Aucun outil à installer : HTML/CSS/JS en modules ES, MapLibre GL JS 4.7.1 par CDN.
- Tests : `node --test` (exécutés automatiquement par GitHub Actions).
- Voir [CLAUDE.md](CLAUDE.md) pour les conventions et [docs/ROADMAP.md](docs/ROADMAP.md) pour les phases.
