// Fenêtre « Partager » (phase 7) : itinéraire (lien ou GPX), lieu (lien OpenStreetMap), appli (avec le guide
// d'installation pas à pas, phase 7c).
// Contenus et choix de la méthode : src/lib/share.js. Ici : Web Share API, presse-papiers, téléchargement.
// Ouverte à l'arrêt seulement (le bouton est dans la barre du haut, masquée pendant le guidage).

import { $, wireDialog } from './dom.js';
import {
  encodeRouteLink, buildGpx, gpxFileName, osmLink, appShareText, appBaseUrl, pickShareMethod, shareResultText,
  variantId, pickShareType, GPX_MIME, GPX_SHARE_TYPES, GPX_LINK_HINT, INSTALL_STEPS,
} from '../lib/share.js';

const isAbort = (err) => err?.name === 'AbortError'; // partage annulé par l'utilisateur

/**
 * @param {{ getChoice:()=>object|null, getMyPosition:()=>number[]|null }} p
 *   getChoice : itinéraires calculés ({ options, selected, start, end, fromLabel, toLabel, startIsMyPosition,
 *   avoidTolls, avoidFerries }) ou null.
 */
export function createShare({ getChoice, getMyPosition }) {
  const dlg = $('#dlg-share');
  wireDialog(dlg);
  const status = $('#share-status');
  const linkNode = $('#share-link');
  const includeStart = $('#share-include-start');
  const btn = {
    route: $('#btn-share-route'), gpx: $('#btn-share-gpx'), me: $('#btn-share-me'),
    from: $('#btn-share-from'), to: $('#btn-share-to'), app: $('#btn-share-app'),
  };

  function say(text, link = '') {
    status.textContent = text;
    linkNode.textContent = link; // jamais innerHTML
    linkNode.hidden = !link;
  }

  const baseUrl = () => appBaseUrl(window.location.href);
  $('#share-gpx-hint').textContent = GPX_LINK_HINT;
  $('#install-steps').replaceChildren(...INSTALL_STEPS.map((step) => {
    const li = document.createElement('li');
    li.textContent = step;
    return li;
  }));

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  /** Partage d'un lien : partage Android → copie → lien affiché. Appelé directement dans le geste (clic). */
  async function shareLink({ title, text, url, copyWithText = false }) {
    const copied = copyWithText ? `${text}\n${url}` : url;
    const method = pickShareMethod({
      kind: 'link', hasShare: typeof navigator.share === 'function', hasClipboard: !!navigator.clipboard?.writeText,
    });
    if (method === 'share') {
      try {
        await navigator.share({ title, text, url });
        say('');
        return;
      } catch (err) {
        if (isAbort(err)) { say(''); return; }
        // Partage refusé par le navigateur : on se rabat sur la copie.
      }
    }
    if (method !== 'show' && await copy(copied)) { say(shareResultText('copy'), copied); return; }
    say(shareResultText('show'), copied);
  }

  function download(name, content, mime) {
    const href = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  }

  /**
   * Partage d'un fichier : partage Android si le navigateur accepte l'un des types (`types`, dans l'ordre, nom
   * inchangé), sinon téléchargement (type `mime`). `gpx` : texte de repli propre au GPX.
   */
  async function shareFile({ name, content, mime, title, types = [mime], gpx = false }) {
    const fileOf = (type) => {
      try { return new File([content], name, { type }); } catch { return null; }
    };
    const files = new Map();
    const canShare = typeof navigator.canShare === 'function';
    const type = canShare ? pickShareType(types, (t) => {
      const f = fileOf(t);
      if (!f) return false;
      files.set(t, f);
      return navigator.canShare({ files: [f] });
    }) : null;
    const file = type ? files.get(type) : null;
    const method = pickShareMethod({
      kind: 'file', hasShare: typeof navigator.share === 'function', canShareFiles: !!file,
    });
    if (method === 'share') {
      try {
        await navigator.share({ files: [file], title });
        say('');
        return;
      } catch (err) {
        if (isAbort(err)) { say(''); return; }
      }
    }
    try {
      download(name, content, mime);
      say(shareResultText('download', { gpx }));
    } catch {
      say(shareResultText('download', { failed: true }));
    }
  }

  /** Champs de l'itinéraire choisi (liste blanche : ni clé ni véhicule). */
  function routeData(c) {
    const option = c.options[c.selected];
    return {
      start: c.start, end: c.end, fromLabel: c.fromLabel, toLabel: c.toLabel, startIsMyPosition: !!c.startIsMyPosition,
      includeStart: includeStart.checked, avoidTolls: !!c.avoidTolls, avoidFerries: !!c.avoidFerries,
      variant: variantId(option, c.selected), route: option.route,
    };
  }

  const guard = (fn) => () => {
    try {
      return fn();
    } catch (err) {
      say(err.message);
      return null;
    }
  };

  btn.route.addEventListener('click', guard(() => {
    const c = getChoice();
    if (!c) return null;
    const r = routeData(c);
    const url = encodeRouteLink(baseUrl(), r);
    return shareLink({ title: 'Itinéraire Gabarit', text: `Itinéraire poids lourd vers ${r.toLabel || 'l\'arrivée'} (Gabarit)`, url });
  }));

  btn.gpx.addEventListener('click', guard(() => {
    const c = getChoice();
    if (!c) return null;
    const r = routeData(c);
    return shareFile({ name: gpxFileName(r.toLabel), content: buildGpx(r), mime: GPX_MIME, types: GPX_SHARE_TYPES, gpx: true, title: 'Itinéraire Gabarit (GPX)' });
  }));

  const place = (getPoint, label) => guard(() => {
    const p = getPoint();
    if (!p) return null;
    return shareLink({ title: label, text: label, url: osmLink(p) });
  });
  btn.me.addEventListener('click', place(getMyPosition, 'Ma position'));
  btn.from.addEventListener('click', place(() => getChoice()?.start ?? null, 'Point de départ'));
  btn.to.addEventListener('click', place(() => getChoice()?.end ?? null, 'Arrivée'));

  btn.app.addEventListener('click', guard(() => shareLink({ title: 'Gabarit', text: appShareText(), url: baseUrl(), copyWithText: true })));

  function refresh() {
    const c = getChoice();
    const hasRoute = !!c?.options?.[c.selected];
    btn.route.disabled = !hasRoute;
    btn.gpx.disabled = !hasRoute;
    btn.from.disabled = !hasRoute;
    btn.to.disabled = !hasRoute;
    btn.me.disabled = !getMyPosition();
    $('#share-route-hint').textContent = hasRoute
      ? `Vers : ${c.toLabel || 'l\'arrivée'} (itinéraire choisi, avec ses options péages et ferries).`
      : 'Calcule d\'abord un itinéraire pour le partager.';
    const askStart = hasRoute && !!c.startIsMyPosition;
    $('#share-include-start-row').hidden = !askStart;
    $('#share-include-start-hint').hidden = !askStart;
  }

  $('#btn-share').addEventListener('click', () => {
    includeStart.checked = false; // décochée par défaut à chaque ouverture
    say('');
    refresh();
    dlg.showModal();
  });
}
