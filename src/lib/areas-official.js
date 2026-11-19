// Jeu officiel des aires de stationnement PL (phase 9). Logique pure.
//
// Source : point d'accès national (règlement délégué UE 885/2013 ; décret 2015-474 et arrêté du 27 avril 2015 ;
// arrêté du 24 mars 2026 qui désigne transport.data.gouv.fr), fichiers publiés par Bison Futé
// (bison-fute.gouv.fr/action-e,langen.html), Licence Ouverte Etalab v2.0 :
// - réseau concédé (autoroutes à péage) : fichier xlsx « Donnees_statiques_aire_PL » 2025 SCA ;
// - réseau non concédé (autoroutes non concédées, routes nationales) : Aires_PL_2018_ANC_V2.ods.
// Ces tableurs ne sont pas lisibles tels quels par le navigateur : tools/aires-pl-update.mjs (GitHub Action
// hebdomadaire, .github/workflows/aires-pl.yml) les convertit en data/aires-pl.json, que l'appli lit.
//
// Colonnes reconnues par mots-clés (FIELDS), en français ou en anglais, dans les 5 premières lignes. Fichier concédé 2025
// (lu par l'Action) : ligne 1 = date + titres français, ligne 2 = titres anglais du règlement 885/2013 (« Name, City »,
// « Location », « primary road identifier 1/direction », places gratuites / payantes « for trucks », « secure parking
// Y/N », « price and currency », opérateur…). Données : « La Ravoire :: 74350 :: CRUSEILLES », « 46°01821, 6°11771 »
// (° à la place de la virgule décimale), « A41 N / GENEVE ». Des cellules sont vides : la position de chaque valeur
// vient de la référence de cellule du XML (A, B, C…), jamais de l'ordre des valeurs.

import { parseCoordinates } from './coords.js';

export const OFFICIAL = Object.freeze({
  SOURCE: 'Bison Futé — point d\'accès national (aires de stationnement PL)',
  LICENCE: 'Licence Ouverte Etalab v2.0',
  FILES: Object.freeze([
    // Nom du fichier coupé en deux : tests/static-checks.test.js prend les longues chaînes pour des clés.
    Object.freeze({ url: `https://www.bison-fute.gouv.fr/IMG/xlsx/${'Donnees_statiques_'}aire_PL_2025_SCA.xlsx`, format: 'xlsx', network: 'concédé' }),
    Object.freeze({ url: 'https://www.bison-fute.gouv.fr/IMG/ods/Aires_PL_2018_ANC_V2.ods', format: 'ods', network: 'non concédé' }),
  ]),
  /** Fichier converti servi avec l'appli. */
  DATA_PATH: './data/aires-pl.json',
  /** Rayon autour du tracé (m) : les positions officielles sont parfois celles de l'entrée de l'aire. */
  RADIUS_M: 600,
});

// ───────── Lecture XML minimale (xlsx = zip de XML, ods = zip avec content.xml) ─────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };

export function decodeXml(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const attr = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}="([^"]*)"`).exec(attrs);
  return m ? decodeXml(m[1]) : null;
};

/** Chaînes partagées d'un xlsx (xl/sharedStrings.xml). */
export function parseSharedStrings(xml) {
  const out = [];
  for (const m of String(xml ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    out.push([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join(''));
  }
  return out;
}

function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(ref ?? '')?.[1];
  if (!letters) return null;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Lignes d'une feuille xlsx (xl/worksheets/sheetN.xml) : tableaux de textes. */
export function parseXlsxSheet(xml, shared = []) {
  const rows = [];
  for (const r of String(xml ?? '').matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? '';
      const body = c[2] ?? '';
      const col = columnIndex(attr(attrs, 'r'));
      const type = attr(attrs, 't');
      let v = '';
      if (type === 'inlineStr') v = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join('');
      else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (raw !== undefined) v = type === 's' ? (shared[Number(raw)] ?? '') : decodeXml(raw);
      }
      row[col ?? row.length] = v.trim();
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}

/** Texte d'une cellule ODS (paragraphes, espaces <text:s/>, sauts de ligne). */
function odsText(body) {
  return [...String(body).matchAll(/<text:p(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/text:p>)/g)]
    .map((p) => decodeXml(String(p[1] ?? '')
      .replace(/<text:s(?:\s[^>]*?text:c="(\d+)")?[^>]*\/>/g, (_, n) => ' '.repeat(Number(n) || 1))
      .replace(/<text:(tab|line-break)[^>]*\/>/g, ' ')
      .replace(/<[^>]+>/g, '')))
    .join(' ')
    .trim();
}

const MAX_COLS = 80;
const MAX_REPEAT_ROWS = 50;

/** Feuilles d'un ODS (content.xml) : [{ name, rows }]. Les répétitions de cellules vides en fin de ligne sont ignorées. */
export function parseOdsContent(xml) {
  const tables = [];
  for (const t of String(xml ?? '').matchAll(/<table:table(\s[^>]*)?>([\s\S]*?)<\/table:table>/g)) {
    const rows = [];
    for (const r of t[2].matchAll(/<table:table-row(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
      const row = [];
      for (const c of String(r[2] ?? '').matchAll(/<table:(?:covered-)?table-cell(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
        const attrs = c[1] ?? '';
        const repeat = Math.min(MAX_COLS, Number(attr(attrs, 'table:number-columns-repeated')) || 1);
        const value = attr(attrs, 'office:value');
        const text = odsText(c[2] ?? '');
        const v = (value ?? text ?? '').trim(); // nombre : valeur exacte plutôt que le texte affiché
        for (let k = 0; k < repeat && row.length < MAX_COLS; k += 1) row.push(v);
      }
      while (row.length && row[row.length - 1] === '') row.pop();
      const times = row.length ? Math.min(MAX_REPEAT_ROWS, Number(attr(r[1] ?? '', 'table:number-rows-repeated')) || 1) : 1;
      for (let k = 0; k < times; k += 1) rows.push(row);
    }
    tables.push({ name: attr(t[1] ?? '', 'table:name') ?? '', rows });
  }
  return tables;
}

// ───────── Colonnes ─────────

/** Texte d'en-tête simplifié : minuscules, sans accents ni ponctuation. */
export function normalizeHeader(h) {
  return String(h ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Champs reconnus, dans l'ordre d'attribution (une colonne sert à un seul champ). */
export const FIELDS = Object.freeze([
  ['operator', /exploitant|gestionnaire|concessionnaire|societe|operateur|operator/],
  ['lat', /^lat|latitude|\blat\b|wgs ?84 y|\by wgs/],
  ['lon', /^lon|longitude|\blong\b|\blng\b|wgs ?84 x|\bx wgs/],
  ['x', /^x$|^x l(ambert )?93|lambert 93 x|^coord(onnee)?s? x$|^x lambert/],
  ['y', /^y$|^y l(ambert )?93|lambert 93 y|^coord(onnee)?s? y$|^y lambert/],
  ['coords', /coordonnees|gps|^position|localisation|\blocation\b/],
  ['id', /identifiant|^id\b|\bcode\b|reference/],
  ['name', /\bnom\b|libelle|designation|\bname\b|appellation|intitule|^aire\b/],
  ['freePlaces', /(free|gratuite?s?)\b.*\b(places?|parking)|places?\b.*\b(free|gratuite?s?)\b/],
  ['paidPlaces', /(paid|payante?s?)\b.*\b(places?|parking)|places?\b.*\b(paid|payante?s?)\b/],
  ['places', /(places?|capacite|emplacements?|stationnements?).*(pl\b|poids lourds?|camions?|hgv|trucks?|lorr)|(pl\b|poids lourds?|camions?).*(places?|capacite)/],
  ['placesAny', /places?|capacite|emplacements?|nombre total/],
  ['price', /tarif|prix|price|cout|redevance|payant|gratuit/],
  ['secure', /secur|surveill|label|niveau|gardienn|cloture/],
  ['services', /services?|equipements?|commodites?/],
  ['road', /autoroute|^route|\broute\b|\broad\b|\baxe\b|\bvoie\b|\brn\b/],
  ['direction', /\bsens\b|direction/],
]);

/** Colonnes à ne pas prendre pour un champ (« identifiant de la route » n'est pas l'identifiant de l'aire…). */
const EXCLUDE = Object.freeze({
  id: /route|road|autoroute/,
  placesAny: /\bvl\b|voitures?|vehicules legers|autocars?|cars?\b|dynami|disponibilit|availability|prix|price|tarif/,
  operator: /telephone|phone|consent/,
});

/** Associe chaque champ à une colonne d'après les en-têtes (les cellules vides gardent leur place). */
export function mapColumns(headers) {
  const norm = Array.from(headers ?? [], (h) => normalizeHeader(h));
  const used = new Set();
  const map = {};
  for (const [field, re] of FIELDS) {
    const i = norm.findIndex((h, k) => h && !used.has(k) && re.test(h) && !EXCLUDE[field]?.test(h));
    if (i >= 0) { map[field] = i; used.add(i); }
  }
  if (map.places === undefined && map.placesAny !== undefined) map.places = map.placesAny;
  delete map.placesAny;
  return map;
}

/** Champs obligatoires présents ? (nom + latitude/longitude, ou X/Y Lambert 93, ou coordonnées en une colonne) */
export function missingFields(map) {
  const missing = [];
  if (map.name === undefined) missing.push('nom de l\'aire');
  const pos = (map.lat !== undefined && map.lon !== undefined) || (map.x !== undefined && map.y !== undefined)
    || map.coords !== undefined;
  if (!pos) missing.push('position (latitude + longitude, X + Y Lambert 93 ou coordonnées GPS)');
  return missing;
}

/** Lignes où chercher les titres (une ligne de date ou de titres français peut précéder les titres anglais). */
export const HEADER_ROWS = 5;

/** Ligne d'en-tête : la première (parmi les 5 premières) où le nom et une position sont reconnus. */
export function findHeader(rows) {
  for (let i = 0; i < Math.min(HEADER_ROWS, rows.length); i += 1) {
    const map = mapColumns(rows[i] ?? []);
    if (!missingFields(map).length) return { index: i, map };
  }
  return null;
}

// ───────── Valeurs ─────────

function number(text) {
  const t = String(text ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^[-+]?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/**
 * Lambert 93 (RGF93) → longitude / latitude. Formules de la notice IGN « Projection cartographique conique conforme de
 * Lambert » (NTG 71, algorithmes ALG0004 et ALG0001) ; RGF93 et WGS 84 sont confondus à mieux qu'un mètre.
 */
export function lambert93ToWgs84(x, y) {
  const n = 0.7256077650532670;
  const c = 11754255.426096;
  const xs = 700000;
  const ys = 12655612.049876;
  const e = 0.0818191910428158;
  const lon0 = 3 * (Math.PI / 180);
  const dx = x - xs;
  const dy = ys - y;
  const r = Math.hypot(dx, dy);
  const gamma = Math.atan2(dx, dy);
  const lon = lon0 + gamma / n;
  const latIso = -Math.log(Math.abs(r / c)) / n;
  let phi = 2 * Math.atan(Math.exp(latIso)) - Math.PI / 2;
  for (let k = 0; k < 20; k += 1) {
    const s = e * Math.sin(phi);
    const next = 2 * Math.atan(((1 + s) / (1 - s)) ** (e / 2) * Math.exp(latIso)) - Math.PI / 2;
    if (Math.abs(next - phi) < 1e-12) { phi = next; break; }
    phi = next;
  }
  return { lon: lon * (180 / Math.PI), lat: phi * (180 / Math.PI) };
}

/** France métropolitaine et Corse (les aires du réseau routier national). */
export function inMetropole({ lon, lat }) {
  return Number.isFinite(lon) && Number.isFinite(lat) && lat >= 41 && lat <= 51.5 && lon >= -5.5 && lon <= 10;
}

/**
 * Position écrite dans une seule cellule (latitude puis longitude) : « 49.5463, 0.9228 », « 45,2930 4,8121 », DMS…
 * et la forme du fichier concédé « 46°01821, 6°11771 », où ° tient lieu de séparateur décimal (= 46.01821, 6.11771).
 * @returns {{ lat:number, lon:number }|null}
 */
export function parseOfficialPosition(text) {
  const t = String(text ?? '').trim();
  const m = /^([-+]?\d{1,3})\s*°\s*(\d+)\s*(?:[,;]\s*|\s+)([-+]?\d{1,3})\s*°\s*(\d+)$/.exec(t);
  if (m) return { lat: Number(`${m[1]}.${m[2]}`), lon: Number(`${m[3]}.${m[4]}`) };
  const p = parseCoordinates(t);
  return p ? { lat: p.lat, lon: p.lon } : null;
}

/** Position d'une ligne → { pos } ou { reason } (illisible / hors de France). */
function locate(row, map) {
  const p = position(row, map);
  if (p) return { pos: p };
  const text = positionText(row, map);
  if (!text) return { reason: 'position absente', text };
  return { reason: anyPosition(row, map) ? 'position hors de France' : 'position illisible', text };
}

/** Texte brut de la position d'une ligne (pour le journal) : cellule unique, ou « lat | lon », ou « X | Y ». */
function positionText(row, map) {
  const cells = (...ks) => ks.map((k) => String(row[k] ?? '').trim());
  let parts = [];
  if (map.coords !== undefined) parts = cells(map.coords);
  if (map.lat !== undefined && map.lon !== undefined && parts.every((x) => !x)) parts = cells(map.lat, map.lon);
  if (map.x !== undefined && map.y !== undefined && parts.every((x) => !x)) parts = cells(map.x, map.y);
  return parts.some(Boolean) ? parts.join(' | ') : '';
}

/** Une position lisible, même hors de France ? (pour le journal) */
function anyPosition(row, map) {
  if (map.coords !== undefined && parseOfficialPosition(row[map.coords])) return true;
  if (map.lat !== undefined && map.lon !== undefined && ((number(row[map.lat]) !== null && number(row[map.lon]) !== null)
    || parseOfficialPosition(`${String(row[map.lat] ?? '').trim()} ${String(row[map.lon] ?? '').trim()}`))) return true;
  return map.x !== undefined && map.y !== undefined && number(row[map.x]) !== null && number(row[map.y]) !== null;
}

function position(row, map) {
  if (map.lat !== undefined && map.lon !== undefined) {
    let lat = number(row[map.lat]);
    let lon = number(row[map.lon]);
    if (lat === null || lon === null) {
      // Une colonne chacune, mais en DMS ou avec ° comme virgule décimale (« 46°01821 »).
      const p = parseOfficialPosition(`${String(row[map.lat] ?? '').trim()} ${String(row[map.lon] ?? '').trim()}`);
      if (p) ({ lat, lon } = p);
    }
    if (lat !== null && lon !== null) {
      if (inMetropole({ lon, lat })) return { lon, lat };
      if (inMetropole({ lon: lat, lat: lon })) return { lon: lat, lat: lon }; // colonnes inversées
    }
  }
  if (map.x !== undefined && map.y !== undefined) {
    const x = number(row[map.x]);
    const y = number(row[map.y]);
    if (x !== null && y !== null && x > 100000 && x < 1300000 && y > 6000000 && y < 7200000) {
      const p = lambert93ToWgs84(x, y);
      if (inMetropole(p)) return p;
    }
  }
  if (map.coords !== undefined) {
    const p = parseOfficialPosition(row[map.coords]);
    if (p && inMetropole(p)) return { lon: p.lon, lat: p.lat };
    if (p && inMetropole({ lon: p.lat, lat: p.lon })) return { lon: p.lat, lat: p.lon }; // longitude d'abord
  }
  return null;
}

/** « CRUSEILLES » → « Cruseilles » (mots tout en capitales seulement). */
function tidyCase(s) {
  return s.replace(/\p{Lu}[\p{Lu}'’]+/gu, (w) => w.charAt(0) + w.slice(1).toLowerCase());
}

/**
 * Nom de l'aire : « La Ravoire :: 74350 :: CRUSEILLES » → nom « La Ravoire », commune « Cruseilles » (le code postal est
 * retiré) ; sans « :: », le texte entier est le nom.
 * @returns {{ name:string|null, city:string|null }}
 */
export function splitName(text) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw.includes('::')) return { name: raw ? raw.slice(0, 80) : null, city: null };
  const parts = raw.split('::').map((x) => x.trim()).filter(Boolean);
  const name = parts[0] ?? null;
  const city = parts.slice(1).filter((x) => !/^\d{4,5}$/.test(x)).join(' ').replace(/^\d{5}\s+/, '') || null;
  return { name: name ? name.slice(0, 80) : null, city: city ? tidyCase(city).slice(0, 60) : null };
}

/**
 * Route : « A41 N / GENEVE » → route « A41 », direction « GENEVE » ; « A 150 » → « A150 » ; « RN7 » → « RN7 ».
 * @returns {{ road:string|null, direction:string|null }}
 */
export function splitRoad(text) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return { road: null, direction: null };
  const [left, ...rest] = raw.split('/');
  return { road: normalizeRoad(left), direction: cleanDirection(rest.join('/')) };
}

/** « A 150 » → « A150 », « A0016 » → « A16 », « N0058 » → « N58 » (numéros du réseau non concédé sur 4 chiffres). */
export function normalizeRoad(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = /^(A|N|RN|RD|D|E|M)\s?0*(\d{1,4}[a-z]?)\b/i.exec(t);
  return (m ? `${m[1].toUpperCase()}${m[2]}` : t).slice(0, 30);
}

/**
 * Direction lisible, ou null : le réseau non concédé note le sens de circulation « + », « - » ou « + / - » (sens
 * des points de repère, sans ville) ; ces signes ne disent rien au conducteur et ne sont pas affichés.
 */
export function cleanDirection(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || /^[\s+\-−–/0-9.,]*$/.test(t)) return null;
  return t.slice(0, 60);
}

/** Identifiant stable sans colonne d'identifiant : nom + route (les lignes peuvent changer d'ordre d'une année à l'autre). */
function slug(text) {
  return normalizeHeader(text).replace(/ /g, '_').slice(0, 40);
}

/** Services cités dans un texte libre. */
export function servicesFromText(text) {
  const t = normalizeHeader(text);
  const s = [];
  if (/\bwc\b|toilett|sanitaire/.test(t)) s.push('toilets');
  if (/douche/.test(t)) s.push('shower');
  if (/restaura|snack|cafet|boutique|cafe\b/.test(t)) s.push('food');
  if (/carburant|station|gazole|gasoil|essence/.test(t)) s.push('fuel');
  if (/\beau\b|potable/.test(t)) s.push('water');
  if (/wifi|wi fi/.test(t)) s.push('wifi');
  return s;
}

function yesNo(text) {
  const t = normalizeHeader(text);
  if (!t) return null;
  if (/^(non|no|n|0|aucun|aucune|sans)\b/.test(t)) return false;
  return true;
}

function priceOf(text) {
  const raw = String(text ?? '').trim();
  const t = normalizeHeader(raw);
  if (!t) return { fee: null, price: null };
  if (/gratuit|^non\b|^0( 0+)?( eur| e)?$|^free/.test(t)) return { fee: false, price: null };
  if (/^oui$|^payant$/.test(t)) return { fee: true, price: null };
  return { fee: true, price: raw.slice(0, 60) };
}

const clean = (v, max = 80) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

const count = (t) => {
  const n = Number.parseInt(String(t ?? '').replace(/\s/g, ''), 10);
  return Number.isInteger(n) && n >= 0 && n < 2000 ? n : null;
};

/**
 * Lignes d'un tableau officiel → aires. Les lignes ignorées sont comptées dans `skipped`, par raison dans `reasons`.
 * @param {string[][]} rows
 * @param {{ network:string, prefix:string }} opts
 * @returns {{ headers:string[], headerRow:number, preamble:string[], map:object, areas:object[], skipped:number,
 *   reasons:Object<string,number>, unreadable:{ line:number, name:string, reason:string, text:string }[] }}
 *   line : numéro de ligne du tableur (1 = première ligne)
 */
export function rowsToAreas(rows, { network, prefix }) {
  const header = findHeader(rows);
  if (!header) {
    const sample = rows.slice(0, 5).map((r) => r.filter(Boolean).join(' | ')).join(' / ');
    const err = new Error(`Colonnes attendues introuvables (nom de l'aire, position). Premières lignes lues : ${sample || '(vide)'}`);
    err.code = 'MISSING_COLUMNS';
    throw err;
  }
  const { index, map } = header;
  const areas = [];
  const reasons = {};
  let skipped = 0;
  const unreadable = [];
  const skip = (why) => { skipped += 1; reasons[why] = (reasons[why] ?? 0) + 1; };
  rows.slice(index + 1).forEach((row, k) => {
    if (!row.some(Boolean)) return;
    const { name, city } = splitName(row[map.name]);
    if (!name) { skip('nom absent'); return; }
    const { pos, reason, text } = locate(row, map);
    if (!pos) {
      skip(reason);
      // Texte brut gardé pour le journal de l'Action (format à reconnaître).
      if (reason !== 'position absente') unreadable.push({ line: index + 2 + k, name, reason, text });
      return;
    }
    const free = map.freePlaces !== undefined ? count(row[map.freePlaces]) : null;
    const paid = map.paidPlaces !== undefined ? count(row[map.paidPlaces]) : null;
    const total = map.places !== undefined ? count(row[map.places]) : null;
    const places = free !== null || paid !== null ? (free ?? 0) + (paid ?? 0) : total;
    let { fee, price } = map.price !== undefined ? priceOf(row[map.price]) : { fee: null, price: null };
    if (free !== null || paid !== null) {
      if (paid > 0 && !(free > 0)) fee = true;
      else if (free > 0 && !(paid > 0)) { fee = false; price = null; } else if (free > 0 && paid > 0) fee = null; // les deux
    }
    const roadText = map.road !== undefined ? splitRoad(row[map.road]) : { road: null, direction: null };
    const rawId = map.id !== undefined ? clean(row[map.id], 40) : null;
    areas.push({
      id: `off:${prefix}-${(rawId || [slug(name), slug(roadText.road ?? '')].filter(Boolean).join('_') || `ligne_${index + 2 + k}`)
        .replace(/[^A-Za-z0-9_-]+/g, '_')}`,
      name,
      city,
      lon: Math.round(pos.lon * 1e6) / 1e6,
      lat: Math.round(pos.lat * 1e6) / 1e6,
      hgvPlaces: places > 0 ? places : null,
      freePlaces: free,
      paidPlaces: paid,
      fee,
      price,
      secure: map.secure !== undefined ? yesNo(row[map.secure]) : null,
      services: map.services !== undefined ? servicesFromText(row[map.services]) : [],
      road: roadText.road,
      direction: map.direction !== undefined ? cleanDirection(row[map.direction]) : roadText.direction,
      operator: map.operator !== undefined ? clean(row[map.operator], 60) : null,
      network,
    });
  });
  const preamble = rows.slice(0, index).map((r) => r.filter(Boolean).join(' | ')).filter(Boolean);
  return { headers: rows[index], headerRow: index, preamble, map, areas, skipped, reasons, unreadable };
}

// ───────── Fichier converti (data/aires-pl.json), lu par l'appli ─────────

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const str = (x, max) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null);
const tri = (x) => (x === true || x === false ? x : null);
const SERVICE_KEYS = new Set(['toilets', 'shower', 'food', 'fuel', 'water', 'wifi']);

/**
 * Lit data/aires-pl.json (jamais d'exception : fichier absent ou illisible → aucune aire).
 * @returns {{ areas:object[], updated:string|null }}
 */
export function parseOfficialData(json) {
  const list = Array.isArray(json?.areas) ? json.areas : [];
  const areas = [];
  for (const a of list) {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !a.id.startsWith('off:')) continue;
    if (!isNum(a.lon) || !isNum(a.lat) || !inMetropole(a)) continue;
    const name = str(a.name, 80);
    if (!name) continue;
    areas.push({
      id: a.id.slice(0, 60), ids: [a.id.slice(0, 60)], source: 'official', sources: ['official'],
      kind: 'official', name, city: str(a.city, 60), lon: a.lon, lat: a.lat,
      hgvPlaces: Number.isInteger(a.hgvPlaces) && a.hgvPlaces > 0 ? a.hgvPlaces : null,
      freePlaces: Number.isInteger(a.freePlaces) && a.freePlaces >= 0 ? a.freePlaces : null,
      paidPlaces: Number.isInteger(a.paidPlaces) && a.paidPlaces >= 0 ? a.paidPlaces : null,
      hgvOnly: true,
      fee: tri(a.fee), price: str(a.price, 60), secure: tri(a.secure), lit: null,
      services: Array.isArray(a.services) ? a.services.filter((s) => SERVICE_KEYS.has(s)) : [],
      // Fichiers déjà convertis : « A0016 » et sens « + » / « - » corrigés aussi à la lecture.
      road: normalizeRoad(str(a.road, 30)), direction: cleanDirection(str(a.direction, 60)), operator: str(a.operator, 60),
      network: str(a.network, 20),
    });
  }
  return { areas, updated: str(json?.updated, 40) };
}
