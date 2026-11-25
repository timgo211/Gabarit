// Fiches des itinéraires proposés (une par itinéraire, celle choisie mise en avant) et notes (sous « Démarrer »).
// Les textes viennent de src/lib/route-options.js (describeOption, failureText) ; ici, seulement l'affichage.
// Affiché à l'arrêt uniquement : pendant le guidage ce panneau est masqué (aucun choix en roulant).

import { el } from './dom.js';
import { describeOption, failureText, VARIANTS } from '../lib/route-options.js';
import { STOPS } from '../lib/stops.js';
import { LYON_BYPASS, LYON_AUTO } from '../lib/lyon-bypass.js';
import { clampMaxSpeed } from '../lib/ors-request.js';
import { WIND } from '../lib/wind.js';
import { ADR, codeText, effectiveCode } from '../lib/adr.js';
import { dayTime } from '../lib/hgv-bans.js';
import { routeDiagnosticText } from '../lib/route-diagnostic.js';
import { rawResponseOf } from '../lib/ors-response.js';
import { requestVersionLabel } from '../lib/app-version.js';

const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', text });

/**
 * Fiches des pays traversés (phase 5c) : une par pays hors France, règles groupées par rubrique, source nommée
 * (nationale ou Bison Futé) avec son lien, « à vérifier » sinon, « en vigueur à votre passage ? » quand la règle est
 * sûre. Textes venant de data/pays (textContent, liens https vérifiés par parseCountryData).
 */
function countryCards(countries) {
  const cards = countries?.cards ?? [];
  if (!cards.length) return null;
  return el('div', { class: 'country-cards', 'aria-label': 'Pays traversés' }, cards.map((c) => {
    const warn = c.items.some((i) => i.level === 'warn');
    const sections = [];
    for (const it of c.items) {
      let sec = sections.find((x) => x.name === it.section);
      if (!sec) sections.push(sec = { name: it.section, items: [] });
      sec.items.push(it);
    }
    const when = `km ${Math.round(c.enter / 1000)} → km ${Math.round(c.exit / 1000)}, ${dayTime(c.enterTime)} → ${dayTime(c.exitTime)}`;
    const body = sections.map((sec) => el('div', { class: 'country-section' }, [
      el('h4', { text: sec.name }),
      el('ul', { class: 'rules-notes' }, sec.items.map((it) => el('li', { class: `${it.level}${it.confirmed ? '' : ' check'}` }, [
        it.inForce === 'yes' ? el('span', { class: 'cbadge cbadge-warn', text: 'En vigueur' }) : null,
        it.inForce === 'no' ? el('span', { class: 'cbadge', text: 'Pas à votre passage' }) : null,
        it.text,
        it.source ? el('span', { class: 'country-source' }, [
          ` — ${it.source.kind === 'bisonfute' ? 'Bison Futé' : 'source officielle'} : `,
          it.source.url ? link(it.source.url, it.source.name) : it.source.name,
        ]) : null,
        it.url && it.url !== it.source?.url ? link(it.url, 'Texte à lire') : null,
      ]))),
    ]));
    return el('details', { class: `country-card${warn ? ' warn' : ''}`, open: warn ? true : null }, [
      el('summary', {}, [el('strong', { text: c.name }), ` (${when})${warn ? ' ⚠' : ''}`]),
      ...body,
      el('p', { class: 'country-footer', text: c.footer }),
    ]);
  }));
}

function restrictionsText(v) {
  const n = (x) => String(x).replace('.', ',');
  const parts = [`H ${n(v.height)} m`, `l ${n(v.width)} m`, `L ${n(v.length)} m`, `${n(v.weight)} t`];
  if (v.axleload) parts.push(`${n(v.axleload)} t/essieu`);
  if (v.hazmat) {
    const code = effectiveCode(v);
    parts.push(`matières dangereuses${code ? `, ${codeText(code)}` : ''}${v.adrClass ? `, classe ${v.adrClass}` : ''}${v.unNumber ? `, UN ${v.unNumber}` : ''}`);
  }
  return parts.join(' · ');
}

function card(d, { checked, onSelect, rules, pending = false }) {
  const facts = [d.distance, d.arrival, d.toll, d.fuel].filter(Boolean);
  const banned = rules?.banned === true; // v77 / v78 : interdit, aucune alternative trouvée
  return el('button', {
    type: 'button', class: banned ? 'route-card banned' : 'route-card', role: 'radio', 'aria-checked': String(checked), onclick: onSelect,
  }, [
    banned ? el('span', { class: 'route-card-banned', text: `⛔ ${rules.bannedShort ?? LYON_AUTO.BANNED_SHORT}` }) : null,
    pending ? el('span', { class: 'route-card-pending hint', text: LYON_AUTO.PENDING_TEXT }) : null,
    el('span', { class: 'route-card-head' }, [
      el('span', { class: 'route-card-title' }, [
        el('span', { class: 'route-card-name', text: d.name }),
        d.also ? el('span', { class: 'route-card-also', text: ` (${d.also})` }) : null,
      ]),
      el('span', { class: 'route-card-time', text: d.duration }),
    ]),
    el('span', { class: 'route-card-facts', text: facts.join(' · ') }),
    // v62 : une ligne par tronçon (titre, puis nom de l'étape, durée, km, heure d'arrivée en gris).
    ...(d.legs ?? []).map((l) => el('span', { class: 'route-card-leg legs' }, [
      el('span', { class: 'route-card-leg-title', text: l.title }),
      el('span', { class: 'route-card-leg-detail', text: l.detail }),
    ])),
    d.an ? el('span', { class: 'route-card-an', text: d.an }) : null,
    rules?.speedLimits?.card ? el('span', { class: 'route-card-speed', text: rules.speedLimits.card }) : null,
    d.delta ? el('span', { class: 'route-card-delta', text: d.delta }) : null,
    d.note ? el('span', { class: 'route-card-note', text: d.note }) : null,
    rules?.short?.length ? el('span', { class: 'route-card-rules', text: `⚠ ${rules.short.join(' · ')}` }) : null,
  ]);
}

/**
 * Réglementation de l'itinéraire choisi (phase 5) : une ligne par ZFE et par interdiction, lien vers l'arrêté (texte
 * et adresse venant de data/zfe.json : textContent, adresse http(s) vérifiée par safeUrl), bouton « Éviter la ZFE ».
 */
function rulesBlock(rules, {
  source, onAvoidZfe, avoidBusy, canAvoid, windCredit, onAvoidTunnel, tunnelBusy, tunnelAllowed = false, onAvoidLocal, localBusy,
  onBypass = null, bypassBusy = false, onLocalAnswer = null,
}) {
  if (!rules) return [];
  // v78 : « Desserte locale dans la zone … ? » (Non par défaut), à l'arrêt seulement (grisé sinon).
  const questions = onLocalAnswer ? (rules.localQuestions ?? []).map((q) => el('div', { class: 'local-question', role: 'group', 'aria-label': q.text }, [
    el('p', { class: 'local-question-text', text: q.text }),
    el('div', { class: 'local-question-buttons' }, [
      el('button', {
        type: 'button', class: `btn${q.yes ? '' : ' btn-primary'}`, 'aria-pressed': String(!q.yes), disabled: !tunnelAllowed,
        'aria-disabled': String(!tunnelAllowed), onclick: () => onLocalAnswer(q.id, false), text: 'Non',
      }),
      el('button', {
        type: 'button', class: `btn${q.yes ? ' btn-primary' : ''}`, 'aria-pressed': String(q.yes), disabled: !tunnelAllowed,
        'aria-disabled': String(!tunnelAllowed), onclick: () => onLocalAnswer(q.id, true), text: 'Oui',
      }),
    ]),
    tunnelAllowed ? null : el('p', { class: 'hint', text: 'Réponse possible à l\'arrêt seulement.' }),
  ])) : [];
  const items = rules.lines.map((l) => el('li', { class: l.level }, [
    l.text,
    l.url ? el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', text: l.linkText ?? 'Arrêté' }) : null,
  ]));
  return [
    ...questions,
    items.length ? el('ul', { class: 'rules-notes', 'aria-label': 'Réglementation' }, items) : null,
    countryCards(rules.countries),
    canAvoid && rules.banned.length ? el('button', {
      type: 'button', class: 'btn btn-avoid-zfe', disabled: !!avoidBusy, onclick: onAvoidZfe,
      text: avoidBusy ? 'Calcul sans ZFE…' : '⛔ Éviter la ZFE',
    }) : null,
    // Tunnels interdits (ADR, phase 5b ; classe Euro, v48) : à l'arrêt seulement, grisé sinon (vitesse inconnue).
    onAvoidTunnel && rules.avoidableTunnels?.length ? el('button', {
      type: 'button', class: 'btn btn-avoid-tunnel', disabled: !!tunnelBusy || !tunnelAllowed, onclick: onAvoidTunnel,
      'aria-disabled': String(!!tunnelBusy || !tunnelAllowed),
      text: tunnelBusy ? 'Calcul du contournement…' : tunnelAllowed ? '⛔ Éviter le tunnel' : '⛔ Éviter le tunnel (à l\'arrêt)',
    }) : null,
    // v76 : Lyon, A6 / A7 interdites aux plus de 7,5 t en transit : 3 points de passage sur la rocade Est, une requête
    // ORS sur appui, à l'arrêt seulement (même règle qu'« Éviter le tunnel »), grisé sinon (vitesse inconnue).
    onBypass && rules.lyonBypass?.ok ? el('button', {
      type: 'button', class: 'btn btn-avoid-tunnel btn-bypass', disabled: !!bypassBusy || !tunnelAllowed, onclick: onBypass,
      'aria-disabled': String(!!bypassBusy || !tunnelAllowed),
      text: bypassBusy ? LYON_BYPASS.BUSY_TEXT : tunnelAllowed ? LYON_BYPASS.BUTTON_TEXT : LYON_BYPASS.BUTTON_PARKED_TEXT,
    }) : null,
    // Phase 5d : route réservée à la desserte locale traversée en transit (une requête ORS sur appui, à l'arrêt).
    onAvoidLocal && rules.localTransit?.length ? el('button', {
      type: 'button', class: 'btn btn-avoid-local', disabled: !!localBusy, onclick: onAvoidLocal,
      text: localBusy ? 'Calcul du contournement…' : '⛔ Éviter la desserte locale',
    }) : null,
    source ? el('p', { class: 'rules-source', text: source }) : null,
    // Licence CC BY 4.0 des données Open-Meteo : attribution avec un lien (open-meteo.com/en/licence).
    windCredit ? el('p', { class: 'rules-source wind-credit' }, [
      'Vent : ',
      el('a', { href: WIND.ATTRIBUTION_URL, target: '_blank', rel: 'noopener noreferrer', text: WIND.ATTRIBUTION }),
      ' (',
      el('a', { href: WIND.LICENSE_URL, target: '_blank', rel: 'noopener noreferrer', text: WIND.LICENSE }),
      ').',
    ]) : null,
  ].filter(Boolean);
}

// Bloc du diagnostic ouvert : gardé ouvert quand la fiche est redessinée (cases chargées, passage à l'arrêt).
let diagOpen = false;

/** Version pour le diagnostic : demandée une fois au service worker, redemandée tant qu'elle reste inconnue. */
let knownVersion = null;
function diagVersion() {
  if (knownVersion) return Promise.resolve(knownVersion);
  return requestVersionLabel(navigator.serviceWorker?.controller).then((v) => {
    if (/^Gabarit v/.test(v)) knownVersion = v;
    return v;
  });
}

/**
 * Diagnostic du trajet (phase 5h bis) : bloc replié, texte calculé à l'ouverture, bouton « Copier » (presse-papiers,
 * sinon texte sélectionné pour une copie à la main). Version demandée au service worker qui contrôle la page (même
 * source que le bas de Réglages : VERSION de sw.js), dès la création du bloc.
 * PR 3a : « Copier la réponse ORS » (réponse d'ORS de cet itinéraire, gardée en mémoire seulement), à l'arrêt seulement
 * (rawAllowed : même règle que « Éviter le tunnel ») ; sert à figer une vraie fixture de test. Aucune clé dedans.
 */
function diagnosticBlock(route, rules, label, rawAllowed = false) {
  const pre = el('pre', { class: 'route-diag-text' });
  const status = el('span', { class: 'route-diag-status', 'aria-live': 'polite' });
  const version = diagVersion();
  const fill = async () => {
    if (pre.textContent) return;
    const v = await version;
    if (!pre.textContent) pre.textContent = routeDiagnosticText(route, { rules, label, version: v });
  };
  const copy = async () => {
    await fill();
    try {
      await navigator.clipboard.writeText(pre.textContent);
      status.textContent = 'Copié.';
    } catch {
      const r = document.createRange();
      r.selectNodeContents(pre);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      status.textContent = 'Texte sélectionné : copiez-le avec le menu du navigateur.';
    }
  };
  const raw = rawResponseOf(route);
  const copyRaw = async () => {
    if (!rawAllowed || !raw) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(raw));
      status.textContent = 'Réponse ORS copiée.';
    } catch {
      status.textContent = 'Copie impossible : le navigateur refuse le presse-papiers.';
    }
  };
  const rawBtn = raw ? el('button', {
    type: 'button', class: 'btn btn-diag-raw', disabled: !rawAllowed, 'aria-disabled': String(!rawAllowed), onclick: copyRaw,
    text: rawAllowed ? 'Copier la réponse ORS' : 'Copier la réponse ORS (à l\'arrêt)',
  }) : null;
  const d = el('details', { class: 'route-diag' }, [
    el('summary', { text: 'Diagnostic du trajet (routes lues, à copier)' }),
    el('p', { class: 'hint', text: 'Noms et références de route renvoyés par OpenRouteService, km, ZFE et taxes PL. Aucune clé ni profil complet.' }),
    el('div', { class: 'route-diag-actions' }, [
      el('button', { type: 'button', class: 'btn btn-diag-copy', onclick: copy, text: 'Copier' }),
      rawBtn,
      status,
    ].filter(Boolean)),
    pre,
  ]);
  if (diagOpen) { d.open = true; fill(); }
  d.addEventListener('toggle', () => { diagOpen = d.open; if (d.open) fill(); });
  return d;
}

/**
 * @param {HTMLElement} node bloc des fiches
 * @param {HTMLElement} notesNode bloc des notes (véhicule, avertissements), placé sous le bouton « Démarrer »
 * @param {{ choice:{ options:object[], failures:object[], selected:number, vehicle:object, toLabel?:string,
 *   avoidTolls?:boolean, avoidFerries?:boolean }, dieselPrice:number|null, now?:Date, onSelect:(i:number)=>void,
 *   rules?:object[]|null, rulesSource?:string, onAvoidZfe?:()=>void, avoidBusy?:boolean, windCredit?:boolean }} p
 *   rules : réglementation de chaque itinéraire (routeRules, phase 5), dans l'ordre des options
 */
export function renderRouteChoice(node, notesNode, {
  choice, dieselPrice, now = new Date(), onSelect, rules = null, rulesSource = '', onAvoidZfe = null, avoidBusy = false,
  windCredit = false, onAvoidTunnel = null, tunnelBusy = false, tunnelAllowed = false, onAvoidLocal = null, localBusy = false,
  onBypass = null, bypassBusy = false, onLocalAnswer = null,
}) {
  const { options, failures, selected, vehicle } = choice;
  const reference = options[0];
  const stops = Array.isArray(choice.stops) ? choice.stops : [];
  const cards = options.map((o, i) => card(describeOption(o, reference, { vehicle, dieselPrice, now, stops, geo: rules?.[i]?.axes?.geo ?? null }), {
    checked: i === selected, onSelect: () => onSelect(i), rules: rules?.[i], pending: i === 0 && choice.lyonAuto === 'pending',
  }));

  const current = options[selected];
  const notes = [`Véhicule : ${vehicle.name} (${restrictionsText(vehicle)})`];
  const sentSpeed = clampMaxSpeed(vehicle.maxSpeed);
  if (sentSpeed !== null && sentSpeed !== vehicle.maxSpeed) {
    notes.push(`Vitesse max envoyée : ${sentSpeed} km/h (minimum imposé par OpenRouteService).`);
  }
  if (vehicle.hazmat) notes.push(ADR.ORS_TEXT); // phase 5b : restrictions.hazmat d'ORS, plus large que le code tunnel
  if (choice.avoidTolls) notes.push('Péages évités si possible.');
  if (choice.avoidFerries) notes.push('Ferries évités si possible.');
  if (current.key === VARIANTS.alternative.key) {
    notes.push('Si tu sors de cet itinéraire, le recalcul automatique suit la préférence d\'OpenRouteService depuis ta position.');
  }
  if (typeof vehicle.consumption === 'number' && dieselPrice === null) {
    notes.push('Indique le prix du gazole dans Réglages (⚙) pour estimer le coût.');
  }
  if (stops.length) notes.push(`${stops.length} étape${stops.length > 1 ? 's' : ''} : ${STOPS.NO_TIME_TEXT}`); // v55
  for (const w of current.route.warnings ?? []) notes.push(`Avertissement : ${w}`);

  node.replaceChildren(...[
    choice.toLabel ? el('p', { class: 'hint route-to', text: `Vers : ${choice.toLabel}` }) : null,
    el('div', { class: 'route-cards', role: 'radiogroup', 'aria-label': 'Itinéraires proposés' }, cards),
    failures.length ? el('p', { class: 'route-failures', text: failures.map(failureText).join(' ') }) : null,
  ].filter(Boolean));
  node.hidden = false;
  notesNode.replaceChildren(
    ...rulesBlock(rules?.[selected], {
      source: rulesSource, onAvoidZfe, avoidBusy, canAvoid: !!onAvoidZfe, windCredit, onAvoidTunnel, tunnelBusy, tunnelAllowed,
      onAvoidLocal, localBusy, onBypass, bypassBusy, onLocalAnswer,
    }),
    el('ul', { class: 'summary-notes' }, notes.map((t) => el('li', { text: t }))),
    diagnosticBlock(current.route, rules?.[selected] ?? null, choice.toLabel ? `vers ${choice.toLabel}` : '', tunnelAllowed),
  );
  notesNode.hidden = false;
}

/** Fait apparaître la fiche choisie (après un toucher sur la carte, elle peut être hors du panneau). */
export function revealSelectedCard(node) {
  node.querySelector('.route-card[aria-checked="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
