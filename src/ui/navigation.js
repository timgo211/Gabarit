// Écran de guidage : source de positions (GPS réel ou simulation), moteur de navigation, voix, carte, écran allumé.
// Toutes les décisions (annonces, recalcul, arrivée) viennent de src/lib/navigation.js ; la simulation
// (src/lib/nav-sim.js) passe par exactement le même chemin que le GPS : onFix().
//
// Code de la route, art. R412-6-2 (Légifrance) : un écran allumé dans le champ de vision du conducteur n'est permis
// que s'il sert d'aide à la conduite ou à la navigation. Pendant le guidage, l'écran ne montre donc que la carte
// et le guidage, sans aucune saisie : gros boutons d'un seul appui (voix, arrêter ; sur la carte : vue d'ensemble,
// recentrer, plan / satellite, aires, actifs à toutes les vitesses, sans menu ni confirmation) et, à l'arrêt hors du
// tracé seulement, « Recalculer d'ici » (l'itinéraire ne change jamais sans accord en dehors d'une vraie sortie de route).
// Encart « Prochaines aires » (phase 9) : ouvert ou fermé d'un seul appui, rempli par le moteur à chaque position ;
// toucher une aire ouvre sa fiche (lecture ; « Mon avis » seulement sous 10 km/h).
// Réglementation (phase 5) : bandeau « ZFE … dans 4 km : interdite », « Interdiction PL dans 45 min », « Rafales
// 85 km/h dans 12 km (Open-Meteo) », « Pause conseillée dans 25 min » et voix, lecture seule (aucun bouton).

import { $, setValueUnit, fitText } from './dom.js';
import { maneuverSvg } from './nav-icon.js';
import { fetchRoute } from './api.js';
import {
  startNavigation, updateNavigation, rerouteDone, rerouteFailed, gpsLost, fixFromPosition, requestReroute, overviewBbox,
  setNavigationAreas, setNavigationWind, mapButtonSize, NAV,
} from '../lib/navigation.js';
import { describeNextArea } from '../lib/areas-route.js';
import { avoidForReroute } from '../lib/zfe.js';
import { GUIDANCE_START_LAYER, guidanceLayerButton } from '../lib/map-layers.js';
import { createSimulator, SIM_SPEEDS } from '../lib/nav-sim.js';
import {
  formatNavDistance, formatDistance, formatDuration, formatArrival, formatSpeed, splitUnit, isLongInstruction,
} from '../lib/format.js';
import { ERROR_KINDS } from '../lib/ors-errors.js';

/** Après un geste ou une vue d'ensemble, retour au suivi au bout de 15 s, seulement en roulant (≥ 10 km/h). */
const RECENTER_AFTER_MS = 15000;
const RECENTER_MIN_KMH = NAV.OFF_ROUTE_MIN_SPEED * 3.6;
const SIM_TICK_MS = 1000;
const RELEASE_SCREEN_AFTER_ARRIVAL_MS = 120000;
/** Encart des aires : hauteur sous laquelle on le met plutôt à droite du bandeau, et largeur minimale pour ça. */
const AREAS_MIN_PX = 120;
const AREAS_MIN_WIDTH_PX = 200;

/**
 * @param {{ map:object, voice:object, wakeLock:object, getApiKey:()=>string,
 *   onVoiceToggle:(on:boolean)=>void, onSimSpeedChange:(kmh:number)=>void,
 *   onRouteChange:(route:object)=>void, onEnd:(message?:string)=>void, onAreaOpen?:(id:string)=>void,
 *   onView?:(view:object, info:{ simulated:boolean })=>void }} ctx
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
    rule: $('#nav-rule'),
    reroute: $('#btn-nav-reroute'),
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
    overview: $('#btn-nav-overview'),
    layer: $('#btn-nav-layer'),
    road: $('#nav-road'),
    foot: $('.nav-foot'),
    stop: $('#btn-nav-stop'),
    bottom: $('.nav-bottom'),
    areasBtn: $('#btn-nav-areas'),
    areas: $('#nav-areas'),
    areasList: $('#nav-areas-list'),
    areasEmpty: $('#nav-areas-empty'),
    top: $('.nav-top'),
    mapbtns: $('.nav-mapbtns'),
  };
  let s = null; // session de guidage en cours

  function cameraPadding() {
    const h = root.clientHeight || window.innerHeight;
    // Encart « Prochaines aires » ouvert devant le véhicule (téléphone : toute la largeur) : véhicule juste
    // au-dessus de l'encart, sous le bandeau (phase 9). Tablette : l'encart est à gauche, rien ne change.
    const box = s?.areasOpen && !ui.areas.hidden ? ui.areas.getBoundingClientRect() : null;
    const mid = root.getBoundingClientRect().left + (root.clientWidth || window.innerWidth) / 2;
    if (box && box.left < mid && box.right > mid) {
      const above = box.top - root.getBoundingClientRect().top - 48;
      const y = Math.round(Math.max(h * 0.3, Math.min(h * 0.75, above)));
      return { top: Math.max(0, y - 1), bottom: Math.max(0, h - y - 1), left: 0, right: 0 };
    }
    const bottom = ui.bottom?.offsetHeight ?? 0; // barre du bas seulement (les boutons de carte sont sur le côté)
    // Véhicule dans le bas de l'écran (au-dessus de la barre) : on voit loin devant.
    return { top: Math.round(h * 0.5), bottom: Math.min(bottom, Math.round(h * 0.3)), left: 0, right: 0 };
  }

  function renderVoice() {
    const on = ctx.voice.enabled;
    ui.voice.textContent = on ? '🔊 Voix' : '🔇 Muet';
    ui.voice.setAttribute('aria-pressed', String(on));
    ui.voice.disabled = !ctx.voice.supported;
  }

  /** Valeur avec unité réduite, puis réduction de la taille si elle ne tient pas dans sa case. */
  function setStat(node, text) {
    const { value, unit } = splitUnit(text);
    setValueUnit(node, value, unit);
    fitText(node);
  }

  function setInstruction(text) {
    ui.instr.textContent = text;
    ui.instr.classList.toggle('long', isLongInstruction(text));
    fitText(ui.instr, 0.7);
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
    if (view?.offRouteStopped) return 'Hors itinéraire, à l\'arrêt : l\'itinéraire ne change pas sans ton accord.';
    return '';
  }

  function renderAlert(view) {
    const text = alertText(view);
    ui.alert.textContent = text;
    ui.alert.hidden = !text;
    ui.alert.classList.toggle('info', text !== '' && !!view?.offRouteStopped && !view.rerouting && !s?.error && !s?.gpsLost);
    // Proposition à l'arrêt hors du tracé (aire, parking) : un seul bouton, jamais de recalcul tout seul.
    const offer = !!s && !s.gpsLost && !!view?.offRouteStopped && !view.rerouting && !view.rerouteBlocked;
    ui.reroute.hidden = !offer;
    ui.reroute.disabled = !view?.canRequestReroute;
    layoutFoot(); // le bandeau a pu grandir (alerte, bouton)
  }

  /**
   * Pied de l'écran de guidage : les boutons de carte et l'encart des aires ne recouvrent jamais le bandeau du haut
   * ni la barre du bas. Le pied commence sous le bandeau quand ils se chevauchent en largeur (téléphone) ; la taille
   * des boutons s'adapte à la hauteur restante (mapButtonSize) ; l'encart est borné sous le bandeau et défile s'il
   * manque de place (paysage sur téléphone).
   */
  function layoutFoot() {
    if (!s || root.hidden) return;
    const r = root.getBoundingClientRect();
    const t = ui.top.getBoundingClientRect();
    const css = getComputedStyle(ui.foot);
    const inset = parseFloat(css.right) || 0;
    const gap = parseFloat(css.rowGap) || 0;
    const preferred = parseFloat(getComputedStyle(root).getPropertyValue('--mapbtn')) || 56;
    const btnWidth = Math.max(preferred, ui.mapbtns.offsetWidth);
    const below = t.bottom - r.top + 8;
    const colLeft = r.right - inset - btnWidth;
    const top = t.right > colLeft - 4 ? below : inset;
    ui.foot.style.top = `${Math.round(top)}px`;
    const used = ui.bottom.offsetHeight + gap + (ui.road.hidden ? 0 : ui.road.offsetHeight + gap);
    const side = ui.foot.clientHeight - (parseFloat(css.paddingBottom) || 0) - used;
    const bcss = getComputedStyle(ui.mapbtns);
    const columns = bcss.display === 'grid' ? bcss.gridTemplateColumns.split(' ').filter(Boolean).length : 1;
    const rows = Math.ceil(ui.mapbtns.children.length / Math.max(1, columns));
    const size = mapButtonSize({ available: side, count: rows, gap: parseFloat(bcss.rowGap) || 0, preferred });
    ui.foot.style.setProperty('--mapbtn', `${size}px`);
    // Encart : sous le bandeau ; si la place y manque (paysage, écran bas) et qu'il y en a à droite du bandeau, à
    // droite du bandeau sur toute la hauteur.
    const under = top === inset ? side - Math.max(0, below - inset) : side;
    const colWidth = ui.mapbtns.offsetWidth;
    const besideLeft = t.right - r.left - inset + 8;
    const besideWidth = (r.width - 2 * inset) - colWidth - 8 - besideLeft;
    const beside = under < AREAS_MIN_PX && besideWidth >= AREAS_MIN_WIDTH_PX;
    ui.areas.style.marginLeft = beside ? `${Math.round(besideLeft)}px` : '';
    ui.areas.style.maxHeight = `${Math.max(0, Math.floor(beside ? side : under))}px`;
  }

  /** Encart « Prochaines aires » : 3 lignes (nom, distance, heure d'arrivée, places PL), une ligne = un bouton. */
  function renderAreas(view) {
    ui.areasBtn.setAttribute('aria-pressed', String(!!s?.areasOpen));
    ui.areas.hidden = !s?.areasOpen;
    if (!s?.areasOpen) return;
    const next = view?.nextAreas ?? [];
    const now = new Date();
    const rows = next.map((n) => {
      const d = describeNextArea(n, now);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nav-area';
      b.dataset.id = n.id;
      const name = document.createElement('span');
      name.className = 'nav-area-name';
      name.textContent = d.name;
      const facts = document.createElement('span');
      facts.className = 'nav-area-facts';
      for (const [cls, t] of [['nav-area-dist', d.distance], ['nav-area-eta', d.eta], ['nav-area-places', d.places]]) {
        const x = document.createElement('span');
        x.className = cls;
        x.textContent = t;
        facts.append(x);
      }
      b.append(name, facts);
      const li = document.createElement('li');
      li.append(b);
      return li;
    });
    ui.areasList.replaceChildren(...rows);
    ui.areasEmpty.hidden = rows.length > 0;
    ui.areasEmpty.textContent = s.areasCount ? 'Plus d\'aire sur la suite du trajet.' : 'Aucune aire trouvée sur ce trajet (ou recherche en cours).';
  }

  function render(view) {
    if (view.arrived) {
      setIcon({ kind: 'goal' });
      ui.dist.textContent = '';
      setInstruction('Destination atteinte');
      ui.then.hidden = true;
      ui.stop.textContent = '✔ Terminer';
    } else if (view.maneuver) {
      setIcon(view.maneuver.icon);
      setStat(ui.dist, formatNavDistance(view.maneuver.distance));
      setInstruction(view.maneuver.text);
      if (view.then) {
        ui.then.textContent = `Puis : ${view.then.text}`;
        ui.then.hidden = false;
      } else {
        ui.then.hidden = true;
      }
    } else {
      setIcon({ kind: 'arrow', angle: 0 });
      ui.dist.textContent = '';
      setInstruction('Suivez l\'itinéraire');
      ui.then.hidden = true;
    }
    setStat(ui.remaining, formatDistance(view.remainingDistance));
    setStat(ui.time, formatDuration(view.remainingDuration));
    setStat(ui.eta, formatArrival(new Date(), view.remainingDuration));
    setStat(ui.speed, formatSpeed(view.speedKmh));
    if (s.sim) ui.simOffroad.disabled = s.sim.mode !== 'route' || view.arrived;
    renderAlert(view);

    // Réglementation (phase 5) : ZFE interdite devant, interdiction PL proche, vent fort, pause conseillée (textes du
    // moteur).
    const rules = [view.rules?.zfe?.text, view.rules?.ban?.text, view.rules?.wind?.text, view.rules?.drive?.text]
      .filter(Boolean);
    if (ui.rule.dataset.text !== rules.join('\n')) {
      ui.rule.dataset.text = rules.join('\n');
      ui.rule.replaceChildren(...rules.map((t) => {
        const line = document.createElement('span');
        line.textContent = t;
        return line;
      }));
    }
    ui.rule.hidden = !rules.length;

    ui.road.textContent = view.roadName ?? '';
    ui.road.hidden = !view.roadName;
    renderAreas(view);
    layoutFoot();
    ctx.onView?.(view, { simulated: !!s.sim });

    // Flèche (et caméra si elle suit) animées jusqu'à la nouvelle position (src/ui/map.js).
    ctx.map.navigateTo({
      lonlat: view.position, bearing: view.bearing, zoom: view.zoom, pitch: view.pitch,
      follow: s.follow, padding: cameraPadding(), speedKmh: view.speedKmh,
    });
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
        avoidPolygons: avoidForReroute(session.params.avoidPolygons, from, session.params.end),
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

  function renderFollow() {
    ui.recenter.setAttribute('aria-pressed', String(!!s?.follow));
    ui.overview.setAttribute('aria-pressed', String(!!s?.overview));
  }

  function recenter() {
    if (!s) return;
    clearTimeout(s.recenterTimer);
    s.follow = true;
    s.overview = false;
    renderFollow();
    if (s.view) render(s.view);
  }

  /** Retour automatique au suivi : seulement en roulant ; à l'arrêt, la vue choisie reste. */
  function scheduleRecenter() {
    clearTimeout(s.recenterTimer);
    s.recenterTimer = setTimeout(() => {
      if (!s || s.follow) return;
      if ((s.view?.speedKmh ?? 0) >= RECENTER_MIN_KMH) recenter();
      else scheduleRecenter();
    }, RECENTER_AFTER_MS);
  }

  /** Vue d'ensemble : tout le trajet restant, à plat, nord en haut. */
  function overview() {
    if (!s) return;
    s.follow = false;
    s.overview = true;
    renderFollow();
    const h = root.clientHeight || window.innerHeight;
    const top = Math.min(Math.round(h * 0.35), ($('.nav-top')?.offsetHeight ?? 0) + 20);
    const bottom = Math.min(Math.round(h * 0.45), (ui.foot?.offsetHeight ?? 0) + 20);
    const side = Math.min(80, Math.round((root.clientWidth || window.innerWidth) * 0.12));
    ctx.map.overview(overviewBbox(s.state), { top, bottom, left: side, right: side + 40 });
    scheduleRecenter();
  }

  function renderLayer() {
    const b = guidanceLayerButton(s?.layer);
    const outside = s?.layer === 'satellite' && !!s.layerMessage;
    const [icon, ...words] = (outside ? '🛰 France seulement' : b.text).split(' ');
    const i = document.createElement('span');
    i.setAttribute('aria-hidden', 'true');
    i.textContent = icon;
    const t = document.createElement('span');
    t.className = 'nav-mapbtn-text';
    t.textContent = words.join(' ');
    ui.layer.replaceChildren(i, t);
    ui.layer.setAttribute('aria-label', outside ? `${s.layerMessage}. Passer en plan` : b.label);
  }

  /** Plan ↔ satellite, pour ce guidage seulement (le guidage démarre toujours en plan). */
  function toggleLayer() {
    if (!s) return;
    s.layer = guidanceLayerButton(s.layer).next;
    ctx.map.setLayer(s.layer);
    renderLayer();
  }

  ctx.map.onUserGesture(() => {
    if (!s) return;
    s.follow = false;
    s.overview = false;
    renderFollow();
    scheduleRecenter();
  });

  /**
   * Démarre le guidage. À appeler dans le geste de l'utilisateur (première phrase autorisée par Chrome).
   * @param {{ route:object, params:{ end:number[], avoidTolls:boolean, avoidFerries:boolean, preference?:string|null },
   *   vehicle:object, simulate?:{ speedKmh:number }|null }} p
   */
  function start({ route, params, vehicle, simulate = null, areas = null, announceAreas = false, rules = null }) {
    if (s) stop();
    const now = Date.now();
    s = {
      state: startNavigation(route, { destination: params.end, now, areas, announceAreas, rules }),
      areasOpen: false, areasCount: Array.isArray(areas) ? areas.length : 0,
      params, vehicle, view: null, follow: true, overview: false, error: '', gpsLost: false,
      layer: GUIDANCE_START_LAYER, layerMessage: '',
      sim: simulate ? createSimulator(route.coordinates, { speedKmh: simulate.speedKmh }) : null,
      watchId: null, simTimer: null, signalTimer: null, recenterTimer: null, releaseTimer: null,
    };
    app.classList.add('navigating');
    root.hidden = false;
    ui.sim.hidden = !s.sim;
    renderFollow();
    ui.road.hidden = true;
    renderAreas(null);
    requestAnimationFrame(layoutFoot);
    ctx.map.setLayer(s.layer);
    renderLayer();
    ui.stop.textContent = '■ Arrêter';
    ui.then.hidden = true;
    ui.alert.hidden = true;
    ui.rule.hidden = true;
    ui.reroute.hidden = true;
    setIcon({ kind: 'arrow', angle: 0 });
    ui.dist.textContent = '';
    setInstruction(s.sim ? 'Simulation…' : 'Recherche du signal GPS…');
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

  window.addEventListener('resize', () => layoutFoot());
  ui.stop.addEventListener('click', () => stop());
  ui.reroute.addEventListener('click', () => {
    if (!s) return;
    const r = requestReroute(s.state, Date.now());
    s.state = r.state;
    if (r.events.length) ui.reroute.disabled = true;
    handle(r.events);
  });
  ui.recenter.addEventListener('click', recenter);
  ui.overview.addEventListener('click', overview);
  ui.layer.addEventListener('click', toggleLayer);
  ui.areasBtn.addEventListener('click', () => {
    if (!s) return;
    s.areasOpen = !s.areasOpen;
    renderAreas(s.view);
    layoutFoot();
    if (s.view && s.follow) render(s.view); // caméra recadrée au-dessus de l'encart
  });
  ui.areasList.addEventListener('click', (e) => {
    const b = e.target.closest('.nav-area');
    if (b?.dataset.id) ctx.onAreaOpen?.(b.dataset.id);
  });
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
    /** Vitesse du guidage (km/h), ou null (pas de position). */
    get speedKmh() {
      return s?.view ? s.view.speedKmh : null;
    },
    /** Aires arrivées après « Démarrer » (requête Overpass plus lente) : le moteur les place sur le tracé. */
    setAreas(areas) {
      if (!s) return;
      s.state = setNavigationAreas(s.state, areas);
      s.areasCount = Array.isArray(areas) ? areas.length : 0;
    },
    /** Nouvelle prévision du vent (au plus une par heure) : le moteur replace les rafales sur le tracé suivi. */
    setWind(wind) {
      if (!s) return;
      s.state = setNavigationWind(s.state, wind);
    },
    /** Vue satellite hors de France pendant le guidage (message de src/lib/map-layers.js). */
    setLayerView(view) {
      if (!s) return;
      s.layerMessage = view?.message ?? '';
      renderLayer();
    },
    /** État du verrou d'écran (appelé par wake-lock.js). */
    setScreenStatus(active) {
      ui.screen.hidden = active || !s || (s.view?.arrived ?? false);
    },
  };
}
