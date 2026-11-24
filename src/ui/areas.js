// Aires et parkings PL du trajet (phases 9 et 9b) : copie OpenStreetMap data/aires-osm/ (cases de 1° que le tracé
// touche, placées sans requête réseau), Overpass en direct seulement pour les morceaux du tracé hors de la zone
// couverte (une requête, serveur de secours si le premier échoue), jeu officiel copié dans data/aires-pl.json, liste
// avant le départ, repères sur la carte, fiche d'une aire et « Mon avis ». Les décisions et les textes viennent de
// src/lib/areas-*.js ; ici, réseau et affichage.
//
// Le résultat d'Overpass est gardé sur l'appareil (src/lib/areas-cache.js, localStorage), jamais dans le cache du
// service worker (requête POST, ignorée par sw.js).

import { $, el, wireDialog } from './dom.js';
import { OVERPASS_ENDPOINTS, AREAS_OSM, buildOverpassQuery, overpassBody, parseOverpass, combineRoutes } from '../lib/areas-osm.js';
import { OFFICIAL, parseOfficialData } from '../lib/areas-official.js';
import {
  mergeAreas, placeAlongRoute, describeArea, areaName, KIND_LABELS, placesText, servicesText, statusBadges, sourcesText,
} from '../lib/areas-route.js';
import { AVIS, AVIS_RULES, canReport, latestReport, reportText, addAreaReport } from '../lib/areas-avis.js';
import { createAreasCache, routeKey } from '../lib/areas-cache.js';
import { NOTE_CHOICES, AREA_NOTES, noteFor, setAreaNote, noteShort } from '../lib/area-notes.js';
import { AREAS_DATA, parseIndex, parseTile, routePlan, tilePath, mergeOsmSources, copyDateText } from '../lib/areas-osm-data.js';
import { formatArrival } from '../lib/format.js';

export const AREAS_TEXT = Object.freeze({
  loading: 'Recherche des aires et parkings PL le long du trajet…',
  none: 'Aucune aire ni parking PL trouvé le long de ce trajet.',
  unavailable: 'Aires OpenStreetMap indisponibles hors de la zone de la copie (serveurs injoignables). L\'itinéraire reste utilisable.',
  offline: 'Hors ligne : aires OpenStreetMap indisponibles hors de la zone de la copie.',
  noCopy: 'Aires indisponibles sur ce trajet (données non chargées).',
  officialOnly: 'Seules les aires du jeu officiel sont affichées.',
  avisStopped: `À l'arrêt seulement (moins de ${AVIS_RULES.MAX_SPEED_KMH} km/h).`,
  avisSaved: 'Avis enregistré sur cet appareil.',
});

/** Une requête Overpass vers un serveur ; erreur si HTTP en échec, délai dépassé ou réponse illisible. */
async function askOverpass(url, body, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AREAS_OSM.CLIENT_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      method: 'POST', body, signal: ctrl.signal, cache: 'no-store', credentials: 'omit',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json?.elements)) throw new Error('réponse illisible');
    return json;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Serveur principal, puis serveur de secours. */
export async function fetchOverpass(query, signal) {
  const body = overpassBody(query);
  let last = null;
  for (const url of OVERPASS_ENDPOINTS) {
    if (signal?.aborted) throw new DOMException('annulé', 'AbortError');
    try {
      return await askOverpass(url, body, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      last = err;
    }
  }
  throw last ?? new Error('Overpass injoignable');
}

/**
 * @param {{ map:object, storage:Storage, getData:()=>object, update:(fn)=>void,
 *   getDrive:()=>{ navigating:boolean, speedKmh:number|null }, getRoute:()=>object|null,
 *   onPool:(pool:object[])=>void, onNavPick?:(id:string)=>void }} ctx
 *   getRoute : itinéraire choisi en ce moment (il peut changer pendant la requête).
 */
export function createAreas(ctx) {
  const section = $('#areas');
  const list = $('#areas-list');
  const status = $('#areas-status');
  const count = $('#areas-count');
  const dlg = $('#dlg-area');
  wireDialog(dlg);
  const cache = createAreasCache(ctx.storage);
  let officialPromise = null;
  let pool = [];
  let placed = [];
  let departure = new Date();
  let request = null;
  let note = '';
  let openId = null;

  let indexPromise = null;
  const tilePromises = new Map();

  /** data/aires-osm/index.json (null : absent, vide ou illisible ; redemandé au calcul suivant). */
  function osmIndex() {
    indexPromise ??= fetch(AREAS_DATA.INDEX_PATH, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => parseIndex(j))
      .catch(() => null)
      .then((idx) => { if (!idx) indexPromise = null; return idx; });
    return indexPromise;
  }

  /** Une case de la copie (null : absente ou illisible ; redemandée au calcul suivant). */
  function osmTile(key, updated) {
    if (!tilePromises.has(key)) {
      tilePromises.set(key, fetch(tilePath(key), { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => parseTile(j, updated))
        .catch(() => null)
        .then((t) => { if (!t) tilePromises.delete(key); return t; }));
    }
    return tilePromises.get(key);
  }

  function official() {
    officialPromise ??= fetch(OFFICIAL.DATA_PATH, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => parseOfficialData(j).areas)
      .catch(() => []);
    return officialPromise;
  }

  const reports = () => ctx.getData().areaReports ?? [];

  function findArea(id) {
    return placed.find((a) => a.id === id || a.ids?.includes(id)) ?? pool.find((a) => a.id === id || a.ids?.includes(id)) ?? null;
  }

  function renderList() {
    const items = placed.map((a) => {
      const d = describeArea(a, departure);
      const last = latestReport(reports(), a);
      return el('li', {}, [el('button', {
        type: 'button', class: `area-row${d.otherSide ? ' other-side' : ''}`, onclick: () => openSheet(a.id),
      }, [
        el('span', { class: 'area-row-head' }, [
          el('span', { class: 'area-row-name', text: d.name }),
          d.otherSide ? el('span', { class: 'area-row-other', text: 'autre sens ?' }) : null,
        ]),
        el('span', { class: 'area-row-facts', text: `${d.kind} · ${d.facts}` }),
        d.services || d.badges.length
          ? el('span', { class: 'area-row-services', text: [d.services, ...d.badges].filter(Boolean).join(' · ') }) : null,
        last ? el('span', { class: `area-row-avis avis-${last.status}`, text: reportText(last) }) : null,
        // Phase 6 : ma note, au prochain passage.
        noteShort(noteFor(ctx.getData().areaNotes ?? [], a)) ? el('span', { class: 'area-row-note', text: noteShort(noteFor(ctx.getData().areaNotes ?? [], a)) }) : null,
      ])]);
    });
    list.replaceChildren(...items);
    const n = placed.filter((a) => !a.otherSide).length;
    const other = placed.length - n;
    count.textContent = placed.length ? `(${n}${other ? ` + ${other} autre sens ?` : ''})` : '';
    section.hidden = false;
    ctx.map.showAreas(placed.map((a) => ({
      id: a.id, lonlat: [a.lon, a.lat], otherSide: !!a.otherSide,
      label: `${areaName(a)}${a.otherSide ? ' (autre sens ?)' : ''}`,
    })));
  }

  function setStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  /** Aires pour l'itinéraire choisi (sans requête : la liste couvre tous les itinéraires proposés). */
  function place(route) {
    placed = route ? placeAlongRoute(pool, route) : [];
    renderList();
    if (!note) setStatus(placed.length ? '' : AREAS_TEXT.none);
  }

  /**
   * Au calcul : aires de la copie data/aires-osm/ pour les cases que les itinéraires proposés touchent, une seule
   * requête Overpass pour les morceaux hors de la zone couverte (ou le résultat gardé sur l'appareil), fusion avec le
   * jeu officiel, puis la liste de l'itinéraire choisi. Copie absente, vide ou illisible : message, jamais un silence.
   * @param {{ options:{ route:object }[], selected:number }} choice
   */
  async function load(choice) {
    request?.abort();
    const ctrl = new AbortController();
    request = ctrl;
    pool = [];
    note = '';
    departure = new Date();
    placed = [];
    list.replaceChildren();
    count.textContent = '';
    section.hidden = false;
    ctx.map.showAreas([]);
    setStatus(AREAS_TEXT.loading);
    const line = combineRoutes(choice.options.map((o) => o.route.coordinates));
    const notes = [];
    let copied = [];
    let live = null;
    let copyDate = null;
    const index = await osmIndex();
    if (ctrl.signal.aborted || request !== ctrl) return;
    if (!index) {
      notes.push(AREAS_TEXT.noCopy);
    } else {
      copyDate = index.updated;
      const plan = routePlan(line, index);
      const tiles = await Promise.all(plan.tiles.map((k) => osmTile(k, index.updated)));
      if (ctrl.signal.aborted || request !== ctrl) return;
      if (tiles.some((t) => !t)) notes.push(AREAS_TEXT.noCopy);
      copied = tiles.flatMap((t) => t ?? []);
      // Overpass seulement pour les morceaux hors de la zone couverte (jamais pour le reste du trajet).
      if (plan.uncovered.length) {
        const key = `hors-copie:${routeKey(plan.uncovered.flat())}`;
        live = cache.get(key);
        if (!live) {
          if (!navigator.onLine) {
            notes.push(AREAS_TEXT.offline);
          } else {
            try {
              live = parseOverpass(await fetchOverpass(buildOverpassQuery(plan.uncovered), ctrl.signal));
              cache.set(key, live);
            } catch {
              if (ctrl.signal.aborted) return;
              notes.push(AREAS_TEXT.unavailable);
            }
          }
        }
      }
    }
    const off = await official();
    if (ctrl.signal.aborted || request !== ctrl) return;
    pool = mergeAreas(mergeOsmSources(copied, live ?? []), off);
    note = notes.join(' ');
    if (note && off.length && !pool.some((a) => a.sources.includes('osm'))) note = `${note} ${AREAS_TEXT.officialOnly}`;
    const date = copyDateText(copyDate);
    $('#areas-copy-date').textContent = date ? `, copie du ${date}` : '';
    request = null;
    setStatus(note);
    place(ctx.getRoute() ?? choice.options[choice.selected]?.route);
    ctx.onPool?.(pool);
  }

  function clear() {
    request?.abort();
    request = null;
    pool = [];
    placed = [];
    note = '';
    list.replaceChildren();
    section.hidden = true;
    ctx.map.showAreas([]);
  }

  // ───────── Fiche d'une aire ─────────

  function fact(label, value) {
    return value ? [el('dt', { text: label }), el('dd', { text: value })] : [];
  }

  function renderAvis(area) {
    const drive = ctx.getDrive();
    const allowed = canReport(drive);
    for (const b of dlg.querySelectorAll('[data-avis]')) b.disabled = !allowed;
    const last = latestReport(reports(), area);
    $('#area-last').textContent = last ? `Dernier avis : ${reportText(last)}` : 'Pas encore d\'avis sur cette aire.';
    const hint = $('#area-avis-hint');
    if (!allowed) hint.textContent = AREAS_TEXT.avisStopped;
    else if (hint.textContent === AREAS_TEXT.avisStopped) hint.textContent = '';
  }

  // ───────── Ma note (phase 6) : à l'arrêt seulement (parkedState ; vitesse inconnue = en mouvement), jamais dite ─────────
  let noteDraft = null;
  const notes = () => ctx.getData().areaNotes ?? [];
  const noteParked = () => ctx.getDrive().parked === true;

  function renderNote(area) {
    const allowed = noteParked();
    const saved = noteFor(notes(), area);
    noteDraft ??= { security: saved?.security ?? null, showers: saved?.showers ?? null, clean: saved?.clean ?? null };
    $('#area-note-last').textContent = saved ? noteShort(saved) || 'Ma note : remarque seulement.' : 'Pas encore de note sur cette aire.';
    $('#area-note-fields').replaceChildren(...Object.entries(NOTE_CHOICES).map(([key, def]) => el('div', { class: 'area-note-group', role: 'group', 'aria-label': def.label }, [
      el('span', { class: 'area-note-label', text: def.label }),
      el('div', { class: 'area-note-choices' }, Object.entries(def.values).map(([v, label]) => el('button', {
        type: 'button', class: 'btn', text: label, 'aria-pressed': String(noteDraft[key] === v), disabled: !allowed || null,
        onclick: () => {
          if (!noteParked()) { renderNote(area); return; }
          noteDraft = { ...noteDraft, [key]: noteDraft[key] === v ? null : v };
          renderNote(area);
        },
      }))),
    ])));
    const text = $('#area-note-text');
    if (!text.dataset.area || text.dataset.area !== area.id) { text.value = saved?.text ?? ''; text.dataset.area = area.id; }
    text.disabled = !allowed;
    $('#btn-area-note-save').disabled = !allowed;
    const hint = $('#area-note-hint');
    if (!allowed) hint.textContent = AREA_NOTES.PARKED_TEXT;
    else if (hint.textContent === AREA_NOTES.PARKED_TEXT) hint.textContent = '';
  }

  $('#btn-area-note-save').addEventListener('click', () => {
    const a = findArea(openId);
    if (!a || !noteParked()) { if (a) renderNote(a); return; }
    ctx.update((d) => ({ ...d, areaNotes: setAreaNote(d.areaNotes, a, { ...noteDraft, text: $('#area-note-text').value }) }));
    $('#area-note-hint').textContent = AREA_NOTES.SAVED_TEXT;
    renderNote(a);
    if (placed.length) renderList();
  });

  function openSheet(id) {
    const a = findArea(id);
    if (!a) return;
    openId = a.id;
    const drive = ctx.getDrive();
    $('#area-title').textContent = areaName(a);
    const kind = [KIND_LABELS[a.kind] ?? 'Aire', a.network ? `réseau ${a.network}` : null].filter(Boolean).join(' · ');
    $('#area-kind').textContent = kind;
    $('#area-other').hidden = !a.otherSide;
    const placedA = placed.find((p) => p.id === a.id);
    const where = placedA && !drive.navigating
      ? `km ${Math.round(placedA.along / 1000)} · arrivée estimée ${formatArrival(departure, placedA.time ?? 0)}` : '';
    $('#area-facts').replaceChildren(...[
      ...fact('Sur le trajet', where),
      ...fact('Places PL', placesText(a.hgvPlaces) ?? 'non renseigné'),
      ...fact('Services', servicesText(a.services) || 'non renseignés'),
      ...fact('Accès', [...statusBadges(a), a.price].filter(Boolean).join(' · ') || 'non renseigné'),
      ...fact('Commune', a.city),
      ...fact('Route', [a.road, a.direction ? `direction ${a.direction}` : null].filter(Boolean).join(' · ')),
      ...fact('Exploitant', a.operator),
    ]);
    $('#area-sources').textContent = `Sources : ${sourcesText(a)}.`;
    $('#area-avis-hint').textContent = '';
    renderAvis(a);
    noteDraft = null;
    $('#area-note-text').dataset.area = '';
    $('#area-note-hint').textContent = '';
    renderNote(a);
    if (!dlg.open) dlg.showModal();
  }

  for (const b of dlg.querySelectorAll('[data-avis]')) {
    b.addEventListener('click', () => {
      const a = findArea(openId);
      if (!a || !canReport(ctx.getDrive()) || !Object.hasOwn(AVIS, b.dataset.avis)) return;
      ctx.update((d) => ({ ...d, areaReports: addAreaReport(d.areaReports, a, b.dataset.avis) }));
      $('#area-avis-hint').textContent = AREAS_TEXT.avisSaved;
      renderAvis(a);
      if (placed.length) renderList();
    });
  }
  dlg.addEventListener('close', () => { openId = null; noteDraft = null; });
  // Repère touché : en guidage, liste et fiche courte (fiche complète seulement à l'arrêt, R412-6-2) ; sinon la fiche.
  ctx.map.onAreaPick((id) => {
    if (ctx.getDrive().navigating && ctx.onNavPick) ctx.onNavPick(id);
    else openSheet(id);
  });

  return {
    load,
    clear,
    /** Autre itinéraire choisi à l'arrêt : liste et repères refaits, sans requête. */
    select(route) {
      if (request || section.hidden) return; // requête en cours : la liste suivra l'itinéraire choisi à la fin
      place(route);
    },
    /** Après un recalcul en guidage : aires replacées sur le nouvel itinéraire (même liste, aucune requête). */
    reroute(route) {
      if (pool.length) place(route);
    },
    openSheet,
    /** Fiche courte du guidage (phase 2d) : services et accès en une ligne, '' si rien de connu. */
    shortFacts(id) {
      const a = findArea(id);
      if (!a) return '';
      // Phase 6 : ma note affichée au prochain passage (visuel seulement, jamais dite).
      const mine = noteShort(noteFor(ctx.getData().areaNotes ?? [], a));
      return [servicesText(a.services), [...statusBadges(a), a.price].filter(Boolean).join(' · '), mine].filter(Boolean).join(' · ');
    },
    /** Vitesse du guidage changée : boutons « Mon avis » de la fiche ouverte mis à jour. */
    refreshDrive() {
      if (!dlg?.open || !openId) return;
      const a = findArea(openId);
      if (a) { renderAvis(a); renderNote(a); }
    },
    get pool() {
      return pool;
    },
  };
}
