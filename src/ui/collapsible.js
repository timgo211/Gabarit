// Bloc repliable commun (v84), repris de « Sources et licences » (v64) : titre = bouton natif (Entrée et Espace,
// zone tactile ≥ 48 px, chevron CSS selon aria-expanded), contenu masqué par `hidden` quand le bloc est replié
// (caché et non focusable). Sert aux sections de Réglages et au menu « Informations du trajet ».

import { el } from './dom.js';

/**
 * Relie un bouton et son contenu déjà présents dans la page.
 * @param {{ button:HTMLButtonElement, body:HTMLElement, open?:boolean, onToggle?:(open:boolean)=>void }} p
 * @returns {{ set:(open:boolean)=>void, isOpen:()=>boolean }}
 */
export function collapsible({ button, body, open = false, onToggle = null }) {
  if (body.id) button.setAttribute('aria-controls', body.id);
  const set = (o) => {
    button.setAttribute('aria-expanded', String(o));
    body.hidden = !o;
  };
  set(open === true);
  button.addEventListener('click', () => {
    const o = button.getAttribute('aria-expanded') !== 'true';
    set(o);
    onToggle?.(o);
  });
  return { set, isOpen: () => button.getAttribute('aria-expanded') === 'true' };
}

/**
 * Crée un bloc repliable : en-tête (titre, sous-ligne facultative, contenu en tête facultatif) et corps.
 * @param {{ id:string, title:string|Node, sub?:string|Node|null, lead?:Node|null, body:Node[], open?:boolean,
 *   onToggle?:(open:boolean)=>void, className?:string }} p
 * @returns {{ node:HTMLElement, button:HTMLButtonElement, body:HTMLElement, set:(open:boolean)=>void, isOpen:()=>boolean }}
 */
export function makeCollapsible({ id, title, sub = null, lead = null, body, open = false, onToggle = null, className = '' }) {
  const button = el('button', { type: 'button', class: 'section-toggle' }, [
    lead,
    el('span', { class: 'section-toggle-text' }, [
      el('span', { class: 'section-title' }, [title]),
      sub ? el('span', { class: 'section-sub' }, [sub]) : null,
    ]),
  ]);
  const bodyNode = el('div', { id: `${id}-body`, class: 'collapsible-body' }, body);
  const node = el('section', { id, class: `collapsible${className ? ` ${className}` : ''}` }, [button, bodyNode]);
  const c = collapsible({ button, body: bodyNode, open, onToggle });
  return { node, button, body: bodyNode, ...c };
}
