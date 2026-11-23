// Règles générales de vitesse des poids lourds par pays et type de route (phase 11a). Logique pure, testée.
//
// Type de route = classe OSM de la voie (speed-convert.js) : 0 autoroute (motorway), 1 voie rapide (trunk),
// 2 à 4 route (primary, secondary, tertiary) ; bretelles classées comme la route parente. Une limite en
// agglomération n'est JAMAIS déduite d'une règle générale : ORS ne dit pas où est l'agglomération ; la valeur
// « agglomération » des fiches n'est jamais utilisée ici (seule l'étiquette maxspeed de la voie la donne).
// Ces règles ne servent qu'à plafonner une étiquette maxspeed (sans :hgv) : jamais affichées seules.
//
// France : FR_SPEED_RULES ci-dessous (texte officiel cité, date de vérification). Non vérifiée (verified null) → aucune
// règle utilisée : seules les étiquettes maxspeed:hgv donnent une limite.
// Autres pays : seulement les tranches `speeds.bands` des fiches data/pays (source nationale et date, isConfirmed) ;
// voie rapide = la plus basse des valeurs autoroute et route (les fiches ne distinguent pas toujours la voie rapide) ;
// valeur absente (BE : route selon la région) ou fiche absente (AT) → « à vérifier », aucune règle.
// Critère absent du profil (remorque non précisée) : la tranche la plus basse. Matières dangereuses (case ADR) :
// règle propre seulement si elle est vérifiée (`adr`), sinon aucune règle (une limite plus haute que la vraie ne doit
// jamais s'afficher).

import { speedBand, isConfirmed } from './country-rules.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Type de route d'une classe OSM (0 à 4). */
export function roadKind(cls) {
  if (cls === 0) return 'motorway';
  if (cls === 1) return 'express';
  if (cls >= 2 && cls <= 4) return 'road';
  return null;
}

/**
 * Règles françaises pour les véhicules de PTAC > 3,5 t (hors transports en commun).
 * bands : { over, upTo (t, null = sans borne), trailer : 'any' | 'with' | 'none', motorway, express, road } ;
 * adr : { over (t), motorway, express, road } ou null.
 *
 * Code de la route, texte lu le 23/11/2026 (Légifrance bloqué depuis le conteneur : PDF du code sur codes.droit.org,
 * reproduction de Légifrance, écrit dans le journal de l'Action « Données OSM », case r413, run 45130964965) :
 * Art. R413-8 (décret n° 2014-3 du 3 janvier 2014, art. 1) : « La vitesse des véhicules dont le poids total autorisé
 * en charge est supérieur à 3,5 tonnes ou des ensembles de véhicules dont le poids total roulant autorisé est
 * supérieur à 3,5 tonnes, à l'exception des véhicules de transport en commun, est limitée à :
 * 1° 90 km/h sur les autoroutes ;
 * 2° 80 km/h sur les routes à caractère prioritaire et signalées comme telles. Toutefois, cette vitesse maximale est
 * relevée à 90 km/h pour les véhicules dont le poids total est inférieur ou égal à 12 tonnes sur les routes à deux
 * chaussées séparées par un terre-plein central ;
 * 3° 80 km/h sur les autres routes. Toutefois, cette vitesse maximale est abaissée à 60 km/h pour les véhicules
 * articulés ou avec remorque dont le poids total est supérieur à 12 tonnes.
 * 4° 50 km/h en agglomération. […] »
 * Art. R413-9 (décret n° 2017-16 du 6 janvier 2017, art. 5) : « La vitesse des véhicules transportant des matières
 * dangereuses, dont le poids total autorisé en charge ou le poids total roulant autorisé est supérieur à 12 tonnes
 * […] est limitée à : 1° 80 km/ h sur les autoroutes ; 2° 60 km/ h sur les autres routes. Toutefois, cette vitesse
 * maximale est relevée à 70 km/ h sur les routes à caractère prioritaire et signalées comme telles, pour les
 * véhicules possédant des caractéristiques particulières définies par arrêté […] ; 3° 50 km/ h en agglomération. »
 * (Art. R413-8-1, transport de personnes de 3,5 à 12 t : valeurs plus hautes, non retenues : le profil ne dit pas si
 * le véhicule transporte des personnes, la plus basse s'applique.)
 *
 * Lecture prudente (aucune limite plus haute que la vraie) : OSM ne dit ni si une route est « à caractère prioritaire
 * et signalée comme telle », ni si elle a deux chaussées séparées → voie rapide (trunk) et route : 80 km/h (jamais le
 * 90 du 2°) ; au-delà de 12 t avec remorque ou articulé (semi-remorque) : 60 km/h (3°, une route prioritaire au sens
 * du 2° n'est pas reconnaissable) ; remorque non précisée au-delà de 12 t : les deux tranches → la plus basse (60).
 * Matières dangereuses au-delà de 12 t : 80 sur autoroute, 60 ailleurs (le 70 dépend d'un arrêté et du véhicule).
 * Agglomération (4°) : jamais utilisée (voir plus haut).
 */
export const FR_SPEED_RULES = Object.freeze({
  verified: '2026-11-23',
  source: 'Code de la route, art. R413-8 et R413-9',
  bands: Object.freeze([
    Object.freeze({ over: 3.5, upTo: 12, trailer: 'any', motorway: 90, express: 80, road: 80 }),
    Object.freeze({ over: 12, upTo: null, trailer: 'none', motorway: 90, express: 80, road: 80 }),
    Object.freeze({ over: 12, upTo: null, trailer: 'with', motorway: 90, express: 60, road: 60 }),
  ]),
  adr: Object.freeze({ over: 12, motorway: 80, express: 60, road: 60 }),
});

function frBands(vehicle, fr) {
  const ptac = isNum(vehicle?.weight) ? vehicle.weight : null;
  if (ptac === null || !fr?.verified) return [];
  return fr.bands.filter((b) => ptac > b.over && (b.upTo === null || ptac <= b.upTo)
    && (b.trailer === 'any' || !vehicle.trailer || b.trailer === vehicle.trailer));
}

/**
 * Limite générale PL : { kmh, source } ou null (inconnue, « à vérifier »).
 * @param {{ country:string|null, cls:number, vehicle:object, countries?:Map|null, fr?:object }} p
 *   fr : règles françaises (FR_SPEED_RULES par défaut ; autre objet de même forme dans les tests)
 */
export function generalLimit({ country, cls, vehicle, countries = null, fr = FR_SPEED_RULES }) {
  const kind = roadKind(cls);
  if (!kind || !country || !isNum(vehicle?.weight) || vehicle.weight <= 3.5) return null;
  const hazmat = vehicle.hazmat === true;
  if (country === 'FR') {
    const bands = frBands(vehicle, fr);
    if (!bands.length) return null;
    const vals = bands.map((b) => b[kind]).filter(isNum);
    if (vals.length !== bands.length) return null;
    let kmh = Math.min(...vals);
    // Matières dangereuses : règle propre au-delà de son seuil de poids (R413-9 : plus de 12 t) ; règle absente → aucune.
    if (hazmat) {
      if (!fr.adr) return null;
      const a = fr.adr[kind];
      if (vehicle.weight > (isNum(fr.adr.over) ? fr.adr.over : 0)) {
        if (!isNum(a)) return null;
        kmh = Math.min(kmh, a);
      }
    }
    return { kmh, source: fr.source };
  }
  const entry = countries instanceof Map ? countries.get(country) : null;
  const data = entry?.status === 'ok' ? entry.data : null;
  if (!data?.speeds || !isConfirmed(data.speeds, data, { national: true })) return null;
  const band = speedBand(data, vehicle);
  if (!band) return null;
  const m = isNum(band.motorway) ? band.motorway : null;
  const r = isNum(band.road) ? band.road : null;
  let kmh = kind === 'motorway' ? m : kind === 'road' ? r : (m !== null && r !== null ? Math.min(m, r) : null);
  if (kmh === null) return null;
  if (hazmat) {
    const adr = data.speeds.adr ?? [];
    if (adr.length) {
      const d = adr.length === 1 && isNum(adr[0].delta) && isConfirmed(adr[0], data, { national: true }) ? adr[0].delta : null;
      if (d === null) return null;
      kmh += d;
    }
  }
  return { kmh, source: data.sources?.[data.speeds.source]?.name ?? null };
}

/**
 * Seuil de la copie réduite (speed-convert.js) : la plus haute valeur de la règle générale pour la classe, toutes
 * tranches de PTAC confondues (une limite au-dessus serait plafonnée pour tout PL) ; null si règle non vérifiée.
 */
export function reducedThreshold(country, cls, fr = FR_SPEED_RULES) {
  const kind = roadKind(cls);
  if (country !== 'FR' || !kind || !fr?.verified) return null;
  const vals = fr.bands.map((b) => b[kind]).filter(isNum);
  return vals.length ? Math.max(...vals) : null;
}
