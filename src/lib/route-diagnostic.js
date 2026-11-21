// Diagnostic d'un itinéraire (phase 5h bis) : texte à copier depuis la fiche, pour comparer ce qu'ORS renvoie vraiment
// (noms d'étapes, références de route lues) avec les règles qui en dépendent (taxes PL, ZFE, interdictions). Logique
// pure. Pas de clé, pas de véhicule complet : étapes (km, nom ORS, références lues, point de départ arrondi à 0,01°,
// soit environ 1 km), pays traversés, passages ZFE et taxes PL.
//
// ORS (GraphHopper v4.17, EncodingManager.applyWayTags) nomme une étape d'après l'étiquette OSM `name`, suivie de
// « , » et de `ref` quand elle existe (ref seule si la voie n'a pas de nom) : « Autoroute des Cigognes, A 35 ».

import { prepareLine } from './nav-geo.js';
import { roadRefs } from './route-samples.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const km = (m) => (m / 1000).toFixed(1).replace('.', ',');
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
  }
  if (!steps.length) lines.push('  (aucune étape)');
  if (rules) {
    const zfe = rules.passages ?? [];
    lines.push(`ZFE (${zfe.length}) :${zfe.length ? '' : ' aucune'}`);
    for (const p of zfe) {
      lines.push(`  ${p.name} [${p.id}] : km ${km(p.enter)}–${km(p.exit)}${p.banned ? ', interdite' : ''}${p.onVoie ? ', tronçon spécial' : ''}`);
    }
    const tolls = rules.tolls?.passages ?? [];
    lines.push(`Taxes PL (${tolls.length}) :${tolls.length ? '' : ' aucune'}`);
    for (const p of tolls) lines.push(`  ${p.tax.short} : km ${km(p.enter)}–${km(p.exit)} (${p.roads.join(', ')})`);
  }
  return lines.join('\n');
}
