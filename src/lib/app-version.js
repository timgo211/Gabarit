// Version de l'appli affichée en bas de Réglages. Source unique : VERSION dans sw.js.
// La page demande la version au service worker qui la contrôle (celui qui sert réellement l'appli) ; une nouvelle
// version en attente n'est donc pas affichée avant d'être activée. Sans service worker actif (première ouverture,
// navigateur sans service worker) ou sans réponse : « version inconnue », jamais « undefined ».

export const VERSION_REQUEST = 'GET_VERSION';
export const UNKNOWN_VERSION_TEXT = 'version inconnue';

/** Réponse du service worker à VERSION_REQUEST. */
export function versionReply(version) {
  return { type: 'VERSION', version };
}

/** Texte de la ligne : « Gabarit v » + numéro, ou « version inconnue » pour toute valeur absente ou inattendue. */
export function versionLabel(reply) {
  const v = reply && reply.type === 'VERSION' ? reply.version : null;
  return typeof v === 'string' && /^v\d+$/.test(v) ? `Gabarit ${v}` : UNKNOWN_VERSION_TEXT;
}
