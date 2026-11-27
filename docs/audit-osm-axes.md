# Audit OSM des grands axes (lecture seule)

Rapport écrit par l'Action « Audit OSM » (tools/audit-osm.mjs) ; extrait OpenStreetMap du 2026-11-26 (France) ; niveaux audités : 1, 2, 3 (1 autoroutes, 2 nationales, 3 grandes départementales).

Source de l'extrait : Geofabrik (https://download.geofabrik.de/europe/france-latest.osm.pbf) (même donnée OpenStreetMap, licence ODbL).

Règles :
- rien n'est écrit dans OpenStreetMap : chaque fiche est une proposition, **à vérifier sur place** ;
- **la signalisation fait foi** ; seul l'arrêté fait foi pour la règle ; « en vigueur : à vérifier » ;
- une correction faite dans OSM met 2 à 3 semaines à atteindre l'API publique d'ORS (étude, section 1) ;
- données © contributeurs OpenStreetMap, licence ODbL ; fiches complètes dans `data/audit-osm/`.
- niveau 1 (autoroutes) : fiche « pont sans hauteur » seulement si le croisement est dans l'une des 27 zones suivantes : Île-de-France, Métropole du Grand Paris, Métropole d'Aix-Marseille-Provence, Métropole Européenne de Lille, Bordeaux Métropole, Toulouse Métropole, Nantes Métropole, Métropole Nice Côte d'Azur, Montpellier Méditerranée Métropole, Rennes Métropole, Grenoble-Alpes-Métropole, Métropole Rouen Normandie, Métropole Toulon-Provence-Méditerranée, Dijon Métropole, Euro-métropole de Metz, Métropole du Grand Nancy, CU du Grand Reims, Orléans Métropole, Tours Métropole Val de Loire, CU Angers Loire Métropole, Clermont Auvergne Métropole, Saint-Etienne Métropole, Le Havre Seine Métropole, CA du Grand Avignon (COGA), Brest Métropole, Métropole de Lyon, Eurométropole de Strasbourg (Île-de-France et grandes agglomérations ; règle du propriétaire, sans source officielle) ;
- niveau 3 (grandes départementales : primary ou secondary à référence D…) : fiches de priorité 1 et 2 seulement, aucune fiche « pont sans hauteur » ni « tunnel sans hauteur ».

## Chiffres

Fiches : **14943**.

| Priorité | Fiches |
|---|---|
| 1 — interdiction PL | 526 |
| 2 — hauteur basse connue | 2271 |
| 3 — hauteur inconnue | 12146 |

| Niveau | Fiches |
|---|---|
| 1 | 4206 |
| 2 | 8930 |
| 3 | 1807 |

| Type | Fiches |
|---|---|
| hauteur basse connue | 2257 |
| hauteur sur le pont seulement | 35 |
| interdiction PL absente | 526 |
| pont sans hauteur | 11322 |
| tunnel sans hauteur | 803 |

Fichiers : `niveau-1.json` (4206), `niveau-2.json` (8930), `niveau-3.json` (1807).

## Interdictions connues (tableau 4 de l'étude)

| Section | Route | Voies trouvées | Sans l'étiquette | Déjà étiquetées (points de section, pas des fiches) |
|---|---|---|---|---|
| lyon-a6 | A6 | 20 | 20 | 0 |
| lyon-a7 | A7 | 46 | 19 | 27 |
| mont-blanc | N205 | 11 | 9 | 2 |
| frejus | N543 | 9 | 8 | 1 |
| rn524 | N524 | 67 | 67 | 0 |
| n59 | N59/N159 | 273 | 58 | 215 |
| n66 | N66 | 220 | 170 | 50 |
| n7-vienne | N7 | 158 | 158 | 0 |
| le-puy | N88/N102 | 17 | 17 | 0 |

Non localisées (jamais devinées) :

- lyon-a47 (A47) : bretelle vers l'A7 à Ternay, sans référence propre.
- fourviere : voirie de la Métropole depuis 2017 (hors réseau national) ; hauteur 4,30 m ou 4,50 m selon la source.
- bpnl : voirie de la Métropole (hors réseau national) ; 7,5 t (arrêté) ou 19 t (brochure 2026).
- lille-a22 (A1/N356/A22/N227) : commune « Aalbeke » : 0 nœud(s) place dans la zone (il en faut un).
- marseille-a55 (A55/A557) : début et fin donnés par des échangeurs dans Marseille, pas par des communes.
- toulon (A50/A57) : mesure peut-être levée avec le 2e tube.
- laffrey (N85) : communes de début et de fin de la rampe non données par la source.
- n85-gap (N85) : condition d'équipement (sans ralentisseur) sans étiquette OSM.
- n94-montgenevre (N94) : commune « La Vachette » : 0 nœud(s) place dans la zone (il en faut un).
- n7-orange (N7) : aucune voie N7 dans la section.
- n7-tain (N7) : interdiction horaire (22 h-6 h) : hgv:conditional ignoré par ORS, non auditée.
- n7-mondragon (N7) : absente de la brochure 2026 (peut-être levée).
- n82-balbigny (N82) : section donnée par un carrefour (« en venant de la RD56 »).
- avignon (N100/N580) : tonnage contradictoire : 25 t (page zone Sud, dépliants) ou 3,5 t (brochure 2026).

Hors OSM (aucune étiquette lue par ORS) : classes Euro du Mont-Blanc et du Fréjus (phase 5g) ; interdictions horaires (Fréjus, N66 la nuit, N7 à Tain) : `hgv:conditional` ignoré par ORS (étude, section 2), non auditées.

## Trous connus

Non localisés par l'audit, à documenter (ce que l'étude en dit, rien de deviné) :

- **RN 118** : non documentée dans l'étude (aucune source lue sur une interdiction PL permanente) : à documenter.
- **Duplex A86** : interdit à tous les PL selon une page Vinci (source secondaire) ; arrêtés interpréfectoraux 2012-657 du 06/08/2012 et 2016-2-493 du 18/11/2016 connus par extrait, contenu non lu ; gabarit de 2 m confirmé par aucune source lue : à documenter.
- **Tunnel de l'A14 sous La Défense** : plus de 3,5 t interdits dans les dépliants Bison Futé 2014 et 2017, absent en 2020 et 2026 ; camions réautorisés selon la presse ; arrêté DRIEAT IF n° 2021-2-054 du 03/05/2021 connu par extrait seulement : à documenter.
- **Transit dans Paris** : arrêté municipal (plus de 7,5 t, boulevard périphérique non concerné), hors réseau national ; n° et date non lus : à documenter.

## Limites

- hauteur posée sur un nœud (ORS la recopie sur la voie) : non lue par l'audit, une fiche « sans hauteur » peut être de trop ;
- un pont au-dessus d'une voie découpée : la hauteur doit être sur le morceau sous le pont ;
- seuil de 4,30 m : tri des fiches seulement, pas une règle ;
- sections d'interdiction : boîte des deux communes élargie de 2 km, approximative (confiance moyenne au mieux).

## Copie des axes (data/axes-osm/)

- Axes : 396685 voies (279455 avec référence), 166815 lignes après mise bout à bout ; autoroute 28036 km, voie rapide 17152 km, primaire 61383 km.
- Axes, simplification 3 m : 9.35 Mo, plus grosse case 2_48 (576 Ko) ; par classe : autoroute 1.72 Mo, voie rapide 1.36 Mo, primaire 6.23 Mo.

## Journal de l'Action

- Extrait France : source Geofabrik (https://download.geofabrik.de/europe/france-latest.osm.pbf), 4886 Mo téléchargés en 506 s.
- Filtrage et export osmium : 115 Mo en .pbf, 609 Mo de GeoJSON, 114 s.
- Passe 1 (axes, communes) : 1782504 objets lus, 396685 voies pour la copie, 632931 voies auditées (niveaux 1, 2, 3), 38511 communes, 5477077 segments au sol indexés ; 17 s, mémoire max 1176 Mo.
- Passe 2 (ponts) : 283592 ponts lus, 179128 à moins de 50 m d'un axe examinés (garde-fou : les autres écartés sans calcul), 22147 au-dessus d'un axe ; 17 s, mémoire max 1654 Mo.
- Ponts sans hauteur au-dessus des autoroutes (niveau 1) : 3424 gardés (zones des grandes agglomérations), 8289 retirés (hors zone).
- Recoupement : data/ponts-osm/ (copie du 2026-11-24) compte 231205 objets ; l'audit a lu 283592 ponts (passerelles comprises).
- Interdictions : 9 sections localisées, 14 non localisées, 526 fiches, 295 voies déjà étiquetées (points de section, pas des fiches).
-   lyon-a6 : 20 voies, sans étiquette 20, déjà étiquetées 0.
-   lyon-a7 : 46 voies, sans étiquette 19, déjà étiquetées 27.
-   mont-blanc : 11 voies, sans étiquette 9, déjà étiquetées 2.
-   frejus : 9 voies, sans étiquette 8, déjà étiquetées 1.
-   rn524 : 67 voies, sans étiquette 67, déjà étiquetées 0.
-   n59 : 273 voies, sans étiquette 58, déjà étiquetées 215.
-   n66 : 220 voies, sans étiquette 170, déjà étiquetées 50.
-   n7-vienne : 158 voies, sans étiquette 158, déjà étiquetées 0.
-   le-puy : 17 voies, sans étiquette 17, déjà étiquetées 0.
- Axes : 396685 voies (279455 avec référence), 166815 lignes après mise bout à bout ; autoroute 28036 km, voie rapide 17152 km, primaire 61383 km.
- Axes, simplification 3 m : 9.35 Mo, plus grosse case 2_48 (576 Ko) ; par classe : autoroute 1.72 Mo, voie rapide 1.36 Mo, primaire 6.23 Mo.
- Fiches par niveau : niveau 1 : 4206, niveau 2 : 8930, niveau 3 : 1807 (niveau 3 : priorités 1 et 2 seulement, aucune fiche « pont sans hauteur » ni « tunnel sans hauteur »).
- data/audit-osm/ : 14943 fiches, 3 fichiers + index.json, 7.91 Mo.
- data/axes-osm/ : 90 cases + index.json, 9.35 Mo.
- Points sensibles gardés : 2575 (interdiction (arrêté) 153, interdiction (Bison Futé) 653, hauteur basse 987, tunnel sans hauteur 782).
-   section frejus : 9 points (sans étiquette 8, déjà étiquetées 1).
-   section le-puy : 17 points (sans étiquette 17, déjà étiquetées 0).
-   section lyon-a6 : 20 points (sans étiquette 20, déjà étiquetées 0).
-   section lyon-a7 : 46 points (sans étiquette 19, déjà étiquetées 27).
-   section mont-blanc : 11 points (sans étiquette 9, déjà étiquetées 2).
-   section n59 : 270 points (sans étiquette 55, déjà étiquetées 215).
-   section n66 : 219 points (sans étiquette 169, déjà étiquetées 50).
-   section n7-vienne : 147 points (sans étiquette 147, déjà étiquetées 0).
-   section rn524 : 67 points (sans étiquette 67, déjà étiquetées 0).
- Écartés faute de cap (aucune voie des axes de même référence à 5 m, ou voies de caps différents) : 1306 (interdiction (arrêté) 0, interdiction (Bison Futé) 15, hauteur basse 1270, tunnel sans hauteur 21).
- Ponts de l'audit gardés : 2939 ; absents de data/ponts-osm/ (donc non signalés par « ponts à vérifier ») : 0.
- Taille : 77 cases, 116 Ko en tout (plus grosse 2_48 : 23 Ko).
- data/points-sensibles/ : 77 cases + index.json.
- Durée totale : 12 min.

## Priorité 1 — interdiction PL (50 premières fiches)

| Voie | Niveau | Route | Type | Proposé | ORS lit | Confiance |
|---|---|---|---|---|---|---|
| [16424486](https://www.openstreetmap.org/way/16424486) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [16424489](https://www.openstreetmap.org/way/16424489) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [16624941](https://www.openstreetmap.org/way/16624941) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [16624945](https://www.openstreetmap.org/way/16624945) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [16624947](https://www.openstreetmap.org/way/16624947) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [16633866](https://www.openstreetmap.org/way/16633866) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [16633887](https://www.openstreetmap.org/way/16633887) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [16768929](https://www.openstreetmap.org/way/16768929) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [16768931](https://www.openstreetmap.org/way/16768931) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [16768932](https://www.openstreetmap.org/way/16768932) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [16768934](https://www.openstreetmap.org/way/16768934) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [125170503](https://www.openstreetmap.org/way/125170503) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [141458295](https://www.openstreetmap.org/way/141458295) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [141458296](https://www.openstreetmap.org/way/141458296) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [224636652](https://www.openstreetmap.org/way/224636652) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [232073862](https://www.openstreetmap.org/way/232073862) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [253447829](https://www.openstreetmap.org/way/253447829) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [255183665](https://www.openstreetmap.org/way/255183665) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [409155795](https://www.openstreetmap.org/way/409155795) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [478222593](https://www.openstreetmap.org/way/478222593) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [566139747](https://www.openstreetmap.org/way/566139747) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [566139748](https://www.openstreetmap.org/way/566139748) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [566818942](https://www.openstreetmap.org/way/566818942) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [657897799](https://www.openstreetmap.org/way/657897799) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [657898423](https://www.openstreetmap.org/way/657898423) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [666432149](https://www.openstreetmap.org/way/666432149) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [708131920](https://www.openstreetmap.org/way/708131920) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [708131921](https://www.openstreetmap.org/way/708131921) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [713918644](https://www.openstreetmap.org/way/713918644) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [830660325](https://www.openstreetmap.org/way/830660325) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [987109827](https://www.openstreetmap.org/way/987109827) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [1024017571](https://www.openstreetmap.org/way/1024017571) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [1150224540](https://www.openstreetmap.org/way/1150224540) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [1197052214](https://www.openstreetmap.org/way/1197052214) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [1275029926](https://www.openstreetmap.org/way/1275029926) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [1427210189](https://www.openstreetmap.org/way/1427210189) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [1431996216](https://www.openstreetmap.org/way/1431996216) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [1486868158](https://www.openstreetmap.org/way/1486868158) | 1 | A7 | interdiction PL absente (lyon-a7) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [1499812082](https://www.openstreetmap.org/way/1499812082) | 1 | A6 | interdiction PL absente (lyon-a6) | `hgv:conditional=no @ (weight>7.5)` | non (hgv:conditional ignoré par ORS) | moyenne |
| [4275803](https://www.openstreetmap.org/way/4275803) | 2 | N7 | interdiction PL absente (n7-vienne) | `hgv=no` `sens=nord → sud seulement : suffixe :forward ou :backward selon le sens du chemin` | à vérifier (un seul sens) | faible |
| [4275826](https://www.openstreetmap.org/way/4275826) | 2 | N7 | interdiction PL absente (n7-vienne) | `hgv=no` `sens=nord → sud seulement : suffixe :forward ou :backward selon le sens du chemin` | à vérifier (un seul sens) | faible |
| [4275834](https://www.openstreetmap.org/way/4275834) | 2 | N7 | interdiction PL absente (n7-vienne) | `hgv=no` `sens=nord → sud seulement : suffixe :forward ou :backward selon le sens du chemin` | à vérifier (un seul sens) | faible |
| [4275836](https://www.openstreetmap.org/way/4275836) | 2 | N7 | interdiction PL absente (n7-vienne) | `hgv=no` `sens=nord → sud seulement : suffixe :forward ou :backward selon le sens du chemin` | à vérifier (un seul sens) | faible |
| [4768570](https://www.openstreetmap.org/way/4768570) | 2 | N159 | interdiction PL absente (n59) | `hgv=destination` | non (hgv=destination ne bloque rien dans ORS) | faible |
| [4768571](https://www.openstreetmap.org/way/4768571) | 2 | N59 | interdiction PL absente (n59) | `hgv=destination` | non (hgv=destination ne bloque rien dans ORS) | faible |
| [4818721](https://www.openstreetmap.org/way/4818721) | 2 | N66 | interdiction PL absente (n66) | `hgv=destination` | non (hgv=destination ne bloque rien dans ORS) | faible |
| [5536281](https://www.openstreetmap.org/way/5536281) | 2 | N7 | interdiction PL absente (n7-vienne) | `hgv=no` `sens=nord → sud seulement : suffixe :forward ou :backward selon le sens du chemin` | à vérifier (un seul sens) | faible |
| [5536283](https://www.openstreetmap.org/way/5536283) | 2 | N7 | interdiction PL absente (n7-vienne) | `hgv=no` `sens=nord → sud seulement : suffixe :forward ou :backward selon le sens du chemin` | à vérifier (un seul sens) | faible |
| [5536285](https://www.openstreetmap.org/way/5536285) | 2 | N7 | interdiction PL absente (n7-vienne) | `hgv=no` `sens=nord → sud seulement : suffixe :forward ou :backward selon le sens du chemin` | à vérifier (un seul sens) | faible |
| [8069514](https://www.openstreetmap.org/way/8069514) | 2 | N7 | interdiction PL absente (n7-vienne) | `hgv=no` `sens=nord → sud seulement : suffixe :forward ou :backward selon le sens du chemin` | à vérifier (un seul sens) | faible |

## Priorité 2 — hauteur basse connue (50 premières fiches)

| Voie | Niveau | Route | Type | Proposé | ORS lit | Confiance |
|---|---|---|---|---|---|---|
| [4299613](https://www.openstreetmap.org/way/4299613) | 1 | A620 | hauteur basse connue | — | oui | moyenne |
| [4918425](https://www.openstreetmap.org/way/4918425) | 1 | A83 | hauteur basse connue | — | oui | moyenne |
| [11958817](https://www.openstreetmap.org/way/11958817) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [14306584](https://www.openstreetmap.org/way/14306584) | 1 | A86 | hauteur basse connue | — | oui | moyenne |
| [17926651](https://www.openstreetmap.org/way/17926651) | 1 | A14 | hauteur basse connue | — | oui | moyenne |
| [17927532](https://www.openstreetmap.org/way/17927532) | 1 | A14 | hauteur basse connue | — | oui | moyenne |
| [17927625](https://www.openstreetmap.org/way/17927625) | 1 | A14 | hauteur basse connue | — | oui | moyenne |
| [17927648](https://www.openstreetmap.org/way/17927648) | 1 | A14 | hauteur basse connue | — | oui | moyenne |
| [19785332](https://www.openstreetmap.org/way/19785332) | 1 | A86 | hauteur basse connue | — | oui | moyenne |
| [25642360](https://www.openstreetmap.org/way/25642360) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [25642369](https://www.openstreetmap.org/way/25642369) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [25791163](https://www.openstreetmap.org/way/25791163) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [26316040](https://www.openstreetmap.org/way/26316040) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [29320574](https://www.openstreetmap.org/way/29320574) | 1 | A40 | hauteur basse connue | — | oui | moyenne |
| [30027635](https://www.openstreetmap.org/way/30027635) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [30193405](https://www.openstreetmap.org/way/30193405) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [30959761](https://www.openstreetmap.org/way/30959761) | 1 | A86 | hauteur basse connue | — | oui | moyenne |
| [30959762](https://www.openstreetmap.org/way/30959762) | 1 | A86 | hauteur basse connue | — | oui | moyenne |
| [35513767](https://www.openstreetmap.org/way/35513767) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [35517549](https://www.openstreetmap.org/way/35517549) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [37013211](https://www.openstreetmap.org/way/37013211) | 1 | A86 | hauteur basse connue | — | oui | moyenne |
| [37014190](https://www.openstreetmap.org/way/37014190) | 1 | A86 | hauteur basse connue | — | oui | moyenne |
| [37014205](https://www.openstreetmap.org/way/37014205) | 1 | A86 | hauteur basse connue | — | oui | moyenne |
| [37014957](https://www.openstreetmap.org/way/37014957) | 1 | A86 | hauteur basse connue | — | oui | moyenne |
| [37015238](https://www.openstreetmap.org/way/37015238) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [37015354](https://www.openstreetmap.org/way/37015354) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [40189123](https://www.openstreetmap.org/way/40189123) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [47353348](https://www.openstreetmap.org/way/47353348) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [60224111](https://www.openstreetmap.org/way/60224111) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [61689509](https://www.openstreetmap.org/way/61689509) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [74628378](https://www.openstreetmap.org/way/74628378) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [76111491](https://www.openstreetmap.org/way/76111491) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [93892025](https://www.openstreetmap.org/way/93892025) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [94480913](https://www.openstreetmap.org/way/94480913) | 1 | A86 | hauteur basse connue | — | oui | moyenne |
| [94480915](https://www.openstreetmap.org/way/94480915) | 1 | A86 | hauteur basse connue | — | oui | moyenne |
| [100721962](https://www.openstreetmap.org/way/100721962) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [104030623](https://www.openstreetmap.org/way/104030623) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [104030625](https://www.openstreetmap.org/way/104030625) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [104030628](https://www.openstreetmap.org/way/104030628) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [104030633](https://www.openstreetmap.org/way/104030633) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [106359256](https://www.openstreetmap.org/way/106359256) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [107855256](https://www.openstreetmap.org/way/107855256) | 1 | A86 | hauteur basse connue | — | oui | moyenne |
| [109994360](https://www.openstreetmap.org/way/109994360) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [111615191](https://www.openstreetmap.org/way/111615191) | 1 | A40 | hauteur basse connue | — | oui | moyenne |
| [118457895](https://www.openstreetmap.org/way/118457895) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [118458804](https://www.openstreetmap.org/way/118458804) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [127194983](https://www.openstreetmap.org/way/127194983) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [127194986](https://www.openstreetmap.org/way/127194986) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [127212877](https://www.openstreetmap.org/way/127212877) | 1 | — | hauteur basse connue | — | oui | moyenne |
| [127453300](https://www.openstreetmap.org/way/127453300) | 1 | A86 | hauteur basse connue | — | oui | moyenne |

## Priorité 3 — hauteur inconnue (50 premières fiches)

| Voie | Niveau | Route | Type | Proposé | ORS lit | Confiance |
|---|---|---|---|---|---|---|
| [2904197](https://www.openstreetmap.org/way/2904197) | 1 | — | tunnel sans hauteur | `maxheight=hauteur du panneau B12 (à relever)` | oui | haute |
| [2954767](https://www.openstreetmap.org/way/2954767) | 1 | A43 | tunnel sans hauteur | `maxheight=hauteur du panneau B12 (à relever)` | oui | haute |
| [2954773](https://www.openstreetmap.org/way/2954773) | 1 | A43 | tunnel sans hauteur | `maxheight=hauteur du panneau B12 (à relever)` | oui | haute |
| [2954774](https://www.openstreetmap.org/way/2954774) | 1 | A43 | tunnel sans hauteur | `maxheight=hauteur du panneau B12 (à relever)` | oui | haute |
| [4014614](https://www.openstreetmap.org/way/4014614) | 1 | — | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4014614](https://www.openstreetmap.org/way/4014614) | 1 | — | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4017458](https://www.openstreetmap.org/way/4017458) | 1 | A14 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4017458](https://www.openstreetmap.org/way/4017458) | 1 | A14 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4017458](https://www.openstreetmap.org/way/4017458) | 1 | A14 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4017458](https://www.openstreetmap.org/way/4017458) | 1 | A14 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4017458](https://www.openstreetmap.org/way/4017458) | 1 | A14 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4017458](https://www.openstreetmap.org/way/4017458) | 1 | A14 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4017458](https://www.openstreetmap.org/way/4017458) | 1 | A14 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4017468](https://www.openstreetmap.org/way/4017468) | 1 | A13 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4017854](https://www.openstreetmap.org/way/4017854) | 1 | A41 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4017854](https://www.openstreetmap.org/way/4017854) | 1 | A41 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4017854](https://www.openstreetmap.org/way/4017854) | 1 | A41 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4042809](https://www.openstreetmap.org/way/4042809) | 1 | — | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4042809](https://www.openstreetmap.org/way/4042809) | 1 | — | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4042813](https://www.openstreetmap.org/way/4042813) | 1 | A13 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4065406](https://www.openstreetmap.org/way/4065406) | 1 | A31 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4073202](https://www.openstreetmap.org/way/4073202) | 1 | A47 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4073202](https://www.openstreetmap.org/way/4073202) | 1 | A47 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4073202](https://www.openstreetmap.org/way/4073202) | 1 | A47 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4073202](https://www.openstreetmap.org/way/4073202) | 1 | A47 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4141628](https://www.openstreetmap.org/way/4141628) | 1 | A26 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4141628](https://www.openstreetmap.org/way/4141628) | 1 | A26 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4212607](https://www.openstreetmap.org/way/4212607) | 1 | A8 | tunnel sans hauteur | `maxheight=hauteur du panneau B12 (à relever)` | oui | haute |
| [4225379](https://www.openstreetmap.org/way/4225379) | 1 | A4 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4225383](https://www.openstreetmap.org/way/4225383) | 1 | A4 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4236064](https://www.openstreetmap.org/way/4236064) | 1 | — | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4239441](https://www.openstreetmap.org/way/4239441) | 1 | — | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4239441](https://www.openstreetmap.org/way/4239441) | 1 | — | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4239441](https://www.openstreetmap.org/way/4239441) | 1 | — | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4247774](https://www.openstreetmap.org/way/4247774) | 1 | A41 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4247774](https://www.openstreetmap.org/way/4247774) | 1 | A41 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4247774](https://www.openstreetmap.org/way/4247774) | 1 | A41 | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4275063](https://www.openstreetmap.org/way/4275063) | 1 | — | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4276316](https://www.openstreetmap.org/way/4276316) | 1 | A41 | tunnel sans hauteur | `maxheight=hauteur du panneau B12 (à relever)` | oui | haute |
| [4276762](https://www.openstreetmap.org/way/4276762) | 1 | — | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4276762](https://www.openstreetmap.org/way/4276762) | 1 | — | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4276762](https://www.openstreetmap.org/way/4276762) | 1 | — | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4276771](https://www.openstreetmap.org/way/4276771) | 1 | A8 | tunnel sans hauteur | `maxheight=hauteur du panneau B12 (à relever)` | oui | haute |
| [4276772](https://www.openstreetmap.org/way/4276772) | 1 | A8 | tunnel sans hauteur | `maxheight=hauteur du panneau B12 (à relever)` | oui | haute |
| [4276782](https://www.openstreetmap.org/way/4276782) | 1 | A8 | tunnel sans hauteur | `maxheight=hauteur du panneau B12 (à relever)` | oui | haute |
| [4276784](https://www.openstreetmap.org/way/4276784) | 1 | A8 | tunnel sans hauteur | `maxheight=hauteur du panneau B12 (à relever)` | oui | haute |
| [4276790](https://www.openstreetmap.org/way/4276790) | 1 | A8 | tunnel sans hauteur | `maxheight=hauteur du panneau B12 (à relever)` | oui | haute |
| [4276792](https://www.openstreetmap.org/way/4276792) | 1 | A8 | tunnel sans hauteur | `maxheight=hauteur du panneau B12 (à relever)` | oui | haute |
| [4276845](https://www.openstreetmap.org/way/4276845) | 1 | — | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |
| [4276845](https://www.openstreetmap.org/way/4276845) | 1 | — | pont sans hauteur | `maxheight=hauteur du panneau B12 ou mesurée (à relever)` | oui | haute |

Toutes les fiches : à vérifier sur place. La signalisation fait foi.
