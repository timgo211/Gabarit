# Phase 10 — Étude du trafic (étude seulement, aucun code)

Étude du 24/11/2026. But : savoir si Gabarit peut **afficher** le trafic (bouchons, incidents, travaux, fermetures) et
**en tenir compte**, avec 0 €, sans clé dans le code, ORS restant le seul moteur.

Règles qui ne changent pas, quelle que soit l'option :
- la signalisation fait foi ; un événement non confirmé est « à vérifier » et n'est **jamais dit à voix haute** ;
- ORS reste le seul moteur de calcul ; le routage commercial est abandonné (décision du 23/11/2026) ;
- aucune clé dans le code, les commits, les fixtures ou les journaux ; aucune coordonnée perso dans un fichier ni un
  journal ;
- aucune saisie en roulant (Code de la route art. R412-6-2) ; affichage et choix à l'arrêt seulement ;
- une seule requête au toucher, à l'arrêt, comme pour le carburant (phase 4).

Lectures faites par l'Action « Textes officiels » (journal seulement, rien d'enregistré), le site publié servant
d'origine (`Origin: https://timgo211.github.io`) pour mesurer CORS :
- run 15 — <https://github.com/timgo211/Gabarit/actions/runs/45377453739> (flux, licences, CORS, 10 entrées `traf10-*`) ;
- run 16 — <https://github.com/timgo211/Gabarit/actions/runs/45395317697> (2e tour, 7 entrées `traf10b-*` : ressources
  CITA, licences Flandre / DGT / Autobahn, HERE, TomTom, CORS de raw.githubusercontent.com).

Les entrées de lecture ont été retirées de `tools/textes-officiels.json` avant la PR (fichier identique à `main`) ; elles
restent dans l'historique de la branche `claude/awesome-euler-cg63fk`.

## 1. ORS peut-il tenir compte du trafic ?

**Non, pas du trafic en temps réel, et Gabarit ne peut pas lui en fournir.**

- Le trafic d'ORS est une option de **construction du graphe** côté serveur : `traffic: false` par défaut,
  « Use traffic data if available » (`docs/run-instance/configuration/engine/profiles/build.md`, `ors-config.yml`).
- Les seules données lues sont des **profils de vitesse historiques HERE** fournis en fichiers par l'exploitant de
  l'instance (`HereTrafficReader.java`, `HereTrafficGraphStorageBuilder.java` : paramètres `streets`, `pattern_15min`,
  `ref_pattern`), appliqués selon l'heure de départ ou d'arrivée (`ORSWeightingFactory.addTrafficSpeedCalculator`).
  Ce sont des moyennes par quart d'heure, pas des bouchons du moment.
- L'API de calcul n'a **aucun paramètre** pour envoyer un trafic ou un incident. Que l'instance publique
  `api.heigit.org` charge ou non ces profils HERE pour `driving-hgv` : **à vérifier**, sans effet sur la conclusion.

Ce que Gabarit peut faire avec ORS : **contourner une zone** par `options.avoid_polygons`, déjà utilisé pour les ZFE
(`zfe.js`), Mes restrictions (`restrictions.js`) et « Éviter le tunnel » (`adr.js`). Limites lues dans le code d'ORS
(GIScience/openrouteservice, branche `main`) :
- `ors-api/…/services/RoutingService.java`, `calculateTotalDistance` : somme des distances **à vol d'oiseau entre
  tous les points** (départ, étapes, arrivée) ; `checkAvoidAreasDistanceLimit` : « With avoid areas, the approximated
  route distance must not be greater than … meters » → 150 km sur l'API publique (`ZFE.AVOID_MAX_DISTANCE_M`) ;
- `ors-api/…/services/ApiService.java`, `validateAreaLimits` : aire et étendue **par polygone** (200 km², 20 km sur
  l'API publique) ; un `MultiPolygon` est accepté (`convertAvoidAreas`).

Réponse à la retouche 3 :
- **Budget de 3 requêtes** : respecté si les fermetures sont connues **avant** le calcul. Leurs petits polygones sont
  ajoutés au même `avoid_polygons` que les ZFE et Mes restrictions, dans chacune des requêtes déjà prévues (aucune
  requête de plus). Une fermeture découverte après coup ne peut être prise en compte que par un nouveau calcul
  (« Recalculer d'ici » à l'arrêt, `requestReroute`), qui a son propre budget.
- **Étapes** : oui. ORS additionne tous les tronçons (`calculateTotalDistance`), comme `crowPath` de `stops.js`.
  Au-delà de 150 km cumulés, aucun polygone n'est envoyé (même règle que `restrictions.js`) et la fiche dit
  « fermeture non évitée… À vérifier ». `alternative_routes` ne prend que 2 points (inchangé).
- Contourner n'est **jamais automatique** : à l'arrêt, sur accord du chauffeur, seulement pour une fermeture
  **confirmée** (voir option B).

Hors de ces cas : **afficher seulement** les événements sur le tracé, sans changer le calcul.

## 2. Sources étudiées

Légende CORS : « oui » = `access-control-allow-origin` égal à `*` ou à l'origine du site, mesuré par l'Action ;
« non » = en-tête absent (la page ne peut pas lire le flux directement).

### Retenues

#### A. France — événements du réseau routier national non concédé (DIR, Bison Futé)

| | |
|---|---|
| Producteur | Directions interdépartementales des routes (État), publié par Bison Futé (« tipi ») ; référencé sur transport.data.gouv.fr (jeu `62558686864eeafd3af07eac`) |
| Licence (lue) | Page officielle <https://www.bison-fute.gouv.fr/donnees-sur-le-rrn.html> : événements et trafic du RRN non concédé « accessibles sans restrictions à des conditions relevant de la licence "opendata.fr" » ; le lien mène à la Licence Ouverte Etalab 2.0. Obligation : citer la source et la date de dernière mise à jour |
| Clé | Aucune |
| CORS | **Non** (HTTPS OK, HTTP/2 200, aucun en-tête CORS) |
| Adresse | `https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/Evenementiel-DIR/grt/RRN/content.xml` (+ un fichier par événement dans le même dossier) |
| Format, taille | DATEX II v2 dans une enveloppe SOAP, 168 Ko compressés (gzip) le 24/11/2026 |
| Fréquence | **Une fois par heure** d'après deux lectures (`last-modified` 10:24:34 puis 12:24:34 UTC, le 24/11/2026) ; les fichiers par événement du dossier ont leur propre heure |
| Couverture | Routes nationales et autoroutes **non concédées** seulement : accidents, obstacles, bouchons, chantiers, fermetures. **Pas** les autoroutes à péage (voir écartées) |
| Donnée de position envoyée | **Rien** : un seul fichier national, le même pour tous ; le filtrage sur le tracé se fait sur la tablette |

Même page, même licence : vitesses et débits toutes les 6 min (`QTV-DIR/qtvDir.xml`, 33 Ko, CORS non) et états
« normal / ralenti / saturé » autour des agglomérations (`TRAFICOLOR-DIR/`, CORS non). Utiles pour colorer un tronçon,
pas pour une alerte : à garder pour plus tard.

#### B. Luxembourg — CITA (Administration des ponts et chaussées)

| | |
|---|---|
| Licence (lue) | data.public.lu, jeu « Cita : Événements trafic en Datex-II v3.6 » : **Creative Commons Zero (CC0)** |
| Clé | Aucune |
| CORS | Métadonnées du portail : **oui** (`access-control-allow-origin` = origine du site). Flux lui-même : **oui** pour l'ancien flux (`access-control-allow-origin: *`, 4,3 Ko, `last-modified` 3 min avant la lecture) ; flux v3.6 : à vérifier (même serveur) |
| Adresse | Flux v3.6 (ressource « Situation record - Data » du jeu) : `https://cita.lu/info_trafic/datex/situationrecord36` ; ancien flux : `https://www.cita.lu/info_trafic/datex/situationrecord` |
| Format | DATEX II v3.6 (EN 16157-3) : travaux, accidents, obstacles, conditions, fermetures ; géométrie `gmlLineString` |
| Fréquence | « near real-time » ; métadonnées mises à jour le 2/02/2026 |
| Couverture | Autoroutes et voies express du Luxembourg (A1, A3, A4, A6, A7, A13, B40) |
| Donnée de position envoyée | **Rien** : un fichier national |

#### C. Belgique (Flandre) — Verkeerscentrum Vlaanderen (Agentschap Wegen en Verkeer)

| | |
|---|---|
| Licence (lue) | Fiche du point d'accès national belge (transportdata.be, `package_show`) : **Creative Commons Attribution** (`cc-by`), `isopen: true`. Fiche du catalogue flamand : « créé pour des besoins internes… aucune garantie » (qualité, continuité). Texte de licence propre au producteur : non trouvé, à vérifier |
| Clé | Aucune |
| CORS | **Oui** (`access-control-allow-origin: *`) |
| Adresse | `https://www.verkeerscentrum.be/uitwisseling/datex2v3` |
| Format, taille | DATEX II v3, 261 Ko |
| Fréquence | 1 min (fiche NAP) ; `publicationTime` 1 s avant la lecture |
| Couverture | Autoroutes flamandes, une partie des routes régionales : incidents, chantiers, bouchons, événements |
| Donnée de position envoyée | **Rien** : un fichier régional |

### À vérifier (pas retenues tant que la licence n'est pas lue)

| Source | Ce qui est sûr | Ce qui manque |
|---|---|---|
| Allemagne — API Autobahn GmbH (`verkehr.autobahn.de/o/autobahn/{A6}/services/closure`, `warning`, `roadworks`) | Sans clé ; **CORS `*`** ; JSON par autoroute (A6 : fermetures 37 Ko, alertes 11 Ko, chantiers 442 Ko) ; champs `extent`, `point`, `isBlocked`, `future`, `delayTimeValue` | **Licence introuvable** (Impressum lu sans mention, `/nutzungsbedingungen` 404, GovData : aucun résultat). Des alertes portent l'identifiant `INRIX--` (fournisseur commercial) : droits de réutilisation à vérifier. 2e tour : pages App, Verkehrsmeldungen, Datenschutz lues, aucune mention de licence. Donnée de position envoyée si retenue : la **liste des autoroutes du trajet** (pas de point) |
| Espagne — DGT, NAP (`nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v37.xml`, v3.6 redirigé vers v3.7) | Sans clé | **CORS non** ; pages de licence lues en 404. 2e tour : fiche CKAN refusée (HTTP 403). Loin de l'usage courant |
| France — DiaLog (`dialog.beta.gouv.fr/api/regulations/datex`, Licence Ouverte 2.0 sur transport.data.gouv.fr) | Arrêtés de circulation numérisés (DATEX II v3) : interdictions, fermetures temporaires de quelques communes | **CORS non** ; réglementation, pas du trafic ; couverture faible. À étudier avec les restrictions (phase 5), pas ici |

### Écartées

| Source | Raison |
|---|---|
| France — autoroutes concédées (sociétés d'autoroutes, « Action b » et « Action c » du point d'accès national) | Accès par **identifiants** après demande (page Bison Futé lue). Licence « action c » lue (PDF v3.3) : information non altérée, « Information fournie par … », date de mise à jour, format DATEX II. Des identifiants seraient un secret : jamais dans le code ; il faudrait un secret d'Action et une copie → hors 0 € simple, à rouvrir si le propriétaire demande un accès |
| Suisse — opentransportdata.swiss (trafic routier) | Conditions lues : données « service » avec **inscription et code d'accès** ; trafic routier « accès limité à 6 mois (260 000 requêtes) », puis justification écrite à l'OFROU. Clé obligatoire + accès temporaire |
| Italie — CCISS, NAP du MIT | Sites illisibles depuis l'Action (erreurs TLS) : rien de lu, rien de retenu |
| HERE (trafic seul) | Voir § 3 |
| TomTom (trafic seul) | Voir § 3 |

## 3. HERE et TomTom (conditions lues pour le trafic seul) — écartés

- **TomTom** : conditions des Maps APIs (<https://developer.tomtom.com/terms-and-conditions>) : sans « Subscription
  Plan » acceptée par TomTom, le seul usage permis est l'« Evaluation Use » = « internal evaluation and testing ». Un
  usage réel en cabine n'est donc pas couvert par l'offre gratuite (page en JavaScript : l'Action n'en lit que 315
  caractères ; phrase relevée par recherche, à relire). Conditions SRTI (trafic lié à la sécurité, PDF de septembre
  2022, lu par l'Action) : contrat passé « on behalf of your employer or other entity » après un formulaire
  d'inscription accepté par TomTom ; l'ODbL figure dans la liste des licences libres définies par le contrat (clause
  qui l'utilise à relire) — OpenFreeMap et OSM sont sous ODbL.
- **HERE** : conditions de la plateforme (janvier 2022, lues par l'Action) : contenu HERE utilisable « only for the
  purposes and in a manner as specified in the relevant Exhibit, Subscription Plan, Documentation » ; contenu HERE et
  non-HERE ensemble seulement s'ils « can be distinguished and correct attribution can be provided » ; interdit
  d'« Expose HERE Materials to any open source software, open content, open database licenses » — OpenFreeMap et
  OSM sont sous ODbL. Politique d'usage (AUP, janvier 2022, lue) : interdit sans autorisation le « storing …
  displaying … combining » du contenu HERE. Relevé par recherche, à relire : la superposition de trafic tiers est
  prévue **sur** une carte HERE (pas l'inverse) ; l'offre Freemium n'est utilisable qu'une fois. Rien n'autorise le
  trafic HERE sur une autre carte (OpenFreeMap) ni à côté d'un autre moteur (ORS).
- Dans les deux cas : clé obligatoire (même saisie dans Réglages, la requête part avec la position vers un service
  commercial), quotas, et conditions qui ne permettent pas clairement le mélange avec ORS et OpenFreeMap → **écartés**
  (règle de la retouche 1 ; routage commercial abandonné le 23/11/2026).

## 4. Serveur relais

**Le flux français (source A) n'a pas d'en-tête CORS** : la page ne peut pas le lire directement. Deux façons :
1. **Copie par une Action GitHub** (comme les données OSM) : pas de serveur à nous. Voir option A ci-dessous.
2. **Serveur relais** (ex. un « worker » gratuit qui relit le flux et ajoute `Access-Control-Allow-Origin`) : plus
   frais, mais c'est un **serveur relais** : compte chez un hébergeur, quota, et un tiers voit l'adresse IP de la
   tablette. **Signalé, non construit.**

Les flux luxembourgeois (B, ancien flux : CORS `*`) et flamand (C, CORS `*`) n'ont besoin d'aucun relais.
`raw.githubusercontent.com` répond avec `access-control-allow-origin: *` (run 16) : une copie publiée par une Action
est lisible par la page.

## 5. Options proposées

### Option A — Événements France (DIR) affichés sur le tracé, sans changer le calcul (recommandée)

- Une Action « Trafic » (planifiée, par ex. toutes les heures à :30, le flux changeant à :24) lit `content.xml`,
  garde les événements utiles (fermeture, bouchon, accident, chantier, obstacle) avec leur position, leur type, leur début / fin, l'heure de la
  source, et publie un petit JSON national **hors de `main`** (branche de données réécrite à chaque fois, pour ne pas
  relancer GitHub Pages ni grossir l'historique), lu via `raw.githubusercontent.com` (CORS `*` mesuré, run 16).
- Dans Gabarit : bouton « Trafic » **à l'arrêt seulement** ; **une requête au toucher** (le fichier national) ;
  événements proches du tracé (distance à fixer, par ex. 100 m) listés sur la fiche et marqués sur la carte, avec « Source : Bison Futé (DIR),
  mis à jour à HH:MM — à vérifier, la signalisation fait foi ». Rien dans le guidage, rien à voix haute.
- Donnée de position envoyée : **rien**.
- Coût : 0 € (Actions gratuites sur un dépôt public).
- Risques : délai (jusqu'à 1 h de la source + retards fréquents des tâches planifiées de GitHub) → un bouchon peut
  être fini ou nouveau ; couverture **sans autoroutes à péage** ; règles d'usage des Actions de GitHub pour une
  tâche horaire **à vérifier** ; format DATEX II v2 à suivre (un changement des adresses d'accès est déjà signalé sur la page Bison Futé).
- À vérifier : règles GitHub ; contenu exact par événement (le fichier d'ensemble est-il complet ?) ; codes DATEX
  utilisés par les DIR (fermeture « roadClosed », sens de circulation).

### Option B — Option A + contourner une fermeture confirmée

- Seulement si l'événement est une **fermeture totale** publiée par l'autorité (DIR), en cours de validité, sur le
  tracé : la fiche propose « Éviter cette fermeture » **à l'arrêt** ; un petit polygone (30 m, comme Mes restrictions)
  rejoint `avoid_polygons` au prochain calcul ou à « Recalculer d'ici ».
- Budget : aucune requête de plus si la fermeture est connue avant le calcul ; étapes : oui ; au-delà de 150 km à vol
  d'oiseau cumulés : rien envoyé, « fermeture non évitée… À vérifier » (voir § 1). Donc utile surtout pour les
  trajets courts ou un « Recalculer d'ici » près de la fermeture.
- Donnée de position envoyée : vers ORS seulement, comme aujourd'hui (le trajet) ; rien de plus.
- Risques : fermeture mal placée ou périmée → détour inutile ; voie fermée dans un seul sens mal lue → mauvais côté
  évité ; jamais une garantie de passage.
- À vérifier : précision des positions DIR (point, ou ligne ?) ; sens ; heure de fin.

### Option C — Pays voisins en direct (sans relais)

- Luxembourg (CITA, CC0) et Flandre (CC-BY, citer « Verkeerscentrum Vlaanderen ») : lecture directe au toucher, à
  l'arrêt, seulement si le trajet passe dans le pays ; une requête par pays traversé ; donnée de position envoyée :
  **aucun point** (fichier national ou régional, le même pour tous ; le serveur voit seulement qu'on demande ce pays).
- Allemagne (Autobahn GmbH) : CORS `*`, sans clé, mais **licence à lire d'abord** ; donnée envoyée : la liste des
  autoroutes du trajet (une requête par autoroute : à regrouper, au plus quelques requêtes au toucher).
- Coût : 0 €. Risques : formats différents par pays ; licence allemande inconnue ; services sans engagement de
  disponibilité.

### Recommandation

Commencer par **A** (affichage seul, aucune donnée de position envoyée, pas de relais). Ajouter **B** seulement après
avoir vérifié la précision et le sens des fermetures DIR sur quelques cas réels. **C** ensuite, pays par pays, après
la lecture de la licence allemande pour l'Allemagne.

### Ce qui n'est pas possible sans service payant ni clé

- Recalcul **automatique** selon le trafic, temps de trajet corrigé par les bouchons : ORS ne le fait pas (§ 1).
- Couverture des autoroutes concédées françaises sans identifiants.

## 6. À vérifier (récapitulatif)

- ~~Codes DATEX des fermetures et du sens (DIR) ; complétude de `content.xml`.~~ Répondu au § 7 (complétude : non
  prouvée, rien n'indique un manque).
- ~~Règles d'usage des Actions GitHub pour une tâche horaire.~~ Répondu au § 7 (aucune interdiction ; zone grise
  signalée, plan B).
- CORS du flux CITA v3.6 (`situationrecord36`) ; l'ancien flux a `*`.
- Licence des données Autobahn GmbH (et des alertes INRIX).
- Flandre : texte de licence du producteur (seule la fiche NAP dit CC-BY). DGT : licence (CORS non).
- `api.heigit.org` : profils de vitesse HERE chargés ou non (sans effet sur les options).
- Autoroutes concédées : conditions de demande d'identifiants (si le propriétaire le souhaite un jour).

## 7. Résultats de l'option A (Action « Trafic », 26/11/2026)

Lancements à la main sur main : run 1 (<https://github.com/timgo211/Gabarit/actions/runs/45859376295>) et run 2 après
la petite correction de la PR #108 (<https://github.com/timgo211/Gabarit/actions/runs/45860120224>). Journal en chiffres,
sans coordonnée.

- Flux : `content.xml` lu, 3,0 Mo décodés (gzip), `last-modified` 16:24:35 GMT, `publicationTime` 17:24:34 +01:00 :
  le flux change bien vers :24 (§ 2) → Action planifiée à :30 UTC.
- Contenu : 340 situations, 543 enregistrements DATEX II v2 (format conforme à l'étude). Types : MaintenanceWorks 160,
  RoadOrCarriagewayOrLaneManagement 118, AbnormalTraffic 54, ReroutingManagement 39, VehicleObstruction 32,
  ConstructionWorks 29, GeneralNetworkManagement 25, SpeedManagement 22, GeneralObstruction 19, autres < 15.
- Positions : `Linear` 394 (droite départ → arrivée : 393), `Point` 149 ; aucun enregistrement sans position.
- Dates : début et fin 336, début seul 207 ; `validityStatus` `definedByValidityTimeSpec` 539, `suspended` 4.
- Gardés (run 2) : 309 (chantier 172, bouchon 53, obstacle 52, fermeture 24, accident 8) ; JSON de 94 Ko.
- CORS : `raw.githubusercontent.com/…/trafic-data/trafic.json` → `HTTP/2 200`, `access-control-allow-origin: *`,
  `cache-control: max-age=300` (une copie peut donc avoir jusqu'à 5 min de retard sur la branche).

Réponses aux « À vérifier » :
- **Codes des fermetures** : les DIR publient `roadClosed` (21) et `closedPermanentlyForTheWinter` (7, route fermée
  pour l'hiver) ; `carriagewayClosures` n'apparaît pas. Les autres codes de gestion de voies (`laneClosures` 59,
  `singleAlternateLineTraffic` 17, `contraflow` 6, `narrowLanes` 4, `weightRestrictionInOperation` 4) ne sont pas
  des fermetures : écartés.
- **Sens** : `tpegDirection` est toujours présent : `bothWays` 148, `southBound` 102, `eastBound` 89, `northBound` 88,
  `westBound` 87, `innerRing` 15, `outerRing` 14. La droite départ → arrivée va dans le sens cardinal publié dans 209
  cas sur 245 (17 à l'inverse, 19 flous) : l'appli ne dit « votre sens » ou « sens opposé » que si les deux
  concordent, et toujours « d'après la source ».
- **Complétude de `content.xml`** : non prouvée, rien n'indique un manque. Le dossier contient environ 3 300 fichiers
  `.xml` numérotés (`3692275.xml`…), datés des dernières 24 h (environ 700 de la dernière heure), sans lien avec les
  identifiants de `content.xml` (`260122-001707-2`…) : c'est un historique des messages, pas la liste des événements
  en cours. Ces fichiers ne sont pas lus.
- **Règles GitHub** (docs.github.com lues le 26/11/2026 dans les sources `github/docs`) : intervalle minimal de 5 min,
  retards possibles en haut d'heure (d'où :30), désactivation après 60 jours sans activité sur un dépôt public (la doc
  ne dit pas si un push du GITHUB_TOKEN compte ; réactivation : Actions › Trafic › Enable workflow). Conditions des
  Actions : pas de « content delivery network » ni de « serverless application », mais « a low benefit Action could be
  ok if it's also low burden » : aucune interdiction d'une tâche horaire ; charge faible (un job d'une minute par heure).
  Plan B : retirer la ligne `schedule` ; l'appli affiche alors « Ancien ».

