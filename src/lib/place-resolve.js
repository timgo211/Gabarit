// Texte validé sans choix dans la liste (v62) : « Calculer » ou Entrée avec un départ, une arrivée ou une étape tapés
// mais pas choisis. Avant, le calcul était refusé (« Choisis … dans la liste ») : impasse si les suggestions étaient
// épuisées ou si le réseau revenait. Logique pure : la recherche et le budget sont fournis.
//
// Règles :
// - coordonnées tapées : prises sans appel ;
// - sinon une requête Pelias /search (5 au plus, compteur « search » à part de l'autocomplétion) :
//   1 résultat → pris ; plusieurs → la liste s'ouvre avec ces résultats, rien de deviné ; 0 → « Aucun résultat » ;
//   réseau → « Pas de connexion » ; plafond de recherche atteint → appui long ou coordonnées (sans appel) ;
// - le calcul d'itinéraire (budget de 3 requêtes ORS) ne part qu'une fois tous les points résolus.

import { suggestionPlan } from './coords.js';
import { SUGGEST, isOfflineError } from './suggest.js';

export const RESOLVE = Object.freeze({
  QUOTA_TEXT: 'Quota de recherche du jour atteint : touchez la carte longuement pour placer le point, ou tapez des coordonnées.',
  CHOOSE_TEXT: (what) => `Plusieurs lieux pour ${what} : choisis dans la liste.`,
  NONE_TEXT: (what) => `${what} : aucun lieu trouvé. Vérifie l'adresse.`,
});

/**
 * @param {string} text
 * @param {{ search:(text:string)=>Promise<object[]>, budget?:{canSend:Function, record:Function}, isOnline?:()=>boolean }} o
 * @returns {Promise<{ kind:'picked', item:object } | { kind:'choose', items:object[] } | { kind:'none' }
 *   | { kind:'offline' } | { kind:'quota' } | { kind:'empty' } | { kind:'error', error:any }>}
 */
export async function resolvePlace(text, { search, budget = null, isOnline = () => true }) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return { kind: 'empty' };
  const plan = suggestionPlan(t);
  if (plan.items.length) return { kind: 'picked', item: plan.items[0] };
  if (!isOnline()) return { kind: 'offline' };
  if (budget && !budget.canSend('search')) return { kind: 'quota' };
  budget?.record('search');
  try {
    const items = (await search(t)).slice(0, SUGGEST.MAX);
    if (items.length === 1) return { kind: 'picked', item: items[0] };
    if (items.length > 1) return { kind: 'choose', items };
    return { kind: 'none' };
  } catch (err) {
    if (isOfflineError(err)) return { kind: 'offline' };
    return { kind: 'error', error: err };
  }
}
