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

/**
 * Demande la version au service worker `controller` (navigator.serviceWorker.controller) par un MessageChannel ;
 * résout le texte de la ligne (versionLabel), « version inconnue » sans contrôleur, sans réponse dans `timeoutMs` ou
 * en cas d'erreur. Jamais rejetée. Utilisée par Réglages et par le diagnostic du trajet (phase 5h ter : le diagnostic
 * lisait #app-version, rempli seulement à l'ouverture de Réglages → « Gabarit, version inconnue »).
 */
export function requestVersionLabel(controller, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (!controller || typeof controller.postMessage !== 'function' || typeof MessageChannel !== 'function') {
      resolve(UNKNOWN_VERSION_TEXT);
      return;
    }
    const channel = new MessageChannel();
    let timer = null;
    const done = (label) => {
      clearTimeout(timer);
      channel.port1.onmessage = null;
      channel.port1.close();
      resolve(label);
    };
    timer = setTimeout(() => done(UNKNOWN_VERSION_TEXT), timeoutMs);
    channel.port1.onmessage = (e) => done(versionLabel(e.data));
    try {
      controller.postMessage({ type: VERSION_REQUEST }, [channel.port2]);
    } catch {
      done(UNKNOWN_VERSION_TEXT);
    }
  });
}
