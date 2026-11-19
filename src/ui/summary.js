// Fiches des itinéraires proposés (une par itinéraire, celle choisie mise en avant) et notes (sous « Démarrer »).
// Les textes viennent de src/lib/route-options.js (describeOption, failureText) ; ici, seulement l'affichage.
// Affiché à l'arrêt uniquement : pendant le guidage ce panneau est masqué (aucun choix en roulant).

import { el } from './dom.js';
import { describeOption, failureText, VARIANTS } from '../lib/route-options.js';
import { clampMaxSpeed } from '../lib/ors-request.js';

function restrictionsText(v) {
  const n = (x) => String(x).replace('.', ',');
  const parts = [`H ${n(v.height)} m`, `l ${n(v.width)} m`, `L ${n(v.length)} m`, `${n(v.weight)} t`];
  if (v.axleload) parts.push(`${n(v.axleload)} t/essieu`);
  if (v.hazmat) parts.push('matières dangereuses');
  return parts.join(' · ');
}

function card(d, { checked, onSelect }) {
  const facts = [d.distance, d.arrival, d.toll, d.fuel].filter(Boolean);
  return el('button', {
    type: 'button', class: 'route-card', role: 'radio', 'aria-checked': String(checked), onclick: onSelect,
  }, [
    el('span', { class: 'route-card-head' }, [
      el('span', { class: 'route-card-title' }, [
        el('span', { class: 'route-card-name', text: d.name }),
        d.also ? el('span', { class: 'route-card-also', text: ` (${d.also})` }) : null,
      ]),
      el('span', { class: 'route-card-time', text: d.duration }),
    ]),
    el('span', { class: 'route-card-facts', text: facts.join(' · ') }),
    d.delta ? el('span', { class: 'route-card-delta', text: d.delta }) : null,
    d.note ? el('span', { class: 'route-card-note', text: d.note }) : null,
  ]);
}

/**
 * @param {HTMLElement} node bloc des fiches
 * @param {HTMLElement} notesNode bloc des notes (véhicule, avertissements), placé sous le bouton « Démarrer »
 * @param {{ choice:{ options:object[], failures:object[], selected:number, vehicle:object, toLabel?:string,
 *   avoidTolls?:boolean, avoidFerries?:boolean }, dieselPrice:number|null, now?:Date, onSelect:(i:number)=>void }} p
 */
export function renderRouteChoice(node, notesNode, { choice, dieselPrice, now = new Date(), onSelect }) {
  const { options, failures, selected, vehicle } = choice;
  const reference = options[0];
  const cards = options.map((o, i) => card(describeOption(o, reference, { vehicle, dieselPrice, now }), {
    checked: i === selected, onSelect: () => onSelect(i),
  }));

  const current = options[selected];
  const notes = [`Véhicule : ${vehicle.name} (${restrictionsText(vehicle)})`];
  const sentSpeed = clampMaxSpeed(vehicle.maxSpeed);
  if (sentSpeed !== null && sentSpeed !== vehicle.maxSpeed) {
    notes.push(`Vitesse max envoyée : ${sentSpeed} km/h (minimum imposé par OpenRouteService).`);
  }
  if (choice.avoidTolls) notes.push('Péages évités si possible.');
  if (choice.avoidFerries) notes.push('Ferries évités si possible.');
  if (current.key === VARIANTS.alternative.key) {
    notes.push('Si tu sors de cet itinéraire, le recalcul automatique suit l\'itinéraire recommandé depuis ta position.');
  }
  if (typeof vehicle.consumption === 'number' && dieselPrice === null) {
    notes.push('Indique le prix du gazole dans Réglages (⚙) pour estimer le coût.');
  }
  for (const w of current.route.warnings ?? []) notes.push(`Avertissement : ${w}`);

  node.replaceChildren(...[
    choice.toLabel ? el('p', { class: 'hint route-to', text: `Vers : ${choice.toLabel}` }) : null,
    el('div', { class: 'route-cards', role: 'radiogroup', 'aria-label': 'Itinéraires proposés' }, cards),
    failures.length ? el('p', { class: 'route-failures', text: failures.map(failureText).join(' ') }) : null,
  ].filter(Boolean));
  node.hidden = false;
  notesNode.replaceChildren(el('ul', { class: 'summary-notes' }, notes.map((t) => el('li', { text: t }))));
  notesNode.hidden = false;
}

/** Fait apparaître la fiche choisie (après un toucher sur la carte, elle peut être hors du panneau). */
export function revealSelectedCard(node) {
  node.querySelector('.route-card[aria-checked="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
