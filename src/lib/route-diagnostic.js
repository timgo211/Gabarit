// Diagnostic d'un itinéraire (phase 5h bis) : texte à copier depuis la fiche, pour comparer ce qu'ORS renvoie vraiment
// (noms d'étapes, références de route lues) avec les règles qui en dépendent (taxes PL, ZFE, interdictions). Logique
// pure. Pas de clé, pas de véhicule complet : étapes (km, nom ORS, références lues, point de départ arrondi à 0,01°,
// soit environ 1 km), pays traversés, passages ZFE et taxes PL.
//
// ORS (GraphHopper v4.17, EncodingManager.applyWayTags) nomme une étape d'après l'étiquette OSM `name`, suivie de
// « , » et de `ref` quand elle existe (ref seule si la voie n'a pas de nom) : « Autoroute des Cigognes, A 35 ».
// Phase 5h ter : méthode de repérage des taxes PL (géométrie OSM ou noms d'étape) et, pour chaque étape sans nom de
// plus de 5 km, un point tous les 10 km (arrondi à 0,001°, soit environ 100 m ; jamais à moins de 1 km du départ ou
// de l'arrivée) pour retrouver la route sur une carte.

import { prepareLine, pointAt } from './nav-geo.js';
import { roadRefs } from './route-samples.js';
import { roadStatsText } from './road-class.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const km = (m) => (m / 1000).toFixed(1).replace('.', ',');
const UNNAMED_MIN_M = 5000;
const UNNAMED_STEP_M = 10000;
const ENDS_M = 1000;
const fine = (c) => `${c[1].toFixed(3)}, ${c[0].toFixed(3)}`;
const shortDate = (iso) => (typeof iso === 'string' ? iso.split('-').reverse().join('/') : '?');
const methodLabel = (m, date) => (m === 'osm' ? `géométrie OSM (copie du ${shortDate(date)})` : 'noms d\'étape (réseau OSM non chargé)');
const pt = (c) => (Array.isArray(c) && isNum(c[0]) && isNum(c[1]) ? `${c[1].toFixed(2)}, ${c[0].toFixed(2)}` : '?');

/**
 * @param {object} route itinéraire (parseDirections)
 * @param {{ version?:string, rules?:object|null, label?:string }} ctx version : texte de #app-version (« Gabarit v30 ») ;
 *   rules : résultat de routeRules pour cet itinéraire
 * @returns {string} texte sur plusieurs lignes
 */
export function routeDiagnosticText(route, { version = '', rules = null, label = '' } = {}) {
  const head = /Gabarit/.test(version) ? version : `Gabarit, ${version || 'version inconnue'}`;
  const lines = [`${head} — diagnostic du trajet${label ? ` (${label})` : ''}`];
  const coords = Array.isArray(route?.coordinates) ? route.coordinates : [];
  if (coords.length < 2) return [...lines, 'Tracé absent.'].join('\n');
  const line = prepareLine(coords);
  lines.push(`Distance : ${km(line.total)} km ; départ ${pt(coords[0])} ; arrivée ${pt(coords[coords.length - 1])}`);
  if (Array.isArray(route.countries) && route.countries.length) {
    lines.push(`Pays (countryinfo) : ${route.countries.map((c) => c.code).join(' → ')}`);
  } else lines.push('Pays (countryinfo) : absent');
  lines.push(roadStatsText(route)); // phase 2g : km A / N / autre / inconnus, part A/N
  lines.push('Étapes ORS (km début–fin | nom renvoyé | références lues | point de début) :');
  const steps = Array.isArray(route.steps) ? route.steps : [];
  const last = coords.length - 1;
  for (const s of steps) {
    const wp = Array.isArray(s?.wayPoints) ? s.wayPoints : null;
    const a = wp ? line.cum[Math.max(0, Math.min(last, wp[0]))] ?? 0 : null;
    const b = wp ? line.cum[Math.max(0, Math.min(last, wp[1]))] ?? 0 : null;
    const name = typeof s?.name === 'string' && s.name ? s.name : '(sans nom)';
    const refs = roadRefs(s?.name);
    lines.push(`  ${a === null ? '?' : km(a)}–${b === null ? '?' : km(b)} | ${name} | ${refs.length ? refs.join(', ') : '—'} | ${wp ? pt(coords[wp[0]]) : '?'}`);
    // Étape sans nom (ORS renvoie « - » ou rien) de plus de 5 km : un point tous les 10 km.
    if (a !== null && b !== null && (name === '(sans nom)' || name.trim() === '-') && b - a > UNNAMED_MIN_M) {
      for (let d = a + UNNAMED_STEP_M; d < b; d += UNNAMED_STEP_M) {
        if (d < ENDS_M || d > line.total - ENDS_M) continue;
        lines.push(`    point km ${km(d)} : ${fine(pointAt(line, d).point)}`);
      }
    }
  }
  if (!steps.length) lines.push('  (aucune étape)');
  if (rules?.bridges?.tech) lines.push(rules.bridges.tech); // phase 12a : mesure du bruit sur de vrais trajets
  if (rules?.weightLimits?.tech) lines.push(rules.weightLimits.tech); // phase 12a bis : « Limites de poids : N »
  if (rules?.speedLimits?.tech) lines.push(rules.speedLimits.tech); // phase 11a : couverture et sources des limites
  if (rules) {
    const zfe = rules.passages ?? [];
    lines.push(`ZFE (${zfe.length}) :${zfe.length ? '' : ' aucune'}`);
    for (const p of zfe) {
      lines.push(`  ${p.name} [${p.id}] : km ${km(p.enter)}–${km(p.exit)}${p.banned ? ', interdite' : ''}${p.onVoie ? ', tronçon spécial' : ''}`);
    }
    const tolls = rules.tolls?.passages ?? [];
    const methods = rules.tolls?.method ?? null;
    if (methods?.length) lines.push(`Méthode taxes PL : ${methods.map((m) => `${m.short} : ${methodLabel(m.method, m.networkDate)}`).join(' ; ')}`);
    lines.push(`Taxes PL (${tolls.length}) :${tolls.length ? '' : ' aucune'}`);
    for (const p of tolls) {
      lines.push(`  ${p.tax.short} : km ${km(p.enter)}–${km(p.exit)} (${p.roads.join(', ')})${p.method ? ` — ${methodLabel(p.method, p.networkDate)}` : ''}`);
    }
  }
  return lines.join('\n');
}
