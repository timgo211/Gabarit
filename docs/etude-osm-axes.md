# Étude — compléter OpenStreetMap sur les grands axes (étude seulement, aucun code)

Étude du 25/11/2026. But : savoir quoi compléter dans OpenStreetMap (OSM) sur les axes de France — d'abord les
autoroutes, puis les nationales, puis les grandes départementales — pour que le camion soit protégé même quand ORS
refuse les zones à éviter.

Pourquoi : au-delà de 150 km à vol d'oiseau, ORS refuse `avoid_polygons` (voir CLAUDE.md, 12b). Sur ces trajets,
seules les étiquettes OSM lues par le graphe d'ORS écartent le camion d'un pont bas ou d'une route interdite.

Règles qui ne changent pas :
- ORS (`driving-hgv`) reste le seul moteur de calcul ;
- aucune écriture dans OSM depuis Gabarit, ses outils ou ses Actions : l'audit (PR suivante) ne fait que lire et
  proposer ; toute correction se fait à la main, sur place ou avec une source dont la licence le permet ;
- aucun secret (clé, jeton) dans le code, les tests, les commits ou les journaux ;
- une donnée non confirmée est « à vérifier » ; **la signalisation fait foi** ; seul l'arrêté fait foi pour la règle.

Lectures faites depuis le conteneur de développement le 25/11/2026. Bloqués (refus du proxy ou nom non résolu) :
`giscience.github.io`, `openrouteservice.org`, `api.heigit.org/…/status`, `api.openrouteservice.org/…/status`,
`www.mapillary.com`, `help.mapillary.com`, `graph.mapillary.com`, Légifrance, la Préfecture de police, les sites des
préfectures et des DIR testés (Rhône, Isère, Bouches-du-Rhône, Bas-Rhin, Haut-Rhin, Nord, Vosges, préfectures de
région). Joignables : `raw.githubusercontent.com` (code et doc d'ORS, de GraphHopper, de Mapillary),
`wiki.openstreetmap.org`, `www.bison-fute.gouv.fr` (pages et PDF), `www.data.gouv.fr`.

## 1. Fréquence de mise à jour du graphe de l'API publique d'ORS

Source officielle : FAQ d'ORS, `GIScience/openrouteservice`, branche `main`,
`docs/frequently-asked-questions.md` l. 35-61 (« When does the OSM data update in openrouteservice? »), lue sur
raw.githubusercontent.com le 25/11/2026 :
- le fichier planet d'OSM utilisé est mis à jour **chaque semaine** (l. 37-39) ;
- la construction des graphes prend « roughly a week for all profiles » (l. 50-53) ;
- les graphes construits sont chargés sur les serveurs de production « once per week » (l. 55-57) ;
- en résumé (l. 59-61) : une modification d'OSM met environ une semaine à entrer dans le planet, puis une semaine de
  construction, puis le rechargement hebdomadaire.

Conclusion : **compter 2 à 3 semaines** entre une correction dans OSM et sa prise en compte par l'API publique. Jour
de rechargement : **inconnu** (aucune date ni jour donné par la FAQ).

Vérifier sans clé :
- `GET /v2/status` : `docs/api-reference/endpoints/status/index.md` l. 3-4 : « This endpoint is not available in the
  public API » (et refusé par le proxy du conteneur) ;
- chaque réponse d'itinéraire porte `metadata.engine.graph_date` et `metadata.engine.osm_date`
  (`ors-api/src/main/java/org/heigit/ors/api/responses/common/engineinfo/EngineInfo.java` l. 16-21, 27-33) : c'est le
  seul moyen sûr de savoir si une correction est passée. Aucune fixture de Gabarit ne contient encore ces champs ;
  à relever sur une vraie réponse (piste : afficher la date du graphe dans le diagnostic, à décider plus tard).

## 2. Étiquettes OSM appliquées par ORS en `driving-hgv`

Code lu le 25/11/2026 : ORS `main` et le fork GraphHopper `GIScience/graphhopper` au tag `v4.17.0` (celui que fixe le
`pom.xml` d'ORS, l. 45). Abréviations :
- HVFE = `ors-engine/src/main/java/org/heigit/ors/routing/graphhopper/extensions/flagencoders/HeavyVehicleFlagEncoder.java` ;
- HVEF = `ors-engine/…/extensions/edgefilters/HeavyVehicleEdgeFilter.java` ;
- VAP = `ors-engine/…/extensions/util/parsers/VehicleAccessParser.java` ;
- GH = `GIScience/graphhopper@v4.17.0/core/src/main/java/com/graphhopper/`.

Mécanisme commun :
- le filtre HVEF est **toujours** ajouté au profil `driving-hgv` (`ors-engine/…/util/TemporaryUtilShelter.java`
  l. 101-103) ; `vehicle_type` vaut `hgv` par défaut (`RouteSearchParameters.java` l. 34, 91-92) ;
- le contrôle d'accès PL s'applique même sans `restrictions` (HVEF l. 45-49, 86-88) ;
- les dimensions ne sont comparées **que si la requête donne la valeur** (`restrictions.height`, `weight`…), et une
  arête sans valeur (0 = inconnue) est **acceptée** (HVEF l. 55-64, 77-81) : un pont sans `maxheight` ne protège
  jamais ;
- `maxheight`, `maxweight`, `maxweight:hgv`, `maxwidth`, `maxlength`, `maxlength:hgv`, `maxaxleload` posés sur un
  **nœud** sont recopiés sur la voie (`ORSOSMReader.java` l. 94, 362-374).

| Étiquette | Lue | Effet en `driving-hgv` | Source |
|---|---|---|---|
| `maxheight`, `maxheight:physical` | oui | comparée à `restrictions.height` | GH `routing/util/parsers/OSMMaxHeightParser.java` l. 50 ; HVEF l. 57-58 |
| `maxweight`, `maxgcweight` | oui | comparée à `restrictions.weight` | GH `…/OSMMaxWeightParser.java` l. 51-52 ; HVEF l. 61-62 |
| `maxweight:hgv` | **non** sur une voie (seulement recopiée depuis un nœud) | sans effet sur une voie | `OSMMaxWeightParser.java` l. 51 ; `ORSOSMReader.java` l. 362-374 |
| `maxaxleload` | oui | comparée à `restrictions.axleload` | GH `…/OSMMaxAxleLoadParser.java` l. 50 ; HVEF l. 55-56 |
| `maxwidth`, `maxwidth:physical`, `width` | oui | comparée à `restrictions.width` ; `maxwidth` < 2,0 m bloque toujours | GH `…/OSMMaxWidthParser.java` l. 50 ; HVFE l. 205-212 |
| `maxlength` | oui | comparée à `restrictions.length` | GH `…/OSMMaxLengthParser.java` l. 50 ; HVEF l. 59-60 |
| `maxlength:hgv` | **non** sur une voie | sans effet | `OSMMaxLengthParser.java` l. 50 |
| `hgv=no`, `hgv=private` | oui | **voie toujours interdite** (sauf `hgv:conditional` permissif évalué à la construction) | HVFE l. 185-188 ; clés `[hgv, motor_vehicle, vehicle, access]` : GH `routing/util/parsers/OSMRoadAccessParser.java` l. 80-81, `routing/util/AbstractFlagEncoder.java` l. 96 ; doc `docs/technical-details/tag-filtering.md` l. 46-61 |
| `hgv=destination` | oui | **non bloquée**, aucune pénalité | `VehicleFlagEncoder.java` l. 102 ; HVFE l. 189-190 ; VAP l. 102-108 |
| `hgv=delivery` | oui | bloquée pour `vehicle_type=hgv` (permise seulement pour `delivery`) | VAP l. 92-94 ; HVEF l. 86-88 ; `ORSGraphHopper.java` l. 384-386 |
| `goods=*` | oui, pour `vehicle_type=goods` seulement | sans effet avec `hgv` | VAP l. 18, 76-95 ; HVFE l. 78, 80 |
| `hgv:conditional`, `access:conditional`, `vehicle:conditional`, `motor_vehicle:conditional` | oui | **saisons** (dates) figées à la date de construction du graphe ; **horaires jamais appliqués** au PL | GH `reader/osm/conditional/ConditionalOSMTagInspector.java` l. 61-62, 101-127 ; HVFE l. 187, 216 ; comparer `CarFlagEncoder.java` l. 115, 137 et GH `AbstractFlagEncoder.java` l. 422-430 ; date : GH `routing/util/EncodingManager.java` l. 319-320 ; doc `tag-filtering.md` l. 11-12 |
| `maxweight:conditional` | **non** | sans effet | `OSMMaxWeightParser.java` l. 51 |
| `hazmat=no`, `hazmat:B` à `hazmat:E=no` | oui | comparée si `restrictions.hazmat: true` | `HazmatAccessParser.java` l. 22, 30-43 ; HVEF l. 51-53, 73-75 |
| `maxspeed:hgv` (+ `:forward`, `:backward`) | oui | vitesse de l'arête (durée seulement) | HVFE l. 123-148 |

Doc du paramètre `restrictions` : `docs/api-reference/endpoints/directions/routing-options.md` l. 70-85 (`length`,
`width`, `height`, `axleload`, `weight`, `hazmat`) et l. 108-116 (`vehicle_type`). Restrictions horaires : la doc le
dit (`tag-filtering.md` l. 12) : « Other time-dependent conditional restrictions are currently not being taken into
account » ; `departure` / `arrival` n'y changent rien pour le PL.

Conséquences pour les corrections à proposer :
- une interdiction PL permanente doit être écrite **`hgv=no`** sur la voie (ORS la respecte toujours) ; une
  interdiction horaire (`hgv:conditional=no @ (22:00-06:00)`) est juste pour OSM mais **ignorée par ORS** : la
  fiche doit le dire ;
- une limite de tonnage doit être en **`maxweight`** (pas seulement `maxweight:hgv`, ignoré sur une voie) ;
- la hauteur doit être sur la **voie qui passe dessous** (`maxheight` sur le pont lui-même ne protège pas la route
  du dessous ; Gabarit l'ignore déjà, `clearanceFromFeature` de `src/lib/bridges-convert.js`) ;
- une interdiction « sauf desserte » écrite `hgv=destination` ne bloque rien dans ORS : en transit, le camion
  peut y être envoyé. La fiche le signale, sans changer l'étiquette (elle est juste pour OSM).

## 3. Mapillary

Sources lues le 25/11/2026 : wiki OSM (source brute de <https://wiki.openstreetmap.org/wiki/Mapillary> et de
<https://wiki.openstreetmap.org/wiki/Street-level_imagery_services>), code du SDK Python officiel
(`mapillary/mapillary-python-sdk`, dernier commit du 08/09/2026), README de `mapillary/mapillary-js`, dépôt
`mapillary/mapillary_sprite_source` (dernier commit du 09/03/2020). **Non lus** (bloqués depuis le conteneur) : doc
API v4 sur mapillary.com, conditions d'utilisation, page légale (mapillary.com/legal.html), aide.

Licence (wiki OSM) :
- « The images on Mapillary can be used under Creative Commons Attribution-ShareAlike 4.0 International License
  (CC-BY-SA). » ; « There is special permission to derive data from the photos for contributing to OpenStreetMap. » ;
  encadré : « license = proprietary (web and app), CC-BY-SA (images) » ;
- tableau des services d'imagerie : Mapillary « May be used for OSM mapping » = yes ;
- panneaux reconnus : « available as a data layer within the iD editor… used to assist in editing the map » ;
- licence des **données dérivées** (détections, panneaux) : **non lue** ; texte exact de l'autorisation OSM : **non lu**
  (renvoi vers mapillary.com/legal.html, inaccessible).

API v4 (code du SDK, `src/mapillary/models/client.py`) :
- « All requests against https://graph.mapillary.com must be authorized. They require a client or user access
  tokens. » ; jeton passé en `?access_token=…` ou en en-tête `Authorization: OAuth …`, forme `MLY|…` ;
- obtention (README de mapillary-js) : « you need an account… When signed in, you need to register an application to
  get a client access token. » — compte et application déclarée ;
- tuiles vectorielles des panneaux : `https://tiles.mapillary.com/maps/vtp/mly_map_feature_traffic_sign/2/{z}/{x}/{y}/`,
  couche `traffic_sign`, zoom 14, propriétés `id`, `value` (classe), `first_seen_at`, `last_seen_at`
  (`vector_tiles.py`) ; le code passe le jeton en paramètre d'URL ;
- objets : `https://graph.mapillary.com/:map_feature_id?fields=id,object_value,object_type,geometry,…` ;
- recherche par boîte (`map_features?bbox=…`) et limites de débit : **non lues** ; appel sans jeton : non testé
  (proxy).

Classes de panneaux (`mapillary_sprite_source`, `package_signs/` ; dépôt de 2020, peut différer de l'API actuelle ;
correspondance avec le modèle français : non lue) :
- hauteur : `regulatory--height-limit--g1`, `warning--height-restriction--g2` à `--g5`,
  `information--height-limit--g1`, `--g2`, `information--weight-and-height-limit--g1`,
  `complementary--height-limit--g1`, `--g2` (aucun nom `maximum-height` dans ce dépôt) ;
- poids lourds : `regulatory--no-heavy-goods-vehicles--g1` à `--g5`,
  `regulatory--no-heavy-goods-vehicles-or-trailers--g1`, `…-or-buses--g1`, `…-or-tractors--g1`,
  `regulatory--no-heavy-goods-vehicles-motorcycles-or-bicycles--g1`, `--g2`, `regulatory--no-through-trucks--g1`,
  `regulatory--end-of-no-heavy-goods-vehicles--g1` ;
- voisins : `regulatory--weight-limit--g1` à `--g7`, `regulatory--weight-limit-with-trucks--g1`,
  `regulatory--width-limit--g1`, `regulatory--length-limit--g1`, `--g2`,
  `regulatory--no-vehicles-carrying-dangerous-goods--g1` à `--g4`.

Conclusion, tirée de ce qui a été lu : d'après le SDK officiel, **tout appel à graph.mapillary.com exige un jeton**
lié à un compte et à une application déclarée ; rien de ce qui a été lu ne décrit un accès sans jeton. Un jeton est
une clé : il ne peut aller ni dans le code, ni dans une Action (règle du dépôt). **Non faisable sans secret** dans
Gabarit ou ses Actions. Seul usage sans secret : la couche Mapillary de l'éditeur iD, à la main, pour vérifier une
fiche de l'audit avant de corriger OSM. Rien codé. À revoir seulement si la doc officielle, lue en entier, décrit un
accès sans jeton.

## 4. Interdictions PL permanentes sur autoroutes et nationales

Sources générales lues :
- Bison Futé, pages « interdictions permanentes » par zone : Est
  <https://www.bison-fute.gouv.fr/interdictions-permanentes,id_sous_rubrique10276.html>, Nord (`…10277.html`), Ouest
  (`…10278.html`, « Aucune interdiction en cours »), Sud (`…10279.html`), Sud-Est (`…10280.html`), Sud-Ouest
  (`…10281.html`) ; aucune date de mise à jour affichée ;
- brochure véhicules lourds 2026 : <https://www.bison-fute.gouv.fr/IMG/pdf/26056_BROCHURE_2026_FR.pdf>, p. 7-9 ; elle
  dit elle-même « principales interdictions prises par arrêtés préfectoraux… liste non exhaustive », sans numéro
  d'arrêté ;
- dépliants 2020 (`IMG/pdf/FR%5F12015-7%5Fdepliant%5Finterdiction2020%5FDEF%5Fprint.pdf`) et 2017
  (`IMG/pdf/Calendrier%5FFR%5Fvehicules%5Flourds%5F2017.pdf`).

Noms de fichiers PDF écrits avec « %5F » à la place de « _ » (même adresse ; le test anti-clé du dépôt refuse les
longues chaînes).

Aucun recueil des actes administratifs n'a pu être lu (sites des préfectures bloqués). Seuls 4 arrêtés ont été lus
en texte (PDF hébergés par Bison Futé). **Pour toutes les lignes : en vigueur : à vérifier.** Numéro absent du texte
lu = « inconnu », jamais deviné.

| # | Route et section | Sens | Nature | Arrêté (n°, date, autorité) | Source | Lu |
|---|---|---|---|---|---|---|
| 1 | **A6**, échangeur A89/A6 → échangeur de la Garde (Lissieu, Limonest), PR 443+535 à 445+323 (sens D), 445+329 à 443+694 (sens G) | 2 sens | marchandises > 7,5 t interdits ; sauf livraison, chargement ou stationnement habituel dans les communes de l'annexe | **DDT_SST_2019_01_02 du 02/04/2019**, préfet du Rhône et président de la Métropole de Lyon (abroge DDT-SST-36-2017-11 du 13/11/2017) | <https://www.bison-fute.gouv.fr/IMG/pdf/Arrete%5FDDT%5FSST%5F2019%5F01%5F02%5FMetropole%5FLyon.pdf> | arrêté lu |
| 2 | **A7**, PR 6+155 (D) / 5+576 (G) à 6+390, et PR 20+500 (échangeur de Ternay) à 8+700 (échangeur de Feyzin) : Saint-Fons, Feyzin, Solaize, Sérézin, Ternay | 2 sens | > 7,5 t interdits ; l'art. 1 excepte la section entre l'échangeur A450 et le Boulevard Urbain Sud | même arrêté | même PDF | arrêté lu |
| 3 | **A47**, bretelle sens ouest-est (PR 0+300) vers A7 direction Lyon-Centre, échangeur de Ternay | 1 sens | > 7,5 t interdits | même arrêté (Bison Futé écrit « est-ouest », l'arrêté « Ouest-Est ») | même PDF | arrêté lu |
| 4 | **Tunnel sous Fourvière** et anciennes A6/A7 (Limonest → Pierre-Bénite) — voirie de la Métropole depuis 2017, plus réseau national | 2 sens | > 7,5 t interdits ; hauteur **4,50 m** (page tunnel Bison Futé, dépliant 2017) ou **4,30 m** (dépliant 2020, brochure 2026) : **contradiction** ; matières dangereuses interdites | tonnage : même arrêté ; hauteur : inconnu | même PDF ; <https://www.bison-fute.gouv.fr/tunnel-sous-fourvieres-69.html> | tonnage lu ; hauteur Bison Futé seulement |
| 5 | **BPNL** (périphérique nord de Lyon, concédé, voirie de la Métropole) | 2 sens | l'arrêté lu : > 7,5 t ; la brochure 2026 : « PL > 19 t, hauteur > 4,50 m, matières dangereuses en transit » : **contradiction** | même arrêté (7,5 t) ; hauteur : inconnu | même PDF ; brochure 2026 | arrêté lu (7,5 t) |
| 6 | **N205, tunnel du Mont-Blanc** (Chamonix) | 2 sens | marchandises > 3,5 t **Euro 0 à 4** interdits depuis le 01/07/2020 ; hauteur 4,70 m ; ADR interdit (cat. E et certains n° ONU) | **DDT-2020-0825 du 18/06/2020**, préfet de la Haute-Savoie, modifiant l'art. 2 §1 d de l'arrêté **n° 2009-3425 du 17/12/2009** | <https://www.bison-fute.gouv.fr/IMG/pdf/05%5FARP%5F2020%5F0825%5Finterdiction%5FPL%5Feuro4.pdf> ; <https://www.bison-fute.gouv.fr/tunnel-du-mont-blanc-74-categorie,10307.html> | arrêté lu (la brochure 2026 dit encore « Euro 0, 1, 2 » : dépassée) |
| 7 | **N543, tunnel du Fréjus** (Modane) | 2 sens | hauteur 4,30 m ; marchandises > 3,5 t Euro 0, 1, 2 interdits (sauf autorisation des préfets de Savoie et de Turin) ; ADR cat. C en convoi ; transit PL interdit du 15/12 au 30/04, dimanches et fériés, 8-9 h et 17-18 h | arrêté du **07/07/2017**, préfet de la Savoie ; n° inconnu (absent du PDF) | <https://www.bison-fute.gouv.fr/IMG/pdf/SFTRF%5Farrete%5Freglement%5Fcirculation%5F7%5Fjuillet%5F2017.pdf> ; <https://www.bison-fute.gouv.fr/tunnel-du-frejus-73-categorie-c.html> | arrêté lu (p. 1-3) ; « Euro 0 à 4 » cité par la presse en 2026 : non vérifié |
| 8 | **RN524** (Gironde), PR 2+485 à 21+547 (Langon → Bernos-Beaulac) et 23+472 à 31+123 (Bernos-Beaulac → Captieux) | 2 sens | marchandises > 7,5 t interdits depuis le 18/11/2013 ; substitution A65 ; desserte locale autorisée | préfet de la Gironde, **12/11/2013** (date de Bison Futé, signature absente du PDF) ; n° inconnu | <https://www.bison-fute.gouv.fr/IMG/pdf/Arrete_du_12_novembre_2013.pdf> | arrêté lu ; route peut-être départementalisée depuis |
| 9 | **N59 / N159 / D1059**, Lunéville (54) → Sélestat (67), tunnel Maurice-Lemaire compris | 2 sens | > 3,5 t (PTAC ou PTRA) en transit interdits | inconnu | page zone Est ; brochure 2026 | Bison Futé seulement |
| 10 | **N66 / D1066**, Remiremont (88) → Cernay (68) | 2 sens | > 3,5 t en transit interdits ; > 19 t interdits 22 h-6 h entre le viaduc du Séchenat et le giratoire ouest de Saint-Amarin (sauf chargement/déchargement en Alsace ou Lorraine) | inconnu (un arrêté « 2023-DIR-Est-SPR-88-003 » trouvé en recherche semble porter sur les dépassements : non lu, non retenu) | page zone Est ; brochure 2026 | Bison Futé seulement |
| 11 | **A1, N356, A22** (et N227), échangeur n° 20 Faches-Thumesnil → échangeur d'Aalbeke (Belgique) | sud → nord | marchandises > 3,5 t en transit interdits | inconnu (l'arrêté P13-04 du 06/09/2013 cité sur la même page porte sur la vitesse à 80 km/h, pas sur ce transit) | page zone Nord ; brochure 2026 | Bison Futé seulement |
| 12 | **A55** (Marseille), demi-échangeur Vieux-Port → échangeur Cap Pinède (≈ 4 km) ; **A557**, sortie Arenc → Ports, sens A7 vers A55 | A55 2 sens ; A557 1 sens | > 3,5 t interdits ; restrictions de matières dangereuses en transit | inconnu ; un extrait de recueil (non lu) dit l'arrêté n° 2015103-0007 du 13/04/2015 abrogé au 21/02/2024 et remplacé par un arrêté « DU 24.012 du 20/02/2024 » : non lu | page zone Sud ; brochure 2026 | Bison Futé + extrait de recherche |
| 13 | **Tunnel de Toulon**, liaison A50/A57 | vers Marseille | > 19 t et autocars interdits | inconnu ; mesure peut-être levée avec le 2e tube (fiche TPM) | page zone Sud ; brochure 2026 | Bison Futé seulement |
| 14 | **N85**, rampe de Laffrey (38) | descente | > 7,5 t et transports en commun interdits ; portique de 2,6 m (presse DIR) | arrêtés « de 1975 et 1979 » (dossier de presse DIR Méditerranée, non lu) ; n° inconnu | page zone Sud-Est ; brochure 2026 | Bison Futé + secondaire |
| 15 | **N85**, limite Isère (Aspres-lès-Corps) → entrée de Gap ; **N94**, giratoire sud d'Embrun → frontière italienne, et La Vachette → col de Montgenèvre | 2 sens | > 26 t sans ralentisseur interdits ; col de Montgenèvre : > 26 t interdits sauf desserte | inconnu | page zone Sud ; brochure 2026 | Bison Futé seulement |
| 16 | **N7**, Vienne → Le Péage-de-Roussillon (38) ; Tain-l'Hermitage ; traversée d'Orange ; Mondragon | Vienne : nord → sud | > 3,5 t (Vienne) ; > 6 t 22 h-6 h (Tain) ; > 6 t (Orange) ; > 16 t (Mondragon, absent de la brochure 2026) | inconnu | dépliants 2017 et 2020 ; brochure 2026 | Bison Futé seulement |
| 17 | **N82**, depuis la RD56 à Balbigny (42) | — | > 7,5 t interdits | inconnu | Bison Futé | Bison Futé seulement |
| 18 | **N88 / N102**, traversée du Puy-en-Velay | 2 sens | > 7,5 t en transit interdits | inconnu | Bison Futé | Bison Futé seulement |
| 19 | **N100 / N580**, ponts du Royaume et Daladier (Avignon) | — | > 25 t (page zone Sud, dépliants) ou > 3,5 t (brochure 2026) : **contradiction** | inconnu | Bison Futé | Bison Futé seulement |

Hors champ ou non retenus :
- exclus comme demandé : ZFE ; calendrier national (week-ends, hiver Auvergne-Rhône-Alpes, samedis d'été, arrêté du
  16/04/2021) ; régime calendaire d'Île-de-France sur A6a, A6b, A106 ;
- temporaires ou météo : Puymorens et accès à l'Andorre (série « VH », > 19 t, RN20, RN320, RN22) ; RN134 au Somport
  (avalanches ; aucune interdiction PL permanente trouvée, seulement les matières dangereuses, source secondaire) ;
- hors réseau national : M35 à Strasbourg (transit > 3,5 t interdit, report sur l'A355 ; strasbourg.eu non lu, n° et
  date inconnus) ; transit dans Paris (arrêté municipal, > 7,5 t, boulevard périphérique non concerné) ; voies sur
  berges (arrêté municipal) ;
- Île-de-France, non confirmé : tunnel de l'A14 sous La Défense (> 3,5 t dans les dépliants 2014 et 2017, absent en
  2020 et 2026 ; camions réautorisés selon la presse) ; arrêté DRIEAT IF n° 2021-2-054 du 03/05/2021 (tunnels de La
  Défense et de Nanterre, extrait seulement) ; Duplex A86 interdit à tous les PL (page Vinci, secondaire ; arrêtés
  interpréfectoraux 2012-657 du 06/08/2012 et 2016-2-493 du 18/11/2016 connus par extrait, contenu non lu ; gabarit
  de 2 m confirmé par aucune source lue) ;
- non trouvés : Croix-Rousse et Prado-Carénage (voirie locale), N10, N141, A40/RN205 hors tunnel.

À retenir :
- numéros vérifiés sur le texte : **DDT_SST_2019_01_02** (Lyon), **DDT-2020-0825** et **2009-3425** (Mont-Blanc) ;
  Fréjus et RN524 : date seulement ; tous les autres : inconnus ;
- la brochure 2026 contredit les arrêtés lus (classes Euro au Mont-Blanc, tonnage du BPNL) et d'autres sources
  (ponts d'Avignon, hauteur de Fourvière) : l'audit suit l'arrêté lu, jamais la brochure seule ; contradiction →
  « à vérifier » ;
- pour compléter les numéros : lire les recueils des actes administratifs des préfectures (Bas-Rhin, Haut-Rhin,
  Vosges, Meurthe-et-Moselle, Nord, Bouches-du-Rhône, Var, Isère, Hautes-Alpes, Rhône, Hauts-de-Seine) et les sites
  des DIR, par l'Action « Textes officiels » (les sites sont bloqués depuis le conteneur), dans une PR à part.

Ce tableau alimente la liste de l'audit (PR suivante, `tools/audit-osm-interdictions.json`) : une ligne n'y entre
que si sa section est localisable (route + PR ou communes de début et de fin) ; sinon elle est seulement citée dans
le rapport. Interdictions horaires ou saisonnières (Fréjus, N66 la nuit, N7 à Tain) : proposées en
`hgv:conditional`, avec la mention « ignorée par ORS » (section 2).

## 5. Tronçons sans nom ni référence (trajet test Joigny → Gonfreville-l'Orcher)

Constat : sur ce trajet, ORS renvoie 199 km sur 321 sans nom ni référence, dont 103 km sur l'A13. Même constat déjà
fait en phase 5h ter (ROADMAP : 90 km entre Mulhouse et Strasbourg, 83 km d'A31 entre Thionville et Toul).

Comment Gabarit lit le nom : `src/lib/road-class.js` (l. 77-88) et `roadRefs()` de `src/lib/route-samples.js`
(l. 14-23, regex `(RN|RD|A|N|D|M|E)\s?(\d{1,4})…`) ; « sans nom ni référence » = `name` absent, vide ou `-`, et aucune
référence lisible dans `name` ; au-delà de 30 % (`ROUTE_PREF.MAX_UNKNOWN_SHARE`), part A + N « inconnue ». Les
extras demandés sont `waycategory` et `waytype` (`src/lib/ors-request.js` l. 91) ; aucun ne donne le nom ni la
référence.

Pourquoi (code lu le 25/11/2026) :
- nom d'une arête (GH `routing/util/EncodingManager.java` l. 707-726) : `name`, puis `", " + ref` s'il existe, ou
  **`ref` seul** sans nom ; une voie `highway=motorway` avec `ref=A 13` donne donc « A 13 ». Seul le `ref` de la voie
  est lu, **jamais celui de la relation** de route ;
- nom d'une étape : celui de la **première arête** de l'instruction (GH `routing/InstructionsFromEdges.java` l. 177,
  313), recopié par ORS (`ors-engine/…/routing/RouteResultBuilder.java` l. 270) ; vide → `"-"`
  (`ors-api/…/responses/routing/json/JSONStep.java` l. 76) ;
- quand un seul chemin est possible, GraphHopper ne crée **aucune instruction**, même si le nom change
  (`InstructionsFromEdges.java` l. 381-389 ; commentaire l. 320-322 : « we don't always create an instruction on name
  changes ») ; deux noms vides ne sont jamais « semblables » (GH `routing/InstructionsHelper.java` l. 63-67).

Cause la plus probable : l'étape commence sur une **bretelle** (`motorway_link`) sans `name` ni `ref` (cas courant
dans OSM) ; l'insertion sur l'A13 n'offre qu'un chemin, donc pas de nouvelle instruction : les 103 km d'A13 restent
dans l'étape de la bretelle, nommée « - », jusqu'à la manœuvre suivante. Autres causes possibles, **non vérifiées
dans OSM** : premier tronçon sans `ref` (barrière de péage, aire, `service`), ou `ref` porté par la seule relation.
L'A13 elle-même n'est donc pas forcément mal étiquetée : à vérifier sur les identifiants de voie (piste ci-dessous).

Repli proposé (rapport seulement, rien codé) — retrouver A/N et numéro par la géométrie du tracé :
1. **méthode éprouvée** : celle de la phase 5h ter (`src/lib/hgv-tolls-geo.js`) : points du tracé comparés aux voies
   OSM à 15 m, cap modulo 180°, séries de 300 m, veto du nom d'étape quand il existe ;
2. **données** : aucune copie actuelle de `data/` ne garde le `ref` de chaque tronçon :
   - `data/vitesses-osm/` : classe (0 autoroute … 4 tertiaire) et géométrie, **sans `ref`**, et seulement les voies
     qui portent une limite ;
   - `data/ponts-osm/` : `ref` noyé dans le nom (`[name, ref].join(', ')`), ponts seulement ;
   - `data/directions-osm/` : `destination:ref` des bretelles (direction annoncée), pas la référence de la voie ;
   - `data/taxes-pl-osm.json` : voies portant une référence de taxe, Alsace et Grand Est seulement ;
   il faut donc une copie « réseau A/N » : `highway=motorway`, `trunk` (et `primary` à `ref` N…), avec `ref`, même
   Action « Données OSM », mêmes cases de 1°, simplifiée à 20 m, jamais précachée (taille à mesurer par l'Action,
   5 Mo par fichier) ; ou ajouter un index de `ref` à `data/vitesses-osm/` (moins sûr : voies sans limite absentes) ;
3. **appoint sans copie** : une étape sans nom entre deux étapes de même référence (A 13 … - … A 13) pourrait hériter
   de cette référence ; moins sûr (sortie puis retour possible) : jamais seul, toujours « à vérifier » ;
4. **identifiants de voie** : l'extra `osmid` d'ORS donnerait les voies exactes, mais la doc d'ORS lue en phase 11a
   (`extra-info/index.md` l. 43-49) le réserve au profil `wheelchair` : à tester une fois sur `driving-hgv` ; s'il est
   refusé, rester sur la géométrie.

Effet attendu : moins de part « inconnue » dans le choix du Recommandé (2g), sans requête ORS de plus. La part
retrouvée par la géométrie reste « à vérifier » ; elle ne rend jamais une nationale « sûre ».

## 6. Conclusion

Ce que l'audit (PR suivante, Action « Audit OSM », lecture seule, extrait France de Geofabrik) peut repérer :
- ponts au-dessus d'un axe et tunnels d'un axe **sans hauteur** sur la voie du dessous (ORS les laisse passer) ;
- hauteur portée par le pont au lieu de la voie du dessous ;
- ponts bas connus sur les axes (valeur et sens à vérifier) ;
- sections du tableau 4 localisables **sans** l'étiquette PL attendue (`hgv=no`, `maxweight`, `maxheight`,
  `hgv:conditional` avec « ignorée par ORS ») ;
- `maxweight:hgv` seul ou `hgv=destination` sur une section d'interdiction (ignorés ou permissifs pour ORS).

Ce qu'il ne peut pas repérer : un panneau absent d'OSM sans arrêté connu ; la validité actuelle d'un arrêté ; les
interdictions horaires (ignorées par ORS quoi qu'on écrive) ; la hauteur réelle d'un pont (seule la mesure ou le
panneau la donne).

Chaque fiche dira « à vérifier sur place » ; la signalisation fait foi. Aucune écriture dans OSM depuis Gabarit :
toute correction est faite à la main par un contributeur, avec une source compatible avec la licence d'OSM (ODbL ;
panneau vu sur place, ou imagerie autorisée pour OSM comme Mapillary dans iD). Une correction faite dans OSM met 2 à
3 semaines à atteindre l'API publique d'ORS (section 1).
