// Petits utilitaires DOM.

export const $ = (sel, root = document) => root.querySelector(sel);

/** Crée un élément : el('p', { class: 'x', text: 'y' }, [enfants]). */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c !== null && c !== undefined && c !== false) node.append(c);
  }
  return node;
}

/** Affiche un message dans un bloc (type 'error' par défaut, ou 'info'). Message vide → masqué. */
export function showMessage(node, text, type = 'error', detail = '') {
  node.textContent = text ?? '';
  // Phase 5h bis : réponse technique du service (code, message), en petit sous le message.
  if (text && detail) node.append(Object.assign(document.createElement('small'), { className: 'message-detail', textContent: detail }));
  node.classList.toggle('info', type === 'info');
  node.hidden = !text;
}

/** Ferme un <dialog> au clic sur [data-close] ou sur le fond. */
export function wireDialog(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  });
}

/** Écrit « valeur unité » avec l'unité dans un <span class="unit"> (plus petite), sans HTML. */
export function setValueUnit(node, value, unit) {
  if (!unit) { node.textContent = value; return; }
  const u = document.createElement('span');
  u.className = 'unit';
  u.textContent = unit;
  node.replaceChildren(document.createTextNode(value), u);
}

/**
 * Réduit la taille du texte d'un élément (par pas de 6 %, jusqu'à minScale) tant qu'il dépasse de sa case.
 * Sert aux cases étroites du guidage sur téléphone (« 110 km/h », « 1 h 45 »).
 */
export function fitText(node, minScale = 0.6) {
  node.style.fontSize = '';
  // Hauteur aussi pour un texte coupé à N lignes (line-clamp) : on réduit plutôt que de perdre la fin.
  const over = () => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight + 1;
  if (!node.clientWidth || !over()) return;
  const base = parseFloat(getComputedStyle(node).fontSize);
  let scale = 1;
  while (over() && scale > minScale) {
    scale = Math.max(minScale, scale - 0.06);
    node.style.fontSize = `${(base * scale).toFixed(1)}px`;
  }
}
