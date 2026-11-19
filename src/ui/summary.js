// Résumé de l'itinéraire : distance, durée, arrivée, km à péage, gazole estimé.

import { el } from './dom.js';
import { formatDistance, formatDuration, formatArrival, formatLiters } from '../lib/format.js';
import { fuelEstimate } from '../lib/ors-response.js';
import { clampMaxSpeed } from '../lib/ors-request.js';

function item(label, value) {
  return el('div', {}, [el('dt', { text: label }), el('dd', { text: value })]);
}

function restrictionsText(v) {
  const n = (x) => String(x).replace('.', ',');
  const parts = [`H ${n(v.height)} m`, `l ${n(v.width)} m`, `L ${n(v.length)} m`, `${n(v.weight)} t`];
  if (v.axleload) parts.push(`${n(v.axleload)} t/essieu`);
  if (v.hazmat) parts.push('matières dangereuses');
  return parts.join(' · ');
}

export function renderSummary(node, { route, vehicle, now = new Date(), toLabel, avoidTolls, avoidFerries }) {
  const toll = route.tollDistance === null ? 'inconnu' : formatDistance(route.tollDistance);
  const fuel = fuelEstimate(route.distance, vehicle.consumption);
  const notes = [
    `Véhicule : ${vehicle.name} (${restrictionsText(vehicle)})`,
  ];
  const sentSpeed = clampMaxSpeed(vehicle.maxSpeed);
  if (sentSpeed !== null && sentSpeed !== vehicle.maxSpeed) {
    notes.push(`Vitesse max envoyée : ${sentSpeed} km/h (minimum imposé par OpenRouteService).`);
  }
  if (avoidTolls) notes.push('Péages évités si possible.');
  if (avoidFerries) notes.push('Ferries évités si possible.');
  for (const w of route.warnings) notes.push(`Avertissement : ${w}`);

  node.replaceChildren(
    el('dl', { class: 'summary-grid' }, [
      item('Distance', formatDistance(route.distance)),
      item('Durée', formatDuration(route.duration)),
      item('Arrivée', formatArrival(now, route.duration)),
      item('Km à péage', toll),
      ...(fuel !== null ? [item('Gazole estimé', formatLiters(fuel))] : []),
    ]),
    el('p', { class: 'hint', text: toLabel ? `Vers : ${toLabel}` : '' }),
    el('ul', { class: 'summary-notes' }, notes.map((t) => el('li', { text: t }))),
  );
  node.hidden = false;
}
