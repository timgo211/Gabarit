---
name: gabarit-tunnels-frontieres-poids
description: Règles ADR et tunnels (5b), frontières et fiches pays (5c), poids aux frontières (5e), normes Euro (5g). À utiliser avant de toucher adr.js, countries.js, country-rules.js, weights.js, euro.js ou data/pays.
---

# ADR, frontières, poids, normes Euro

(Texte déplacé tel quel depuis CLAUDE.md.)

- ADR (phase 5b, `adr.js`) : réglage global dans Réglages (« Matières dangereuses (ADR) », `settings.adr` :
  `enabled`, `adrClass`, `unNumber`, `tunnelCode`), jamais dans le profil véhicule (dépend du chargement). Code tunnel
  vide / B–E saisi à la main (« lettre indiquée sur le document de transport ; la classe seule ne la donne pas »),
  jamais déduit de la classe ; 'none' seulement s'il vient d'un ancien profil. Reprise (`migrateAdrSettings`, stockage
  et import d'un ancien JSON) : profil actif ADR, sinon premier profil ADR. `activeVehicle(data)` = profil + `withAdr`
  (hazmat, tunnelCode, adrClass, unNumber) : ORS, alertes, résumés et notes lisent ce véhicule. ORS ne reçoit que `hazmat` ; avec lui il évite toute voie `hazmat=no` / `hazmat:B…E=no`
  quelle que soit la lettre (code source HazmatAccessParser) et ignore `hazmat:adr_tunnel_cat` → phrase « l'itinéraire
  peut être plus long » dans les notes. Code tunnel (`tunnelCode` '', B–E, 'none'), `adrClass`, `unNumber`
  facultatifs, ignorés sans la case ADR ; code vide = aucune alerte (une ligne d'info seulement). Catégorie OSM = plus
  haute lettre `hazmat:X=no`, `hazmat:adr_tunnel_cat`, `hazmat=no` → 'X' (tout interdit) ; code interdit si lettre ≤
  catégorie. Tunnels : jamais d'Overpass (mesure 520 km : > 26 s ; Action en échec trois fois le 20/11/2026, serveurs pleins) :
  extraits Geofabrik + osmium dans l'Action, `data/tunnels-adr.json` chargé seulement
  pour un chargement ADR avec code ; absent / vide → « Alerte tunnels indisponible (données non chargées) », jamais un
  silence ; jamais « sans tunnel interdit » mais « Aucun tunnel signalé dans les données (copie du JJ/MM), la
  signalisation fait foi » ; chaque alerte tunnel finit par « la signalisation fait foi ». `KNOWN_TUNNELS` : Fourvière
  E, Fréjus C, Mont-Blanc E (Bison Futé), catégorie gardée face à OSM, vérifiés sans données. Tube sur le tracé : 5
  points à 35 m au plus, dans l'ordre ; tubes qui se chevauchent réunis. « Éviter le tunnel » : carré de 80 m au milieu
  (avoid_polygons ajouté aux ZFE évitées, 150 km), option « Contournement ». Guidage : `view.rules.tunnel`, bandeau
  sous 20 km, voix vers 5 km (`settings.ruleVoice`). Nom affiché : `tunnel:name` d'abord (Fourvière : name =
  « Autoroute du Soleil ») ; `hazmat=E` (lettre en valeur) = catégorie E. Overpass, Geofabrik, api.openstreetmap.org
  et unece.org refusent le conteneur (Action GitHub pour mesurer / copier).
- Frontières (phase 5c, `countries.js`, `country-rules.js`) : `extra_info: ['tollways', 'countryinfo']` dans toutes
  les requêtes (variantes 2b et recalcul : aucune requête en plus) ; ids ORS (docs/technical-details/country-list.md :
  FR 70, BE 17, LU 117, DE 74, CH 193, IT 97, ES 187 ; 75 et 141 zones partagées → pays voisin) ; extra absent →
  « Pays traversés indisponibles », jamais un silence. `data/pays/{BE,LU,DE,CH,IT,ES}.json` dans `APP_FILES` (hors
  ligne à l'étranger) : chaque règle a `source` (clé de `sources` : nom, lien, `national` ou `bisonfute`) et `verified`
  (date) ; sans source lue → « à vérifier » sur la fiche, jamais dite. Vitesses : source nationale obligatoire ;
  Bison Futé suffit pour les jours fériés et « BE : pas d'interdiction ». Fiche : source nommée (« source officielle »
  ou « Bison Futé »), « en vigueur à votre passage ? » seulement pour une règle sûre qui concerne le véhicule (PTAC
  strictement au-dessus du seuil, ADR / classe, transit LU selon le pays de sortie), heures recalées par `elapsed`,
  fin « La signalisation fait foi. ». DE samedis d'été (FerReiseV) : `kind: 'info'`, jamais calculés ni dits. CH :
  pas de vignette pour la RPLP (LVA art. 3 al. 2). Calendriers annuels IT (`calendar` par année) et ES
  (`calendarYears`) : année absente (aujourd'hui, entrée ou sortie) → rappel avec le lien dès le 1er janvier, rien
  de calculé ; à compléter chaque année. Fériés : `countryHolidays(code, année)` (BE, LU, DE, CH, IT, ES, LU_DE,
  LU_FR), régionaux « à vérifier » (`REGIONAL_HOLIDAYS`). Guidage : `view.rules.border` (bandeau de 20 km avant à
  1 km après, une ligne), voix une fois vers 3 km (`settings.ruleVoice`) : vitesse et interdictions confirmées
  seulement, jamais une absence d'interdiction. mit.gov.it coupe la connexion depuis le conteneur : décret lu dans la
  Gazzetta Ufficiale ; Fedlex et Legilux lus par leurs points SPARQL (fedlex.data.admin.ch, data.legilux.public.lu).
- Poids et frontières (phase 5e, `weights.js`) : directive 96/53/CE (annexe I 2.2.2, modifiée par 2015/719, lue dans
  l'édition du JO reproduite par boe.es : EUR-Lex répond 202 vide aux lectures automatiques) et réponse ministérielle
  AN n° 1666 (JO du 7/02/2023) : 40 t en trafic international pour 5 essieux et plus, même entre deux pays à 44 t ;
  intermodal 42 t (tracteur 2 essieux) / 44 t (3 essieux). Trajet international = au moins deux pays dans
  `countryinfo` ; PTAC du profil > 40 t → alerte (texte : « Votre profil indique X t (PTAC, pas le poids réel) : … »),
  jamais de voix ; `vehicle.combined` (case « Transport combiné », anciens profils : non) → information jusqu'à 44 t,
  alerte au-delà ; countryinfo absent → ligne « à vérifier ». Fiches pays : `limits.weight` (`max`, `combinedMax`
  DE / CH 44 t) et `limits.height` (`max` en m), source nationale obligatoire, sinon « à vérifier » sans valeur (BE, LU :
  eJustice demande un captcha, Legilux en JavaScript) ; profil au-delà : `warn` sur la fiche, hauteur dépassée aussi
  dans les notes (« Hauteur max Pays »). Sites officiels à ajouter à l'environnement cloud « Gabarit ».
- Normes Euro (phase 5g, `euro.js`) : profil `euroClass` ('' non précisé par défaut, '0'–'6', 'EEV' ; anciens profils
  → ''), servira à la 5h. Tunnels : seulement au-delà de 3,5 t de PTAC, tubes en dur de `KNOWN_TUNNELS` (pas de
  fichier ni d'Overpass) ; règles `TUNNEL_RULES` avec `status` 'confirmed' (texte officiel lu), 'operator'
  (« Confirmé par l'exploitant : nom, lu le JJ/MM/AAAA ; arrêté préfectoral non retrouvé »), 'check' (« à vérifier »,
  information, jamais « interdit » ni « admise ») ; Mont-Blanc : arrêté n° 2020-0825 (Euro 0 à 4) ; Fréjus : arrêté
  du 7/07/2017 (Euro 0 à 2) + SFTRF (Euro 3 et 4, exploitant). Classe interdite → alerte (notes + fiche
  d'itinéraire), admise → information, non précisée → les deux cas (« classe Euro ? » sur la fiche) ; EEV admis
  (absent des listes), comme Euro V pour la RPLP et la Maut (`EURO_EEV`). Textes « PL de marchandises » : le profil
  n'a pas de type de véhicule (autocar, camping-car non distingués). Chaque alerte finit par « La signalisation fait
  foi. » ; jamais de voix, de bandeau ni d'annonce. Fiches pays : bloc `euro` (règle + `mine` : texte par classe ;
  classe absente de `mine` → « à vérifier ») ; CH (ORPL), DE (BFStrMG annexe 1, 35. BImSchV) ; AT et IT « à
  vérifier ». « Éviter le tunnel » pour une classe Euro : Bloc 2 Guidage. sftrf.fr, sitaf.it, atmb.com,
  tunnelmb.net et ris.bka.gv.at refusent le conteneur (RIS répond aussi 503 à l'Action).
