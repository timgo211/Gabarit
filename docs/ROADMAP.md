# Feuille de route Gabarit

- [x] **Phase 1 — Base : réglages, véhicules, itinéraire camion**
  Réglages (clé ORS masquée + test, mode nuit auto/manuel, export/import JSON), profils véhicule multiples
  (hauteur, largeur, longueur, PTAC, essieu, ADR, vitesse max, conso, Crit'Air), départ GPS / arrivée avec
  autocomplétion, itinéraire `driving-hgv` avec éviter péages/ferries, résumé (distance, durée, arrivée, km à péage),
  messages d'erreur clairs, bandeau « la signalisation fait foi », PWA installable.

- [x] **Phase 2 — Navigation guidée**
  Suivi GPS, carte inclinée orientée route, zoom selon la vitesse, voix en français (Web Speech API),
  recalcul hors itinéraire, écran maintenu allumé (Wake Lock).
  En plus : annonces camion (≈ 1,5 km / 500 m / 120 m à 90 km/h), arrivée à 50 m, pas de recalcul à moins de 150 m
  de la destination, demi-tour annoncé prudemment une fois, simulation de trajet (Réglages › Test),
  403 « Quota du jour atteint » / « Clé refusée ou quota du jour atteint ».

- [x] **Phase 2b — Itinéraires alternatifs**
  Au calcul, jusqu'à 3 itinéraires camion (profil véhicule actif et ses restrictions) : option `alternative_routes`
  d'ORS pour un trajet de 100 km ou moins à vol d'oiseau (mesure d'ORS), sinon variantes calculées à part (Recommandé,
  Plus court, Sans péage — Plus rapide si les péages sont déjà évités ou absents), doublons supprimés, 3 requêtes
  maximum par calcul. Tous les tracés sur la carte (choisi en couleur, autres en gris), une fiche par itinéraire (nom,
  durée, distance, arrivée, km à péage, gazole et coût selon le prix saisi dans Réglages, écart avec le Recommandé) ;
  toucher un tracé ou sa fiche le sélectionne. Choix à l'arrêt uniquement : pendant le guidage rien ne change,
  le recalcul automatique garde les réglages de la variante choisie.

- [ ] **Phase 4 — Carburant**
  Stations le long du trajet via l'API ouverte prix-carburants (data.economie.gouv.fr, jeu
  `prix-des-carburants-en-france-flux-instantane-v2`), filtre « piste poids lourds » si le champ services le permet,
  tri par prix du gazole, détour estimé, mes stations « OK camion », coût carburant du trajet.

- [ ] **Phase 5 — Réglementation**
  ZFE (`aires.geojson` de la Base nationale BNZFE sur transport.data.gouv.fr, copié dans `data/` par une GitHub Action
  hebdomadaire) avec alerte selon ma vignette Crit'Air ; interdictions PL les week-ends et jours fériés ; temps de
  conduite et pauses (règlement CE 561/2006, affiché comme une aide : le chronotachygraphe fait foi) ; alerte vent fort
  (Open-Meteo). Vérifier chaque règle sur une source officielle avant de coder et la citer en commentaire.

- [ ] **Phase 5b — ADR (matières dangereuses)**
  Option ADR dans le profil véhicule : en plus de `hazmat` (déjà envoyé à ORS), code de restriction en tunnel (B, C, D
  ou E). Repérer les tunnels du trajet et leur catégorie (données OpenStreetMap, via Overpass), alerter avant le calcul
  si un tunnel est interdit à mon code et proposer un autre itinéraire. Rappel des interdictions de circulation propres
  au transport ADR. ORS ne gère que `hazmat` oui/non : vérifier dans la doc ce qui est possible et l'écrire. Sources
  officielles citées (accord ADR, arrêtés français).

- [ ] **Phase 5c — Passage de frontière : réglementation PL du pays**
  Repérer les changements de pays sur l'itinéraire (`extra_info: ["countryinfo"]` d'ORS). Avant le départ : liste des
  pays traversés avec une fiche par pays (vitesses PL, interdictions week-end et jours fériés, péage PL et son système,
  zones à faibles émissions ou vignettes, particularités ADR). Pendant le guidage : annonce vocale courte à l'approche
  de la frontière, sans saisie. Fiches dans `data/pays/*.json`, avec la source officielle et la date de vérification
  de chaque règle ; d'abord les pays voisins (BE, LU, DE, CH, IT, ES).

- [ ] **Phase 6 — Parkings et POI**
  Aires et parkings PL via Overpass (OpenStreetMap), prochain parking pendant la navigation ; historique des trajets,
  statistiques, relevé PDF via impression.

- [ ] **Phase 7 — Vue satellite**
  Bouton de couche « Plan / Satellite », hors guidage et pendant la préparation du trajet (repérer l'entrée camion d'un
  client ou d'un dépôt). France : photos aériennes de l'IGN (Géoplateforme `data.geopf.fr`, gratuites, sans clé,
  attribution IGN). Hors de France : seulement une source gratuite dont les conditions d'utilisation le permettent,
  vérifiées et citées ; sinon garder le plan. Petite phase, faisable plus tôt.

- [ ] **Phase 8 — Partager avec des amis**
  Avec le partage Android (Web Share API), sans serveur :
  - un itinéraire : lien qui ouvre Gabarit avec départ, arrivée et options pré-remplis, ou fichier GPX ;
  - un lieu ou une position ponctuelle (lien carte) ;
  - mes signalements : fichier à importer dans le Gabarit d'un ami (fusion sans doublons) ;
  - l'appli elle-même : son adresse, chacun avec sa propre clé HeiGIT gratuite.
  Le profil véhicule et la clé ne sont jamais partagés. Pas de position en direct (il faudrait un serveur).

- [ ] **Phase 3 — Mes signalements + Ma journée** (reportée : à faire en dernier)
  Signalement perso avec alerte vocale à l'approche. En roulant, un seul gros bouton qui marque la position (aucune
  saisie pendant le guidage, comme en phase 2 – R412-6-2) ; le type (pont bas, accès difficile, contrôle, parking,
  danger) et la note se choisissent à l'arrêt. Lieux enregistrés (domicile, dépôt, clients), tournée multi-arrêts,
  arrêt ajouté en route.
