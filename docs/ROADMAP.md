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

- [ ] **Phase 7c — Confort du guidage**
  - [x] Boutons permanents « Vue d'ensemble » (tout le trajet restant) et « Recentrer ».
  - [ ] Dans la vue d'ensemble, à l'arrêt seulement : proposer d'autres itinéraires depuis ma position (comme en
    phase 2b), choix en un toucher.
  - [x] Bouton Plan / Satellite aussi pendant le guidage (un toucher ; le guidage démarre en plan, choix non mémorisé).
  - [x] Guidage moins sombre en mode jour (bandeau du haut et barre du bas plus clairs, contraste gardé).
  - [x] Barre du bas : traits fins entre Reste, Temps, Arrivée et Vitesse.
  - [x] Encart avec le nom de la route sur laquelle je roule (étape ORS en cours), en bas de la carte.
  - [x] Flèche du camion plus fluide : déplacement et rotation animés entre deux positions GPS.
  - Personnalisation :
    - [x] couleur de la flèche (auto, bleu, vert, orange, violet) ;
    - [ ] forme de la flèche, icône camion ;
    - [x] voix : choix parmi les voix françaises installées, vitesse, volume, bouton « Tester ».
  - [x] Musique pendant les consignes : Chrome (Android compris) n'a pas l'Audio Session API (Safari seulement) ;
    Réglages l'explique (réglage appliqué automatiquement si un navigateur la propose).
  - [x] Partager Gabarit avec un guide d'installation pas à pas pour un autre téléphone (ouvrir le lien, installer,
    créer sa clé gratuite, la coller dans Réglages).

- [ ] **Phase 8 — Destinations et étapes**
  - [ ] Étapes : plusieurs arrêts dans l'ordre, ajout d'une étape en route (à l'arrêt). Avec des étapes,
    `alternative_routes` n'est pas possible (2 points seulement) : garder les variantes de la phase 2b. (Reprend la
    tournée multi-arrêts de la phase 3.)
  - [x] Destination (ou départ) par appui long sur la carte, hors guidage : « Aller ici » / « Partir d'ici ».
  - [x] Coordonnées GPS dans le champ départ ou arrivée : décimal (48.6921, 6.1844) et degrés-minutes-secondes
    (48°41'31.6"N 6°11'03.8"E), aussi degrés-minutes décimales.

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
  Strasbourg, Aix-Marseille…). Les colonnes du jeu officiel n'ont pas pu être vues depuis le conteneur : vérifier le
  journal du premier passage de l'Action.

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
  officielles citées (accord ADR, arrêtés français). Classe ADR (1 à 9) et numéro ONU facultatif dans le profil,
  pour distinguer les règles qui en dépendent.

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

- [ ] **Phase 11 — Infos route : limitations de vitesse et directions** (ancienne phase 9, renumérotée)
  Limitation de vitesse PL pendant le guidage (tags OpenStreetMap `maxspeed:hgv` / `maxspeed` des voies du trajet,
  via ORS si possible ou Overpass ; à défaut, règles françaises par type de route, source officielle citée), avec
  alerte en cas de dépassement. Dans les consignes, la direction écrite sur les panneaux (tags OSM `destination` des
  bretelles) ou la commune la plus proche (« Tournez à droite, direction Metz »). Données calculées une fois par
  itinéraire pour ménager les quotas.

- [ ] **Phase 6 — Historique et notes**
  Historique des trajets, statistiques, relevé PDF via impression. Notes perso détaillées sur les aires et parkings
  utilisés (sécurité, douches, propreté…), affichées au prochain passage, en plus de « Mon avis » de la phase 9.
  (Aires et parkings PL, prochain parking en guidage : phase 9.)

- [ ] **Phase 7d — Satellite hors de France**
  Orthophotos ouvertes nationales, après vérification de leurs conditions : Luxembourg (geoportail.lu), Belgique (NGI /
  régions), Allemagne (selon le Land), Suisse (swisstopo SWISSIMAGE), Espagne (PNOA, IGN España). Sinon, message actuel.

- [ ] **Phase 10 — Trafic en temps réel (à étudier)**
  ORS ne tient pas compte du trafic. D'abord étudier les sources gratuites : données ouvertes du réseau routier
  national (Bison Futé / DIR, événements DATEX II sur transport.data.gouv.fr), offres gratuites avec clé (TomTom,
  HERE…) et leurs quotas. Commencer par afficher bouchons et événements sur le trajet ; recalcul selon le trafic
  seulement si une source le permet. Présenter les options avant de coder.

- [ ] **Phase 3 — Mes signalements + Ma journée** (reportée : à faire en dernier)
  Signalement perso avec alerte vocale à l'approche. En roulant, un seul gros bouton qui marque la position (aucune
  saisie pendant le guidage, comme en phase 2 – R412-6-2) ; le type (pont bas, accès difficile, contrôle, parking,
  danger) et la note se choisissent à l'arrêt. Lieux enregistrés (domicile, dépôt, clients) ; les étapes sont en
  phase 8.

## Hors de portée d'une appli web
- **Android Auto / CarPlay** : réservés aux applis natives validées par Google ou Apple. Il faudrait réécrire Gabarit
  en appli Android native ; ce n'est pas prévu.
