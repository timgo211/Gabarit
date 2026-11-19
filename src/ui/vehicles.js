// Écran Véhicules : liste, profil actif, création / modification / suppression.

import { $, el, wireDialog } from './dom.js';
import { NUMERIC_FIELDS, CRITAIR_VALUES, BAN_STATUS_VALUES, normalizeVehicle, validateVehicle, defaultVehicle } from '../lib/vehicle.js';
import { BAN_STATUS } from '../lib/hgv-bans.js';

const fmt = (x) => (x === null || x === undefined ? '' : String(x).replace('.', ','));

function dims(v) {
  const p = [`H ${fmt(v.height)} m`, `l ${fmt(v.width)} m`, `L ${fmt(v.length)} m`, `${fmt(v.weight)} t`];
  if (v.axleload) p.push(`${fmt(v.axleload)} t/essieu`);
  p.push(`${fmt(v.maxSpeed)} km/h`);
  if (v.hazmat) p.push('ADR');
  p.push(`Crit'Air ${v.critair}`);
  if (v.banStatus === 'art4') p.push('art. 4');
  if (v.banStatus === 'exempt') p.push('spécialisé');
  return p.join(' · ');
}

/**
 * @param {{ getData:()=>object, update:(fn:(data)=>object)=>void }} ctx
 */
export function createVehicles(ctx) {
  const dlg = $('#dlg-vehicles');
  const body = $('#vehicles-body');
  wireDialog(dlg);

  function renderList() {
    const data = ctx.getData();
    const cards = data.vehicles.map((v) => {
      const active = v.id === data.activeVehicleId;
      return el('section', { class: `card vehicle-card${active ? ' active' : ''}` }, [
        el('h3', {}, [v.name, active ? el('span', { class: 'badge', text: 'Actif' }) : null]),
        el('p', { class: 'dims', text: dims(v) }),
        el('div', { class: 'row' }, [
          active ? null : el('button', {
            type: 'button', class: 'btn btn-primary', text: 'Utiliser',
            onclick: () => { ctx.update((d) => ({ ...d, activeVehicleId: v.id })); renderList(); },
          }),
          el('button', { type: 'button', class: 'btn', text: 'Modifier', onclick: () => renderForm(v) }),
          data.vehicles.length > 1 ? el('button', {
            type: 'button', class: 'btn btn-danger', text: 'Supprimer',
            onclick: () => {
              if (!window.confirm(`Supprimer « ${v.name} » ?`)) return;
              ctx.update((d) => {
                const vehicles = d.vehicles.filter((o) => o.id !== v.id);
                const activeVehicleId = d.activeVehicleId === v.id ? vehicles[0].id : d.activeVehicleId;
                return { ...d, vehicles, activeVehicleId };
              });
              renderList();
            },
          }) : null,
        ]),
      ]);
    });
    body.replaceChildren(
      ...cards,
      el('button', { type: 'button', class: 'btn btn-primary btn-big', text: '+ Nouveau véhicule', onclick: () => renderForm(null) }),
    );
  }

  function numberField(key, value) {
    const def = NUMERIC_FIELDS[key];
    const id = `veh-${key}`;
    return el('div', {}, [
      el('label', { for: id, text: `${def.label} (${def.unit})${def.required ? '' : ' — facultatif'}` }),
      el('input', { id, name: key, inputmode: 'decimal', value: fmt(value), autocomplete: 'off' }),
      el('p', { class: 'err', 'data-err': key }),
    ]);
  }

  function renderForm(existing) {
    const v = existing ?? { ...defaultVehicle(), name: '' };
    const form = el('form', { class: 'vehicle-form card', novalidate: true }, [
      el('div', { class: 'full' }, [
        el('label', { for: 'veh-name', text: 'Nom' }),
        el('input', { id: 'veh-name', name: 'name', type: 'text', value: v.name, maxlength: 40, placeholder: 'Ex. : Porteur 19 t' }),
        el('p', { class: 'err', 'data-err': 'name' }),
      ]),
      ...Object.keys(NUMERIC_FIELDS).map((k) => numberField(k, v[k])),
      el('div', {}, [
        el('label', { for: 'veh-critair', text: "Vignette Crit'Air" }),
        el('select', { id: 'veh-critair', name: 'critair' },
          CRITAIR_VALUES.map((c) => el('option', { value: c, text: c === 'NC' ? 'Non classé' : c, selected: c === v.critair }))),
        el('p', { class: 'err', 'data-err': 'critair' }),
      ]),
      el('div', { class: 'full' }, [
        el('label', { for: 'veh-ban', text: 'Interdictions PL week-ends et jours fériés (plus de 7,5 t)' }),
        el('select', { id: 'veh-ban', name: 'banStatus' },
          BAN_STATUS_VALUES.map((c) => el('option', { value: c, text: BAN_STATUS[c], selected: c === (v.banStatus ?? 'concerned') }))),
        el('p', { class: 'hint', text: 'Article 4 : au moins la moitié du chargement en denrées périssables ou animaux vivants, presse, fret aérien… (arrêté du 16 avril 2021). Justificatifs à bord.' }),
        el('p', { class: 'err', 'data-err': 'banStatus' }),
      ]),
      el('label', { class: 'toggle full' }, [
        el('input', { type: 'checkbox', name: 'hazmat', checked: v.hazmat }),
        ' Matières dangereuses (ADR)',
      ]),
      el('p', { class: 'hint full', text: 'La vitesse envoyée au calcul est au minimum 80 km/h (limite OpenRouteService).' }),
      el('div', { class: 'row full' }, [
        el('button', { type: 'submit', class: 'btn btn-primary', text: 'Enregistrer' }),
        el('button', { type: 'button', class: 'btn', text: 'Annuler', onclick: renderList }),
      ]),
    ]);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const raw = Object.fromEntries(fd.entries());
      raw.hazmat = fd.has('hazmat');
      raw.id = v.id;
      const nv = normalizeVehicle(raw);
      const { valid, errors } = validateVehicle(nv);
      for (const p of form.querySelectorAll('[data-err]')) p.textContent = errors[p.dataset.err] ?? '';
      for (const input of form.querySelectorAll('input[name], select[name]')) input.classList.toggle('invalid', !!errors[input.name]);
      if (!valid) {
        form.querySelector('.invalid')?.focus();
        return;
      }
      ctx.update((d) => {
        const exists = d.vehicles.some((o) => o.id === nv.id);
        const vehicles = exists ? d.vehicles.map((o) => (o.id === nv.id ? nv : o)) : [...d.vehicles, nv];
        return { ...d, vehicles, activeVehicleId: exists ? d.activeVehicleId : nv.id };
      });
      renderList();
    });

    body.replaceChildren(el('h3', { text: existing ? `Modifier « ${existing.name} »` : 'Nouveau véhicule' }), form);
    form.querySelector('input')?.focus();
  }

  $('#btn-vehicles').addEventListener('click', () => {
    renderList();
    dlg.showModal();
  });
}
