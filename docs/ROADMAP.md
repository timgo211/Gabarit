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

- [ ] **Phase 3 — Mes signalements + Ma journée**
  Signalement perso avec alerte vocale à l'approche. En roulant, un seul gros bouton qui marque la position (aucune
  saisie pendant le guidage, comme en phase 2 – R412-6-2) ; le type (pont bas, accès difficile, contrôle, parking,
  danger) et la note se choisissent à l'arrêt. Lieux enregistrés (domicile, dépôt, clients), tournée multi-arrêts,
  arrêt ajouté en route.

- [ ] **Phase 4 — Carburant**
  Stations le long du trajet via l'API ouverte prix-carburants (data.economie.gouv.fr, jeu
  `prix-des-carburants-en-france-flux-instantane-v2`), filtre « piste poids lourds » si le champ services le permet,
  tri par prix du gazole, détour estimé, mes stations « OK camion », coût carburant du trajet.

- [ ] **Phase 5 — Réglementation**
  ZFE (`aires.geojson` de la Base nationale BNZFE sur transport.data.gouv.fr, copié dans `data/` par une GitHub Action
  hebdomadaire) avec alerte selon ma vignette Crit'Air ; interdictions PL les week-ends et jours fériés ; temps de
  conduite et pauses (règlement CE 561/2006, affiché comme une aide : le chronotachygraphe fait foi) ; alerte vent fort
  (Open-Meteo). Vérifier chaque règle sur une source officielle avant de coder et la citer en commentaire.

- [ ] **Phase 6 — Parkings et POI**
  Aires et parkings PL via Overpass (OpenStreetMap), prochain parking pendant la navigation ; historique des trajets,
  statistiques, relevé PDF via impression.
