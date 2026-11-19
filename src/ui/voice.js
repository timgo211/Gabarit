// Voix française (Web Speech API, speechSynthesis).
// Chrome refuse speak() tant que la page n'a reçu aucune action de l'utilisateur (retiré en Chrome 71) :
// la première phrase est dite dans le geste « Démarrer » / « Tester la voix ».
//
// Phase 7c : voix choisie parmi les voix françaises installées, vitesse et volume (Réglages).
// Musique pendant les consignes : l'Audio Session API (navigator.audioSession, type « transient » = baisser les
// autres sons) n'existe que dans Safari 16.4+ ; Chrome (Android compris) ne l'a pas (MDN browser-compat-data,
// api/AudioSession.json). Si elle est présente, on la règle ; sinon, Réglages explique la limite.

import { pickVoice, frenchVoices } from '../lib/nav-guidance.js';
import { sanitizeVoiceRate, sanitizeVoiceVolume, sanitizeVoiceName } from '../lib/prefs.js';

/** La page peut-elle demander au système de baisser la musique pendant une phrase ? */
export const canDuckMedia = typeof navigator !== 'undefined' && !!navigator.audioSession
  && 'type' in navigator.audioSession;

export function createVoice({ enabled = true, name = '', rate = 1, volume = 1 } = {}) {
  const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  const supported = !!synth && typeof window.SpeechSynthesisUtterance === 'function';
  let voice = null;
  let on = enabled;
  let opts = { name: sanitizeVoiceName(name), rate: sanitizeVoiceRate(rate), volume: sanitizeVoiceVolume(volume) };
  const listeners = new Set();

  const allVoices = () => {
    try {
      return synth.getVoices();
    } catch {
      return [];
    }
  };
  const refresh = () => {
    voice = pickVoice(allVoices(), opts.name);
  };
  if (supported) {
    refresh();
    synth.addEventListener?.('voiceschanged', () => {
      refresh();
      for (const cb of listeners) cb();
    });
  }
  if (canDuckMedia) {
    try {
      navigator.audioSession.type = 'transient'; // la musique baisse pendant la phrase, puis reprend
    } catch {
      // sans effet si refusé
    }
  }

  return {
    supported,
    get enabled() {
      return on;
    },
    /** Nom de la voix française utilisée (ou celle par défaut de l'appareil). */
    get voiceName() {
      return voice?.name ?? '';
    },
    /** Voix françaises installées (pour la liste de Réglages). */
    voices() {
      return supported ? frenchVoices(allVoices()) : [];
    },
    /** Appelé quand la liste des voix arrive (Chrome la charge après le démarrage). */
    onVoicesChanged(cb) {
      listeners.add(cb);
    },
    /** Voix, vitesse et volume choisis dans Réglages. */
    setOptions(next) {
      opts = {
        name: sanitizeVoiceName(next.name ?? opts.name),
        rate: sanitizeVoiceRate(next.rate ?? opts.rate),
        volume: sanitizeVoiceVolume(next.volume ?? opts.volume),
      };
      if (supported) refresh();
    },
    setEnabled(v) {
      on = !!v;
      if (!on && supported) synth.cancel();
    },
    /**
     * @param {string} text
     * @param {{ interrupt?:boolean, force?:boolean }} o interrupt : coupe la phrase en cours (manœuvre imminente) ;
     *   force : parle même si la voix est coupée (bouton « Tester la voix »).
     */
    speak(text, { interrupt = false, force = false } = {}) {
      if (!supported || !text || (!on && !force)) return false;
      if (!voice) refresh();
      if (interrupt) synth.cancel();
      if (synth.paused) synth.resume();
      const u = new window.SpeechSynthesisUtterance(text);
      u.lang = voice?.lang?.replace('_', '-') || 'fr-FR';
      if (voice) u.voice = voice;
      u.rate = opts.rate;
      u.volume = opts.volume;
      synth.speak(u);
      return true;
    },
    cancel() {
      if (supported) synth.cancel();
    },
  };
}
