// Mémoire de l'itinéraire en arrière-plan (v53) : logique pure, sans DOM ni IndexedDB (src/ui/route-save.js).
// Quand l'appli passe en arrière-plan (autre appli, écran verrouillé, appli tuée par le système), l'itinéraire en
// préparation ou en cours de guidage est gardé sur l'appareil et repris au retour.
//
// Règles :
// - deux cas : « plan » (itinéraire calculé, guidage non lancé) et « nav » (guidage en cours, GPS réel ; jamais une
//   simulation) ;
// - gardé : départ, arrivée, libellés, options calculées et choix, réglages du calcul (péages, ferries, restrictions
//   évitées), progression le long du tracé ; le profil camion par son identifiant seulement (jamais une copie) ;
//   aucune clé, rien de secret (liste blanche de champs ; champs nommés apiKey, orsKey, token… retirés partout) ;
// - au retour : sauvegarde de moins de 12 h → reprise telle quelle ; plus de 12 h → question « Reprendre
//   l'itinéraire ? », posée seulement à l'arrêt (Code de la route art. R412-6-2 : aucune saisie en roulant ; vitesse
//   inconnue = en mouvement) ; format différent, contenu illisible ou profil supprimé → ignorée ;
// - effacée à l'arrivée et quand le guidage est quitté (✕ puis « Quitter ») ;
// - v55 : étapes (`choice.stops`, 10 au plus) et étapes déjà atteintes (`progress.nextStop`) gardées ; champs
//   optionnels du même format 1 : une ancienne sauvegarde sans étapes est reprise comme avant ; des étapes présentes
//   mais illisibles → sauvegarde ignorée.

import { sanitizeStops } from './stops.js';

export const ROUTE_SAVE = Object.freeze({
  FORMAT: 1,
  /** Au-delà, la reprise est demandée (à l'arrêt) au lieu d'être faite seule. */
  ASK_AFTER_MS: 12 * 3600 * 1000,
  /** Écritures limitées pendant le guidage (la progression change à chaque position). */
  MIN_INTERVAL_MS: 30 * 1000,
  KINDS: Object.freeze(['plan', 'nav']),
});

export const RESUME_QUESTION = 'Reprendre l\'itinéraire ?';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isPoint = (p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]);
const SECRET_KEY = /^(api_?key|ors_?key|access_?token|token|secret|password|authorization)$/i;

/** Copie JSON sans aucun champ dont le nom ressemble à une clé ou un secret (à toute profondeur). */
export function withoutSecrets(value) {
  return JSON.parse(JSON.stringify(value ?? null, (k, v) => (k && SECRET_KEY.test(k) ? undefined : v)));
}

function validRoute(r) {
  return !!r && Array.isArray(r.coordinates) && r.coordinates.length >= 2 && r.coordinates.every(isPoint);
}

/**
 * Sauvegarde à écrire.
 * @param {{ kind:'plan'|'nav', choice:object, vehicleId:string, along?:number|null, segIndex?:number|null, now:number }} p
 *   choice : itinéraires proposés (app.js) ; along / segIndex : progression du guidage
 * @returns {object|null} null si rien à garder
 */
export function buildSave({
  kind, choice, vehicleId, along = null, segIndex = null, nextStop = 0, drivenBefore = 0, tripStartedAt = null,
  stopsDone = [], now,
}) {
  if (!ROUTE_SAVE.KINDS.includes(kind) || !choice || typeof vehicleId !== 'string' || !vehicleId) return null;
  const options = Array.isArray(choice.options) ? choice.options : [];
  if (!options.length || !options.every((o) => validRoute(o?.route))) return null;
  const selected = Number.isInteger(choice.selected) && choice.selected >= 0 && choice.selected < options.length ? choice.selected : 0;
  const save = {
    format: ROUTE_SAVE.FORMAT,
    kind,
    savedAt: now,
    vehicleId,
    choice: withoutSecrets({
      options,
      selected,
      start: choice.start ?? null,
      end: choice.end ?? null,
      restr: choice.restr ?? null,
      avoidTolls: choice.avoidTolls === true,
      avoidFerries: choice.avoidFerries === true,
      fromLabel: typeof choice.fromLabel === 'string' ? choice.fromLabel : '',
      toLabel: typeof choice.toLabel === 'string' ? choice.toLabel : '',
      startIsMyPosition: choice.startIsMyPosition === true,
      stops: sanitizeStops(choice.stops) ?? [],
    }),
  };
  if (kind === 'nav') {
    save.progress = {
      along: isNum(along) && along >= 0 ? along : 0, segIndex: Number.isInteger(segIndex) ? segIndex : null,
      nextStop: Number.isInteger(nextStop) && nextStop >= 0 ? nextStop : 0,
      // v56 : historique (km et durée du trajet repris après une mise en arrière-plan).
      drivenBefore: isNum(drivenBefore) && drivenBefore >= 0 ? drivenBefore : 0,
      tripStartedAt: isNum(tripStartedAt) ? tripStartedAt : null,
      stopsDone: Array.isArray(stopsDone) ? stopsDone.filter((x) => typeof x === 'string').slice(0, 10) : [],
    };
  }
  return save;
}

/** Sauvegarde lisible (format, champs, tracés) ? */
export function isValidSave(save) {
  if (!save || typeof save !== 'object' || save.format !== ROUTE_SAVE.FORMAT) return false;
  if (!ROUTE_SAVE.KINDS.includes(save.kind) || !isNum(save.savedAt) || typeof save.vehicleId !== 'string' || !save.vehicleId) return false;
  const c = save.choice;
  if (!c || !Array.isArray(c.options) || !c.options.length || !c.options.every((o) => validRoute(o?.route))) return false;
  if (!Number.isInteger(c.selected) || c.selected < 0 || c.selected >= c.options.length) return false;
  if (!isPoint(c.end)) return false;
  if (sanitizeStops(c.stops) === null) return false; // v55 : absentes = aucune étape (ancienne sauvegarde)
  // v76 : étapes propres à une fiche (« Rocade Est », points de passage `via` compris) : lisibles ou absentes.
  if (c.options.some((o) => o.stops !== undefined && sanitizeStops(o.stops) === null)) return false;
  if (save.kind === 'nav' && !(save.progress && isNum(save.progress.along) && save.progress.along >= 0)) return false;
  return true;
}

/**
 * Que faire d'une sauvegarde au démarrage ?
 * @param {object|null} save
 * @param {{ now:number, vehicles:{ id:string }[] }} ctx
 * @returns {{ action:'none'|'ignore'|'restore'|'ask', reason?:string }}
 *   none : rien de sauvegardé ; ignore : à effacer ; restore : reprise seule ; ask : question à l'arrêt
 */
export function checkSave(save, { now, vehicles = [] }) {
  if (save === null || save === undefined) return { action: 'none' };
  if (!isValidSave(save)) return { action: 'ignore', reason: save?.format !== ROUTE_SAVE.FORMAT ? 'format' : 'invalid' };
  if (!vehicles.some((v) => v?.id === save.vehicleId)) return { action: 'ignore', reason: 'vehicle' };
  const age = now - save.savedAt;
  if (!(age >= 0)) return { action: 'ignore', reason: 'future' };
  return { action: age > ROUTE_SAVE.ASK_AFTER_MS ? 'ask' : 'restore' };
}

/**
 * Faut-il écrire maintenant ? Toujours au passage en arrière-plan (`force`) et à un changement de cas (plan ↔ nav,
 * nouvel itinéraire) ; sinon au plus toutes les 30 s.
 * @param {{ at:number, key:string }|null} last dernière écriture
 * @param {{ now:number, key:string, force?:boolean }} p key : cas + itinéraire (voir saveKey)
 */
export function shouldSave(last, { now, key, force = false }) {
  if (force || !last || last.key !== key) return true;
  return now - last.at >= ROUTE_SAVE.MIN_INTERVAL_MS;
}

/** Clé d'un état : cas, itinéraire choisi (nombre de points et extrémités), sans la progression. */
export function saveKey(kind, choice) {
  const r = choice?.options?.[choice?.selected]?.route;
  const c = r?.coordinates;
  if (!Array.isArray(c) || !c.length) return `${kind}:-`;
  return `${kind}:${c.length}:${c[0].join(',')}:${c[c.length - 1].join(',')}`;
}

/**
 * Itinéraires repris : la sauvegarde avec le profil actuel (par son identifiant), prêts pour app.js.
 * @returns {object|null} choice
 */
export function restoredChoice(save, vehicles) {
  if (!isValidSave(save)) return null;
  const vehicle = (vehicles ?? []).find((v) => v?.id === save.vehicleId);
  if (!vehicle) return null;
  const options = save.choice.options.map((o) => (o.stops === undefined ? o : { ...o, stops: sanitizeStops(o.stops) }));
  return { ...save.choice, options, stops: sanitizeStops(save.choice.stops) ?? [], failures: [], vehicle };
}
