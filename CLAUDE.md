# Gabarit — consignes pour Claude

**But** : PWA perso de GPS poids lourd (inspirée de POIDZ), utilisée sur une tablette Android.
Le propriétaire n'a pas de terminal : tout passe par ce dépôt et GitHub Pages (racine de `main`). Budget 0 €.

## Style des réponses (économie de tokens)
- Messages du chat en mode caveman (skill `caveman` si disponible, sinon même style) : phrases courtes, pas de blabla,
  pas de récapitulatif des étapes.
- Ne changent pas : le code, les commentaires et sources citées, les textes de l'appli, les commits, les docs du dépôt.
- Restent complets : le plan avant de coder et la liste « à vérifier sur la tablette » (phrases courtes, aucun point retiré).

## Structure
- `index.html`, `manifest.webmanifest`, `sw.js` (service worker module), `icons/`
- `src/lib/` : logique pure, sans DOM, testable sous Node ; `src/ui/` : interface (DOM, MapLibre, fetch) ; `src/app.js` assemble le tout
- `tests/` : `*.test.js` + `fixtures/` ; `tools/` : outils et mises à jour des données ; `.github/workflows/` : Actions
- `data/` : gros fichiers générés par les Actions — ne pas les lire en entier (utiliser `node -e`, `grep` ou `head`)
- `docs/ROADMAP.md` : feuille de route
- Détail de chaque module, fixture et Action : skill `gabarit-structure`.

## Tester
```
node --test
```
(lancé aussi par `.github/workflows/tests.yml` à chaque push). Doit rester 100 % vert. Un hook Stop le relance tout seul à la fin de chaque tour où le code a changé.

Interface : `node tools/ui-check.mjs [scénario]` (Playwright, hors CI, à relancer après toute modif d'interface) — mode d'emploi et scénarios : skill `gabarit-tests-interface`.
Rouge connu du conteneur (Chromium sans carte graphique), toléré, ne pas s'arrêter dessus : `ui-check context`, « contexte WebGL perdu puis restauré : carte redessinée » (magenta 255,0,255, aussi sur main). Aussi toléré : `ui-check overview`.
`draw` et `sensibles` : verts (tests mis à jour pour v53 et v81). v85 : itinéraire montré avant la création de la carte (reprise v53) → cadré une fois et repères posés à la création (`route-replay.js`, `draw` : 10 rechargements).
Aucun test sur le temps d'horloge (machine chargée = échec au hasard) : mesurer le travail (compteur) à la place ;
adresse d'import unique = compteur, jamais `Date.now()`.

## Modèles (choisis automatiquement)
- Mode plan → Opus ; exécution → Sonnet (`"model": "opusplan"` dans `.claude/settings.json`).
- Recherches dans le code → sous-agent `Explore` (Haiku). Vérifications après modif → sous-agent `verificateur` (Haiku) : ne pas lancer les tests dans la conversation principale.
- Tâche vraiment simple (texte, renommage, petite correction) : rester en exécution, pas de mode plan.

## Règles détaillées par domaine (skills, à charger avant de toucher au domaine)
- `gabarit-interface` : carte, guidage à l'écran, mise en page téléphone/tablette, satellite, partage, réglages 7c, coordonnées
- `gabarit-aires` : aires et parkings PL (phases 9, 9b)
- `gabarit-zfe-acces-hiver-taxes` : ZFE et interdictions PL (5), accès (5d), hiver (5f), taxes PL (5h)
- `gabarit-tunnels-frontieres-poids` : ADR (5b), frontières (5c), poids (5e), normes Euro (5g)
- `gabarit-conduite-vent` : temps de conduite et vent fort (5 B)
- `gabarit-trafic` : trafic Bison Futé (10 A) : Action, branche `trafic-data`, bouton « Trafic » à l'arrêt
- Nouvelle règle propre à un domaine → l'écrire dans le skill du domaine (nouveau skill si nouveau domaine), pas ici. Ce fichier reste court : il est relu à chaque message.

## Conventions
- HTML/CSS/JS vanilla, modules ES, sans framework, sans build, sans dépendance npm.
- Dépendances CDN à version épinglée (MapLibre GL JS 4.7.1 : `index.html`, `config.js`, `sw-routing.js`).
- Chemins **relatifs** partout (site servi sous un sous-dossier).
- URL d'API dans `src/lib/config.js`, sans slash final : `api.heigit.org/openrouteservice/v2` et `/pelias/v1`.
- ORS : profil `driving-hgv`, `options.vehicle_type: "hgv"`, `profile_params.restrictions`, `maximum_speed` ≥ 80.
- Interface et messages en français, pensés pour la cabine (gros boutons, contraste, mode nuit).
- Couleurs Panier Perdu (2c-a) : noir #14161C, ambre #E8A93B, crème #EDEAE3 ; variables de `src/styles.css` seulement
  (contraste AA vérifié par `tests/contrast.test.js`), fond de carte dans `src/lib/map-palette.js`. Couleurs réglementaires inchangées.
- Toute modif de fichier mis en cache → incrémenter `VERSION` dans `sw.js` et ajouter le fichier à `APP_FILES`.
- Version en bas de Réglages (`#app-version`) : demandée au service worker qui contrôle la page (`GET_VERSION`, `src/lib/app-version.js`), seule source `VERSION` de `sw.js` ; sans réponse → « version inconnue ».
- Nouvelle logique → dans `src/lib/` avec ses tests ; règles réglementaires citées en commentaire avec la source officielle.
- Guidage : toute position (GPS réel ou simulation) passe par `updateNavigation` ; l'UI ne prend aucune décision.
  Hors itinéraire (`NAV`) : détection seulement à ≥ 10 km/h avec une précision ≤ 30 m ; à l'arrêt hors du tracé,
  recalcul seulement proposé (bouton « Recalculer d'ici », `requestReroute`) : l'itinéraire ne change jamais sans
  accord hors d'une vraie sortie de route en roulant.
- Ponts sans hauteur connue (12a, `bridge-check.js`, copie `data/ponts-osm/` de l'Action « Données OSM », jamais
  précachée) : fiche et carte à l'arrêt seulement, jamais dits à voix haute ni dans le guidage ; « à vérifier ».
  v91 (règle de Timothée, `agglo-zones.js`) : au-dessus d'une autoroute, signalé (moyenne) seulement en zone
  (IdF + 8 agglomérations, `data/zones-agglo.json` + `data/contours-ign.json`) ; zones illisibles = 1 ligne « à vérifier » ;
  audit niveau 1 idem (zones illisibles = arrêt sans écriture).
- Mes restrictions (12b, `restrictions.js`, champ `restrictions` de `gabarit.data`, exporté) : polygone de
  `RESTR_RADIUS_M` = 30 m par restriction applicable proche du trajet, avec les ZFE dans `avoid_polygons` ; limite ORS
  « 150 km à vol d'oiseau avec zones évitées » → au-delà, rien n'est envoyé et la fiche dit « non évitées… À vérifier ».
  Ajout / modification à l'arrêt seulement ; jamais « sûr » ; rien dans le guidage ni la voix.
- Limites de poids (12a bis, `weight-check.js`, copie `data/poids-osm/` des mêmes Action et cases que les ponts, jamais
  précachée, 5 Mo par fichier / 30 Mo en tout) : tronçon suivi (15 m, cap modulo 180°, jamais un croisement) dont la
  limite est < PTAC ; fiche et carte à l'arrêt seulement, jamais dit ni dans le guidage ; « à vérifier ».
- Limitation de vitesse (11a, `speed-limit.js`, copie `data/vitesses-osm/` mêmes Action et cases, jamais précachée,
  5 Mo / 40 Mo, copie réduite au-delà) : `maxspeed:hgv`, sinon `maxspeed` plafonné par la règle PL vérifiée
  (`speed-rules.js`), sinon inconnue (aucun panneau, rien d'inventé ; agglomération jamais déduite). Calculée une fois
  par itinéraire. Alerte visuelle ; « Limite X » dit seulement si `settings.speedVoice` (non par défaut) et étiquette OSM.
- Limite d'une règle générale (v51) : mention « règle » neutre sous le panneau, couleurs du panneau inchangées.
  v57 : règle hors autoroute (ambiguë : 80 des nationales, 60 articulé) dépassée → compteur jamais rouge (bord pointillé
  neutre, `overRule`) ; règle d'autoroute (90, 80 ADR > 12 t) ou étiquette OSM → rouge comme avant. Visuel, jamais dit.
- Directions (11b, `directions.js`, copie `data/directions-osm/` mêmes Action et cases, jamais précachée) : « direction X »
  seulement si UNE bretelle à 60 m du point de manœuvre au cap cohérent ; dit seulement sans autre bretelle à 60 m ;
  sinon consigne inchangée (jamais devinée). `maneuverText(m, { spoken })` : affiché ≠ dit.
- « vers X » (11c, `places.js`, copie `data/lieux-osm/` mêmes Action et cases, jamais précachée) : sans direction 11b,
  premier lieu OSM city/town/village à ≤ 1 km du tracé, 300 m à 15 km après la manœuvre (avant étape/arrivée) ; deux
  lieux à < 300 m → rien. Affiché seulement, jamais dit ; jamais « direction ».
- Voies à prendre (11d, `lanes.js`, copie `data/voies-osm/` mêmes Action et cases, jamais précachée) : ligne qui arrive
  à la manœuvre (60 m, cap ≤ 30° avant, fin à 60 m), une seule ou flèches identiques ; nombre ≠, rond-point, aucune voie
  valide → rien. `none` : ignoré, sauf v63 sur motorway / motorway_link (voie sans flèche, pictogramme neutre, grisée,
  jamais à prendre ; toutes `none` → rien). Rangée `#nav-lanes` sous « Puis » à ≤ 1 km, valides en clair ; jamais dit.
- Écran de navigation v53 : boutons ronds de la colonne 48 px (zone tactile ≥ 40 px, ces boutons seulement), pastille
  de la rue sous le véhicule, ligne de sortie (règle 11b, jamais dite), mémoire de l'itinéraire en IndexedDB (question
  > 12 h seulement à l'arrêt). Détail : skill `gabarit-interface`.
- Historique (phase 6, v56, `trip-history.js`) : trajet gardé à l'arrivée seulement (jamais en simulation), IndexedDB
  `gabarit-history` jamais bloquant, aucune coordonnée, inclus dans l'export (`history`) ; notes d'aires (`areaNotes`)
  saisies à l'arrêt seulement, jamais dites ; relevé PDF par `@media print`.
- Recherches récentes (v64, `recent-places.js`) : clé `gabarit.recentPlaces` hors de `gabarit.data`, jamais bloquante,
  exportée (`recentPlaces`) ; seulement un lieu choisi dans la liste ; aucun appel. Détail : skill `gabarit-interface`.
- Mes signalements (3a, v66, `reports.js`) : « Signaler » = un appui en roulant, sans choix ni saisie (repère sans
  type) ; type, note, confirmation à l'arrêt confirmé seulement, aussi hors guidage (`canEditReports`) ; encart avec
  « La signalisation fait foi. » ; voix (`settings.reportVoice`, non par défaut) une fois, confirmé et à moi seulement.
- Mes lieux (3b, v67, `saved-places.js`, champ `places`) : données personnelles, sur l'appareil, export complet
  seulement, jamais dans un fichier partagé ; « Mes lieux » en tête des suggestions, aucun appel.
- Signalements pour un ami (3c, v68, `reports-share.js`) : fichier = mes confirmés seulement, jour seulement, sans
  lieux ni notes par défaut ; import vérifié (512 Ko, schéma, types), aperçu + confirmation, marqués importés, jamais dits.
  v69 : import à l'arrêt seulement (`canImportShare`, règle 3a), redit à « Importer » (`confirmImport`) : sinon rien fusionné.
  v87 : fichier `.txt` en `text/plain` (Chromium refuse `application/json` au partage), même JSON ; import `.txt`/`.json` jugé sur le contenu.
- Repliables (v84, composant commun `src/ui/collapsible.js`) : Réglages = 18 sections repliées par défaut, état
  `settings.sectionsOpen` (seule source, `creditsOpen` v64 relu), valeur sous le titre (`settings-sections.js`).
  Fiche : un seul menu « Informations du trajet » (`route-info.js`), replié à chaque calcul (`calcId`, compteur), jamais
  ouvert tout seul, rien sauvegardé ; en-tête = pire niveau symbole + mot + récap ; lignes triées interdit / alerte /
  à vérifier / info (champ `sev` des règles) ; donnée de sécurité manquante = « à vérifier ». Cartes, ⛔, fiche rouge,
  question desserte et boutons d'action toujours hors du menu. Détail : skill `gabarit-interface`.
- Pendant le guidage, aucune saisie à l'écran (Code de la route art. R412-6-2 : écran permis s'il aide à la navigation),
  sauf une étape ajoutée à l'arrêt seulement (v55 ci-dessous).
- Étapes (v55, `stops.js`) : 10 au plus, un seul calcul ORS avec tous les points (budget 3, jamais
  `alternative_routes`) ; 150 km = somme des tronçons à vol d'oiseau (`crowPath`, mesure d'ORS) ; « Étape atteinte. »
  phrase fixe ; recalcul, « Autres itinéraires » et mémoire (`choice.stops`, optionnel) gardent les étapes restantes.
  v70 : ligne « Étape k/n : durée · km » du guidage jamais « … » : réduite (80 %) puis coupée entre morceaux
  insécables seulement (`nextStopParts`).
- « Éviter le tunnel » (5b, v48 aussi classe Euro interdite 5g) : à l'arrêt seulement (`avoidTunnelAllowed`, relevés GPS
  hors guidage `plan-park.js`, vitesse inconnue = grisé), une requête dans le budget de 3 avec les diagnostics 2f
  (`computeAvoidRoute`), carré 80 m, 150 km à vol d'oiseau ; jamais dit, rien dans le guidage.
- Audit OSM (v71, Action manuelle « Audit OSM », `osm-audit.js`, `axes-convert.js`) : lecture seule, jamais d'écriture
  dans OSM ; extrait Geofabrik, secours download.openstreetmap.fr (v72) ; fiches « à vérifier sur place » ; copie `data/axes-osm/` (≤ 5 Mo / 30 Mo, jamais précachée). Détail : skill `gabarit-structure`.
  v90 : niveau 3 (primary / secondary à réf. D…) = priorités 1 et 2 seulement (`keepCard`) ; `data/audit-osm/` ≤ 5 Mo /
  30 Mo (`auditSize`, dépassé = rien écrit) ; `data/axes-osm/` jamais élargie aux départementales ; points sensibles ≤ 300 Ko.
  Run 4 (niveaux 1-3) du 26/11/2026 : 23 736 fiches (niveau 3 : 1 805), 12,83 Mo ; points sensibles 2 653, 119 Ko.
- Repli par la géométrie (PR 3a, v73, `axis-match.js`, copie `data/axes-osm/`) : ref des étapes ORS sans nom seulement
  (étape nommée jamais réécrite), 15 m, cap ≤ 30° modulo 180°, séries ≥ 300 m, ambigu = inconnu, copie simplifiée > 3 m
  = désactivé ; règles fondées sur la ref (week-end IdF, AURA), ligne A/N de la fiche et diagnostic, jamais le « Recommandé » ni le
  calcul ; « à vérifier », jamais dit. « Copier la réponse ORS » (diagnostic) à l'arrêt seulement, mémoire seulement.
- Points sensibles (PR 3b, v74, `sensitive-points.js`, copie `data/points-sensibles/` des fiches d'audit, jamais
  précachée) : interdictions (arrêté, ou Bison Futé marqué), hauteurs basses (≤ véhicule, marge 0), tunnels sans
  hauteur ; point sans cap écarté ; aucun pont (alerte 12a seule) ; fiche et carte à l'arrêt, jamais dit ; source citée.
- « Contourner par la rocade Est » (v76, `lyon-bypass.js`, Lyon seulement : lyon-a6 / lyon-a7 > 7,5 t) : bouton à l'arrêt
  (`avoidTunnelAllowed`), 3 points de passage `via` (A46 → N346 → A46, sommets de `data/axes-osm/`, chaussée au cap ≤ 30°
  et chaussée opposée à gauche), une requête ORS, aucun polygone ajouté ; pas de bouton si départ, arrivée ou étape dans
  la Métropole (contour IGN `metropoleLyon` de `data/contours-ign.json`, lu à la demande). Étape `via` : jamais dite, ni
  « Étape k/n », ni historique, ni repère ; gardée au recalcul. Fourvière jamais déclencheur. Détail : skill zfe.
- Contournement automatique (v77, réglage `autoBypass`, oui par défaut ; non = v76) : plan `ok` du Recommandé d'ORS →
  1 requête à part (sans diagnostic 2009), une fois par calcul (`choice.lyonAuto`, mémoire v53) ; trouvé hors section →
  rocade « Recommandé », fiches par lyon-a6 / lyon-a7 retirées, « Allonge … par rapport au trajet direct » ; échec →
  direct en rouge + confirmation avant « Démarrer » (`#start-confirm`), bouton v76 gardé. « Autres itinéraires » : rien
  d'auto, rouge + 2e appui. Jamais dit, rien dans le guidage. Détail : skill zfe.
- Interdictions connues hors Lyon (v78, `route-bans.js`, mêmes copie et réglage) : sections d'interdiction concernées
  par le profil, hors lyon-a6/a7 et hauteurs ; sens « nord → sud » lu par le tracé ; fiche rouge + confirmation ;
  transit / desserte → question « Desserte locale dans la zone … ? » (Non par défaut, à l'arrêt, `choice.localAnswers`,
  trajet seulement). Jamais dit, rien dans le guidage. Détail : skill zfe.
- Contournement par tronçons (v79, `ban-detour.js`, même réglage) : Recommandé par une interdiction v78 active → par
  interdiction 1 tronçon A → B (15 km avant / après sur le tracé, ≤ 150 km à vol d'oiseau, carré 80 m par point de la
  section), puis 1 trajet complet avec les points de passage `via` du détour, sans zone ajoutée ; section encore là,
  demi-tour ou boucle à un point → échec (rouge v78 + raison). « Oui » à la desserte → direct remis sans requête.
  `choice.banAuto` (mémoire v53). Jamais dit, rien dans le guidage. Détail : skill zfe.
- Hauteurs (v80, PR D) : sections Mont-Blanc (4,70 m) et Fréjus (4,30 m) traitées comme v78 / v79 seulement si la
  hauteur du profil est connue et > valeur de l'arrêté (égale ou inconnue : ligne « point sensible » seule). Hauteurs
  basses ponctuelles OSM (type 2) : jamais de contournement (ORS les applique ; faux positif A86 Duplex / N 12).
- Interdictions lisibles (v81) : « Accès PL limité » en plages (2 km, une voix par plage) ; une ligne par section
  (titre · règle · plage km · source), plages OSM à ≤ 5 km absorbées, même zone pour le contournement (A avant) ; trait
  rouge fin sur la carte, ponts regroupés à zoom < 11 ; fiche rouge : raison de l'échec et « X évite … » (jamais promue) ;
  veto du nom d'étape levé par la géométrie seulement (`geoRoadsAll`). Jamais dit. Détail : skill zfe.
  v82 : copie des points = section entière (voies déjà étiquetées gardées, marquées, jamais des fiches d'audit).
- Fiches non proposées (v83, `notOfferedCards`) : fiche qui traverse une interdiction connue active (géométrie seule
  aussi, sans veto du nom d'étape : 3 points sur 1 km) → ligne « [section] interdite : trajet non proposé », non
  sélectionnable, dès qu'une autre fiche l'évite ; toutes → rouge + confirmation ; exceptions desserte « Oui », réglage
  non, ≤ 3,5 t ; « Autres itinéraires » inchangé. Détail : skill zfe.
- DiaLog (réglementation de circulation, DATEX II) : Action manuelle « Étude DiaLog » (`tools/dialog-etude.mjs`, journal
  seulement, rien gardé) ; `comparisonOperator` toujours `lessThanOrEqualTo` (écrit en dur) = valeur maximum autorisée,
  à ignorer. Rien dans l'appli (étude section 8). « Seul l'arrêté fait foi. »
- Copie DiaLog (12c, Action « DiaLog (copie) », `tools/dialog-convert.mjs`, `data/dialog/` jamais précachée, 5 Mo / 30 Mo) :
  noEntry + hauteur ou poids hors negate, géométrie linéaire ; valeur = maximum ; fin passée ignorée. Détail : skill structure.
  v86 (`dialog-limits.js`) : tronçon suivi 15 m, hauteur + 0,1 ≥ valeur, PTAC > valeur ; fiche et repères pointillés à
  l'arrêt, jamais dits ; « à vérifier — seul l'arrêté fait foi » ; doublon OSM = une ligne ; copie absente = rien.
- Trafic (10 A, Action « Trafic » horaire à :30, `tools/trafic-*.mjs` ; v88 `traffic.js`) : `content.xml` des DIR
  (Bison Futé, Licence Ouverte Etalab 2.0) → `trafic.json` (≤ 1 Mo, ≤ 3 000) sur la branche orpheline `trafic-data`
  réécrite à chaque lancement, jamais sur main ; journal sans coordonnée. Appli : bouton « Trafic » à l'arrêt seulement,
  une requête au toucher (raw.githubusercontent.com, aucune position, jamais en cache), événements à 100 m du tracé
  (droite départ → arrivée = « tracé approximatif »), fiche et repères pointillés, fermés en roulant ; « à vérifier,
  la signalisation fait foi », « Ancien » > 3 h ; jamais dit ni dans le guidage, aucun effet sur le calcul. Détail : skill trafic.
- Textes officiels illisibles depuis le conteneur : Action « Textes officiels » (`tools/textes-officiels.json`, journal
  seulement, ne relance pas l'Action OSM) ; chiffre lu par OCR codé seulement s'il est recoupé.
- Satellite hors de France (7d, `SATELLITE_SOURCES`) : source codée seulement si conditions lues ET tuile réelle 200 +
  CORS vérifiées par l'Action (entrée `tiles`) ; sinon message, jamais une couche vide. Détail : skill `gabarit-interface`.
  v58 : + Bade-Wurtemberg, Bavière, Hesse ; Flandre, Wallonie, Sarre, NGI non codées (licence des services non lue en
  entier, relu le 24/11/2026 : documents repérés dans ROADMAP 7d).
- « Autres itinéraires » (v44, `openAlternatives` d'`app.js`, panneau `#nav-alts`) : seulement à l'arrêt (`parkedState`),
  depuis la dernière position reçue vers l'arrivée, profil actif, même calcul que le départ (`fetchRouteOptions`,
  restrictions, tunnels v43) ; fermé dès que le véhicule roule (`onParkChange`) ; échec : message, rien de guidé.
- ORS : `bearings` n'est accepté que pour les profils vélo (pas de cap imposé au recalcul camion).
  Quota gratuit : 2 000 itinéraires/jour (dépassé → HTTP 403), 40/min (→ 429) ; recalcul au plus toutes les 30 s.
- Chrome n'autorise la voix qu'après une action de l'utilisateur : première phrase dans le geste « Démarrer ».
- Repère du véhicule (v45, `src/ui/vehicle-icon.js`) : camion vu de dessus par défaut (dessin maison, jamais un logo ni
  une icône copiée) ou flèche (`settings.vehicleIcon`) ; même taille, même centre, couleurs `--arrow-*`.
- Itinéraires alternatifs (`route-options.js`) : 3 requêtes ORS au plus par calcul. Le Recommandé est toujours la
  première fiche et la référence des écarts (préférence d'ORS, sauf choix A/N ci-dessous → « Préférence ORS »). `alternative_routes` (`target_count` ≤ 3,
  2 points seulement) uniquement si départ–arrivée ≤ 100 km **à vol d'oiseau** (ORS mesure ainsi, sinon erreur 2004) ;
  sinon, ou si ORS ne renvoie qu'un itinéraire : Plus court + Sans péage (Plus rapide si péages évités ou absents).
  Le choix se fait à l'arrêt ; le recalcul en guidage garde `preference`/péages de la variante choisie.
- « Recommandé » (2g, `road-class.js`) : parmi les itinéraires déjà calculés, la plus forte part autoroute + nationale
  (waycategory bit 1 = A ; N = waytype 1 + référence N de l'étape ; inconnu jamais N) à ≤ 15 % de durée du plus rapide
  (`ROUTE_PREF`), égalité → le plus rapide ; > 30 % de km sans nom ni référence → part inconnue, ordre d'ORS gardé.
  Péages hors calcul. Jamais une garantie : « la signalisation fait foi ».
  v43 : jamais un itinéraire par un tunnel interdit confirmé pour le profil (`confirmedTunnelBans` : Euro texte
  officiel ou exploitant, ADR avec matières dangereuses ; « à vérifier », « annoncée », classe vide : non) si une autre
  option calculée l'évite ; toutes → choix gardé + `ALL_TUNNELS_NOTE`. Sans requête de plus ; fiche, jamais la voix.
- Péages PL à l'étranger (5h, v49, `foreign-tolls.js`) : Autriche (GO-Maut 2026) seulement, taux du profil (champ
  « Essieux » `axles`, non précisé = les deux cas) et estimation « à vérifier, pas une facture », ligne grise, jamais dite.
- Contours des taxes PL (`data/taxes-pl.json`, v50) : Admin Express COG 2026 (Action « Contours IGN ») ; tout changement
  de contours doit laisser vert `tests/taxes-contours.test.js` (résultats 5h ter figés), sinon contours non remplacés.
- Carburant (phase 4, `fuel-stations.js`, `src/ui/fuel.js` chargé à la demande, jamais en cache) : data.economie.gouv.fr
  sans clé (CORS *, 50 000/jour), une requête par itinéraire (boîtes du trajet seulement), à l'arrêt seulement, jamais dit ;
  `settings.dieselPrice` (Réglages) reste le prix des fiches. Détail : skill `gabarit-interface`.
- Doc à jour : giscience.github.io, openrouteservice.org et legifrance.gouv.fr peuvent être bloqués depuis le conteneur ;
  lire la doc ORS sur raw.githubusercontent.com (GIScience/openrouteservice : dossier `docs/`, et le code `ors-api/` pour
  les paramètres et limites exacts), MDN sur raw.githubusercontent.com/mdn/content, MapLibre dans le paquet npm
  (`registry.npmjs.org`).
- Voir l'interface dans Chromium (Playwright) : unpkg et les fonds de carte sont bloqués depuis le conteneur ; servir
  MapLibre depuis le paquet npm, un style minimal, et répondre aux appels ORS/Pelias avec les fixtures (`page.route`).

## Interdits
- Jamais de clé API dans le code, les tests, les fixtures, les commits ou les logs (clé saisie dans Réglages, localStorage).
- La clé n'est jamais exportée. Pas de `console.log` dans `src/`.
- Aucun test n'appelle une vraie API : fixtures uniquement.
- Le service worker ne met jamais en cache les réponses d'API, les tuiles ou les styles de carte.
- Pas de service payant ni de clé pour la carte.
