// Liste de suggestions sous un champ de recherche (v62) : départ, arrivée, étapes et « Ajouter une étape » du guidage
// utilisent le même composant (src/ui/route-form.js, attachAutocomplete). Logique pure : la recherche, le minuteur,
// le budget de géocodage et le cache sont fournis (tests sans horloge réelle ni réseau).
//
// Règles :
// - recherche après 3 caractères (MIN_SEARCH_CHARS), 400 ms après la dernière frappe ; la requête précédente est
//   annulée à chaque frappe ; coordonnées tapées : proposées sans appel (suggestionPlan) ;
// - 5 résultats au plus ; chaque ligne : nom du lieu, puis commune et pays (gris) ;
// - aucune suggestion → ligne « Aucun résultat » ; pas de réseau → ligne « Pas de connexion » ; plafond de géocodage
//   atteint → ligne qui renvoie à la validation (recherche à part, place-resolve.js) : jamais une impasse ;
// - clé absente, refusée, quota d'ORS (403 / 429) : message habituel (onError), liste fermée.

import { suggestionPlan } from './coords.js';
import { SUGGEST_MAX } from './ors-request.js';

export const SUGGEST = Object.freeze({
  DELAY_MS: 400,
  MAX: SUGGEST_MAX,
  NO_RESULT_TEXT: 'Aucun résultat',
  OFFLINE_TEXT: 'Pas de connexion',
  EXHAUSTED_TEXT: "Suggestions du jour épuisées : tapez l'adresse complète puis validez.",
  CLOSE_LABEL: 'Fermer les suggestions',
});

// Navigateur : setTimeout appelé comme méthode d'un autre objet → « Illegal invocation » ; d'où les flèches.
const DEFAULT_TIMER = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };

/** Erreur de réseau (hors ligne, coupure, délai dépassé) : ligne « Pas de connexion ». */
export function isOfflineError(err) {
  return ['offline', 'network', 'timeout'].includes(err?.kind);
}

/**
 * Lignes de la liste.
 * @param {{ items?:object[], status:'idle'|'results'|'empty'|'offline'|'exhausted' }} st
 * @returns {{ kind:'place'|'info', text:string, sub?:string, index?:number }[]}
 */
export function suggestionRows(st) {
  switch (st?.status) {
    case 'results':
      return (st.items ?? []).slice(0, SUGGEST.MAX).map((s, index) => ({
        kind: 'place', text: s.name || s.label, sub: s.place ?? '', index,
      }));
    case 'empty': return [{ kind: 'info', text: SUGGEST.NO_RESULT_TEXT }];
    case 'offline': return [{ kind: 'info', text: SUGGEST.OFFLINE_TEXT }];
    case 'exhausted': return [{ kind: 'info', text: SUGGEST.EXHAUSTED_TEXT }];
    default: return [];
  }
}

/**
 * Contrôleur d'un champ.
 * @param {{
 *   search:(text:string, signal:AbortSignal)=>Promise<object[]>,
 *   budget?:{ canSend:(k:string)=>boolean, record:(k:string)=>void },
 *   cache?:{ get:(t:string)=>any, set:(t:string,v:any)=>void },
 *   timer?:{ set:(fn:Function, ms:number)=>any, clear:(id:any)=>void },
 *   onState:(st:{ status:string, items:object[] })=>void,
 *   onError?:(err:any)=>void,
 *   isOnline?:()=>boolean,
 * }} o
 */
export function createSuggester({
  search, budget = null, cache = null, timer = DEFAULT_TIMER, onState, onError = () => {},
  isOnline = () => true,
}) {
  let pending = null;
  let ctrl = null;
  let seq = 0;
  const emit = (status, items = []) => onState({ status, items: items.slice(0, SUGGEST.MAX) });
  function cancel() {
    if (pending !== null) timer.clear(pending);
    pending = null;
    ctrl?.abort();
    ctrl = null;
  }
  async function run(text, id) {
    pending = null;
    const hit = cache?.get(text);
    if (hit !== undefined) { emit(hit.length ? 'results' : 'empty', hit); return; }
    if (!isOnline()) { emit('offline'); return; }
    if (budget && !budget.canSend('autocomplete')) { emit('exhausted'); return; }
    ctrl = new AbortController();
    const signal = ctrl.signal;
    budget?.record('autocomplete');
    try {
      const items = (await search(text, signal)).slice(0, SUGGEST.MAX);
      if (signal.aborted || id !== seq) return;
      cache?.set(text, items);
      emit(items.length ? 'results' : 'empty', items);
      onError(null);
    } catch (err) {
      if (signal.aborted || id !== seq) return;
      if (isOfflineError(err)) { emit('offline'); return; }
      emit('idle');
      onError(err);
    }
  }
  return {
    /** Nouvelle frappe : liste remplacée tout de suite, recherche 400 ms plus tard (précédente annulée). */
    input(value) {
      cancel();
      seq += 1;
      const id = seq;
      const plan = suggestionPlan(value);
      if (plan.items.length) { emit('results', plan.items); onError(null); return; }
      emit('idle');
      if (!plan.search) return;
      const text = plan.search;
      pending = timer.set(() => { run(text, id); }, SUGGEST.DELAY_MS);
    },
    /** Fermeture (choix, ✕, toucher dehors) : recherche en attente annulée. */
    cancel() {
      cancel();
      seq += 1;
    },
  };
}
