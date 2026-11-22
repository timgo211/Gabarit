# Feuille de route Gabarit

Ordre : Bloc 1 Aires PL → Bloc 3 Réglementation → Bloc 4 Compléments réglementaires → Bloc 2 Guidage → 7d → (4, 6, 10) → 3

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

## Bloc 1 — Aires PL

- [x] **Bloc 1 — Aires PL** : ajout et suivi des aires de repos, aires de service et parkings poids lourds, autoroutes
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
    Fait : une requête Overpass par calcul pour tous les itinéraires proposés (tracés mis bout à bout, simplifiés),
    aires de repos / de service à 400 m, parkings PL à 800 m, serveur de secours (overpass.private.coffee) si le premier
    échoue ou dépasse 30 s, résultat gardé 7 jours sur l'appareil (5 trajets) ; jeu officiel (xlsx du réseau concédé 2025,
    ods du réseau non concédé 2018, Licence Ouverte) converti chaque lundi dans `data/aires-pl.json` par l'Action
    « Aires PL officielles » (journal : en-têtes lus, colonnes retenues, nombre d'aires ; échec clair si le nom ou la
    position manquent ; Lambert 93 accepté) ; doublons fusionnés à 300 m ; aire à gauche du tracé en gris « autre sens ? ».
    Liste, repères, fiche, encart « Prochaines aires », annonce vocale (Réglages), « Mon avis » (sous 10 km/h en guidage).
    Occupation en temps réel : abandonnée (aucune source gratuite en France). Premier passage de l'Action en échec sur le vrai xlsx concédé (titres anglais en
    ligne 2, « Location », « 46°01821 ») : lecture corrigée d'après ses lignes réelles ; xlsx et ods traités à part.

## Bloc 2 — Guidage

- [x] **Phase 2c-a — Couleurs Panier Perdu (thème, logo, écran de chargement)** (seule, avant la 2c : disposition)
  Identité visuelle de Panier Perdu : noir #14161C, ambre #E8A93B, crème #EDEAE3. Couleurs seulement (police
  system-ui et disposition inchangées). Thème jour/nuit (`src/styles.css`, mêmes variables, contraste WCAG AA vérifié
  par un test), barre du haut noire et titre ambre ; bandeau de manœuvre noir à pictogrammes ambre et texte crème de
  jour comme de nuit ; flèche « auto » noire bordée d'ambre le jour, ambre bordée de noir la nuit ; temps restant et
  arrivée en vert ; fond de carte OpenFreeMap recoloré au chargement (`src/lib/map-palette.js`), tracé ambre bordé de
  noir ; logo et écran de chargement Android noir et ambre. Couleurs réglementaires inchangées (ZFE, panneaux, aires).

- [x] **Phase 2c — Interface de guidage façon Google Maps (jour, nuit, satellite)** (seule, après la 2c-a)
  Disposition et proportions de l'écran de guidage de Google Maps sur Android, sans logo, marque ni icône de Google
  (icônes maison et Material Symbols, Apache 2.0, embarquées), aux couleurs de la 2c-a. Bandeau de manœuvre arrondi
  (flèche, distance, badge de route D/N/A/E aux couleurs des cartouches et nom de rue), « Puis » et 2 alertes au plus
  dessous (« +N » pour les autres) ; véhicule à 78 % de la hauteur, flèche sur halo, tracé épais et partie parcourue
  en gris, pastille de la rue en cours, noms des rues en bulles ; colonne de boutons ronds (boussole, recentrer, loupe
  = catégories à une touche sans saisie, son, autres itinéraires à l'arrêt seulement, place du signalement) ;
  compteur de vitesse (panneau de limitation seulement si la limite PL est connue) ; panneau du bas (temps restant,
  km et heure d'arrivée, ✕ avec confirmation, vue d'ensemble, détails du trajet en tirant la poignée). Paysage :
  colonne à gauche. Nuit : interface sombre, photos IGN assombries, mode auto au lever / coucher du soleil à la
  position (calcul NOAA), bascule sans éclair blanc. Phase d'interface : voix, recalcul et alertes inchangés.

- [x] **Phase 2d — Retouches du guidage (nuit plus claire, liste des aires)** (seule, après les tests tablette de la 2c, v35)
  Liste défilante « Aires et parkings PL » à la place de l'encart à 3 lignes : jusqu'à 15 aires du trajet dans l'ordre
  de la route (déjà placées, aucun appel réseau), une ligne = un bouton ≥ 56 px (pictogramme aire officielle / parking
  OSM, nom, distance, heure d'arrivée, places PL), texte jamais coupé, défilement au doigt sans saisie, mise à jour sans
  clignoter ni redessiner la carte à l'arrêt, fermée seule après 20 s ou par « Fermer ». Portrait : au-dessus du
  compteur, 40 % de la hauteur au plus, jamais sur le bandeau, « Puis » ni les alertes ; paysage : colonne de gauche.
  Appui : repère mis en évidence et fiche courte ; la carte ne se déplace sur l'aire qu'à l'arrêt ; « Y aller » et
  « Fiche complète » seulement à l'arrêt (vue d'ensemble + « Autres itinéraires : bientôt »), jamais de changement
  d'itinéraire. Nuit plus claire : Réglages › Affichage › « Luminosité de la carte la nuit » (Sombre = v35, Normal par
  défaut, Clair), appliquée sous le voile sombre sans rechargement ; photos IGN 0,6 / 0,8 / 0,9 ; textes AA aux trois
  niveaux, tracé ambre et routes ≥ 3:1 sur le fond Clair. Phase d'interface : voix, recalcul et alertes inchangés.

- [ ] **Phase 2e — Retouches du guidage** (petite, seule, après la 2d, v37)
  Barre d'échelle cachée pendant le guidage (en paysage elle dépassait sous le panneau du bas), visible hors guidage ;
  attribution OpenFreeMap / OpenStreetMap toujours visible. Bandeau de manœuvre : aucun texte coupé ni tronqué, en
  portrait comme en paysage ; consigne réduite proprement (70 % de sa taille au plus bas, lisible en cabine), puis
  défilement de la pile du haut en dernier recours. Références de route avec suffixe reconnues et mises en badge
  (« D 120 E », « D 57e2 », « N 83 bis »), jamais coupées entre deux lignes (espaces insécables) ; couleurs des
  badges inchangées. Fiches d'itinéraire : même formulation que le guidage, « Interdiction PL en cours jusqu'à
  dimanche 22 h » si le départ du trajet calculé tombe pendant l'interdiction, « à partir de samedi 22 h » sinon.
  Bouton « Autres itinéraires » grisé : gris opaque (la carte ne se voit plus au travers).

- [ ] **Bloc 2 — Guidage** (une seule conversation)
  Une seule passe de `tools/ui-check.mjs` avec le GPS émulé à la fin du bloc ; un seul incrément de `VERSION` dans
  `sw.js` pour tout le bloc.
  - [ ] Dans la vue d'ensemble, à l'arrêt seulement : proposer d'autres itinéraires depuis ma position (comme en
    phase 2b), choix en un toucher. (Reste de la phase 7c.)
  - [ ] Personnalisation : forme de la flèche, icône camion. (Reste de la phase 7c.)
  - [ ] « Éviter le tunnel » pour une classe Euro interdite (Mont-Blanc, Fréjus, phase 5g) : à l'arrêt, une requête
    ORS sur appui (comme le bouton ADR de la phase 5b : carré de 80 m, avoid_polygons, 150 km au plus). La phase 5g
    n'affiche qu'une alerte.
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

- [x] **Bloc 3 — Réglementation** (une seule conversation)
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
    Réglages (réglage global depuis la v19 : l'ADR dépend du chargement, pas du camion) : « Je transporte des matières
    dangereuses », classe en clair (1 explosibles … 9 divers), numéro ONU facultatif, code de restriction en tunnel
    saisi à la main (vide = aucune alerte, B, C, D, E ; jamais déduit de la classe ; UN 2919, 3291, 3331, 3359, 3373 :
    sans code, ADR 1.9.5.2.2). Anciens profils et anciens fichiers JSON repris (profil actif ADR, sinon le premier).
    ORS ne reçoit que `hazmat` (oui / non) ; d'après son code source (HazmatAccessParser, HeavyVehicleEdgeFilter), il
    évite alors toute voie `hazmat=no` ou `hazmat:B…E=no`, quelle que soit la lettre, et ne lit pas
    `hazmat:adr_tunnel_cat` : phrase dans les notes (« l'itinéraire peut être plus long que nécessaire »).
    Tunnels : pas d'Overpass (mesuré le 20/11/2026 sur 520 km, A6 + A43 : aires seules, tunnels seuls ou les deux
    dépassent 26 s, ou serveur plein ; l'Action elle-même a échoué trois fois) ; copie hebdomadaire
    `data/tunnels-adr.json` par l'Action « Tunnels ADR » (devenue « Données OSM », phase 9b) depuis les extraits par pays de Geofabrik filtrés par osmium
    (voies en tunnel portant `hazmat`, `hazmat:B…E`, `hazmat:adr_tunnel_cat`, France et pays voisins ;
    catégorie = plus haute lettre marquée « no », ADR 8.6.4 : un code interdit sa catégorie et les suivantes), lue
    seulement pour un chargement ADR avec code tunnel. Fourvière (E), Fréjus (C), Mont-Blanc (E) gardés en dur (Bison
    Futé, « Interdictions dans les principaux tunnels »), recoupés avec OSM dans le journal de l'Action. Fiche :
    « Tunnel du Fréjus (catégorie C) interdit au code C : vous y seriez vers km 412 (vers 14 h 20). La signalisation
    fait foi. », autres itinéraires proposés qui l'évitent, bouton « Éviter le tunnel » à l'arrêt (carré de 80 m,
    options.avoid_polygons, 150 km au plus) ; fichier absent ou vide : « Alerte tunnels indisponible (données non
    chargées) » ; aucun tunnel : « Aucun tunnel signalé dans les données (copie du JJ/MM), la signalisation fait foi »
    (jamais « sans tunnel interdit »). Guidage : bandeau sous 20 km, voix une fois vers 5 km. Rappel ADR : mêmes
    interdictions de circulation que les autres PL (arrêté du 16 avril 2021, rien de propre au transport de
    matières dangereuses), dérogations préfectorales (annexe III).
  - [x] **Phase 9b — Aires PL sur les longs trajets** (avant la 5c)
    La requête Overpass des aires échoue au-delà d'environ 500 km (mesure du 20/11/2026 : 26 s dépassées ou serveur
    plein). Copier les aires et parkings PL d'OpenStreetMap (France et pays voisins) dans `data/` comme les tunnels
    ADR (extraits Geofabrik + osmium), placés sur l'appareil sans requête ; Overpass en direct gardé seulement hors de
    la zone copiée.
    Fait : l'Action « Tunnels ADR » devient « Données OSM (tunnels ADR, aires PL) », mensuelle (le 1er) + à la main ;
    par pays un seul téléchargement, un seul filtrage osmium (tunnels + aires de repos, aires de service,
    amenity=parking, capacity:hgv ; parkings gardés en JS avec hgv=yes/designated ou capacity:hgv), un seul export ;
    un pays en échec : rien d'écrit. Premier passage (20/11/2026, extraits du 19/11) : 72 min, 19 285 aires (repos
    9 733, service 6 442, parkings PL 3 110), **1,39 Mo** en 316 cases de 1° + `index.json` (25 Ko, zone couverte
    d'après les contours `.poly` de Geofabrik, cellules de 0,1°) ; Paris → Lyon → Fréjus : 8 cases, 66 Ko lus, aucune
    requête Overpass. Tunnels inchangés (1 182 tubes). Mêmes identifiants qu'Overpass (« Mon avis » gardé), mêmes
    rayons et même sens de circulation, fusion Bison Futé à 300 m ; copie absente ou illisible : « Aires
    indisponibles sur ce trajet (données non chargées) » ; date de la copie dans la note de source et sur la fiche.
  - [x] **Phase 5c — Passage de frontière : réglementation PL du pays**
    Repérer les changements de pays sur l'itinéraire (`extra_info: ["countryinfo"]` d'ORS). Avant le départ : liste des
    pays traversés avec une fiche par pays (vitesses PL, interdictions week-end et jours fériés, péage PL et son système,
    zones à faibles émissions ou vignettes, particularités ADR). Pendant le guidage : annonce vocale courte à l'approche
    de la frontière, sans saisie. Fiches dans `data/pays/*.json`, avec la source officielle et la date de vérification
    de chaque règle ; d'abord les pays voisins (BE, LU, DE, CH, IT, ES).
    Fait : `countryinfo` dans la même requête ORS (variantes et recalcul compris, aucune requête en plus ; doc et code
    ORS : disponible pour driving-hgv, extras propres à chaque itinéraire alternatif) ; absent → « Pays traversés
    indisponibles ». Fiches : km et heure de chaque frontière (recalées par les pauses conseillées), vitesses selon le
    PTAC (source nationale obligatoire), interdictions avec « en vigueur à votre passage ? » quand la règle est sûre,
    péage, ZFE / vignettes, ADR (tunnels repris de la copie de la phase 5b), source nommée (officielle nationale ou
    Bison Futé), « à vérifier » sinon, « la signalisation fait foi » à la fin. Guidage : ligne du bandeau de 20 km
    avant à 1 km après, voix une fois vers 3 km avec les seules contraintes confirmées (jamais une absence
    d'interdiction), coupée avec la voix des règles. Sources lues le 20/11/2026 : BE code de la route art. 11 (Vias),
    Viapass ; LU code de la route art. 139 (Legilux), police grand-ducale (transit vers FR / DE), Guichet.lu
    (Eurovignette) ; DE StVO § 3, 18, 30, FerReiseV (samedis d'été affichés « possible sur certaines autoroutes »,
    jamais calculés), BFStrMG ; CH OCR art. 5 et 91, OFROU, OFDF (RPLP), LVA art. 3 (pas de vignette pour la RPLP) ;
    IT Codice della strada art. 142, décret MIT du 12/12/2025 (calendrier 2026, GU n. 302) ; ES Reglamento General
    de Circulación art. 48, résolution DGT du 14/01/2026 (BOE). Restent « à vérifier » : LEZ / ZFE des six pays,
    péages IT et ES, système Toll Collect, fêtes régionales, tronçons ES et samedis d'été DE. Calendriers IT et ES :
    rappel avec le lien dès le 1er janvier d'une année absente (à ajouter chaque année dans `data/pays/IT.json`,
    `ES.json`).
  - [x] **Phase 5d — Accès : tranches horaires et desserte locale**
    Interdictions PL par tranches horaires (tags OpenStreetMap conditionnels, par exemple `hgv:conditional`) : vérifier
    si ORS les applique avec une heure de départ et l'utiliser, sinon alerter sur le trajet. « Sauf desserte locale /
    livraisons » : autoriser ces routes quand l'arrivée ou une étape est dans le secteur (vérifier `vehicle_type`
    `delivery` / `goods` d'ORS et sa gestion de `hgv=destination` / `delivery`). Sources officielles citées.
    Données sans Overpass : copie hebdomadaire par une Action (comme `data/tunnels-adr.json` : extraits Geofabrik
    par pays filtrés par osmium) des voies PL
    conditionnelles d'OpenStreetMap (`hgv:conditional`, `maxweight:conditional`, `access:conditional`,
    `hgv=destination` / `delivery`) en France et pays voisins, découpée en cases de 1° (un fichier par case, lu
    seulement pour les cases touchées par le tracé), avant de vérifier ce qu'ORS en fait.
    Fait : doc et code d'ORS lus le 20/11/2026 (GIScience/openrouteservice) : `departure` caché, accès conditionnels
    pris en compte seulement avec `conditional_access` à la construction du graphe (faux par défaut) → alerte, jamais
    `departure` ; profil camion : `hgv=destination` et `delivery` acceptés partout, `vehicle_type` reste `hgv` ;
    extra `roadaccessrestrictions` (valeurs cumulées : 4 Destination, 8 Delivery) dans la même requête, variantes et
    recalcul compris. Desserte : acceptée si elle part du départ ou mène à l'arrivée ou s'en trouve à moins de 3 km,
    sinon « Route réservée à la desserte locale vers km X : vous la traversez » et « Éviter la desserte locale » à
    l'arrêt (une requête ORS sur appui, avoid_polygons, 150 km au plus). Tranches horaires : `hgv`, `motor_vehicle`,
    `vehicle`, `access`, `maxweight:conditional` (et `:forward` / `:backward`) ajoutés à l'Action « Données OSM »
    (même téléchargement, même filtre osmium), routes carrossables seulement, `data/acces-osm/` en cases de 1° lues
    si le tracé les touche ; priorité hgv > motor_vehicle > vehicle > access ; voie retenue si 80 % de sa longueur
    suit le tracé à moins de 15 m, dans le même sens ; horaires du lecteur des ZFE (plages passant minuit, PH avec
    les fériés du pays traversé), heure de passage recalée par les pauses ; saisons, météo, pays sans calendrier :
    une ligne « N voies avec conditions non lues, à vérifier », jamais d'alerte. Guidage : bandeau sous 10 km, voix
    une fois vers 3 km si interdite à l'heure de passage. Premier passage (20/11/2026, extraits du 19/11) : 44 min,
    45 770 voies (maxweight:conditional 23 857, motor_vehicle 8 027, access 5 960, hgv 4 628, vehicle 2 620),
    **3,12 Mo** en 245 cases + `index.json` (24 Ko), plus grosse case 4_51 (196 Ko) ; Overpass +0, ORS +0 par calcul.
    Code de la route art. R411-8 : Légifrance refuse aussi l'Action (403) ; lu dans le PDF du code de codes.droit.org
    (édition du 27/10/2026) par le job `r411` le 21/11/2026, texte cité dans `access-conditional.js`.

## Bloc 4 — Compléments réglementaires

- [ ] **Bloc 4 — Compléments réglementaires** (une PR par phase, dans l'ordre 5e → 5f → 5g → 5h)
  Chaque règle vérifiée sur une source officielle (citée avec sa date) ; une règle non confirmée est « à vérifier »
  et n'est jamais annoncée ; « La signalisation fait foi » sur chaque alerte.
  - [x] **Phase 5e — Poids et frontières** (priorité)
    En trafic international : 40 t maximum pour un ensemble de 5 essieux ou plus (directive 96/53/CE), même entre deux
    pays qui autorisent 44 t chez eux ; 44 t seulement en transport combiné. PTAC du profil actif au-delà de 40 t et
    itinéraire qui passe une frontière : alerte avant le départ (« Au-delà de 40 t, trajet international interdit sauf
    transport combiné : vérifiez votre poids réel »), sans voix ; case « Transport combiné » dans le profil.
    `data/pays` : poids total maximal national et hauteur maximale de chaque pays, avec source, sur la fiche pays.
    Fait : sources lues le 21/11/2026 — directive 96/53/CE annexe I 2.2.2 modifiée par la directive (UE) 2015/719
    (JO UE L 115 du 6/05/2015 ; intermodal : 42 t avec un tracteur à 2 essieux, 44 t avec un tracteur à 3 essieux,
    conteneurs ou caisses mobiles de 45 pieds au plus), réponse ministérielle à la question écrite AN n° 1666 (JO du
    7/02/2023 : une dérogation nationale ne peut pas devenir transfrontalière, Conseil d'État du 27/09/2022) ;
    révision de la directive pas adoptée. Alerte « Votre profil indique 44 t (PTAC, pas le poids réel) : en
    international, poids réel limité à 40 t sauf transport combiné… » avant le départ, jamais dite ; case
    « Transport combiné » du profil (44 t : information, au-delà : alerte à 44 t) ; pays inconnus : « à vérifier ».
    Fiches : DE StVZO § 34 / § 32 (40 t, intermodal 44 t, 4,00 m), CH LCR art. 9 (40 t, 44 t combiné, 4 m), IT
    Codice della strada art. 62 / 61 (44 t, 4 m), ES Orden PJC/780/2025 (44 t depuis le 23/10/2025, citernes le
    23/01/2026, 4,00 m) ; BE et LU « à vérifier » (textes non lisibles depuis le conteneur). Profil plus haut que la
    hauteur maximale : alerte sur la fiche et dans les notes.
  - [x] **Phase 5f — Équipements d'hiver**
    France, loi Montagne : du 1er novembre au 31 mars, communes de 34 départements (liste officielle copiée dans
    `data/`, Action annuelle si besoin) ; ensemble avec semi-remorque : chaînes à bord même avec des pneus hiver ;
    alerte quand le trajet traverse une commune concernée pendant la période. Pays voisins : obligations d'hiver sur la
    fiche pays. Panneau B26 : simple rappel.
    Fait : sources lues le 21/11/2026 — réponses ministérielles AN n° 3489 (JO du 21/03/2023 : décret n° 2020-1264,
    1er novembre – 31 mars, communes fixées par arrêté préfectoral ; PL avec remorque ou semi-remorque : chaînes pour
    deux roues motrices à bord même avec pneus hiver ; sans remorque : chaînes ou pneus hiver ; B26 : chaînes montées,
    3PMSF admis sauf panonceau) et n° 10745 (JO du 17/02/2026 : pas encore de sanction). Liste officielle de la
    Sécurité routière (xlsx du 22/10/2022, 4 173 communes dont 156 en partie, 34 départements) + contours des communes
    2022 (data.gouv.fr, ODbL) copiés dans `data/hiver/` par l'Action « Équipements d'hiver » (15 octobre, à la main, à
    chaque envoi de l'outil ; échec si plus de 2 % des codes INSEE sans contour). Tracé coupé exactement par les
    contours (aucun échantillonnage). Alerte avant le départ si le passage tombe dans la période, date de la liste,
    arrêtés plus récents « à vérifier », profil « Remorque » (non précisé, sans, avec) ; rien dans le guidage. Fiches
    pays « Équipements d'hiver » toute l'année : DE StVO § 2 (3a) / StVZO § 36 (4), LU art. 156 et 160, CH OSR art. 29,
    ES RGC (panneaux), BE art. 81.4.4 ; IT Codice della strada art. 6 (ordonnance), période 15/11 – 15/04 « à
    vérifier » ; AT (KFG § 102, RIS refusé au conteneur) « à vérifier », texte lu dans le journal de l'Action.
  - [x] **Phase 5g — Normes Euro et tunnels**
    Champ « Norme Euro » (0 à 6), facultatif, dans le profil. Mont-Blanc, Fréjus : normes interdites d'après le
    règlement en vigueur ; alerte sur la fiche si le tracé passe le tunnel avec une norme interdite, rappel si la norme
    est vide ; tunnels repérés avec `data/tunnels-adr.json`.
    Fait : profil « Classe Euro (moteur) » (non précisé par défaut, 0 à 6, EEV ; servira à la 5h). Tunnels repérés
    avec les tubes en dur de `KNOWN_TUNNELS` (phase 5b, sans fichier ni Overpass), au-delà de 3,5 t de PTAC, textes
    « PL de marchandises » (le profil n'a pas de type de véhicule). Sources lues le 21/11/2026 : Mont-Blanc, arrêté
    préfectoral n° 2020-0825 du 18/06/2020 (PDF de Bison Futé : Euro 0 à 4 interdits depuis le 1/07/2020, 1re mise en
    circulation avant le 1/10/2006 sauf preuve Euro 5 ; EEV absent de la liste : admis) ; Fréjus, arrêté du 7/07/2017
    (page Bison Futé : Euro 0 à 2) et SFTRF, page « Classification tunnel » lue par l'Action « Sources Euro » (Euro 3
    et 4 : « confirmé par l'exploitant », arrêté préfectoral non retrouvé) ; aucun péage PL selon la classe Euro aux
    deux tunnels (SITAF 2026 : une seule classe PL Euro 5-6 ; ATMB). Alerte sur la fiche d'itinéraire et dans les
    notes (classe interdite), information (classe admise), les deux cas si la classe n'est pas précisée ; chaque
    alerte finit par « La signalisation fait foi. » ; rien dans le guidage. Fiches pays, rubrique « Normes Euro » :
    CH RPLP (ORPL art. 14 et annexe 1, version du 1/01/2025 : catégorie 1 Euro 0 à V et EEV 3,26 ct/t·km,
    catégorie 3 Euro VI 2,39 ct) ; DE Maut (BFStrMG annexe 1 ch. 2, catégories A à F) et vignette verte
    (35. BImSchV annexe 2 : Euro IV, V, EEV ; Euro VI « à vérifier ») ; AT (Tyrol, A12 : RIS en erreur 503 pour le
    conteneur et l'Action) et IT (interdictions régionales) « à vérifier ». ZFE / Crit'Air des PL : déjà couverts
    (phase 5) ; correspondance Euro → Crit'Air (arrêté du 21/06/2016, Légifrance 403) non faite, vignette saisie.
  - [ ] **Phase 5b bis — ONU 3077 et 3082 au Mont-Blanc**
    Bison Futé : ONU 2919, 3077, 3082, 3291, 3331, 3359, 3373 refusés (interdiction de transit sur les rampes d'accès,
    préfectures française et italienne) ; `KNOWN_TUNNELS` (phase 5b) n'a pas 3077 ni 3082. L'arrêté n° 2009-3425
    (lu par reconnaissance de texte (OCR) dans l'Action « Sources Euro » le 21/11/2026) ne cite que 2919, 3291, 3331,
    3359 et 3373 : à vérifier dans les arrêtés des rampes (préfectoral n° DDT-2010-60 du 29/01/2010, décret n° 33 du
    26/01/2010 de la Vallée d'Aoste) avant de coder.
  - [x] **Phase 5h — Taxes PL régionales** (avant le 1er janvier 2027)
    Fait : `data/taxes-pl.json` (dans `APP_FILES`) et `hgv-tolls.js`. R-Pass (Collectivité européenne d'Alsace,
    prévue au 1er janvier 2027, réseau et grille du site officiel r-pass.eu) et écocontribution PL du Grand Est
    (prévue au 2 avril 2027, réseau officiel d'ecpl.fr) repérées par les références de route des étapes ORS dans le
    cadre de la région, en France (countryinfo), au-delà de 3,5 t ; heure de passage recalée par les pauses. Statut
    « annoncée » : information seulement, jamais sur la fiche d'itinéraire, jamais de voix ni de bandeau ; R-Pass :
    taux de la classe du profil (PTRA × classe Euro, dépliant officiel), aucun total ; ECPL : aucun montant (classe
    CO2 absente du profil). Recours devant le tribunal administratif de Strasbourg mentionné (effet suspensif non
    établi). Fiches pays : « Changements au 1er janvier 2027 » (BE Viapass lu ; DE, AT, CH « à vérifier », version de
    l'ORPL en vigueur citée). Autriche ajoutée à la recherche d'adresse.
  - [x] **Phase 5h ter — R-Pass / ECPL repérés par la géométrie**
    Fait : ORS renvoie de longues étapes sans nom ni référence (90 km entre Mulhouse et Strasbourg, 83 km d'A31 entre
    Thionville et Toul, diagnostics v30). Réseau taxé copié d'OSM par l'Action mensuelle (`data/taxes-pl-osm.json`,
    hors `APP_FILES` ; voies portant une référence de la taxe, hors bretelles et hors péage PL (`toll:hgv=yes`, ou `toll=yes` sans `toll:hgv=no`), découpées par les
    contours IGN Admin Express : Alsace, Grand Est sans l'Alsace, Eurométropole exclue, RN52 en Meurthe-et-Moselle),
    comparé au tracé (`hgv-tolls-geo.js` : 15 m, cap modulo 180°, veto du nom d'étape, séries de 300 m) ; copie absente
    → noms d'étape (« au moins »). Journal de l'Action : km avant et après découpage, exclus pour péage par référence, répartition
    toll / toll:hgv de l'A31 au sud de Toul, total ECPL (environ
    525 km annoncés). Diagnostic : méthode, points tous les 10 km sur les étapes sans nom. Calcul en échec : ancien
    tracé et repères effacés. Code 2009 : une requête de diagnostic sans les restrictions du profil (budget de 3),
    message « peut-être joignable seulement en franchissant une limite… », jamais affichée ni guidée ; échec aussi sans
    restrictions → « rue sans sortie possible pour le camion ». Diagnostic : version demandée au service worker.
  - [ ] **Contours Admin Express à jour** (millésime récent, site IGN) : remplacer les contours COG 2018 de
    `data/taxes-pl.json` (Alsace, Eurométropole, Grand Est, Meurthe-et-Moselle).
  - [ ] **Taxes PL : montants Maut (DE) et péage autrichien** : champ « Essieux » du profil (non précisé par défaut :
    les deux cas ; 2, 3, 4, 5 et plus) seulement quand un montant qui en dépend est affiché, grilles officielles lues
    (BFStrMG annexe 1, Mauttarifverordnung).
  - [ ] **Péage PL sur les routes régionales du Burgenland (Autriche, 2027)** : routes, date et base légale à lire
    (RIS, Landesgesetzblatt) avant de coder.
  - [ ] **R-Pass / écocontribution Grand Est confirmés** : passer `status` à 'confirmed' dans `data/taxes-pl.json`
    après lecture des délibérations (R-Pass n° CD-2025-4-7-1 du 20/10/2025 ; ECPL : non retrouvée) et de l'issue du
    recours ; carte détaillée des sections (PDF « Réseau taxable » de r-pass.eu illisible en texte) ; ECPL : grille
    avec la classe CO2 du profil (nouveau champ, non précisé par défaut).
  - **À étudier avec la phase 10 (pas de code)** : barrières de dégel, circulation différenciée en épisode de
    pollution, fermetures de tunnels et de cols.

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
