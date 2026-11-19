// Partage sans serveur (phase 7) : lien d'itinéraire (# de l'URL), fichier GPX 1.1, lien de carte OpenStreetMap,
// adresse de l'appli, et choix de la méthode (partage Android, copie, téléchargement). Logique pure, sans DOM.
//
// Règles :
// - seuls des champs choisis (liste blanche) entrent dans ce qui est partagé : jamais la clé ORS ni le profil véhicule ;
// - vie privée : si le départ est « Ma position », il n'est partagé que si l'utilisateur coche « Inclure mon point
//   de départ ». Sinon le lien ne contient que l'arrivée (le destinataire part de sa propre position GPS) et le tracé
//   GPX commence au premier carrefour situé à plus de 500 m du départ ;
// - un lien reçu est validé (coordonnées, longueur, noms raccourcis, variante connue) ; decodeRouteLink ne lève jamais.
// GPX 1.1 : schéma https://www.topografix.com/GPX/1/1/ (gpx > metadata, wpt, trk > trkseg > trkpt ; lat/lon en
// degrés décimaux WGS84, attributs obligatoires de wpt/trkpt).

import { haversine } from './ors-response.js';

export const SHARE = Object.freeze({
  /** Version du format de lien (paramètre v). */
  LINK_VERSION: '1',
  /** Au-delà, un lien reçu est refusé sans être lu. */
  MAX_HASH_LENGTH: 2000,
  /** Noms de lieux raccourcis à cette longueur. */
  MAX_NAME_LENGTH: 80,
  /** Décimales des coordonnées dans le lien (5 ≈ 1 m). */
  LINK_DECIMALS: 5,
  /** Décimales des coordonnées dans le GPX (6 ≈ 10 cm). */
  GPX_DECIMALS: 6,
  /** Départ « Ma position » non partagé : le tracé GPX commence après cette distance (m), au carrefour suivant. */
  PRIVACY_MIN_M: 500,
  /** Zoom du lien de carte OpenStreetMap (rue). */
  OSM_ZOOM: 17,
});

/** Variantes transmises dans un lien (clé de route-options.js ; alternatives d'ORS par rang). */
export const SHARE_VARIANTS = Object.freeze(['recommended', 'shortest', 'no-toll', 'fastest', 'alternative-2', 'alternative-3']);

export const SHARED_ROUTE_TEXT = 'Itinéraire partagé : touche « Calculer l\'itinéraire ».';
export const SHARED_ROUTE_NO_KEY_TEXT = 'Itinéraire partagé reçu. Pour le calculer, crée une clé gratuite sur heigit.org '
  + '(offre gratuite HeiGIT), puis colle-la dans Réglages (⚙).';
export const BAD_LINK_TEXT = 'Lien de partage illisible : ignoré.';
export const VARIANT_MISSING_TEXT = 'La variante partagée n\'est pas proposée pour ce trajet : Recommandé affiché.';
/** Nom donné au départ quand il était « Ma position » chez l'expéditeur (et qu'il l'a inclus). */
export const SHARED_START_NAME = 'Point de départ';

// ---------- Validation ----------

/** Vrai pour [lon, lat] fini et dans les bornes WGS84. */
export function isLonLat(p) {
  return Array.isArray(p) && p.length >= 2
    && typeof p[0] === 'number' && typeof p[1] === 'number'
    && Number.isFinite(p[0]) && Number.isFinite(p[1])
    && p[0] >= -180 && p[0] <= 180 && p[1] >= -90 && p[1] <= 90;
}

const round = (x, d) => Number(x.toFixed(d));

/**
 * Nom de lieu sûr : texte seulement, caractères de contrôle et de mise en forme retirés, espaces réduits, raccourci.
 * Il sera de toute façon affiché avec textContent.
 */
export function cleanName(text) {
  if (typeof text !== 'string') return '';
  // \p{C} : contrôle, format (dont les inversions de sens U+202E), non attribués, substituts isolés.
  const flat = text.replace(/\p{C}+/gu, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  if (chars.length <= SHARE.MAX_NAME_LENGTH) return flat;
  return `${chars.slice(0, SHARE.MAX_NAME_LENGTH - 1).join('').trimEnd()}…`;
}

/** « lat,lon » strict (pas d'exposant, pas d'espace, 8 décimales au plus) → [lon, lat] ou null. */
function parseLatLon(text) {
  if (typeof text !== 'string') return null;
  const m = /^(-?\d{1,3}(?:\.\d{1,8})?),(-?\d{1,3}(?:\.\d{1,8})?)$/.exec(text);
  if (!m) return null;
  const p = [Number(m[2]), Number(m[1])];
  return isLonLat(p) ? p : null;
}

const latLonText = ([lon, lat]) => `${round(lat, SHARE.LINK_DECIMALS)},${round(lon, SHARE.LINK_DECIMALS)}`;

// ---------- Variante ----------

/** Identifiant partageable de l'itinéraire choisi (rang compris pour les alternatives d'ORS). */
export function variantId(option, index) {
  if (option?.key === 'alternative') {
    const id = `alternative-${index + 1}`;
    return SHARE_VARIANTS.includes(id) ? id : 'recommended';
  }
  return SHARE_VARIANTS.includes(option?.key) ? option.key : 'recommended';
}

/** Rang, dans les itinéraires calculés par le destinataire, de la variante partagée ; -1 si absente. */
export function findVariantIndex(options, id) {
  if (!Array.isArray(options)) return -1;
  return options.findIndex((o, i) => variantId(o, i) === id);
}

// ---------- Lien d'itinéraire ----------

/** Adresse de l'appli (sans # ni paramètres). */
export function appBaseUrl(href) {
  try {
    const u = new URL(href);
    u.hash = '';
    u.search = '';
    return u.href;
  } catch {
    return '';
  }
}

/**
 * Lien qui ouvre Gabarit avec l'itinéraire pré-rempli.
 * @param {string} baseUrl adresse de l'appli
 * @param {{ start:number[], end:number[], fromLabel?:string, toLabel?:string, startIsMyPosition?:boolean,
 *   includeStart?:boolean, avoidTolls?:boolean, avoidFerries?:boolean, variant?:string }} route
 *   Tout autre champ (clé, véhicule…) est ignoré.
 */
export function encodeRouteLink(baseUrl, route) {
  if (!isLonLat(route?.end)) throw new Error('Arrivée inconnue : rien à partager.');
  const params = new URLSearchParams();
  params.set('v', SHARE.LINK_VERSION);
  const withStart = isLonLat(route.start) && (!route.startIsMyPosition || route.includeStart === true);
  if (withStart) {
    params.set('from', latLonText(route.start));
    const name = route.startIsMyPosition ? SHARED_START_NAME : cleanName(route.fromLabel);
    if (name) params.set('fromName', name);
  }
  params.set('to', latLonText(route.end));
  const toName = cleanName(route.toLabel);
  if (toName) params.set('toName', toName);
  params.set('tolls', route.avoidTolls ? '1' : '0');
  params.set('ferries', route.avoidFerries ? '1' : '0');
  params.set('variant', SHARE_VARIANTS.includes(route.variant) ? route.variant : 'recommended');
  return `${appBaseUrl(baseUrl)}#${params.toString()}`;
}

/** Un seul exemplaire attendu par paramètre (un doublon rend le lien ambigu : refusé). */
function single(params, name) {
  const all = params.getAll(name);
  if (all.length > 1) throw new Error('duplicate');
  return all.length ? all[0] : null;
}

/**
 * Lit le # d'une URL. Ne lève jamais.
 * @returns {{ ok:true, route:{ from:{lon:number,lat:number,label:string}|null, to:{lon:number,lat:number,label:string},
 *   avoidTolls:boolean, avoidFerries:boolean, variant:string } } | { ok:false, error:string } | null}
 *   null : pas de lien de partage dans l'URL (rien à dire).
 */
export function decodeRouteLink(hash) {
  try {
    if (typeof hash !== 'string') return null;
    const text = hash.startsWith('#') ? hash.slice(1) : hash;
    if (!text) return null;
    if (text.length > SHARE.MAX_HASH_LENGTH) return { ok: false, error: BAD_LINK_TEXT };
    const params = new URLSearchParams(text);
    const v = single(params, 'v');
    if (v === null) return null; // autre ancre éventuelle : pas un lien Gabarit
    if (v !== SHARE.LINK_VERSION) return { ok: false, error: BAD_LINK_TEXT };

    const to = parseLatLon(single(params, 'to'));
    if (!to) return { ok: false, error: BAD_LINK_TEXT };
    const fromText = single(params, 'from');
    const from = fromText === null ? null : parseLatLon(fromText);
    if (fromText !== null && !from) return { ok: false, error: BAD_LINK_TEXT };

    const flag = (name) => {
      const x = single(params, name);
      if (x === null || x === '0') return false;
      if (x === '1') return true;
      throw new Error('flag');
    };
    const variant = single(params, 'variant');
    const coordName = ([lon, lat]) => `${round(lat, SHARE.LINK_DECIMALS)}, ${round(lon, SHARE.LINK_DECIMALS)}`;
    return {
      ok: true,
      route: {
        from: from ? { lon: from[0], lat: from[1], label: cleanName(single(params, 'fromName')) || coordName(from) } : null,
        to: { lon: to[0], lat: to[1], label: cleanName(single(params, 'toName')) || coordName(to) },
        avoidTolls: flag('tolls'),
        avoidFerries: flag('ferries'),
        variant: SHARE_VARIANTS.includes(variant) ? variant : 'recommended',
      },
    };
  } catch {
    return { ok: false, error: BAD_LINK_TEXT };
  }
}

// ---------- Lieu, appli ----------

/** Lien de carte OpenStreetMap vers un point [lon, lat] (marqueur + vue rue). */
export function osmLink(lonlat, zoom = SHARE.OSM_ZOOM) {
  if (!isLonLat(lonlat)) throw new Error('Position inconnue : rien à partager.');
  const lat = round(lonlat[1], SHARE.LINK_DECIMALS);
  const lon = round(lonlat[0], SHARE.LINK_DECIMALS);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}

/** Texte de partage de l'appli. */
export function appShareText() {
  return 'Gabarit, GPS poids lourd gratuit (itinéraires selon le gabarit du camion). Pour calculer des itinéraires, '
    + 'crée ta clé gratuite sur heigit.org et colle-la dans Réglages (⚙).';
}

// ---------- GPX ----------

/** Échappe un texte pour XML (contenu et attributs) et retire les caractères interdits en XML 1.0. */
export function xmlEscape(text) {
  return String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Indice du point où commence le tracé partagé quand le départ (« Ma position ») est caché :
 * début de la première manœuvre (carrefour, rond-point…) située à plus de PRIVACY_MIN_M du départ, mesuré le long
 * du tracé. Sans manœuvre au-delà : premier point à plus de PRIVACY_MIN_M. Aucun : -1 (rien à montrer).
 * @param {{ coordinates:number[][], steps?:{ wayPoints:number[]|null }[] }} route
 */
export function privacyStartIndex(route, minM = SHARE.PRIVACY_MIN_M) {
  const line = route?.coordinates;
  if (!Array.isArray(line) || line.length < 2) return -1;
  const along = [0];
  for (let i = 1; i < line.length; i += 1) along.push(along[i - 1] + haversine(line[i - 1], line[i]));
  const last = line.length - 1;
  const starts = (route.steps ?? [])
    .map((s) => (Array.isArray(s?.wayPoints) ? s.wayPoints[0] : null))
    .filter((i) => Number.isInteger(i) && i > 0 && i < last)
    .sort((a, b) => a - b);
  const atStep = starts.find((i) => along[i] >= minM);
  if (atStep !== undefined) return atStep;
  const atPoint = along.findIndex((d, i) => i < last && d >= minM);
  return atPoint;
}

const coordAttrs = ([lon, lat]) => `lat="${round(lat, SHARE.GPX_DECIMALS)}" lon="${round(lon, SHARE.GPX_DECIMALS)}"`;

/**
 * Fichier GPX 1.1 de l'itinéraire choisi : tracé, départ et arrivée.
 * Départ « Ma position » sans includeStart : pas de point de départ, tracé raccourci (privacyStartIndex).
 * @param {{ route:{ coordinates:number[][], steps?:object[] }, fromLabel?:string, toLabel?:string,
 *   startIsMyPosition?:boolean, includeStart?:boolean, name?:string, now?:Date }} p
 */
export function buildGpx({ route, fromLabel = '', toLabel = '', startIsMyPosition = false, includeStart = false, name, now = new Date() }) {
  const all = Array.isArray(route?.coordinates) ? route.coordinates.filter(isLonLat) : [];
  if (all.length < 2) throw new Error('Itinéraire sans tracé : rien à partager.');
  const hideStart = startIsMyPosition && includeStart !== true;
  let line = all;
  if (hideStart) {
    const from = privacyStartIndex({ ...route, coordinates: all });
    line = from >= 0 ? all.slice(from) : [];
  }
  const toName = cleanName(toLabel) || 'Arrivée';
  const fromName = startIsMyPosition ? SHARED_START_NAME : (cleanName(fromLabel) || 'Départ');
  const title = cleanName(name) || `Gabarit : vers ${toName}`;
  const time = now instanceof Date && Number.isFinite(now.getTime()) ? now.toISOString() : null;

  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Gabarit" xmlns="http://www.topografix.com/GPX/1/1" '
      + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
      + 'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    '  <metadata>',
    `    <name>${xmlEscape(title)}</name>`,
    time ? `    <time>${time}</time>` : null,
    '  </metadata>',
    hideStart ? null : `  <wpt ${coordAttrs(all[0])}><name>${xmlEscape(fromName)}</name></wpt>`,
    `  <wpt ${coordAttrs(all[all.length - 1])}><name>${xmlEscape(toName)}</name></wpt>`,
  ];
  if (line.length >= 2) {
    out.push('  <trk>', `    <name>${xmlEscape(title)}</name>`, '    <trkseg>');
    for (const p of line) out.push(`      <trkpt ${coordAttrs(p)}/>`);
    out.push('    </trkseg>', '  </trk>');
  }
  out.push('</gpx>', '');
  return out.filter((l) => l !== null).join('\n');
}

/** Nom de fichier sûr : gabarit-<arrivée>.gpx (lettres sans accents, chiffres, tirets). */
export function gpxFileName(toLabel) {
  const slug = String(toLabel ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40).replace(/-+$/g, '');
  return `gabarit-${slug || 'itineraire'}.gpx`;
}

export const GPX_MIME = 'application/gpx+xml';

// ---------- Méthode de partage ----------

/**
 * Comment partager, selon ce que permet le navigateur.
 * Lien : partage Android → copie dans le presse-papiers → lien affiché (à copier à la main).
 * Fichier : partage du fichier (si navigator.canShare({ files }) l'accepte) → téléchargement.
 * @param {{ kind:'link'|'file', hasShare?:boolean, canShareFiles?:boolean, hasClipboard?:boolean }} p
 * @returns {'share'|'copy'|'show'|'download'}
 */
export function pickShareMethod({ kind, hasShare = false, canShareFiles = false, hasClipboard = false }) {
  if (kind === 'file') return hasShare && canShareFiles ? 'share' : 'download';
  if (hasShare) return 'share';
  if (hasClipboard) return 'copy';
  return 'show';
}

/** Message affiché après coup ('' : rien à dire, le partage Android s'est chargé du retour). */
export function shareResultText(method, { cancelled = false, failed = false } = {}) {
  if (cancelled) return '';
  if (failed) {
    return method === 'download' ? 'Téléchargement impossible sur ce navigateur.' : 'Partage impossible : copie le lien ci-dessous.';
  }
  if (method === 'copy') return 'Lien copié : colle-le dans un message.';
  if (method === 'download') return 'Fichier téléchargé (dossier Téléchargements).';
  if (method === 'show') return 'Copie ce lien à la main :';
  return '';
}
