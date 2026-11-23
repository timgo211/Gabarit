// v48 : « à l'arrêt » hors guidage, pour « Éviter le tunnel » (aucune saisie en roulant, Code de la route
// art. R412-6-2). Relevé GPS toutes les 2 s seulement tant que la fiche propose le bouton ; vitesse du GPS, sinon
// déduite des deux derniers relevés (fixSpeedKmh) ; arrêt = parkedState (< 5 km/h pendant 3 s) ; vitesse inconnue,
// GPS refusé ou absent = en mouvement (bouton grisé). Rien n'est gardé ni envoyé.
import { parkedState, fixSpeedKmh } from '../lib/nav-layout.js';

const PERIOD_MS = 2000;

/** @param {{ onChange:(parked:boolean)=>void }} ctx */
export function createPlanPark({ onChange }) {
  let timer = null;
  let park = { since: null, parked: false };
  let last = null;
  let busy = false;

  const set = (kmh) => {
    const was = park.parked;
    park = parkedState(park, kmh, Date.now());
    if (was !== park.parked) onChange?.(park.parked);
  };

  const poll = () => {
    if (busy || !('geolocation' in navigator)) { if (!busy) set(null); return; }
    busy = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        busy = false;
        const cur = {
          lonlat: [pos.coords.longitude, pos.coords.latitude], t: Date.now(), accuracy: pos.coords.accuracy, speed: pos.coords.speed,
        };
        set(fixSpeedKmh(last, cur));
        last = cur;
      },
      () => { busy = false; last = null; set(null); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
  };

  return {
    /** Relevés tant que `on` ; arrêt des relevés (et « en mouvement ») sinon. */
    watch(on) {
      if (on && timer === null) {
        poll();
        timer = setInterval(poll, PERIOD_MS);
      } else if (!on && timer !== null) {
        clearInterval(timer);
        timer = null;
        last = null;
        set(null);
      }
    },
    get parked() { return park.parked; },
  };
}
