// Traduction des échecs ORS / Pelias / réseau en messages clairs pour la cabine. Logique pure.
// Codes d'erreur ORS directions : 2003 paramètre invalide, 2004 distance trop grande,
// 2009 itinéraire introuvable, 2010 point introuvable, 2099 inconnue.

export const ERROR_KINDS = {
  NO_KEY: 'no-key',
  INVALID_KEY: 'invalid-key',
  QUOTA: 'quota',
  NO_ROUTE: 'no-route',
  POINT_NOT_FOUND: 'point-not-found',
  TOO_FAR: 'too-far',
  BAD_REQUEST: 'bad-request',
  OFFLINE: 'offline',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  SERVER: 'server',
  UNKNOWN: 'unknown',
};

const MESSAGES = {
  'no-key': 'Aucune clé OpenRouteService. Ouvre Réglages pour la saisir.',
  'invalid-key': 'Clé OpenRouteService refusée. Vérifie-la dans Réglages (bouton « Tester »).',
  quota: 'Quota OpenRouteService dépassé. Réessaie plus tard (le quota gratuit se renouvelle chaque jour).',
  'no-route': "Aucun itinéraire autorisé pour ce gabarit. Essaie d'autoriser péages/ferries ou vérifie le profil véhicule.",
  'point-not-found': 'Départ ou arrivée trop loin d\'une route accessible. Choisis un point plus proche d\'une route.',
  'too-far': 'Trajet trop long pour le service gratuit. Découpe-le en étapes.',
  'bad-request': 'Requête refusée par OpenRouteService. Vérifie les valeurs du profil véhicule.',
  offline: 'Pas de connexion Internet. Le calcul d\'itinéraire a besoin du réseau.',
  // Réseau présent mais requête bloquée : souvent le serveur qui refuse sans en-têtes CORS (clé refusée).
  network: 'Impossible de joindre OpenRouteService. Vérifie la connexion ; si elle fonctionne, teste la clé dans Réglages.',
  timeout: 'Le service OpenRouteService met trop de temps à répondre. Réessaie.',
  server: 'Le service OpenRouteService ne répond pas correctement. Réessaie dans quelques minutes.',
  unknown: 'Erreur inattendue pendant le calcul.',
};

/** Extrait { code, message } du corps d'erreur ORS (objet ou chaîne). */
function readBody(body) {
  if (!body) return { code: null, text: '' };
  if (typeof body === 'string') return { code: null, text: body };
  const err = body.error;
  if (typeof err === 'string') return { code: null, text: err };
  if (err && typeof err === 'object') return { code: Number(err.code) || null, text: String(err.message ?? '') };
  return { code: null, text: String(body.message ?? '') };
}

/**
 * @param {{ status?:number, body?:any, offline?:boolean, networkError?:boolean, timeout?:boolean, noKey?:boolean }} p
 * @returns {{ kind:string, message:string, detail:string }}
 */
export function classifyError({ status, body, offline = false, networkError = false, timeout = false, noKey = false } = {}) {
  const make = (kind, detail = '') => ({ kind, message: MESSAGES[kind], detail });
  if (noKey) return make(ERROR_KINDS.NO_KEY);
  if (offline) return make(ERROR_KINDS.OFFLINE);
  if (timeout) return make(ERROR_KINDS.TIMEOUT);
  if (networkError) return make(ERROR_KINDS.NETWORK);

  const { code, text } = readBody(body);
  if (code === 2009) return make(ERROR_KINDS.NO_ROUTE, text);
  if (code === 2010) return make(ERROR_KINDS.POINT_NOT_FOUND, text);
  if (code === 2004) return make(ERROR_KINDS.TOO_FAR, text);

  if (status === 401 || status === 403) return make(ERROR_KINDS.INVALID_KEY, text);
  if (status === 429) return make(ERROR_KINDS.QUOTA, text);
  if (status === 404) return make(ERROR_KINDS.NO_ROUTE, text);
  if (status === 400 || code === 2003) return make(ERROR_KINDS.BAD_REQUEST, text);
  if (typeof status === 'number' && status >= 500) return make(ERROR_KINDS.SERVER, text);
  return make(ERROR_KINDS.UNKNOWN, text);
}

export function messageFor(kind) {
  return MESSAGES[kind] ?? MESSAGES.unknown;
}

/**
 * Courte explication technique d'un échec, pour aider au diagnostic (jamais la clé).
 * @param {{ kind?:string, status?:number, detail?:string }} err
 * @param {string} [apiKey] masquée si le serveur la renvoyait dans son message
 */
export function formatDiagnostic(err, apiKey = '') {
  let detail = String(err?.detail ?? '').replace(/\s+/g, ' ').trim();
  if (apiKey && apiKey.length >= 8) detail = detail.split(apiKey).join('•••');
  if (detail.length > 100) detail = `${detail.slice(0, 99)}…`;
  if (typeof err?.status === 'number' && err.status > 0) return detail ? `HTTP ${err.status} : ${detail}` : `HTTP ${err.status}`;
  if (err?.kind === ERROR_KINDS.NETWORK) return 'pas de réponse du serveur (réseau, ou requête bloquée par le navigateur)';
  if (err?.kind === ERROR_KINDS.TIMEOUT) return 'délai dépassé';
  if (err?.kind === ERROR_KINDS.OFFLINE) return 'appareil hors ligne';
  return detail || 'raison inconnue';
}

/**
 * Résultat du bouton « Tester » à partir des deux essais (itinéraire, recherche d'adresses).
 * Chaque essai vaut { ok:true } ou { ok:false, kind, status?, detail? }.
 * @returns {{ level:'ok'|'warn'|'err', saveKey:boolean, message:string }}
 */
export function summarizeKeyTest({ directions, geocode }, apiKey = '') {
  const d = directions ?? { ok: false, kind: ERROR_KINDS.UNKNOWN };
  const g = geocode ?? { ok: false, kind: ERROR_KINDS.UNKNOWN };
  if (d.ok && g.ok) {
    return { level: 'ok', saveKey: true, message: 'Clé valide ✔ : itinéraires et recherche d\'adresses fonctionnent.' };
  }
  if (d.ok) {
    return { level: 'warn', saveKey: true, message: `Clé valide pour les itinéraires ✔. La recherche d'adresses a échoué (${formatDiagnostic(g, apiKey)}).` };
  }
  if (d.kind === ERROR_KINDS.QUOTA) {
    return { level: 'warn', saveKey: true, message: 'Clé reconnue, mais quota dépassé pour aujourd\'hui.' };
  }
  if (g.ok) {
    return { level: 'warn', saveKey: true, message: `Recherche d'adresses OK, mais les itinéraires ont échoué (${formatDiagnostic(d, apiKey)}).` };
  }
  if (d.kind === ERROR_KINDS.INVALID_KEY) {
    return {
      level: 'err',
      saveKey: false,
      message: `Clé refusée par HeiGIT (${formatDiagnostic(d, apiKey)}). Vérifie qu'elle est copiée en entier, sans espace, depuis account.heigit.org (Dashboard).`,
    };
  }
  return { level: 'err', saveKey: false, message: `${messageFor(d.kind)} (${formatDiagnostic(d, apiKey)})` };
}
