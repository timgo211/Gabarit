// Écran de guidage : source de positions (GPS réel ou simulation), moteur de navigation, voix, carte, écran allumé.
// Toutes les décisions (annonces, recalcul, arrivée) viennent de src/lib/navigation.js ; la simulation
// (src/lib/nav-sim.js) passe par exactement le même chemin que le GPS : onFix().
//
// Code de la route, art. R412-6-2 (Légifrance) : un écran allumé dans le champ de vision du conducteur n'est permis
// que s'il sert d'aide à la conduite ou à la navigation. Pendant le guidage, l'écran ne montre donc que la carte
// et le guidage, sans aucune saisie : trois gros boutons (voix, recentrer, arrêter).

import { $ } from './dom.js';
import { maneuverSvg } from './nav-icon.js';
import { fetchRoute } from './api.js';
import {
  startNavigation, updateNavigation, rerouteDone, rerouteFailed, gpsLost, fixFromPosition,
} from '../lib/navigation.js';
import { createSimulator, SIM_SPEEDS } from '../lib/nav-sim.js';
import { formatNavDistance, formatDistance, formatDuration, formatArrival, formatSpeed } from '../lib/format.js';
import { ERROR_KINDS } from '../lib/ors-errors.js';

const RECENTER_AFTER_MS = 15000;
const SIM_TICK_MS = 1000;
const RELEASE_SCREEN_AFTER_ARRIVAL_MS = 120000;

/**
 * @param {{ map:object, voice:object, wakeLock:object, getApiKey:()=>string,
 *   onVoiceToggle:(on:boolean)=>void, onSimSpeedChange:(kmh:number)=>void,
 *   onRouteChange:(route:object)=>void, onEnd:(message?:string)=>void }} ctx
 */
export function createNavigation(ctx) {
  const app = $('.app');
  const root = $('#nav');
  const ui = {
    icon: $('#nav-icon'),
    dist: $('#nav-dist'),
    instr: $('#nav-instr'),
    then: $('#nav-then'),
    alert: $('#nav-alert'),
    remaining: $('#nav-remaining'),
    time: $('#nav-time'),
    eta: $('#nav-eta'),
    speed: $('#nav-speed'),
    screen: $('#nav-screen'),
    sim: $('#nav-sim'),
    simSpeed: $('#btn-sim-speed'),
    simOffroad: $('#btn-sim-offroad'),
    voice: $('#btn-nav-voice'),
    recenter: $('#btn-nav-recenter'),
    stop: $('#btn-nav-stop'),
    bottom: $('.nav-bottom'),
  };
  let s = null; // session de guidage en cours

  function cameraPadding() {
    const h = root.clientHeight || window.innerHeight;
    const bottom = ui.bottom?.offsetHeight ?? 0;
    // Véhicule dans le bas de l'écran (au-dessus de la barre) : on voit loin devant.
    return { top: Math.round(h * 0.5), bottom: Math.min(bottom, Math.round(h * 0.3)), left: 0, right: 0 };
  }

  function renderVoice() {
    const on = ctx.voice.enabled;
    ui.voice.textContent = on ? '🔊 Voix' : '🔇 Muet';
    ui.voice.setAttribute('aria-pressed', String(on));
    ui.voice.disabled = !ctx.voice.supported;
  }

  function setIcon(icon) {
    ui.icon.replaceChildren(maneuverSvg(icon));
  }

  function alertText(view) {
    if (!s) return '';
    if (view?.arrived) return '';
    if (s.gpsLost) return s.sim ? '' : 'Signal GPS perdu : la position n\'est plus à jour.';
    if (view?.rerouting) return 'Hors itinéraire : recalcul en cours…';
    if (s.error && view && !view.onRoute) return `Recalcul impossible : ${s.error}`;
    if (view?.rerouteBlocked && !view.onRoute) return 'Hors itinéraire. Recalcul indisponible : rejoins l\'itinéraire.';
    return '';
  }

  function renderAlert(view) {
    const text = alertText(view);
    ui.alert.textContent = text;
    ui.alert.hidden = !text;
  }

  function render(view) {
    if (view.arrived) {
      setIcon({ kind: 'goal' });
      ui.dist.textContent = '';
      ui.instr.textContent = 'Destination atteinte';
      ui.then.hidden = true;
      ui.stop.textContent = '✔ Terminer';
    } else if (view.maneuver) {
      setIcon(view.maneuver.icon);
      ui.dist.textContent = formatNavDistance(view.maneuver.distance);
      ui.instr.textContent = view.maneuver.text;
      if (view.then) {
        ui.then.textContent = `Puis : ${view.then.text}`;
        ui.then.hidden = false;
      } else {
        ui.then.hidden = true;
      }
    } else {
      setIcon({ kind: 'arrow', angle: 0 });
      ui.dist.textContent = '';
      ui.instr.textContent = 'Suivez l\'itinéraire';
      ui.then.hidden = true;
    }
    ui.remaining.textContent = formatDistance(view.remainingDistance);
    ui.time.textContent = formatDuration(view.remainingDuration);
    ui.eta.textContent = formatArrival(new Date(), view.remainingDuration);
    ui.speed.textContent = formatSpeed(view.speedKmh);
    if (s.sim) ui.simOffroad.disabled = s.sim.mode !== 'route' || view.arrived;
    renderAlert(view);

    ctx.map.setVehicle(view.position, view.bearing);
    if (s.follow) {
      ctx.map.follow({ center: view.position, bearing: view.bearing, zoom: view.zoom, pitch: view.pitch, padding: cameraPadding() });
    }
  }

  function handle(events) {
    for (const e of events) {
      if (e.type === 'speak') ctx.voice.speak(e.text, { interrupt: !!e.interrupt });
      else if (e.type === 'reroute') reroute(e.from);
      else if (e.type === 'arrived') {
        clearTimeout(s.releaseTimer);
        s.releaseTimer = setTimeout(() => ctx.wakeLock.disable(), RELEASE_SCREEN_AFTER_ARRIVAL_MS);
      }
    }
  }

  /** Point d'entrée unique des positions (GPS réel ou simulé). */
  function onFix(fix) {
    if (!s) return;
    const r = updateNavigation(s.state, fix);
    if (!r.view) return;
    s.state = r.state;
    s.view = r.view;
    s.gpsLost = false;
    if (r.view.onRoute) s.error = '';
    render(r.view);
    handle(r.events);
  }

  async function reroute(from) {
    const session = s;
    renderAlert(s.view);
    try {
      // Mêmes réglages que l'itinéraire choisi à l'arrêt (plus court, sans péage…) : rien à choisir en roulant.
      const route = await fetchRoute({
        apiKey: ctx.getApiKey(), vehicle: session.vehicle, start: from, end: session.params.end,
        avoidTolls: session.params.avoidTolls, avoidFerries: session.params.avoidFerries,
        preference: session.params.preference ?? null,
      });
      if (s !== session) return; // guidage arrêté entre-temps
      const done = rerouteDone(s.state, route);
      s.state = done.state;
      s.error = '';
      ctx.map.showRoute(route.coordinates, route.bbox, { fit: false });
      // Simulation : le nouvel itinéraire part d'une fausse position, il ne remplace pas l'itinéraire réel.
      if (s.sim) s.sim.setRoute(route.coordinates);
      else ctx.onRouteChange?.(route);
      handle(done.events);
    } catch (err) {
      if (s !== session) return;
      const f = rerouteFailed(s.state, err?.kind ?? ERROR_KINDS.UNKNOWN);
      s.state = f.state;
      s.error = err?.message || 'erreur inattendue.';
      handle(f.events);
    }
    if (s === session && s.view) renderAlert({ ...s.view, rerouting: s.state.rerouting, rerouteBlocked: s.state.rerouteBlocked });
  }

  function onGeoError(err) {
    if (!s) return;
    if (err?.code === 1) {
      stop('Accès à la position refusé : autorise la localisation pour Gabarit dans les réglages du navigateur.');
    }
    // Délai dépassé / position indisponible : le contrôle du signal (chaque seconde) affiche l'alerte.
  }

  function checkSignal() {
    if (!s) return;
    const lost = !s.sim && gpsLost(s.state, Date.now());
    if (lost !== s.gpsLost) {
      s.gpsLost = lost;
      renderAlert(s.view);
    }
  }

  function recenter() {
    if (!s) return;
    clearTimeout(s.recenterTimer);
    s.follow = true;
    ui.recenter.hidden = true;
    if (s.view) render(s.view);
  }

  ctx.map.onUserGesture(() => {
    if (!s) return;
    s.follow = false;
    ui.recenter.hidden = false;
    clearTimeout(s.recenterTimer);
    s.recenterTimer = setTimeout(recenter, RECENTER_AFTER_MS);
  });

  /**
   * Démarre le guidage. À appeler dans le geste de l'utilisateur (première phrase autorisée par Chrome).
   * @param {{ route:object, params:{ end:number[], avoidTolls:boolean, avoidFerries:boolean, preference?:string|null },
   *   vehicle:object, simulate?:{ speedKmh:number }|null }} p
   */
  function start({ route, params, vehicle, simulate = null }) {
    if (s) stop();
    const now = Date.now();
    s = {
      state: startNavigation(route, { destination: params.end, now }),
      params, vehicle, view: null, follow: true, error: '', gpsLost: false,
      sim: simulate ? createSimulator(route.coordinates, { speedKmh: simulate.speedKmh }) : null,
      watchId: null, simTimer: null, signalTimer: null, recenterTimer: null, releaseTimer: null,
    };
    app.classList.add('navigating');
    root.hidden = false;
    ui.sim.hidden = !s.sim;
    ui.recenter.hidden = true;
    ui.stop.textContent = '■ Arrêter';
    ui.then.hidden = true;
    ui.alert.hidden = true;
    setIcon({ kind: 'arrow', angle: 0 });
    ui.dist.textContent = '';
    ui.instr.textContent = s.sim ? 'Simulation…' : 'Recherche du signal GPS…';
    for (const n of [ui.remaining, ui.time, ui.eta, ui.speed]) n.textContent = '—';
    renderVoice();
    ctx.map.setNavigating(true);
    ctx.map.showRoute(route.coordinates, route.bbox, { fit: false });
    ctx.voice.speak(s.sim ? 'Simulation du trajet.' : 'Guidage démarré.', { interrupt: true });
    ctx.wakeLock.enable();

    if (s.sim) {
      ui.simSpeed.textContent = `${s.sim.speedKmh} km/h`;
      ui.simOffroad.disabled = false;
      const tick = () => onFix(s?.sim?.next(Date.now()));
      s.simTimer = setInterval(tick, SIM_TICK_MS);
      tick();
    } else if ('geolocation' in navigator) {
      s.watchId = navigator.geolocation.watchPosition(
        // Horloge de la tablette plutôt que pos.timestamp (certains GPS donnent une autre heure).
        (pos) => onFix({ ...fixFromPosition(pos), timestamp: Date.now() }),
        onGeoError,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    } else {
      stop('GPS indisponible sur cet appareil.');
      return;
    }
    s.signalTimer = setInterval(checkSignal, 1000);
  }

  function stop(message) {
    if (!s) return;
    const session = s;
    s = null;
    if (session.watchId !== null) navigator.geolocation.clearWatch(session.watchId);
    clearInterval(session.simTimer);
    clearInterval(session.signalTimer);
    clearTimeout(session.recenterTimer);
    clearTimeout(session.releaseTimer);
    ctx.voice.cancel();
    ctx.wakeLock.disable();
    root.hidden = true;
    app.classList.remove('navigating');
    ctx.map.setNavigating(false);
    ctx.onEnd?.(message);
  }

  ui.stop.addEventListener('click', () => stop());
  ui.recenter.addEventListener('click', recenter);
  ui.voice.addEventListener('click', () => {
    const on = !ctx.voice.enabled;
    ctx.voice.setEnabled(on);
    ctx.onVoiceToggle?.(on);
    renderVoice();
    if (on) ctx.voice.speak('Voix activée.', { interrupt: true });
  });
  ui.simOffroad.addEventListener('click', () => {
    if (s?.sim?.leaveRoad()) ui.simOffroad.disabled = true;
  });
  ui.simSpeed.addEventListener('click', () => {
    if (!s?.sim) return;
    const next = SIM_SPEEDS[(SIM_SPEEDS.indexOf(s.sim.speedKmh) + 1) % SIM_SPEEDS.length];
    s.sim.setSpeed(next);
    ui.simSpeed.textContent = `${next} km/h`;
    ctx.onSimSpeedChange?.(next);
  });

  return {
    start,
    stop,
    get active() {
      return !!s;
    },
    /** État du verrou d'écran (appelé par wake-lock.js). */
    setScreenStatus(active) {
      ui.screen.hidden = active || !s || (s.view?.arrived ?? false);
    },
  };
}
