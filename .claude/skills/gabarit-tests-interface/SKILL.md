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
                                   #   | euro | tolls | failed | palette | guidage | bandeau | ponts | restrictions | poids | dialog | recommande | autres | camion
                                   #   | carburant | etapes | historique | limites | preparation | suggestions
                                   #   | signalements | lieux | ami
```
Largeur 360 / 412 / 800 / 1280 px sans défilement horizontal, textes du guidage dans leurs cases, satellite après
changement de thème (7d : une tuile de couleur par hôte, une position par source codée — LU, Bruxelles, Berne, Madrid,
Cologne, Trèves, v58 : Fribourg-en-Brisgau, Munich, Francfort — jour et nuit, 412×900 et 900×412, attribution sur la carte, Turin → plan et message, frontière
Jougne → Vallorbe sans trou ; carte posée avec `moveMap` / `window.__maps`), perte du contexte WebGL, camion arrêté hors du tracé, boutons et réglages 7c, appui long et
coordonnées (phase 8), vue d'ensemble avec des positions envoyées comme le vrai GPS (plan et satellite), saisie après
un appui long, aires (liste, repères, fiche, avis, copie `data/aires-osm/` sans Overpass, hors zone : serveur Overpass de secours et cache, copie absente, encart en guidage avec le GPS
émulé), réglementation (fiches, « Éviter la ZFE », bandeau du guidage, heure de la tablette décalée un samedi
21 h 57), ADR (`adr` : fiche, notes, « Éviter le tunnel », bandeau, fichier absent, code vide, profil, vrai service worker
« Gabarit v37 », Réglages ADR repris d'un ancien profil, profil sans champs ADR), temps de conduite et vent (`drive` : 4 h 25 déjà comptées, Open-Meteo simulé, bouton « travail » à l'arrêt,
bandeau jamais sous la barre du bas, 360 / 412 px, tablette, paysage ; Réglages, copie, échec), tracés (`draw` :
tuiles lentes comme le vrai fond, source `route` et couche `route-line` après calcul, autre fiche, Plan / Satellite,
rechargement : itinéraire repris par la mémoire v53, 10 rechargements (v85 : pixels ambre, tous les points dans la vue,
zoom > 8, 2 repères départ / arrivée ; avant v85 la vue France restait environ 1 fois sur 8), puis
mémoire `gabarit-route` effacée, rechargement sans tracé et nouveau calcul compté en pixels ambre), frontières (`border` : fiches Suisse / Italie un mercredi 21 h 50, nuit suisse en vigueur, sources,
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
- `dialog` (phase 12c) : même trajet, copies `data/poids-osm/` et `data/dialog/` simulées (`dialogCopy: 'fixture'`,
  `dialogCopyFiles` passe par `tools/dialog-convert.mjs` ; par défaut 404, même si la vraie copie est dans le dépôt).
  412×900 et 900×412, jour et nuit : 2 lignes DiaLog (poids 3,5 t fusionné avec la Rue du Viaduc OSM « DiaLog et
  OpenStreetMap », hauteur 3,4 m au titre « <b>… » affiché en texte), mesure terminée et croisement ignorés, 2 repères
  `.dialog-marker` pointillés, ligne technique, panneau et « Éviter ce passage » (origine `dialog`) ; Réglages : case
  cochée, crédit avec la date ; guidage : aucun repère, rien à l'écran ni à voix haute ; réglage non ; copie absente = rien.
- Environnement (constaté le 23/11/2026) : Chromium sans écran refuse la wake lock → « Écran non maintenu allumé »
  dans le panneau du bas, plus haut que sur la tablette ; à 412×900 (`guidage`) le message bref passe alors sur les
  alertes (✘ « nav-toast », vert avec une wake lock simulée). 760×360 à l'arrêt (alerte de conduite avec « Pas une
  pause (travail) » sous le panneau du bas) : ✘ de v37 à v50, corrigé en v51 (petit paysage, hauteur < 400 px : bouton
  sur deux lignes, 7em, media query de `styles.css`) ; `guidage 760x360` vert.
- `camion` (v45) : guidage avec le GPS émulé à 412×900 et 900×412, jour, nuit, satellite : repère `data-icon="truck"`
  (pare-brise), 60 px, tourné au cap ; Réglages › Affichage « Flèche » → flèche au même point, réglage mémorisé.
- `autres` (v44) : GPS émulé ; en roulant, bouton grisé, « Disponible à l'arrêt », aucune requête ; à l'arrêt 3 s :
  vue d'ensemble, panneau, 1 à 3 requêtes de la position reçue vers la même arrivée (`vehicle_type` hgv), 3 fiches
  « Recommandé » en tête, notes, 2e fiche choisie → « Guider par cet itinéraire » → source `route` = 2e tracé ;
  panneau rouvert puis le véhicule roule → fermé ; 2009 → message du départ, aucune fiche ni bouton ; rien dit.
  412×900 jour, 900×412 nuit, 1280×800 jour. `guidage` : le bouton ouvre la vue d'ensemble et le panneau.
- `etapes` (v55) : fixture `ors-directions-etapes.json` (requête à 3 points ou plus) et `ors-directions-nav.json`
  (2 points). 412×900 jour, 1280×800 nuit, 360×760 et 800×1280 jour (saisie et fiche) : 2 étapes, ↓ puis ✕, boutons
  ≥ 48 px ; 1 à 3 requêtes avec tous les points, jamais `alternative_routes` ; ligne « Étape 1 · … — hh:mm (n min) »,
  note, repère `.stop-marker`. 412 et 1280 : fiche carburant à l'arrêt → « Ajouter comme étape » → nouveau calcul à 4
  points ; guidage GPS émulé : « Prochaine étape (1/1) » dans les détails, sortie de route en roulant → recalcul à
  3 points, « Étape atteinte. » dite une fois, jamais « Destination atteinte » ; à l'arrêt « Autres itinéraires » à
  2 points, champ « Ajouter une étape » → calcul à 3 points ; le véhicule roule → panneau fermé.
- `historique` (v56) : `ors-directions-nav.json`, 412×900 jour, 1280×800 nuit, 360×760 jour : « Ma note » grisée en
  roulant, active à l'arrêt, enregistrée (`areaNotes`), affichée dans la liste ; guidage GPS émulé jusqu'à l'arrivée →
  un trajet dans IndexedDB (`gabarit-history`), km plausibles, aucune coordonnée ; rien de la note dit ; Réglages :
  phrase de confidentialité, une ligne, statistiques du mois ; relevé (`emulateMedia print`, `window.print` remplacé) :
  seul `#history-print` visible, une ligne ; export avec `history` et `areaNotes`, sans la clé.
- `limites` (v57) : semi 44 t sur Colombier (copie `vitesses-osm` de test), GPS émulé à 108 km/h, 412×900 jour,
  1280×800 et 900×412 nuit : règle 60 hors autoroute → `.over-rule` (pointillés, aucune couleur `--danger`, mention
  « règle »), 50 OSM et 90 règle d'autoroute → `.over` (rouge) ; panneau dans ses couleurs ; rien dit ; aucun
  chevauchement.
- `carburant` (phase 4) : réponse de data.economie.gouv.fr simulée (option `fuel` d'`open`, forme de
  `/exports/json`), stations placées près du tracé de `ors-directions-nav.json`. 412×900 jour, 900×412 nuit, 1280×800
  jour : préparation en roulant → grisé, message, aucune requête ; à l'arrêt → une requête (`in_bbox`, rien d'autre),
  4 stations triées par prix, « ancien » (72 h), « Piste PL », détour à vol d'oiseau, texte fixe ; filtre Piste PL ;
  coût du trajet ; ★ gardée dans `gabarit.data` ; rouvert sans requête ; fermé en roulant ; guidage : puce grisée en
  roulant, à l'arrêt stations devant seulement, fermé en roulant, rien dit ; réseau coupé → « Pas de connexion ».
  Puis module `src/ui/fuel.js` refusé → message, nouvel essai chargé ; trajet en Suisse → « France seulement », 0 requête.
- `recommande` (v43) : deux itinéraires (Mont-Blanc + contournement synthétique décalé de 0,2°) : Euro 3 → le
  contournement est « Recommandé » avec la phrase, Mont-Blanc en « Préférence ORS », une seule requête, rien dit ;
  Euro 6 → ordre d'ORS ; ADR code E → contournement ; Mont-Blanc seul en Euro 3 → « Tous les itinéraires… »
  (412×900 jour ; 900×412 nuit pour le premier cas).
- `restrictions` (phase 12b) : départ et arrivée saisis en coordonnées autour du viaduc synthétique ; « Éviter ce
  passage » → restriction d'origine pont OSM, recalcul avec `avoid_polygons` centré sur le croisement, « Évite 1
  restriction saisie par toi », liste et aide dans Réglages (412×900 jour, 900×412 nuit) ; guidage : panneau fermé,
  ajout refusé en roulant, rien à l'écran ni à voix haute ; 2009 avec une restriction (option `restrictions` d'`open`)
  → « Une restriction saisie bloque peut-être le seul passage. »
- `vitesse` (phase 11a) : itinéraire synthétique de Colombier, copie `data/vitesses-osm/` construite par les fonctions
  de l'Action (`speedsCopy: 'fixture'` ; par défaut 404), fourgon de 3,5 t (étiquettes sans plafond : indépendant des
  règles françaises). 412×900 jour (réglage désactivé puis activé), 900×412 nuit, 360×760 nuit, 1280×800 jour : ligne
  `.route-card-speed`, cases lues, ligne technique, Réglages (case décochée, texte fixe), GPS émulé à 40 km/h → panneau
  « 50 » aux couleurs réglementaires, 70 km/h → `over` (bord 4 px), rien dit par défaut, « Limite 50. » une fois avec
  le réglage ; copie absente → « inconnues » et aucun panneau. v51 : semi de 44 t à 412×900 jour et 900×412 nuit,
  GPS émulé point par point : limite plafonnée par la règle générale (60, 90) → mention « règle » (`#nav-limit-src`,
  couleur `--muted`) sous le panneau ; limite écrite dans OSM (50) ou sans panneau → aucune mention ; couleurs du
  panneau inchangées, rien dit, aucun chevauchement.
- `reprise` (v53) : itinéraire en préparation gardé puis repris sans calcul ; guidage GPS, page cachée puis rechargée →
  « Guidage repris. », progression gardée ; sauvegarde vieillie de 13 h : rien demandé à vitesse inconnue ou en
  roulant, « Reprendre l'itinéraire ? » à l'arrêt, « Reprendre » relance ; ✕ + « Quitter » efface. 412×900 jour,
  900×412 nuit. Boutons ronds de la colonne : ≥ 40 px (v53), panneau du bas ≥ 56 px.
- `voies` (phase 11d, v61) : `ors-directions-sortie.json`, copie `data/voies-osm/` (`lanesCopy` : 'fixture' = w7001,
  'ambigu' = chemin juste avant aux flèches différentes, 'nombre' = lanes faux, absente), GPS émulé à 90 km/h : pas de
  rangée à plus de 1 km ; à moins de 1 km, 3 voies « off,off,ok » dans la pile du haut, sans chevaucher les boutons
  (en `nav-tight` : cachée) ; jamais dites ; cachée après la manœuvre ; 412×900, 900×412, 360×760, 1280×800, 760×360.
- `directions` (phase 11b ; v53 : ligne « Sortie 12 · Vallorbe » avec la copie 'fixture', jamais dite, cachée sinon ;
  v60, 11c : copie lieux `placesCopy` 'fixture' → « Restez à droite, vers Ennery-Test » sans bretelle sûre, entière dans
  le bandeau, jamais dite ; 'fixture' des bretelles → direction gardée ; 'egalite' ou copie absente → inchangée) : itinéraire synthétique `ors-directions-sortie.json` (autoroute puis « Restez à droite »),
  copie `data/directions-osm/` construite par les fonctions de l'Action (`directionsCopy` : 'fixture', 'proche' = avec
  une bretelle au cap opposé, 'ambigu' = deux bretelles au même cap, null = 404). GPS émulé à 90 km/h depuis 1,1 km
  de la sortie : bandeau « Restez à droite, direction Metz, Nancy (A 31) » entier, dit à voix haute ; 'proche' :
  affiché, pas dit ; 'ambigu' et copie absente : consigne inchangée. 412×900 jour, 900×412 nuit, 360×760 nuit,
  1280×800 jour.
- v62 : lignes de suggestions = `li.suggest-row` (la première `li` est le ✕), choisies par `click` (plus
  `pointerdown`) ; option `pelias(url, kind)` d'`open` (JSON ou null = réseau coupé ; `stats.pelias` compte
  /autocomplete, `stats.peliasSearch` /search). Échap vide nativement un champ `type=search` : fermer par le ✕.
- `etapes` (v62) : tronçons « Tronçon 1 : Départ → Étape 1 » / « … → Arrivée » (détail gris, arrivée du dernier =
  arrivée de la fiche), `#nav-stop` « Étape 1/1 : … » visible sans chevauchement, caché après l'étape, jamais dit ;
  champ `#alts-stop-input` absent en roulant.
- `preparation` (v62) : 412×900 jour, 900×412 nuit, 1280×800 jour : étape tapée en coordonnées sur un P → repère
  d'étape au-dessus (z-index) ; zoom 7 aucun P, 9,5 groupes « P n », 12 tous, groupe touché → zoom + 2 ; poignée
  ≥ 48 px, repliée = carte seule (carte agrandie de 200 px au moins), gardée au rechargement, dépliée ; guidage : aucun
  P recréé en suivant le véhicule (MutationObserver).
- `suggestions` (v62) : 412×900 jour, 360×760 nuit, 1280×800 jour : 2 caractères → 0 appel ; « Clermont-Ferrand » à
  4 car./s → 1 appel, rien avant 400 ms ; 5 lignes ≥ 48 px, nom puis commune et pays en `--muted`, ✕ ≥ 48 px, ✕ et
  toucher dehors ferment ; « Aucun résultat », « Pas de connexion » ; choix ; même texte → cache (0 appel, rien sur
  disque) ; étape et départ : même liste ; clavier simulé (`visualViewport` remplacé, `__keyboard(px)`) : `.kbd-open`,
  liste au-dessus du clavier ; homonymes (`pelias-homonymes.json` : 3 Sainte-Colombe aux codes postaux différents ;
  `pelias-sans-code.json` : Saint-Martin des Hautes-Alpes séparés par l'arrondissement, Gers, Bruyères 88600) ;
  validé sans choix → /search (plusieurs → liste, un → calcul) ; plafond du jour → ligne,
  0 appel, validation toujours possible ; mesure : 2 car./s → 14 appels. v64 : récents = choix de la liste seulement ;
  focus champ vide → titre gris + 5 récents, 0 appel ; « SAINT etienne » filtré ; récent avant ORS sans doublon ;
  ✕ ≥ 48 px retire sans fermer ; récent choisi remonte ; « Sources et licences » repliée au premier affichage
  (titre ≥ 48 px), effacer avec confirmation (refus → rien), dépliée gardée au rechargement.
- Lire un crédit de Réglages (v64) : `openCredits(page)` d'abord (section repliée par défaut).
- `signalements` (3a, v66) : `ors-directions-nav.json`, signalement confirmé à ≈ 900 m (option `reports` d'`open`),
  GPS émulé à 90 km/h ; 412×900 jour (voix activée : dit une fois), 900×412 nuit et 1280×800 jour (jamais dit) ; encart
  avec « La signalisation fait foi. », rien ne se chevauche ; « Signaler » en roulant → repère sans type, aucun champ ;
  repère touché en roulant → « Disponible à l'arrêt » ; à l'arrêt : fiche, type, confirmation ; fermée en roulant ;
  Réglages hors guidage : actif à l'arrêt, grisé en roulant (relevés GPS). Colonne de boutons ronds : 5 (drapeau).
- `lieux` (3b, v67) : Réglages › Mes lieux, arrivée choisie (Dépôt) et centre de la carte (Client) ; champ vide →
  « Mes lieux » en tête, lignes ≥ 48 px, aucun appel ; « dep » filtré ; gardés au rechargement.
- `ami` (3c, v68) : fichier téléchargé (navigator.share retiré) = confirmés seulement, jour seulement, sans note ni
  lieu ; fichier piégé (note HTML, champs inconnus, type inconnu, doublon) : aperçu, refus → rien, accepté → 2 importés
  non confirmés, note en texte brut, aucun élément créé ; 412×900 jour, 1280×800 nuit.
- `reglages` (v84) : 412×900 et 900×412, jour et nuit : 18 sections repliées au premier affichage, contenu caché et non
  focusable, titres ≥ 48 px, valeurs sous les titres sur une ligne ; « Guidage vocal » d'un toucher, ADR à Entrée,
  Interdictions à Espace (plusieurs ouvertes), sans chevauchement ; état gardé au rechargement ; clé vide → « Clé :
  manquante » dans le titre ; « Gabarit vNN » visible. Les autres scénarios ouvrent Réglages par `openSettings(page)`
  (tout déplié sauf « Sources et licences »).
- `fiche-infos` (v84) : mêmes tailles et thèmes ; cas sans alerte (accès lus, ponts et poids non signalés → « Aucune
  alerte »), défaut, interdit (ZFE Testville), plusieurs pays (Suisse, Italie) : menu replié après chaque calcul, en-tête
  ≥ 48 px, récap = niveaux `li[data-sev]`, pire niveau symbole + mot, contraste ≥ 4,5:1, ni coupé ni « … » ; cartes,
  question et boutons hors du menu ; ouvert : ordre interdit → info, fiches pays dedans ; autre fiche gardée ouverte,
  nouveau calcul replié, Entrée ouvre. Autres scénarios : `openTripInfo(page)` avant de vérifier une ligne à l'écran.
- `sensibles` (PR 3b ; règle v81) : copie `data/points-sensibles/` de test : 2 lignes « Point sensible » (hauteur basse km 3,
  tunnel sans hauteur km 4 : « à vérifier », « La signalisation fait foi. », source OSM) ; le point « interdiction » km 1
  de la section est remplacé par 1 ligne d'interdiction (« · km 1 · », arrêté cité, « À vérifier. », niveau `ban` v84) ;
  résumé « 3 points sensibles à vérifier » et 3 repères « ! » (la carte et le résumé comptent toujours les 3 points),
  diagnostic, fiche rouge v78, guidage sans repère ni voix, fourgon 3,5 t, copie absente.
- Corrigé en v85 (révélé par `draw`) : itinéraire repris (v53) avant la création de la carte (style en asynchrone,
  `loadStyle` → `build` de `map.js`) : `showRoutes` retient les repères (`marks`) et le cadrage (`createRouteReplay` de
  `src/lib/route-replay.js`) ; `build()` rejoue tracés (« style.load »), repères et `fitRoute(0)` une seule fois.
