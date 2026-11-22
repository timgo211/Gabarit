// Écran de guidage : source de positions (GPS réel ou simulation), moteur de navigation, voix, carte, écran allumé.
// Toutes les décisions (annonces, recalcul, arrivée) viennent de src/lib/navigation.js ; la simulation
// (src/lib/nav-sim.js) passe par exactement le même chemin que le GPS : onFix(). Ce qui s'affiche (alertes et leur
// ordre, boutons réservés à l'arrêt, place du véhicule, colonne de boutons) est décidé par src/lib/nav-layout.js.
//
// Code de la route, art. R412-6-2 (Légifrance) : un écran allumé dans le champ de vision du conducteur n'est permis
// que s'il sert d'aide à la conduite ou à la navigation. Pendant le guidage, l'écran ne montre donc que la carte
// et le guidage, sans aucune saisie : boutons ronds d'un seul appui (boussole, recentrer, loupe = catégories le long
// du trajet, son, vue d'ensemble), confirmation en deux gros boutons pour quitter ; « Autres itinéraires » seulement
// à l'arrêt (sous 5 km/h pendant 3 s) ; à l'arrêt hors du tracé seulement, « Recalculer d'ici » (l'itinéraire ne
// change jamais sans accord en dehors d'une vraie sortie de route).
//
// Phase 2c (disposition façon GPS de téléphone) : bandeau de manœuvre en haut (flèche, distance, badge de route et
// rue), « Puis » et 2 alertes au plus dessous (pastille « +N » pour les autres), pastille de la rue au-dessus du
// véhicule, colonne de boutons ronds à droite, compteur de vitesse en bas à gauche, panneau du bas (temps restant ;
// tiré ou touché : détails du trajet en lecture seule). Paysage : bandeau et panneau du bas dans une colonne à
// gauche. Aucun élément ne demande de redessiner la carte à l'arrêt : la caméra ne dépend que de la taille de
// l'écran (followPadding).
// Liste « Aires et parkings PL » (phase 9, liste défilante de la phase 2d) : ouverte par la loupe → « Aires PL »,
// remplie par le moteur à chaque position (15 aires au plus, dans l'ordre de la route), défilement au doigt, aucune
// saisie. Toucher une aire : repère mis en évidence et fiche courte ; en roulant, la caméra ne bouge pas. « Y aller »
// et « Fiche complète » seulement à l'arrêt (parkedState) ; l'itinéraire ne change jamais. Fermée seule après 20 s
// sans toucher.
// Temps de conduite (phase 5, règlement CE 561/2006, aide seulement) : carte d'alerte quand la pause approche ou
// est dépassée, sinon dans les détails ; à l'arrêt seulement (sous 10 km/h), un bouton « Pas une pause (travail) ».

import { $, setValueUnit, fitText } from './dom.js';
import { maneuverSvg } from './nav-icon.js';
import { symbolSvg } from './nav-symbols.js';
import { fetchRoute } from './api.js';
import {
  startNavigation, updateNavigation, rerouteDone, rerouteFailed, gpsLost, fixFromPosition, requestReroute, overviewBbox,
  setNavigationAreas, setNavigationWind, setNavigationTunnels, setNavigationCountries, setNavigationAccess, markStopAsWork, NAV,
} from '../lib/navigation.js';
import {
  systemAlert, guidanceAlerts, splitAlerts, parkedState, followPadding, buttonColumn, speedStatus, traveledUpdate,
  traveledCoords, bannerText, isLandscape, areaListBox, LANDSCAPE_COLUMN,
} from '../lib/nav-layout.js';
import { describeNextArea, nextAreasChanged, areaRowsPlan, AREA_LIST } from '../lib/areas-route.js';
import { avoidForReroute } from '../lib/zfe.js';
import { tollText } from '../lib/route-options.js';
import { GUIDANCE_START_LAYER, guidanceLayerButton } from '../lib/map-layers.js';
import { createSimulator, SIM_SPEEDS } from '../lib/nav-sim.js';
import {
  formatNavDistance, formatDistance, formatDuration, formatArrival, splitUnit, isLongInstruction,
} from '../lib/format.js';
import { ERROR_KINDS } from '../lib/ors-errors.js';

/** Après un geste ou une vue d'ensemble, retour au suivi au bout de 15 s, seulement en roulant (≥ 10 km/h). */
const RECENTER_AFTER_MS = 15000;
const RECENTER_MIN_KMH = NAV.OFF_ROUTE_MIN_SPEED * 3.6;
const SIM_TICK_MS = 1000;
const RELEASE_SCREEN_AFTER_ARRIVAL_MS = 120000;
/** Décompte du temps de conduite enregistré au plus toutes les 15 s (une position par seconde). */
const SAVE_DRIVING_MS = 15000;
/** Rangée de la loupe et confirmation « Quitter » : fermées seules au bout de 8 s. */
const AUTO_CLOSE_MS = 8000;
const TOAST_MS = 4000;
/** Panneau du bas tiré de plus de 24 px : ouvert (vers le haut) ou fermé (vers le bas). */
const DRAG_PX = 24;
const INSET = 12;
/** Écart entre le véhicule et le bas de la pastille de la rue (px). */
const PILL_ABOVE_PX = 40;
const RULE_KINDS = new Set(['tunnel', 'zfe', 'access', 'ban', 'border', 'wind']);

/**
 * @param {{ map:object, voice:object, wakeLock:object, getApiKey:()=>string,
 *   onVoiceToggle:(on:boolean)=>void, onSimSpeedChange:(kmh:number)=>void,
 *   onRouteChange:(route:object)=>void, onEnd:(message?:string)=>void, onAreaOpen?:(id:string)=>void,
 *   areaFacts?:(id:string)=>string,
 *   onView?:(view:object)=>void, onDriving?:(driving:object)=>void, onPosition?:(lonlat:number[])=>void }} ctx
 */
export function createNavigation(ctx) {
  const app = $('.app');
  const root = $('#nav');
  const ui = {
    icon: $('#nav-icon'),
    dist: $('#nav-dist'),
    instr: $('#nav-instr'),
    then: $('#nav-then'),
    alerts: $('#nav-alerts'),
    alert: $('#nav-alert'),
    alertText: $('#nav-alert-text'),
    rule: $('#nav-rule'),
    drive: $('#nav-drive'),
    driveMain: $('#nav-drive-main'),
    driveDetail: $('#nav-drive-detail'),
    driveSlot: $('#nav-drive-slot'),
    work: $('#btn-nav-work'),
    reroute: $('#btn-nav-reroute'),
    more: $('#btn-nav-more'),
    moreList: $('#nav-more-list'),
    facts: $('#nav-facts'),
    remaining: $('#nav-remaining'),
    time: $('#nav-time'),
    eta: $('#nav-eta'),
    speedo: $('#nav-speedo'),
    speed: $('#nav-speed'),
    limit: $('#nav-limit'),
    screen: $('#nav-screen'),
    sim: $('#nav-sim'),
    simSpeed: $('#btn-sim-speed'),
    simOffroad: $('#btn-sim-offroad'),
    compass: $('#btn-nav-compass'),
    recenter: $('#btn-nav-recenter'),
    searchBtn: $('#btn-nav-search'),
    search: $('#nav-search'),
    voice: $('#btn-nav-voice'),
    alt: $('#btn-nav-alt'),
    overview: $('#btn-nav-overview'),
    layer: $('#btn-nav-layer'),
    road: $('#nav-road'),
    stop: $('#btn-nav-stop'),
    bottom: $('.nav-bottom'),
    sheet: $('#btn-nav-sheet'),
    details: $('#nav-details'),
    confirm: $('#nav-confirm'),
    quit: $('#btn-nav-quit'),
    keep: $('#btn-nav-keep'),
    toast: $('#nav-toast'),
    areasBtn: $('#btn-nav-areas'),
    areas: $('#nav-areas'),
    areasList: $('#nav-areas-list'),
    areasEmpty: $('#nav-areas-empty'),
    areasClose: $('#btn-nav-areas-close'),
    areaCard: $('#nav-area-card'),
    areaCardName: $('#nav-area-card-name'),
    areaCardFacts: $('#nav-area-card-facts'),
    areaCardMore: $('#nav-area-card-more'),
    areaGo: $('#btn-nav-area-go'),
    areaSheet: $('#btn-nav-area-sheet'),
    top: $('.nav-top'),
    mapbtns: $('.nav-mapbtns'),
  };
  let s = null; // session de guidage en cours

  // Pictogrammes (Material Symbols, src/ui/nav-symbols.js).
  ui.compass.append(symbolSvg('compass'));
  ui.recenter.append(symbolSvg('recenter'));
  ui.searchBtn.append(symbolSvg('search'));
  ui.alt.append(symbolSvg('altRoute'));
  ui.stop.append(symbolSvg('close'));
  ui.overview.append(symbolSvg('overview'));

  const size = () => ({ width: root.clientWidth || window.innerWidth, height: root.clientHeight || window.innerHeight });

  function cameraPadding() {
    return followPadding(size());
  }

  function renderVoice() {
    const on = ctx.voice.enabled;
    ui.voice.replaceChildren(symbolSvg(on ? 'soundOn' : 'soundOff'));
    ui.voice.setAttribute('aria-pressed', String(on));
    ui.voice.setAttribute('aria-label', on ? 'Couper la voix' : 'Activer la voix');
    ui.voice.disabled = !ctx.voice.supported;
  }

  /** Valeur avec unité réduite, puis réduction de la taille si elle ne tient pas dans sa case. */
  function setStat(node, text) {
    const { value, unit } = splitUnit(text);
    setValueUnit(node, value, unit);
    fitText(node);
  }

  /** Bandeau : badges de route et nom de rue (ou consigne entière), jamais coupé au milieu d'un mot. */
  function setBanner(b) {
    const key = JSON.stringify([b.badges.map((x) => x.ref), b.text]);
    if (ui.instr.dataset.key !== key) {
      ui.instr.dataset.key = key;
      const parts = b.badges.map((x) => {
        const span = document.createElement('span');
        span.className = 'nav-badge';
        span.textContent = x.ref;
        span.style.setProperty('--badge-bg', x.bg);
        span.style.setProperty('--badge-fg', x.fg);
        span.style.setProperty('--badge-border', x.border);
        return span;
      });
      ui.instr.replaceChildren(...parts, document.createTextNode(b.text));
      ui.instr.classList.toggle('long', b.long);
      ui.instr.setAttribute('aria-label', b.full || b.text);
    }
    fitText(ui.instr, 0.6);
  }

  function setInstruction(text) {
    setBanner({ badges: [], text, long: isLongInstruction(text), full: text });
  }

  function setIcon(icon) {
    const key = JSON.stringify(icon);
    if (ui.icon.dataset.key === key) return;
    ui.icon.dataset.key = key;
    ui.icon.replaceChildren(maneuverSvg(icon));
  }

  function renderThen(then) {
    ui.then.hidden = !then;
    if (!then) return;
    const key = JSON.stringify([then.icon, then.text]);
    if (ui.then.dataset.key === key) return;
    ui.then.dataset.key = key;
    const icon = document.createElement('span');
    icon.className = 'nav-then-icon';
    icon.append(maneuverSvg(then.icon));
    ui.then.replaceChildren(document.createTextNode('Puis'), icon);
    ui.then.setAttribute('aria-label', `Puis : ${then.text}`);
  }

  // ───────── Alertes ─────────

  function renderAlerts(view) {
    const sys = s ? systemAlert(view, { gpsLost: s.gpsLost, sim: !!s.sim, error: s.error }) : null;
    const all = guidanceAlerts(view, sys);
    const { shown, more } = splitAlerts(all);
    const at = (key) => shown.findIndex((a) => a.key === key);

    // Alerte système (GPS, recalcul, hors itinéraire) et « Recalculer d'ici ».
    const iSys = at('system');
    ui.alert.hidden = iSys < 0;
    if (iSys >= 0) {
      const a = shown[iSys];
      if (ui.alertText.textContent !== a.text) ui.alertText.textContent = a.text;
      ui.alert.classList.toggle('info', a.info);
      ui.alert.style.order = String(iSys);
      ui.reroute.hidden = !a.offer;
      ui.reroute.disabled = !a.canReroute;
    } else {
      ui.reroute.hidden = true;
    }

    // Réglementation : une carte par alerte montrée.
    const rules = shown.filter((a) => RULE_KINDS.has(a.kind));
    const rulesKey = rules.map((a) => a.text).join('\n');
    if (ui.rule.dataset.text !== rulesKey) {
      ui.rule.dataset.text = rulesKey;
      ui.rule.replaceChildren(...rules.map((a) => {
        const line = document.createElement('span');
        line.textContent = a.text;
        line.dataset.kind = a.kind;
        return line;
      }));
    }
    ui.rule.hidden = !rules.length;
    if (rules.length) ui.rule.style.order = String(at(rules[0].key));

    // Temps de conduite : carte si la pause approche ou est dépassée et qu'il reste une place, sinon les détails.
    const iDrive = at('driving');
    renderDriving(view?.driving ?? null, iDrive >= 0);
    if (iDrive >= 0) ui.drive.style.order = String(iDrive);

    // Les autres : pastille « +N » (ouvre les détails) et liste dans les détails.
    const rest = more.filter((a) => a.kind !== 'driving');
    ui.more.hidden = more.length === 0;
    if (more.length) {
      const label = `+${more.length}`;
      if (ui.more.textContent !== label) ui.more.textContent = label;
      ui.more.setAttribute('aria-label', `${more.length} autre${more.length > 1 ? 's' : ''} alerte${more.length > 1 ? 's' : ''} : voir les détails`);
    }
    const moreKey = rest.map((a) => a.text).join('\n');
    if (ui.moreList.dataset.text !== moreKey) {
      ui.moreList.dataset.text = moreKey;
      ui.moreList.replaceChildren(...rest.map((a) => {
        const line = document.createElement('span');
        line.textContent = a.text;
        line.dataset.level = a.level;
        if (RULE_KINDS.has(a.kind)) line.dataset.kind = a.kind;
        return line;
      }));
    }
  }

  /** Temps de conduite : deux lignes (pause, journée), couleur selon l'urgence, bouton « travail » à l'arrêt. */
  function renderDriving(d, inStack) {
    ui.drive.hidden = !d;
    if (!d) return;
    const parent = inStack ? ui.alerts : ui.driveSlot;
    if (ui.drive.parentElement !== parent) parent.append(ui.drive);
    if (!inStack) ui.drive.style.order = '';
    if (ui.driveMain.textContent !== d.main) ui.driveMain.textContent = d.main;
    if (ui.driveDetail.textContent !== d.detail) ui.driveDetail.textContent = d.detail;
    ui.drive.dataset.level = d.level;
    ui.work.hidden = !d.canMarkWork;
    if (ui.work.textContent !== d.workLabel) ui.work.textContent = d.workLabel;
  }

  /** Détails du trajet (lecture seule) : prochaine aire PL, péage. */
  function renderFacts(view) {
    const rows = [];
    const next = (view?.nextAreas ?? []).find((a) => a.distance > 0);
    if (next) {
      const d = describeNextArea(next, new Date());
      rows.push(['Prochaine aire PL', `${d.name} · ${d.distance} · ${d.eta} · ${d.places}`]);
    }
    if (s?.tollDistance !== undefined) rows.push(['Péage', tollText(s.tollDistance)]);
    const key = JSON.stringify(rows);
    if (ui.facts.dataset.key === key) return;
    ui.facts.dataset.key = key;
    ui.facts.replaceChildren(...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }));
  }

  // ───────── Disposition ─────────

  /**
   * Bandeau du haut (consigne, « Puis », alertes) jamais sous le compteur ni le panneau du bas : sur un écran bas,
   * version resserrée, puis hauteur bornée en dernier recours.
   */
  function fitBanner(limitAfter) {
    root.classList.remove('nav-tight');
    ui.top.style.maxHeight = '';
    ui.top.style.overflowY = '';
    // La limite se mesure après chaque changement : la version resserrée réduit aussi le panneau du bas.
    if (ui.top.getBoundingClientRect().bottom <= limitAfter()) return;
    root.classList.add('nav-tight');
    const t = ui.top.getBoundingClientRect();
    const limit = limitAfter();
    if (t.bottom > limit) {
      ui.top.style.maxHeight = `${Math.max(0, Math.floor(limit - t.top))}px`;
      ui.top.style.overflowY = 'auto';
    }
  }

  /**
   * Place les éléments posés sur la carte (rien ne se chevauche) : bandeau, compteur, colonne de boutons, rangée de
   * la loupe, encart des aires, pastille de la rue, message. Ne touche jamais à la caméra.
   */
  function layoutGuidance() {
    if (!s || root.hidden) return;
    const { width: w, height: h } = size();
    const land = isLandscape({ width: w, height: h });
    root.classList.toggle('land', land);
    root.classList.toggle('sheet-open', s.detailsOpen);
    const r = root.getBoundingClientRect();
    const columnRight = land ? Math.round(w * LANDSCAPE_COLUMN) : 0;

    // Compteur : en bas à gauche, au-dessus du panneau du bas (portrait) ou à droite de la colonne (paysage).
    const placeBottom = () => {
      const sheetH = ui.bottom.offsetHeight;
      ui.speedo.style.left = `${land ? columnRight + INSET : INSET}px`;
      ui.speedo.style.bottom = `${land ? INSET : sheetH + INSET}px`;
      return {
        sheetH,
        sheetTop: h - sheetH - (land ? INSET : 0),
        speedoTop: h - (land ? INSET : sheetH + INSET) - ui.speedo.offsetHeight,
      };
    };

    // Bandeau : au-dessus du compteur en portrait, du panneau du bas en paysage (même colonne).
    fitBanner(() => {
      const b = placeBottom();
      return r.top + (land ? b.sheetTop : b.speedoTop) - 8;
    });
    const { sheetTop, speedoTop } = placeBottom();
    const stackBottom = ui.top.getBoundingClientRect().bottom - r.top;

    // Colonne de boutons ronds (45–85 % de la hauteur, sous le bandeau, au-dessus du panneau du bas).
    const count = [...ui.mapbtns.children].filter((n) => !n.hidden).length;
    const col = buttonColumn({
      height: h, count,
      minTop: land ? INSET : stackBottom + 8,
      maxBottom: land ? h - INSET : sheetTop - INSET,
    });
    root.style.setProperty('--round', `${col.size}px`);
    root.style.setProperty('--gap', `${col.gap}px`);
    root.style.setProperty('--cols', String(col.columns));
    ui.mapbtns.style.top = `${col.top}px`;
    const colWidth = col.columns * col.size + (col.columns - 1) * col.gap;
    const colLeft = w - INSET - colWidth;

    // Rangée de la loupe : à gauche de la colonne, à hauteur de la loupe.
    if (!ui.search.hidden) {
      const b = ui.searchBtn.getBoundingClientRect();
      ui.search.style.right = `${Math.round(w - colLeft + 8)}px`;
      ui.search.style.top = `${Math.round(b.top - r.top + (col.size - 56) / 2)}px`;
      ui.search.style.maxWidth = `${Math.max(0, Math.round(colLeft - 8 - (land ? columnRight + INSET : INSET)))}px`;
    }

    // Véhicule (followPadding) et pastille de la rue juste au-dessus.
    const pad = cameraPadding();
    const vx = pad.left + (w - pad.left - pad.right) / 2;
    const vy = (pad.top + h - pad.bottom) / 2;
    const pillBottom = vy - PILL_ABOVE_PX;
    ui.road.style.left = `${Math.round(vx)}px`;
    ui.road.style.top = `${Math.round(pillBottom)}px`;
    const room = Math.min(vx - (land ? columnRight : 0), colLeft - vx) - 16;
    ui.road.style.maxWidth = `${Math.max(0, Math.round(2 * room))}px`;

    // Liste des aires (phase 2d) : portrait, au-dessus du compteur, 40 % de la hauteur au plus, jamais sur la pile du
    // bandeau ; paysage, dans la colonne de gauche entre le bandeau et le panneau du bas (src/lib/nav-layout.js).
    const box = areaListBox({ width: w, height: h, stackBottom, colLeft, speedoTop, sheetTop, columnRight });
    ui.areas.style.left = `${box.left}px`;
    ui.areas.style.right = `${box.right}px`;
    ui.areas.style.top = '';
    ui.areas.style.bottom = `${box.bottom}px`;
    ui.areas.style.maxHeight = `${box.maxHeight}px`;
    s.areasInMap = box.inMap;

    // Message bref : à la place de la pastille de la rue (masquée pendant 4 s) ; en portrait, liste des aires
    // ouverte : juste au-dessus de la liste (qui couvre le véhicule).
    const listOpen = !ui.areas.hidden;
    const listTop = !land && listOpen ? ui.areas.getBoundingClientRect().top - r.top : null;
    const toastBottom = listOpen && box.toastBottom !== null ? box.toastBottom
      : Math.round(h - (listTop === null ? pillBottom : listTop - 8));
    ui.toast.style.bottom = `${toastBottom}px`;
    ui.toast.style.left = `${Math.round(vx)}px`;
    ui.toast.style.maxWidth = ui.road.style.maxWidth; // entre la colonne de gauche (paysage) et les boutons
    renderRoad();
  }

  /** Pastille de la rue : seulement en suivi, détails fermés. */
  function renderRoad() {
    const name = s?.view?.roadName ?? '';
    if (ui.road.textContent !== name) ui.road.textContent = name;
    // Portrait, ou paysage avec la liste sur la carte : elle couvre le véhicule.
    const listOver = !!s?.areasOpen && (!root.classList.contains('land') || !!s.areasInMap);
    ui.road.hidden = !name || !s?.follow || s.detailsOpen || s.searchOpen || listOver || !ui.toast.hidden;
  }

  // ───────── Rendu d'une position ─────────

  function render(view) {
    if (view.arrived) {
      setIcon({ kind: 'goal' });
      ui.dist.textContent = '';
      setInstruction('Destination atteinte');
      renderThen(null);
      ui.stop.setAttribute('aria-label', 'Terminer le guidage');
    } else if (view.maneuver) {
      setIcon(view.maneuver.icon);
      setStat(ui.dist, formatNavDistance(view.maneuver.distance));
      setBanner(bannerText(view.maneuver));
      renderThen(view.then);
    } else {
      setIcon({ kind: 'arrow', angle: 0 });
      ui.dist.textContent = '';
      setInstruction('Suivez l\'itinéraire');
      renderThen(null);
    }
    setStat(ui.remaining, formatDistance(view.remainingDistance));
    setStat(ui.time, formatDuration(view.remainingDuration));
    setStat(ui.eta, formatArrival(new Date(), view.remainingDuration));
    const sp = speedStatus(view.speedKmh, view.speedLimit ?? null);
    if (ui.speed.textContent !== sp.value) ui.speed.textContent = sp.value;
    ui.limit.hidden = sp.limit === null;
    if (sp.limit !== null && ui.limit.textContent !== String(sp.limit)) ui.limit.textContent = String(sp.limit);
    ui.speedo.classList.toggle('over', sp.over);
    if (s.sim) ui.simOffroad.disabled = s.sim.mode !== 'route' || view.arrived;

    // « Autres itinéraires » : seulement à l'arrêt (sous 5 km/h pendant 3 s).
    s.park = parkedState(s.park, view.speedKmh, Date.now());
    ui.alt.setAttribute('aria-disabled', String(!s.park.parked));
    renderAreaButtons();

    renderAlerts(view);
    renderAreas(view);
    renderFacts(view);
    layoutGuidance();
    ctx.onView?.(view);
    ctx.onPosition?.(view.position);

    // Partie parcourue en gris : seulement en roulant, tous les 25 m (jamais de dessin à l'arrêt).
    if (view.onRoute && traveledUpdate(s.doneAlong, view.along, view.speedKmh)) {
      s.doneAlong = view.along;
      ctx.map.showTraveled(traveledCoords(s.state.route.line, view.along));
    }

    // Flèche (et caméra si elle suit) animées jusqu'à la nouvelle position (src/ui/map.js).
    ctx.map.navigateTo({
      lonlat: view.position, bearing: view.bearing, zoom: view.zoom, pitch: view.pitch,
      follow: s.follow, padding: cameraPadding(), speedKmh: view.speedKmh, northUp: s.northUp,
    });
  }

  /** Pictogrammes maison des lignes : écusson « P » (aire officielle), carré « P » (parking OpenStreetMap). */
  const AREA_ICONS = {
    official: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ico-fill" d="M12 1.5 21 5v6.5c0 5.4-3.8 9.7-9 11-5.2-1.3-9-5.6-9-11V5z"/><path class="nav-area-ico-p" d="M9.2 17V7h3.6a3.1 3.1 0 0 1 0 6.2H9.2"/></svg>',
    osm: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="ico-fill" x="2.5" y="2.5" width="19" height="19" rx="4"/><path class="nav-area-ico-p" d="M9.2 18V6h3.8a3.4 3.4 0 0 1 0 6.8H9.2"/></svg>',
  };

  /** Contenu d'une ligne (bouton) de la liste : pictogramme, nom, distance · heure · places PL. */
  function fillAreaRow(b, d) {
    if (b.dataset.icon !== d.icon) {
      b.dataset.icon = d.icon;
      b.querySelector('.nav-area-ico').innerHTML = AREA_ICONS[d.icon];
    }
    b.querySelector('.nav-area-ico').setAttribute('title', d.kind);
    const texts = [['.nav-area-name', d.name], ['.nav-area-dist', d.distance], ['.nav-area-eta', d.eta], ['.nav-area-places', d.places]];
    for (const [sel, t] of texts) {
      const n = b.querySelector(sel);
      if (n.textContent !== t) n.textContent = t;
    }
    b.setAttribute('aria-label', `${d.kind} : ${d.name}, ${d.distance}, arrivée ${d.eta}, ${d.places}`);
  }

  function newAreaRow(id) {
    const li = document.createElement('li');
    li.dataset.id = id;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nav-area';
    b.dataset.id = id;
    const ico = document.createElement('span');
    ico.className = 'nav-area-ico';
    const text = document.createElement('span');
    text.className = 'nav-area-text';
    const name = document.createElement('span');
    name.className = 'nav-area-name';
    const facts = document.createElement('span');
    facts.className = 'nav-area-facts';
    for (const cls of ['nav-area-dist', 'nav-area-eta', 'nav-area-places']) {
      const x = document.createElement('span');
      x.className = cls;
      facts.append(x);
    }
    text.append(name, facts);
    b.append(ico, text);
    li.append(b);
    return li;
  }

  /**
   * Liste « Aires et parkings PL » : lignes mises à jour sur place (src/lib/areas-route.js, areaRowsPlan), jamais
   * reconstruites en entier ; à l'arrêt avec les mêmes aires, rien ne bouge (aucun dessin de la carte).
   */
  function renderAreas(view) {
    ui.areasBtn.setAttribute('aria-pressed', String(!!s?.areasOpen));
    ui.areas.hidden = !s?.areasOpen;
    if (!s?.areasOpen) return;
    const next = view?.nextAreas ?? [];
    const now = new Date();
    const texts = next.map((n) => ({ id: n.id, n, d: describeNextArea(n, now) }));
    // Mêmes textes, ou arrêté avec les mêmes aires : rien à redessiner (src/lib/areas-route.js).
    const shown = {
      key: JSON.stringify([s.areasCount, texts.map(({ id, d }) => [id, d.name, d.distance, d.eta, d.places])]),
      ids: JSON.stringify([s.areasCount, texts.map(({ id }) => id)]),
      at: now.getTime(),
    };
    if (!nextAreasChanged(s.areasShown, shown, view?.speedKmh, shown.at)) return;
    s.areasShown = shown;
    s.areasById = new Map(texts.map((t) => [t.id, t]));
    if (s.areaPicked) renderAreaCard();
    const rows = new Map([...ui.areasList.children].map((li) => [li.dataset.id, li]));
    const plan = areaRowsPlan([...rows.keys()], texts.map((t) => t.id));
    for (const id of plan.remove) rows.get(id).remove();
    let prev = null;
    for (const { id, d } of texts) {
      let li = rows.get(id);
      if (!li || !li.isConnected) li = newAreaRow(id);
      fillAreaRow(li.firstElementChild, d);
      // Ordre de la route : une ligne n'est déplacée que si elle n'est pas déjà à sa place.
      const want = prev ? prev.nextElementSibling : ui.areasList.firstElementChild;
      if (want !== li) ui.areasList.insertBefore(li, want);
      prev = li;
    }
    const empty = texts.length === 0;
    if (ui.areasEmpty.hidden !== !empty) ui.areasEmpty.hidden = !empty;
    const msg = s.areasCount ? 'Plus d\'aire sur la suite du trajet.' : 'Aucune aire trouvée sur ce trajet (ou recherche en cours).';
    if (ui.areasEmpty.textContent !== msg) ui.areasEmpty.textContent = msg;
  }

  /** Fiche courte de l'aire touchée (lecture seule). */
  function renderAreaCard() {
    const t = s?.areaPicked ? s.areasById?.get(s.areaPicked) : null;
    ui.areaCard.hidden = !t;
    if (!t) return;
    const { d } = t;
    const facts = `${d.kind} · ${d.distance} · arrivée ${d.eta} · ${d.places}`;
    const more = ctx.areaFacts?.(t.id) ?? '';
    if (ui.areaCardName.textContent !== d.name) ui.areaCardName.textContent = d.name;
    if (ui.areaCardFacts.textContent !== facts) ui.areaCardFacts.textContent = facts;
    if (ui.areaCardMore.textContent !== more) ui.areaCardMore.textContent = more;
    ui.areaCardMore.hidden = !more;
  }

  /** « Y aller » et « Fiche complète » : actifs seulement à l'arrêt (moins de 5 km/h pendant 3 s). */
  function renderAreaButtons() {
    const off = String(!s?.park?.parked);
    for (const b of [ui.areaGo, ui.areaSheet]) if (b.getAttribute('aria-disabled') !== off) b.setAttribute('aria-disabled', off);
  }

  /** Ouvre ou ferme la liste ; fermée seule au bout de 20 s sans toucher. */
  function setAreasOpen(open) {
    if (!s) return;
    s.areasOpen = open;
    s.areasShown = null; // liste ouverte : lignes à jour
    clearTimeout(s.areasTimer);
    if (open) touchAreas();
    else {
      s.areaPicked = null;
      ui.areaCard.hidden = true;
      ctx.map.highlightArea?.(null);
    }
    renderAreas(s.view);
    renderAreaButtons();
    renderRoad();
    layoutGuidance();
  }

  /** Toucher ou faire défiler la liste relance les 20 s. */
  function touchAreas() {
    if (!s?.areasOpen) return;
    clearTimeout(s.areasTimer);
    s.areasTimer = setTimeout(() => setAreasOpen(false), AREA_LIST.AUTO_CLOSE_MS);
  }

  /** Aire touchée : repère mis en évidence, fiche courte ; la carte ne se déplace sur l'aire qu'à l'arrêt. */
  function pickArea(id) {
    if (!s) return;
    s.areaPicked = id;
    ctx.map.highlightArea?.(id);
    renderAreaCard();
    layoutGuidance();
    const t = s.areasById?.get(id);
    if (s.park?.parked && t?.n.lonlat) {
      s.follow = false;
      s.overview = false;
      renderFollow();
      ctx.map.showPlace?.(t.n.lonlat);
    }
  }

  function saveDriving(force = false) {
    if (!s?.state?.driving || s.sim) return;
    const now = Date.now();
    if (!force && now - (s.drivingSavedAt ?? 0) < SAVE_DRIVING_MS) return;
    s.drivingSavedAt = now;
    ctx.onDriving?.(s.state.driving);
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
    saveDriving();
  }

  /** Alertes redessinées hors d'une position (recalcul, signal perdu) : pas de mouvement de carte. */
  function refreshAlerts(view) {
    renderAlerts(view);
    layoutGuidance();
  }

  async function reroute(from) {
    const session = s;
    refreshAlerts(s.view);
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
      s.doneAlong = null;
      ctx.map.showRoute(route.coordinates, route.bbox, { fit: false });
      ctx.map.showTraveled([]);
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
    if (s === session && s.view) refreshAlerts({ ...s.view, rerouting: s.state.rerouting, rerouteBlocked: s.state.rerouteBlocked });
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
      refreshAlerts(s.view);
    }
  }

  // ───────── Boutons ─────────

  function renderFollow() {
    ui.recenter.setAttribute('aria-pressed', String(!!s?.follow));
    ui.recenter.hidden = !s || s.follow; // n'apparaît que si la carte a été déplacée
    ui.overview.setAttribute('aria-pressed', String(!!s?.overview));
    ui.compass.setAttribute('aria-pressed', String(!!s?.northUp));
    ui.compass.setAttribute('aria-label', s?.northUp ? 'Cap en haut' : 'Nord en haut');
    renderRoad();
    layoutGuidance();
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
    const { width, height } = size();
    const r = root.getBoundingClientRect();
    const land = isLandscape({ width, height });
    const topBox = ui.top.getBoundingClientRect();
    const top = land ? 20 : Math.min(Math.round(height * 0.35), Math.round(topBox.bottom - r.top) + 20);
    const bottom = land ? 20 : Math.min(Math.round(height * 0.45), ui.bottom.offsetHeight + 20);
    const left = land ? Math.round(width * LANDSCAPE_COLUMN) + 20 : Math.min(60, Math.round(width * 0.1));
    const right = ui.mapbtns.offsetWidth + 2 * INSET;
    ctx.map.overview(overviewBbox(s.state), { top, bottom, left, right });
    scheduleRecenter();
  }

  function toast(text) {
    if (!s) return;
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    clearTimeout(s.toastTimer);
    s.toastTimer = setTimeout(() => { ui.toast.hidden = true; renderRoad(); }, TOAST_MS);
    layoutGuidance();
  }

  function renderLayer() {
    const b = guidanceLayerButton(s?.layer);
    const outside = s?.layer === 'satellite' && !!s.layerMessage;
    const text = document.createElement('span');
    text.textContent = outside ? 'France seulement' : b.text.split(' ').slice(1).join(' ');
    ui.layer.replaceChildren(symbolSvg(b.next === 'satellite' ? 'satellite' : 'plan'), text);
    ui.layer.setAttribute('aria-label', outside ? `${s.layerMessage}. Passer en plan` : b.label);
  }

  /** Plan ↔ satellite, pour ce guidage seulement (le guidage démarre toujours en plan). */
  function toggleLayer() {
    if (!s) return;
    s.layer = guidanceLayerButton(s.layer).next;
    ctx.map.setLayer(s.layer);
    renderLayer();
  }

  /** Loupe : rangée de catégories à une touche le long du trajet, fermée seule au bout de 8 s. */
  function setSearch(open) {
    if (!s) return;
    s.searchOpen = open;
    ui.search.hidden = !open;
    ui.searchBtn.setAttribute('aria-expanded', String(open));
    clearTimeout(s.searchTimer);
    if (open) {
      s.searchTimer = setTimeout(() => setSearch(false), AUTO_CLOSE_MS);
      ui.toast.hidden = true; // message bref effacé : la rangée prend sa place
      renderRoad();
    }
    layoutGuidance();
  }

  function setDetails(open) {
    if (!s) return;
    s.detailsOpen = open;
    ui.details.hidden = !open;
    ui.sheet.setAttribute('aria-expanded', String(open));
    layoutGuidance();
  }

  function setConfirm(open) {
    if (!s) return;
    ui.confirm.hidden = !open;
    clearTimeout(s.confirmTimer);
    if (open) {
      s.confirmTimer = setTimeout(() => setConfirm(false), AUTO_CLOSE_MS);
      ui.keep.focus();
    }
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
  function start({
    route, params, vehicle, simulate = null, areas = null, announceAreas = false, rules = null,
    driving = null, driveVoice = true, wind = null, windGust, windVoice = true,
  }) {
    if (s) stop();
    const now = Date.now();
    s = {
      // Simulation : fausse position, le vrai décompte de conduite n'est ni lu ni modifié.
      state: startNavigation(route, {
        destination: params.end, now, areas, announceAreas, rules,
        driving: simulate ? null : driving, driveVoice, wind, windGust, windVoice,
      }),
      drivingSavedAt: now,
      areasOpen: false, areasCount: Array.isArray(areas) ? areas.length : 0, areasShown: null,
      areasTimer: null, areaPicked: null, areasById: new Map(),
      params, vehicle, view: null, follow: true, overview: false, northUp: false, error: '', gpsLost: false,
      layer: GUIDANCE_START_LAYER, layerMessage: '', park: null, doneAlong: null,
      tollDistance: typeof route.tollDistance === 'number' ? route.tollDistance : undefined,
      searchOpen: false, detailsOpen: false,
      sim: simulate ? createSimulator(route.coordinates, { speedKmh: simulate.speedKmh }) : null,
      watchId: null, simTimer: null, signalTimer: null, recenterTimer: null, releaseTimer: null,
      searchTimer: null, confirmTimer: null, toastTimer: null,
    };
    app.classList.add('navigating');
    root.hidden = false;
    ui.sim.hidden = !s.sim;
    ui.road.hidden = true;
    ui.search.hidden = true;
    ui.details.hidden = true;
    ui.confirm.hidden = true;
    ui.toast.hidden = true;
    ui.sheet.setAttribute('aria-expanded', 'false');
    ui.searchBtn.setAttribute('aria-expanded', 'false');
    ui.alt.setAttribute('aria-disabled', 'true');
    ui.stop.setAttribute('aria-label', 'Quitter le guidage');
    ui.areasBtn.replaceChildren(symbolSvg('parking'), Object.assign(document.createElement('span'), { textContent: 'Aires PL' }));
    renderFollow();
    ui.areasList.replaceChildren();
    ui.areaCard.hidden = true;
    renderAreaButtons();
    renderAreas(null);
    ctx.map.setLayer(s.layer);
    renderLayer();
    renderThen(null);
    ui.alert.hidden = true;
    ui.rule.hidden = true;
    ui.drive.hidden = true;
    ui.work.hidden = true;
    ui.reroute.hidden = true;
    ui.more.hidden = true;
    ui.limit.hidden = true;
    ui.speedo.classList.remove('over');
    setIcon({ kind: 'arrow', angle: 0 });
    ui.dist.textContent = '';
    setInstruction(s.sim ? 'Simulation…' : 'Recherche du signal GPS…');
    for (const n of [ui.remaining, ui.time, ui.eta, ui.speed]) n.textContent = '—';
    renderFacts(null);
    renderVoice();
    ctx.map.setNavigating(true);
    ctx.map.showRoute(route.coordinates, route.bbox, { fit: false });
    ctx.voice.speak(s.sim ? 'Simulation du trajet.' : 'Guidage démarré.', { interrupt: true });
    ctx.wakeLock.enable();
    requestAnimationFrame(() => layoutGuidance());

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
    if (!s.sim) saveDriving(true);
    const session = s;
    s = null;
    if (session.watchId !== null) navigator.geolocation.clearWatch(session.watchId);
    clearInterval(session.simTimer);
    clearInterval(session.signalTimer);
    for (const t of ['recenterTimer', 'releaseTimer', 'searchTimer', 'confirmTimer', 'toastTimer', 'areasTimer']) clearTimeout(session[t]);
    ctx.map.highlightArea?.(null);
    ctx.voice.cancel();
    ctx.wakeLock.disable();
    root.hidden = true;
    root.classList.remove('nav-tight', 'land', 'sheet-open');
    app.classList.remove('navigating');
    ctx.map.setNavigating(false);
    ctx.onEnd?.(message);
  }

  window.addEventListener('resize', () => layoutGuidance());
  // Appli mise en arrière-plan ou fermée : le décompte de conduite est enregistré tout de suite.
  window.addEventListener('pagehide', () => saveDriving(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDriving(true); });
  // ✕ : confirmation (deux gros boutons) ; à l'arrivée, fin directe.
  ui.stop.addEventListener('click', () => {
    if (!s) return;
    if (s.view?.arrived) stop();
    else setConfirm(true);
  });
  ui.quit.addEventListener('click', () => stop());
  ui.keep.addEventListener('click', () => setConfirm(false));
  ui.reroute.addEventListener('click', () => {
    if (!s) return;
    const r = requestReroute(s.state, Date.now());
    s.state = r.state;
    if (r.events.length) ui.reroute.disabled = true;
    handle(r.events);
  });
  // « Pas une pause (travail) » : un appui, seulement affiché sous 10 km/h ; le moteur refuse en roulant.
  ui.work.addEventListener('click', () => {
    if (!s) return;
    const r = markStopAsWork(s.state, Date.now());
    if (!r.driving) return;
    s.state = r.state;
    if (s.view) s.view = { ...s.view, driving: r.driving };
    refreshAlerts(s.view);
    saveDriving(true);
  });
  ui.compass.addEventListener('click', () => {
    if (!s) return;
    s.northUp = !s.northUp;
    renderFollow();
    if (s.view && s.follow) render(s.view);
  });
  ui.recenter.addEventListener('click', recenter);
  ui.overview.addEventListener('click', overview);
  ui.searchBtn.addEventListener('click', () => setSearch(!s?.searchOpen));
  ui.layer.addEventListener('click', () => { toggleLayer(); setSearch(false); });
  ui.areasBtn.addEventListener('click', () => {
    if (!s) return;
    setAreasOpen(!s.areasOpen);
    setSearch(false);
  });
  ui.areasClose.addEventListener('click', () => setAreasOpen(false));
  ui.areasList.addEventListener('click', (e) => {
    const b = e.target.closest('.nav-area');
    if (b?.dataset.id) pickArea(b.dataset.id);
  });
  for (const ev of ['pointerdown', 'scroll', 'wheel']) ui.areas.addEventListener(ev, touchAreas, { passive: true });
  // Réservés à l'arrêt : en roulant, un message et rien d'autre (jamais de changement d'itinéraire).
  ui.areaGo.addEventListener('click', () => {
    if (!s) return;
    if (!s.park?.parked) { toast('Disponible à l\'arrêt'); return; }
    overview();
    toast('Autres itinéraires : bientôt');
  });
  ui.areaSheet.addEventListener('click', () => {
    if (!s || !s.areaPicked) return;
    if (!s.park?.parked) { toast('Disponible à l\'arrêt'); return; }
    ctx.onAreaOpen?.(s.areaPicked);
  });
  ui.voice.addEventListener('click', () => {
    const on = !ctx.voice.enabled;
    ctx.voice.setEnabled(on);
    ctx.onVoiceToggle?.(on);
    renderVoice();
    if (on) ctx.voice.speak('Voix activée.', { interrupt: true });
  });
  // Autres itinéraires (Bloc 2) : à l'arrêt seulement ; pour l'instant, vue d'ensemble du trajet.
  ui.alt.addEventListener('click', () => {
    if (!s) return;
    if (!s.park?.parked) { toast('Disponible à l\'arrêt'); return; }
    overview();
    toast('Autres itinéraires : bientôt');
  });
  ui.more.addEventListener('click', () => setDetails(true));
  // Panneau du bas : toucher la poignée l'ouvre ou le ferme ; la tirer vers le haut l'ouvre, vers le bas le ferme.
  let drag = null;
  ui.sheet.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, moved: false }; });
  ui.sheet.addEventListener('pointermove', (e) => {
    if (!drag || drag.moved || !s) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) < DRAG_PX) return;
    drag.moved = true;
    setDetails(dy < 0);
  });
  ui.sheet.addEventListener('pointerup', () => { setTimeout(() => { drag = null; }, 0); });
  ui.sheet.addEventListener('click', () => {
    if (drag?.moved) return;
    setDetails(!s?.detailsOpen);
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
    /** Prévisions de vent arrivées après « Démarrer » : le moteur les place sur le tracé. */
    setWind(forecast) {
      if (!s) return;
      s.state = setNavigationWind(s.state, forecast);
    },
    /** Fichier des tunnels arrivé après « Démarrer » (phase 5b) : le moteur replace les tunnels interdits. */
    setTunnels(data) {
      if (!s) return;
      s.state = setNavigationTunnels(s.state, data);
    },
    /** Voies à accès conditionnel arrivées après « Démarrer » (phase 5d) : le moteur les replace sur le tracé. */
    setAccess(ways) {
      if (!s) return;
      s.state = setNavigationAccess(s.state, ways);
    },
    /** Fichiers des pays voisins arrivés après « Démarrer » (phase 5c) : le moteur replace les frontières. */
    setCountries(countries) {
      if (!s) return;
      s.state = setNavigationCountries(s.state, countries);
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
      layoutGuidance();
    },
  };
}
