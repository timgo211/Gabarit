// Boutons « Plan / Satellite » sur la carte et message « Vue satellite indisponible à cet endroit » (phase 7d).
// Ce qu'il faut montrer est décidé par src/lib/map-layers.js (satelliteView) ; ici, seulement l'affichage.

import { sanitizeMapLayer } from '../lib/map-layers.js';

/**
 * @param {{ root:HTMLElement, message:HTMLElement, initial:string, onChange:(layer:string)=>void }} p
 */
export function createLayerSwitch({ root, message, initial, onChange }) {
  let layer = sanitizeMapLayer(initial);
  const buttons = [...root.querySelectorAll('[data-layer]')];

  function paint() {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.layer === layer));
  }

  for (const b of buttons) {
    b.addEventListener('click', () => {
      const next = sanitizeMapLayer(b.dataset.layer);
      if (next === layer) return;
      layer = next;
      paint();
      onChange(layer);
    });
  }
  paint();

  return {
    /** @param {{ photos:boolean, message:string, button:boolean }} view */
    render(view) {
      root.hidden = !view.button;
      message.textContent = view.message;
      message.hidden = !view.message || !view.button;
    },
  };
}
