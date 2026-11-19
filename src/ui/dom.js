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
export function showMessage(node, text, type = 'error') {
  node.textContent = text ?? '';
  node.classList.toggle('info', type === 'info');
  node.hidden = !text;
}

/** Ferme un <dialog> au clic sur [data-close] ou sur le fond. */
export function wireDialog(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  });
}
