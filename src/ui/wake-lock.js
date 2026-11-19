// Écran maintenu allumé pendant le guidage (Screen Wake Lock API).
// Seule une page visible peut obtenir le verrou ; le système le relâche quand l'appli passe en arrière-plan
// (ou batterie faible) : on le redemande au retour sur l'appli.
// https://developer.mozilla.org/docs/Web/API/Screen_Wake_Lock_API

/** @param {(active:boolean)=>void} onChange */
export function createWakeLock(onChange) {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  let sentinel = null;
  let wanted = false;

  const notify = () => onChange?.(!!sentinel);

  async function acquire() {
    if (!supported || !wanted || sentinel || document.visibilityState !== 'visible') {
      notify();
      return;
    }
    try {
      const s = await navigator.wakeLock.request('screen');
      if (!wanted) {
        await s.release().catch(() => {});
        return;
      }
      sentinel = s;
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null;
        notify();
      });
    } catch {
      sentinel = null; // refusé : économie d'énergie, batterie faible…
    }
    notify();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquire();
  });

  return {
    supported,
    get active() {
      return !!sentinel;
    },
    enable() {
      wanted = true;
      return acquire();
    },
    async disable() {
      wanted = false;
      const s = sentinel;
      sentinel = null;
      if (s) await s.release().catch(() => {});
      notify();
    },
  };
}
