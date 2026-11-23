---
name: gabarit-zfe-acces-hiver-taxes
description: Règles réglementaires France : ZFE et interdictions PL (phase 5), accès conditionnels et desserte locale (5d), équipements d'hiver (5f), taxes PL régionales (5h). À utiliser avant de toucher à ces fichiers ou données.
---

# ZFE, accès, hiver, taxes PL

(Texte déplacé tel quel depuis CLAUDE.md.)

- Réglementation (phase 5) — ZFE : `data/zfe.json` (BNZFE, licence ODbL d'après data.gouv.fr, source citée dans les
  notes) ; seuil du schéma etalab (« V4 » = Crit'Air 4, 5 et non classés interdits, ordre EL < V1… V5 < NC), règles
  `pl_*` au-delà de 3,5 t sinon `vul_*`, null = pas de restriction ; tronçon spécial (voies.geojson) à 20 m prime sur
  la zone, dernière zone du fichier prioritaire ; horaires illisibles = restriction supposée, texte « à vérifier ».
  Base réelle : identifiants « 1 », codes commune, SIREN à 10 chiffres, horaires « NC » (noms : `zfe_ids.csv`, zone
  qui contient, sinon site web) ; tronçons sans effet (même règle que la zone) retirés. « Éviter la ZFE » : à
  l'arrêt, une requête ORS `options.avoid_polygons` ; API publique (giscience.github.io/openrouteservice/
  hosted-api-restrictions) : 150 km à vol d'oiseau avec zones à éviter, 200 km² et 20 km par polygone → zones
  découpées en carrés de 12 km, message clair sinon (distance, départ ou arrivée dans la zone) ; recalcul en guidage :
  zones gardées seulement sous 150 km. Interdictions PL : arrêté du 16 avril 2021 (pas celui de 2015, abrogé) + arrêté
  annuel (`SUMMER_SATURDAYS`, `WINTER_AURA_SATURDAYS`, à compléter chaque année ; année absente → rappel
  bison-fute.gouv.fr) ; heure locale de la tablette ; Île-de-France et réseau AURA reconnus par la référence de route
  des étapes ORS (« à vérifier ») ; `vehicle.banStatus`. Guidage : `view.rules` (bandeau `#nav-rule`, une ligne par
  alerte), voix si `settings.ruleVoice` (par défaut oui). legifrance.gouv.fr répond 403 depuis le conteneur : arrêtés
  lus en PDF du JO sur bison-fute.gouv.fr. Tests de dates : `process.env.TZ = 'Europe/Paris'` en tête du fichier.
- Accès (phase 5d) — desserte locale (`access-local.js`) : `roadaccessrestrictions` dans `extra_info` de toutes les
  requêtes (aucune requête en plus) ; valeurs cumulées (bits : 2 Customers, 4 Destination, 8 Delivery, 16 Private
  ignoré car ORS l'interdit déjà) ; ORS (`HeavyVehicleFlagEncoder`) accepte `hgv=destination` / `delivery` partout,
  `vehicle_type` reste `hgv`. Tronçon accepté s'il touche le départ / l'arrivée ou s'en trouve à moins de
  `LOCAL.RADIUS_M` (3 km, à vol d'oiseau), sinon alerte « Route réservée à la desserte locale vers km X : vous la
  traversez. » et bouton « Éviter la desserte locale » à l'arrêt (une requête ORS sur appui, carré de 80 m,
  `avoid_polygons` ajouté aux zones déjà évitées, 150 km au plus, option « Sans desserte ») ; extra absent →
  « information indisponible ». Tranches horaires (`access-conditional.js`) : ORS n'applique les accès
  conditionnels que si son graphe est construit avec `conditional_access` (faux par défaut) et `departure` est caché
  → alerte seulement, jamais `departure`. Copie `data/acces-osm/` (même index que `data/aires-osm/` : `grid`,
  `tiles` ; case `{ t, n, w }`, coordonnées 1e-5° en écarts, simplifiées à 3 m), routes carrossables seulement
  (`HIGHWAYS`), conditions sans effet retirées (`canRestrict`), hors `APP_FILES`, cases lues seulement si le tracé
  les touche (`routePlan`), jamais d'Overpass. Priorité hgv > motor_vehicle > vehicle > access (comme ORS) : une
  condition vraie l'emporte sur l'étiquette sans condition du même moyen, la dernière écrite gagne, une étiquette sans
  condition d'un moyen plus précis masque les moins précis ; `:forward` / `:backward` selon le sens de passage.
  Rapprochement : 80 % de la longueur à moins de 15 m, points dans l'ordre du tracé, sens unique respecté (pas
  d'autre chaussée, de parallèle ni de pont). Horaires lus par `parseHours` (ZFE) : plages sans jours, passage de
  minuit (« Mo 22:00-06:00 » = lundi 22 h → mardi 6 h), « PH » avec les fériés du pays traversé (`holidayFor`,
  countryinfo) ; pays sans calendrier, saison, météo → non lue : aucune alerte, une ligne « N voies avec conditions
  non lues, à vérifier ». Messages : jamais « aucune restriction » mais « Aucune restriction horaire signalée dans les
  données (copie du JJ/MM), la signalisation fait foi » ; copie absente → « Restrictions horaires indisponibles
  (données non chargées) » ; chaque alerte finit par « La signalisation fait foi. ». Guidage : `view.rules.access`,
  bandeau sous 10 km (voie interdite à l'heure de passage d'abord, sinon la plus proche ; desserte comprise), voix une
  fois vers 3 km seulement si interdite à l'heure de passage (`settings.ruleVoice`). Pouvoir de police : Code de la
  route art. R411-8 (`POLICE_TEXT`, texte cité dans `access-conditional.js`) ; Légifrance répond 403 au conteneur et à
  l'Action → lu dans le PDF du code de codes.droit.org par le job `r411` (texte imprimé dans le journal).
- Équipements d'hiver (phase 5f, `winter.js`) : réponses ministérielles AN n° 3489 (JO 21/03/2023) et n° 10745 (JO
  17/02/2026), décret n° 2020-1264 (Légifrance 403 au conteneur). Période 1er novembre – 31 mars (heure de la tablette,
  heure de passage recalée par les pauses : `inWinterPeriod` sur l'entrée ou la sortie de zone). Communes : copie
  `data/hiver/` (`index.json` : `listDate`, `tiles` ; case `E_N.json` : `{ communes: [{ c, n, d, p, b, r }] }`, anneaux
  en entiers 1e-5° en écarts, commune dans chaque case que son cadre touche), hors `APP_FILES`, cases lues si le tracé
  les traverse (`routeTiles`, parcours exact de la grille) ; intersection exacte segment / côtés (règle pair-impair,
  trous compris), jamais d'échantillonnage. Passages réunis à 50 m, zones à 2 km ; texte « Équipements d'hiver exigés
  du 1er novembre au 31 mars de km X à km Y (communes — département), vers … : consigne. Liste nationale du
  22/10/2022 : arrêtés préfectoraux plus récents et routes exclues à vérifier. La signalisation fait foi. » ; commune
  « en partie, à vérifier » ; `vehicle.trailer` ('' non précisé : deux consignes, 'none', 'with') ; rappel B26 et
  sanctions « à vérifier » ; copie absente en période → « Équipements d'hiver indisponibles (données non chargées) » ;
  aucune commune → « Aucune commune … signalée » (seulement si aucune commune sur le tracé). Jamais de voix, de bandeau
  ni d'annonce. Fiches pays : bloc `winter` (rubrique « Équipements d'hiver », toute l'année, « selon la météo / les
  panneaux, pas de période légale ») ; IT période « à vérifier » ; `data/pays/AT.json` minimal (tout « à vérifier »).
  Crédits dans Réglages (`#winter-credit` : liste du 22/10/2022, contours ODbL). Hôtes de l'Action :
  securite-routiere.gouv.fr, contours-administratifs.s3.rbx.io.cloud.ovh.net (bloqué au conteneur), ris.bka.gv.at.
- Taxes PL régionales (phase 5h, `hgv-tolls.js`) : `data/taxes-pl.json` dans `APP_FILES` ; chaque taxe a `start`,
  `status`, `url` officielle, `bbox`, `roads` (références `roadRefs` des étapes ORS), `area` (contour de la collectivité : Bas-Rhin et Haut-Rhin, IGN Admin
  Express COG 2018, Licence Ouverte, via gregoiredavid/france-geojson, simplifié à 150 m ; toute route de la taxe doit
  y être : plus de D 83 de Belfort, v28), `roadBoxes` (cadre propre à une route : D83 et N83 entre Colmar et Sélestat
  seulement, la D 83 d'OSM allant de Cernay à Erstein ; limite de la concession de l'A36 à vérifier), `scope` (réseau
  officiel),
  `basis`, `note`. Statuts : 'confirmed' (texte officiel lu : alerte en vigueur, ligne sur la fiche), 'announced'
  (site officiel lu, date « prévue », information seulement), 'check' (rien lu : « Taxe possible : … périmètre
  officiel non lu, à vérifier », aucun montant) ; 'confirmed' / 'announced' exigent `source` et `verified`, sinon
  'check'. Montants : `grid` (classes de poids `max` / `maxIncluded` true, false ou null = les deux, lignes par classe
  Euro '0'–'7', source et date) seulement hors 'check' ; texte « Tarif annoncé, poids du profil X t, Euro VI (classe …) :
  N centimes par km (source, lu le …) … Aucun total calculé pour le trajet. » ; classe Euro non précisée ou EEV
  (absent de la grille) → fourchette ; jamais de total ni d'estimation. Au-delà de 3,5 t (poids non précisé :
  signalé) ; en France d'après countryinfo (absent : cadre seul, « Pays traversés non lus : à vérifier ») ; heure de
  passage recalée par `elapsed`, journée de début à l'heure de la tablette (« prévue à partir du 1er janvier 2027 »
  avant, « prévue depuis » après). Passage écrit « au moins de km X à km Y » (repérage par les noms d'étape : une partie
  du réseau peut manquer). Échec ORS : `serviceDetailText` (statut HTTP, code ORS, message) en petit sous le message
  (`showMessage(…, detail)`) ; « Aucun itinéraire autorisé » = code 2009, HTTP 404 sans code ou réponse sans tracé ;
  429 = « Trop de demandes en une minute » ; 2004 = distance trop grande (pas une limite de poids). Fichier absent → « Taxes PL régionales indisponibles (données non chargées) »
  (trajet en France). Jamais de voix, de bandeau ni d'annonce ; lien « Site officiel ». Sources lues le 21/11/2026
  par une Action temporaire (retirée) : r-pass.eu (réseau : A35 et A36 non concédées hors Eurométropole — la M35 de
  l'Eurométropole n'est pas taxée —, RD83 Colmar–Sélestat, RD1363, RD502, RD504 ; délibération n° CD-2025-4-7-1 du
  20/10/2025 ; dépliant V02 : grille A < 12 t, B 12–18 t, C 18–32 t, D > 32 t de PTRA × Euro 0 à VII) ; recours devant
  le tribunal administratif de Strasbourg (aucune décision publiée au 21/11/2026, effet suspensif non établi) ;
  ecpl.fr (2 avril 2027 « prévue », réseau A30, A31 jusqu'au sud de Toul, A33, A313, RN4, RN44, RN431, RN52 ;
  grille selon la classe CO2, absente du profil → aucun montant). r-pass.eu n'envoie pas son certificat
  intermédiaire (TeleSec Business TLS-CA 2022, lu par l'adresse AIA, vérification gardée). Pas de champ « Essieux »
  tant qu'aucun montant n'en dépend. alsace.eu, toll-collect.de, gesetze-im-internet.de, asfinag.at et
  ris.bka.gv.at ne répondent pas non plus à l'Action ; tous refusent le conteneur.
  Phase 5h ter (`hgv-tolls-geo.js`) : réseau en géométrie, la bbox ne décide plus seule. `data/taxes-pl-osm.json`
  (Action mensuelle, extrait France découpé au cadre des taxes, `w/highway=motorway,trunk,primary,secondary,tertiary`,
  hors `APP_FILES`) : voies dont une référence normalisée (`normalizeRefs` : majuscules, espaces, « A 35;E 25 ») est
  dans `roads`, hors `*_link`, hors péage PL (`isHgvToll` : `toll:hgv=yes`, ou `toll=yes` sans `toll:hgv=no` ;
  sections concédées exclues sans liste à la main : A355, A36 vers Belfort, A31 au sud de Toul) ; cadre ECPL = Grand
  Est entier (3,38–8,24° E, 47,42–50,17° N : RN44 et RN4 dans la Marne) ; segments gardés si leur milieu est dans le périmètre (`pointInTax` : `bbox`, `area`,
  `exclude` — Eurométropole de Strasbourg, 33 communes ; Alsace pour l'ECPL —, `roadBoxes`, `roadAreas` — RN52 en
  Meurthe-et-Moselle) ; contours IGN Admin Express COG 2018 (Licence Ouverte, gregoiredavid/france-geojson) dans
  `data/taxes-pl.json`. Journal : par référence, km avant découpage (cadre seul) puis gardés après découpage (comptés par
  l'appli) et exclus pour péage (sens unique compté pour moitié), répartition `toll` / `toll:hgv` de l'A31 au sud de
  48,65° N (`TOLL_BREAKDOWN`), total
  ECPL comparé aux 525 km annoncés. Appli : point du tracé tous les 50 m, ≤ 15 m d'un segment (graphe ORS = nœuds OSM ;
  simplification 3 m, retouches OSM, autre chaussée ; même écart que les accès conditionnels), écart de cap ≤ 30°
  modulo 180°, veto si l'étape ORS nomme une autre route, séries ≥ 300 m réunies à 2 km ; texte « de km X à km Y
  (repérage sur la carte OpenStreetMap du JJ/MM/AAAA (ODbL) et les contours IGN Admin Express (Licence Ouverte),
  limites exactes à vérifier) » ; copie absente ou sans la taxe → noms d'étape, « au moins … (repérage par les noms
  d'étape, carte OpenStreetMap du réseau non chargée) ». Crédits `#tolls-credit` dans Réglages. Diagnostic :
  « Méthode taxes PL », méthode de chaque passage, `point km X : lat, lon` (0,001°) tous les 10 km sur les étapes sans
  nom (« - ») de plus de 5 km, jamais à moins de 1 km du départ ou de l'arrivée. Calcul en échec :
  `map.showRoutes([])` retire tracés et repères de départ / d'arrivée. Code 2009 : `diagnose2009`
  (route-options.js, phase 2f), dans le budget de 3 (alternative_routes compris), rien d'affiché, guidé ni dit, profil
  et points jamais modifiés : (a) trajet inverse, même profil, passe → `START_NO_EXIT_TEXT` (Metz centre → Nancy /
  Toul en 2009, Nancy → Metz passe) ; (b) point de passage au milieu (`via`, `radiuses: [-1, -1, -1]`, jamais avec
  alternative_routes), tronçon lu par `failedSegment` (ors-errors.js) : 1 → `START_UNREACHABLE_TEXT`, 2 →
  `END_UNREACHABLE_TEXT`, au conditionnel (accroche du point de passage non garantie) ; 2010/5xx du point de passage →
  rien de conclu ; (c) s'il reste une requête, sans restrictions (`noRestrictions`) → `RESTRICTION_HINT_TEXT` ou
  `DEAD_END_HINT_TEXT` (profil sans restriction → `DEAD_END_HINT_TEXT` sans requête). Autre échec (quota, réseau) →
  message d'origine, raison dans `err.diagnosticNote` (ajoutée par `serviceDetailText`). Version du diagnostic : `requestVersionLabel` (même demande au
  service worker que Réglages ; avant, #app-version vide tant que Réglages n'était pas ouvert → « version inconnue »). Cause
  (ORS `ORSRouter.createSnapFilter`) : accrochage sur une voie permise au gabarit, mais test de sous-réseau sans les
  limites de poids / hauteur ; `radiuses` (400 m par défaut, `maximum_snapping_radius`) n'y change rien (2010 sinon).
  Noms d'étape ORS : GraphHopper v4.17 (`EncodingManager.applyWayTags`) écrit `name` d'OSM puis « , » et `ref`
  (ref seule sans nom) → `roadRefs` lit les références dans le nom. Références OSM lues le 21/11/2026 (extrait Alsace,
  miroir download.openstreetmap.fr : Geofabrik et Overpass injoignables depuis l'Action, IPv6) : Colmar–Sélestat =
  `A 35` « Autoroute des Cigognes » et `D 83` sans nom, quelques `N 83` ; `D 1363` (Lauterbourg), `D 502`
  (Gambsheim), `D 504` (Seltz) ; `M 35` = Eurométropole. Diagnostic du trajet (phase 5h bis, `route-diagnostic.js`) :
  bloc replié sous les notes de la fiche, texte à copier (étapes ORS : km, nom renvoyé, références lues, point de
  début arrondi à 0,01° ; pays ; ZFE et taxes PL avec leurs km), jamais de clé ni de profil complet.

- Phase 2g : ZFE dont l'inclusion des autoroutes n'est pas tranchée (`ZFE_MOTORWAY_TO_CHECK` de `zfe.js`) — Grand Nancy
  (245400676-ZFE-001 : BNZFE du 26/03/2026 sans tronçon d'exception, arrêté grandnancy.eu non lu le 22/11/2026, site
  bloqué depuis le conteneur). Passage sur autoroute (référence A de l'étape) dans la zone : interdiction gardée par
  prudence + « Passage par A 31 : inclusion de l'autoroute dans la ZFE à vérifier dans l'arrêté. La signalisation
  fait foi. » Retirer l'entrée seulement d'après l'arrêté (source et date en commentaire).

- Péages PL au km à l'étranger (phase 5h, v49, `foreign-tolls.js`, grille en code) : Autriche seulement, GO-Maut
  ASFINAG 2026 (PDF texte + page HTML, lus le 23/11/2026 par l'Action « Textes officiels ») ; € /km HT, catégories 2, 3,
  4+ essieux ; classe CO₂ absente du profil → Euro VI = fourchette classes 4 à 1 ; non précisé (essieux ou Euro) → les
  deux cas. Estimation = taux × km à péage en Autriche (`tollRanges` d'ORS × countryinfo) ; étape A 9, A 10, A 11, A 12,
  A 13 ou S 16 (tarifs propres) → aucune estimation. Ligne `info` seulement, jamais sur la fiche courte ni dite,
  « Montants à vérifier », jamais une facture. Test de cohérence : total = infrastructure + air/bruit + CO₂.
  Allemagne (Maut) : grille Toll Collect « ab 1. Juli 2024 » lue mais validité 2026 et BFStrMG annexe 1 non lus
  (gesetze-im-internet.de, bmv.de ne répondent pas à l'Action) → aucun montant. Burgenland : RIS 503, rien codé.
  R-Pass : délibération et issue du recours illisibles (alsace.eu, r-pass.eu) → `announced` inchangé.
- Champ « Essieux » du profil (`axles` : '', '2', '3', '4', '5+') : montré seulement si `AXLE_AMOUNTS` (un montant codé
  en dépend), sinon valeur gardée ; exporté avec les véhicules (normalizeVehicle).
