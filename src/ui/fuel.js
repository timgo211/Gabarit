// Phase 4 — fiche « Carburant sur le trajet » (chargée à la demande par app.js, hors précache du service worker).
// Une requête vers data.economie.gouv.fr au toucher du bouton (jamais automatique), gardée en mémoire par itinéraire ;
// seules les zones du trajet (boîtes) sont envoyées. À l'arrêt seulement : app.js ferme la fiche dès que le véhicule
// roule (Code de la route art. R412-6-2). Rien n'est dit à voix haute. Textes en textContent.
import {
  FUEL, franceRanges, routeBoxes, fuelQueryUrl, parseStations, stationsAlongRoute, describeStation, tripFuelCost,
  filterStations, fetchErrorText,
} from '../lib/fuel-stations.js';

/**
 * @param {{ root:HTMLElement, getOk:()=>object[], onToggleOk:(station:object)=>void, isParked:()=>boolean,
 *   fetchImpl?:typeof fetch }} ctx
 */
export function createFuelPanel({ root, getOk, onToggleOk, isParked, fetchImpl = (...a) => fetch(...a) }) {
  const $ = (sel) => root.querySelector(sel);
  const ui = {
    status: $('#fuel-status'), note: $('#fuel-note'), filters: $('#fuel-filters'), hgv: $('#btn-fuel-hgv'),
    ok: $('#btn-fuel-ok'), cost: $('#fuel-cost'), list: $('#fuel-list'), close: $('#btn-fuel-close'),
  };
  const cache = new Map(); // clé d'itinéraire → stations (une requête par itinéraire)
  let st = null; // { key, route, vehicle, from, stations, selected }
  let hgvOnly = false;
  let okOnly = false;
  let ticket = 0;

  const okIds = () => new Set((getOk() ?? []).map((s) => s.id));

  function status(text) {
    ui.status.textContent = text;
    ui.status.hidden = !text;
  }

  function render() {
    if (!st?.stations) {
      ui.filters.hidden = true;
      ui.cost.hidden = true;
      ui.list.replaceChildren();
      return;
    }
    const ids = okIds();
    const all = stationsAlongRoute(st.stations, st.route, { from: st.from });
    const anyHgv = all.some((s) => s.hgv);
    ui.hgv.hidden = !anyHgv;
    ui.ok.hidden = ids.size === 0;
    if (!anyHgv) hgvOnly = false;
    if (!ids.size) okOnly = false;
    ui.hgv.setAttribute('aria-pressed', String(hgvOnly));
    ui.ok.setAttribute('aria-pressed', String(okOnly));
    ui.filters.hidden = ui.hgv.hidden && ui.ok.hidden;
    const list = filterStations(all, { hgvOnly, okOnly, okIds: ids });
    const notes = [];
    if (st.france === 'partly') notes.push(FUEL.PARTLY_TEXT);
    if (!all.length) notes.push(FUEL.NONE_TEXT);
    else if (!list.length) notes.push('Aucune station avec ces filtres.');
    status(notes.join(' '));
    const now = new Date();
    ui.list.replaceChildren(...list.map((s) => row(s, describeStation(s, { now }), ids.has(s.id))));
    const sel = list.find((s) => s.id === st.selected);
    if (sel) {
      ui.cost.textContent = tripFuelCost(st.route, st.vehicle, sel.price).text;
      ui.cost.hidden = false;
    } else {
      ui.cost.hidden = true;
    }
  }

  function row(s, d, ok) {
    const li = document.createElement('li');
    li.className = `fuel-row${d.old ? ' old' : ''}${s.id === st.selected ? ' selected' : ''}`;
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'fuel-pick';
    pick.setAttribute('aria-pressed', String(s.id === st.selected));
    const top = document.createElement('span');
    top.className = 'fuel-top';
    const price = document.createElement('span');
    price.className = 'fuel-price';
    price.textContent = d.price;
    top.append(price);
    for (const [on, label, cls] of [[d.hgv, 'Piste PL', 'hgv'], [ok, 'OK camion', 'ok'], [d.old, 'ancien', 'old']]) {
      if (!on) continue;
      const b = document.createElement('span');
      b.className = `fuel-badge ${cls}`;
      b.textContent = label;
      top.append(b);
    }
    const place = document.createElement('span');
    place.className = 'fuel-place';
    place.textContent = d.place;
    const facts = document.createElement('span');
    facts.className = 'fuel-facts';
    facts.textContent = `${d.where} · ${d.detour}`;
    const upd = document.createElement('span');
    upd.className = 'fuel-updated';
    upd.textContent = d.updated;
    pick.append(top, place, facts, upd);
    pick.addEventListener('click', () => {
      if (!isParked()) { status(FUEL.PARKED_TEXT); return; }
      st.selected = st.selected === s.id ? null : s.id;
      render();
    });
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'btn fuel-star';
    star.setAttribute('aria-pressed', String(ok));
    star.setAttribute('aria-label', ok ? 'Retirer de mes stations OK camion' : 'Ajouter à mes stations OK camion');
    star.textContent = ok ? '★' : '☆';
    star.addEventListener('click', () => {
      if (!isParked()) { status(FUEL.PARKED_TEXT); return; }
      onToggleOk(s);
      render();
    });
    li.append(pick, star);
    return li;
  }

  async function load(my) {
    const boxes = routeBoxes(st.route);
    if (!boxes.length) { status(FUEL.FRANCE_ONLY_TEXT); return; }
    if (cache.has(st.key)) { st.stations = cache.get(st.key); render(); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { status(FUEL.OFFLINE_TEXT); return; }
    status('Recherche des stations sur le trajet…');
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), FUEL.TIMEOUT_MS);
    try {
      const res = await fetchImpl(fuelQueryUrl(boxes), { signal: ctrl?.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const stations = parseStations(await res.json());
      if (!stations) throw new Error('réponse illisible');
      if (my !== ticket || !st) return;
      cache.set(st.key, stations);
      st.stations = stations;
      render();
    } catch (err) {
      if (my !== ticket || !st) return;
      status(fetchErrorText(err, typeof navigator === 'undefined' || navigator.onLine !== false));
    } finally {
      clearTimeout(timer);
    }
  }

  ui.hgv.addEventListener('click', () => { if (!isParked()) { status(FUEL.PARKED_TEXT); return; } hgvOnly = !hgvOnly; render(); });
  ui.ok.addEventListener('click', () => { if (!isParked()) { status(FUEL.PARKED_TEXT); return; } okOnly = !okOnly; render(); });
  ui.close.addEventListener('click', () => api.close());
  ui.note.textContent = `${FUEL.NOTE_TEXT} ${FUEL.SOURCE_TEXT}`;

  const api = {
    /** Ouvre la fiche pour un itinéraire (from : position en guidage → stations devant seulement). */
    open({ key, route, vehicle, from = null }) {
      const my = ++ticket;
      st = { key, route, vehicle, from, stations: null, selected: null, france: franceRanges(route).france };
      root.hidden = false;
      render();
      load(my);
    },
    close() {
      ticket += 1;
      st = null;
      root.hidden = true;
      ui.list.replaceChildren();
      status('');
    },
    get isOpen() { return !root.hidden; },
  };
  return api;
}
