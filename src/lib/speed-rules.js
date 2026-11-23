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
 * adr : { motorway, express, road } ou null.
 * Rempli d'après le Code de la route (art. R413-8) lu par l'Action « Données OSM » (case r413) ; voir le texte cité.
 */
export const FR_SPEED_RULES = Object.freeze({
  verified: null,
  source: null,
  bands: Object.freeze([]),
  adr: null,
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
    if (hazmat) {
      const a = fr.adr?.[kind];
      if (!isNum(a)) return null;
      kmh = Math.min(kmh, a);
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
