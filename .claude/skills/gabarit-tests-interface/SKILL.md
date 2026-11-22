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
                                   #   | euro | tolls | failed | palette | guidage
```
Largeur 360 / 412 / 800 / 1280 px sans défilement horizontal, textes du guidage dans leurs cases, satellite après
changement de thème, perte du contexte WebGL, camion arrêté hors du tracé, boutons et réglages 7c, appui long et
coordonnées (phase 8), vue d'ensemble avec des positions envoyées comme le vrai GPS (plan et satellite), saisie après
un appui long, aires (liste, repères, fiche, avis, copie `data/aires-osm/` sans Overpass, hors zone : serveur Overpass de secours et cache, copie absente, encart en guidage avec le GPS
émulé), réglementation (fiches, « Éviter la ZFE », bandeau du guidage, heure de la tablette décalée un samedi
21 h 57), ADR (`adr` : fiche, notes, « Éviter le tunnel », bandeau, fichier absent, code vide, profil, vrai service worker
« Gabarit v36 », Réglages ADR repris d'un ancien profil, profil sans champs ADR), temps de conduite et vent (`drive` : 4 h 25 déjà comptées, Open-Meteo simulé, bouton « travail » à l'arrêt,
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

