---
name: gabarit-conduite-vent
description: Règles du temps de conduite et des pauses (CE 561/2006, driving-time.js) et du vent fort (Open-Meteo, wind.js). À utiliser avant de toucher à ces fonctions.
---

# Temps de conduite et vent fort

(Texte déplacé tel quel depuis CLAUDE.md.)

- Temps de conduite (phase 5 B, `driving-time.js`) : règlement (CE) 561/2006 cité en commentaire (eur-lex bloqué
  depuis le conteneur). Aide seulement, « le chronotachygraphe fait foi » affiché ; toujours « Pause conseillée »
  (fiche, notes, bandeau, voix, tests), jamais « obligatoire ». Conduite ≥ 5 km/h (reprise retenue
  après 30 s, comptée depuis son début), pause ≥ 15 min, art. 7 dans l'ordre 15 puis 30 min, 45 min, arrêt ≥ 9 h =
  repos journalier ; 9 h / 10 h (2 fois par semaine, la journée prolongée compte), 56 h, 90 h sur deux semaines,
  semaine du lundi 0 h (heure de la tablette). Positions espacées de plus de 60 s = arrêt. Décompte dans le moteur
  (`state.driving`, `view.driving`), enregistré dans `localStorage` `gabarit.driving` (toutes les 15 s, fin du
  guidage, pagehide), jamais exporté ; simulation : décompte vide, rien d'enregistré. « Pas une pause (travail) » :
  `markStopAsWork`, refusé à 10 km/h et plus, bouton affiché seulement dessous ; second appui recompte. Voix si
  `settings.driveVoice`. Bandeau `#nav-drive` dans `.nav-top` ; `fitBanner` resserre le bandeau (`.nav-tight`) quand
  il passerait sous la barre du bas ou que la colonne de boutons ne tient plus (téléphone, plusieurs alertes).
  Avant le départ, `breakSchedule` : pause conseillée sur une aire du bon sens (aires de la phase 9 placées sur le
  tracé) atteinte dans l'heure avant 4 h 30, puis toutes les 4 h 30 ; repos de 11 h au-delà de 9 h ; `elapsed`
  recale les heures de passage des ZFE, interdictions PL et vent (option `elapsed` de `zfeAlongRoute`,
  `bansAlongRoute`, `windAlongRoute`).
- Vent fort (phase 5 B, `wind.js`) : Open-Meteo `/v1/forecast` (`OPEN_METEO_BASE`), sans clé, usage non commercial,
  < 10 000 appels/jour, chaque point compte → 40 points au plus ; doc lue sur raw.githubusercontent.com
  (open-meteo/open-meteo-website : `src/routes/en/docs`, `terms`, `licence`), open-meteo.com et api.open-meteo.com
  bloqués depuis le conteneur. Une requête GET par calcul (tous les itinéraires proposés), `wind_gusts_10m` = maximum
  de l'heure précédente (valeur de l'heure suivant le passage), seuil `settings.windGust` (40–150, pas de 5, 70 par
  défaut), voix `settings.windVoice`. Copie `localStorage` `gabarit.windCache` (3 trajets, 3 h), jamais dans le cache
  du service worker ; échec → « Météo indisponible », jamais bloquant. Attribution « Weather data by Open-Meteo.com »
  (CC BY 4.0, liens vers le site et la licence) sous les fiches et dans Réglages, « (Open-Meteo) » dans le bandeau.
  Guidage : `view.rules.wind`, bandeau sous 30 km, voix une
  fois vers 15 km ; recalcul / prévision tardive : `placeWind` sans requête.
