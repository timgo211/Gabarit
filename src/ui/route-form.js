// Formulaire départ / arrivée avec autocomplétion, position GPS et options d'évitement.

import { $, el } from './dom.js';
import { fetchSuggestions } from './api.js';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

/** Liste déroulante de suggestions attachée à un champ. */
function attachAutocomplete(input, list, { getApiKey, getFocus, onPick, onError }) {
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
    onPick(null);
    clearTimeout(timer);
    ctrl?.abort();
    const text = input.value.trim();
    if (text.length < MIN_CHARS) { close(); return; }
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
 *   initial:{avoidTolls:boolean, avoidFerries:boolean}, onOptionsChange:(o)=>void }} opts
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

  avoidTolls.checked = !!opts.initial.avoidTolls;
  avoidFerries.checked = !!opts.initial.avoidFerries;
  const optionsChanged = () => opts.onOptionsChange({ avoidTolls: avoidTolls.checked, avoidFerries: avoidFerries.checked });
  avoidTolls.addEventListener('change', optionsChanged);
  avoidFerries.addEventListener('change', optionsChanged);

  const common = { getApiKey: opts.getApiKey, getFocus: () => myPosition, onError: opts.onError };
  attachAutocomplete(fromInput, $('#from-list'), { ...common, onPick: (s) => { from = s; } });
  attachAutocomplete(toInput, $('#to-list'), { ...common, onPick: (s) => { to = s; } });

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
      start, end: [to.lon, to.lat], fromLabel, toLabel: to.label,
      avoidTolls: avoidTolls.checked, avoidFerries: avoidFerries.checked,
    });
  });

  // Position au démarrage (sans message si refusée : on le dira au calcul).
  locate().catch(() => {});

  return {
    setBusy(busy) {
      const btn = $('#btn-route');
      btn.disabled = busy;
      btn.textContent = busy ? 'Calcul en cours…' : "Calculer l'itinéraire";
    },
  };
}
