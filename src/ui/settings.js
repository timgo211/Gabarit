// Écran Réglages : clé ORS (masquée + test), mode nuit, export/import des données.

import { $, wireDialog } from './dom.js';
import { testKey } from './api.js';
import { exportData, importData } from '../lib/store.js';

function setStatus(node, text, ok) {
  node.textContent = text;
  node.className = `status ${ok === true ? 'ok' : ok === false ? 'err' : ''}`;
}

/**
 * @param {{ store, getData:()=>object, onDataReplaced:(data)=>void, onThemeChange:(mode)=>void }} ctx
 */
export function createSettings(ctx) {
  const dlg = $('#dlg-settings');
  const keyInput = $('#key-input');
  const keyStatus = $('#key-status');
  const dataStatus = $('#data-status');
  wireDialog(dlg);

  function open() {
    keyInput.value = ctx.store.getApiKey();
    keyInput.type = 'password';
    $('#btn-key-show').setAttribute('aria-pressed', 'false');
    setStatus(keyStatus, keyInput.value ? 'Clé enregistrée sur cet appareil.' : 'Aucune clé enregistrée.', keyInput.value ? null : false);
    setStatus(dataStatus, '');
    const theme = ctx.getData().settings.theme;
    for (const r of dlg.querySelectorAll('input[name="theme"]')) r.checked = r.value === theme;
    dlg.showModal();
  }

  $('#btn-settings').addEventListener('click', open);

  $('#btn-key-show').addEventListener('click', (e) => {
    const show = keyInput.type === 'password';
    keyInput.type = show ? 'text' : 'password';
    e.currentTarget.setAttribute('aria-pressed', String(show));
  });

  $('#btn-key-save').addEventListener('click', () => {
    ctx.store.setApiKey(keyInput.value);
    setStatus(keyStatus, keyInput.value.trim() ? 'Clé enregistrée sur cet appareil.' : 'Clé effacée.', true);
  });

  $('#btn-key-clear').addEventListener('click', () => {
    keyInput.value = '';
    ctx.store.setApiKey('');
    setStatus(keyStatus, 'Clé effacée de cet appareil.', true);
  });

  $('#btn-key-test').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const key = keyInput.value.trim();
    btn.disabled = true;
    setStatus(keyStatus, 'Test en cours…');
    try {
      await testKey(key);
      ctx.store.setApiKey(key);
      setStatus(keyStatus, 'Clé valide ✔ (enregistrée sur cet appareil).', true);
    } catch (err) {
      const msg = err.kind === 'quota' ? 'Clé reconnue, mais quota dépassé pour aujourd\'hui.' : err.message;
      setStatus(keyStatus, msg, err.kind === 'quota' ? null : false);
    } finally {
      btn.disabled = false;
    }
  });

  for (const r of dlg.querySelectorAll('input[name="theme"]')) {
    r.addEventListener('change', () => { if (r.checked) ctx.onThemeChange(r.value); });
  }

  $('#btn-export').addEventListener('click', () => {
    try {
      const json = exportData(ctx.getData());
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `gabarit-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setStatus(dataStatus, 'Export prêt (dossier Téléchargements). La clé n\'y figure pas.', true);
    } catch (err) {
      setStatus(dataStatus, `Export impossible : ${err.message}`, false);
    }
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = importData(await file.text());
      if (!window.confirm(`Remplacer les données actuelles par celles du fichier (${data.vehicles.length} véhicule(s)) ?`)) return;
      ctx.onDataReplaced(data);
      setStatus(dataStatus, 'Données importées.', true);
      for (const r of dlg.querySelectorAll('input[name="theme"]')) r.checked = r.value === data.settings.theme;
    } catch (err) {
      setStatus(dataStatus, err.message, false);
    }
  });

  return {
    setPersistStatus(text) {
      $('#persist-status').textContent = text;
    },
  };
}
