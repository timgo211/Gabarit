// Traduction des échecs ORS / Pelias / réseau en messages clairs pour la cabine. Logique pure.
// Codes d'erreur ORS directions : 2003 paramètre invalide, 2004 distance trop grande,
// 2009 itinéraire introuvable, 2010 point introuvable, 2099 inconnue.
// Limites du service gratuit (https://openrouteservice.org/plans/ , FAQ HeiGIT) : quota du jour dépassé → HTTP 403,
// limite par minute dépassée → HTTP 429. Un 403 peut donc venir d'une clé refusée OU du quota du jour.

export const ERROR_KINDS = {
  NO_KEY: 'no-key',
  INVALID_KEY: 'invalid-key',
  QUOTA: 'quota', // 429 : limite par minute
  DAILY_QUOTA: 'daily-quota', // 403 dont le message parle de quota ou de limite
  KEY_OR_QUOTA: 'key-or-quota', // 403 au message ambigu
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
  quota: 'Trop de demandes en une minute (limite OpenRouteService). Réessaie dans une minute.',
  'daily-quota': 'Quota du jour atteint. Le quota gratuit OpenRouteService se renouvelle 24 h après la première demande : réessaie plus tard.',
  'key-or-quota': 'Clé refusée ou quota du jour atteint. Vérifie la clé dans Réglages (bouton « Tester »), ou réessaie plus tard.',
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

/** Quota/limite cités → quota du jour ; clé clairement mise en cause → clé refusée ; sinon ambigu. */
export function classify403(text) {
  const t = String(text ?? '');
  if (/quota|limit/i.test(t)) return ERROR_KINDS.DAILY_QUOTA;
  if (/\b(invalid|unknown|wrong|incorrect)\b.{0,12}\b(api[\s_-]?)?key\b|\bkey\b.{0,12}\b(invalid|unknown)\b/i.test(t)) {
    return ERROR_KINDS.INVALID_KEY;
  }
  return ERROR_KINDS.KEY_OR_QUOTA;
}

/**
 * @param {{ status?:number, body?:any, offline?:boolean, networkError?:boolean, timeout?:boolean, noKey?:boolean }} p
 * @returns {{ kind:string, message:string, detail:string }}
 */
export function classifyError({ status, body, offline = false, networkError = false, timeout = false, noKey = false } = {}) {
  const make = (kind, detail = '') => ({ kind, message: MESSAGES[kind], detail, code: readBody(body).code });
  if (noKey) return make(ERROR_KINDS.NO_KEY);
  if (offline) return make(ERROR_KINDS.OFFLINE);
  if (timeout) return make(ERROR_KINDS.TIMEOUT);
  if (networkError) return make(ERROR_KINDS.NETWORK);

  const { code, text } = readBody(body);
  if (code === 2009) return make(ERROR_KINDS.NO_ROUTE, text);
  if (code === 2010) return make(ERROR_KINDS.POINT_NOT_FOUND, text);
  if (code === 2004) return make(ERROR_KINDS.TOO_FAR, text);

  if (status === 401) return make(ERROR_KINDS.INVALID_KEY, text);
  if (status === 403) return make(classify403(text), text);
  if (status === 429) return make(ERROR_KINDS.QUOTA, text);
  if (status === 404) return make(ERROR_KINDS.NO_ROUTE, text);
  if (status === 400 || code === 2003) return make(ERROR_KINDS.BAD_REQUEST, text);
  if (typeof status === 'number' && status >= 500) return make(ERROR_KINDS.SERVER, text);
  return make(ERROR_KINDS.UNKNOWN, text);
}

/**
 * Ligne technique sous le message d'échec (phase 5h bis) : statut HTTP, code et message renvoyés par le service
 * d'itinéraire, pour distinguer un itinéraire introuvable (2009), un point non routable (2010), une distance trop
 * grande (2004) ou un quota (429). Jamais la clé. Rien si aucun statut ni code (réseau, hors ligne).
 * @param {{ status?:number|null, code?:number|null, detail?:string }} err
 */
export function serviceDetailText(err, apiKey = '') {
  const parts = [];
  if (typeof err?.status === 'number' && err.status > 0) parts.push(`HTTP ${err.status}`);
  if (typeof err?.code === 'number' && err.code > 0) parts.push(`code ${err.code}`);
  if (!parts.length) return '';
  let detail = String(err?.detail ?? '').replace(/\s+/g, ' ').trim();
  if (apiKey && apiKey.length >= 8) detail = detail.split(apiKey).join('•••');
  if (detail.length > 160) detail = `${detail.slice(0, 159)}…`;
  // Phase 2f : diagnostic d'un code 2009 interrompu (quota, réseau) : dit pourquoi aucune précision n'est donnée.
  const note = typeof err?.diagnosticNote === 'string' && err.diagnosticNote ? ` ${err.diagnosticNote}` : '';
  return `Réponse du service d'itinéraire : ${parts.join(', ')}${detail ? ` — « ${detail} »` : ''}.${note}`;
}

/**
 * Tronçon en échec d'un code 2009 (phase 2f) : ORS calcule les tronçons dans l'ordre et s'arrête au premier
 * impossible, en le nommant « Unable to find a route between points i (…) and i+1 (…) », points comptés à partir
 * de 1 (ors-engine/src/main/java/org/heigit/ors/routing/RoutingRequest.java, boucle sur les tronçons).
 * @returns {number|null} numéro du premier point du tronçon (1 = départ → 1er point de passage), null si illisible
 */
export function failedSegment(text) {
  const m = /between points (\d+)\b.*?\band (\d+)\b/i.exec(String(text ?? ''));
  if (!m) return null;
  const a = Number(m[1]);
  return Number(m[2]) === a + 1 && a >= 1 ? a : null;
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
  if (d.kind === ERROR_KINDS.DAILY_QUOTA) {
    return { level: 'warn', saveKey: true, message: 'Clé reconnue, mais quota du jour atteint : réessaie plus tard.' };
  }
  if (d.kind === ERROR_KINDS.QUOTA) {
    return { level: 'warn', saveKey: true, message: 'Clé reconnue, mais trop de demandes en une minute : réessaie dans une minute.' };
  }
  if (g.ok) {
    return { level: 'warn', saveKey: true, message: `Recherche d'adresses OK, mais les itinéraires ont échoué (${formatDiagnostic(d, apiKey)}).` };
  }
  if (d.kind === ERROR_KINDS.KEY_OR_QUOTA) {
    return {
      level: 'err',
      saveKey: false,
      message: `Clé refusée ou quota du jour atteint (${formatDiagnostic(d, apiKey)}). Vérifie la clé (copiée en entier, sans espace, depuis account.heigit.org), ou réessaie plus tard.`,
    };
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
