// Phase 3b — Réglages › Mes lieux (domicile, dépôt, clients) : ajout depuis l'arrivée choisie ou le centre de la carte,
// renommage, suppression. Données personnelles : sur l'appareil, export complet seulement. Textes en textContent.
// Modification : hors guidage ; en guidage, à l'arrêt seulement (comme les recherches récentes, R412-6-2).

import { $, el } from './dom.js';
import { SAVED, addPlace, editPlace, removePlace, placeSub } from '../lib/saved-places.js';
import { recentEditAllowed } from '../lib/recent-places.js';

/**
 * @param {{ getList:()=>object[], setList:(list:object[])=>void, getArrival:()=>object|null,
 *   getCenter:()=>number[]|null, getDrive:()=>{ navigating:boolean, parked:boolean } }} ctx
 */
export function createSavedPlaces(ctx) {
  const kind = $('#place-kind');
  const name = $('#place-name');
  const fromTo = $('#btn-place-to');
  const fromCenter = $('#btn-place-center');
  const status = $('#places-status');
  const list = $('#places-list');
  $('#places-privacy').textContent = SAVED.PRIVACY_TEXT;
  let editing = null;

  const allowed = () => recentEditAllowed(ctx.getDrive());
  const say = (t) => { status.textContent = t; };

  function render() {
    const ok = allowed();
    for (const n of [kind, name, fromCenter]) n.disabled = !ok;
    fromTo.disabled = !ok;
    fromTo.textContent = editing ? 'Enregistrer la modification' : 'Enregistrer l\'arrivée choisie';
    fromCenter.hidden = !!editing;
    const items = ctx.getList();
    list.replaceChildren(...items.map((p) => el('li', { class: 'restr-item' }, [
      el('strong', { text: p.name }),
      el('span', { class: 'hint', text: placeSub(p) }),
      el('div', { class: 'row' }, [
        el('button', { type: 'button', class: 'btn', disabled: !ok, onclick: () => startEdit(p), text: 'Renommer' }),
        el('button', { type: 'button', class: 'btn', disabled: !ok, onclick: () => remove(p), text: 'Supprimer' }),
      ]),
    ])));
    if (!items.length) list.replaceChildren(el('li', { class: 'hint', text: 'Aucun lieu enregistré.' }));
  }

  function startEdit(p) {
    if (!allowed()) return;
    editing = p.id;
    kind.value = p.kind;
    name.value = p.name;
    say(`Modification : ${p.name}. Position inchangée.`);
    render();
  }

  function remove(p) {
    if (!allowed()) return;
    ctx.setList(removePlace(ctx.getList(), p.id));
    if (editing === p.id) editing = null;
    say('Lieu supprimé.');
    render();
  }

  function add(point) {
    try {
      ctx.setList(addPlace(ctx.getList(), { ...point, kind: kind.value, name: name.value }));
      name.value = '';
      say('Lieu enregistré sur cet appareil.');
    } catch (err) {
      say(err.message);
    }
    render();
  }

  fromTo.addEventListener('click', () => {
    if (!allowed()) { say('Disponible à l\'arrêt seulement.'); return; }
    if (editing) {
      ctx.setList(editPlace(ctx.getList(), editing, { name: name.value, kind: kind.value }));
      editing = null;
      name.value = '';
      say('Lieu modifié.');
      render();
      return;
    }
    const to = ctx.getArrival();
    if (!to) { say('Choisis d\'abord une arrivée dans la liste (ou utilise le centre de la carte).'); return; }
    add({ lon: to.lon, lat: to.lat, label: to.label });
  });
  fromCenter.addEventListener('click', () => {
    if (!allowed()) { say('Disponible à l\'arrêt seulement.'); return; }
    const c = ctx.getCenter();
    if (!c) { say('Carte indisponible : impossible de placer le lieu.'); return; }
    if (!name.value.trim()) { say('Donne un nom au lieu (ex. Dépôt Sud).'); return; }
    add({ lon: c[0], lat: c[1], label: '' });
  });

  render();
  return { render };
}
