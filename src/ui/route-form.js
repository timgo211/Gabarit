// Formulaire départ / arrivée avec autocomplétion, position GPS et options d'évitement.

import { $, el } from './dom.js';
import { fetchSuggestions } from './api.js';
import { createSuggester, suggestionRows, SUGGEST } from '../lib/suggest.js';
import { resolvePlace, RESOLVE } from '../lib/place-resolve.js';
import { createGeocodeBudget, createTextCache } from '../lib/geocode-quota.js';
import { STOPS, moveStop, removeStop } from '../lib/stops.js';
import { RECENT, createRecentStore } from '../lib/recent-places.js';

// v62 : budget de géocodage (compteur du jour en localStorage, minute en mémoire) et cache des 20 derniers textes
// (mémoire seulement), partagés par tous les champs.
function safeStorage() {
  try { return window.localStorage; } catch { return null; }
}
const geocodeBudget = createGeocodeBudget({ storage: safeStorage(), now: () => Date.now() });
const textCache = createTextCache();
/**
 * v63 : recherches récentes, une seule liste pour tous les champs (clé localStorage à part, jamais bloquante :
 * src/lib/recent-places.js). Réglages (effacer) et export / import passent par cet objet.
 */
export const recentPlaces = createRecentStore(safeStorage());
/** Appels de géocodage du jour (contrôle d'ui-check, chiffre de la PR). */
export const geocodeCount = (kind) => geocodeBudget.count(kind);

// Listes ouvertes : fermées au toucher hors du champ et de la liste (un seul écouteur pour tous les champs).
const openLists = new Set();
document.addEventListener('pointerdown', (e) => {
  for (const o of [...openLists]) {
    if (!o.input.isConnected) { openLists.delete(o); continue; }
    if (!o.input.contains(e.target) && !o.list.contains(e.target)) o.close();
  }
}, true);

/**
 * Hauteur de la liste : jusqu'au bas de la partie visible de l'écran (clavier ouvert compris, iPhone : visualViewport),
 * 8 px de marge, ✕ et 2 lignes au moins ; sans visualViewport : 50vh (CSS).
 */
function fitList(o) {
  const vv = window.visualViewport;
  if (!vv || o.list.hidden) return;
  const top = o.list.getBoundingClientRect().top;
  const bottom = vv.offsetTop + vv.height;
  o.list.style.maxHeight = `${Math.max(2 * 48 + 48, Math.floor(bottom - top - 8))}px`;
}
/**
 * Clavier ouvert (Android et iPhone ne réduisent que la partie visible, visualViewport) pendant une saisie dans le
 * panneau de préparation : classe `kbd-open` sur .app, hauteur = partie visible (--vvh) ; en portrait la carte cède sa
 * place au panneau (styles.css) : le champ et sa liste restent au-dessus du clavier.
 */
function keyboardState() {
  const vv = window.visualViewport;
  const app = document.querySelector('.app');
  if (!vv || !app) return;
  const active = document.activeElement;
  const typing = active?.tagName === 'INPUT' && !!active.closest('.panel') && !app.classList.contains('navigating');
  const open = typing && vv.height < window.innerHeight - 120;
  const was = app.classList.contains('kbd-open');
  app.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
  app.classList.toggle('kbd-open', open);
  if (open && vv.offsetTop > 0) window.scrollTo(0, 0);
  if (open !== was) {
    window.dispatchEvent(new Event('resize')); // carte recadrée sur sa nouvelle taille (app.js)
    if (open) active.scrollIntoView({ block: 'start' });
  }
  for (const o of openLists) fitList(o);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', keyboardState);
  window.visualViewport.addEventListener('scroll', keyboardState);
  document.addEventListener('focusin', () => setTimeout(keyboardState, 50));
  document.addEventListener('focusout', () => setTimeout(keyboardState, 50));
}

/**
 * Liste déroulante de suggestions attachée à un champ : un seul composant pour départ, arrivée, étapes et « Ajouter une
 * étape » du guidage (v55). v62 : 400 ms, 5 lignes (nom + commune et pays en gris, 48 px au moins), « Aucun résultat »,
 * « Pas de connexion », ✕, fermeture au choix, au ✕ et au toucher dehors, visible clavier ouvert.
 * v63 : recherches récentes en tête (titre gris, ✕ par ligne), au focus d'un champ vide et en tapant (filtre local) ;
 * enregistrées seulement au choix dans la liste.
 * Renvoie { resolve(what) } : texte validé sans choix → recherche (place-resolve.js).
 */
export function attachAutocomplete(input, list, { getApiKey, getFocus, onPick, onError, onEdit }) {
  let items = [];
  let recent = [];
  let rows = [];
  let last = { status: 'idle', items: [] };
  const self = { input, list, close };

  function close() {
    list.hidden = true;
    list.replaceChildren();
    list.style.maxHeight = '';
    input.setAttribute('aria-expanded', 'false');
    openLists.delete(self);
  }

  const keep = (e) => { e.preventDefault(); }; // le champ garde le focus (clavier ouvert)

  function recentRow(r, i) {
    const p = recent[r.index];
    return el('li', {
      role: 'option', id: `${list.id}-${i}`, class: 'suggest-row suggest-recent',
      onpointerdown: keep,
      onclick: (e) => { e.preventDefault(); pickRecent(r.index); },
    }, [
      el('span', { class: 'suggest-text' }, [
        el('span', { class: 'suggest-name', text: r.text }),
        r.sub ? el('span', { class: 'suggest-sub', text: r.sub }) : null,
      ]),
      el('button', {
        type: 'button', class: 'suggest-remove', 'aria-label': RECENT.REMOVE_LABEL(r.text), text: '✕',
        onpointerdown: keep,
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); recentPlaces.remove(p); show(last.status, last.items); },
      }),
    ]);
  }

  function show(status, list2 = []) {
    last = { status, items: list2 };
    items = status === 'results' ? list2 : [];
    // v63 : récents qui correspondent au texte (tous les 5 derniers si le champ est vide), sans appel réseau.
    recent = recentPlaces.match(input.value);
    rows = suggestionRows({ status, items, recent });
    if (!rows.length) { close(); return; }
    const closeBtn = el('li', { class: 'suggest-head', role: 'presentation' }, [
      el('button', {
        type: 'button', class: 'suggest-close', 'aria-label': SUGGEST.CLOSE_LABEL, text: '✕',
        onpointerdown: keep,
        onclick: (e) => { e.preventDefault(); suggester.cancel(); close(); },
      }),
    ]);
    list.replaceChildren(closeBtn, ...rows.map((r, i) => {
      if (r.kind === 'title') return el('li', { role: 'presentation', class: 'suggest-title', text: r.text });
      if (r.kind === 'recent') return recentRow(r, i);
      if (r.kind === 'place') {
        return el('li', {
          role: 'option', id: `${list.id}-${i}`, class: 'suggest-row',
          onpointerdown: keep,
          onclick: (e) => { e.preventDefault(); pick(r.index); },
        }, [
          el('span', { class: 'suggest-name', text: r.text }),
          r.sub ? el('span', { class: 'suggest-sub', text: r.sub }) : null,
        ]);
      }
      return el('li', { role: 'option', 'aria-disabled': 'true', class: 'suggest-info', text: r.text });
    }));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    openLists.add(self);
    fitList(self);
  }

  /** Lieu choisi dans la liste : seul cas où il entre dans les recherches récentes (jamais le texte tapé). */
  function choose(s) {
    input.value = s.label;
    suggester.cancel();
    close();
    recentPlaces.add(s);
    onPick(s);
  }
  function pick(i) {
    if (items[i]) choose(items[i]);
  }
  function pickRecent(i) {
    const p = recent[i];
    if (p) choose({ label: p.label, name: p.name, place: p.place, lon: p.lon, lat: p.lat });
  }

  const search = (text, signal) => fetchSuggestions({ apiKey: getApiKey(), text, focus: getFocus(), signal });
  const suggester = createSuggester({
    search,
    budget: geocodeBudget,
    cache: textCache,
    onState: ({ status, items: found }) => show(status, found),
    onError: (err) => onError(err),
    isOnline: () => navigator.onLine !== false,
  });

  input.addEventListener('input', () => {
    // Toute saisie oublie le point choisi (suggestion, lien reçu ou appui long sur la carte, avec son repère).
    onPick(null);
    onEdit?.();
    // Liste remplacée tout de suite : aucune ancienne suggestion à toucher pendant la recherche (src/lib/coords.js).
    suggester.input(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !list.hidden) {
      const first = rows.find((r) => r.kind === 'recent' || r.kind === 'place');
      if (first) { e.preventDefault(); if (first.kind === 'recent') pickRecent(first.index); else pick(first.index); }
    }
    if (e.key === 'Escape') { suggester.cancel(); close(); }
  });
  // Clavier ouvert : le champ remonte en haut du panneau, la liste garde la place visible dessous.
  input.addEventListener('focus', () => {
    // v63 : champ vide → « Recherches récentes » (aucun appel).
    if (!input.value.trim() && list.hidden) show('idle');
    setTimeout(() => {
      if (document.activeElement !== input) return;
      input.scrollIntoView({ block: 'start', behavior: 'smooth' });
      fitList(self);
    }, 300);
  });

  return {
    /**
     * Texte validé sans choix (v62) : coordonnées ou une recherche /search. Résout le lieu pris, ou null (liste ouverte
     * avec plusieurs lieux, « Aucun résultat », « Pas de connexion », quota : message donné par onError).
     * @param {string} what « l'arrivée », « le départ », « l'étape 2 »
     */
    async resolve(what) {
      const r = await resolvePlace(input.value, {
        search: (text) => fetchSuggestions({ apiKey: getApiKey(), text, focus: getFocus(), endpoint: 'search' }),
        budget: geocodeBudget,
        isOnline: () => navigator.onLine !== false,
      });
      if (r.kind === 'picked') {
        input.value = r.item.label;
        close();
        onPick(r.item);
        return r.item;
      }
      if (r.kind === 'choose') { show('results', r.items); onError(RESOLVE.CHOOSE_TEXT(what)); input.focus(); }
      else if (r.kind === 'none') { show('empty'); onError(RESOLVE.NONE_TEXT(what.charAt(0).toUpperCase() + what.slice(1))); }
      else if (r.kind === 'offline') { show('offline'); onError(SUGGEST.OFFLINE_TEXT + '.'); }
      else if (r.kind === 'quota') onError(RESOLVE.QUOTA_TEXT);
      else if (r.kind === 'error') onError(r.error);
      return null;
    },
  };
}

/**
 * @param {{ getApiKey:()=>string, onPosition:(lonlat)=>void, onSubmit:(p)=>void, onError:(err|null|string)=>void,
 *   initial:{avoidTolls:boolean, avoidFerries:boolean}, onOptionsChange:(o)=>void,
 *   onEdit?:(which:'from'|'to')=>void }} opts  onEdit : le champ a été modifié (le point choisi est oublié)
 */
export function createRouteForm(opts) {
  const form = $('#route-form');
  const fromInput = $('#from-input');
  const toInput = $('#to-input');
  const avoidTolls = $('#avoid-tolls');
  const avoidFerries = $('#avoid-ferries');
  let myPosition = null; // [lon, lat]
  let from = null; // { label, lon, lat } ou null = ma position
  let to = null;
  /** v55 : étapes { place:{label,lon,lat}|null, text:string } dans l'ordre (10 au plus). */
  let stops = [];
  const stopsList = $('#stops-list');
  const addStopBtn = $('#btn-add-stop');

  avoidTolls.checked = !!opts.initial.avoidTolls;
  avoidFerries.checked = !!opts.initial.avoidFerries;
  const optionsChanged = () => opts.onOptionsChange({ avoidTolls: avoidTolls.checked, avoidFerries: avoidFerries.checked });
  avoidTolls.addEventListener('change', optionsChanged);
  avoidFerries.addEventListener('change', optionsChanged);

  const common = { getApiKey: opts.getApiKey, getFocus: () => myPosition, onError: opts.onError };
  const fromAc = attachAutocomplete(fromInput, $('#from-list'), { ...common, onPick: (s) => { from = s; }, onEdit: () => opts.onEdit?.('from') });
  const toAc = attachAutocomplete(toInput, $('#to-list'), { ...common, onPick: (s) => { to = s; }, onEdit: () => opts.onEdit?.('to') });
  /** v62 : composant de chaque champ d'étape (même ordre que stops), pour résoudre un texte validé sans choix. */
  let stopAcs = [];

  /** Lignes des étapes : champ avec la même recherche que l'arrivée, ↑ ↓ ✕ (48 px). Redessinées à chaque changement. */
  function renderStops() {
    stopAcs = [];
    stopsList.replaceChildren(...stops.map((st, i) => {
      const id = `stop-input-${i}`;
      const input = el('input', {
        id, type: 'search', placeholder: 'Ville, adresse, entreprise…', enterkeyhint: 'next', role: 'combobox',
        'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': `stop-list-${i}`, class: 'stop-input',
      });
      input.value = st.place ? st.place.label : st.text;
      const list = el('ul', { id: `stop-list-${i}`, class: 'suggestions', role: 'listbox', hidden: true });
      stopAcs[i] = attachAutocomplete(input, list, {
        ...common,
        onPick: (place) => { stops[i] = { place, text: input.value }; },
      });
      input.addEventListener('input', () => { stops[i] = { place: null, text: input.value }; });
      const btn = (text, label, onclick, disabled = false) => el('button', {
        type: 'button', class: 'btn btn-stop', text, 'aria-label': label, onclick, disabled: disabled || null,
      });
      return el('li', { class: 'stop-row' }, [
        el('label', { for: id, text: `Étape ${i + 1}` }),
        el('div', { class: 'combo' }, [
          input,
          btn('↑', `Monter l'étape ${i + 1}`, () => { stops = moveStop(stops, i, -1); renderStops(); }, i === 0),
          btn('↓', `Descendre l'étape ${i + 1}`, () => { stops = moveStop(stops, i, 1); renderStops(); }, i === stops.length - 1),
          btn('✕', `Retirer l'étape ${i + 1}`, () => { stops = removeStop(stops, i); renderStops(); }),
        ]),
        list,
      ]);
    }));
    addStopBtn.disabled = stops.length >= STOPS.MAX;
    addStopBtn.textContent = stops.length >= STOPS.MAX ? STOPS.FULL_TEXT : '+ Ajouter une étape';
  }
  addStopBtn.addEventListener('click', () => {
    if (stops.length >= STOPS.MAX) return;
    stops = [...stops, { place: null, text: '' }];
    renderStops();
    stopsList.querySelector(`#stop-input-${stops.length - 1}`)?.focus();
  });

  /** Demande la position GPS ; résout [lon, lat] ou rejette avec un message en français. */
  function locate() {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) { reject(new Error('GPS indisponible sur cet appareil.')); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          myPosition = [pos.coords.longitude, pos.coords.latitude];
          opts.onPosition(myPosition);
          resolve(myPosition);
        },
        (err) => {
          const msg = err.code === 1
            ? 'Accès à la position refusé. Autorise la localisation pour Gabarit dans les réglages du navigateur, ou saisis un départ.'
            : 'Position GPS introuvable. Vérifie que la localisation est activée, ou saisis un départ.';
          reject(new Error(msg));
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
      );
    });
  }

  $('#btn-gps').addEventListener('click', async () => {
    fromInput.value = '';
    from = null;
    opts.onEdit?.('from');
    try {
      await locate();
      opts.onError(null);
    } catch (err) {
      opts.onError(err.message);
    }
  });

  let resolving = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (resolving) return;
    // v62 : un texte tapé sans choix dans la liste est cherché (une requête /search par champ, compteur à part) : un seul
    // lieu → pris ; plusieurs → liste ouverte ; jamais d'impasse quand les suggestions sont épuisées.
    resolving = true;
    try {
      if (fromInput.value.trim() && !from) await fromAc.resolve('le départ');
      if (fromInput.value.trim() && !from) return;
      for (let i = 0; i < stops.length; i += 1) {
        if (!stops[i].place && (stops[i].text ?? '').trim()) await stopAcs[i]?.resolve(`l'étape ${i + 1}`);
        if (!stops[i].place) {
          if (!(stops[i].text ?? '').trim()) opts.onError(`Choisis l'étape ${i + 1} dans la liste, ou retire-la (✕).`);
          return;
        }
      }
      if (!to && toInput.value.trim()) await toAc.resolve("l'arrivée");
    } finally {
      resolving = false;
    }
    if (!to) { if (!toInput.value.trim()) { opts.onError("Choisis l'arrivée dans la liste de suggestions."); toInput.focus(); } return; }
    let start;
    let fromLabel;
    if (from) {
      start = [from.lon, from.lat];
      fromLabel = from.label;
    } else {
      try {
        start = await locate();
        fromLabel = 'Ma position';
      } catch (err) {
        opts.onError(err.message);
        return;
      }
    }
    opts.onSubmit({
      start, end: [to.lon, to.lat], fromLabel, toLabel: to.label, startIsMyPosition: !from,
      avoidTolls: avoidTolls.checked, avoidFerries: avoidFerries.checked,
      stops: stops.map((st) => ({ label: st.place.label, lon: st.place.lon, lat: st.place.lat })),
    });
  });

  renderStops();
  // Position au démarrage (sans message si refusée : on le dira au calcul).
  locate().catch(() => {});

  return {
    /**
     * Pré-remplit le formulaire (lien de partage reçu, déjà validé par decodeRouteLink). Aucun calcul lancé.
     * from null : départ = ma position GPS. Les cases ne sont pas enregistrées dans les réglages.
     */
    prefill(shared) {
      from = shared.from ? { ...shared.from } : null;
      to = { ...shared.to };
      fromInput.value = from ? from.label : '';
      toInput.value = to.label;
      avoidTolls.checked = !!shared.avoidTolls;
      avoidFerries.checked = !!shared.avoidFerries;
      stops = [];
      renderStops();
    },
    /** Départ ou arrivée choisi sur la carte (appui long). Aucun calcul lancé. */
    setPlace(which, place) {
      if (which === 'from') {
        from = { ...place };
        fromInput.value = place.label;
      } else {
        to = { ...place };
        toInput.value = place.label;
      }
    },
    /** v55 : étapes choisies (reprise d'un itinéraire, étape ajoutée depuis la fiche carburant). */
    setStops(list) {
      stops = (Array.isArray(list) ? list : []).slice(0, STOPS.MAX).map((p) => ({ place: { ...p }, text: p.label }));
      renderStops();
    },
    /** Étapes choisies, dans l'ordre ({ label, lon, lat } ; lignes non choisies ignorées). */
    getStops() {
      return stops.filter((st) => st.place).map((st) => ({ ...st.place }));
    },
    setBusy(busy) {
      const btn = $('#btn-route');
      btn.disabled = busy;
      btn.textContent = busy ? 'Calcul en cours…' : "Calculer l'itinéraire";
    },
  };
}
