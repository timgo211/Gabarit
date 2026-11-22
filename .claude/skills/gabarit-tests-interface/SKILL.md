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
                                   #   | euro | tolls | failed | palette
```
Largeur 360 / 412 / 800 / 1280 px sans défilement horizontal, textes du guidage dans leurs cases, satellite après
changement de thème, perte du contexte WebGL, camion arrêté hors du tracé, boutons et réglages 7c, appui long et
coordonnées (phase 8), vue d'ensemble avec des positions envoyées comme le vrai GPS (plan et satellite), saisie après
un appui long, aires (liste, repères, fiche, avis, copie `data/aires-osm/` sans Overpass, hors zone : serveur Overpass de secours et cache, copie absente, encart en guidage avec le GPS
émulé), réglementation (fiches, « Éviter la ZFE », bandeau du guidage, heure de la tablette décalée un samedi
21 h 57), ADR (`adr` : fiche, notes, « Éviter le tunnel », bandeau, fichier absent, code vide, profil, vrai service worker
« Gabarit v33 », Réglages ADR repris d'un ancien profil, profil sans champs ADR), temps de conduite et vent (`drive` : 4 h 25 déjà comptées, Open-Meteo simulé, bouton « travail » à l'arrêt,
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
