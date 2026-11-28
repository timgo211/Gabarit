---
name: gabarit-trafic
description: Règles du trafic Bison Futé (phase 10 A) : Action « Trafic » et branche trafic-data, fichier national, bouton « Trafic » à l'arrêt, distance au tracé, sens, « Ancien », textes et crédit. À utiliser avant de toucher au trafic.
---

# Trafic (phase 10 A)

Étude : `docs/etude-trafic.md` (option A ; chiffres des runs 1 et 2 du 26/11/2026, § 7).

## Données (PR 1, v87 inchangée)
- Action « Trafic » (`.github/workflows/trafic.yml`) : `content.xml` du flux « tipi » des DIR (Bison Futé, DATEX II v2
  en SOAP, Licence Ouverte Etalab 2.0) → `trafic.json` sur la branche orpheline `trafic-data`, réécrite à chaque
  lancement (`push --force`), jamais sur main (ni Pages, ni « Données OSM », ni Tests relancés : push du GITHUB_TOKEN).
  Toutes les heures à :17 UTC depuis le 28/11/2026 (v88 : :30) ; le flux change vers :24 : un run à :17 lit celui de
  l'heure d'avant. + manuelle. Plan B si GitHub le demande : retirer la
  ligne `schedule` (l'appli affiche « Ancien »).
- Domaines : `tipi.bison-fute.gouv.fr` (Action seulement, contrôlé par le code), `raw.githubusercontent.com` (appli).
- Gardés : fermeture (`roadClosed`, `carriagewayClosures`, `closedPermanentlyForTheWinter`), bouchon (`AbnormalTraffic`),
  accident, chantier (`MaintenanceWorks`, `ConstructionWorks`), obstacle (`…Obstruction`). Voies réduites
  (`laneClosures`…) et autres types : comptés, écartés.
- Ligne = droite du point de départ au point d'arrivée seulement (jamais un itinéraire indexé). Sens brut `dv`
  (`tpegDirection`) ; la droite suit le sens cardinal publié dans 209 cas sur 245 (run 2) : jamais une certitude.
- Fichiers par événement du dossier : jamais lus (dossier = environ 24 h d'historique numéroté, sans lien avec les id).
- Journal sans coordonnée ; flux illisible → avertissement, sortie 0, ancien JSON gardé.

## Appli (PR 2, v88 : `src/lib/traffic.js`, `src/ui/traffic.js`, `TRAFFIC_URL` de `config.js`)
- Bouton `#btn-traffic` (préparation, sous « Carburant ») et puce `#btn-nav-traffic` (rangée de la loupe, guidage) :
  à l'arrêt seulement (`planPark.parked` / `navigation.parked`, `parkedState` : < 5 km/h pendant 3 s ; vitesse inconnue
  = grisé). Touché en roulant : « Trafic : disponible à l'arrêt » (préparation) ou « Disponible à l'arrêt »
  (guidage), rien d'ouvert, aucune requête.
- Une seule requête au toucher (`fetch` `cache: 'no-store'`, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`),
  aucune position envoyée (URL sans paramètre), aucun appel ORS. Copie gardée en mémoire de la page seulement
  (nouveau tri sans requête quand une autre fiche d'itinéraire est choisie : `setRoute`). Service worker : autre
  origine = `bypass` (jamais en cache). Hors ligne : « Pas de connexion : trafic indisponible. » ; autre échec :
  « Trafic indisponible pour l'instant. » ; rien d'autre.
- Lecture vérifiée (`parseTrafficJson`, ne lève jamais) : 1 Mo, 3 000 événements, `format` / `version`, chaque champ
  (types connus, coordonnées dans la boîte, droite = 2 points, textes bornés) ; champ faux → événement écarté.
- Tracé : en préparation, la fiche choisie ; en guidage, `navigation.routeCoordinates` (recalculs compris). Distance :
  index du tracé par cases de 0,01°, mesure à la polyligne (`eventsNearRoute`, travail compté par `work`). Point
  ≤ 100 m ; droite gardée si une extrémité est à ≤ 100 m, ou si ≥ 2 échantillons consécutifs (20 m) sont à ≤ 100 m
  avec un cap ≤ 30° (modulo 180°) du tracé ; un simple croisement n'est jamais gardé ; droite = « tracé
  approximatif ». Terminés (`e` < maintenant) retirés ; à venir : « à partir du ». Tri par distance depuis le départ.
- Sens (`trafficDirection`, jamais caché, toujours « d'après la source ») : deux sens ; un sens confirmé seulement si
  la droite va dans le sens cardinal publié (< 60°), puis ≤ 45° du tracé = « dans votre sens », ≥ 135° = « sens
  opposé » ; sinon « un seul sens, lequel : à vérifier » ; sans sens : « sens non précisé ».
- Fiche `#traffic-panel` (z-index 45 ; en bas en portrait, ≤ 50 vh ; à gauche en paysage, 42 vw) : la carte reste
  visible. Mentions : « Source : Bison Futé (DIR), mis à jour à HH:MM — à vérifier, la signalisation fait foi. »,
  badge « Ancien » (copie de plus de 3 h ou sans date), « Routes nationales et autoroutes non concédées : les
  autoroutes à péage ne sont pas couvertes. ». Liste vide : « Aucun événement trouvé dans la source. Ce n'est pas une
  garantie : la signalisation fait foi. » (jamais « route libre »). Tout en textContent (commentaire de la source
  compris). Ligne touchée = zoom 15 sur le point du tracé (`map.showPlace(lonlat, { zoom, offset })`).
- Repères `.traffic-marker` (`map.showTraffic`, aussi en guidage à l'arrêt) : texte court (« Fermé », « Bouchon »,
  « Accident », « Travaux », « Obstacle »), bord pointillé ambre (à vérifier), jamais rouge ni ⛔ ; retirés à la
  fermeture. Fiche et repères fermés dès que le véhicule roule (`onParkChange`, `planPark.onChange`) et au départ du
  guidage.
- Jamais : voix, bandeau, alerte, effet sur le calcul ou le « Recommandé », contournement (un événement de trafic
  n'est jamais une interdiction).
- Crédit : Réglages › Sources et licences, `#traffic-credit` (Bison Futé, Licence Ouverte Etalab 2.0) et
  `#traffic-copy-date` (« Dernière mise à jour lue : JJ/MM à HH:MM. », rempli à la lecture).
- Vérifié par `tests/traffic.test.js` et `node tools/ui-check.mjs trafic` (option `traffic` d'`open`).
