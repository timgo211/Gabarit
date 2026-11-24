// Formulaire départ / arrivée avec autocomplétion, position GPS et options d'évitement.

import { $, el } from './dom.js';
import { fetchSuggestions } from './api.js';
import { suggestionPlan } from '../lib/coords.js';
import { STOPS, moveStop, removeStop } from '../lib/stops.js';

const DEBOUNCE_MS = 300;

/** Liste déroulante de suggestions attachée à un champ (aussi « Ajouter une étape » du guidage, v55). */
export function attachAutocomplete(input, list, { getApiKey, getFocus, onPick, onError, onEdit }) {
  let timer = null;
  let ctrl = null;
  let items = [];

  function close() {
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
  }

  function render() {
    list.replaceChildren(...items.map((s, i) => el('li', {
      role: 'option', id: `${list.id}-${i}`, text: s.label,
      onpointerdown: (e) => { e.preventDefault(); pick(i); },
    })));
    list.hidden = items.length === 0;
    input.setAttribute('aria-expanded', String(!list.hidden));
  }

  function pick(i) {
    const s = items[i];
    if (!s) return;
    input.value = s.label;
    close();
    onPick(s);
  }

  input.addEventListener('input', () => {
    // Toute saisie oublie le point choisi (suggestion, lien reçu ou appui long sur la carte, avec son repère).
    onPick(null);
    onEdit?.();
    clearTimeout(timer);
    ctrl?.abort();
    // Liste remplacée tout de suite : aucune ancienne suggestion à toucher pendant la recherche (src/lib/coords.js).
    // Coordonnées GPS (phase 8) : proposées directement, sans appel au géocodage.
    const plan = suggestionPlan(input.value);
    items = plan.items;
    render();
    if (items.length) onError(null);
    if (!plan.search) return;
    const text = plan.search;
    timer = setTimeout(async () => {
      ctrl = new AbortController();
      try {
        items = await fetchSuggestions({ apiKey: getApiKey(), text, focus: getFocus(), signal: ctrl.signal });
        render();
        onError(null);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        close();
        onError(err);
      }
    }, DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !list.hidden && items.length) { e.preventDefault(); pick(0); }
    if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
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
  attachAutocomplete(fromInput, $('#from-list'), { ...common, onPick: (s) => { from = s; }, onEdit: () => opts.onEdit?.('from') });
  attachAutocomplete(toInput, $('#to-list'), { ...common, onPick: (s) => { to = s; }, onEdit: () => opts.onEdit?.('to') });

  /** Lignes des étapes : champ avec la même recherche que l'arrivée, ↑ ↓ ✕ (48 px). Redessinées à chaque changement. */
  function renderStops() {
    stopsList.replaceChildren(...stops.map((st, i) => {
      const id = `stop-input-${i}`;
      const input = el('input', {
        id, type: 'search', placeholder: 'Ville, adresse, entreprise…', enterkeyhint: 'next', role: 'combobox',
        'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': `stop-list-${i}`, class: 'stop-input',
      });
      input.value = st.place ? st.place.label : st.text;
      const list = el('ul', { id: `stop-list-${i}`, class: 'suggestions', role: 'listbox', hidden: true });
      attachAutocomplete(input, list, {
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!to) { opts.onError("Choisis l'arrivée dans la liste de suggestions."); toInput.focus(); return; }
    if (fromInput.value.trim() && !from) { opts.onError('Choisis le départ dans la liste, ou touche 📍 pour ta position.'); return; }
    const missing = stops.findIndex((st) => !st.place);
    if (missing >= 0) { opts.onError(`Choisis l'étape ${missing + 1} dans la liste, ou retire-la (✕).`); return; }
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
