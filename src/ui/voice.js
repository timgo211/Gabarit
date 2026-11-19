// Voix française (Web Speech API, speechSynthesis).
// Chrome refuse speak() tant que la page n'a reçu aucune action de l'utilisateur (retiré en Chrome 71) :
// la première phrase est dite dans le geste « Démarrer » / « Tester la voix ».

import { pickFrenchVoice } from '../lib/nav-guidance.js';

export function createVoice({ enabled = true } = {}) {
  const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  const supported = !!synth && typeof window.SpeechSynthesisUtterance === 'function';
  let voice = null;
  let on = enabled;

  const refresh = () => {
    try {
      voice = pickFrenchVoice(synth.getVoices());
    } catch {
      voice = null;
    }
  };
  if (supported) {
    refresh();
    synth.addEventListener?.('voiceschanged', refresh);
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
    setEnabled(v) {
      on = !!v;
      if (!on && supported) synth.cancel();
    },
    /**
     * @param {string} text
     * @param {{ interrupt?:boolean, force?:boolean }} opts interrupt : coupe la phrase en cours (manœuvre imminente) ;
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
      u.rate = 1;
      u.volume = 1;
      synth.speak(u);
      return true;
    },
    cancel() {
      if (supported) synth.cancel();
    },
  };
}
