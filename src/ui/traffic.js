// Trafic (phase 10 A, v88) — fiche « Trafic sur le trajet », à l'arrêt seulement (app.js la ferme dès que le véhicule
// roule : Code de la route art. R412-6-2). Une seule requête au toucher (le fichier national, sans paramètre : aucune
// position envoyée), jamais automatique ; copie gardée en mémoire de la page seulement (rien sur le disque, jamais dans
// le cache du service worker). Hors ligne ou erreur : message, rien d'autre. Textes de la source en textContent.
// Rien dans le guidage, rien à voix haute, aucun effet sur le calcul.
import { TRAFFIC_URL } from '../lib/config.js';
import { TRAFFIC, KIND_GLYPHS, KIND_LABELS, eventsNearRoute, isOld, itemTexts, parseTrafficJson, sourceText } from '../lib/traffic.js';

/**
 * @param {{ root:HTMLElement, isParked:()=>boolean, onShow:(marks:object[])=>void, onZoom:(lonlat:number[])=>void,
 *   onData?:(data:object)=>void, fetchImpl?:typeof fetch, now?:()=>number }} ctx
 */
export function createTrafficPanel({ root, isParked, onShow, onZoom, onData = null, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
  const $ = (sel) => root.querySelector(sel);
  const ui = {
    source: $('#traffic-source'), old: $('#traffic-old'), coverage: $('#traffic-coverage'), status: $('#traffic-status'),
    list: $('#traffic-list'), close: $('#btn-traffic-close'),
  };
  let data = null;   // dernier fichier lu (mémoire de la page seulement)
  let route = null;
  let items = [];
  let ticket = 0;
  let ctrl = null;

  function status(text) {
    ui.status.textContent = text;
    ui.status.hidden = !text;
  }

  function row(item, t) {
    const li = document.createElement('li');
    li.className = `traffic-row kind-${item.ev.k}`;
    li.dataset.id = item.ev.id;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'traffic-pick';
    const title = document.createElement('span');
    title.className = 'traffic-title';
    title.textContent = t.title;
    const facts = document.createElement('span');
    facts.className = 'traffic-facts';
    facts.textContent = t.facts;
    const dates = document.createElement('span');
    dates.className = 'traffic-dates';
    dates.textContent = t.dates;
    b.append(title, facts, dates);
    if (t.comment) {
      const c = document.createElement('span');
      c.className = 'traffic-comment';
      c.textContent = t.comment; // texte de la source : jamais innerHTML
      b.append(c);
    }
    b.addEventListener('click', () => {
      select(item.ev.id);
      onZoom?.(item.point);
    });
    li.append(b);
    return li;
  }

  function select(id) {
    for (const li of ui.list.children) li.classList.toggle('selected', li.dataset.id === id);
  }

  function render() {
    if (!data || !route) return;
    const t0 = now();
    const res = eventsNearRoute(data.events, route.coordinates, { now: t0 });
    items = res.items;
    ui.source.textContent = sourceText(data.publication, t0);
    ui.source.hidden = false;
    ui.old.hidden = !isOld(data.publication, t0);
    ui.coverage.hidden = false;
    status(items.length ? '' : TRAFFIC.EMPTY_TEXT);
    ui.list.replaceChildren(...items.map((it) => row(it, itemTexts(it, t0))));
    onShow?.(items.map((it) => ({
      key: it.ev.id, lonlat: it.point, glyph: KIND_GLYPHS[it.ev.k], kind: it.ev.k,
      label: `${KIND_LABELS[it.ev.k]} à vérifier (Bison Futé)${it.approx ? `, ${TRAFFIC.APPROX_TEXT}` : ''}`,
    })));
  }

  function reset() {
    items = [];
    ui.list.replaceChildren();
    ui.source.hidden = true;
    ui.old.hidden = true;
    onShow?.([]);
  }

  async function load() {
    const t = ++ticket;
    ctrl?.abort();
    ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    status(TRAFFIC.LOADING_TEXT);
    let text;
    try {
      const res = await fetchImpl(TRAFFIC_URL, {
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctrl?.signal,
        headers: { Accept: 'application/json, text/plain' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers?.get?.('content-length'));
      if (Number.isFinite(len) && len > TRAFFIC.MAX_BYTES) throw new Error('taille');
      text = await res.text();
    } catch (err) {
      if (t !== ticket) return;
      const offline = err?.name === 'TypeError' || (typeof navigator !== 'undefined' && navigator.onLine === false);
      status(offline ? TRAFFIC.OFFLINE_TEXT : TRAFFIC.ERROR_TEXT);
      return;
    }
    if (t !== ticket || root.hidden) return;
    const parsed = parseTrafficJson(text);
    if (!parsed.ok) { status(TRAFFIC.ERROR_TEXT); return; }
    data = parsed;
    onData?.(data);
    render();
  }

  ui.close.addEventListener('click', () => api.close());

  const api = {
    /** Ouvre la fiche et lit le fichier national (une requête). Refusé hors de l'arrêt. */
    open({ route: r }) {
      if (!isParked() || !r?.coordinates) return false;
      route = r;
      root.hidden = false;
      reset();
      ui.coverage.textContent = TRAFFIC.COVERAGE_TEXT;
      load();
      return true;
    },
    /** Autre itinéraire choisi pendant que la fiche est ouverte : nouveau tri sur la copie en mémoire, sans requête. */
    setRoute(r) {
      if (root.hidden || !r?.coordinates) return;
      route = r;
      render();
    },
    /** Repère touché sur la carte : ligne mise en avant. */
    focus(id) {
      select(id);
      [...ui.list.children].find((li) => li.dataset.id === id)?.scrollIntoView?.({ block: 'nearest' });
    },
    close() {
      if (root.hidden) return;
      ticket += 1;
      ctrl?.abort();
      root.hidden = true;
      reset();
      status('');
    },
    get isOpen() { return !root.hidden; },
    get count() { return items.length; },
  };
  return api;
}
