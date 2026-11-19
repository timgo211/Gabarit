// Aires et parkings PL du trajet (phase 9) : une requête Overpass par calcul (serveur de secours si le premier
// échoue), jeu officiel copié dans data/aires-pl.json, liste avant le départ, repères sur la carte, fiche d'une aire
// et « Mon avis ». Les décisions et les textes viennent de src/lib/areas-*.js ; ici, réseau et affichage.
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
import { formatArrival } from '../lib/format.js';

export const AREAS_TEXT = Object.freeze({
  loading: 'Recherche des aires et parkings PL le long du trajet…',
  none: 'Aucune aire ni parking PL trouvé le long de ce trajet.',
  unavailable: 'Aires OpenStreetMap indisponibles (serveurs injoignables). L\'itinéraire reste utilisable.',
  offline: 'Hors ligne : aires OpenStreetMap indisponibles.',
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
 *   onPool:(pool:object[])=>void }} ctx
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
   * Au calcul : une seule requête Overpass pour tous les itinéraires proposés (ou le résultat gardé sur l'appareil),
   * fusion avec le jeu officiel, puis la liste de l'itinéraire choisi.
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
    const key = routeKey(line);
    let osm = cache.get(key);
    if (!osm) {
      if (!navigator.onLine) {
        note = AREAS_TEXT.offline;
      } else {
        try {
          osm = parseOverpass(await fetchOverpass(buildOverpassQuery(line), ctrl.signal));
          cache.set(key, osm);
        } catch {
          if (ctrl.signal.aborted) return;
          note = AREAS_TEXT.unavailable;
        }
      }
    }
    const off = await official();
    if (ctrl.signal.aborted || request !== ctrl) return;
    pool = mergeAreas(osm ?? [], off);
    if (note && off.length) note = `${note} ${AREAS_TEXT.officialOnly}`;
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
  dlg.addEventListener('close', () => { openId = null; });
  ctx.map.onAreaPick(openSheet);

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
    /** Vitesse du guidage changée : boutons « Mon avis » de la fiche ouverte mis à jour. */
    refreshDrive() {
      if (!dlg.open || !openId) return;
      const a = findArea(openId);
      if (a) renderAvis(a);
    },
    get pool() {
      return pool;
    },
  };
}
