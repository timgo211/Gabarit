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
// Les noms exacts des colonnes n'ont pas pu être vus depuis le conteneur de développement : elles sont reconnues par
// mots-clés (FIELDS) ; l'Action affiche les en-têtes lus et échoue si le nom ou la position manquent.

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
  ['operator', /exploitant|gestionnaire|concessionnaire|societe|operateur/],
  ['lat', /^lat|latitude|\blat\b|wgs ?84 y|\by wgs/],
  ['lon', /^lon|longitude|\blong\b|\blng\b|wgs ?84 x|\bx wgs/],
  ['x', /^x$|^x l(ambert )?93|lambert 93 x|^coord(onnee)?s? x$|^x lambert/],
  ['y', /^y$|^y l(ambert )?93|lambert 93 y|^coord(onnee)?s? y$|^y lambert/],
  ['coords', /coordonnees|gps|^position|localisation/],
  ['id', /identifiant|^id\b|\bcode\b|reference/],
  ['name', /\bnom\b|libelle|designation|\bname\b|appellation|intitule|^aire\b/],
  ['places', /(places?|capacite|emplacements?|stationnements?).*(pl\b|poids lourds?|camions?|hgv)|(pl\b|poids lourds?|camions?).*(places?|capacite)/],
  ['placesAny', /places?|capacite|emplacements?|nombre total/],
  ['price', /tarif|prix|payant|cout|gratuit|redevance/],
  ['secure', /secur|surveill|label|niveau|gardienn|cloture/],
  ['services', /services?|equipements?|commodites?/],
  ['road', /autoroute|^route|\broute\b|\baxe\b|\bvoie\b|\brn\b/],
  ['direction', /\bsens\b|direction/],
]);

/** Associe chaque champ à une colonne d'après les en-têtes. */
export function mapColumns(headers) {
  const norm = headers.map(normalizeHeader);
  const used = new Set();
  const map = {};
  for (const [field, re] of FIELDS) {
    const i = norm.findIndex((h, k) => h && !used.has(k) && re.test(h)
      && !(field === 'placesAny' && /\bvl\b|voitures?|vehicules legers|autocars?|cars?\b/.test(h)));
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

/** Ligne d'en-tête : la première (parmi les 15 premières) où le nom et une position sont reconnus. */
export function findHeader(rows) {
  for (let i = 0; i < Math.min(15, rows.length); i += 1) {
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

function position(row, map) {
  if (map.lat !== undefined && map.lon !== undefined) {
    let lat = number(row[map.lat]);
    let lon = number(row[map.lon]);
    if (lat === null || lon === null) {
      const p = parseCoordinates(`${row[map.lat]} ${row[map.lon]}`);
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
    const p = parseCoordinates(String(row[map.coords] ?? ''));
    if (p && inMetropole(p)) return { lon: p.lon, lat: p.lat };
  }
  return null;
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

/**
 * Lignes d'un tableau officiel → aires. Les lignes sans nom ni position lisible sont comptées dans `skipped`.
 * @param {string[][]} rows
 * @param {{ network:string, prefix:string }} opts
 * @returns {{ headers:string[], map:object, areas:object[], skipped:number }}
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
  let skipped = 0;
  rows.slice(index + 1).forEach((row, k) => {
    if (!row.some(Boolean)) return;
    const name = clean(row[map.name]);
    const pos = position(row, map);
    if (!name || !pos) { skipped += 1; return; }
    const placesText = map.places !== undefined ? String(row[map.places] ?? '') : '';
    const places = Number.parseInt(placesText.replace(/\s/g, ''), 10);
    const { fee, price } = map.price !== undefined ? priceOf(row[map.price]) : { fee: null, price: null };
    const rawId = map.id !== undefined ? clean(row[map.id], 40) : null;
    areas.push({
      id: `off:${prefix}-${(rawId ?? String(index + 2 + k)).replace(/[^A-Za-z0-9_-]+/g, '_')}`,
      name,
      lon: Math.round(pos.lon * 1e6) / 1e6,
      lat: Math.round(pos.lat * 1e6) / 1e6,
      hgvPlaces: Number.isInteger(places) && places > 0 && places < 2000 ? places : null,
      fee,
      price,
      secure: map.secure !== undefined ? yesNo(row[map.secure]) : null,
      services: map.services !== undefined ? servicesFromText(row[map.services]) : [],
      road: map.road !== undefined ? clean(row[map.road], 30) : null,
      direction: map.direction !== undefined ? clean(row[map.direction], 60) : null,
      operator: map.operator !== undefined ? clean(row[map.operator], 60) : null,
      network,
    });
  });
  return { headers: rows[index], map, areas, skipped };
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
      kind: 'official', name, lon: a.lon, lat: a.lat,
      hgvPlaces: Number.isInteger(a.hgvPlaces) && a.hgvPlaces > 0 ? a.hgvPlaces : null,
      hgvOnly: true,
      fee: tri(a.fee), price: str(a.price, 60), secure: tri(a.secure), lit: null,
      services: Array.isArray(a.services) ? a.services.filter((s) => SERVICE_KEYS.has(s)) : [],
      road: str(a.road, 30), direction: str(a.direction, 60), operator: str(a.operator, 60),
      network: str(a.network, 20),
    });
  }
  return { areas, updated: str(json?.updated, 40) };
}
