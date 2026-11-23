// Mes restrictions (phase 12b) : Réglages › Mes restrictions (liste, ajout au centre de la carte, modification,
// suppression) et panneau du repère de pont (« Éviter ce passage »). Ajout et modification à l'arrêt seulement
// (canEditRestrictions) : boutons grisés sinon. Textes affichés en textContent. Rien dans le guidage ni dans la voix.

import { $, el } from './dom.js';
import {
  addRestriction, updateRestriction, removeRestriction, restrictionLabel, canEditRestrictions, fromBridge,
  HELP_TEXT, BRIDGE_AVOID_HELP, TYPE_LABELS,
} from '../lib/restrictions.js';

/**
 * @param {{ getList:()=>object[], setList:(list:object[])=>void, getCenter:()=>number[]|null,
 *   getDrive:()=>{ navigating:boolean, parked:boolean } }} ctx
 */
export function createRestrictions(ctx) {
  const type = $('#restr-type');
  const value = $('#restr-value');
  const note = $('#restr-note');
  const add = $('#btn-restr-add');
  const status = $('#restr-status');
  const list = $('#restr-list');
  const panel = $('#bridge-panel');
  const panelText = $('#bridge-panel-text');
  const panelStatus = $('#bridge-panel-status');
  const avoid = $('#btn-bridge-avoid');
  $('#restrictions-help').textContent = HELP_TEXT;
  $('#bridge-panel-help').textContent = BRIDGE_AVOID_HELP;
  let bridgeItem = null;
  let editing = null;

  const allowed = () => canEditRestrictions(ctx.getDrive());
  const say = (node, text) => { node.textContent = text; };

  const syncValue = () => {
    const avoidType = type.value === 'avoid';
    value.disabled = avoidType || !allowed();
    if (avoidType) value.value = '';
  };

  function render() {
    const ok = allowed();
    add.disabled = !ok;
    add.textContent = editing ? 'Enregistrer la modification' : 'Ajouter au centre de la carte';
    for (const n of [type, note]) n.disabled = !ok;
    syncValue();
    avoid.disabled = !ok || !bridgeItem;
    const items = ctx.getList();
    list.replaceChildren(...items.map((r) => el('li', { class: 'restr-item' }, [
      el('strong', { text: `${restrictionLabel(r)}${r.note ? ` — ${r.note}` : ''}` }),
      el('span', { class: 'hint', text: `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)} · ${r.date.split('-').reverse().join('/')} · ${r.origin === 'osm-bridge' ? 'depuis un pont OSM' : 'saisie'}` }),
      el('div', { class: 'row' }, [
        el('button', { type: 'button', class: 'btn btn-restr-edit', disabled: !ok, onclick: () => startEdit(r), text: 'Modifier' }),
        el('button', { type: 'button', class: 'btn btn-restr-del', disabled: !ok, onclick: () => remove(r), text: 'Supprimer' }),
      ]),
    ])));
    if (!items.length) list.replaceChildren(el('li', { class: 'hint', text: 'Aucune restriction enregistrée.' }));
  }

  function startEdit(r) {
    if (!allowed()) return;
    editing = r.id;
    type.value = r.type;
    value.value = r.value === null ? '' : String(r.value).replace('.', ',');
    note.value = r.note;
    say(status, `Modification : ${TYPE_LABELS[r.type]}. Position inchangée.`);
    render();
  }

  function remove(r) {
    if (!allowed()) return;
    ctx.setList(removeRestriction(ctx.getList(), r.id));
    if (editing === r.id) editing = null;
    say(status, 'Restriction supprimée : prise en compte au prochain calcul.');
    render();
  }

  add.addEventListener('click', () => {
    if (!allowed()) { say(status, 'Disponible à l\'arrêt seulement.'); return; }
    try {
      if (editing) {
        ctx.setList(updateRestriction(ctx.getList(), editing, { type: type.value, value: value.value, note: note.value }));
        editing = null;
        say(status, 'Restriction modifiée : prise en compte au prochain calcul.');
      } else {
        const c = ctx.getCenter();
        if (!c) { say(status, 'Carte indisponible : impossible de placer la restriction.'); return; }
        ctx.setList(addRestriction(ctx.getList(), { lat: c[1], lon: c[0], type: type.value, value: value.value, note: note.value }));
        say(status, 'Restriction ajoutée au centre de la carte : prise en compte au prochain calcul.');
      }
      value.value = '';
      note.value = '';
    } catch (err) {
      say(status, err.message);
    }
    render();
  });
  type.addEventListener('change', syncValue);

  avoid.addEventListener('click', () => {
    if (!allowed() || !bridgeItem) return;
    try {
      ctx.setList(addRestriction(ctx.getList(), fromBridge(bridgeItem)));
      say(panelStatus, 'Passage enregistré dans Mes restrictions : évité au prochain calcul (« Calculer l\'itinéraire »).');
    } catch (err) {
      say(panelStatus, err.message);
    }
    render();
  });
  $('#btn-bridge-close').addEventListener('click', () => closeBridge());

  function closeBridge() {
    bridgeItem = null;
    panel.hidden = true;
    say(panelStatus, '');
  }

  render();
  return {
    render,
    /** Repère de pont touché (à l'arrêt) : texte, aide et « Éviter ce passage ». */
    openBridge(item) {
      bridgeItem = item;
      panelText.textContent = `${item.text}${item.name ? ` (${item.name})` : ''}`;
      say(panelStatus, '');
      panel.hidden = false;
      render();
    },
    closeBridge,
  };
}
