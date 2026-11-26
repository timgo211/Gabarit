// Phase 3a — Mes signalements : fiche d'un repère (#report-panel) et liste de Réglages › Mes signalements.
// Type, note, confirmation et suppression seulement à l'arrêt confirmé (canEditReports : parkedState, en guidage
// comme hors guidage ; vitesse inconnue = en mouvement, R412-6-2) : boutons grisés sinon. Textes en textContent.

import { $, el } from './dom.js';
import { pickShareMethod, shareResultText } from '../lib/share.js';
import {
  SHARE, shareFileSpec, parseShareFile, previewImport, previewText, canImportShare, confirmImport,
} from '../lib/reports-share.js';
import {
  REPORT, canEditReports, updateReport, removeReport, reportLabel, reportStatus, MOVING_TEXT,
} from '../lib/reports.js';

/** « 24/11/2026 14:05 » (date gardée au format 2026-11-24T14:05 ou 2026-11-24). */
function dateText(stamp) {
  const [d, t] = String(stamp).split('T');
  return `${d.split('-').reverse().join('/')}${t ? ` ${t}` : ''}`;
}

/**
 * @param {{ getList:()=>object[], setList:(list:object[])=>void, getParked:()=>boolean,
 *   onOpenChange?:(open:boolean)=>void }} ctx
 */
export function createReports(ctx) {
  const panel = $('#report-panel');
  const info = $('#report-info');
  const types = $('#report-types');
  const note = $('#report-note');
  const confirm = $('#report-confirm');
  const save = $('#btn-report-save');
  const del = $('#btn-report-del');
  const status = $('#report-status');
  const list = $('#reports-list');
  const listStatus = $('#reports-status');
  let openId = null;
  let chosen = null; // type choisi dans la fiche (pas encore enregistré)

  const allowed = () => canEditReports({ parked: ctx.getParked() === true });
  const find = (id) => ctx.getList().find((r) => r.id === id) ?? null;

  const typeButtons = Object.entries(REPORT.TYPES).map(([id, label]) => el('button', {
    type: 'button', class: 'btn', 'data-type': id, 'aria-pressed': 'false',
    text: label.charAt(0).toUpperCase() + label.slice(1),
    onclick: () => { if (!allowed()) return; chosen = chosen === id ? null : id; renderPanel(); },
  }));
  types.append(...typeButtons);

  function renderPanel() {
    const r = openId ? find(openId) : null;
    if (!r) { panel.hidden = true; return; }
    const ok = allowed();
    const imported = r.origin === 'imported';
    info.textContent = `${reportLabel(r)} · ${reportStatus(r)} · posé le ${dateText(r.createdAt)}${ok ? '' : ` · ${MOVING_TEXT}`}`;
    for (const b of typeButtons) {
      b.setAttribute('aria-pressed', String(b.dataset.type === chosen));
      b.disabled = !ok;
    }
    note.disabled = !ok;
    // Confirmation : un type choisi ; un signalement importé se confirme en le reprenant à mon compte.
    confirm.disabled = !ok || chosen === null;
    if (chosen === null) confirm.checked = false;
    confirm.parentElement.lastChild.textContent = imported ? ' Je confirme (je le reprends à mon compte)' : ' Je confirme ce signalement';
    save.disabled = !ok;
    del.disabled = !ok;
  }

  function renderList() {
    const ok = allowed();
    const items = ctx.getList();
    list.replaceChildren(...items.map((r) => el('li', { class: 'restr-item' }, [
      el('strong', { text: `${reportLabel(r)}${r.note ? ` — ${r.note}` : ''}` }),
      el('span', { class: 'hint', text: `${reportStatus(r)} · ${dateText(r.createdAt)} · ${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}` }),
      el('div', { class: 'row' }, [
        el('button', { type: 'button', class: 'btn reports-card-btn', disabled: !ok, onclick: () => open(r.id), text: 'Modifier' }),
        el('button', { type: 'button', class: 'btn reports-card-btn', disabled: !ok, onclick: () => remove(r.id, listStatus), text: 'Supprimer' }),
      ]),
    ])));
    if (!items.length) list.replaceChildren(el('li', { class: 'hint', text: 'Aucun signalement enregistré.' }));
    listStatus.textContent = items.length && !ok ? MOVING_TEXT : listStatus.textContent;
  }

  function render() {
    renderPanel();
    renderList();
    renderImport();
  }

  function remove(id, node) {
    if (!allowed()) { node.textContent = MOVING_TEXT; return; }
    ctx.setList(removeReport(ctx.getList(), id));
    node.textContent = 'Signalement supprimé.';
    if (openId === id) close();
    render();
  }

  function open(id) {
    const r = find(id);
    if (!r) return;
    openId = id;
    chosen = r.type;
    note.value = r.note;
    confirm.checked = r.confirmed;
    status.textContent = '';
    panel.hidden = false;
    ctx.onOpenChange?.(true);
    render();
  }

  function close() {
    if (openId === null && panel.hidden) return;
    openId = null;
    chosen = null;
    panel.hidden = true;
    status.textContent = '';
    ctx.onOpenChange?.(false);
  }

  save.addEventListener('click', () => {
    const r = openId ? find(openId) : null;
    if (!r) return;
    if (!allowed()) { status.textContent = MOVING_TEXT; renderPanel(); return; }
    const confirmed = confirm.checked && chosen !== null;
    ctx.setList(updateReport(ctx.getList(), r.id, {
      type: chosen, note: note.value, confirmed, adopt: confirmed && r.origin === 'imported',
    }));
    status.textContent = confirmed ? 'Signalement enregistré et confirmé.' : 'Signalement enregistré (à vérifier).';
    render();
  });
  del.addEventListener('click', () => { if (openId) remove(openId, status); });
  $('#btn-report-close').addEventListener('click', close);

  // Phase 3c : fichier pour un ami (partage Android si le navigateur accepte le fichier, sinon téléchargement).
  // v87 : .txt en text/plain (Chromium refuse application/json au partage), même contenu JSON.
  const shareStatus = $('#reports-share-status');
  $('#btn-reports-share').addEventListener('click', async () => {
    let spec;
    try {
      spec = shareFileSpec(ctx.getList(), { withNotes: $('#reports-share-notes').checked, now: new Date() });
    } catch (err) {
      shareStatus.textContent = err.message;
      return;
    }
    let file = null;
    try { file = new File([spec.content], spec.name, { type: spec.type }); } catch { file = null; }
    let canShareFiles = false;
    try { canShareFiles = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }); } catch { canShareFiles = false; }
    const method = pickShareMethod({ kind: 'file', hasShare: typeof navigator.share === 'function', canShareFiles });
    if (method === 'share') {
      try {
        await navigator.share({ files: [file], title: spec.title });
        shareStatus.textContent = '';
        return;
      } catch (err) {
        if (err?.name === 'AbortError') { shareStatus.textContent = ''; return; }
      }
    }
    try {
      const href = URL.createObjectURL(new Blob([spec.content], { type: spec.type }));
      const a = Object.assign(document.createElement('a'), { href, download: spec.name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
      shareStatus.textContent = SHARE.DOWNLOAD_TEXT;
    } catch {
      shareStatus.textContent = shareResultText('download', { failed: true });
    }
  });
  // Import : vérifié (taille, schéma, types), aperçu « N signalements à importer » puis « Importer » avant fusion.
  // v69 : à l'arrêt seulement (canImportShare, même règle que l'édition 3a) ; contrôle redit à « Importer ».
  const importInput = $('#reports-import-file');
  const importBtn = $('#btn-reports-import');
  const importHint = $('#reports-import-hint');
  const preview = $('#reports-import-preview');
  const previewNode = $('#reports-import-text');
  let pending = null; // { reports, dropped, summary } en attente de « Importer »
  const importAllowed = () => canImportShare({ parked: ctx.getParked() === true });
  importInput.accept = SHARE.ACCEPT; // v87 : .txt et anciens .json ; seul le contenu est vérifié (parseShareFile)

  function renderImport() {
    const ok = importAllowed();
    importInput.disabled = !ok;
    importBtn.setAttribute('aria-disabled', String(!ok));
    importHint.hidden = ok;
  }
  function closePreview() { pending = null; preview.hidden = true; previewNode.textContent = ''; }

  importBtn.addEventListener('click', (e) => {
    if (importAllowed()) return;
    e.preventDefault();
    shareStatus.textContent = SHARE.PARKED_ONLY_TEXT;
  });
  importInput.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    closePreview();
    if (!f) return;
    if (!importAllowed()) { shareStatus.textContent = SHARE.PARKED_ONLY_TEXT; renderImport(); return; }
    if (f.size > SHARE.MAX_BYTES) { shareStatus.textContent = 'Fichier trop gros (512 Ko au plus).'; return; }
    let text = '';
    try { text = await f.text(); } catch { shareStatus.textContent = 'Fichier illisible.'; return; }
    const r = parseShareFile(text);
    if (!r.ok) { shareStatus.textContent = r.error; return; }
    const p = previewImport(ctx.getList(), r.reports);
    if (!p.add) { shareStatus.textContent = 'Rien à importer : tous ces signalements sont déjà présents.'; return; }
    pending = { reports: r.reports, dropped: r.dropped, summary: previewText(p) };
    previewNode.textContent = pending.summary;
    shareStatus.textContent = '';
    preview.hidden = false;
  });
  $('#btn-reports-import-ok').addEventListener('click', () => {
    if (!pending) return;
    const { reports, dropped, summary } = pending;
    closePreview();
    const r = confirmImport(ctx.getList(), reports, { parked: ctx.getParked() === true });
    if (!r.ok) { shareStatus.textContent = r.text; render(); return; }
    ctx.setList(r.list);
    shareStatus.textContent = `Importé : ${summary}${dropped ? ` ${dropped} ligne(s) illisible(s) écartée(s).` : ''}`;
    render();
  });
  $('#btn-reports-import-cancel').addEventListener('click', () => { closePreview(); shareStatus.textContent = 'Import annulé.'; });

  render();
  return {
    render,
    open,
    close,
    get isOpen() { return !panel.hidden; },
  };
}
