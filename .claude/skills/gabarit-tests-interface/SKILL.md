---
name: gabarit-tests-interface
description: Vérification de l'interface Gabarit dans Chromium (tools/ui-check.mjs, scénarios et ce que chacun contrôle). À utiliser après toute modification d'interface ou de guidage.
---

# Tester l'interface (détails)

(Texte déplacé tel quel depuis CLAUDE.md.)

```
node --test
```
(lancé aussi par `.github/workflows/tests.yml` à chaque push). Doit rester 100 % vert.

Interface dans Chromium (Playwright, hors CI, à relancer après toute modif d'interface) :
```
npm install --no-save --no-package-lock maplibre-gl@4.7.1   # une fois (node_modules/ ignoré par git)
node tools/ui-check.mjs            # ou un scénario : layout | long | satellite | context | parked | comfort | destinations
                                   #   | overview | press | areas | foot | rules | drive | adr | draw | border | access | winter
                                   #   | euro | tolls | failed | palette | guidage | bandeau | ponts | restrictions | poids
```
Largeur 360 / 412 / 800 / 1280 px sans défilement horizontal, textes du guidage dans leurs cases, satellite après
changement de thème, perte du contexte WebGL, camion arrêté hors du tracé, boutons et réglages 7c, appui long et
coordonnées (phase 8), vue d'ensemble avec des positions envoyées comme le vrai GPS (plan et satellite), saisie après
un appui long, aires (liste, repères, fiche, avis, copie `data/aires-osm/` sans Overpass, hors zone : serveur Overpass de secours et cache, copie absente, encart en guidage avec le GPS
émulé), réglementation (fiches, « Éviter la ZFE », bandeau du guidage, heure de la tablette décalée un samedi
21 h 57), ADR (`adr` : fiche, notes, « Éviter le tunnel », bandeau, fichier absent, code vide, profil, vrai service worker
« Gabarit v37 », Réglages ADR repris d'un ancien profil, profil sans champs ADR), temps de conduite et vent (`drive` : 4 h 25 déjà comptées, Open-Meteo simulé, bouton « travail » à l'arrêt,
bandeau jamais sous la barre du bas, 360 / 412 px, tablette, paysage ; Réglages, copie, échec), tracés (`draw` :
tuiles lentes comme le vrai fond, source `route` et couche `route-line` après calcul, autre fiche, Plan / Satellite,
rechargement), frontières (`border` : fiches Suisse / Italie un mercredi 21 h 50, nuit suisse en vigueur, sources,
« à vérifier », 360 / 412 / 800 / 1280 px, guidage avec le GPS émulé : bandeau et une annonce vers 3 km captée,
countryinfo absent, fichier pays absent), accès (`access` : desserte traversée vers km 16, desserte près du départ et
de l'arrivée acceptée, voie interdite / autorisée selon l'heure un mercredi 8 h, condition non lue sur une ligne,
« Éviter la desserte locale » = une requête ORS, 360 / 412 / 800 / 1280 px, guidage avec le GPS émulé à 360 et
1280 px : bandeau et une annonce vers 3 km captée, copie absente), équipements d'hiver (`winter` : mercredi de
novembre, alerte, date de la liste, B26, profil « Remorque » rechargé, crédits, juillet, copie absente, fiches Suisse /
Italie en juillet, guidage avec le GPS émulé à 360 et 1280 px : rien d'hiver dit ni affiché), normes Euro (`euro` :
Mont-Blanc Euro 3 / Euro 6 / non précisé, profil rechargé, Fréjus Euro 4 « exploitant », fiches Suisse et Allemagne
« Normes Euro », 360 / 412 / 800 / 1280 px, guidage avec le GPS émulé dans le tunnel à 360 et 1280 px : rien d'Euro
dit ni affiché). Captures dans `tools/ui-shots/` (ignoré). Un comportement du guidage se vérifie avec le GPS émulé
(`setGeo`, une position par seconde, vitesse fournie), pas seulement en simulation.
Phase 2c (`guidage`) : téléphone 412×900, 900×412 et 760×360, tablette 800×1280 et 1280×800 ; jour, nuit (mode auto :
la nuit tombe au premier point GPS, un 21 décembre à 17 h 40) et satellite de nuit ; GPS émulé avec 4 h 25 de conduite
et rafales. Rien ne se chevauche (`footOverlaps` : bandeau et alertes, boutons ronds, pastille de rue, loupe, encart
des aires, compteur, message, panneau du bas), boutons ronds ≥ 56 px, 2 alertes au plus, « Autres itinéraires » grisé
en roulant et actif après 3 s à l'arrêt, boussole, Recentrer après un glissé, loupe sans saisie, détails et « +N »,
✕ avec confirmation ; tracé épais, partie parcourue, bulles des rues, marqueur remis après le changement de style,
voile sombre pendant la bascule, photos assombries (0,6), « la signalisation fait foi » visible.
Aides du guidage : `navAreas` / `navLayer` (rangée de la loupe), `stopGuidance` (✕ puis « Quitter »), `showDriving` /
`closeDetails` (temps de conduite dans les détails quand les deux places d'alerte sont prises). Le style de test
`streets: true` ajoute une couche de noms de rues (tuiles refusées) pour vérifier les bulles.
Phase 2d (`guidage`) : liste des aires ouverte en roulant et à l'arrêt aux 5 tailles (`checkAreaList` : lignes et
« Fermer » ≥ 56 px, aucun texte coupé, aucune saisie, jamais au-dessus de la pile du bandeau, ≤ 40 % en portrait,
défilement possible, rien ne se chevauche), fiche courte et repère `.selected`, caméra immobile en roulant, « Y aller »
et « Fiche complète » grisés à 50 km/h puis actifs après 3 s d'arrêt, aucun recalcul, « Fermer », fermeture seule
après 20 s (412×900 jour). Puis `nightLevelsCheck` (`guidage niveaux` pour lui seul) : Réglages › Affichage, Sombre →
Normal → Clair à 412×900 et 1280×800, fond jamais clair pendant le changement, voile sombre, fond mesuré de chaque
niveau, réglage mémorisé, sans rechargement ; guidage à chaque niveau (captures `2d-nuit-*`), photos 0,6 / 0,8 / 0,9.
La nuit attendue ailleurs est le niveau Normal (`MAP_PALETTE.night`, photos 0,8).

Phase 2e (`bandeau`) : 412×900, 900×412, 760×360, 1280×800, consigne « Rue de Tortelet, D 120 E » et consigne longue
« … D 120 E en direction de … », 2 alertes actives (4 h 25 de conduite, rafales), puis police agrandie (130 % ; 160 % à
760×360 : consigne réduite à 70 %, pile du haut qui défile). Contrôle (`bannerClip`) : consigne entière dans le bandeau
et dans la pile du haut, taille ≥ 70 % de l'origine, badge « D 120 E » sur une ligne, aucune référence avec espace
sécable ; échelle visible hors guidage, cachée en guidage, revenue après ; attribution toujours visible (le style de
test `streets: true` porte une attribution) ; « Autres itinéraires » grisé opaque.

- `ponts` (phase 12a) : itinéraire synthétique sous le viaduc de Colombier (`ors-directions-colombier.json`), copie
  `data/ponts-osm/` construite par les fonctions de l'Action (`bridgesCopy: 'fixture'`). 412×900 et 900×412 de jour,
  412×900 et 360×760 de nuit : ligne « Passage sous un pont… » priorité haute, pont bas à 3,5 m, pont au-dessus d'un
  passage maxheight ignoré, résumé et part A/N sur la fiche, 2 repères `.bridge-marker`, ligne technique du diagnostic,
  repère touché → message. Guidage (412×900) : aucun repère, rien sur les ponts à l'écran ni à voix haute. Réglage
  `bridgeWarnings: false` (option `settings` d'`open`) → rien ; copie absente → « données non chargées ».
- `poids` (phase 12a bis) : itinéraire synthétique de Colombier, copie `data/poids-osm/` construite par les fonctions
  de l'Action (`weightsCopy: 'fixture'` ; par défaut 404, même si la vraie copie est dans le dépôt). 412×900 jour,
  900×412 et 360×760 nuit : 3 lignes « Limite de poids… à vérifier » (dont « desserte locale possible »), route qui
  croise et limite au-dessus du PTAC ignorées, résumé, 3 repères `.weight-marker` « 3,5 t », ligne technique
  « Limites de poids : 3 », repère touché → panneau, « Éviter ce passage » → restriction poids `osm-weight` au point
  du tracé ; Réglages : case cochée ; guidage : aucun repère, rien à l'écran ni à voix haute ; réglage désactivé ;
  copie absente → « données non chargées ».
- Environnement (constaté le 23/11/2026) : Chromium sans écran refuse la wake lock → « Écran non maintenu allumé »
  dans le panneau du bas, plus haut que sur la tablette ; à 412×900 (`guidage`) le message bref passe alors sur les
  alertes (✘ « nav-toast », vert avec une wake lock simulée). 760×360 à l'arrêt (alerte de conduite avec « Pas une
  pause (travail) » sous le panneau du bas) : ✘ aussi en v37 et v38, même avec la wake lock simulée, non traité.
- `restrictions` (phase 12b) : départ et arrivée saisis en coordonnées autour du viaduc synthétique ; « Éviter ce
  passage » → restriction d'origine pont OSM, recalcul avec `avoid_polygons` centré sur le croisement, « Évite 1
  restriction saisie par toi », liste et aide dans Réglages (412×900 jour, 900×412 nuit) ; guidage : panneau fermé,
  ajout refusé en roulant, rien à l'écran ni à voix haute ; 2009 avec une restriction (option `restrictions` d'`open`)
  → « Une restriction saisie bloque peut-être le seul passage. »
