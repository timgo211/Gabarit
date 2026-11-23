// Écran Réglages : clé ORS (masquée + test), mode nuit, guidage vocal (voix, vitesse, volume, annonce des aires PL),
// couleur de la flèche,
// prix du gazole, export/import des données, simulation de trajet (rubrique Test).

import { $, wireDialog } from './dom.js';
import { satelliteCredits } from '../lib/map-layers.js';
import { requestVersionLabel, versionLabel } from '../lib/app-version.js';
import { testKey } from './api.js';
import { exportData, readExport, parseDieselPrice } from '../lib/store.js';
import { formatPricePerLiter } from '../lib/format.js';
import { summarizeKeyTest } from '../lib/ors-errors.js';
import { sanitizeVoiceRate, sanitizeVoiceVolume } from '../lib/prefs.js';
import { sanitizeWindGust } from '../lib/wind.js';
import {
  ADR_CLASSES, ADR_TUNNEL_CODES, TUNNEL_CODE_HELP, sanitizeAdrSettings, cleanUnNumber, unNumberError,
} from '../lib/adr-settings.js';

/** Phrase de Réglages sur la musique pendant les consignes (phase 7c). */
const MUSIC_TEXT = {
  duck: 'Musique : elle baisse pendant chaque consigne, puis reprend.',
  none: 'Musique : Chrome ne permet pas à une page web de baisser ou couper la musique d\'une autre appli pendant '
    + 'une consigne. Selon le moteur de voix d\'Android, le son peut baisser tout seul ; sinon, baisse la musique '
    + 'ou monte le volume de la voix ci-dessus.',
};

function setStatus(node, text, ok) {
  node.textContent = text;
  node.className = `status ${ok === true ? 'ok' : ok === false ? 'err' : ok === 'warn' ? 'warn' : ''}`;
}

/**
 * @param {{ store, getData:()=>object, onDataReplaced:(data)=>void, onThemeChange:(mode)=>void,
 *   onVoiceChange:(on:boolean)=>void, onTestVoice:()=>string, onSimSpeedChange:(kmh:number)=>void,
 *   onSimulate:()=>string|null, onDieselPriceChange:(price:number|null)=>void,
 *   getVoices:()=>SpeechSynthesisVoice[], onVoicesChanged:(cb)=>void, canDuckMedia:boolean,
 *   onVoiceOptions:(o:{name,rate,volume})=>void, onArrowColor:(c:string)=>void,
 *   onAreaVoiceChange?:(on:boolean)=>void, onRuleVoiceChange?:(on:boolean)=>void,
 *   onDriveVoiceChange?:(on:boolean)=>void, onWindVoiceChange?:(on:boolean)=>void, onWindGustChange?:(g:number)=>void,
 *   onDrivingReset?:()=>void, onAdrChange?:(adr:object)=>void }} ctx
 *   onTestVoice renvoie un message d'état ; onSimulate renvoie un message d'erreur, ou null si la simulation démarre.
 */
/** Phase 7d : crédits des photos aériennes (texte seulement, lien vers la licence). */
function renderSatelliteCredits() {
  const list = document.querySelector('#satellite-credit-list');
  if (!list) return;
  list.replaceChildren(...satelliteCredits().map((c) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = c.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = c.text;
    li.append(a);
    return li;
  }));
}

export function createSettings(ctx) {
  renderSatelliteCredits();
  const dlg = $('#dlg-settings');
  const keyInput = $('#key-input');
  const keyStatus = $('#key-status');
  const dataStatus = $('#data-status');
  const voiceStatus = $('#voice-status');
  const simStatus = $('#sim-status');
  const voiceEnabled = $('#voice-enabled');
  const areaVoice = $('#area-voice');
  const ruleVoice = $('#rule-voice');
  const driveVoice = $('#drive-voice');
  const bridgeWarnings = $('#bridge-warnings');
  const weightWarnings = $('#weight-warnings');
  const windVoice = $('#wind-voice');
  const speedVoice = $('#speed-voice');
  const windGust = $('#wind-gust');
  const windStatus = $('#wind-status');
  const drivingStatus = $('#driving-status');
  const dieselInput = $('#diesel-price');
  const dieselStatus = $('#diesel-status');
  const voiceName = $('#voice-name');
  const voiceRate = $('#voice-rate');
  const voiceVolume = $('#voice-volume');
  const adrEnabled = $('#adr-enabled');
  const adrFields = $('#adr-fields');
  const adrClass = $('#adr-class');
  const adrUn = $('#adr-un');
  const adrTunnel = $('#adr-tunnel');
  const adrStatus = $('#adr-status');
  wireDialog(dlg);
  $('#adr-tunnel-help').textContent = TUNNEL_CODE_HELP;
  adrClass.append(...ADR_CLASSES.map((c) => new Option(c.label, c.value)));
  $('#voice-music').textContent = ctx.canDuckMedia ? MUSIC_TEXT.duck : MUSIC_TEXT.none;

  const rateText = (r) => String(r).replace('.', ',');
  const volumeText = (v) => `${Math.round(v * 100)} %`;

  /** Liste des voix françaises installées (Chrome la charge parfois après l'ouverture). */
  function fillVoices(selected) {
    const keep = selected ?? voiceName.value;
    const auto = voiceName.options[0];
    const opts = ctx.getVoices().map((v) => {
      const o = document.createElement('option');
      o.value = v.name;
      o.textContent = `${v.name} (${v.lang.replace('_', '-')})`;
      return o;
    });
    voiceName.replaceChildren(auto, ...opts);
    if (keep && !opts.some((o) => o.value === keep)) {
      const o = document.createElement('option'); // voix enregistrée mais pas (encore) listée
      o.value = keep;
      o.textContent = `${keep} (non disponible)`;
      voiceName.append(o);
    }
    voiceName.value = keep;
  }
  ctx.onVoicesChanged?.(() => fillVoices());

  function voiceOptions() {
    return { name: voiceName.value, rate: sanitizeVoiceRate(voiceRate.value), volume: sanitizeVoiceVolume(voiceVolume.value) };
  }
  function showVoiceValues() {
    $('#voice-rate-out').textContent = rateText(sanitizeVoiceRate(voiceRate.value));
    $('#voice-volume-out').textContent = volumeText(sanitizeVoiceVolume(voiceVolume.value));
  }

  function syncChoices(settings) {
    for (const r of dlg.querySelectorAll('input[name="theme"]')) r.checked = r.value === settings.theme;
    for (const r of dlg.querySelectorAll('input[name="night-level"]')) r.checked = r.value === settings.nightMapLevel;
    for (const r of dlg.querySelectorAll('input[name="sim-speed"]')) r.checked = Number(r.value) === settings.simSpeed;
    voiceEnabled.checked = settings.voice;
    areaVoice.checked = settings.areaVoice;
    ruleVoice.checked = settings.ruleVoice;
    driveVoice.checked = settings.driveVoice;
    bridgeWarnings.checked = settings.bridgeWarnings !== false;
    weightWarnings.checked = settings.weightWarnings !== false;
    windVoice.checked = settings.windVoice;
    speedVoice.checked = settings.speedVoice === true;
    windGust.value = String(settings.windGust);
    fillVoices(settings.voiceName);
    voiceRate.value = String(settings.voiceRate);
    voiceVolume.value = String(settings.voiceVolume);
    showVoiceValues();
    for (const r of dlg.querySelectorAll('input[name="arrow-color"]')) r.checked = r.value === settings.arrowColor;
    for (const r of dlg.querySelectorAll('input[name="vehicle-icon"]')) r.checked = r.value === settings.vehicleIcon;
    dieselInput.value = formatPricePerLiter(settings.dieselPrice);
    syncAdr(settings.adr);
  }

  /** Matières dangereuses (phase 5b) : code tunnel vide, B, C, D, E ; « sans code » seulement s'il vient d'un ancien profil. */
  function syncAdr(raw) {
    const a = sanitizeAdrSettings(raw);
    adrEnabled.checked = a.enabled;
    adrFields.hidden = !a.enabled;
    adrClass.value = a.adrClass;
    adrUn.value = a.unNumber;
    adrUn.classList.remove('invalid');
    const codes = a.tunnelCode === 'none' ? [...ADR_TUNNEL_CODES, 'none'] : ADR_TUNNEL_CODES;
    adrTunnel.replaceChildren(...codes.map((c) => new Option(
      c === '' ? 'Vide (aucune alerte tunnel)' : c === 'none' ? 'Sans code (repris du profil)' : c, c,
    )));
    adrTunnel.value = a.tunnelCode;
  }

  /** Enregistre le chargement à chaque changement ; numéro ONU mal saisi : rien d'enregistré, message. */
  function saveAdr() {
    adrFields.hidden = !adrEnabled.checked;
    const err = unNumberError(adrUn.value);
    adrUn.classList.toggle('invalid', !!err);
    if (err) { setStatus(adrStatus, err, false); return; }
    const adr = sanitizeAdrSettings({
      enabled: adrEnabled.checked, adrClass: adrClass.value, unNumber: cleanUnNumber(adrUn.value), tunnelCode: adrTunnel.value,
    });
    adrUn.value = adr.unNumber;
    ctx.onAdrChange?.(adr);
    setStatus(adrStatus, adr.enabled ? 'Enregistré : vaut pour le prochain calcul d\'itinéraire.' : 'Enregistré : aucune matière dangereuse.', true);
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
    setStatus(windStatus, '');
    setStatus(drivingStatus, '');
    setStatus(adrStatus, '');
    syncChoices(ctx.getData().settings);
    showVersion();
    ctx.onOpen?.(); // phase 12b : Mes restrictions relue (liste, boutons grisés en roulant)
    dlg.showModal();
  }

  // Version du service worker qui contrôle la page (celle qui tourne), demandée à chaque ouverture.
  function showVersion() {
    const line = $('#app-version');
    line.textContent = versionLabel(null);
    requestVersionLabel(navigator.serviceWorker?.controller).then((label) => { line.textContent = label; });
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
  // Luminosité de la carte la nuit (phase 2d) : appliquée tout de suite, sans rechargement.
  for (const r of dlg.querySelectorAll('input[name="night-level"]')) {
    r.addEventListener('change', () => { if (r.checked) ctx.onNightLevelChange?.(r.value); });
  }

  voiceEnabled.addEventListener('change', () => ctx.onVoiceChange(voiceEnabled.checked));
  areaVoice.addEventListener('change', () => ctx.onAreaVoiceChange?.(areaVoice.checked));
  for (const n of [adrEnabled, adrClass, adrUn, adrTunnel]) n.addEventListener('change', saveAdr);
  ruleVoice.addEventListener('change', () => ctx.onRuleVoiceChange?.(ruleVoice.checked));
  driveVoice.addEventListener('change', () => ctx.onDriveVoiceChange?.(driveVoice.checked));
  bridgeWarnings.addEventListener('change', () => ctx.onBridgeWarningsChange?.(bridgeWarnings.checked));
  weightWarnings.addEventListener('change', () => ctx.onWeightWarningsChange?.(weightWarnings.checked));
  windVoice.addEventListener('change', () => ctx.onWindVoiceChange?.(windVoice.checked));
  speedVoice.addEventListener('change', () => ctx.onSpeedVoiceChange?.(speedVoice.checked));
  $('#btn-wind-save').addEventListener('click', () => {
    const g = sanitizeWindGust(windGust.value);
    windGust.value = String(g);
    ctx.onWindGustChange?.(g);
    setStatus(windStatus, `Alerte à partir de rafales de ${g} km/h.`, true);
  });
  $('#btn-driving-reset').addEventListener('click', () => {
    if (!window.confirm('Remettre le temps de conduite à zéro (début de journée, autre camion…) ?')) return;
    ctx.onDrivingReset?.();
    setStatus(drivingStatus, 'Temps de conduite remis à zéro.', true);
  });
  $('#btn-voice-test').addEventListener('click', () => setStatus(voiceStatus, ctx.onTestVoice()));
  voiceName.addEventListener('change', () => ctx.onVoiceOptions(voiceOptions()));
  for (const input of [voiceRate, voiceVolume]) {
    input.addEventListener('input', showVoiceValues);
    input.addEventListener('change', () => ctx.onVoiceOptions(voiceOptions()));
  }
  for (const r of dlg.querySelectorAll('input[name="arrow-color"]')) {
    r.addEventListener('change', () => { if (r.checked) ctx.onArrowColor(r.value); });
  }
  for (const r of dlg.querySelectorAll('input[name="vehicle-icon"]')) {
    r.addEventListener('change', () => { if (r.checked) ctx.onVehicleIcon?.(r.value); });
  }

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

  $('#btn-export').addEventListener('click', async () => {
    try {
      // Phase 6 : historique des trajets (IndexedDB) inclus ; indisponible → export sans lui, dit dans le message.
      const history = (await ctx.getHistory?.()) ?? null;
      const json = exportData(ctx.getData(), new Date(), history);
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `gabarit-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setStatus(dataStatus, `Export prêt (dossier Téléchargements). La clé n'y figure pas.${history === null ? ' Historique des trajets indisponible : non inclus.' : ''}`, true);
    } catch (err) {
      setStatus(dataStatus, `Export impossible : ${err.message}`, false);
    }
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { data, history } = readExport(await file.text());
      if (!window.confirm(`Remplacer les données actuelles par celles du fichier (${data.vehicles.length} véhicule(s)) ?`)) return;
      ctx.onDataReplaced(data);
      if (history.length) await ctx.onHistoryImported?.(history); // phase 6 : ajouté à l'historique de l'appareil
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
