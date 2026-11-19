// Écran Réglages : clé ORS (masquée + test), mode nuit, guidage vocal, prix du gazole, export/import des données,
// simulation de trajet (rubrique Test).

import { $, wireDialog } from './dom.js';
import { testKey } from './api.js';
import { exportData, importData, parseDieselPrice } from '../lib/store.js';
import { formatPricePerLiter } from '../lib/format.js';
import { summarizeKeyTest } from '../lib/ors-errors.js';

function setStatus(node, text, ok) {
  node.textContent = text;
  node.className = `status ${ok === true ? 'ok' : ok === false ? 'err' : ok === 'warn' ? 'warn' : ''}`;
}

/**
 * @param {{ store, getData:()=>object, onDataReplaced:(data)=>void, onThemeChange:(mode)=>void,
 *   onVoiceChange:(on:boolean)=>void, onTestVoice:()=>string, onSimSpeedChange:(kmh:number)=>void,
 *   onSimulate:()=>string|null, onDieselPriceChange:(price:number|null)=>void }} ctx
 *   onTestVoice renvoie un message d'état ; onSimulate renvoie un message d'erreur, ou null si la simulation démarre.
 */
export function createSettings(ctx) {
  const dlg = $('#dlg-settings');
  const keyInput = $('#key-input');
  const keyStatus = $('#key-status');
  const dataStatus = $('#data-status');
  const voiceStatus = $('#voice-status');
  const simStatus = $('#sim-status');
  const voiceEnabled = $('#voice-enabled');
  const dieselInput = $('#diesel-price');
  const dieselStatus = $('#diesel-status');
  wireDialog(dlg);

  function syncChoices(settings) {
    for (const r of dlg.querySelectorAll('input[name="theme"]')) r.checked = r.value === settings.theme;
    for (const r of dlg.querySelectorAll('input[name="sim-speed"]')) r.checked = Number(r.value) === settings.simSpeed;
    voiceEnabled.checked = settings.voice;
    dieselInput.value = formatPricePerLiter(settings.dieselPrice);
  }

  function open() {
    keyInput.value = ctx.store.getApiKey();
    keyInput.type = 'password';
    $('#btn-key-show').setAttribute('aria-pressed', 'false');
    setStatus(keyStatus, keyInput.value ? 'Clé enregistrée sur cet appareil.' : 'Aucune clé enregistrée.', keyInput.value ? null : false);
    setStatus(dataStatus, '');
    setStatus(voiceStatus, '');
    setStatus(simStatus, '');
    setStatus(dieselStatus, '');
    syncChoices(ctx.getData().settings);
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
      const res = summarizeKeyTest(await testKey(key), key);
      if (res.saveKey) ctx.store.setApiKey(key);
      setStatus(keyStatus, res.message, res.level === 'ok' ? true : res.level === 'warn' ? 'warn' : false);
    } catch (err) {
      setStatus(keyStatus, err.message, false);
    } finally {
      btn.disabled = false;
    }
  });

  for (const r of dlg.querySelectorAll('input[name="theme"]')) {
    r.addEventListener('change', () => { if (r.checked) ctx.onThemeChange(r.value); });
  }

  voiceEnabled.addEventListener('change', () => ctx.onVoiceChange(voiceEnabled.checked));
  $('#btn-voice-test').addEventListener('click', () => setStatus(voiceStatus, ctx.onTestVoice()));

  $('#btn-diesel-save').addEventListener('click', () => {
    const { value, error } = parseDieselPrice(dieselInput.value);
    if (error) {
      setStatus(dieselStatus, error, false);
      return;
    }
    ctx.onDieselPriceChange(value);
    dieselInput.value = formatPricePerLiter(value);
    setStatus(dieselStatus, value === null
      ? 'Prix effacé : les fiches n\'affichent plus que les litres.'
      : `Prix enregistré : ${formatPricePerLiter(value)} €/L.`, true);
  });

  for (const r of dlg.querySelectorAll('input[name="sim-speed"]')) {
    r.addEventListener('change', () => { if (r.checked) ctx.onSimSpeedChange(Number(r.value)); });
  }
  $('#btn-simulate').addEventListener('click', () => {
    const err = ctx.onSimulate();
    if (err) setStatus(simStatus, err, false);
    else dlg.close();
  });

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
      syncChoices(data.settings);
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
