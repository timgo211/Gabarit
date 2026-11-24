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
- run __RUN2__ — 2e tour (`traf10b-*` : ressources CITA, licences Flandre / DGT / Autobahn, HERE, TomTom).

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
| Fréquence | Fichier modifié 19 min avant la lecture (`last-modified`) ; « à chaque événement » ou « toutes les heures » : à vérifier |
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
| CORS | Métadonnées du portail : **oui** (`access-control-allow-origin` = origine du site). Flux lui-même : __CITA_CORS__ |
| Adresse | __CITA_URL__ |
| Format | DATEX II v3.6 (EN 16157-3) : travaux, accidents, obstacles, conditions, fermetures ; géométrie `gmlLineString` |
| Fréquence | « near real-time » ; métadonnées mises à jour le 2/02/2026 |
| Couverture | Autoroutes et voies express du Luxembourg (A1, A3, A4, A6, A7, A13, B40) |
| Donnée de position envoyée | **Rien** : un fichier national |

### À vérifier (pas retenues tant que la licence n'est pas lue)

| Source | Ce qui est sûr | Ce qui manque |
|---|---|---|
| Allemagne — API Autobahn GmbH (`verkehr.autobahn.de/o/autobahn/{A6}/services/closure`, `warning`, `roadworks`) | Sans clé ; **CORS `*`** ; JSON par autoroute (A6 : fermetures 37 Ko, alertes 11 Ko, chantiers 442 Ko) ; champs `extent`, `point`, `isBlocked`, `future`, `delayTimeValue` | **Licence introuvable** (Impressum lu sans mention, `/nutzungsbedingungen` 404, GovData : aucun résultat). Des alertes portent l'identifiant `INRIX--` (fournisseur commercial) : droits de réutilisation à vérifier. __DE_RUN2__ Donnée de position envoyée si retenue : la **liste des autoroutes du trajet** (pas de point) |
| Belgique — Verkeerscentrum Vlaanderen (`www.verkeerscentrum.be/uitwisseling/datex2v3`, 237 Ko) | Flux lisible ; autoroutes flamandes et une partie des routes régionales | Licence non trouvée sur les fiches lues ; la fiche dit : « créé pour des besoins internes, aucune garantie qu'il convienne à d'autres usages ». __BE_RUN2__ |
| Espagne — DGT, NAP (`nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v37.xml`, v3.6 redirigé vers v3.7) | Sans clé | **CORS non** ; pages de licence lues en 404. __ES_RUN2__ Loin de l'usage courant |
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
  usage réel en cabine n'est donc pas couvert par l'offre gratuite. __TT_RUN2__
- **HERE** : politique d'usage (AUP, version de janvier 2022) : on peut superposer du trafic d'un tiers **sur** une
  carte HERE, avec attribution ; la combinaison de jeux de données avec le contenu HERE est interdite en dehors de
  cette superposition ; l'offre Freemium n'est utilisable qu'**une fois** ; un « app ID » par application. Rien
  n'autorise l'affichage du trafic HERE sur une autre carte (OpenFreeMap) ni son usage à côté d'un autre moteur (ORS).
  __HERE_RUN2__
- Dans les deux cas : clé obligatoire (même saisie dans Réglages, la requête part avec la position vers un service
  commercial), quotas, et conditions qui ne permettent pas clairement le mélange avec ORS et OpenFreeMap → **écartés**
  (règle de la retouche 1 ; routage commercial abandonné le 23/11/2026).

## 4. Serveur relais

**Le flux français (source A) n'a pas d'en-tête CORS** : la page ne peut pas le lire directement. Deux façons :
1. **Copie par une Action GitHub** (comme les données OSM) : pas de serveur à nous. Voir option A ci-dessous.
2. **Serveur relais** (ex. un « worker » gratuit qui relit le flux et ajoute `Access-Control-Allow-Origin`) : plus
   frais, mais c'est un **serveur relais** : compte chez un hébergeur, quota, et un tiers voit l'adresse IP de la
   tablette. **Signalé, non construit.**

Le flux luxembourgeois (B) n'a besoin d'aucun relais si son CORS est confirmé (__CITA_CORS_SHORT__).

## 5. Options proposées

### Option A — Événements France (DIR) affichés sur le tracé, sans changer le calcul (recommandée)

- Une Action « Trafic » (planifiée, par ex. toutes les 30 min) lit `content.xml`, garde les événements utiles
  (fermeture, bouchon, accident, chantier, obstacle) avec leur position, leur type, leur début / fin, l'heure de la
  source, et publie un petit JSON national **hors de `main`** (branche de données réécrite à chaque fois, pour ne pas
  relancer GitHub Pages ni grossir l'historique), lu via `raw.githubusercontent.com` (CORS à vérifier).
- Dans Gabarit : bouton « Trafic » **à l'arrêt seulement** ; **une requête au toucher** (le fichier national) ;
  événements à moins de 100 m du tracé listés sur la fiche et marqués sur la carte, avec « Source : Bison Futé (DIR),
  mis à jour à HH:MM — à vérifier, la signalisation fait foi ». Rien dans le guidage, rien à voix haute.
- Donnée de position envoyée : **rien**.
- Coût : 0 € (Actions gratuites sur un dépôt public).
- Risques : délai (30 min + retards fréquents des tâches planifiées de GitHub, parfois plus d'une heure) → un bouchon
  peut être fini ou nouveau ; couverture **sans autoroutes à péage** ; règles d'usage des Actions de GitHub pour une
  tâche toutes les 30 min **à vérifier** ; format DATEX II v2 à suivre (changement d'adresse déjà arrivé en 2024).
- À vérifier : fréquence réelle de mise à jour de `content.xml` ; CORS de `raw.githubusercontent.com` ; règles
  GitHub ; codes DATEX utilisés par les DIR (fermeture « roadClosed », sens de circulation).

### Option B — Option A + contourner une fermeture confirmée

- Seulement si l'événement est une **fermeture totale** publiée par l'autorité (DIR), en cours de validité, sur le
  tracé : la fiche propose « Éviter cette fermeture » **à l'arrêt** ; un petit polygone (30 m, comme Mes restrictions)
  rejoint `avoid_polygons` au prochain calcul ou à « Recalculer d'ici ».
- Budget : aucune requête de plus si la fermeture est connue avant le calcul ; étapes : oui ; au-delà de 150 km à vol
  d'oiseau cumulés : rien envoyé, « fermeture non évitée… À vérifier » (voir § 1).
- Donnée de position envoyée : vers ORS seulement, comme aujourd'hui (le trajet) ; rien de plus.
- Risques : fermeture mal placée ou périmée → détour inutile ; voie fermée dans un seul sens mal lue → mauvais côté
  évité ; jamais une garantie de passage.
- À vérifier : précision des positions DIR (point, ou ligne ?) ; sens ; heure de fin.

### Option C — Pays voisins en direct (sans relais)

- Luxembourg (CITA, CC0) : lecture directe au toucher, à l'arrêt, si le CORS du flux est confirmé ; donnée de
  position envoyée : **rien** (fichier national).
- Allemagne (Autobahn GmbH) : CORS `*`, sans clé, mais **licence à lire d'abord** ; donnée envoyée : la liste des
  autoroutes du trajet (une requête par autoroute : à regrouper, au plus quelques requêtes au toucher).
- Coût : 0 €. Risques : formats différents par pays ; licence allemande inconnue ; services sans engagement de
  disponibilité.

### Ce qui n'est pas possible sans service payant ni clé

- Recalcul **automatique** selon le trafic, temps de trajet corrigé par les bouchons : ORS ne le fait pas (§ 1).
- Couverture des autoroutes concédées françaises sans identifiants.

## 6. À vérifier (récapitulatif)

- Fréquence réelle de `content.xml` (DIR) ; codes DATEX des fermetures et du sens.
- CORS de `raw.githubusercontent.com` (option A) et règles d'usage des Actions GitHub pour une tâche fréquente.
- __CITA_TODO__
- Licence des données Autobahn GmbH (et des alertes INRIX).
- Licence et CORS de la Flandre ; licence et CORS de la DGT.
- `api.heigit.org` : profils de vitesse HERE chargés ou non (sans effet sur les options).
- Autoroutes concédées : conditions de demande d'identifiants (si le propriétaire le souhaite un jour).
