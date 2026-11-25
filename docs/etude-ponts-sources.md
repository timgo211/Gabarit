# Étude : sources de limites de hauteur et de poids (ponts) hors OpenStreetMap

Étude sans code, lue le 24/11/2026. Aujourd'hui, Gabarit lit les hauteurs et les poids dans OpenStreetMap
(`maxheight`, `maxweight`, copies `data/ponts-osm/` et `data/poids-osm/` de l'Action « Données OSM », phases 12a et
12a bis). Cette étude cherche d'autres sources ouvertes, gratuites et sans clé, pour combler les trous d'OSM.
Aucune clé, aucun compte, aucune dépendance. Chaque fait a sa source ; « non trouvé » ou « non vérifié » quand c'est le cas.

Accès depuis le conteneur de développement (24/11/2026) :
- lisibles : `transport.data.gouv.fr` (API), `www.data.gouv.fr/api/1`, `static.data.gouv.fr`, `raw.githubusercontent.com`,
  `registry.npmjs.org`, `wiki.openstreetmap.org` ;
- refusés par le proxy : `dialog.beta.gouv.fr`, `tabular-api.data.gouv.fr`, les portails Opendatasoft des collectivités
  (data.cannes.fr, opendata.hauts-de-seine.fr, data.maine-et-loire.fr, data.lamayenne.fr, data.mulhouse-alsace.fr,
  opendata.aude.fr…), `geoservices.ign.fr`, `data.geopf.fr`, tout `mapillary.com`. Pour ces sites, les faits viennent du
  code officiel sur GitHub, des métadonnées de data.gouv.fr ou d'extraits de moteur de recherche (signalés comme tels).

## 1. transport.data.gouv.fr

L'API `https://transport.data.gouv.fr/api/datasets` (816 jeux le 24/11/2026) n'a qu'un jeu utile :
**DiaLog, « Base de données nationale de la réglementation de circulation »**. Aucun jeu départemental de hauteur ou de
poids n'y est publié : ils sont sur data.gouv.fr (section 2).

### DiaLog (jeu national)
- Fiche : https://transport.data.gouv.fr/datasets/base-de-donnees-nationale-de-la-reglementation-de-circulation
  (API par identifiant : `/api/datasets/64947a4af5faf2f1f9eee299` ; le slug répond « dataset not found »).
- Producteur : DiaLog, service de la DGITM. Licence Ouverte 2.0. Créé le 22/06/2023, mis à jour en continu
  (fiche : 08/03/2026 ; fichier relevé toutes les 6 h environ, dernier relevé 24/11/2026 18 h 17 UTC).
- Avertissement du producteur : « Les restrictions diffusées par DiaLog n'ont pas de valeur juridique. Seul l'arrêté fait foi. »
- Format : un XML DATEX II v3 (≈ 85,5 Mo pour toute la France, en croissance), public sans authentification
  (`GET /api/regulations/datex.xml`). Export CSV aussi, mais **sans géométrie ni chiffre** (colonnes lues dans
  `docs/public/api.md` du dépôt officiel MTES-MCT/dialog). Flux CIFS (Waze) : interdictions temporaires tous véhicules
  seulement, rien pour les PL.
- Contenu (code officiel) : la hauteur, la largeur, la longueur et le poids sont des *conditions sur le véhicule* d'une
  mesure (surtout `noEntry`) : `maxHeight`, `maxWidth`, `maxLength`, `heavyweightMaxWeight` (3,5 / 7,5 / 12 / 19 / 26 /
  32 / 44 t), Crit'Air, matières dangereuses ; géométrie GeoJSON dans l'extension `dx:geoJsonGeometry`.
- À vérifier : le gabarit XML écrit `lessThanOrEqualTo` pour la hauteur et le poids, alors que l'aide de l'interface dit
  « PTAC supérieur à ». Le sens exact doit être lu sur de vrais enregistrements avant tout usage.
- Couverture (nombre de collectivités) : **non trouvée** (`/api/stats` est sur `dialog.beta.gouv.fr`, bloqué).
- CORS : l'URL stable de data.gouv.fr répond 302 avec `access-control-allow-origin: *` ; la cible DiaLog n'a pas pu être
  testée. Taille trop grande pour la PWA : lecture possible seulement dans une Action (comme les copies OSM).

## 2. Jeux des départements et collectivités (data.gouv.fr)

Méthode : `https://www.data.gouv.fr/api/1/datasets/?q=…` (« limitation de tonnage », « limitation de hauteur »,
« gabarit », « ouvrages d'art », « ponts », « poids lourds », « restriction de circulation », « convois exceptionnels »,
« barrières de dégel », « réseau routier départemental »…), lu le 24/11/2026. CORS = contrôle `check:cors:allow-origin`
de data.gouv.fr (date du contrôle), sauf mention « testé ». « Champs lus » = fichier téléchargé et ouvert.

### 2.1 Limite chiffrée et géolocalisée

| Producteur | Jeu | Format | Licence | Mise à jour | Couverture | Champs lus | CORS |
|---|---|---|---|---|---|---|---|
| Département de la Lozère | [Limitations de gabarit et de tonnage](https://www.data.gouv.fr/datasets/limitations-de-gabarit-et-de-tonnage) | GPKG 754 Ko, PDF | Licence Ouverte 2.0 | 06/10/2026 | RD de Lozère, EPSG:2154 | Oui : 76 tronçons, `hauteur` (27, de 2,1 à 4,5 m), `longueur`, `ptac` (24), `limitation`, lien vers l'arrêté | `*` (08/10/2026) |
| Département de la Charente-Maritime | [Arrêté Poids Lourds](https://www.data.gouv.fr/datasets/arrete-poids-lourds) | GeoJSON 4,9 Mo | Licence Ouverte 2.0 | 24/11/2026 | RD, 438 tronçons | Oui : code de panneau (B13, B18c, B8, B12…) ; valeur en **texte libre** (« >26t », « 4,1m ») ; « non exhaustives » | `*` (21/11/2026) |
| Ville d'Antibes | [Arrêtés permanents de circulation marchandises](https://www.data.gouv.fr/datasets/arretes-permanents-de-circulation-pour-le-transport-de-marchandises-a-antibes-juan-les-pins) | CSV 136 Ko (Latin-1), XLSX | ODbL | 31/08/2026 | Commune ; schéma national Cerema | Oui : 124 lignes, `VEH_TONNAGE`, `VEH_HAUT` (14, de 1,90 à 4 m), `GEOM_WKT` | `*` (testé) |
| Département des Hauts-de-Seine | [Gabarits et limitation de poids des ponts](https://www.data.gouv.fr/datasets/gabarits-et-limitation-de-poids-des-ponts) | CSV, GeoJSON, SHP | Licence Ouverte | 11/06/2025 | Ponts des RD 92 (valeurs « imposées par les panneaux ») | Non (portail bloqué) | `*` (02/2026) |
| Département de la Mayenne | [Limitations de hauteur sur les RD](https://www.data.gouv.fr/datasets/limitations-de-hauteur-sur-les-routes-departementales) / [de tonnage](https://www.data.gouv.fr/datasets/limitations-de-tonnage-sur-les-routes-departementales) | CSV, GeoJSON | Licence Ouverte 2.0 | 15/06/2026 | Tronçons RD, issus des arrêtés | Non | `*` (02/2026) |
| Département de Maine-et-Loire | [Limitation de gabarit](https://www.data.gouv.fr/datasets/limitation-de-gabarit-en-maine-et-loire) / [de tonnage](https://www.data.gouv.fr/datasets/limitation-de-tonnage-en-maine-et-loire) | CSV, GeoJSON, SHP | Licence Ouverte 2.0 | 30/09/2026 | Réseau départemental | Non | `*` |
| Département de l'Ain | [RD gabarit](https://www.data.gouv.fr/datasets/rd-gabarit) / [RD limitation tonnage](https://www.data.gouv.fr/datasets/rd-limitation-tonnage) | CSV, GeoJSON, KML, SHP | Licence Ouverte 2.0 | 15/04/2026 | RD (« informations non contractuelles ») | Non | `*` (exports, 11/2026) |
| Département des Alpes-Maritimes | [Limitations de gabarit sur les RD](https://www.data.gouv.fr/datasets/limitations-gabarit-les-routes-departementales-des-alpes-maritimes) | GPKG 2,5 Mo | Licence Ouverte 2.0 | 29/04/2026 | RD 06, EPSG:2154 | Non | `*` (GPKG, 05/2026) |
| Département de l'Aude | [Restrictions de circulation permanentes hors chantiers](https://www.data.gouv.fr/datasets/restrictions-de-circulation-permanentes-hors-chantiers) | CSV, GeoJSON, SHP | Licence Ouverte 2.0 | 23/11/2026 | RD 11 ; hauteur et poids non confirmés | Non | `*` |
| Mairie de Cannes | [Limitation de hauteur](https://www.data.gouv.fr/datasets/limitation-de-hauteur) / [de gabarit](https://www.data.gouv.fr/datasets/limitation-de-gabarit) | CSV, GeoJSON | Licence Ouverte 2.0 | 01/11/2026 | Commune | Non | `*` |
| Mulhouse Alsace Agglomération | [Limitation de tonnage](https://www.data.gouv.fr/datasets/limitation-de-tonnage-sur-les-voies-et-places-de-mulhouse) | CSV, GeoJSON | Licence Ouverte 2.0 | 14/04/2026 | Voies et places | Non | `*` |
| Nantes Métropole | [Panneaux restrictions de tonnages](https://www.data.gouv.fr/datasets/panneaux-restrictions-de-tonnages-de-nantes-metropole) | CSV, GeoJSON | Licence Ouverte 2.0 | 24/08/2022 | Points (panneaux, inventaire 2020-2021) | Non | `*` |
| Métropole Européenne de Lille | [Limitation de tonnage](https://www.data.gouv.fr/datasets/limitation-de-tonnage-des-voies-metropolitaines-1) | WMS, WFS, OGC API | **non précisée** | 15/04/2026 | Voies métropolitaines | Non | variable |
| Grenoble-Alpes Métropole | [Limitation de hauteur](https://www.data.gouv.fr/datasets/informations-de-limitation-de-hauteur-sur-les-voiries-du-terri) | GeoJSON, CSV | ODbL | 07/06/2025 | Métropole, communes, Département 38 | Non | ressources en 404 (11/2026) |

### 2.2 Chiffré mais peu exploitable
- Cerema, [Programme National Ponts](https://www.data.gouv.fr/datasets/programme-national-ponts-donnees-publiques)
  (CSV 32,9 Mo, Licence Ouverte 2.0, 24/11/2025, 92 départements) : 63 455 ponts **communaux** ; « PTAC limite » chiffré
  (9 501) ; tirant d'air **en classes** seulement (« < 4m »…), même au-dessus d'un cours d'eau : inutilisable comme hauteur.
- Charente-Maritime, [Ouvrages d'art](https://www.data.gouv.fr/datasets/ouvrages-dart-geres-par-le-departement-charente-maritime) :
  sens de `gabarit_hauteur` non documenté (sans doute l'ouverture de l'ouvrage, pas une limite affichée) ; `limitation_charge` pour 78.
- Finistère, [Ouvrages d'art](https://www.data.gouv.fr/datasets/liste-des-ouvrages-dart-du-departement-du-finistere) : sans coordonnées.
- Barrières de dégel (Saône-et-Loire 2018 sans coordonnées ; Meuse 2022, licence non précisée) : saisonnières.
- Cantal (2014) : fiche sans ressource.

### 2.3 Réseau ou liste seulement
Réseaux de convois exceptionnels (Isère, Calvados, MEL, Rennes, plusieurs DDT), ouvrages d'art sans limite (Grand Paris
Seine Ouest, Loire-Atlantique, Hérault…), gabarit ferroviaire SNCF, « Base ouverte des ponts de France » (copie d'OSM).
Aucune limite chiffrée par point.

### 2.4 Schéma national
Schéma Cerema « arrêtés permanents de circulation marchandises »
(http://schema.data.gouv.fr/CEREMA/schema-arrete-circulation-marchandises) : `VEH_TONNAGE`, `VEH_HAUT`, `VEH_LARG`,
`VEH_LONG`, `GEOM_WKT`. Nombre de jeux qui l'utilisent : non trouvé (requête coupée).

## 3. Jeu national

- **DiaLog** (section 1) : seul jeu national de restrictions réglementaires trouvé ; couverture inconnue.
- **IGN BD TOPO** (https://www.data.gouv.fr/datasets/bd-topo-r, Licence Ouverte 2.0, v3.5, 12/11/2026) : le code officiel
  de l'IGN (`IGNF/route-graph-generator`, `sql/bdtopo_v3.3.sql`) lit sur les tronçons `restriction_de_hauteur`,
  `restriction_de_poids_total`, `restriction_de_poids_par_essieu`, `restriction_de_largeur`, `restriction_de_longueur`,
  `matieres_dangereuses_interdites`. Remplissage, source et fiabilité **non vérifiés** (documentation IGN bloquée).
  Téléchargement par département (Shapefile / GPKG), taille et CORS non vérifiés.
- « État général des ouvrages d'art » du réseau national non concédé : statistiques seulement, rien par pont.
- Aucun « référentiel national des ouvrages d'art » public trouvé. ROUTE 500 : non vérifié.

## 4. Mapillary (panneaux)

Site entier refusé depuis le conteneur : faits tirés du code officiel (GitHub, npm), du wiki OSM et d'extraits de recherche.
- Licence : images en CC BY-SA 4.0, permission spéciale pour dériver des données pour OSM (wiki OSM « Mapillary », lu).
  Licence des détections (panneaux) hors OSM : **non trouvée**.
- Clé : un compte et une application enregistrée sont obligatoires pour obtenir un jeton client (README officiel de
  MapillaryJS, lu) ; toutes les requêtes API et tuiles (`tiles.mapillary.com/…?access_token=…`) en demandent un (code de
  l'éditeur iD, lu).
- Quotas : chiffres officiels non lus (le forum cite 50 000 tuiles par jour, non confirmé). Gratuit d'après les sources, conditions commerciales non vérifiées.
- Panneaux : classes `regulatory--height-limit--g1`, `regulatory--weight-limit--g1` à `g7`, `width-limit`, `length-limit`,
  `axle-limit`, `no-heavy-goods-vehicles` (paquet npm officiel `mapillary_sprite_source` 1.8.0). **Le chiffre n'est pas
  donné** : une détection dit « panneau de hauteur ici », sans « 3,5 m ».
- Fiabilité : seulement des chiffres de l'éditeur (98 % de détection, 2018) et « aucun algorithme n'est exact à 100 % ».

**Verdict Mapillary : non utilisable sans clé.** Un jeton client dans une PWA publique est une clé dans le code (interdit
par les règles du projet). Même avec un jeton, la détection ne donne pas la valeur de la limite.

## 5. Options

1. **Ne rien ajouter** : OSM seul, « à vérifier » comme aujourd'hui.
2. **Jeux départementaux** (2.1) copiés par une Action (comme les copies OSM, jamais précachés), département par
   département, seulement ceux à champs chiffrés lus et licence ouverte (Lozère, Antibes d'abord ; Mayenne, Maine-et-Loire,
   Ain, Hauts-de-Seine, Cannes, Mulhouse après lecture des champs par l'Action). Couverture faible (une douzaine de
   territoires), formats tous différents : un convertisseur par jeu.
3. **DiaLog** lu par une Action (85 Mo), mesures PL chiffrées extraites en petits fichiers par case. National et en
   croissance, mais couverture inconnue, sens de l'opérateur à vérifier, et « seul l'arrêté fait foi ».
4. **BD TOPO** : champs de restriction nationaux, à évaluer (remplissage, fraîcheur) avant tout.
5. **Mapillary** : écarté (jeton obligatoire, valeur absente).

## 6. Recommandation

Option 3 d'abord, en étude courte : une Action (journal seulement, comme « Textes officiels ») qui télécharge le XML
DiaLog et compte les mesures PL avec hauteur ou poids, les organisations et le sens de l'opérateur. Si la couverture est
utile, coder une copie DiaLog avec la même règle que les ponts OSM (fiche et carte à l'arrêt seulement, jamais dit,
« à vérifier »). Les jeux départementaux (option 2) restent un complément au cas par cas. Mapillary : non.
Rien n'est codé par cette étude.

## 7. Reste à décider (propriétaire)

- Étude DiaLog faite le 25/11/2026 (section 8) : coder ou non une copie DiaLog (recommandé : non pour l'instant).
- Ajouter ou non des jeux départementaux un par un (lesquels en premier).
- Évaluer ou non la BD TOPO (gros téléchargements par département).
- Afficher une source officielle « à vérifier » à côté d'OSM quand les deux diffèrent : quelle règle d'affichage.

## 8. DiaLog lu par l'Action (25/11/2026)

Action manuelle « Étude DiaLog » (`.github/workflows/dialog-etude.yml`, outil `tools/dialog-etude.mjs`, journal
seulement, rien gardé), lancement du 25/11/2026 07 h 09 UTC (run 45565976042, 1er essai). URL stable data.gouv.fr →
301 → 302 → `dialog.beta.gouv.fr/api/regulations/datex`, 200 `text/xml`. « Seul l'arrêté fait foi » : DiaLog n'a pas de
valeur juridique, la signalisation fait foi.

**Chiffres du journal**
- Fichier : 85 508 263 o (81,5 Mo), `publicationTime` 24/11/2026 15 h 30 UTC ; 6 983 règlements, 9 449 mesures.
- Conditions sur le véhicule visé : hauteur 271, poids 2 905, largeur 59, longueur 241. Permanentes (sans date de fin) :
  267 / 2 894 / 59 / 241 ; temporaires : 4 / 11 / 0 / 0. En vigueur le 25/11/2026 : 271 / 2 904 / 59 / 241 (périodes
  jour/heure récurrentes non comptées). Aucune condition en dérogation (`negate=true`) sur ces quatre grandeurs.
- **Mesures avec hauteur ou poids : 3 150** (permanentes 3 136, temporaires 14, en vigueur 3 149, toutes avec géométrie).
- Types de mesure : `noEntry` 3 930, `speedLimit` 2 755, stationnement interdit 2 504, circulation alternée 173,
  interdiction de dépasser 87. Véhicules visés par mesure : tous véhicules 5 889, poids lourd seul 2 807, poids lourd
  et/ou gabarit 548, autres 159, poids lourd avec d'autres types 46. Matières dangereuses : 43 mesures.
- Géométrie : GeoJSON sur 9 449 / 9 449 mesures (MultiLineString 6 525, LineString 6 363, GeometryCollection 258,
  Point 138, Polygon 31, MultiPoint 11), aucune illisible.
- Hauteur ou poids : boîte 42,88–51,04 N, −4,61–7,74 E, 59 cellules d'un degré ; les plus remplies : 45N 4E 881 (Lyon),
  44N −1E 391 (Bordeaux), 43N 5E 284 (Marseille), 48N 2E 240 (Paris), 48N −5E 218 (Brest), 45N 0E 146 (Angoulême),
  50N 2E 138 (Béthune), 45N 6E 111 (Annecy), 43N 1E 109 (Toulouse), 49N 4E 77 (Reims).
- Organisations : 251, dont 161 avec hauteur ou poids. En tête (hauteur ou poids / mesures) : Lyon (métropole)
  845/1 040, Bordeaux Metropole (cub) 390/512, Métropole d'Aix-Marseille-Provence (AMP) 282/298, Brest Métropole
  213/2 634, Sarthe (département) 153/995, CA du Grand Angoulême 142/144, CA de Béthune-Bruay, Artois-Lys Romane
  126/132, Grand Annecy 112/115, Toulouse Metropole 100/100, CU du Grand Reims 81/99 (liste des 40 dans le journal).
- Zone Destord / Vosges (48,0–48,6 N ; 5,8–7,0 E) : **5 mesures**, dont Rosieres-aux-Salines (hauteur 3,4, beffroi,
  permanent), Frizon (« PONT FRAGILE », poids 3,5 t, permanent), Eloyes (poids 3,5 t, travaux, jusqu'au 31/12/2026).

**Sens de l'opérateur : tranché.** Les 3 477 conditions lues (hauteur, poids, largeur, longueur) ont toutes
`lessThanOrEqualTo`, aucune autre valeur : l'opérateur est écrit en dur dans le gabarit officiel
(`templates/api/regulations.xml.twig`), il ne porte donc aucune information. Les titres des arrêtés disent l'inverse
(« Interdiction aux véhicules de +7,5T… » à Maisse, « Circulation interdite aux véhicules de plus de 5 tonnes » à
Art-sur-Meurthe, « éviter le passage des semi-remorques sous le beffroi » avec 3,4 m), comme l'aide de l'interface
(« PTAC supérieur à… »). Lecture retenue : la valeur est le **maximum autorisé** ; l'interdiction vise les véhicules
au-dessus. Un usage éventuel devra ignorer l'opérateur. Le XML ne donne que le titre de l'arrêté, pas son texte.

**Couverture** : 161 collectivités sur un pays qui en compte des dizaines de milliers, surtout quelques métropoles
(Lyon, Bordeaux, Marseille, Brest, Toulouse) ; ailleurs presque rien (5 mesures sur la zone des Vosges). La plupart
des mesures « poids » sont des interdictions PL de centre-ville, pas des ponts ; 271 hauteurs seulement en France.

**Recommandation**
1. Ne pas coder de copie DiaLog maintenant : couverture trop inégale (métropoles), 271 hauteurs seulement, peu sur nos trajets.
2. Si un jour : petite copie (3 150 mesures) comme les ponts OSM (fiche et carte à l'arrêt, jamais dit, « à vérifier »,
   « seul l'arrêté fait foi »), valeur lue comme maximum, opérateur ignoré. Relancer l'étude dans 6 mois pour voir la croissance.
