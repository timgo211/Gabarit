// Fiches des itinéraires proposés (une par itinéraire, celle choisie mise en avant) et notes (sous « Démarrer »).
// Les textes viennent de src/lib/route-options.js (describeOption, failureText) ; ici, seulement l'affichage.
// Affiché à l'arrêt uniquement : pendant le guidage ce panneau est masqué (aucun choix en roulant).

import { el } from './dom.js';
import { describeOption, failureText, VARIANTS } from '../lib/route-options.js';
import { clampMaxSpeed } from '../lib/ors-request.js';
import { WIND } from '../lib/wind.js';
import { parseDriveTime, driveTimeText, DRIVE_NOTE } from '../lib/driving-time.js';

function restrictionsText(v) {
  const n = (x) => String(x).replace('.', ',');
  const parts = [`H ${n(v.height)} m`, `l ${n(v.width)} m`, `L ${n(v.length)} m`, `${n(v.weight)} t`];
  if (v.axleload) parts.push(`${n(v.axleload)} t/essieu`);
  if (v.hazmat) parts.push('matières dangereuses');
  return parts.join(' · ');
}

function card(d, { checked, onSelect, rules }) {
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
    rules?.short?.length ? el('span', { class: 'route-card-rules', text: `⚠ ${rules.short.join(' · ')}` }) : null,
  ]);
}

/**
 * Réglementation de l'itinéraire choisi (phase 5) : une ligne par ZFE et par interdiction, lien vers l'arrêté (texte
 * et adresse venant de data/zfe.json : textContent, adresse http(s) vérifiée par safeUrl), bouton « Éviter la ZFE ».
 */
function rulesBlock(rules, { source, onAvoidZfe, avoidBusy, canAvoid }) {
  if (!rules) return [];
  const items = rules.lines.map((l) => el('li', { class: l.level }, [
    l.text,
    l.url ? el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', text: 'Arrêté' }) : null,
  ]));
  return [
    items.length ? el('ul', { class: 'rules-notes', 'aria-label': 'Réglementation' }, items) : null,
    canAvoid && rules.banned.length ? el('button', {
      type: 'button', class: 'btn btn-avoid-zfe', disabled: !!avoidBusy, onclick: onAvoidZfe,
      text: avoidBusy ? 'Calcul sans ZFE…' : '⛔ Éviter la ZFE',
    }) : null,
    source ? el('p', { class: 'rules-source', text: source }) : null,
    rules.wind ? el('p', { class: 'rules-source' }, [
      el('a', { href: WIND.ATTRIBUTION_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Météo : Open-Meteo.com' }),
      ' (',
      el('a', { href: WIND.LICENSE_URL, target: '_blank', rel: 'noopener noreferrer', text: 'CC BY 4.0' }),
      ')',
    ]) : null,
  ].filter(Boolean);
}

/**
 * Conduite déjà faite aujourd'hui (saisie à l'arrêt, facultative) : sert aux pauses conseillées et au compteur du
 * guidage. Deux champs « 2 h 15 », validés à la sortie du champ.
 */
let driveOpen = false;
function driveBlock(drive) {
  if (!drive?.applies) return null;
  const field = (id, label, value, key) => {
    const input = el('input', {
      id, type: 'text', inputmode: 'text', autocomplete: 'off', placeholder: '0 h 00', value: value ? driveTimeText(value) : '',
    });
    const msg = el('span', { class: 'drive-error', role: 'status' });
    input.addEventListener('change', () => {
      const v = parseDriveTime(input.value);
      if (v === null) { msg.textContent = 'Format : 2 h 15, 2:15 ou 45 min.'; return; }
      msg.textContent = '';
      drive.onChange?.({ [key]: v });
    });
    return el('label', { class: 'drive-field', for: id }, [el('span', { text: label }), input, msg]);
  };
  const details = el('details', { class: 'drive-block', open: driveOpen || drive.today || drive.sinceBreak ? '' : null }, [
    el('summary', { text: 'Temps de conduite déjà fait aujourd\'hui (facultatif)' }),
    el('div', { class: 'drive-fields' }, [
      field('drive-today', 'Aujourd\'hui', drive.today, 'today'),
      field('drive-since', 'Depuis la dernière pause', drive.sinceBreak, 'sinceBreak'),
    ]),
    el('p', { class: 'hint', text: `${DRIVE_NOTE} Repris du dernier guidage s'il date de moins de 24 h.` }),
  ]);
  details.addEventListener('toggle', () => { driveOpen = details.open; });
  return details;
}

/**
 * @param {HTMLElement} node bloc des fiches
 * @param {HTMLElement} notesNode bloc des notes (véhicule, avertissements), placé sous le bouton « Démarrer »
 * @param {{ choice:{ options:object[], failures:object[], selected:number, vehicle:object, toLabel?:string,
 *   avoidTolls?:boolean, avoidFerries?:boolean }, dieselPrice:number|null, now?:Date, onSelect:(i:number)=>void,
 *   rules?:object[]|null, rulesSource?:string, onAvoidZfe?:()=>void, avoidBusy?:boolean,
 *   drive?:{ applies:boolean, today:number, sinceBreak:number, onChange:(v:object)=>void }|null }} p
 *   rules : réglementation de chaque itinéraire (routeRules, phase 5), dans l'ordre des options
 */
export function renderRouteChoice(node, notesNode, {
  choice, dieselPrice, now = new Date(), onSelect, rules = null, rulesSource = '', onAvoidZfe = null, avoidBusy = false,
  drive = null,
}) {
  const { options, failures, selected, vehicle } = choice;
  const reference = options[0];
  const cards = options.map((o, i) => card(describeOption(o, reference, { vehicle, dieselPrice, now }), {
    checked: i === selected, onSelect: () => onSelect(i), rules: rules?.[i],
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
  notesNode.replaceChildren(...[
    ...rulesBlock(rules?.[selected], { source: rulesSource, onAvoidZfe, avoidBusy, canAvoid: !!onAvoidZfe }),
    driveBlock(drive),
    el('ul', { class: 'summary-notes' }, notes.map((t) => el('li', { text: t }))),
  ].filter(Boolean));
  notesNode.hidden = false;
}

/** Fait apparaître la fiche choisie (après un toucher sur la carte, elle peut être hors du panneau). */
export function revealSelectedCard(node) {
  node.querySelector('.route-card[aria-checked="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
