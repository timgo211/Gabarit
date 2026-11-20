# Feuille de route Gabarit

Ordre : Bloc 1 Aires PL → Bloc 2 Guidage → Bloc 3 Réglementation → 7d → (4, 6, 10) → 3

**Règle de travail : prendre le prochain bloc non coché. Un bloc = une seule conversation** (toutes ses cases dans
la même conversation, dans l'ordre indiqué). Phases 7d et 3 : chacune seule, comme un bloc.

## Phases faites

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

- [x] **Phase 7 — Vue satellite + partage** (deux petites fonctions regroupées, faites en premier)
  **Vue satellite :** boutons « Plan / Satellite » sur la carte, à l'arrêt (repérer l'entrée camion d'un client ou
  d'un dépôt) ; pendant le guidage, plan uniquement et pas de bouton. France (métropole, Corse, outre-mer) : photos
  aériennes IGN `ORTHOIMAGERY.ORTHOPHOTOS` (Géoplateforme `data.geopf.fr`, WMTS PM, JPEG, zoom 19, sans clé, Licence
  Ouverte, attribution IGN), sous les libellés du fond, tracés et marqueurs par-dessus. Hors de France : aucune source
  gratuite dont les conditions l'autorisent clairement → « Vue satellite disponible en France uniquement », plan gardé.
  Choix mémorisé (`settings.mapLayer`), tuiles jamais mises en cache.
  **Partage avec des amis** (Web Share API, sinon copie du lien ou téléchargement, sans serveur) :
  - un itinéraire : lien (départ, arrivée, péages/ferries, variante choisie dans le # de l'URL) qui pré-remplit le
    formulaire sans rien calculer, ou fichier GPX 1.1 ; départ « Ma position » partagé seulement si « Inclure mon point
    de départ » est coché (sinon lien sans départ, GPX commençant au premier carrefour après 500 m) ;
  - un lieu ou ma position : lien de carte OpenStreetMap ;
  - l'appli : son adresse, chacun avec sa propre clé HeiGIT gratuite.
  Le profil véhicule et la clé ne sont jamais partagés ; un lien reçu est validé et affiché en texte brut.
  Pas de position en direct (il faudrait un serveur).
  **Reste pour après la phase 3 :** mes signalements en fichier à importer dans le Gabarit d'un ami (fusion sans doublons).
  **Satellite hors de France :** voir phase 7d.

- [x] **Phase 7b — Correctifs (retours du premier vrai trajet, sur téléphone)**
  Constatés sur un téléphone Android le 19/11 (captures d'écran) :
  1. **Format téléphone** : la page déborde en largeur (barre du haut, boutons Plan/Satellite, formulaire et fiches
     d'itinéraire coupés à gauche ou à droite). Tout doit tenir dans un téléphone en portrait (≈ 360 à 412 px de
     large), sans défilement horizontal ; l'affichage tablette reste le même.
  2. **Texte qui sort des cases pendant le guidage** (« 89 km/ » coupé dans la barre du bas, longues consignes dans le
     bandeau du haut) : tailles adaptées, retour à la ligne ou réduction automatique.
  3. **Satellite en mode nuit** : bouton « Satellite » actif mais carte plan sombre affichée (en France, vers Metz).
     Les photos doivent s'afficher quel que soit le thème.
  4. **Carte vide au retour de l'arrière-plan** pendant le guidage (fond uni, plus de routes). Restaurer la carte au
     retour sans perdre le guidage (probable perte du contexte WebGL : `webglcontextlost` / `webglcontextrestored`,
     `visibilitychange`, sinon recréer la carte).
  5. **Itinéraire changé sans bouger** : à l'arrêt sur une aire (0 km/h), le guidage est passé de 138 km à 159 km
     (autre itinéraire, autre consigne). Règles : aucun recalcul « hors itinéraire » en dessous d'environ 10 km/h ni
     avec une position GPS imprécise ; hors d'une vraie sortie de route en roulant, l'itinéraire ne change jamais sans
     mon accord (proposition + bouton, à l'arrêt).
  Chaque correctif a son test (trace GPS simulée pour le 5).
  Fait : mise en page téléphone sans débordement (vérifiée à 360, 412, 800 et 1280 px dans Chromium) ; valeurs du
  guidage avec unité réduite et taille ajustée, consigne longue sur 5 lignes au plus ; photos IGN et tracés gardés au
  changement de thème ; carte restaurée ou recréée après perte du contexte WebGL ; hors itinéraire seulement à
  10 km/h ou plus avec une précision de 30 m ou mieux, sinon bouton « Recalculer d'ici » proposé à l'arrêt.

- [x] **Phase 7c — Confort du guidage** (reste déplacé dans le Bloc Guidage)
  - [x] Boutons permanents « Vue d'ensemble » (tout le trajet restant) et « Recentrer ».
  - Autres itinéraires depuis la vue d'ensemble : déplacé dans le Bloc Guidage.
  - [x] Bouton Plan / Satellite aussi pendant le guidage (un toucher ; le guidage démarre en plan, choix non mémorisé).
  - [x] Guidage moins sombre en mode jour (bandeau du haut et barre du bas plus clairs, contraste gardé).
  - [x] Barre du bas : traits fins entre Reste, Temps, Arrivée et Vitesse.
  - [x] Encart avec le nom de la route sur laquelle je roule (étape ORS en cours), en bas de la carte.
  - [x] Flèche du camion plus fluide : déplacement et rotation animés entre deux positions GPS.
  - Personnalisation :
    - [x] couleur de la flèche (auto, bleu, vert, orange, violet) ;
    - forme de la flèche, icône camion : déplacé dans le Bloc Guidage ;
    - [x] voix : choix parmi les voix françaises installées, vitesse, volume, bouton « Tester ».
  - [x] Musique pendant les consignes : Chrome (Android compris) n'a pas l'Audio Session API (Safari seulement) ;
    Réglages l'explique (réglage appliqué automatiquement si un navigateur la propose).
  - [x] Partager Gabarit avec un guide d'installation pas à pas pour un autre téléphone (ouvrir le lien, installer,
    créer sa clé gratuite, la coller dans Réglages).

- [x] **Phase 8 — Destinations et étapes** (reste déplacé dans le Bloc Guidage)
  - Étapes : déplacé dans le Bloc Guidage.
  - [x] Destination (ou départ) par appui long sur la carte, hors guidage : « Aller ici » / « Partir d'ici ».
  - [x] Coordonnées GPS dans le champ départ ou arrivée : décimal (48.6921, 6.1844) et degrés-minutes-secondes
    (48°41'31.6"N 6°11'03.8"E), aussi degrés-minutes décimales.

## Bloc 1 — Aires PL (en cours)

- [ ] **Bloc 1 — Aires PL** : ajout et suivi des aires de repos, aires de service et parkings poids lourds, autoroutes
  d'abord, puis nationales.
  - [x] **Phase 9 — Aires et parkings PL** (priorité ; reprend la partie parkings de la phase 6)
    - Données : aires de repos (`highway=rest_area`), aires de service (`highway=services`) et parkings PL
      (`amenity=parking` + `hgv=yes/designated`, `capacity:hgv`, services) d'OpenStreetMap via Overpass ; jeu officiel
      des aires de stationnement PL du point d'accès national (Bison Futé, transféré sur transport.data.gouv.fr par
      l'arrêté du 24 mars 2026), copié dans `data/` par une GitHub Action hebdomadaire s'il n'est pas lisible depuis le
      navigateur. Doublons entre sources fusionnés.
    - Au calcul : aires le long de l'itinéraire choisi, dans le bon sens de circulation quand c'est connu ; une seule
      requête Overpass par calcul, résultat gardé sur l'appareil (jamais dans le cache du service worker).
    - Avant de partir : liste des aires du trajet (km depuis le départ, heure d'arrivée estimée, places PL, services,
      sécurisé / payant), repères sur la carte, toucher une aire = sa fiche.
    - En guidage : encart « Prochaines aires » (les 3 suivantes : nom, distance, heure d'arrivée, places PL), mis à jour
      à chaque position, ouvert ou fermé d'un seul appui, aucune saisie. Annonce vocale optionnelle (Réglages) vers
      10 km avant une aire PL.
    - Mon avis : à l'arrêt seulement (sous 10 km/h), sur la fiche d'une aire, 3 gros boutons « Plein »,
      « Quelques places », « OK » + heure, gardés sur l'appareil, inclus dans l'export / import, affichés sur la fiche et
      dans la liste (« Plein il y a 2 j, 21h »).
    - Occupation en temps réel : vérifier s'il existe une source gratuite pour la France. **Pour plus tard (non codé) :**
      Allemagne, places libres des aires d'autoroute publiées par Toll Collect / SID sur Mobilithek (DATEX II).
    Fait : une requête Overpass par calcul pour tous les itinéraires proposés (tracés mis bout à bout, simplifiés),
    aires de repos / de service à 400 m, parkings PL à 800 m, serveur de secours (overpass.private.coffee) si le premier
    échoue ou dépasse 30 s, résultat gardé 7 jours sur l'appareil (5 trajets) ; jeu officiel (xlsx du réseau concédé 2025,
    ods du réseau non concédé 2018, Licence Ouverte) converti chaque lundi dans `data/aires-pl.json` par l'Action
    « Aires PL officielles » (journal : en-têtes lus, colonnes retenues, nombre d'aires ; échec clair si le nom ou la
    position manquent ; Lambert 93 accepté) ; doublons fusionnés à 300 m ; aire à gauche du tracé en gris « autre sens ? ».
    Liste, repères, fiche, encart « Prochaines aires », annonce vocale (Réglages), « Mon avis » (sous 10 km/h en guidage).
    **Occupation en temps réel en France : aucune source gratuite trouvée** (seulement des parkings urbains : Lille,
    Strasbourg, Aix-Marseille…). Premier passage de l'Action en échec sur le vrai xlsx concédé (titres anglais en
    ligne 2, « Location », « 46°01821 ») : lecture corrigée d'après ses lignes réelles ; xlsx et ods traités à part.

## Bloc 2 — Guidage

- [ ] **Bloc 2 — Guidage** (une seule conversation)
  Une seule passe de `tools/ui-check.mjs` avec le GPS émulé à la fin du bloc ; un seul incrément de `VERSION` dans
  `sw.js` pour tout le bloc.
  - [ ] Dans la vue d'ensemble, à l'arrêt seulement : proposer d'autres itinéraires depuis ma position (comme en
    phase 2b), choix en un toucher. (Reste de la phase 7c.)
  - [ ] Personnalisation : forme de la flèche, icône camion. (Reste de la phase 7c.)
  - [ ] **Phase 11 — Infos route : limitations de vitesse et directions** (ancienne phase 9, renumérotée)
    Limitation de vitesse PL pendant le guidage (tags OpenStreetMap `maxspeed:hgv` / `maxspeed` des voies du trajet,
    via ORS si possible ou Overpass ; à défaut, règles françaises par type de route, source officielle citée), avec
    alerte en cas de dépassement. Dans les consignes, la direction écrite sur les panneaux (tags OSM `destination` des
    bretelles) ou la commune la plus proche (« Tournez à droite, direction Metz »). Données calculées une fois par
    itinéraire pour ménager les quotas.
  - [ ] Étapes : plusieurs arrêts dans l'ordre, ajout d'une étape en route (à l'arrêt). Avec des étapes,
    `alternative_routes` n'est pas possible (2 points seulement) : garder les variantes de la phase 2b. (Reprend la
    tournée multi-arrêts de la phase 3.) (Reste de la phase 8.)
    **À faire en dernier dans le bloc, en mode plan obligatoire** : touche à la logique (trajet par tronçons, recalcul,
    quota ORS).

## Bloc 3 — Réglementation

- [ ] **Bloc 3 — Réglementation** (une seule conversation)
  Les phases 5, 5b, 5c et 5d partagent les mêmes données de restrictions : chercher et citer chaque règle officielle
  une seule fois, en commentaire, avant de coder.
  - [x] **Phase 5 — Réglementation**
    ZFE (`aires.geojson` de la Base nationale BNZFE sur transport.data.gouv.fr, copié dans `data/` par une GitHub Action
    hebdomadaire) avec alerte selon ma vignette Crit'Air ; interdictions PL les week-ends et jours fériés ; temps de
    conduite et pauses (règlement CE 561/2006, affiché comme une aide : le chronotachygraphe fait foi) ; alerte vent fort
    (Open-Meteo). Vérifier chaque règle sur une source officielle avant de coder et la citer en commentaire.
    - [x] **ZFE** (PR A) : base nationale (aires + tronçons spéciaux, licence ODbL d'après data.gouv.fr) copiée chaque
      lundi dans `data/zfe.json` par l'Action « ZFE (base nationale) » ; seuil Crit'Air du schéma etalab (V3 = Crit'Air
      3, 4, 5 et non classés interdits), règles PL au-delà de 3,5 t, horaires (« 24/7 », « Mo-Fr 07:00-9:00 », « PH off »),
      dates d'entrée en vigueur, tronçons spéciaux prioritaires sur la zone ; fiche d'itinéraire et notes (lien vers
      l'arrêté), contours sur la carte, bouton « Éviter la ZFE » à l'arrêt (options.avoid_polygons d'ORS, zones découpées
      en carrés de 12 km ; message clair au-delà de 150 km à vol d'oiseau, limite de l'API publique) ; en guidage,
      bandeau sous 20 km et annonce vers 5 km. Les ZFE restent en vigueur (suppression censurée, décision 2026-903 DC).
    - [x] **Interdictions PL week-ends et jours fériés** (PR A) : arrêté du 16 avril 2021 (l'arrêté du 2 mars 2015 est
      abrogé) : plus de 7,5 t, samedi et veille de jour férié 22 h → dimanche et jour férié 22 h ; samedis d'été et
      d'hiver (Auvergne-Rhône-Alpes) de l'arrêté annuel (2026 : arrêté du 26 décembre 2025) ; Île-de-France (art. 3, A6,
      A10, A12, A13, A106, selon le sens) ; jours fériés calculés ; profil : « Concerné », « Transport de l'article 4 »
      ou « Véhicule spécialisé / agricole ». Fiche : « Interdiction PL samedi 22 h → dimanche 22 h : vous y seriez vers
      km 412 » ; guidage : annonces 1 h et 15 min avant si l'arrivée est après le début, bandeau. Vérifié avec le
      calendrier 2026 de la brochure Bison Futé (écarts du 4 avril et du 9 mai en Île-de-France : l'appli suit l'arrêté).
    - [x] **Temps de conduite et pauses** (PR B, règlement (CE) 561/2006, aide seulement : le chronotachygraphe fait
      foi) : conduite à partir de 5 km/h, arrêt compté comme pause à partir de 15 min ; art. 7 : 4 h 30 puis 45 min, ou
      15 min PUIS 30 min (30 puis 15 ne suffit pas) ; art. 6 : 9 h par jour (10 h deux fois par semaine), 56 h par
      semaine, 90 h sur deux semaines ; arrêt de 9 h = repos journalier. Compté pendant le guidage (positions interrompues
      = arrêt), gardé sur l'appareil (pas exporté), remise à zéro dans Réglages. Fiche : « Pause de 45 min conseillée
      après 1 h 30 de route (vers km 96) », ou sur une aire du bon sens atteinte dans l'heure avant 4 h 30 (« … : Aire
      de …, km 327 »), 9 h du jour ; heures des ZFE, interdictions et vent recalées avec les pauses conseillées (repos
      de 11 h au-delà de 9 h) ; jamais « obligatoire » ; guidage : ligne « Conduite 3 h 12 · pause de 45 min conseillée
      dans 1 h 18 » + journée (orange 30 min avant, rouge au-delà), voix 30 min avant 4 h 30 (avec la prochaine aire), à
      4 h 30, à 9 h / 10 h, et à l'arrêt (15 min comptées, pause faite) ; bouton « Pas une pause (travail) » à l'arrêt
      seulement (sous 10 km/h), qui retire l'arrêt en cours ou le dernier arrêt du décompte (second appui : recompté).
    - [x] **Alerte vent fort** (PR B) : Open-Meteo (sans clé, CC BY 4.0, attribution sous les fiches, dans Réglages et
      dans le bandeau),
      une requête par calcul pour tous les itinéraires proposés (40 points au plus, un tous les 15 km), rafales à
      l'heure de passage (maximum de l'heure précédente), seuil réglable (70 km/h par défaut) ; prévision gardée 3 h sur
      l'appareil, jamais dans le cache du service worker ; « Météo indisponible » si échec, jamais bloquant. Fiche
      (« Vent fort : rafales jusqu'à 95 km/h vers km 120 (vers 14 h 20) »), bandeau en guidage sous 30 km, voix une fois
      vers 15 km (réglage). Recalcul : points replacés sans requête.
  - [x] **Phase 5b — ADR (matières dangereuses)**
    Profil véhicule : avec « Matières dangereuses (ADR) », code de restriction en tunnel (B, C, D, E, sans code ; vide =
    aucune alerte), classe ADR et numéro ONU facultatifs (UN 2919, 3291, 3331, 3359, 3373 : sans code, ADR 1.9.5.2.2).
    ORS ne reçoit que `hazmat` (oui / non) ; d'après son code source (HazmatAccessParser, HeavyVehicleEdgeFilter), il
    évite alors toute voie `hazmat=no` ou `hazmat:B…E=no`, quelle que soit la lettre, et ne lit pas
    `hazmat:adr_tunnel_cat` : phrase dans les notes (« l'itinéraire peut être plus long que nécessaire »).
    Tunnels : pas d'Overpass (mesuré le 20/11/2026 sur 520 km, A6 + A43 : aires seules, tunnels seuls ou les deux
    dépassent 26 s, ou serveur plein ; l'Action elle-même a échoué trois fois) ; copie hebdomadaire
    `data/tunnels-adr.json` par l'Action « Tunnels ADR » depuis les extraits par pays de Geofabrik filtrés par osmium
    (voies en tunnel portant `hazmat`, `hazmat:B…E`, `hazmat:adr_tunnel_cat`, France et pays voisins ;
    catégorie = plus haute lettre marquée « no », ADR 8.6.4 : un code interdit sa catégorie et les suivantes), lue
    seulement pour un véhicule ADR avec code tunnel. Fourvière (E), Fréjus (C), Mont-Blanc (E) gardés en dur (Bison
    Futé, « Interdictions dans les principaux tunnels »), recoupés avec OSM dans le journal de l'Action. Fiche :
    « Tunnel du Fréjus (catégorie C) interdit au code C : vous y seriez vers km 412 (vers 14 h 20). La signalisation
    fait foi. », autres itinéraires proposés qui l'évitent, bouton « Éviter le tunnel » à l'arrêt (carré de 80 m,
    options.avoid_polygons, 150 km au plus) ; fichier absent ou vide : « Alerte tunnels indisponible (données non
    chargées) » ; aucun tunnel : « Aucun tunnel signalé dans les données (copie du JJ/MM), la signalisation fait foi »
    (jamais « sans tunnel interdit »). Guidage : bandeau sous 20 km, voix une fois vers 5 km. Rappel ADR : mêmes
    interdictions de circulation que les autres PL (arrêté du 16 avril 2021, rien de propre au transport de
    matières dangereuses), dérogations préfectorales (annexe III).
  - [ ] **Phase 9b — Aires PL sur les longs trajets** (avant la 5c)
    La requête Overpass des aires échoue au-delà d'environ 500 km (mesure du 20/11/2026 : 26 s dépassées ou serveur
    plein). Copier les aires et parkings PL d'OpenStreetMap (France et pays voisins) chaque semaine dans `data/`
    comme les tunnels ADR (extraits Geofabrik + osmium), placés sur l'appareil sans requête ; Overpass en direct
    gardé seulement hors de la zone copiée, sur un tracé court.
  - [ ] **Phase 5c — Passage de frontière : réglementation PL du pays**
    Repérer les changements de pays sur l'itinéraire (`extra_info: ["countryinfo"]` d'ORS). Avant le départ : liste des
    pays traversés avec une fiche par pays (vitesses PL, interdictions week-end et jours fériés, péage PL et son système,
    zones à faibles émissions ou vignettes, particularités ADR). Pendant le guidage : annonce vocale courte à l'approche
    de la frontière, sans saisie. Fiches dans `data/pays/*.json`, avec la source officielle et la date de vérification
    de chaque règle ; d'abord les pays voisins (BE, LU, DE, CH, IT, ES).
  - [ ] **Phase 5d — Accès : tranches horaires et desserte locale**
    Interdictions PL par tranches horaires (tags OpenStreetMap conditionnels, par exemple `hgv:conditional`) : vérifier
    si ORS les applique avec une heure de départ et l'utiliser, sinon alerter sur le trajet. « Sauf desserte locale /
    livraisons » : autoriser ces routes quand l'arrivée ou une étape est dans le secteur (vérifier `vehicle_type`
    `delivery` / `goods` d'ORS et sa gestion de `hgv=destination` / `delivery`). Sources officielles citées.
    Données sans Overpass : copie hebdomadaire par une Action (comme `data/tunnels-adr.json` : extraits Geofabrik
    par pays filtrés par osmium) des voies PL
    conditionnelles d'OpenStreetMap (`hgv:conditional`, `maxweight:conditional`, `access:conditional`,
    `hgv=destination` / `delivery`) en France et pays voisins, découpée en cases de 1° (un fichier par case, lu
    seulement pour les cases touchées par le tracé), avant de vérifier ce qu'ORS en fait.

## Ensuite

- [ ] **Phase 7d — Satellite hors de France**
  Orthophotos ouvertes nationales, après vérification de leurs conditions : Luxembourg (geoportail.lu), Belgique (NGI /
  régions), Allemagne (selon le Land), Suisse (swisstopo SWISSIMAGE), Espagne (PNOA, IGN España). Sinon, message actuel.

- [ ] **Phase 4 — Carburant**
  Stations le long du trajet via l'API ouverte prix-carburants (data.economie.gouv.fr, jeu
  `prix-des-carburants-en-france-flux-instantane-v2`), filtre « piste poids lourds » si le champ services le permet,
  tri par prix du gazole, détour estimé, mes stations « OK camion », coût carburant du trajet.

- [ ] **Phase 6 — Historique et notes**
  Historique des trajets, statistiques, relevé PDF via impression. Notes perso détaillées sur les aires et parkings
  utilisés (sécurité, douches, propreté…), affichées au prochain passage, en plus de « Mon avis » de la phase 9.
  (Aires et parkings PL, prochain parking en guidage : phase 9.)

- [ ] **Phase 10 — Trafic en temps réel (à étudier)**
  ORS ne tient pas compte du trafic. D'abord étudier les sources gratuites : données ouvertes du réseau routier
  national (Bison Futé / DIR, événements DATEX II sur transport.data.gouv.fr), offres gratuites avec clé (TomTom,
  HERE…) et leurs quotas. Commencer par afficher bouchons et événements sur le trajet ; recalcul selon le trafic
  seulement si une source le permet. Présenter les options avant de coder.

## Tout à la fin

- [ ] **Phase 3 — Mes signalements + Ma journée** (reportée : à faire en dernier)
  Signalement perso avec alerte vocale à l'approche. En roulant, un seul gros bouton qui marque la position (aucune
  saisie pendant le guidage, comme en phase 2 – R412-6-2) ; le type (pont bas, accès difficile, contrôle, parking,
  danger) et la note se choisissent à l'arrêt. Lieux enregistrés (domicile, dépôt, clients) ; les étapes sont en
  phase 8.

## Hors de portée d'une appli web
- **Android Auto / CarPlay** : réservés aux applis natives validées par Google ou Apple. Il faudrait réécrire Gabarit
  en appli Android native ; ce n'est pas prévu.
