---
name: gabarit-aires
description: Règles des aires et parkings PL (phases 9 et 9b) : Overpass, copie data/aires-osm, jeu officiel Bison Futé, placement sur le tracé, annonces, « Mon avis ». À utiliser avant de toucher aux aires.
---

# Aires et parkings PL

(Texte déplacé tel quel depuis CLAUDE.md.)

- Aires PL, copie (phase 9b) : Overpass échoue au-delà d'environ 500 km (mesuré sur 520 km) → `data/aires-osm/` :
  `index.json` (`updated`, `grid` : zone couverte en cellules de 0,1° en base64, cellule couverte si elle et ses 8
  voisines sont dans les contours `.poly` de Geofabrik ; `tiles` : cases non vides et leur nombre d'aires) + une case
  `E_N.json` par degré (coin sud-ouest), aires compactes (`compactArea` / `expandArea`). Filtre osmium
  `nwr/highway=rest_area,services`, `nwr/amenity=parking`, `nwr/capacity:hgv` (jamais `hgv=*` global : toutes les
  routes), parkings gardés en JS si `hgv=yes/designated` ou `capacity:hgv` (`isAreaTags`). Identifiants osmium « a » :
  voie = 2 × id, relation = 2 × id + 1 → mêmes identifiants qu'Overpass (`osm:w123`, ids des parkings rattachés
  gardés) : « Mon avis » reste sur la même aire. Appli : tracé lu tous les 500 m, cases à 1 km autour des points
  couverts, Overpass seulement pour les morceaux hors zone (une requête, `buildOverpassQuery(morceaux)`, cache
  `hors-copie:`), jamais dans la zone couverte ; index ou case absent / vide / illisible → « Aires indisponibles sur
  ce trajet (données non chargées) », sans repli Overpass ; date de la copie dans la note (« ODbL, copie du
  JJ/MM/AAAA ») et sur la fiche. Fichiers de `data/aires-osm/` hors `APP_FILES` (lus seulement pour les cases du
  trajet). ui-check : copie simulée (`osmCopy` : 'fixture', 'uncovered', null). Test statique : `grid.bits` de
  `index.json` exclu de la recherche de clés. Premier passage : 19 285 aires, 1,39 Mo, 72 min (13 pays).
- Aires PL (phase 9) : une seule requête Overpass par calcul (phase 9b : seulement hors copie), pour tous les
  itinéraires proposés (`combineRoutes` : A, B à l'envers, C ; tracé simplifié ≤ 400 points, écart ajouté au rayon) ; rayons 400 m (aires de repos / de
  service) et 800 m (parkings `hgv=yes/designated` ou `capacity:hgv`) ; `OVERPASS_ENDPOINTS` : overpass-api.de puis
  overpass.private.coffee (échec ou 30 s) avant « Aires indisponibles » ; résultat dans `localStorage`
  (`gabarit.areasCache`, 5 trajets, 7 jours), jamais dans le cache du service worker (POST ignoré). Changer
  d'itinéraire ou recalculer en route : aires replacées sans requête. Aire de repos / service / officielle à plus de
  25 m à gauche du tracé : gardée en gris « autre sens ? », hors des « Prochaines aires » et sans annonce (on roule à
  droite, R412-9) ; parking PL : des deux sens. Doublons OSM / officiel fusionnés à 300 m (places, prix, sécurité
  officiels). Guidage : `view.nextAreas` (3, une aire dépassée de moins de 500 m reste), annonce une fois sous 10 km
  (pas sous 2 km) si `settings.areaVoice` ; encart ouvert / fermé d'un appui, ligne = fiche,
  reconstruite seulement si ses textes changent (distance arrondie à 50 m sous 1 km) et, à l'arrêt, figée avec les
  mêmes aires (une fois par minute, `nextAreasChanged`) ; « Mon avis » (Plein,
  Quelques places, OK) sous 10 km/h en guidage (`canReport`), `data.areaReports` exporté, retrouvé par identifiant
  ou à 150 m. Jeu officiel : Bison Futé, Licence Ouverte ; tableurs non lisibles par le navigateur → Action ;
  titres cherchés dans les 5 premières lignes, en français ou en anglais (xlsx concédé 2025 : ligne 1 date + titres
  FR, ligne 2 titres EN du règlement 885/2013) ; colonnes par références de cellule (cellules vides) ; nom
  « Nom :: CP :: Ville » (`splitName`), position « 46°01821, 6°11771 » (° = virgule décimale, `parseOfficialPosition`),
  route « A41 N / GENEVE » (`splitRoad`), places gratuites + payantes ; identifiant sans colonne d'id = nom + route.
  Réseau non concédé (ods 2018) : sens « + » / « - » / « + / - » jamais affiché (`cleanDirection`), routes « A0016 »
  → « A16 » (`normalizeRoad`), appliqués aussi à la lecture de `data/aires-pl.json` ; positions non lues listées
  avec leur texte brut dans le journal de l'Action (`unreadable`), vides comptées à part (« position absente »).
  `data/` : exclu de l'heuristique « longue chaîne » du test statique pour les identifiants « mot_mot_… ».
  xlsx et ods traités à part (l'un en échec : l'autre enregistré, ancienne copie gardée, avertissement) ; l'Action
  n'échoue que si les deux échouent. Fixture `official-sca-2025-*.xml` = lignes réelles lues par l'Action ;
  bison-fute.gouv.fr, transport.data.gouv.fr et overpass-api.de sont bloqués depuis le conteneur. Pas d'occupation en
  temps réel gratuite en France (Allemagne : SID / Mobilithek, pour plus tard).
