// Poids et frontières (phase 5e) : PTAC du profil au-delà de 40 t sur un trajet qui passe une frontière. Alerte avant
// le départ seulement (jamais de voix). Logique pure.
//
// Sources lues le 21/11/2026 :
// - Directive 96/53/CE (poids maximaux autorisés en trafic international), annexe I point 2.2.2 telle que modifiée par
//   la directive (UE) 2015/719 (JO UE L 115 du 6/05/2015, art. 1er point 9 c et d, texte lu dans l'édition espagnole
//   reproduite par le BOE : boe.es/doue/2015/115/L00001-00010.pdf ; EUR-Lex refuse les lectures automatiques) :
//   véhicules articulés de 5 ou 6 essieux : 40 t ; « c) vehículo de motor con 2 ejes, con semirremolque de 3 ejes, que
//   lleva, en operaciones de transporte intermodal, uno o varios contenedores o cajas móviles, de hasta una longitud
//   máxima total de 45 pies: 42 toneladas » ; « d) vehículo de motor con 3 ejes, con semirremolque de 2 o 3 ejes, […]
//   44 toneladas ». Opération de transport intermodal : art. 2 (transport combiné de la directive 92/106/CEE, ou voie
//   navigable / maritime avec trajet routier initial ou final de 150 km au plus).
// - Réponse du ministre chargé des transports à la question écrite n° 1666 (Assemblée nationale, JO du 7/02/2023,
//   p. 1245) : « La directive n'autorise la circulation en trafic international à 44 tonnes qu'aux ensembles de
//   5 essieux et plus, dont le véhicule moteur comporte trois essieux, qui transportent des conteneurs ou des caisses
//   mobiles en opération de transport intermodal » ; la France autorise 44 t « sur son seul territoire national » ;
//   « un État-membre ne peut conférer à une dérogation nationale un caractère transfrontalier sans contrevenir à la
//   directive 96/53/CE » (confirmé par le Conseil d'État, décision du 27/09/2022 sur le décret n° 2021-1006,
//   art. R312-4 du code de la route). Donc 40 t même entre deux pays qui autorisent 44 t chez eux.
// - Révision de la directive (poids des camions à zéro émission, trafic transfrontalier à 44 t) : pas adoptée au
//   21/11/2026 ; rien de changé ici.
// Le PTAC du profil n'est pas le poids réel : l'alerte le rappelle, seul le poids réel compte.

import { countriesAlongRoute } from './countries.js';

export const WEIGHTS = Object.freeze({
  /** Poids maximal en trafic international, ensembles de 5 essieux et plus (directive 96/53/CE, annexe I 2.2.2). */
  INTERNATIONAL_T: 40,
  /** Transport intermodal : tracteur à 3 essieux (2.2.2 d). */
  INTERMODAL_T: 44,
  /** Transport intermodal : tracteur à 2 essieux (2.2.2 c). */
  INTERMODAL_2AXLE_T: 42,
  FOOTER: 'La signalisation fait foi.',
  SHORT: 'International : 40 t',
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const tons = (n) => `${String(Math.round(n * 100) / 100).replace('.', ',')} t`;
const kmOf = (m) => `km ${Math.round(m / 1000)}`;

/**
 * Alerte de poids pour un itinéraire.
 * @param {object} route itinéraire (parseDirections : countries, coordinates)
 * @param {{ vehicle:object }} ctx vehicle.weight (PTAC, t), vehicle.combined (transport combiné)
 * @returns {{ international:boolean|null, lines:{ level:string, text:string }[], short:string[] }}
 *   international : null si les pays traversés sont inconnus
 */
export function weightRules(route, { vehicle } = {}) {
  const out = { international: null, lines: [], short: [] };
  const ptac = isNum(vehicle?.weight) ? vehicle.weight : null;
  const along = countriesAlongRoute(route, {});
  if (along.ok) out.international = new Set(along.segments.map((s) => s.code)).size > 1;
  if (ptac === null || ptac <= WEIGHTS.INTERNATIONAL_T) return out;
  const profile = `Votre profil indique ${tons(ptac)} (PTAC, pas le poids réel)`;
  if (out.international === null) {
    out.lines.push({
      level: 'info',
      text: `${profile} : si le trajet passe une frontière, poids réel limité à ${tons(WEIGHTS.INTERNATIONAL_T)} en international sauf transport combiné (pays traversés inconnus, à vérifier). ${WEIGHTS.FOOTER}`,
    });
    return out;
  }
  if (!out.international) return out;
  const first = along.crossings[0];
  const where = first ? ` Première frontière vers ${kmOf(first.along)}.` : '';
  if (vehicle?.combined && ptac <= WEIGHTS.INTERMODAL_T) {
    out.lines.push({
      level: 'info',
      text: `${profile}, transport combiné : en international, ${tons(WEIGHTS.INTERMODAL_T)} seulement avec un tracteur à 3 essieux et ${tons(WEIGHTS.INTERMODAL_2AXLE_T)} avec un tracteur à 2 essieux, conteneurs ou caisses mobiles de 45 pieds au plus (directive 96/53/CE) ; seul le poids réel compte. ${WEIGHTS.FOOTER}`,
    });
    return out;
  }
  const limit = vehicle?.combined ? WEIGHTS.INTERMODAL_T : WEIGHTS.INTERNATIONAL_T;
  const tail = vehicle?.combined ? 'même en transport combiné' : 'sauf transport combiné';
  out.lines.push({
    level: 'warn',
    text: `${profile} : en international, poids réel limité à ${tons(limit)} ${tail} (directive 96/53/CE), même entre deux pays qui autorisent 44 t chez eux : vérifiez votre poids réel.${where} ${WEIGHTS.FOOTER}`,
  });
  out.short.push(`International : ${tons(limit)}`);
  return out;
}
