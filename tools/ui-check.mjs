// Vérification de l'interface dans Chromium (Playwright), sans réseau : à lancer à la main, hors CI.
//
//   npm install --no-save --no-package-lock maplibre-gl@4.7.1   (une fois : MapLibre servi depuis node_modules)
//   node tools/ui-check.mjs                                     (captures dans tools/ui-shots/, ignoré par git)
//
// unpkg et les fonds de carte sont bloqués depuis le conteneur : MapLibre vient du paquet npm, les styles sont
// minimaux (fond uni jour / nuit), les tuiles IGN sont une image rouge unie, ORS et Pelias répondent avec les
// fixtures de tests/fixtures, Overpass avec tests/fixtures/overpass-aires.json (phase 9), data/zfe.json avec une
// ZFE de test (phase 5). Aucune vraie API n'est
// appelée (toute autre requête externe est refusée).

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { deflateSync, crc32 } from 'node:zlib';

import { emptyDriving, trackDriving } from '../src/lib/driving-time.js';
import { buildCoverage, convertAreas, parsePoly, parseGeojsonLine } from '../src/lib/areas-osm-data.js';
import { accessElementFromFeature, convertAccess } from '../src/lib/access-convert.js';
import { parseXlsxSheet } from '../src/lib/areas-official.js';
import { parseCommuneList, buildTiles, buildIndex } from '../src/lib/winter-convert.js';
import { tollWayFromFeature } from '../src/lib/hgv-tolls-geo.js';
import { convertTollNetwork } from '../src/lib/hgv-tolls-convert.js';
import { parseTollData } from '../src/lib/hgv-tolls.js';
import { bridgeFromFeature, clearanceFromFeature, convertBridges } from '../src/lib/bridges-convert.js';
import { BRIDGE } from '../src/lib/bridge-check.js';
import { weightFromFeature, convertWeights } from '../src/lib/weight-convert.js';
import { sunTimes } from '../src/lib/sun.js';
import { MAP_PALETTE, NIGHT_PALETTES, NIGHT_LEVELS, SATELLITE_NIGHT_BRIGHTNESS } from '../src/lib/map-palette.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = join(ROOT, 'tools', 'ui-shots');
const ML = join(ROOT, 'node_modules', 'maplibre-gl', 'dist');
if (!existsSync(join(ML, 'maplibre-gl.js'))) {
  console.error('MapLibre absent : npm install --no-save --no-package-lock maplibre-gl@4.7.1');
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });

const fixture = (name) => JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', name), 'utf8'));

// ───────── Petits outils ─────────

/** PNG uni (couleur [r, g, b]) de 256 × 256. */
function solidPng([r, g, b]) {
  const w = 256;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x += 1) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: w }, () => row));
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const RED_TILE = solidPng([220, 0, 0]);

// Fond des faux styles : recoloré au chargement par src/lib/map-palette.js (2c-a) en crème le jour ; la nuit, fond du
// niveau de luminosité (phase 2d : #22252F en Normal, par défaut).
const DAY_BG = '#dcdcdc';
const NIGHT_BG = '#305070';
const style = (bg, streets = false) => (streets ? {
  // Phase 2c : une couche de noms de rues (schéma OpenMapTiles) pour les bulles du guidage ; tuiles et polices
  // refusées (rien à dessiner, seuls les réglages de la couche sont vérifiés).
  version: 8, glyphs: 'https://streets.test/fonts/{fontstack}/{range}.pbf',
  sources: { streets: { type: 'vector', tiles: ['https://streets.test/{z}/{x}/{y}.pbf'], maxzoom: 14,
    attribution: '© OpenFreeMap © OpenStreetMap' } },
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } },
    { id: 'highway-name-minor', type: 'symbol', source: 'streets', 'source-layer': 'transportation_name',
      layout: { 'symbol-placement': 'line', 'text-field': '{name}', 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': '#666' } }],
} : { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }] });
/**
 * Style avec une source de tuiles lentes (comme le vrai fond vectoriel sur la tablette) : tant qu'une tuile se
 * charge, map.isStyleLoaded() est faux alors que le style est prêt depuis longtemps (régression v17 : tracé absent).
 */
const slowStyle = (bg) => ({
  version: 8,
  sources: { slow: { type: 'raster', tiles: ['https://slow-tiles.test/{z}/{x}/{y}.png'], tileSize: 256 } },
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } },
    { id: 'slow', type: 'raster', source: 'slow', paint: { 'raster-opacity': 0 } }],
});
const SLOW_TILE_MS = 6000;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(ROOT, path);
    if (path.endsWith('/')) file = join(file, 'index.html');
    if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let failures = 0;
function check(ok, label, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// ───────── Page ─────────

const START = [4.8357, 45.764]; // départ des fixtures (Lyon)

/**
 * Ouvre l'appli. opts.directions(body) → JSON ORS ; opts.theme : 'day' | 'night' ;
 * opts.overpass(url) → JSON Overpass ou null (serveur en échec) ; opts.official : contenu de data/aires-pl.json ;
 * opts.zfe : contenu de data/zfe.json (aucune ZFE par défaut : les couleurs de la carte mesurées restent celles du
 * fond) ; opts.now : heure de la tablette (ms) ; opts.wind(lonlat, ms) → rafale (km/h) de la réponse Open-Meteo
 * (null : requête en échec) ; opts.driving : décompte du temps de conduite déjà enregistré sur la tablette.
 * Renvoie { page, ctx, stats, errors } (stats.tiles : tuiles IGN demandées ; stats.overpass : serveurs appelés ;
 * stats.wind : requêtes Open-Meteo).
 */
async function open(browser, base, {
  width, height, theme = 'day', layer = 'plan', directions = null, overpass = null, official = null,
  zfe = { zones: [], voies: [] }, now = null, wind = null, driving = null, vehicle = null, tunnels = undefined,
  slowTiles = false, osmCopy = 'fixture', voice = false, countryFiles = null, accessCopy = 'fixture', winterCopy = null,
  tollsFile = undefined, tollsNetwork = null, sw = false, streets = false, nightLevel = undefined,
  bridgesCopy = null, settings = null, restrictions = null, weightsCopy = null,
} = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: width < 700,
    geolocation: { latitude: START[1], longitude: START[0], accuracy: 8 }, permissions: ['geolocation'],
    serviceWorkers: sw ? 'allow' : 'block', locale: 'fr-FR', timezoneId: 'Europe/Paris',
  });
  // Heure de la tablette (phase 5 : interdictions PL) : Date décalée, les minuteries restent réelles.
  if (now) {
    await ctx.addInitScript((target) => {
      const Real = Date;
      const off = target - Real.now();
      class Shifted extends Real {
        constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); }
        static now() { return Real.now() + off; }
      }
      window.Date = Shifted;
    }, now);
  }
  const stats = { tiles: 0, directions: 0, pelias: 0, overpass: [], wind: 0, copy: [] };
  if (driving) await ctx.addInitScript((d) => { if (!sessionStorage.getItem('ui-check-init')) localStorage.setItem('gabarit.driving', d); }, JSON.stringify(driving));
  await ctx.addInitScript(() => {
    window.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { window.__raf += 1; return raf(cb); };
  });
  // Phase 5c : voix de l'appli captée (window.__spoken) au lieu d'être jouée.
  if (voice) {
    await ctx.addInitScript(() => {
      window.__spoken = [];
      const synth = window.speechSynthesis;
      if (synth) {
        synth.speak = (u) => { window.__spoken.push(u.text); };
        synth.cancel = () => {};
      }
    });
  }
  await ctx.addInitScript(({ theme: t, layer: l, vehicle: v, voice: on, nightLevel: nl, extra, restr }) => {
    if (sessionStorage.getItem('ui-check-init')) return;
    sessionStorage.setItem('ui-check-init', '1');
    localStorage.setItem('gabarit.orsKey', 'cle-factice-de-test');
    localStorage.setItem('gabarit.data', JSON.stringify({
      version: 1, vehicles: [v ?? { id: 'v1', name: 'Semi-remorque frigorifique 44 t', height: 4, width: 2.55, length: 16.5,
        weight: 44, axleload: 11.5, maxSpeed: 90 }],
      activeVehicleId: 'v1', settings: { theme: t, mapLayer: l, voice: on, ...(nl ? { nightMapLevel: nl } : {}), ...(extra ?? {}) },
      ...(restr ? { restrictions: restr } : {}),
    }));
  }, { theme, layer, vehicle, voice, nightLevel, extra: settings, restr: restrictions });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const url = route.request().url();
    if (url.includes('unpkg.com/maplibre-gl')) {
      const name = url.endsWith('.css') ? 'maplibre-gl.css' : 'maplibre-gl.js';
      // Cartes créées gardées dans window.__maps (vérification de la source et des couches du tracé).
      const tail = name.endsWith('.js')
        ? '\n;(() => { const M = maplibregl.Map; window.__maps = []; maplibregl.Map = class extends M { constructor(o) { super(o); window.__maps.push(this); } }; })();'
        : '';
      return route.fulfill({ body: Buffer.concat([readFileSync(join(ML, name)), Buffer.from(tail)]), contentType: TYPES[extname(name)] });
    }
    if (url.includes('tiles.openfreemap.org/styles/') || url.includes('tiles.versatiles.org')) {
      const bg = url.includes('/dark') || url.includes('eclipse') ? NIGHT_BG : DAY_BG;
      return route.fulfill({ json: slowTiles ? slowStyle(bg) : style(bg, streets) });
    }
    if (url.startsWith('https://slow-tiles.test/')) {
      await new Promise((r) => setTimeout(r, SLOW_TILE_MS));
      return route.fulfill({ body: RED_TILE, contentType: 'image/png' }).catch(() => {});
    }
    if (url.includes('data.geopf.fr')) {
      stats.tiles += 1;
      return route.fulfill({ body: RED_TILE, contentType: 'image/png' });
    }
    if (url.includes('/api/interpreter')) {
      stats.overpass.push(new URL(url).host);
      const json = overpass ? overpass(url) : null;
      return json ? route.fulfill({ json }) : route.abort();
    }
    if (url.startsWith('https://api.open-meteo.com/v1/forecast')) {
      stats.wind += 1;
      if (!wind) return route.abort();
      // Réponse au format de la doc Open-Meteo : une structure par point, heures UNIX depuis minuit GMT, 72 h.
      const u = new URL(url);
      const lats = u.searchParams.get('latitude').split(',').map(Number);
      const lons = u.searchParams.get('longitude').split(',').map(Number);
      const day0 = Math.floor((now ?? Date.now()) / 86400000) * 86400;
      const list = lats.map((lat, i) => {
        const time = Array.from({ length: 72 }, (_, h) => day0 + h * 3600);
        const gusts = time.map((t) => wind([lons[i], lat], t * 1000));
        return { latitude: lat, longitude: lons[i], timezone: 'GMT', hourly_units: { time: 'unixtime', wind_gusts_10m: 'km/h' },
          hourly: { time, wind_speed_10m: gusts.map((g) => Math.round(g * 0.5)), wind_gusts_10m: gusts } };
      });
      return route.fulfill({ json: lats.length === 1 ? list[0] : list });
    }
    if (url.includes('/pelias/v1/autocomplete')) stats.pelias += 1;
    if (url.includes('/pelias/v1/autocomplete')) return route.fulfill({ json: fixture('pelias-autocomplete.json') });
    if (url.includes('/openrouteservice/v2/directions/')) {
      stats.directions += 1;
      const body = JSON.parse(route.request().postData() || '{}');
      const json = directions ? directions(body) : (body.alternative_routes
        ? fixture('ors-directions-alternatives.json') : fixture('ors-directions-nav.json'));
      // Phase 5h bis : { __status, ...corps } simule une réponse d'erreur d'ORS (statut HTTP et corps).
      if (json && json.__status) { const { __status, ...rest } = json; return route.fulfill({ status: __status, json: rest }); }
      return route.fulfill({ json });
    }
    return route.abort();
  });
  if (official) await ctx.route(/\/data\/aires-pl\.json$/, (route) => route.fulfill({ json: official }));
  if (zfe) await ctx.route(/\/data\/zfe\.json$/, (route) => route.fulfill({ json: zfe }));
  // Phase 5b : data/tunnels-adr.json (null : fichier absent, réponse 404 ; undefined : fichier du dépôt).
  if (tunnels !== undefined) {
    await ctx.route(/\/data\/tunnels-adr\.json$/, (route) => (tunnels ? route.fulfill({ json: tunnels }) : route.fulfill({ status: 404, body: '' })));
  }
  // Phase 5c : data/pays/XX.json (code → null : fichier absent, réponse 404 ; sinon fichier du dépôt).
  if (countryFiles) {
    await ctx.route(/\/data\/pays\/[A-Z]{2}\.json(\?.*)?$/, (route) => {
      const code = new URL(route.request().url()).pathname.split('/').pop().slice(0, 2);
      return countryFiles[code] === null ? route.fulfill({ status: 404, body: '' }) : route.continue();
    });
  }
  // Phase 9b : copie data/aires-osm/ (null : absente, 404). 'fixture' : aires de tests/fixtures/overpass-aires.json,
  // zone couverte autour du trajet ; 'uncovered' : mêmes cases, zone couverte loin du trajet (Overpass demandé).
  const copy = osmCopyFiles(osmCopy);
  await ctx.route(/\/data\/aires-osm\/[^/]+\.json(\?.*)?$/, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    stats.copy.push(name);
    const json = copy?.get(name);
    return json ? route.fulfill({ json }) : route.fulfill({ status: 404, body: '' });
  });
  // Phase 5d : copie data/acces-osm/ (null : absente, 404). 'fixture' : voies de tests/fixtures/osm-access.geojsonseq
  // passées par convertAccess (comme l'Action), zone couverte autour des trajets de test.
  const access = accessCopyFiles(accessCopy);
  await ctx.route(/\/data\/acces-osm\/[^/]+\.json(\?.*)?$/, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    stats.access = [...(stats.access ?? []), name];
    const json = access?.get(name);
    return json ? route.fulfill({ json }) : route.fulfill({ status: 404, body: '' });
  });
  // Phase 5f : copie data/hiver/ (null, par défaut : absente, 404). 'fixture' : liste et contours de tests/fixtures
  // passés par les fonctions de l'Action.
  const winter = winterCopyFiles(winterCopy);
  await ctx.route(/\/data\/hiver\/[^/]+\.json(\?.*)?$/, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    stats.winter = [...(stats.winter ?? []), name];
    const json = winter?.get(name);
    return json ? route.fulfill({ json }) : route.fulfill({ status: 404, body: '' });
  });
  // Phase 5h : data/taxes-pl.json (null : fichier absent, réponse 404 ; undefined : fichier du dépôt).
  if (tollsFile === null) await ctx.route(/\/data\/taxes-pl\.json(\?.*)?$/, (route) => route.fulfill({ status: 404, body: '' }));
  // Phase 5h ter : data/taxes-pl-osm.json (null, par défaut : absent, 404 ; 'fixture' : voies de
  // tests/fixtures/osm-tolls.geojsonseq passées par les fonctions de l'Action).
  const tollNet = tollsNetwork === 'fixture' ? tollNetworkFixture() : null;
  await ctx.route(/\/data\/taxes-pl-osm\.json(\?.*)?$/, (route) => {
    stats.tollsNetwork = (stats.tollsNetwork ?? 0) + 1;
    return tollNet ? route.fulfill({ json: tollNet }) : route.fulfill({ status: 404, body: '' });
  });
  // Phase 12a : copie data/ponts-osm/ (null, par défaut : absente, 404 ; 'fixture' : ponts de
  // tests/fixtures/osm-ponts-colombier.geojsonseq passés par les fonctions de l'Action).
  const bridgeFiles = bridgesCopyFiles(bridgesCopy);
  await ctx.route(/\/data\/ponts-osm\/[^/]+\.json(\?.*)?$/, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    stats.bridges = [...(stats.bridges ?? []), name];
    const json = bridgeFiles?.get(name);
    return json ? route.fulfill({ json }) : route.fulfill({ status: 404, body: '' });
  });
  // Phase 12a bis : copie data/poids-osm/ (null, par défaut : absente, 404, même quand l'Action a écrit la vraie copie
  // dans le dépôt ; 'fixture' : tronçons de tests/fixtures/osm-poids-colombier.geojsonseq passés par les fonctions de
  // l'Action).
  const weightFiles = weightsCopyFiles(weightsCopy);
  await ctx.route(/\/data\/poids-osm\/[^/]+\.json(\?.*)?$/, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    stats.weights = [...(stats.weights ?? []), name];
    const json = weightFiles?.get(name);
    return json ? route.fulfill({ json }) : route.fulfill({ status: 404, body: '' });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  if (sw) {
    // Vrai service worker (sw.js) : la page doit être contrôlée, comme sur la tablette après la première ouverture.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  }
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
  await page.waitForTimeout(800);
  return { page, ctx, stats, errors };
}

/** Fichiers de la copie des aires simulée (nom → JSON), d'après les fonctions de l'Action. */
/** kind : 'fixture', 'uncovered', null (pas de copie) ou une liste d'éléments Overpass (copie couvrant la France). */
function osmCopyFiles(kind) {
  if (!kind) return null;
  const box = kind === 'uncovered' ? [20, 55, 22, 57] : [-5, 42, 8.3, 51.2];
  const elements = Array.isArray(kind) ? kind : fixture('overpass-aires.json').elements;
  const poly = parsePoly(`zone\n1\n   ${box[0]} ${box[1]}\n   ${box[2]} ${box[1]}\n   ${box[2]} ${box[3]}\n   ${box[0]} ${box[3]}\nEND\nEND\n`);
  const { index, tiles } = convertAreas(elements, { updated: '2026-12-01', grid: buildCoverage([poly]), countries: ['france'] });
  return new Map([['index.json', index], ...[...tiles].map(([k, t]) => [`${k}.json`, t])]);
}

/** Fichiers de la copie des voies à accès conditionnel simulée (nom → JSON), d'après les fonctions de l'Action. */
function accessCopyFiles(kind) {
  if (!kind) return null;
  const poly = parsePoly('zone\n1\n   -5 42\n   8.3 42\n   8.3 51.2\n   -5 51.2\nEND\nEND\n');
  const ways = readFileSync(join(ROOT, 'tests', 'fixtures', 'osm-access.geojsonseq'), 'utf8').split('\n')
    .map(parseGeojsonLine).filter(Boolean).map(accessElementFromFeature).filter(Boolean);
  const { index, tiles } = convertAccess(ways, { updated: '2026-12-01', grid: buildCoverage([poly]), countries: ['france'] });
  return new Map([['index.json', index], ...[...tiles].map(([k, t]) => [`${k}.json`, t])]);
}

/** Fichiers de la copie des ponts simulée (nom → JSON), d'après les fonctions de l'Action (phase 12a). */
function bridgesCopyFiles(kind) {
  if (!kind) return null;
  const poly = parsePoly('zone\n1\n   -5 42\n   8.3 42\n   8.3 51.2\n   -5 51.2\nEND\nEND\n');
  const feats = readFileSync(join(ROOT, 'tests', 'fixtures', 'osm-ponts-colombier.geojsonseq'), 'utf8').split('\n')
    .map(parseGeojsonLine).filter(Boolean);
  const { index, tiles } = convertBridges(feats.map(bridgeFromFeature).filter(Boolean), feats.map(clearanceFromFeature).filter(Boolean),
    { updated: '2026-12-01', grid: buildCoverage([poly]), countries: ['france'] });
  return new Map([['index.json', index], ...[...tiles].map(([k, t]) => [`${k}.json`, t])]);
}

/** Fichiers de la copie des limites de poids simulée (nom → JSON), d'après les fonctions de l'Action (phase 12a bis). */
function weightsCopyFiles(kind) {
  if (!kind) return null;
  const poly = parsePoly('zone\n1\n   -5 42\n   8.3 42\n   8.3 51.2\n   -5 51.2\nEND\nEND\n');
  const feats = readFileSync(join(ROOT, 'tests', 'fixtures', 'osm-poids-colombier.geojsonseq'), 'utf8').split('\n')
    .map(parseGeojsonLine).filter(Boolean);
  const { index, tiles } = convertWeights(feats.map(weightFromFeature).filter(Boolean),
    { updated: '2026-12-01', grid: buildCoverage([poly]), countries: ['france'] });
  return new Map([['index.json', index], ...[...tiles].map(([k, t]) => [`${k}.json`, t])]);
}

/** Fichiers de la copie des communes soumises aux équipements d'hiver simulée (nom → JSON). */
function winterCopyFiles(kind) {
  if (!kind) return null;
  const list = parseCommuneList(parseXlsxSheet(readFileSync(join(ROOT, 'tests', 'fixtures', 'hiver-liste-sheet.xml'), 'utf8')));
  const gj = fixture('hiver-contours.geojson');
  const contours = new Map(gj.features.map((f) => [f.properties.code, { name: f.properties.nom, geometry: f.geometry }]));
  const built = buildTiles(list.communes, contours);
  const index = buildIndex({ updated: '2026-10-15', communes: list.communes, ...built });
  return new Map([['index.json', index], ...Object.entries(built.tiles).map(([k, t]) => [`${k}.json`, { communes: t }])]);
}

/** Copie du réseau des taxes PL construite comme dans l'Action, à partir de la fixture osm-tolls.geojsonseq. */
function tollNetworkFixture() {
  const data = parseTollData(JSON.parse(readFileSync(join(ROOT, 'data', 'taxes-pl.json'), 'utf8')));
  const ways = readFileSync(join(ROOT, 'tests', 'fixtures', 'osm-tolls.geojsonseq'), 'utf8').split('\n')
    .map(parseGeojsonLine).map(tollWayFromFeature).filter(Boolean);
  return convertTollNetwork(ways, data, { updated: '2026-12-01' }).json;
}

async function computeRoute(page) {
  await page.fill('#to-input', 'Lyon');
  await page.waitForSelector('#to-list li', { timeout: 5000 });
  await page.dispatchEvent('#to-list li', 'pointerdown');
  await page.click('#btn-route');
  await page.waitForSelector('.route-card', { timeout: 10000 });
  await page.waitForTimeout(1200);
}

async function noHorizontalScroll(page, label) {
  const r = await page.evaluate(() => {
    const w = window.innerWidth;
    const wide = [...document.querySelectorAll('body *')].filter((n) => {
      if (!n.getClientRects().length || n.closest('.maplibregl-canvas-container, dialog:not([open])')) return false;
      const b = n.getBoundingClientRect();
      return b.right > w + 0.5 || b.left < -0.5;
    }).slice(0, 5).map((n) => `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}.${[...n.classList].join('.')} « ${n.textContent.trim().slice(0, 25)} »`);
    return { sw: document.documentElement.scrollWidth, w, wide };
  });
  // Téléphone : un contenu trop large agrandit la fenêtre de mise en page (innerWidth) et Chrome dézoome la page.
  const device = page.viewportSize().width;
  check(r.sw <= r.w && r.w <= device && r.wide.length === 0, `${label} : pas de défilement horizontal`,
    `scrollWidth ${r.sw} / innerWidth ${r.w} / écran ${device}${r.wide.length ? ` ; dépassent : ${r.wide.join(', ')}` : ''}`);
}

/** Couleur moyenne d'une zone de la carte (capture d'écran décodée dans la page). */
async function mapColor(page) {
  const box = await page.locator('#map').boundingBox();
  // Zone à gauche, à mi-hauteur : hors du bandeau, de la barre du bas et (fixtures orientées nord-sud) du tracé.
  const clip = { x: box.x + box.width * 0.12, y: box.y + box.height * 0.5, width: 12, height: 12 };
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let r = 0; let gg = 0; let bb = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; }
    const n = d.length / 4;
    return [Math.round(r / n), Math.round(gg / n), Math.round(bb / n)];
  }, png.toString('base64'));
}
const isRed = ([r, g, b]) => r > 150 && g < 90 && b < 90;
/** Photos IGN factices (rouges), assombries ou non (la nuit : raster-brightness-max 0,6 à 0,9 selon le niveau, 2d). */
const isPhoto = ([r, g, b]) => r > 90 && g < 60 && b < 60;
/**
 * Fond de carte nuit recoloré (niveau Normal par défaut, phase 2d) ; le scénario « context » peint .map en magenta
 * pour voir un canevas vide.
 */
const isNight = (c) => near(c, MAP_PALETTE.night.background);
const near = ([r, g, b], hex, tol = 6) => {
  const n = parseInt(hex.slice(1), 16);
  return Math.abs(r - (n >> 16)) < tol && Math.abs(g - ((n >> 8) & 255)) < tol && Math.abs(b - (n & 255)) < tol;
};
const isDay = ([r, g, b]) => r > 190 && g > 190 && b > 190;

async function setTheme(page, mode) {
  await page.click('#btn-settings');
  await page.check(`input[name="theme"][value="${mode}"]`);
  await page.click('#dlg-settings [data-close]');
  await page.waitForTimeout(1500);
}

async function startSim(page) {
  await page.click('#btn-settings');
  await page.click('#btn-simulate');
  await page.waitForSelector('#nav:not([hidden])');
  await page.waitForTimeout(2500);
}

/** Position GPS émulée avec vitesse et cap (CDP : Playwright setGeolocation ne donne pas la vitesse). */
const cdps = new WeakMap();
async function setGeo(page, { lon, lat, accuracy = 5, speed = null, heading = null }) {
  if (!cdps.has(page)) cdps.set(page, await page.context().newCDPSession(page));
  const o = { latitude: lat, longitude: lon, accuracy };
  if (speed !== null) o.speed = speed;
  if (heading !== null) o.heading = heading;
  await cdps.get(page).send('Emulation.setGeolocationOverride', o);
}

/** Pousse des positions GPS (vrai guidage) le long d'une ligne, à la vitesse donnée. */
async function drive(ctx, page, coords, kmh, seconds) {
  const step = kmh / 3.6;
  let seg = 0; let t = 0;
  const lens = coords.slice(1).map((c, i) => {
    const [a, b] = [coords[i], c];
    const dx = (b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180);
    const dy = (b[1] - a[1]) * 110540;
    return Math.hypot(dx, dy);
  });
  for (let s = 0; s < seconds; s += 1) {
    t += step;
    while (seg < lens.length - 1 && t > lens[seg]) { t -= lens[seg]; seg += 1; }
    const f = Math.min(1, t / (lens[seg] || 1));
    const [a, b] = [coords[seg], coords[seg + 1]];
    await setGeo(page, { lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, accuracy: 5, speed: step, heading: 90 });
    await page.waitForTimeout(1000);
  }
}

/** Guidage (phase 2c) : « Aires PL » et « Plan / Satellite » sont dans la rangée de la loupe. */
async function navSearchChip(page, sel) {
  if (!(await page.isVisible(sel))) await page.click('#btn-nav-search');
  await page.click(sel);
}
const navAreas = (page) => navSearchChip(page, '#btn-nav-areas');

/**
 * Phase 2d : état de la liste « Aires et parkings PL » du guidage : lignes, hauteur, défilement, textes coupés, place
 * par rapport à la pile du bandeau (« Puis », alertes) ; scroll : essaie de la faire défiler.
 */
async function areaListState(page, { scroll = false } = {}) {
  return page.evaluate(async (doScroll) => {
    const list = document.querySelector('#nav-areas');
    const open = !!list && !list.hidden && getComputedStyle(list).visibility !== 'hidden';
    if (!open) return { open };
    const r = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll('#nav-areas-list .nav-area')];
    const cut = [];
    for (const n of list.querySelectorAll('.nav-area-name, .nav-area-facts > span, .nav-area-card p, .btn')) {
      if (n.closest('[hidden]')) continue;
      const cs = getComputedStyle(n);
      if (n.scrollWidth > n.clientWidth + 1 || cs.textOverflow === 'ellipsis' || cs.wordBreak === 'break-all'
        || cs.overflowWrap === 'anywhere' || cs.hyphens === 'auto') cut.push(n.className || n.id);
    }
    // Pile du bandeau au-dessus de la liste : bas du dernier élément visible (bandeau, « Puis », alertes, « +N »)
    // dans la même bande verticale que la liste.
    let stackBottom = 0;
    for (const n of document.querySelectorAll('#nav .nav-top > *, #nav .nav-alerts > *')) {
      if (n.hidden || !n.getClientRects().length || getComputedStyle(n).visibility === 'hidden') continue;
      const b = n.getBoundingClientRect();
      if (b.right <= r.left + 0.5 || b.left >= r.right - 0.5) continue;
      stackBottom = Math.max(stackBottom, b.bottom);
    }
    const scrollable = list.scrollHeight > list.clientHeight + 1;
    let scrolled = false;
    if (doScroll && scrollable) {
      const before = list.scrollTop;
      list.scrollTop = before + 120;
      await new Promise((res) => setTimeout(res, 50));
      scrolled = list.scrollTop > before;
      list.scrollTop = before;
    }
    const style = getComputedStyle(list);
    return {
      open, rows: rows.length, minRow: rows.length ? Math.round(Math.min(...rows.map((b) => b.getBoundingClientRect().height))) : 0,
      heights: rows.map((b) => Math.round(b.getBoundingClientRect().height)).join(','),
      ratio: r.height / window.innerHeight, top: r.top, bottom: r.bottom, stackBottom,
      scrollable, scrolled, overflowY: style.overflowY, touch: style.touchAction, cut,
      inputs: list.querySelectorAll('input, textarea, select, [contenteditable]').length,
      card: !document.querySelector('#nav-area-card').hidden,
      selected: document.querySelectorAll('.area-marker.selected').length,
      go: document.querySelector('#btn-nav-area-go').getAttribute('aria-disabled'),
      sheet: document.querySelector('#btn-nav-area-sheet').getAttribute('aria-disabled'),
      closeH: Math.round(document.querySelector('#btn-nav-areas-close').getBoundingClientRect().height),
    };
  }, scroll);
}

/**
 * Phase 2d : aires de la fixture Overpass + 9 aires de repos posées sur le tracé (tous les 3 points, noms longs pour
 * vérifier le retour à la ligne entre les mots) : la liste dépasse sa hauteur et doit défiler.
 */
function manyAreas(line) {
  const base = fixture('overpass-aires.json');
  const extra = [];
  for (let i = 8, n = 1; i < line.length; i += 3, n += 1) {
    extra.push({ type: 'node', id: 9100 + n, lat: line[i][1], lon: line[i][0],
      tags: { highway: 'rest_area', name: `Aire poids lourds de la Vallée-de-Saint-Bonnet-les-Oules n° ${n}`, 'capacity:hgv': String(10 + n) } });
  }
  return { ...base, elements: [...base.elements, ...extra] };
}

/** Phase 2d : contrôles de la liste des aires ouverte (en roulant ou à l'arrêt). */
async function checkAreaList(page, label, land) {
  const al = await areaListState(page, { scroll: true });
  check(al.open && al.rows >= 8, `${label} : liste des aires ouverte (aires du trajet, 15 au plus)`, `${al.rows} ligne(s)`);
  check(al.minRow >= 56 && al.closeH >= 56, `${label} : lignes et « Fermer » d'au moins 56 px`, `${al.heights} ; Fermer ${al.closeH}`);
  check(al.cut.length === 0, `${label} : aucun texte coupé dans la liste`, al.cut.join(', '));
  check(al.inputs === 0, `${label} : liste sans saisie`);
  check(al.top >= al.stackBottom - 0.5, `${label} : liste jamais au-dessus du bandeau, de « Puis » ni des alertes`,
    `haut ${Math.round(al.top)} < pile ${Math.round(al.stackBottom)}`);
  if (!land) check(al.ratio <= 0.4 + 0.003, `${label} : portrait, liste ≤ 40 % de la hauteur`, `${Math.round(al.ratio * 100)} %`);
  check(al.overflowY === 'auto' && al.touch === 'pan-y' && al.scrollable && al.scrolled,
    `${label} : défilement au doigt possible`, `${al.overflowY} ${al.touch} débordement ${al.scrollable} défilée ${al.scrolled}`);
  const foot = await footOverlaps(page);
  check(foot.out.length === 0, `${label} : liste ouverte, rien ne se chevauche`, foot.out.join(' ; '));
  return al;
}

/** Centre de la caméra (lon, lat) de la carte en cours. */
async function cameraCenter(page) {
  return page.evaluate(() => {
    const c = window.__maps?.at(-1)?.getCenter();
    return c ? [c.lng, c.lat] : null;
  });
}
/** Même centre à quelques mètres près (fin d'animation de la flèche). */
const sameCenter = (a, b) => !!a && !!b && Math.abs(a[0] - b[0]) < 2e-4 && Math.abs(a[1] - b[1]) < 2e-4;

/** Couleur de la carte : sombre (aucun éclair clair) — moyenne des composantes sous 90. */
const isDark = ([r, g, b]) => (r + g + b) / 3 < 90;

const navLayer = (page) => navSearchChip(page, '#btn-nav-layer');
/** Texte du bouton Plan / Satellite (rangée de la loupe ouverte puis refermée). */
async function navLayerText(page) {
  if (!(await page.isVisible('#btn-nav-layer'))) await page.click('#btn-nav-search');
  const t = await page.textContent('#btn-nav-layer');
  await page.click('#btn-nav-search');
  return t;
}
/**
 * Temps de conduite (phase 2c) : carte d'alerte quand il reste une des deux places, sinon dans les détails du trajet
 * (panneau du bas déplié). Ouvre les détails si besoin ; closeDetails les referme.
 */
async function showDriving(page) {
  if (!(await page.isVisible('#nav-drive')) && await page.getAttribute('#btn-nav-sheet', 'aria-expanded') !== 'true') {
    await page.click('#btn-nav-sheet');
    await page.waitForTimeout(200);
  }
}
async function closeDetails(page) {
  if (await page.getAttribute('#btn-nav-sheet', 'aria-expanded') === 'true') await page.click('#btn-nav-sheet');
  await page.waitForTimeout(200);
}

/** Quitter le guidage : ✕ puis « Quitter » (confirmation), ou fin directe à l'arrivée. */
async function stopGuidance(page) {
  await page.click('#btn-nav-stop');
  if (await page.isVisible('#btn-nav-quit')) await page.click('#btn-nav-quit');
}

/** Éléments du guidage dont le texte sort de la case. */
async function overflowingNavText(page) {
  return page.evaluate(() => [...document.querySelectorAll('#nav .nav-top *, #nav .nav-bottom *')]
    .filter((n) => n.getClientRects().length && n.childElementCount === 0 && n.textContent.trim()
      // Largeur : rien ne doit dépasser. Hauteur : seulement si le texte est coupé (overflow non visible).
      && (n.scrollWidth > n.clientWidth + 1
        || (getComputedStyle(n).overflowY !== 'visible' && n.scrollHeight > n.clientHeight + 2)))
    .map((n) => `${n.id || n.className}: « ${n.textContent.trim().slice(0, 30)} » ${n.scrollWidth}>${n.clientWidth}`));
}

// ───────── Scénarios ─────────

async function layoutChecks(browser, base) {
  for (const [width, height] of [[360, 760], [412, 900], [800, 1280], [1280, 800]]) {
    const { page, ctx, errors } = await open(browser, base, { width, height });
    await noHorizontalScroll(page, `${width} px accueil`);
    await page.screenshot({ path: join(SHOTS, `${width}-accueil.png`) });
    await computeRoute(page);
    await noHorizontalScroll(page, `${width} px fiches`);
    await page.screenshot({ path: join(SHOTS, `${width}-fiches.png`) });
    await page.locator('.panel').evaluate((n) => n.scrollTo(0, n.scrollHeight));
    await page.screenshot({ path: join(SHOTS, `${width}-fiches-bas.png`) });
    await startSim(page);
    await noHorizontalScroll(page, `${width} px guidage`);
    const over = await overflowingNavText(page);
    check(over.length === 0, `${width} px guidage : textes dans leurs cases`, over.join(' ; '));
    await page.screenshot({ path: join(SHOTS, `${width}-guidage.png`) });
    check(errors.length === 0, `${width} px : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
}

async function longTextCheck(browser, base) {
  const long = 'Prenez la sortie 34 en direction de Villefranche-sur-Saône, Bourg-en-Bresse, Mâcon-Centre, '
    + 'Zone industrielle des Grandes Terres et Parc d’activités de la Plaine de l’Ain';
  const nav = fixture('ors-directions-nav.json');
  // Ligne droite de 20 km plein est : 110 km/h tenus sans sortir du tracé.
  const line = [START, [START[0] + 0.26, START[1]]];
  nav.features[0].geometry.coordinates = Array.from({ length: 41 }, (_, i) => [START[0] + (0.26 * i) / 40, START[1]]);
  const steps = nav.features[0].properties.segments[0].steps;
  nav.features[0].properties.segments[0].steps = [
    { ...steps[0], distance: 15000, way_points: [0, 30] },
    { ...steps[1], distance: 5000, way_points: [30, 40], instruction: long, type: 1 },
    { distance: 0, duration: 0, type: 10, instruction: 'Arrivée', name: '', way_points: [40, 40] },
  ];
  const { page, ctx } = await open(browser, base, { width: 360, height: 760, directions: () => nav });
  await page.fill('#to-input', 'Lyon');
  await page.waitForSelector('#to-list li');
  await page.dispatchEvent('#to-list li', 'pointerdown');
  await page.click('#btn-route');
  await page.waitForSelector('#btn-nav-start:not([hidden])');
  await page.click('#btn-nav-start');
  await drive(ctx, page, line, 110, 8);
  const speed = await page.textContent('.nav-speed-pill');
  check(/110\s*km\/h/.test(speed ?? ''), '360 px : « 110 km/h » affiché', speed);
  const instr = await page.textContent('#nav-instr');
  check(instr?.includes('Villefranche'), '360 px : consigne longue affichée', instr?.slice(0, 40));
  const over = await overflowingNavText(page);
  check(over.length === 0, '360 px : « 110 km/h » et consigne longue dans leurs cases', over.join(' ; '));
  await noHorizontalScroll(page, '360 px guidage 110 km/h');
  await page.screenshot({ path: join(SHOTS, '360-guidage-110.png') });
  await ctx.close();
}

async function satelliteThemeCheck(browser, base) {
  const { page, ctx, stats } = await open(browser, base, { width: 412, height: 900, theme: 'day', layer: 'satellite' });
  // Carte au-dessus de Lyon (France) : photos attendues.
  await page.evaluate(() => {}); // la carte se centre sur la position GPS au démarrage
  await page.waitForTimeout(2500);
  let c = await mapColor(page);
  check(isRed(c), 'satellite, jour : photos affichées', `couleur ${c}`);
  await setTheme(page, 'night');
  // Phase 2c : la nuit, mêmes photos assombries (raster-brightness-max 0,8 au niveau Normal, phase 2d).
  const dayRed = c;
  c = await mapColor(page);
  check(c[0] > 90 && c[1] < 60 && c[2] < 60 && c[0] < dayRed[0] - 40, 'satellite, jour → nuit : photos affichées, assombries', `couleur ${c} (jour ${dayRed})`);
  await page.screenshot({ path: join(SHOTS, 'satellite-nuit.png') });
  await setTheme(page, 'day');
  c = await mapColor(page);
  check(isRed(c), 'satellite, nuit → jour : photos affichées', `couleur ${c}`);
  check(stats.tiles > 0, 'tuiles IGN demandées', String(stats.tiles));
  await page.click('[data-layer="plan"]');
  await page.waitForTimeout(800);
  c = await mapColor(page);
  check(isDay(c), 'retour au plan : fond jour', `couleur ${c}`);
  await ctx.close();
}

async function contextLossCheck(browser, base) {
  const { page, ctx } = await open(browser, base, { width: 412, height: 900, theme: 'night' });
  // Canevas vide = magenta (le fond de la carte nuit, #14161C, se confondrait avec celui de la page).
  await page.addStyleTag({ content: '.map { background: #ff00ff !important; }' });
  await computeRoute(page);
  await startSim(page);
  const before = await mapColor(page);
  check(isNight(before), 'guidage : carte dessinée avant la perte', `couleur ${before}`);

  // 1. Perte puis restauration du contexte WebGL.
  await page.evaluate(() => {
    const cv = document.querySelector('.maplibregl-canvas');
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    window.__lose = gl.getExtension('WEBGL_lose_context');
    window.__lose.loseContext();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__lose.restoreContext());
  await page.waitForTimeout(2500);
  let after = await mapColor(page);
  check(isNight(after), 'contexte WebGL perdu puis restauré : carte redessinée', `couleur ${after}`);
  check(await page.isVisible('#nav'), 'guidage toujours actif après restauration');

  // 2. Perte sans restauration, puis retour au premier plan : carte recréée.
  await page.evaluate(() => {
    const cv = document.querySelector('.maplibregl-canvas');
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    gl.getExtension('WEBGL_lose_context').loseContext();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(4500);
  after = await mapColor(page);
  check(isNight(after), 'contexte perdu sans restauration + retour visible : carte recréée', `couleur ${after}`);
  const instr = await page.textContent('#nav-instr');
  check(await page.isVisible('#nav') && !!instr, 'guidage toujours actif après recréation', instr ?? '');
  const routeShown = await page.evaluate(() => document.querySelectorAll('.maplibregl-canvas').length);
  check(routeShown === 1, 'une seule carte dans la page', String(routeShown));
  const me = await page.evaluate(() => document.querySelectorAll('.me-marker').length);
  check(me === 1, 'repère du véhicule remis sur la nouvelle carte', String(me));
  await page.screenshot({ path: join(SHOTS, 'contexte-recree.png') });
  await ctx.close();
}

async function parkedCheck(browser, base) {
  const nav = fixture('ors-directions-nav.json');
  // Avec les aires de la copie simulée (repères sur la carte, encart « Prochaines aires » ouvert) : avant le correctif
  // (v20), chaque position déplaçait flèche et caméra et MapLibre remettait à jour chaque repère → 144 images pour 8
  // positions.
  const { page, ctx, stats } = await open(browser, base, { width: 360, height: 760, directions: () => nav });
  await page.fill('#to-input', 'Lyon');
  await page.waitForSelector('#to-list li');
  await page.dispatchEvent('#to-list li', 'pointerdown');
  await page.click('#btn-route');
  await page.waitForSelector('#btn-nav-start:not([hidden])');
  const [lon, lat] = nav.features[0].geometry.coordinates[3];
  await setGeo(page, { lon, lat, accuracy: 10, speed: 0 });
  await page.click('#btn-nav-start');
  await page.waitForTimeout(1500);
  const before = stats.directions;
  await navAreas(page);
  await page.waitForTimeout(300);
  // Aire à ≈ 150 m au nord du tracé, GPS qui dérive (jusqu'à 60 m), précision 15 m, camion arrêté.
  for (let i = 0; i < 14; i += 1) {
    if (i === 6) {
      Object.assign(stats, { rafAt6: await page.evaluate(() => {
        window.__areaRow = document.querySelector('#nav-areas-list li');
        return window.__raf;
      }) });
    }
    const r = 60 * Math.abs(Math.sin(i * 0.9));
    const a = (i * 137 * Math.PI) / 180;
    await setGeo(page, { lat: lat + (150 + r * Math.cos(a)) / 110540,
      lon: lon + (r * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), accuracy: 15, speed: 0 });
    await page.waitForTimeout(1000);
  }
  // Camion arrêté (vitesse GPS 0) : une image par position, pas d'interpolation d'1 s en continu. MapLibre ajoute
  // quelques images après chaque déplacement de caméra (fondu) ; avec l'interpolation continue, Chromium sans écran
  // en comptait plusieurs centaines par position (≈ 600 / position mesurées avant ce correctif).
  const parkedRaf = (await page.evaluate(() => window.__raf)) - stats.rafAt6;
  const shown = await page.evaluate(() => ({
    markers: document.querySelectorAll('.area-marker').length,
    rows: document.querySelectorAll('#nav-areas-list li').length,
    same: !!window.__areaRow && window.__areaRow === document.querySelector('#nav-areas-list li'),
  }));
  check(shown.markers > 0 && shown.rows > 0, 'aires affichées (repères et encart ouvert)', `${shown.markers} repère(s), ${shown.rows} ligne(s)`);
  // Seuil strict : au plus une image par position (0 mesurée après le correctif, 144 avant).
  check(parkedRaf <= 8, 'camion arrêté, GPS qui dérive, aires affichées : rien à redessiner', `${parkedRaf} rAF pour 8 positions`);
  check(shown.same, 'encart « Prochaines aires » inchangé : lignes non reconstruites');
  check(stats.directions === before, 'arrêté sur une aire, GPS qui dérive : aucun recalcul', `${stats.directions - before} requête(s)`);
  check(await page.isVisible('#btn-nav-reroute'), 'bouton « Recalculer d\'ici » proposé');
  await noHorizontalScroll(page, '360 px guidage, proposition de recalcul');
  await page.screenshot({ path: join(SHOTS, '360-arret-hors-trace.png') });
  await page.click('#btn-nav-reroute');
  await page.waitForTimeout(1500);
  check(stats.directions === before + 1, 'recalcul seulement après l\'appui', `${stats.directions - before} requête(s)`);
  await ctx.close();
}

/** Nombre d'appels à requestAnimationFrame pendant ms (compteur posé par open()). */
async function rafCalls(page, ms) {
  const a = await page.evaluate(() => window.__raf);
  await page.waitForTimeout(ms);
  return (await page.evaluate(() => window.__raf)) - a;
}

async function comfortCheck(browser, base) {
  for (const [width, height] of [[360, 760], [1280, 800]]) {
    const nav = fixture('ors-directions-nav.json');
    const { page, ctx, stats, errors } = await open(browser, base, { width, height, directions: () => nav });
    // Réglages : couleur de la flèche, voix, musique.
    await page.click('#btn-settings');
    await page.check('input[name="arrow-color"][value="violet"]');
    const fill = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--arrow-fill').trim());
    check(fill === '#7b2fbf', `${width} px : couleur de la flèche appliquée`, fill);
    check(await page.isVisible('#voice-name') && await page.isVisible('#voice-rate') && await page.isVisible('#voice-volume'),
      `${width} px : réglages de la voix (liste, vitesse, volume)`);
    const music = await page.textContent('#voice-music');
    check(/Musique/.test(music ?? ''), `${width} px : phrase sur la musique`, music?.slice(0, 50));
    await noHorizontalScroll(page, `${width} px Réglages`);
    // Version en bas de Réglages : sans service worker actif (bloqué ici) → « version inconnue ».
    const ver = await page.evaluate(() => {
      const line = document.querySelector('#app-version');
      const body = line.closest('.dialog-body');
      const b = line.getBoundingClientRect(); const d = body.getBoundingClientRect();
      return { text: line.textContent, last: body.lastElementChild === line, inside: b.left >= d.left && b.right <= d.right,
        small: parseFloat(getComputedStyle(line).fontSize) < parseFloat(getComputedStyle(document.body).fontSize) };
    });
    check(ver.text === 'version inconnue' && ver.last && ver.inside && ver.small,
      `${width} px : « version inconnue » en petit tout en bas de Réglages (pas de service worker)`, JSON.stringify(ver));
    await page.screenshot({ path: join(SHOTS, `${width}-reglages.png`), fullPage: true });
    await page.click('#dlg-settings [data-close]');
    // Service worker actif qui répond (faux contrôleur, même message que sw.js) → « Gabarit vN ».
    const swVersion = readFileSync(join(ROOT, 'sw.js'), 'utf8').match(/const VERSION = '([^']+)';/)[1];
    await page.evaluate((v) => {
      const controller = { postMessage: (m, [port]) => { if (m.type === 'GET_VERSION') port.postMessage({ type: 'VERSION', version: v }); } };
      Object.defineProperty(navigator.serviceWorker, 'controller', { configurable: true, get: () => controller });
    }, swVersion);
    await page.click('#btn-settings');
    await page.waitForTimeout(200);
    const verOk = await page.textContent('#app-version');
    check(verOk === `Gabarit ${swVersion}`, `${width} px : version du service worker actif affichée`, verOk);
    await noHorizontalScroll(page, `${width} px Réglages avec version`);
    await page.click('#dlg-settings [data-close]');
    // Partager Gabarit : guide pas à pas.
    await page.click('#btn-share');
    const steps = await page.locator('#install-steps li').count();
    check(steps === 4, `${width} px : guide d'installation (4 étapes)`, String(steps));
    await noHorizontalScroll(page, `${width} px Partager`);
    await page.click('#dlg-share [data-close]');

    // Guidage réel (GPS émulé) : boutons de carte, nom de la route, satellite, jour plus clair.
    await page.fill('#to-input', 'Lyon');
    await page.waitForSelector('#to-list li');
    await page.dispatchEvent('#to-list li', 'pointerdown');
    await page.click('#btn-route');
    await page.waitForSelector('#btn-nav-start:not([hidden])');
    const line = nav.features[0].geometry.coordinates;
    await setGeo(page, { lon: line[0][0], lat: line[0][1], speed: 0 });
    await page.click('#btn-nav-start');
    await drive(ctx, page, line, 50, 6);
    check(await page.isVisible('#btn-nav-overview') && await page.isVisible('#btn-nav-compass') && await page.isVisible('#btn-nav-search')
      && await page.isVisible('#btn-nav-voice') && !(await page.isVisible('#btn-nav-recenter')),
    `${width} px : boutons ronds en guidage (Recentrer seulement si la carte a bougé)`);
    const road = await page.textContent('#nav-road');
    check(await page.isVisible('#nav-road') && /Route de Lyon|D 306/.test(road ?? ''), `${width} px : nom de la route en cours`, road);
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.nav-maneuver')).backgroundColor);
    check(bg === 'rgb(20, 22, 28)', `${width} px : bandeau noir Panier Perdu, même de jour (2c-a)`, bg);
    const round = await page.$$eval('#nav .nav-round', (n) => n.filter((b) => b.getClientRects().length)
      .map((b) => Math.round(Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))));
    check(round.length >= 5 && round.every((x) => x >= 56), `${width} px : boutons ronds d'au moins 56 px`, round.join(', '));
    await noHorizontalScroll(page, `${width} px guidage (boutons de carte)`);
    const over = await overflowingNavText(page);
    check(over.length === 0, `${width} px guidage : textes dans leurs cases`, over.join(' ; '));
    await page.screenshot({ path: join(SHOTS, `${width}-guidage-7c.png`) });

    await page.click('#btn-nav-overview');
    await page.waitForTimeout(900);
    check(await page.getAttribute('#btn-nav-overview', 'aria-pressed') === 'true'
      && await page.getAttribute('#btn-nav-recenter', 'aria-pressed') === 'false', `${width} px : vue d'ensemble en un appui`);
    await page.screenshot({ path: join(SHOTS, `${width}-vue-ensemble.png`) });
    await page.click('#btn-nav-recenter');
    check(await page.getAttribute('#btn-nav-recenter', 'aria-pressed') === 'true', `${width} px : recentrer en un appui`);

    const tiles = stats.tiles;
    await navLayer(page);
    await drive(ctx, page, line.slice(1), 50, 2);
    await page.waitForTimeout(800);
    check(stats.tiles > tiles && isRed(await mapColor(page)), `${width} px : satellite en guidage en un appui`, `${stats.tiles - tiles} tuiles`);
    check(/Plan/.test(await navLayerText(page)), `${width} px : le bouton propose ensuite le plan`);
    await page.screenshot({ path: join(SHOTS, `${width}-guidage-satellite.png`) });

    // Flèche fluide : plus de requestAnimationFrame quand aucune position n'arrive.
    await navLayer(page); // retour au plan (pas de tuiles qui se chargent)
    await page.waitForTimeout(2000);
    const calls = await rafCalls(page, 2000);
    check(calls <= 2, `${width} px : aucun rendu continu sans nouvelle position`, `${calls} rAF en 2 s`);
    const moving = page.evaluate(() => window.__raf);
    await setGeo(page, { lon: line[2][0], lat: line[2][1], speed: 14, heading: 90 });
    await page.waitForTimeout(500);
    const during = (await page.evaluate(() => window.__raf)) - await moving;
    check(during >= 10, `${width} px : flèche animée entre deux positions`, `${during} rAF en 0,5 s`);

    await stopGuidance(page);
    await page.waitForTimeout(800);
    check(isDay(await mapColor(page)), `${width} px : après le guidage, retour au plan mémorisé`);
    check(errors.length === 0, `${width} px : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
}

async function destinationsCheck(browser, base) {
  const { page, ctx, stats } = await open(browser, base, { width: 360, height: 760 });
  // Coordonnées saisies : proposées sans appel Pelias.
  const before = stats.pelias;
  await page.fill('#to-input', '48°41\'31.6"N 6°11\'03.8"E');
  await page.waitForSelector('#to-list li');
  const label = await page.textContent('#to-list li');
  check(label === '48,69211, 6,18439', 'coordonnées DMS reconnues', label);
  await page.dispatchEvent('#to-list li', 'pointerdown');
  check(stats.pelias === before, 'aucun appel au géocodage pour des coordonnées', String(stats.pelias - before));
  await page.fill('#from-input', '48.6921, 6.1844');
  await page.waitForSelector('#from-list li');
  check(await page.textContent('#from-list li') === '48,69210, 6,18440', 'coordonnées décimales reconnues');
  await page.dispatchEvent('#from-list li', 'pointerdown');
  await page.click('#btn-route');
  await page.waitForSelector('.route-card', { timeout: 10000 });
  check(true, 'itinéraire calculé depuis des coordonnées');

  // Appui long (doigt, 800 ms) sur la carte : « Aller ici ».
  const box = await page.locator('#map').boundingBox();
  const x = box.x + box.width * 0.3;
  const y = box.y + box.height * 0.55;
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(800);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForSelector('#press-sheet:not([hidden])', { timeout: 3000 });
  await noHorizontalScroll(page, '360 px appui long');
  check(await page.isVisible('#btn-press-to') && await page.isVisible('#btn-press-from'), 'appui long : « Aller ici » et « Partir d\'ici » visibles');
  await page.screenshot({ path: join(SHOTS, '360-appui-long.png') });
  const popupText = await page.textContent('#press-coords');
  await page.click('#btn-press-to');
  const to = await page.inputValue('#to-input');
  check(/^\d+,\d{5}, \d+,\d{5}$/.test(to) && popupText.endsWith(to), '« Aller ici » remplit l\'arrivée', to);
  check(!(await page.isVisible('#press-sheet')), 'choix fermé après l\'appui');
  // Appui court : rien.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(150);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(800);
  check(!(await page.isVisible('#press-sheet')), 'appui court : rien');
  // Clic droit (souris) : « Partir d'ici ».
  await page.mouse.click(x + 20, y, { button: 'right' });
  await page.waitForSelector('#press-sheet:not([hidden])');
  await page.click('#btn-press-from');
  check(/^\d+,\d{5}, \d+,\d{5}$/.test(await page.inputValue('#from-input')), '« Partir d\'ici » remplit le départ');
  // Pendant le guidage : pas d'appui long.
  await startSim(page);
  await page.mouse.click(x, y, { button: 'right' });
  await page.waitForTimeout(500);
  check(!(await page.isVisible('#press-sheet')), 'guidage : pas d\'appui long');
  await ctx.close();
}

/** État de la caméra vu de l'écran : échelle (zoom) et position de la flèche du camion. */
async function cameraView(page) {
  return page.evaluate(() => {
    const b = document.querySelector('.me-marker')?.getBoundingClientRect();
    return {
      scale: document.querySelector('.maplibregl-ctrl-scale')?.textContent ?? '',
      me: b ? [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)] : null,
    };
  });
}

/**
 * Vue d'ensemble avec des positions envoyées comme le vrai GPS (une par seconde, vitesse fournie), en plan puis en
 * satellite : la caméra doit quitter le camion et y rester jusqu'à « Recentrer » (ou 15 s en roulant).
 */
async function overviewGpsCheck(browser, base) {
  for (const layer of ['plan', 'satellite']) {
    const nav = fixture('ors-directions-nav.json');
    const { page, ctx, errors } = await open(browser, base, { width: 412, height: 900, directions: () => nav });
    await page.fill('#to-input', 'Lyon');
    await page.waitForSelector('#to-list li');
    await page.dispatchEvent('#to-list li', 'pointerdown');
    await page.click('#btn-route');
    await page.waitForSelector('#btn-nav-start:not([hidden])');
    const line = nav.features[0].geometry.coordinates;
    await setGeo(page, { lon: line[0][0], lat: line[0][1], speed: 0 });
    await page.click('#btn-nav-start');
    if (layer === 'satellite') await navLayer(page);
    // Positions GPS le long du tracé, une par seconde, à 50 km/h, sans s'arrêter pendant les vérifications.
    const step = 50 / 3.6;
    const cum = [0];
    for (let i = 1; i < line.length; i += 1) {
      const [a, b] = [line[i - 1], line[i]];
      cum.push(cum[i - 1] + Math.hypot((b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 110540));
    }
    let t = 0;
    let driving = true;
    const feeder = (async () => {
      while (driving) {
        t += step;
        let i = cum.findIndex((c) => c > t);
        if (i < 1) i = cum.length - 1;
        const f = Math.min(1, (t - cum[i - 1]) / (cum[i] - cum[i - 1] || 1));
        const [a, b] = [line[i - 1], line[i]];
        await setGeo(page, { lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, accuracy: 5, speed: step, heading: 90 });
        await page.waitForTimeout(1000);
      }
    })();
    await page.waitForTimeout(5000);
    const followed = await cameraView(page);
    await page.click('#btn-nav-overview');
    await page.waitForTimeout(1500);
    const ov1 = await cameraView(page);
    check(ov1.scale !== followed.scale, `${layer} : vue d'ensemble, la carte dézoome (vrai GPS)`, `${followed.scale} → ${ov1.scale}`);
    await page.waitForTimeout(5000);
    const ov2 = await cameraView(page);
    check(ov2.scale === ov1.scale, `${layer} : vue d'ensemble gardée pendant que les positions arrivent`, `${ov1.scale} → ${ov2.scale}`);
    check(!!ov1.me && !!ov2.me && (ov1.me[0] !== ov2.me[0] || ov1.me[1] !== ov2.me[1]),
      `${layer} : en vue d'ensemble, la carte ne suit plus le camion`, `${ov1.me} → ${ov2.me}`);
    await page.screenshot({ path: join(SHOTS, `412-vue-ensemble-gps-${layer}.png`) });
    await page.click('#btn-nav-recenter');
    await page.waitForTimeout(2500);
    const back = await cameraView(page);
    check(back.scale === followed.scale, `${layer} : « Recentrer » revient sur le camion`, `${ov2.scale} → ${back.scale}`);
    // 15 s en roulant : retour automatique au suivi.
    await page.click('#btn-nav-overview');
    await page.waitForTimeout(10000);
    check((await cameraView(page)).scale !== followed.scale, `${layer} : vue d'ensemble encore là après 10 s`);
    await page.waitForTimeout(6500);
    const auto = await cameraView(page);
    check(auto.scale === followed.scale && await page.getAttribute('#btn-nav-recenter', 'aria-pressed') === 'true',
      `${layer} : retour au suivi après 15 s en roulant`, auto.scale);
    driving = false;
    await feeder;
    check(errors.length === 0, `${layer} : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
}

/**
 * Appui long puis saisie : effacer le champ et taper une autre adresse doit oublier le point de la carte
 * (arrivée et départ), comme une suggestion choisie puis effacée.
 */
async function pressThenTypeCheck(browser, base) {
  const bodies = [];
  const { page, ctx } = await open(browser, base, { width: 360, height: 760, directions: (body) => {
    bodies.push(body);
    return fixture('ors-directions-nav.json');
  } });
  const cdp = await ctx.newCDPSession(page);
  const longPress = async (dx) => {
    const box = await page.locator('#map').boundingBox();
    const x = box.x + box.width * 0.3 + dx;
    const y = box.y + box.height * 0.55;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(800);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForSelector('#press-sheet:not([hidden])', { timeout: 3000 });
  };
  const pins = () => page.evaluate(() => [...document.querySelectorAll('.maplibregl-marker')]
    .filter((m) => m.querySelector('[fill="#7b2fbf"]')).length);
  const typeAndPick = async (sel, list) => {
    // Comme au doigt : toucher le milieu du texte, effacer touche par touche, taper, puis toucher la première
    // suggestion affichée dès qu'il y en a une.
    await page.click(sel);
    const n = (await page.inputValue(sel)).length;
    for (let i = 0; i < n; i += 1) await page.keyboard.press('Backspace', { delay: 15 });
    await page.keyboard.type('Lyon', { delay: 30 });
    await page.waitForSelector(`${list} li`);
    await page.dispatchEvent(`${list} li`, 'pointerdown');
  };
  // Arrivée.
  await longPress(0);
  await page.click('#btn-press-to');
  const pressed = await page.inputValue('#to-input');
  check(await pins() === 1, '« Aller ici » : repère du point choisi sur la carte');
  await typeAndPick('#to-input', '#to-list');
  check(await pins() === 0, 'saisie après « Aller ici » : repère de la carte retiré');
  // Départ.
  await longPress(30);
  await page.click('#btn-press-from');
  check(await pins() === 1, '« Partir d\'ici » : repère du point choisi sur la carte');
  await typeAndPick('#from-input', '#from-list');
  check(await page.inputValue('#from-input') === 'Lyon, France', 'départ : suggestion de l\'adresse tapée choisie',
    await page.inputValue('#from-input'));
  check(await pins() === 0, 'saisie après « Partir d\'ici » : repère de la carte retiré');
  await page.click('#btn-route');
  await page.waitForSelector('.route-card', { timeout: 10000 });
  const lyon = fixture('pelias-autocomplete.json').features[0].geometry.coordinates;
  const [start, end] = bodies.at(-1).coordinates;
  check(end[0] === lyon[0] && end[1] === lyon[1], 'arrivée = adresse tapée, pas le point de l\'appui long',
    `${end} (appui long ${pressed})`);
  check(start[0] === lyon[0] && start[1] === lyon[1], 'départ = adresse tapée, pas le point de l\'appui long', `${start}`);
  await ctx.close();
}

// ───────── Phase 9 : aires et parkings PL ─────────

/**
 * Liste, repères, fiche + « Mon avis », encart en guidage avec un GPS émulé comme le vrai : aires lues dans la copie
 * data/aires-osm/ sans Overpass (phase 9b). Puis trajet hors de la zone couverte (Overpass, serveur de secours,
 * cache), deux serveurs en échec, copie absente.
 */
async function areasCheck(browser, base) {
  for (const [width, height] of [[360, 760], [1280, 800]]) {
    const nav = fixture('ors-directions-nav.json');
    const line = nav.features[0].geometry.coordinates;
    const { page, ctx, stats, errors } = await open(browser, base, {
      width, height, directions: () => nav, official: fixture('aires-pl.json'),
      overpass: () => fixture('overpass-aires.json'),
    });
    await computeRoute(page);
    await page.waitForSelector('#areas-list li', { timeout: 10000 });
    const rows = await page.$$eval('#areas-list .area-row', (n) => n.map((b) => ({ text: b.textContent, other: b.classList.contains('other-side') })));
    check(rows.length === 5, `${width} px : liste des aires du trajet`, `${rows.length} aires`);
    check(rows.filter((r) => r.other).length === 1 && rows.find((r) => r.other)?.text.includes('autre sens ?'),
      `${width} px : aire de l'autre côté en gris « autre sens ? »`);
    check(rows[0].text.includes('km 1') && rows[0].text.includes('40 places PL') && /\d\d:\d\d/.test(rows[0].text),
      `${width} px : km, heure d'arrivée et places PL`, rows[0].text);
    check(stats.overpass.length === 0 && stats.copy.includes('index.json') && stats.copy.length >= 2,
      `${width} px : aires lues dans la copie, aucune requête Overpass`, `${stats.overpass.length} requêtes ; ${stats.copy.join(', ')}`);
    check((await page.textContent('.areas-credit')).includes('ODbL, copie du 01/12/2026'), `${width} px : date de la copie dans la note de source`,
      await page.textContent('.areas-credit'));
    const markers = await page.$$eval('.area-marker', (n) => n.map((m) => m.classList.contains('other-side')));
    check(markers.length === 5 && markers.filter(Boolean).length === 1, `${width} px : repères des aires sur la carte`,
      `${markers.length} repères`);
    await noHorizontalScroll(page, `${width} px liste des aires`);
    await page.locator('#areas').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `${width}-aires-liste.png`) });

    // Toucher un repère = sa fiche ; « Mon avis » hors guidage.
    await page.locator('.area-marker:not(.other-side)').first().click();
    await page.waitForSelector('#dlg-area[open]');
    check((await page.textContent('#area-title')) === 'Aire PL de Test-Est', `${width} px : toucher un repère ouvre sa fiche`,
      await page.textContent('#area-title'));
    check((await page.textContent('#area-sources')).includes('copie du 01/12/2026'), `${width} px : fiche, date de la copie OSM`,
      await page.textContent('#area-sources'));
    check(await page.isEnabled('[data-avis="full"]'), `${width} px : « Mon avis » possible à l'arrêt`);
    await noHorizontalScroll(page, `${width} px fiche d'une aire`);
    await page.screenshot({ path: join(SHOTS, `${width}-aire-fiche.png`) });
    await page.click('[data-avis="full"]');
    check((await page.textContent('#area-last')).includes('Plein à l\'instant'), `${width} px : avis affiché sur la fiche`);
    await page.click('#dlg-area [data-close]');
    check((await page.textContent('#areas-list')).includes('Plein à l\'instant'), `${width} px : avis affiché dans la liste`);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gabarit.data')).areaReports?.length ?? 0);
    check(saved === 1, `${width} px : avis gardé sur l'appareil (données exportées)`, `${saved}`);

    // Même trajet recalculé : mêmes aires, aucune requête Overpass.
    await page.click('#btn-route');
    await page.waitForTimeout(1500);
    check(stats.overpass.length === 0 && (await page.$$('#areas-list li')).length === 5,
      `${width} px : même trajet recalculé sans requête Overpass`, `${stats.overpass.length} requêtes`);

    // Guidage avec le GPS émulé (une position par seconde, vitesse fournie).
    await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
    await page.click('#btn-nav-start');
    await page.waitForTimeout(1500);
    check(await page.isHidden('#nav-areas'), `${width} px : encart fermé au départ`);
    await navAreas(page);
    const navRows = async () => page.$$eval('#nav-areas-list .nav-area', (n) => n.map((b) => ({
      name: b.querySelector('.nav-area-name').textContent, dist: b.querySelector('.nav-area-dist').textContent,
      eta: b.querySelector('.nav-area-eta').textContent, places: b.querySelector('.nav-area-places').textContent,
    })));
    await drive(ctx, page, line, 50, 4);
    const r1 = await navRows();
    // Phase 2d : toutes les aires du sens de circulation (15 au plus), dans l'ordre de la route.
    check(r1.length >= 3 && r1.length <= 15 && r1[0].name === 'Aire PL de Test-Est' && /\d\d:\d\d/.test(r1[0].eta) && r1[0].places === '40 places PL',
      `${width} px : liste des aires (nom, distance, heure, places)`, `${r1.length} ligne(s) ; ${JSON.stringify(r1[0])}`);
    check(r1.every((r) => r.name !== 'Aire de l\'Autre-Sens'), `${width} px : aire de l'autre sens hors de l'encart`);
    await noHorizontalScroll(page, `${width} px guidage, encart des aires`);
    const over = await page.evaluate(() => [...document.querySelectorAll('#nav-areas *')]
      .filter((n) => n.getClientRects().length && n.childElementCount === 0 && n.scrollWidth > n.clientWidth + 1)
      .map((n) => n.textContent));
    check(over.length === 0, `${width} px : textes de l'encart dans leurs cases`, over.join(' ; '));
    const overNav = await overflowingNavText(page);
    check(overNav.length === 0, `${width} px : guidage, textes dans leurs cases avec l'encart`, overNav.join(' ; '));
    await page.screenshot({ path: join(SHOTS, `${width}-aires-guidage.png`) });
    await drive(ctx, page, line, 50, 12); // repart du début : 110 m plus loin qu'avant, au-delà de l'arrondi à 50 m
    const r2 = await navRows();
    const km = (t) => (t === 'Ici' ? 0 : Number.parseFloat(t.replace(',', '.')) * (t.endsWith(' km') ? 1000 : 1));
    check(km(r2[0].dist) < km(r1[0].dist), `${width} px : distance mise à jour à chaque position`, `${r1[0].dist} → ${r2[0].dist}`);
    // Toucher une aire en roulant : fiche courte seulement (phase 2d), « Fiche complète » grisée, rien ne s'ouvre.
    await page.locator('#nav-areas-list .nav-area').first().click();
    await page.waitForTimeout(300);
    check(await page.isVisible('#nav-area-card') && await page.getAttribute('#btn-nav-area-sheet', 'aria-disabled') === 'true',
      `${width} px : en roulant, fiche courte et « Fiche complète » grisée`);
    await page.click('#btn-nav-area-sheet', { force: true });
    check(!(await page.isVisible('#dlg-area')), `${width} px : en roulant, aucune fiche complète ouverte`);
    // Repère d'aire touché sur la carte en roulant : liste et fiche courte, jamais la fiche complète (R412-6-2).
    const firstId = await page.getAttribute('#nav-areas-list .nav-area', 'data-id');
    await navAreas(page); // liste fermée
    const marker = page.locator(`.area-marker[data-id="${firstId}"]`);
    await marker.dispatchEvent('click');
    await page.waitForTimeout(300);
    check(await page.isVisible('#nav-areas') && await page.isVisible('#nav-area-card') && !(await page.isVisible('#dlg-area')),
      `${width} px : en roulant, repère touché → liste et fiche courte, pas de fiche complète`);
    // À l'arrêt (moins de 5 km/h pendant 3 s) : fiche complète, avis possible.
    const here = r2.length ? line[6] : line[0];
    for (let i = 0; i < 9; i += 1) {
      await setGeo(page, { lon: here[0], lat: here[1], accuracy: 5, speed: 0 });
      await page.waitForTimeout(1000);
    }
    // À l'arrêt : repère touché → fiche courte seulement ; fiche complète par « Fiche complète ». Repère de la première
    // aire de la liste à cette position (celle d'avant a pu être dépassée).
    if (!(await page.isVisible('#nav-areas'))) await navAreas(page);
    const hereId = await page.getAttribute('#nav-areas-list .nav-area', 'data-id');
    await page.locator(`.area-marker[data-id="${hereId}"]`).dispatchEvent('click');
    await page.waitForTimeout(300);
    check(await page.isVisible('#nav-area-card') && !(await page.isVisible('#dlg-area')),
      `${width} px : à l'arrêt, repère touché → fiche courte seulement`);
    await page.click('#btn-nav-area-sheet');
    await page.waitForSelector('#dlg-area[open]');
    check(await page.isEnabled('[data-avis="ok"]'), `${width} px : « Mon avis » possible à l'arrêt en guidage`);
    await page.click('#dlg-area [data-close]');
    await navAreas(page);
    check(await page.isHidden('#nav-areas'), `${width} px : encart fermé d'un appui`);
    check(errors.length === 0, `${width} px : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
  const nav = fixture('ors-directions-nav.json');
  // Trajet hors de la zone couverte : une requête Overpass, serveur de secours après un échec, résultat gardé.
  {
    const { page, ctx, stats, errors } = await open(browser, base, {
      width: 360, height: 760, directions: () => nav, official: fixture('aires-pl.json'), osmCopy: 'uncovered',
      overpass: (url) => (url.includes('overpass-api.de') ? null : fixture('overpass-aires.json')),
    });
    await computeRoute(page);
    await page.waitForSelector('#areas-list li', { timeout: 10000 });
    check((await page.$$('#areas-list li')).length === 5, 'hors zone couverte : aires trouvées par Overpass');
    check(stats.overpass.length === 2 && stats.overpass[0] === 'overpass-api.de' && stats.overpass[1] !== 'overpass-api.de',
      'hors zone couverte : une requête Overpass, serveur de secours après un échec', stats.overpass.join(' → '));
    check(await page.evaluate(() => !!localStorage.getItem('gabarit.areasCache')), 'hors zone couverte : aires gardées sur l\'appareil');
    await page.click('#btn-route');
    await page.waitForTimeout(1500);
    check(stats.overpass.length === 2 && (await page.$$('#areas-list li')).length === 5,
      'hors zone couverte : même trajet recalculé sans requête Overpass', `${stats.overpass.length} requêtes`);
    check(errors.length === 0, 'hors zone couverte : aucune erreur JavaScript', errors.join(' | '));
    await ctx.close();
  }
  // Les deux serveurs Overpass en échec : « Aires indisponibles », itinéraire utilisable.
  {
    const { page, ctx, stats } = await open(browser, base, { width: 360, height: 760, directions: () => nav, overpass: () => null, osmCopy: 'uncovered' });
    await computeRoute(page);
    await page.waitForFunction(() => /indisponibles/.test(document.querySelector('#areas-status')?.textContent ?? ''), null, { timeout: 10000 });
    check(stats.overpass.length === 2 && await page.isVisible('#btn-nav-start'),
      'deux serveurs en échec : « Aires indisponibles », itinéraire utilisable', await page.textContent('#areas-status'));
    await ctx.close();
  }
  // Copie absente : message clair, aucune requête Overpass, aires officielles gardées, itinéraire utilisable.
  {
    const { page, ctx, stats } = await open(browser, base, {
      width: 360, height: 760, directions: () => nav, official: fixture('aires-pl.json'), osmCopy: null, overpass: () => fixture('overpass-aires.json'),
    });
    await computeRoute(page);
    await page.waitForFunction(() => /données non chargées/.test(document.querySelector('#areas-status')?.textContent ?? ''), null, { timeout: 10000 });
    const text = await page.textContent('#areas-status');
    check(text.startsWith('Aires indisponibles sur ce trajet (données non chargées).') && stats.overpass.length === 0
      && await page.isVisible('#btn-nav-start'), 'copie absente : « Aires indisponibles sur ce trajet (données non chargées) »', text);
    await noHorizontalScroll(page, '360 px copie des aires absente');
    await page.locator('#areas').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, '360-aires-copie-absente.png') });
    await ctx.close();
  }
}

/** Recouvrements entre boutons de carte, bandeau, encart des aires, nom de la route et barre du bas du guidage. */
async function footOverlaps(page) {
  return page.evaluate(() => {
    const vis = (n) => n && !n.hidden && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const box = (n) => n.getBoundingClientRect();
    const name = (n) => n.id || n.className.split(' ')[0];
    // Phase 2c : bandeau (avec « Puis » et alertes), pastille de rue, boutons ronds, rangée de la loupe, encart des
    // aires, compteur, message, panneau du bas : aucun ne recouvre un autre.
    const banner = [...document.querySelectorAll('#nav .nav-top > *, #nav .nav-alerts > *')].filter(vis)
      .filter((n) => !n.classList.contains('nav-alerts'));
    const buttons = [...document.querySelectorAll('#nav .nav-mapbtns > button')].filter(vis);
    const singles = ['#nav-road', '#nav-search', '#nav-areas', '#nav-speedo', '#nav-toast', '#nav .nav-bottom']
      .map((q) => document.querySelector(q)).filter(vis);
    const groups = [banner, buttons, ...singles.map((n) => [n])];
    const hit = (a, b) => {
      const p = box(a); const q = box(b);
      return p.left < q.right - 0.5 && q.left < p.right - 0.5 && p.top < q.bottom - 0.5 && q.top < p.bottom - 0.5;
    };
    const out = [];
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        for (const a of groups[i]) for (const b of groups[j]) if (hit(a, b)) out.push(`${name(a)} × ${name(b)}`);
      }
    }
    for (let i = 0; i < buttons.length; i += 1) for (let j = i + 1; j < buttons.length; j += 1) {
      if (hit(buttons[i], buttons[j])) out.push(`${name(buttons[i])} × ${name(buttons[j])}`);
    }
    for (const a of [...banner, ...buttons, ...singles]) {
      const r = box(a);
      if (r.top < -0.5 || r.bottom > window.innerHeight + 0.5 || r.left < -0.5 || r.right > window.innerWidth + 0.5) {
        out.push(`${name(a)} hors de l'écran (${Math.round(r.left)},${Math.round(r.top)} – ${Math.round(r.right)},${Math.round(r.bottom)})`);
      }
    }
    const sizes = buttons.map((b) => Math.round(Math.min(box(b).height, box(b).width)));
    const areas = document.querySelector('#nav-areas');
    return { out, sizes, areasHeight: vis(areas) ? Math.round(box(areas).height) : 0 };
  });
}

/**
 * Boutons de carte (vue d'ensemble, recentrer, satellite, aires) et encart des aires : jamais sur le bandeau du haut
 * (consigne longue) ni sur la barre du bas, encart ouvert ou fermé ; téléphone en portrait (360, 412 px), téléphone
 * en paysage (760 × 360, 900 × 412) et tablette.
 */
async function footCheck(browser, base) {
  const long = 'Prenez la sortie 34 en direction de Villefranche-sur-Saône, Bourg-en-Bresse, Mâcon-Centre, '
    + 'Zone industrielle des Grandes Terres et Parc d’activités de la Plaine de l’Ain';
  for (const [width, height] of [[360, 760], [412, 900], [760, 360], [900, 412], [1280, 800]]) {
    const nav = fixture('ors-directions-nav.json');
    const steps = nav.features[0].properties.segments[0].steps;
    const first = steps.findIndex((st, i) => i > 0 && st.type !== 11);
    steps[first] = { ...steps[first], instruction: long };
    const line = nav.features[0].geometry.coordinates;
    const { page, ctx, errors } = await open(browser, base, {
      width, height, directions: () => nav, overpass: () => fixture('overpass-aires.json'),
    });
    await computeRoute(page);
    await page.waitForSelector('#areas-list li', { timeout: 10000 });
    await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
    await page.click('#btn-nav-start');
    await drive(ctx, page, line, 40, 3);
    const label = `${width}×${height}`;
    const closed = await footOverlaps(page);
    check(closed.out.length === 0, `${label} guidage, encart fermé : boutons hors du bandeau et de la barre du bas`, closed.out.join(' ; '));
    check(closed.sizes.length === 4 && closed.sizes.every((h) => h >= 56), `${label} : boutons ronds d'au moins 56 px`,
      closed.sizes.join(', '));
    await page.screenshot({ path: join(SHOTS, `${width}x${height}-pied-ferme.png`) });
    await navAreas(page);
    await drive(ctx, page, line, 40, 2);
    const opened = await footOverlaps(page);
    check(opened.out.length === 0, `${label} guidage, encart ouvert : aucun recouvrement bouton / bandeau / encart`, opened.out.join(' ; '));
    check(opened.areasHeight >= 100, `${label} : encart des aires lisible`, `${opened.areasHeight} px`);
    check((await page.textContent('#nav-instr')).includes('Villefranche'), `${label} : consigne longue affichée`);
    await page.screenshot({ path: join(SHOTS, `${width}x${height}-pied-encart.png`) });
    check(errors.length === 0, `${label} : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
}

/**
 * Phase 5 : réglementation. Une ZFE de test (Crit'Air 3 et plus interdits) posée sur le milieu du trajet des fixtures,
 * tablette réglée un samedi à 21 h 57 (interdiction PL à 22 h pendant le trajet) ; profil sans vignette (non classé).
 * Fiches, notes, « Éviter la ZFE » (requête ORS avec avoid_polygons), puis guidage avec le GPS émulé : bandeau de
 * réglementation dans sa case, sans recouvrir les boutons de carte ; 360, 412, 800 et 1280 px.
 */
async function rulesCheck(browser, base) {
  const nav = fixture('ors-directions-nav.json');
  const line = nav.features[0].geometry.coordinates;
  const [cx, cy] = line[Math.floor(line.length / 2)];
  const d = 0.006;
  const zfe = {
    updated: '2026-03-26',
    zones: [{
      id: 'TEST-ZFE-001', name: 'Testville', start: '2025-01-01', end: null,
      pl: { critair: 'V3', hours: '24/7' }, vul: { critair: 'V3', hours: '24/7' },
      url: 'https://example.org/arrete-zfe.pdf',
      polygons: [[[[cx - d, cy - d], [cx + d, cy - d], [cx + d, cy + d], [cx - d, cy + d], [cx - d, cy - d]]]],
    }],
    voies: [],
  };
  const now = new Date('2026-11-21T21:57:00+01:00').getTime(); // samedi 21 h 57 à Paris
  for (const [width, height] of [[360, 760], [412, 900], [800, 1280], [1280, 800]]) {
    const avoid = [];
    const { page, ctx, errors } = await open(browser, base, {
      width, height, zfe, now, overpass: () => fixture('overpass-aires.json'),
      directions: (body) => {
        if (body.options?.avoid_polygons) avoid.push(body.options.avoid_polygons);
        return nav;
      },
    });
    await computeRoute(page);
    await page.waitForSelector('.route-card-rules', { timeout: 10000 });
    const cardRules = await page.textContent('.route-card[aria-checked="true"] .route-card-rules');
    check(/ZFE Testville interdite/.test(cardRules) && /Interdiction PL à partir de samedi 22 h/.test(cardRules),
      `${width} px : fiche, ZFE interdite et interdiction PL`, cardRules);
    const notes = await page.$$eval('.rules-notes li', (n) => n.map((li) => ({ cls: li.className, text: li.textContent, link: li.querySelector('a')?.href ?? '' })));
    check(notes.some((n) => n.cls === 'warn' && /^ZFE Testville interdite : Crit'Air 3, 4, 5 et non classés interdits/.test(n.text)
      && n.link === 'https://example.org/arrete-zfe.pdf'), `${width} px : note ZFE avec lien vers l'arrêté`, notes.map((n) => n.text).join(' | '));
    check(notes.some((n) => n.cls === 'warn' && /Interdiction PL samedi 22 h → dimanche 22 h/.test(n.text)),
      `${width} px : note interdiction samedi 22 h → dimanche 22 h`);
    check(/Base nationale des ZFE.*ODbL.*copie du 26\/03\/2026/.test(await page.textContent('.rules-source')),
      `${width} px : source et date des données ZFE`);
    check(await page.isVisible('.btn-avoid-zfe'), `${width} px : bouton « Éviter la ZFE » à l'arrêt`);
    await noHorizontalScroll(page, `${width} px fiches et réglementation`);
    await page.locator('#route-notes').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `${width}-reglementation.png`) });

    await page.click('.btn-avoid-zfe');
    await page.waitForSelector('.route-card:has-text("Sans ZFE")', { timeout: 10000 });
    check(avoid.length === 1 && avoid[0].type === 'MultiPolygon' && avoid[0].coordinates.length === 1,
      `${width} px : « Éviter la ZFE » = une requête ORS avec avoid_polygons`, JSON.stringify(avoid[0] ?? null).slice(0, 80));
    check((await page.textContent('.route-card[aria-checked="true"]')).includes('Sans ZFE'), `${width} px : itinéraire « Sans ZFE » choisi`);
    check(/passe encore par : Testville/.test(await page.textContent('#message')),
      `${width} px : prévient si l'itinéraire sans ZFE y passe encore`);
    await noHorizontalScroll(page, `${width} px après « Éviter la ZFE »`);

    // Guidage avec le GPS émulé (une position par seconde, vitesse fournie) : bandeau, aucune saisie.
    await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
    await page.click('#btn-nav-start');
    await drive(ctx, page, line, 50, 4);
    const rule = await page.textContent('#nav-rule');
    check(await page.isVisible('#nav-rule') && /ZFE Testville dans [\d,]+ (km|m) : interdite à ce véhicule/.test(rule)
      && /Interdiction PL dans \d+ min \(samedi 22 h\)/.test(rule), `${width} px : bandeau ZFE et interdiction en guidage`, rule);
    check((await page.$$('#nav-rule button, #nav-rule input')).length === 0, `${width} px : bandeau sans bouton ni saisie`);
    const over = await overflowingNavText(page);
    check(over.length === 0, `${width} px : textes du guidage dans leurs cases`, over.join(' ; '));
    const foot = await footOverlaps(page);
    check(foot.out.length === 0, `${width} px : boutons de carte hors du bandeau de réglementation`, foot.out.join(' ; '));
    await noHorizontalScroll(page, `${width} px guidage, réglementation`);
    await page.screenshot({ path: join(SHOTS, `${width}-reglementation-guidage.png`) });
    check(errors.length === 0, `${width} px : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
}

/**
 * Phase 5b : matières dangereuses. Profil ADR code C ; un tunnel de catégorie D (copie OSM simulée) posé sur le
 * milieu du trajet des fixtures. Fiche (« interdit »), notes (« la signalisation fait foi » sur chaque ligne de
 * tunnel, phrase ORS, rappel ADR, source OSM), « Éviter le tunnel » (requête ORS avec avoid_polygons), guidage avec
 * le GPS émulé (bandeau dans sa case), puis fichier absent (« Alerte tunnels indisponible »), code vide (aucune
 * alerte), profil enregistré avant la v19 repris dans Réglages (section ADR, profil sans champs ADR, nouveau calcul) ;
 * 360, 412, 800 et 1280 px. Enfin le vrai
 * service worker : « Gabarit v21 » en bas de Réglages.
 */
async function adrCheck(browser, base) {
  const nav = fixture('ors-directions-nav.json');
  const line = nav.features[0].geometry.coordinates;
  const tunnels = {
    source: 'test', license: 'ODbL', updated: '2026-11-17',
    tunnels: [{ id: 'w1', name: 'Tunnel de Test', cat: 'D', g: line.slice(10, 15) }],
  };
  const vehicle = (tunnelCode) => ({
    id: 'v1', name: 'Citerne ADR', height: 4, width: 2.55, length: 16.5, weight: 44, axleload: 11.5, maxSpeed: 90,
    hazmat: true, tunnelCode, adrClass: '3', unNumber: '1202', critair: '1',
  });
  for (const [width, height] of [[360, 760], [412, 900], [800, 1280], [1280, 800]]) {
    const avoid = [];
    const { page, ctx, errors } = await open(browser, base, {
      width, height, tunnels, vehicle: vehicle('C'), overpass: () => fixture('overpass-aires.json'),
      directions: (body) => {
        if (body.options?.avoid_polygons) avoid.push(body.options.avoid_polygons);
        return nav;
      },
    });
    await computeRoute(page);
    await page.waitForSelector('.route-card-rules', { timeout: 10000 });
    const card = await page.textContent('.route-card[aria-checked="true"] .route-card-rules');
    check(/Tunnel de Test interdit/.test(card), `${width} px : fiche, tunnel interdit`, card);
    const notes = await page.$$eval('.rules-notes li', (n) => n.map((li) => ({ cls: li.className, text: li.textContent })));
    const tun = notes.filter((n) => /^Tunnel de Test/.test(n.text));
    check(tun.length === 1 && tun[0].cls === 'warn'
      && /^Tunnel de Test \(catégorie D\) interdit au code C : vous y seriez vers km \d+ \(vers \d+ h \d\d\)\. La signalisation fait foi\.$/.test(tun[0].text),
    `${width} px : note du tunnel avec « la signalisation fait foi »`, notes.map((n) => n.text).join(' | '));
    check(notes.some((n) => /^ADR : mêmes interdictions de circulation/.test(n.text)), `${width} px : rappel ADR`);
    check(!notes.some((n) => /sans tunnel interdit/i.test(n.text)), `${width} px : jamais « sans tunnel interdit »`);
    const summary = await page.$$eval('.summary-notes li', (n) => n.map((li) => li.textContent));
    check(summary.some((t) => /OpenRouteService évite tous les tunnels.*plus long que nécessaire/.test(t)),
      `${width} px : phrase ORS (itinéraire peut être plus long)`, summary.join(' | '));
    check(summary.some((t) => /matières dangereuses, code C, classe 3, UN 1202/.test(t)), `${width} px : profil ADR dans les notes`);
    check(/OpenStreetMap \(ODbL\).*Copie OSM du 17\/11\/2026/.test(await page.textContent('.rules-source')), `${width} px : source des tunnels`);
    check(await page.isVisible('.btn-avoid-tunnel'), `${width} px : bouton « Éviter le tunnel » à l'arrêt`);
    await noHorizontalScroll(page, `${width} px fiches ADR`);
    await page.locator('#route-notes').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `${width}-adr.png`) });

    await page.click('.btn-avoid-tunnel');
    await page.waitForSelector('.route-card:has-text("Contournement")', { timeout: 10000 });
    check(avoid.length === 1 && avoid[0].type === 'MultiPolygon' && avoid[0].coordinates.length === 1
      && avoid[0].coordinates[0][0].length === 5, `${width} px : « Éviter le tunnel » = une requête ORS, un carré`, JSON.stringify(avoid[0] ?? null).slice(0, 90));
    check(/Le contournement passe encore par : Tunnel de Test\. La signalisation fait foi\./.test(await page.textContent('#message')),
      `${width} px : prévient si le contournement y passe encore (fixture identique)`);
    await noHorizontalScroll(page, `${width} px après « Éviter le tunnel »`);

    await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
    await page.click('#btn-nav-start');
    await drive(ctx, page, line, 50, 4);
    const rule = await page.textContent('#nav-rule');
    check(await page.isVisible('#nav-rule') && /Tunnel de Test dans [\d,]+ (km|m) : interdit \(code C\) · la signalisation fait foi/.test(rule),
      `${width} px : bandeau du tunnel en guidage`, rule);
    const over = await overflowingNavText(page);
    check(over.length === 0, `${width} px : textes du guidage dans leurs cases`, over.join(' ; '));
    const foot = await footOverlaps(page);
    check(foot.out.length === 0, `${width} px : boutons de carte hors du bandeau`, foot.out.join(' ; '));
    await noHorizontalScroll(page, `${width} px guidage ADR`);
    await page.screenshot({ path: join(SHOTS, `${width}-adr-guidage.png`) });
    check(errors.length === 0, `${width} px : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();

    // Fichier absent : jamais un silence.
    const missing = await open(browser, base, { width, height, tunnels: null, vehicle: vehicle('C'), overpass: () => fixture('overpass-aires.json') });
    await computeRoute(missing.page);
    await missing.page.waitForFunction(() => /Alerte tunnels indisponible/.test(document.querySelector('#route-notes')?.textContent ?? ''), null, { timeout: 10000 });
    const mnotes = await missing.page.$$eval('.rules-notes li', (n) => n.map((li) => li.textContent));
    check(mnotes.some((t) => /^Alerte tunnels indisponible \(données non chargées\)/.test(t)), `${width} px : fichier absent → « Alerte tunnels indisponible »`, mnotes.join(' | '));
    await missing.ctx.close();

    // Code tunnel vide : aucune alerte. Profil enregistré avant la v19 (ADR dans le véhicule) : repris dans Réglages.
    const empty = await open(browser, base, { width, height, tunnels, vehicle: vehicle(''), overpass: () => fixture('overpass-aires.json') });
    await computeRoute(empty.page);
    await empty.page.waitForTimeout(500);
    const enotes = await empty.page.$$eval('.rules-notes li', (n) => n.map((li) => li.textContent));
    check(!enotes.some((t) => /^Tunnel de Test/.test(t)) && enotes.some((t) => /^Code tunnel non renseigné/.test(t)),
      `${width} px : code vide, aucune alerte tunnel`, enotes.join(' | '));
    // Formulaire du véhicule : plus aucun champ ADR.
    await empty.page.click('#btn-vehicles');
    await empty.page.click('#vehicles-body .btn:has-text("Modifier")');
    check(await empty.page.locator('.vehicle-form [name="hazmat"], .vehicle-form [name="tunnelCode"], .vehicle-form [name="adrClass"], .vehicle-form [name="unNumber"]').count() === 0
      && /Matières dangereuses \(ADR\) : dans Réglages/.test(await empty.page.textContent('.vehicle-form')), `${width} px : profil sans champs ADR (renvoi vers Réglages)`);
    await empty.page.click('#dlg-vehicles [data-close]');
    // Réglages : section « Matières dangereuses (ADR) », reprise de l'ancien profil (classe 3, UN 1202, code vide).
    await empty.page.click('#btn-settings');
    await empty.page.locator('#adr-enabled').scrollIntoViewIfNeeded();
    const adrUi = await empty.page.evaluate(() => ({
      on: document.querySelector('#adr-enabled').checked, cls: document.querySelector('#adr-class').value,
      un: document.querySelector('#adr-un').value, code: document.querySelector('#adr-tunnel').value,
      codes: [...document.querySelectorAll('#adr-tunnel option')].map((o) => o.value),
      classes: [...document.querySelectorAll('#adr-class option')].map((o) => o.textContent),
      help: document.querySelector('#adr-tunnel-help').textContent,
    }));
    check(adrUi.on && adrUi.cls === '3' && adrUi.un === '1202' && adrUi.code === '', `${width} px : Réglages ADR repris de l'ancien profil`, JSON.stringify(adrUi).slice(0, 120));
    check(JSON.stringify(adrUi.codes) === JSON.stringify(['', 'B', 'C', 'D', 'E']) && adrUi.classes.length === 14
      && adrUi.classes.includes('3 — Liquides inflammables (gazole, essence…)') && /la classe seule ne la donne pas/.test(adrUi.help),
    `${width} px : code tunnel vide / B–E, classes en clair, aide`, adrUi.codes.join(','));
    await empty.page.fill('#adr-un', '12');
    await empty.page.locator('#adr-un').blur();
    check(/4 chiffres/.test(await empty.page.textContent('#adr-status')), `${width} px : numéro ONU mal saisi refusé`);
    await empty.page.fill('#adr-un', 'UN 1202');
    await empty.page.locator('#adr-un').blur();
    await empty.page.selectOption('#adr-tunnel', 'E');
    await noHorizontalScroll(empty.page, `${width} px Réglages ADR`);
    await empty.page.locator('#adr-enabled').scrollIntoViewIfNeeded();
    await empty.page.screenshot({ path: join(SHOTS, `${width}-adr-reglages.png`) });
    await empty.page.uncheck('#adr-enabled');
    check(!(await empty.page.isVisible('#adr-fields')), `${width} px : champs ADR masqués (case décochée)`);
    await empty.page.check('#adr-enabled');
    check(await empty.page.isVisible('#adr-tunnel'), `${width} px : champs ADR affichés (case cochée)`);
    await empty.page.click('#dlg-settings [data-close]');
    await empty.page.click('#btn-vehicles');
    check(/ADR \(code E, classe 3, UN 1202\)/.test(await empty.page.textContent('.vehicle-card.active .dims')), `${width} px : résumé du profil lu dans Réglages (code E)`);
    await empty.page.click('#dlg-vehicles [data-close]');
    await empty.page.click('#btn-route');
    await empty.page.waitForFunction(() => /code E, classe 3, UN 1202/.test(document.querySelector('.summary-notes')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
    const s2 = await empty.page.$$eval('.summary-notes li', (n) => n.map((li) => li.textContent));
    check(s2.some((t) => /matières dangereuses, code E, classe 3, UN 1202/.test(t)), `${width} px : nouveau calcul avec le code des Réglages`, s2.join(' | '));
    const stored = await empty.page.evaluate(() => JSON.parse(localStorage.getItem('gabarit.data')));
    check(stored.settings.adr?.tunnelCode === 'E' && !('hazmat' in stored.vehicles[0]), `${width} px : enregistré dans settings.adr, plus dans le profil`);
    check(empty.errors.length === 0, `${width} px : aucune erreur JavaScript (Réglages ADR)`, empty.errors.join(' | '));
    await empty.ctx.close();
  }

  // Vrai service worker : la ligne du bas de Réglages affiche VERSION de sw.js.
  const swVersion = readFileSync(join(ROOT, 'sw.js'), 'utf8').match(/const VERSION = '([^']+)';/)[1];
  const ctx = await browser.newContext({ viewport: { width: 800, height: 1280 }, serviceWorkers: 'allow', locale: 'fr-FR' });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  const page = await ctx.newPage();
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await page.click('#btn-settings');
  await page.waitForFunction(() => /^Gabarit v/.test(document.querySelector('#app-version')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
  const ver = await page.textContent('#app-version');
  check(ver === `Gabarit ${swVersion}`, `vrai service worker : « Gabarit ${swVersion} » en bas de Réglages (VERSION de sw.js)`, ver);
  await ctx.close();
}

/**
 * Phase 5c : passage de frontière. Fiches des pays traversés (France → Suisse → Italie, mercredi 21 h 50 : nuit en
 * Suisse), sources nommées, « à vérifier », « la signalisation fait foi » ; countryinfo absent ; fichier absent ;
 * guidage avec le GPS émulé comme le vrai (une position par seconde, vitesse fournie) : bandeau et une annonce
 * vers 3 km avec les seules règles confirmées, aucune saisie.
 */
async function borderCheck(browser, base) {
  const frChIt = fixture('ors-directions-fr-ch-it.json');
  const line = frChIt.features[0].geometry.coordinates;
  const now = new Date('2026-11-18T21:50:00+01:00').getTime(); // mercredi 21 h 50 à Paris
  for (const [width, height] of [[360, 760], [412, 900], [800, 1280], [1280, 800]]) {
    const { page, ctx, errors } = await open(browser, base, {
      width, height, now, voice: true, directions: () => frChIt, overpass: () => ({ elements: [] }),
    });
    await computeRoute(page);
    await page.waitForSelector('.country-card', { timeout: 10000 });
    const notes = await page.$$eval('.rules-notes li', (n) => n.map((li) => ({ cls: li.className, text: li.textContent })));
    check(notes.some((n) => /^Pays traversés : France → Suisse \(km 4, vers mercredi 21 h 5\d\) → Italie \(km 152, vers (mercredi|jeudi) \d+ h \d\d\)\./.test(n.text)),
      `${width} px : pays traversés, km et heure de chaque frontière`, notes.map((n) => n.text).slice(0, 3).join(' | '));
    const cards = await page.$$eval('.country-card', (n) => n.map((c) => ({
      name: c.querySelector('summary strong').textContent, open: c.open, text: c.textContent,
      footer: c.querySelector('.country-footer')?.textContent, links: c.querySelectorAll('a[href^="https://"]').length,
      badges: [...c.querySelectorAll('.cbadge')].map((b) => b.textContent),
      sections: [...c.querySelectorAll('h4')].map((h) => h.textContent),
    })));
    check(cards.length === 2 && cards[0].name === 'Suisse' && cards[1].name === 'Italie', `${width} px : une fiche par pays (Suisse, Italie)`, cards.map((c) => c.name).join(','));
    check(cards.every((c) => c.footer === 'La signalisation fait foi.'), `${width} px : chaque fiche finit par « la signalisation fait foi »`);
    const ch = cards[0];
    check(/PL de 44 t : autoroute 80 km\/h/.test(ch.text) && /source officielle : Ordonnance sur les règles de la circulation routière/.test(ch.text),
      `${width} px : vitesses selon le PTAC, source nationale nommée`);
    check(ch.badges.includes('En vigueur') && ch.open && /Oui : mercredi 22 h → jeudi 5 h/.test(ch.text), `${width} px : nuit suisse « en vigueur à votre passage »`, ch.badges.join(','));
    check(['Vitesses', 'Interdictions', 'Péage PL', 'ZFE et vignettes'].every((x) => ch.sections.includes(x)), `${width} px : rubriques vitesses, interdictions, péage, ZFE`, ch.sections.join(','));
    check(/RPLP/.test(ch.text) && /Vignette autoroutière : pas due pour les véhicules soumis à la RPLP/.test(ch.text), `${width} px : RPLP et vignette suisse`);
    check(/à vérifier/.test(ch.text) && ch.links >= 3, `${width} px : « à vérifier » et liens des sources`);
    check(/source officielle : Codice della strada/.test(cards[1].text) && /Décret du ministère des infrastructures/.test(cards[1].text),
      `${width} px : Italie, sources officielles nommées (vitesses, calendrier 2026)`);
    check(notes.some((n) => n.cls === 'warn' && /^Suisse, interdiction PL \(Nuit\) mercredi 22 h → jeudi 5 h pendant votre passage.*La signalisation fait foi\.$/.test(n.text)),
      `${width} px : alerte de la nuit suisse dans les notes`);
    check(/Interdiction PL Suisse/.test(await page.textContent('.route-card[aria-checked="true"]')), `${width} px : fiche d'itinéraire, interdiction PL Suisse`);
    // Phase 5e : profil de 44 t sur un trajet international → alerte avant le départ ; poids et hauteur sur la fiche.
    check(notes.some((n) => n.cls === 'warn' && /^Votre profil indique 44 t \(PTAC, pas le poids réel\) : en international, poids réel limité à 40 t sauf transport combiné.*La signalisation fait foi\.$/.test(n.text)),
      `${width} px : alerte 40 t en international`, notes.map((n) => n.text).join(' | '));
    check(/International : 40 t/.test(await page.textContent('.route-card[aria-checked="true"]')), `${width} px : fiche d'itinéraire, « International : 40 t »`);
    check(ch.sections.includes('Poids et hauteur') && /Poids total maximal : 40 t, ou 44 t en transport combiné/.test(ch.text)
      && /Votre profil indique 44 t : au-delà du maximum national \(40 t\)/.test(ch.text) && /Hauteur maximale : 4 m\./.test(ch.text)
      && /source officielle : Loi sur la circulation routière/.test(ch.text), `${width} px : Suisse, poids et hauteur avec la source`);
    check(/Poids total maximal national : 44 t pour un ensemble de 5 essieux/.test(cards[1].text), `${width} px : Italie, 44 t en national`);
    if (width === 360) {
      // Case « Transport combiné » du profil : enregistrée, l'alerte devient une information.
      await page.click('#btn-vehicles');
      await page.click('#vehicles-body .vehicle-card.active button:has-text("Modifier")');
      check(await page.isVisible('#veh-combined'), '360 px : case « Transport combiné » dans le profil');
      await noHorizontalScroll(page, '360 px profil avec la case transport combiné');
      await page.check('#veh-combined');
      await page.click('#vehicles-body button[type="submit"]');
      check(/transport combiné/.test(await page.textContent('#vehicles-body .vehicle-card.active .dims')), '360 px : profil « transport combiné »');
      await page.keyboard.press('Escape');
      await computeRoute(page);
      await page.waitForSelector('.country-card', { timeout: 10000 });
      const n2 = await page.$$eval('.rules-notes li', (n) => n.map((li) => ({ cls: li.className, text: li.textContent })));
      check(n2.some((n) => n.cls !== 'warn' && /transport combiné : en international, 44 t seulement avec un tracteur à 3 essieux/.test(n.text))
        && !n2.some((n) => /limité à 40 t sauf transport combiné/.test(n.text)), '360 px : transport combiné → information, plus d\'alerte 40 t',
        n2.map((n) => n.text).join(' | '));
      await page.click('#btn-vehicles');
      await page.click('#vehicles-body .vehicle-card.active button:has-text("Modifier")');
      await page.uncheck('#veh-combined');
      await page.click('#vehicles-body button[type="submit"]');
      await page.keyboard.press('Escape');
      await computeRoute(page);
      await page.waitForSelector('.country-card', { timeout: 10000 });
    }
    await noHorizontalScroll(page, `${width} px fiches des pays`);
    await page.locator('.country-card').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `${width}-pays.png`) });

    // Guidage, GPS émulé : frontière à 3,8 km du départ, annonce vers 3 km.
    await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
    await page.click('#btn-nav-start');
    await page.waitForSelector('#nav:not([hidden])');
    await page.waitForTimeout(1500);
    const first = await page.textContent('#nav-rule');
    check(await page.isVisible('#nav-rule') && /^Suisse dans 4 km · PL 80 km\/h · Dimanche et jours fériés · Nuit \(en vigueur\)/.test(first),
      `${width} px : bandeau de la frontière`, first);
    check(await page.locator('#nav input, #nav textarea, #nav select').count() === 0, `${width} px : aucune saisie pendant le guidage`);
    await drive(ctx, page, line, 90, 45);
    const spoken = await page.evaluate(() => window.__spoken ?? []);
    const border = spoken.filter((t) => /entrée en Suisse/.test(t));
    check(border.length === 1 && /^Dans 3 kilomètres, entrée en Suisse\. Poids lourds : 80 kilomètres heure\..*La signalisation fait foi\.$/.test(border[0])
      && !/vérifier|vignette|ZFE/i.test(border[0]), `${width} px : une annonce vers 3 km, règles confirmées seulement`, border.join(' | ') || spoken.join(' | '));
    check(!spoken.some((t) => /40 tonnes|poids réel|hauteur/i.test(t)), `${width} px : poids et hauteur jamais dits`, spoken.join(' | '));
    const over = await overflowingNavText(page);
    check(over.length === 0, `${width} px : textes du guidage dans leurs cases`, over.join(' ; '));
    const foot = await footOverlaps(page);
    check(foot.out.length === 0, `${width} px : boutons de carte hors du bandeau`, foot.out.join(' ; '));
    await noHorizontalScroll(page, `${width} px guidage frontière`);
    await page.screenshot({ path: join(SHOTS, `${width}-frontiere.png`) });
    check(errors.length === 0, `${width} px : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }

  // countryinfo absent (réponse sans l'extra) : message, jamais un silence. Fichier suisse absent : « à vérifier ».
  const noInfo = await open(browser, base, { width: 412, height: 900, now, overpass: () => ({ elements: [] }) });
  await computeRoute(noInfo.page);
  await noInfo.page.waitForSelector('.rules-notes', { timeout: 10000 });
  check(/Pays traversés indisponibles/.test(await noInfo.page.textContent('#route-notes')), 'countryinfo absent → « Pays traversés indisponibles »');
  await noInfo.ctx.close();
  const noFile = await open(browser, base, { width: 412, height: 900, now, directions: () => frChIt, countryFiles: { CH: null }, overpass: () => ({ elements: [] }) });
  await computeRoute(noFile.page);
  await noFile.page.waitForSelector('.country-card', { timeout: 10000 });
  check(/Règles PL en Suisse non chargées : à vérifier\./.test(await noFile.page.textContent('.country-card')), 'fichier data/pays/CH.json absent → « à vérifier »');
  check(noFile.errors.length === 0, 'fichier absent : aucune erreur JavaScript', noFile.errors.join(' | '));
  await noFile.ctx.close();
  // Phase 5h : München → Innsbruck (Allemagne puis Autriche), fiche Autriche « à vérifier ».
  const mi = await open(browser, base, { width: 412, height: 900, now, directions: () => fixture('ors-directions-muenchen-innsbruck.json'), overpass: () => ({ elements: [] }) });
  await computeRoute(mi.page);
  await mi.page.waitForSelector('.country-card', { timeout: 10000 });
  const cards = await mi.page.$$eval('.country-card', (d) => d.map((x) => { x.open = true; return x.textContent; }));
  const at = cards.find((t) => /Autriche/.test(t));
  check(cards.some((t) => /Allemagne/.test(t)) && at && /à vérifier/.test(at), 'München → Innsbruck : fiches Allemagne et Autriche, Autriche « à vérifier »', cards.map((t) => t.slice(0, 120)).join(' | '));
  await noHorizontalScroll(mi.page, '412 px fiche Autriche');
  check(mi.errors.length === 0, 'München → Innsbruck : aucune erreur JavaScript', mi.errors.join(' | '));
  await mi.ctx.close();
}

/**
 * Phase 5f : équipements d'hiver. Trajet de tests/fixtures/ors-directions-nav.json un mercredi de novembre 8 h, copie
 * data/hiver/ simulée (liste réelle + contours de test) : alerte dans les notes, fiche d'itinéraire, rappel B26, date
 * de la liste, profil « Remorque » (3 états), juillet (rien), copie absente, crédits de Réglages, fiche Suisse
 * (« Équipements d'hiver » toute l'année), guidage avec le GPS émulé à 360 et 1280 px : rien d'hiver dit ni affiché.
 */
async function winterCheck(browser, base) {
  const nav = fixture('ors-directions-nav.json');
  const line = nav.features[0].geometry.coordinates;
  const now = new Date('2026-11-18T08:00:00+01:00').getTime(); // mercredi 8 h
  for (const [width, height] of [[360, 760], [412, 900], [800, 1280], [1280, 800]]) {
    const { page, ctx, stats, errors } = await open(browser, base, {
      width, height, now, voice: true, directions: () => nav, overpass: () => ({ elements: [] }), winterCopy: 'fixture',
    });
    await computeRoute(page);
    await page.waitForSelector('.rules-notes', { timeout: 10000 });
    await page.waitForTimeout(500);
    const notes = await page.$$eval('.rules-notes li', (n) => n.map((li) => ({ cls: li.className, text: li.textContent })));
    const w = notes.filter((n) => /^Équipements d'hiver exigés du 1er novembre au 31 mars/.test(n.text));
    check(w.length >= 1 && w.every((n) => n.cls === 'warn' && /Liste nationale du 22\/10\/2022/.test(n.text) && /La signalisation fait foi\.Liste des communes$/.test(n.text)),
      `${width} px : alerte équipements d'hiver, date de la liste, signalisation`, notes.map((n) => n.text).join(' | '));
    check(/Avec remorque ou semi-remorque : chaînes à neige .* ; sans remorque : chaînes à bord ou pneus hiver \(3PMSF\)/.test(w[0]?.text ?? ''),
      `${width} px : remorque non précisée → les deux consignes`);
    check(notes.some((n) => /^Panneau B26 :/.test(n.text)) && notes.some((n) => /^Sanctions du défaut d'équipement d'hiver/.test(n.text)),
      `${width} px : rappel B26 et sanctions « à vérifier »`);
    check(/Équipements d'hiver/.test(await page.textContent('.route-card[aria-checked="true"]')), `${width} px : fiche d'itinéraire « Équipements d'hiver »`);
    check((stats.winter ?? []).includes('index.json') && (stats.winter ?? []).includes('4_45.json') && !(stats.winter ?? []).includes('6_45.json'),
      `${width} px : copie data/hiver/ lue (index + case du trajet seulement)`, (stats.winter ?? []).join(','));
    await noHorizontalScroll(page, `${width} px notes équipements d'hiver`);
    await page.locator('.rules-notes').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `${width}-hiver.png`) });
    if (width === 360) {
      // Profil : « Remorque » à 3 états, enregistré, consigne unique.
      await page.click('#btn-vehicles');
      await page.click('#vehicles-body .vehicle-card.active button:has-text("Modifier")');
      const opts = await page.$$eval('#veh-trailer option', (o) => o.map((x) => x.textContent));
      check(opts.join('|') === 'Non précisé|Sans remorque|Avec remorque ou semi-remorque', '360 px : « Remorque » à 3 états', opts.join('|'));
      await noHorizontalScroll(page, '360 px profil avec « Remorque »');
      await page.selectOption('#veh-trailer', 'with');
      await page.click('#vehicles-body button[type="submit"]');
      check(/avec remorque/.test(await page.textContent('#vehicles-body .vehicle-card.active .dims')), '360 px : profil « avec remorque » enregistré');
      await page.keyboard.press('Escape');
      await page.reload();
      await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
      await computeRoute(page);
      await page.waitForSelector('.rules-notes', { timeout: 10000 });
      await page.waitForTimeout(500);
      const t = await page.textContent('#route-notes');
      check(/PL avec remorque ou semi-remorque : chaînes à neige pour au moins deux roues motrices à bord, même avec des pneus hiver\./.test(t) && !/sans remorque : chaînes/.test(t),
        '360 px : après rechargement, consigne « avec remorque » seule');
      // Crédits de Réglages : liste du 22/10/2022, contours ODbL.
      await page.click('#btn-settings');
      const credit = await page.textContent('#winter-credit');
      check(/22\/10\/2022/.test(credit) && /Contours administratifs/.test(credit) && /ODbL/.test(credit), '360 px : crédits ODbL des contours et date de la liste', credit);
      await page.click('#dlg-settings [data-close]');
    }
    // Guidage, GPS émulé : rien d'hiver ni dit ni affiché.
    if (width === 360 || width === 1280) {
      await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
      await page.click('#btn-nav-start');
      await page.waitForSelector('#nav:not([hidden])');
      await drive(ctx, page, line, 50, 40);
      const spoken = await page.evaluate(() => window.__spoken ?? []);
      check(!spoken.some((x) => /hiver|chaîne|pneu/i.test(x)), `${width} px : guidage, rien d'hiver dit`, spoken.join(' | '));
      const banner = (await page.isVisible('#nav-rule')) ? await page.textContent('#nav-rule') : '';
      check(!/hiver|chaîne|pneu/i.test(banner), `${width} px : guidage, rien d'hiver dans le bandeau`, banner);
      const over = await overflowingNavText(page);
      check(over.length === 0, `${width} px : textes du guidage dans leurs cases`, over.join(' ; '));
    }
    check(errors.length === 0, `${width} px : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
  // Juillet : rien.
  const july = await open(browser, base, { width: 412, height: 900, now: new Date('2026-07-08T08:00:00+02:00').getTime(), directions: () => nav, overpass: () => ({ elements: [] }), winterCopy: 'fixture' });
  await computeRoute(july.page);
  await july.page.waitForSelector('.rules-notes', { timeout: 10000 });
  check(!/Équipements d'hiver|Panneau B26/.test(await july.page.textContent('#route-notes')), 'juillet : aucune ligne d\'hiver');
  await july.ctx.close();
  // Copie absente en novembre : « indisponibles », jamais un silence.
  const none = await open(browser, base, { width: 412, height: 900, now, directions: () => nav, overpass: () => ({ elements: [] }), winterCopy: null });
  await computeRoute(none.page);
  await none.page.waitForSelector('.rules-notes', { timeout: 10000 });
  await none.page.waitForTimeout(500);
  check(/Équipements d'hiver indisponibles \(données non chargées\)/.test(await none.page.textContent('#route-notes')), 'copie absente → « Équipements d\'hiver indisponibles »');
  check(none.errors.length === 0, 'copie absente : aucune erreur JavaScript', none.errors.join(' | '));
  await none.ctx.close();
  // Fiche Suisse en juillet : rubrique « Équipements d'hiver » affichée toute l'année.
  const ch = await open(browser, base, { width: 412, height: 900, now: new Date('2026-07-08T08:00:00+02:00').getTime(), directions: () => fixture('ors-directions-fr-ch-it.json'), overpass: () => ({ elements: [] }) });
  await computeRoute(ch.page);
  await ch.page.waitForSelector('.country-card', { timeout: 10000 });
  const cards = await ch.page.$$eval('.country-card', (n) => n.map((c) => ({ sections: [...c.querySelectorAll('h4')].map((h) => h.textContent), text: c.textContent })));
  check(cards[0].sections.includes("Équipements d'hiver") && /Chaînes à neige obligatoires.*Selon la météo \/ les panneaux, pas de période légale\./.test(cards[0].text),
    'fiche Suisse : « Équipements d\'hiver » en juillet, sans période légale');
  check(/15 novembre au 15 avril.*à vérifier/.test(cards[1].text), 'fiche Italie : période 15/11 – 15/04 « à vérifier »');
  await noHorizontalScroll(ch.page, '412 px fiches pays avec équipements d\'hiver');
  await ch.ctx.close();
}

/**
 * Phase 5g : normes Euro. Tunnel du Mont-Blanc (tests/fixtures/ors-directions-mont-blanc.json) avec un profil Euro 3
 * (alerte, fiche d'itinéraire), Euro 6 (admis), non précisé (les deux cas) ; profil enregistré puis rechargé ; Fréjus
 * Euro 4 (confirmé par l'exploitant) ; fiches Suisse (RPLP) et Allemagne (Maut, vignette verte) ; 360 / 412 / 800 /
 * 1280 px ; guidage avec le GPS émulé dans le tunnel à 360 et 1280 px : rien d'Euro dit ni affiché.
 */
async function euroCheck(browser, base) {
  const mb = fixture('ors-directions-mont-blanc.json');
  const line = mb.features[0].geometry.coordinates;
  const now = new Date('2026-11-18T10:00:00+01:00').getTime(); // mercredi 10 h
  const veh = (euroClass) => ({ id: 'v1', name: 'Semi 44 t', height: 4, width: 2.55, length: 16.5, weight: 44, axleload: 11.5, maxSpeed: 90, critair: '2', euroClass });
  const notesOf = (page) => page.$$eval('.rules-notes li', (n) => n.map((li) => ({ cls: li.className, text: li.textContent })));
  for (const [width, height] of [[360, 760], [412, 900], [800, 1280], [1280, 800]]) {
    const { page, ctx, errors } = await open(browser, base, {
      width, height, now, voice: true, vehicle: veh('3'), directions: () => mb, overpass: () => ({ elements: [] }),
    });
    await computeRoute(page);
    await page.waitForSelector('.rules-notes', { timeout: 10000 });
    const notes = await notesOf(page);
    check(notes.some((n) => n.cls === 'warn' && /^Tunnel du Mont-Blanc interdit à votre véhicule \(Euro 3\), vers km 13 : PL de marchandises de plus de 3,5 t Euro 0 à 4 interdits depuis le 1er juillet 2020 \(arrêté préfectoral n° 2020-0825 du 18 juin 2020\).*lu le 21\/11\/2026\. La signalisation fait foi\.Texte$/.test(n.text)),
      `${width} px : alerte Mont-Blanc Euro 3, source et date, lien`, notes.map((n) => n.text).join(' | '));
    check(/Mont-Blanc interdit \(Euro 3\)/.test(await page.textContent('.route-card[aria-checked="true"]')), `${width} px : fiche d'itinéraire « Mont-Blanc interdit (Euro 3) »`);
    await noHorizontalScroll(page, `${width} px notes Euro`);
    await page.locator('.rules-notes').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `${width}-euro.png`) });
    if (width === 360) {
      await page.click('#btn-vehicles');
      await page.click('#vehicles-body .vehicle-card.active button:has-text("Modifier")');
      const opts = await page.$$eval('#veh-euro option', (o) => o.map((x) => x.textContent));
      check(opts[0] === 'Non précisé' && opts.includes('EEV') && opts.length === 9, '360 px : liste « Classe Euro » (non précisé, 0 à 6, EEV)', opts.join('|'));
      await noHorizontalScroll(page, '360 px profil avec « Classe Euro »');
      await page.selectOption('#veh-euro', '6');
      await page.click('#vehicles-body button[type="submit"]');
      check(/Euro 6/.test(await page.textContent('#vehicles-body .vehicle-card.active .dims')), '360 px : profil « Euro 6 » enregistré');
      await page.keyboard.press('Escape');
      await page.reload();
      await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
      await computeRoute(page);
      await page.waitForSelector('.rules-notes', { timeout: 10000 });
      const n6 = await notesOf(page);
      check(n6.some((n) => n.cls !== 'warn' && /^Tunnel du Mont-Blanc, vers km 13 : votre classe \(Euro 6\) est admise/.test(n.text)) && !n6.some((n) => /interdit à votre véhicule/.test(n.text)),
        '360 px : après rechargement, Euro 6 admis', n6.map((n) => n.text).join(' | '));
      check(!/Mont-Blanc/.test(await page.textContent('.route-card[aria-checked="true"]')), '360 px : Euro 6, rien sur la fiche d\'itinéraire');
      await page.click('#btn-vehicles');
      await page.click('#vehicles-body .vehicle-card.active button:has-text("Modifier")');
      await page.selectOption('#veh-euro', '');
      await page.click('#vehicles-body button[type="submit"]');
      await page.keyboard.press('Escape');
      await computeRoute(page);
      await page.waitForSelector('.rules-notes', { timeout: 10000 });
      const n0 = await notesOf(page);
      check(n0.some((n) => n.cls === 'warn' && /Classe Euro non précisée dans le profil : vérifiez-la\./.test(n.text))
        && n0.some((n) => /^Tunnel du Mont-Blanc : Euro 5, EEV et Euro 6 admis/.test(n.text)), '360 px : non précisé, les deux cas affichés', n0.map((n) => n.text).join(' | '));
      check(/Mont-Blanc : Euro 0 à 4 interdits, classe Euro \?/.test(await page.textContent('.route-card[aria-checked="true"]')), '360 px : fiche « classe Euro ? »');
    }
    if (width === 360 || width === 1280) {
      // Guidage, GPS émulé : départ à l'entrée du tunnel, traversée en partie ; rien d'Euro dit ni affiché.
      const entry = line.findIndex((c) => c[0] >= 6.86);
      await setGeo(page, { lon: line[entry][0], lat: line[entry][1], accuracy: 5, speed: 0 });
      await page.click('#btn-nav-start');
      await page.waitForSelector('#nav:not([hidden])');
      await drive(ctx, page, line.slice(entry), 70, 25);
      const remaining = await page.textContent('#nav');
      check(/Tunnel du Mont-Blanc|SS 26/.test(remaining), `${width} px : guidage dans le tunnel (consigne du tunnel ou de la sortie)`, remaining.replace(/\s+/g, " ").trim().slice(0, 200));
      const spoken = await page.evaluate(() => window.__spoken ?? []);
      check(!spoken.some((x) => /euro|Mont-Blanc interdit/i.test(x.replace(/europ/gi, ''))), `${width} px : guidage, rien d'Euro dit`, spoken.join(' | '));
      const navText = await page.textContent('#nav');
      check(!/Euro [0-6]|classe Euro/.test(navText), `${width} px : guidage, rien d'Euro affiché`);
      const over = await overflowingNavText(page);
      check(over.length === 0, `${width} px : textes du guidage dans leurs cases`, over.join(' ; '));
    }
    check(errors.length === 0, `${width} px : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
  // Fréjus, Euro 4 : confirmé par l'exploitant (nom, date), sur la fiche d'itinéraire.
  const fr = await open(browser, base, { width: 412, height: 900, now, vehicle: veh('4'), directions: () => fixture('ors-directions-frejus.json'), overpass: () => ({ elements: [] }) });
  await computeRoute(fr.page);
  await fr.page.waitForSelector('.rules-notes', { timeout: 10000 });
  const fn = await notesOf(fr.page);
  check(fn.some((n) => n.cls === 'warn' && /^Tunnel du Fréjus interdit à votre véhicule \(Euro 4\).*Confirmé par l'exploitant : SFTRF .*lu le 21\/11\/2026 ; arrêté préfectoral non retrouvé\. La signalisation fait foi\./.test(n.text)),
    'Fréjus Euro 4 : confirmé par l\'exploitant, arrêté non retrouvé', fn.map((n) => n.text).join(' | '));
  check(/Fréjus interdit \(Euro 4, exploitant\)/.test(await fr.page.textContent('.route-card[aria-checked="true"]')), 'Fréjus Euro 4 : ligne sur la fiche d\'itinéraire');
  check(fr.errors.length === 0, 'Fréjus : aucune erreur JavaScript', fr.errors.join(' | '));
  await fr.ctx.close();
  // Fiches Suisse (RPLP) et Allemagne (Maut, vignette verte) : rubrique « Normes Euro », catégorie de la classe.
  const frChIt = fixture('ors-directions-fr-ch-it.json');
  const asDe = JSON.parse(JSON.stringify(frChIt));
  asDe.features[0].properties.extras.countryinfo.values = asDe.features[0].properties.extras.countryinfo.values.map(([a, b, v]) => [a, b, v === 193 ? 74 : v]);
  asDe.features[0].properties.extras.countryinfo.summary = asDe.features[0].properties.extras.countryinfo.summary.map((x) => ({ ...x, value: x.value === 193 ? 74 : x.value }));
  for (const [label, json, re] of [
    ['Suisse', frChIt, /Normes Euro.*RPLP selon la classe Euro.*Votre profil \(Euro 3\) : catégorie de redevance 1 \(3,26 centimes par tonne et par km\)\..*source officielle : Ordonnance relative à une redevance sur le trafic des poids lourds/],
    ['Allemagne', asDe, /Normes Euro.*Votre profil \(Euro 3\) : catégorie D\..*Votre profil \(Euro 3\) : groupe 3, pas de vignette verte\..*Euro VI.*à vérifier/],
  ]) {
    for (const [width, height] of [[360, 760], [1280, 800]]) {
      const c = await open(browser, base, { width, height, now, vehicle: veh('3'), directions: () => json, overpass: () => ({ elements: [] }) });
      await computeRoute(c.page);
      await c.page.waitForSelector('.country-card', { timeout: 10000 });
      const text = await c.page.$eval('.country-card', (d) => { d.open = true; return d.textContent; });
      const sections = await c.page.$$eval('.country-card:first-child h4', (h) => h.map((x) => x.textContent));
      check(sections.includes('Normes Euro') && re.test(text), `${width} px : fiche ${label}, rubrique « Normes Euro »`, text.slice(0, 300));
      await noHorizontalScroll(c.page, `${width} px fiche ${label} Normes Euro`);
      if (width === 360) await c.page.screenshot({ path: join(SHOTS, `${width}-euro-${label}.png`) });
      check(c.errors.length === 0, `${width} px fiche ${label} : aucune erreur JavaScript`, c.errors.join(' | '));
      await c.ctx.close();
    }
  }
}

/**
 * Phase 5h : taxes PL régionales. Mulhouse → Strasbourg par l'A36 et l'A35 (tests/fixtures/ors-directions-alsace.json,
 * fin sur la M35 de l'Eurométropole, non taxée) et Metz → Nancy par l'A31 : R-Pass et écocontribution du Grand Est
 * « prévue à partir du … » (information, jamais sur la fiche d'itinéraire), taux R-Pass de la classe du profil
 * (dépliant officiel, aucun total), un mercredi de novembre 2026 puis en janvier 2027, profil Euro 6 puis classe non
 * précisée, fichier absent, 360 / 412 / 800 / 1280 px ; guidage avec le GPS émulé : rien de dit ni affiché ; fiche
 * Belgique « Changements au 1er janvier 2027 ».
 */
async function tollsCheck(browser, base) {
  const als = fixture('ors-directions-alsace.json');
  const line = als.features[0].geometry.coordinates;
  const nov = new Date('2026-11-25T10:00:00+01:00').getTime(); // mercredi 10 h
  const jan = new Date('2027-01-06T10:00:00+01:00').getTime(); // mercredi 10 h
  const veh = (euroClass) => ({ id: 'v1', name: 'Semi 44 t', height: 4, width: 2.55, length: 16.5, weight: 44, axleload: 11.5, maxSpeed: 90, critair: '2', euroClass });
  const notesOf = (page) => page.$$eval('.rules-notes li', (n) => n.map((li) => ({ cls: li.className, text: li.textContent })));
  const rpass = (n) => n.find((x) => /R-Pass/.test(x.text));
  for (const [width, height] of [[360, 760], [412, 900], [800, 1280], [1280, 800]]) {
    const { page, ctx, errors } = await open(browser, base, {
      width, height, now: nov, voice: true, vehicle: veh('6'), directions: () => als, overpass: () => ({ elements: [] }),
    });
    await computeRoute(page);
    await page.waitForSelector('.rules-notes', { timeout: 10000 });
    const notes = await notesOf(page);
    const r = rpass(notes);
    check(r && r.cls !== 'warn' && /^R-Pass \(taxe PL de la Collectivité européenne d'Alsace\) prévue à partir du 1er janvier 2027, au moins de km 0 à km 9\d \(A36, A35 ; repérage par les noms d'étape, carte OpenStreetMap du réseau non chargée\)\..*Recours en cours devant le tribunal administratif de Strasbourg \(effet suspensif non établi\)\. Tarif annoncé, poids du profil 44 t, Euro VI \(classe D \(PTRA de plus de 32 t\)\) : 14,6 centimes par km .*Aucun total calculé pour le trajet\..*lue le 21\/11\/2026\. La signalisation fait foi\.Site officiel$/.test(r.text) && !/€/.test(r.text),
      `${width} px : R-Pass « prévue à partir du 1er janvier 2027 », information, taux de la classe, lien`, notes.map((n) => n.text).join(' | '));
    check(!/R-Pass|Taxe|taxe/.test(await page.textContent('.route-card[aria-checked="true"]')), `${width} px : rien sur la fiche d'itinéraire`);
    await noHorizontalScroll(page, `${width} px notes taxes PL`);
    await page.locator('.rules-notes').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `${width}-tolls.png`) });
    if (width === 360 || width === 1280) {
      // Guidage, GPS émulé sur l'A35 : rien de la taxe dit ni affiché.
      await setGeo(page, { lon: line[3][0], lat: line[3][1], accuracy: 5, speed: 0 });
      await page.click('#btn-nav-start');
      await page.waitForSelector('#nav:not([hidden])');
      await drive(ctx, page, line.slice(3, 12), 80, 20);
      const spoken = await page.evaluate(() => window.__spoken ?? []);
      check(!spoken.some((x) => /taxe|R-Pass|écocontribution|ECPL/i.test(x)), `${width} px : guidage, rien de la taxe dit`, spoken.join(' | '));
      check(!/taxe|R-Pass|écocontribution|ECPL/i.test(await page.textContent('#nav')), `${width} px : guidage, rien de la taxe affiché`);
      const over = await overflowingNavText(page);
      check(over.length === 0, `${width} px : textes du guidage dans leurs cases`, over.join(' ; '));
    }
    check(errors.length === 0, `${width} px : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
  // Janvier 2027 : « prévue depuis », information ; classe Euro non précisée : fourchette de la classe D.
  for (const [label, now, euro, re] of [
    ['janvier 2027', jan, '6', /prévue depuis le 1er janvier 2027.*: 14,6 centimes par km/],
    ['classe non précisée', nov, '', /prévue à partir du 1er janvier 2027.*classe Euro non précisée : de 13,8 à 34,5 centimes par km/],
  ]) {
    const c = await open(browser, base, { width: 412, height: 900, now, vehicle: veh(euro), directions: () => als, overpass: () => ({ elements: [] }) });
    await computeRoute(c.page);
    await c.page.waitForSelector('.rules-notes', { timeout: 10000 });
    const r = rpass(await notesOf(c.page));
    check(r && r.cls !== 'warn' && re.test(r.text), `${label} : R-Pass en information`, r?.text);
    check(!/R-Pass/.test(await c.page.textContent('.route-card[aria-checked="true"]')), `${label} : rien sur la fiche d'itinéraire`);
    check(c.errors.length === 0, `${label} : aucune erreur JavaScript`, c.errors.join(' | '));
    await c.ctx.close();
  }
  // Phase 5h bis : diagnostic du trajet (replié, texte à copier), 360 et 1280 px.
  for (const [width, height] of [[360, 760], [1280, 800]]) {
    const dg = await open(browser, base, { width, height, now: nov, vehicle: veh('6'), directions: () => als, overpass: () => ({ elements: [] }) });
    await computeRoute(dg.page);
    await dg.page.waitForSelector('.route-diag', { timeout: 10000 });
    check(!(await dg.page.$eval('.route-diag', (d) => d.open)), `${width} px : diagnostic replié par défaut`);
    await dg.page.click('.route-diag summary');
    await dg.page.click('.btn-diag-copy');
    await dg.page.waitForTimeout(300);
    const txt = await dg.page.textContent('.route-diag-text');
    check(/— diagnostic du trajet/.test(txt) && /Étapes ORS/.test(txt) && /\| A 35, E 25 \| A35, E25 \|/.test(txt) && /R-Pass : km 0,0–9\d,\d \(A36, A35\)/.test(txt) && /\| M 35, E 25 \| M35, E25 \|/.test(txt) && /^Gabarit, version inconnue — diagnostic du trajet/.test(txt),
      `${width} px : diagnostic (étapes, références, R-Pass, ZFE)`, JSON.stringify(txt.slice(0, 1500)));
    check(/Copié\.|Texte sélectionné/.test(await dg.page.textContent('.route-diag-status')), `${width} px : bouton Copier`);
    await noHorizontalScroll(dg.page, `${width} px diagnostic ouvert`);
    if (width === 360) await dg.page.screenshot({ path: join(SHOTS, `${width}-diag.png`) });
    check(dg.errors.length === 0, `${width} px diagnostic : aucune erreur JavaScript`, dg.errors.join(' | '));
    await dg.ctx.close();
  }
  // Phase 5h ter : vrai service worker, Réglages jamais ouverts : le diagnostic commence par VERSION de sw.js
  // (constat tablette v30 : « Gabarit, version inconnue »).
  {
    const swVersion = readFileSync(join(ROOT, 'sw.js'), 'utf8').match(/const VERSION = '([^']+)';/)[1];
    const sv = await open(browser, base, { width: 412, height: 900, now: nov, vehicle: veh('6'), directions: () => als, overpass: () => ({ elements: [] }), sw: true });
    await computeRoute(sv.page);
    await sv.page.waitForSelector('.route-diag', { timeout: 10000 });
    await sv.page.click('.route-diag summary');
    await sv.page.click('.btn-diag-copy');
    await sv.page.waitForTimeout(500);
    const txt = await sv.page.textContent('.route-diag-text');
    check(txt.startsWith(`Gabarit ${swVersion} — diagnostic du trajet`), `vrai service worker : diagnostic « Gabarit ${swVersion} » sans ouvrir Réglages`, txt.slice(0, 80));
    await sv.page.click('#btn-settings');
    await sv.page.waitForFunction(() => /^Gabarit v/.test(document.querySelector('#app-version')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
    check(await sv.page.textContent('#app-version') === `Gabarit ${swVersion}`, 'vrai service worker : même version en bas de Réglages');
    check(sv.errors.length === 0, 'vrai service worker : aucune erreur JavaScript', sv.errors.join(' | '));
    await sv.ctx.close();
  }
  // Phase 5h bis : échec d'ORS (404, code 2009) : message clair et, en petit, code et message du service.
  const er = await open(browser, base, { width: 360, height: 760, now: nov, vehicle: veh('6'),
    directions: () => ({ __status: 404, error: { code: 2009, message: 'Route could not be found - Unable to find a route between points 1 and 2.' } }) });
  await er.page.fill('#to-input', 'Lyon');
  await er.page.waitForSelector('#to-list li', { timeout: 5000 });
  await er.page.dispatchEvent('#to-list li', 'pointerdown');
  await er.page.click('#btn-route');
  await er.page.waitForSelector('#message:not([hidden]) .message-detail', { timeout: 10000 });
  const msg = await er.page.textContent('#message');
  check(/^Aucun itinéraire autorisé pour ce gabarit\..*Réponse du service d'itinéraire : HTTP 404, code 2009 — « Route could not be found/.test(msg), '360 px : échec 2009, message et code du service', msg);
  await noHorizontalScroll(er.page, '360 px message d\'erreur');
  check(er.errors.length === 0, 'échec 2009 : aucune erreur JavaScript', er.errors.join(' | '));
  await er.ctx.close();
  // Phase 5h ter : étapes sans nom ni référence (diagnostics v30) + copie OSM du réseau : R-Pass trouvé sur l'A35
  // par la géométrie, « de km X à km Y », méthode et attributions, information seulement ; diagnostic : méthode et
  // points tous les 10 km sur l'étape sans nom.
  const blind = JSON.parse(JSON.stringify(als));
  for (const seg of blind.features[0].properties.segments) for (const st of seg.steps) st.name = '-';
  for (const [width, height] of [[360, 760], [1280, 800]]) {
    const g = await open(browser, base, { width, height, now: nov, vehicle: veh('6'), directions: () => blind, overpass: () => ({ elements: [] }), tollsNetwork: 'fixture' });
    await computeRoute(g.page);
    await g.page.waitForSelector('.rules-notes', { timeout: 10000 });
    const r = rpass(await notesOf(g.page));
    check(r && r.cls !== 'warn' && /prévue à partir du 1er janvier 2027, de km 0 à km [89]\d \(A3[56], A3[56] ; repérage sur la carte OpenStreetMap du 01\/12\/2026 \(ODbL\) et les contours IGN Admin Express \(Licence Ouverte\), limites exactes à vérifier\)\..*La signalisation fait foi\./.test(r.text) && !/au moins/.test(r.text),
      `${width} px : étapes sans nom, R-Pass repéré par la géométrie (information)`, r?.text);
    await g.page.click('.route-diag summary');
    await g.page.click('.btn-diag-copy');
    await g.page.waitForTimeout(300);
    const txt = await g.page.textContent('.route-diag-text');
    check(/Méthode taxes PL : R-Pass : géométrie OSM \(copie du 01\/12\/2026\)/.test(txt) && /R-Pass : km 0,0–[89]\d,\d .*— géométrie OSM/.test(txt) && /\n {4}point km 14,5 : 4\d\.\d{3}, 7\.\d{3}\n/.test(txt),
      `${width} px : diagnostic, méthode et points tous les 10 km`, JSON.stringify(txt.slice(0, 1500)));
    await noHorizontalScroll(g.page, `${width} px R-Pass par la géométrie`);
    if (width === 360) {
      await g.page.locator('.rules-notes').first().scrollIntoViewIfNeeded();
      await g.page.screenshot({ path: join(SHOTS, `${width}-tolls-geo.png`) });
    }
    check(g.errors.length === 0, `${width} px géométrie : aucune erreur JavaScript`, g.errors.join(' | '));
    await g.ctx.close();
  }
  // A36 et D 83 de Belfort (Besançon → Belfort, faux positif v28) : hors du réseau R-Pass, aucune ligne.
  const bb = await open(browser, base, { width: 412, height: 900, now: nov, vehicle: veh('6'), directions: () => fixture('ors-directions-besancon-belfort.json'), overpass: () => ({ elements: [] }) });
  await computeRoute(bb.page);
  await bb.page.waitForSelector('.rules-notes', { timeout: 10000 });
  const bn = await notesOf(bb.page);
  check(!rpass(bn) && !bn.some((n) => /Taxe possible|Écocontribution/.test(n.text)), 'Besançon → Belfort (A36, puis D 83 dans Belfort) : aucune ligne R-Pass', bn.map((n) => n.text).join(' | '));
  await bb.ctx.close();
  // Grand Est : A31, 2 avril 2027, réseau officiel, aucun montant ; fichier absent.
  const ge = await open(browser, base, { width: 412, height: 900, now: nov, vehicle: veh('6'), directions: () => fixture('ors-directions-metz-nancy.json'), overpass: () => ({ elements: [] }) });
  await computeRoute(ge.page);
  await ge.page.waitForSelector('.rules-notes', { timeout: 10000 });
  const gn = await notesOf(ge.page);
  check(gn.some((n) => n.cls !== 'warn' && /^Écocontribution poids lourds \(ECPL\) de la Région Grand Est prévue à partir du 2 avril 2027, au moins de km 0 à km \d+ \(A31 ; repérage par les noms d'étape, carte OpenStreetMap du réseau non chargée\)\..*Aucun montant calculé\./.test(n.text) && !/centimes|€/.test(n.text)) && !rpass(gn),
    'Grand Est : écocontribution sur l\'A31, réseau officiel, aucun montant, pas de R-Pass', gn.map((n) => n.text).join(' | '));
  await ge.ctx.close();
  const ab = await open(browser, base, { width: 412, height: 900, now: nov, vehicle: veh('6'), directions: () => als, overpass: () => ({ elements: [] }), tollsFile: null });
  await computeRoute(ab.page);
  await ab.page.waitForSelector('.rules-notes', { timeout: 10000 });
  const an = await notesOf(ab.page);
  check(an.some((n) => /^Taxes PL régionales indisponibles \(données non chargées\)/.test(n.text)), 'fichier absent : « Taxes PL régionales indisponibles »', an.map((n) => n.text).join(' | '));
  check(ab.errors.length === 0, 'fichier absent : aucune erreur JavaScript', ab.errors.join(' | '));
  await ab.ctx.close();
  // Fiche Belgique (Saint-Julien → … relu comme FR → BE) : changements Viapass au 1er janvier 2027, source nommée.
  const be = JSON.parse(JSON.stringify(fixture('ors-directions-fr-ch-it.json')));
  const ci = be.features[0].properties.extras.countryinfo;
  ci.values = ci.values.map(([a, b, v]) => [a, b, v === 70 ? 70 : 17]);
  ci.summary = [{ value: 70, distance: 3803.5, amount: 2 }, { value: 17, distance: 165515.9, amount: 98 }];
  const bp = await open(browser, base, { width: 360, height: 760, now: nov, vehicle: veh('6'), directions: () => be, overpass: () => ({ elements: [] }) });
  await computeRoute(bp.page);
  await bp.page.waitForSelector('.country-card', { timeout: 10000 });
  const bt = await bp.page.$eval('.country-card', (d) => { d.open = true; return d.textContent; });
  check(/Belgique/.test(bt) && /Changements au 1er janvier 2027 : nouveaux tarifs.*aucune route ajoutée.*Viapass, Prélèvement kilométrique : les modifications prévues à partir du 1er janvier 2027/.test(bt),
    '360 px : fiche Belgique, changements Viapass au 1er janvier 2027 avec la source', bt.slice(0, 400));
  await noHorizontalScroll(bp.page, '360 px fiche Belgique');
  check(bp.errors.length === 0, 'fiche Belgique : aucune erreur JavaScript', bp.errors.join(' | '));
  await bp.ctx.close();
}

/**
 * Phase 5d : accès. Trajet de 31 km (tests/fixtures/ors-directions-access.json) un mercredi à 8 h : desserte locale
 * traversée vers km 16 (extra roadaccessrestrictions), Rue des Écoles interdite aux PL de 7 h à 19 h, condition non
 * lue, « Éviter la desserte locale » (une requête ORS), guidage avec le GPS émulé (bandeau, une annonce vers 3 km),
 * copie absente.
 */
async function accessCheck(browser, base) {
  const acc = fixture('ors-directions-access.json');
  const line = acc.features[0].geometry.coordinates;
  const now = new Date('2026-11-18T08:00:00+01:00').getTime(); // mercredi 8 h à Paris
  const bodies = [];
  const directions = (body) => {
    bodies.push(body);
    if (!body.options?.avoid_polygons) return acc;
    const alt = JSON.parse(JSON.stringify(acc));
    alt.features[0].properties.extras.roadaccessrestrictions.values = alt.features[0].properties.extras.roadaccessrestrictions.values
      .map((v) => (v[0] === 20 ? [20, 21, 0] : v));
    return alt;
  };
  for (const [width, height] of [[360, 760], [412, 900], [800, 1280], [1280, 800]]) {
    bodies.length = 0;
    const { page, ctx, errors, stats } = await open(browser, base, {
      width, height, now, voice: true, directions, overpass: () => ({ elements: [] }),
    });
    await computeRoute(page);
    await page.waitForFunction(() => /Rue des Écoles/.test(document.querySelector('#route-notes')?.textContent ?? ''), null, { timeout: 10000 });
    check(bodies.every((b) => b.extra_info?.includes('roadaccessrestrictions')), `${width} px : roadaccessrestrictions dans chaque requête ORS (${bodies.length})`);
    const notes = await page.$$eval('.rules-notes li', (n) => n.map((li) => ({ cls: li.className, text: li.textContent })));
    check(notes.some((n) => n.cls === 'warn' && n.text === 'Route réservée à la desserte locale vers km 16 (D 306) : vous la traversez. La signalisation fait foi.'),
      `${width} px : desserte locale traversée vers km 16`, notes.map((n) => n.text).join(' | '));
    check(notes.some((n) => n.cls === 'warn' && /^Rue des Écoles interdite aux PL .*7 h–19 h : vous y seriez vers km 8 \(vers 8 h 06\), en vigueur à votre passage\. La signalisation fait foi\.$/.test(n.text)),
      `${width} px : voie interdite à l'heure de passage`);
    check(notes.some((n) => n.cls === 'info' && /^Avenue du Port interdite aux PL tous les jours 22 h–6 h : .*pas en vigueur à votre passage\. La signalisation fait foi\.$/.test(n.text)),
      `${width} px : voie autorisée à l'heure de passage (22 h → 6 h)`);
    check(notes.some((n) => n.text === '1 voie avec conditions non lues, à vérifier.') && !notes.some((n) => /Route des Crues|Rue Parallèle|Pont de la Gare|Autre Chaussée/.test(n.text)),
      `${width} px : condition non lue sur une seule ligne, route parallèle / pont / autre chaussée absents`);
    check(notes.some((n) => /près du départ : acceptée/.test(n.text)) && notes.some((n) => /près de l'arrivée : acceptée/.test(n.text)),
      `${width} px : desserte près du départ et de l'arrivée acceptée`);
    check(/Desserte locale km 16/.test(await page.textContent('.route-card[aria-checked="true"]')), `${width} px : fiche d'itinéraire, desserte locale`);
    check(/R411-8/.test(await page.textContent('.rules-source')), `${width} px : source, pouvoir de police R411-8`);
    check((stats.access ?? []).includes('index.json') && (stats.access ?? []).includes('4_45.json') && stats.overpass.every((h) => !/acces/.test(h)),
      `${width} px : copie data/acces-osm/ lue (index + case du trajet)`, (stats.access ?? []).join(','));
    await noHorizontalScroll(page, `${width} px notes d'accès`);
    await page.locator('.btn-avoid-local').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `${width}-acces.png`) });
    // « Éviter la desserte locale » : une seule requête ORS, avec avoid_polygons.
    const before = stats.directions;
    await page.click('.btn-avoid-local');
    await page.waitForFunction(() => /Sans desserte/.test(document.querySelector('.route-card[aria-checked="true"]')?.textContent ?? ''), null, { timeout: 10000 });
    check(stats.directions - before === 1 && bodies.at(-1).options?.avoid_polygons?.type === 'MultiPolygon', `${width} px : « Éviter » = une requête ORS avec avoid_polygons`, `${stats.directions - before}`);
    const after = await page.$$eval('.rules-notes li', (n) => n.map((li) => li.textContent));
    check(!after.some((t) => /vous la traversez/.test(t)) && !(await page.isVisible('.btn-avoid-local')), `${width} px : « Sans desserte » ne traverse plus la desserte`);
    await noHorizontalScroll(page, `${width} px après « Éviter »`);

    if (width === 360 || width === 1280) {
      // Guidage, GPS émulé depuis le km 3,1 : bandeau sous 10 km, annonce une fois vers 3 km (Rue des Écoles, km 8).
      await page.click('.route-card >> nth=0');
      await page.waitForTimeout(500);
      await setGeo(page, { lon: line[4][0], lat: line[4][1], accuracy: 5, speed: 0 });
      await page.click('#btn-nav-start');
      await page.waitForSelector('#nav:not([hidden])');
      await page.waitForTimeout(1500);
      const first = await page.textContent('#nav-rule');
      check(await page.isVisible('#nav-rule') && /Rue des Écoles dans [\d,]+ km : interdite à votre passage · la signalisation fait foi/.test(first),
        `${width} px : bandeau de la voie interdite à l'heure de passage (sous 10 km)`, first);
      check(await page.locator('#nav input, #nav textarea, #nav select').count() === 0, `${width} px : aucune saisie pendant le guidage`);
      await drive(ctx, page, line.slice(4), 90, 85);
      const spoken = await page.evaluate(() => window.__spoken ?? []);
      const ann = spoken.filter((t) => /interdite aux poids lourds à cette heure/.test(t));
      check(ann.length === 1 && ann[0] === 'Attention, dans 3 kilomètres, rue des écoles interdite aux poids lourds à cette heure. Suivez la signalisation.',
        `${width} px : une annonce vers 3 km`, ann.join(' | ') || spoken.join(' | '));
      const rule = await page.textContent('#nav-rule');
      check(/Rue des Écoles dans [\d,]+ (km|m) : interdite à votre passage · la signalisation fait foi/.test(rule), `${width} px : bandeau « interdite à votre passage »`, rule);
      const over = await overflowingNavText(page);
      check(over.length === 0, `${width} px : textes du guidage dans leurs cases`, over.join(' ; '));
      const foot = await footOverlaps(page);
      check(foot.out.length === 0, `${width} px : boutons de carte hors du bandeau`, foot.out.join(' ; '));
      await noHorizontalScroll(page, `${width} px guidage accès`);
      await page.screenshot({ path: join(SHOTS, `${width}-acces-guidage.png`) });
    }
    check(errors.length === 0, `${width} px : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }

  // Copie absente : message, jamais un silence ; aucune alerte horaire.
  const none = await open(browser, base, { width: 412, height: 900, now, directions: () => acc, accessCopy: null, overpass: () => ({ elements: [] }) });
  await computeRoute(none.page);
  await none.page.waitForFunction(() => /Restrictions horaires indisponibles/.test(document.querySelector('#route-notes')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  const text = await none.page.textContent('#route-notes');
  check(/Restrictions horaires indisponibles \(données non chargées\)\./.test(text) && !/Rue des Écoles/.test(text), 'copie absente → « Restrictions horaires indisponibles (données non chargées) »');
  check(/vous la traversez/.test(text), 'copie absente : desserte locale (ORS) toujours signalée');
  check(none.errors.length === 0, 'copie absente : aucune erreur JavaScript', none.errors.join(' | '));
  await none.ctx.close();
}

/**
 * Phase 12a : ponts sans hauteur connue (itinéraire synthétique sous le viaduc de Colombier). Fiche et repères à
 * l'arrêt, jour et nuit, portrait et paysage ; rien en guidage ni à voix haute ; réglage désactivé → rien.
 */
async function bridgesCheck(browser, base) {
  const col = fixture('ors-directions-colombier.json');
  const line = col.features[0].geometry.coordinates;
  for (const [width, height, theme] of [[412, 900, 'day'], [900, 412, 'day'], [412, 900, 'night'], [360, 760, 'night']]) {
    const tag = `${width}×${height} ${theme}`;
    const { page, ctx, errors, stats } = await open(browser, base, {
      width, height, theme, voice: true, directions: () => col, overpass: () => ({ elements: [] }), bridgesCopy: 'fixture',
    });
    await computeRoute(page);
    await page.waitForFunction((t) => (document.querySelector('#route-notes')?.textContent ?? '').includes(t), BRIDGE.TEXT, { timeout: 10000 }).catch(() => {});
    const notes = await page.$$eval('.rules-notes li', (n) => n.map((li) => ({ cls: li.className, text: li.textContent })));
    const lines = notes.filter((n) => n.text.startsWith(BRIDGE.TEXT));
    check(lines.length === 1 && lines[0].cls === 'warn' && /Viaduc de Colombier, pont ferroviaire ; priorité haute\)$/.test(lines[0].text),
      `${tag} : viaduc de Colombier signalé (priorité haute)`, notes.map((n) => n.text).join(' | '));
    check(notes.some((n) => /3,5 m dans OpenStreetMap/.test(n.text)), `${tag} : pont bas portant sa hauteur signalé`);
    check(!notes.some((n) => /D 9/.test(n.text)), `${tag} : pont au-dessus d'un passage à hauteur connue ignoré`);
    check(/pont.? à vérifier/.test(await page.textContent('.route-card[aria-checked="true"]')), `${tag} : résumé de la fiche`);
    check(/Autoroute et nationale : \d+ %/.test(await page.textContent('.route-card[aria-checked="true"]')), `${tag} : part A/N sur la fiche`);
    const markers = await page.locator('.bridge-marker').count();
    check(markers === 2, `${tag} : 2 repères de pont sur la carte à l'arrêt`, String(markers));
    check((stats.bridges ?? []).includes('index.json') && (stats.bridges ?? []).includes('6_47.json'), `${tag} : copie data/ponts-osm/ lue`, (stats.bridges ?? []).join(','));
    // Diagnostic du trajet : ligne technique.
    await page.locator('.route-diag summary').click();
    await page.waitForFunction(() => /Ponts sans hauteur : /.test(document.querySelector('.route-diag-text')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
    const diag = await page.textContent('.route-diag-text');
    check(/Ponts sans hauteur : 2 \(haute 2, moyenne 0, autoroutes ignorées 1\)/.test(diag), `${tag} : ligne technique des ponts`, (diag.match(/Ponts sans hauteur[^\n]*/) ?? [''])[0]);
    // Repère touché : texte en message, jamais dit.
    await page.locator('.bridge-marker.high').first().click({ force: true });
    await page.waitForTimeout(300);
    // Phase 12b : le repère ouvre le panneau du pont (texte, aide, « Éviter ce passage »).
    check(await page.isVisible('#bridge-panel') && /à vérifier\. La signalisation fait foi\./.test(await page.textContent('#bridge-panel-text')),
      `${tag} : repère touché → texte du pont`);
    await page.click('#btn-bridge-close');
    await noHorizontalScroll(page, `${tag} ponts`);
    const notesNode = page.locator('.rules-notes').first();
    await notesNode.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `${width}x${height}-${theme}-ponts.png`) });
    if (width === 412 && theme === 'day') {
      await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
      await page.click('#btn-nav-start');
      await page.waitForSelector('#nav:not([hidden])');
      await page.waitForTimeout(1200);
      check(await page.locator('.bridge-marker').count() === 0, `${tag} : aucun repère de pont pendant le guidage`);
      const navText = await page.textContent('#nav');
      check(!/pont/i.test(navText), `${tag} : rien sur les ponts dans l'écran de guidage`);
      await drive(ctx, page, line, 50, 85);
      const spoken = await page.evaluate(() => window.__spoken ?? []);
      check(!spoken.some((t) => /pont/i.test(t)), `${tag} : aucun pont dit à voix haute`, spoken.join(' | '));
    }
    check(errors.length === 0, `${tag} : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
  // Réglage désactivé : rien sur la fiche ni sur la carte.
  const off = await open(browser, base, { width: 412, height: 900, directions: () => col, overpass: () => ({ elements: [] }), bridgesCopy: 'fixture', settings: { bridgeWarnings: false } });
  await computeRoute(off.page);
  await off.page.waitForTimeout(800);
  check(!(await off.page.textContent('#route-notes')).includes(BRIDGE.TEXT) && await off.page.locator('.bridge-marker').count() === 0, 'réglage désactivé : aucun pont signalé');
  check(await off.page.isChecked('#bridge-warnings') === false, 'réglage désactivé : case décochée');
  await off.ctx.close();
  // Copie absente : message, jamais un silence.
  const none = await open(browser, base, { width: 412, height: 900, directions: () => col, overpass: () => ({ elements: [] }) });
  await computeRoute(none.page);
  await none.page.waitForTimeout(800);
  check(/Ponts sans hauteur : données non chargées/.test(await none.page.textContent('#route-notes')), 'copie absente → « données non chargées »');
  await none.ctx.close();
}

/**
 * v45 : repère camion (vu de dessus, dessin maison), camion par défaut. Guidage avec le GPS émulé, portrait et
 * paysage, jour, nuit et satellite : repère `data-icon="truck"`, 60 px comme la flèche, tourné au cap, centré au
 * même point que la flèche ; Réglages › Affichage « Flèche » → flèche à la même place, sans rechargement ; réglage
 * gardé au rechargement.
 */
async function truckIconCheck(browser, base) {
  const nav = fixture('ors-directions-nav.json');
  const line = nav.features[0].geometry.coordinates;
  for (const [width, height] of [[412, 900], [900, 412]]) {
    for (const mode of ['jour', 'nuit', 'satellite']) {
      const tag = `${width}×${height} ${mode}`;
      const { page, ctx, errors } = await open(browser, base, {
        width, height, theme: mode === 'jour' ? 'day' : 'night',
        directions: () => nav, overpass: () => ({ elements: [] }),
      });
      await computeRoute(page);
      await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
      await page.click('#btn-nav-start');
      await page.waitForSelector('#nav:not([hidden])');
      for (let i = 1; i <= 4; i += 1) { await setGeo(page, { lon: line[i][0], lat: line[i][1], accuracy: 5, speed: 14 }); await page.waitForTimeout(1000); }
      if (mode === 'satellite') {
        await navLayer(page); // guidage démarré en plan : un toucher passe en satellite
        await page.waitForTimeout(800);
      }
      await page.waitForTimeout(1500);
      const info = () => page.evaluate(() => {
        const m = document.querySelector('.me-marker');
        if (!m) return null;
        const r = m.getBoundingClientRect();
        const icon = m.querySelector('.me-icon')?.getBoundingClientRect();
        return {
          icon: m.dataset.icon, w: Math.round(m.offsetWidth), h: Math.round(m.offsetHeight), cx: r.left + r.width / 2, cy: r.top + r.height / 2,
          rot: /rotate[XYZ]?\((-?[\d.]+)deg\)/.exec(m.style.transform)?.[1] ?? null, noHeading: m.classList.contains('no-heading'),
          iconW: icon ? Math.round(icon.width) : 0, glass: !!m.querySelector('.me-glass'),
        };
      });
      const t = await info();
      check(t?.icon === 'truck' && t.glass && !t.noHeading && t.iconW > 0, `${tag} : repère camion au cap`, JSON.stringify(t));
      check(t?.w === 60 && t?.h === 60, `${tag} : 60 px comme la flèche`, `${t?.w}×${t?.h}`);
      check(t?.rot !== null && Math.abs(Number(t.rot)) > 1, `${tag} : tourné au cap de la route`, String(t?.rot));
      await page.screenshot({ path: join(SHOTS, `v45-camion-${mode}-${width}x${height}.png`) });
      if (mode === 'jour') {
        // Réglages › Affichage : « Flèche », appliqué sans rechargement, à la même place.
        await page.evaluate(() => { const r = document.querySelector('input[name="vehicle-icon"][value="arrow"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.waitForTimeout(400);
        const a = await info();
        check(a?.icon === 'arrow' && Math.abs(a.cx - t.cx) < 40 && Math.abs(a.cy - t.cy) < 40 && a.w === 60, `${tag} : « Flèche » → flèche à la même place`, JSON.stringify(a));
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gabarit.data')).settings.vehicleIcon);
        check(saved === 'arrow', `${tag} : réglage mémorisé`, String(saved));
        await page.screenshot({ path: join(SHOTS, `v45-fleche-${mode}-${width}x${height}.png`) });
      }
      await stopGuidance(page);
      check(errors.length === 0, `${tag} : aucune erreur JavaScript`, errors.join(' | '));
      await ctx.close();
    }
  }
}

/**
 * v44 : « Autres itinéraires » depuis la vue d'ensemble, à l'arrêt seulement. GPS émulé : en roulant, bouton grisé et
 * « Disponible à l'arrêt », aucun calcul ; à l'arrêt (3 s), vue d'ensemble + panneau, calcul depuis la position reçue
 * vers la même arrivée (3 requêtes au plus), fiches comme au départ, choix d'une autre fiche, « Guider par cet
 * itinéraire » → le guidage repart sur cet itinéraire ; panneau fermé dès que le véhicule roule ; échec 2009 →
 * message du départ, aucun tracé guidé. 412×900 jour, 900×412 nuit, 1280×800 jour.
 */
async function otherRoutesCheck(browser, base) {
  const nav = fixture('ors-directions-nav.json');
  const line = nav.features[0].geometry.coordinates;
  const alt3 = fixture('ors-directions-alternatives.json');
  for (const [width, height, theme] of [[412, 900, 'day'], [900, 412, 'night'], [1280, 800, 'day']]) {
    const tag = `${width}×${height} ${theme}`;
    const bodies = [];
    let mode = 'nav';
    const { page, ctx, errors } = await open(browser, base, {
      width, height, theme, voice: true, overpass: () => ({ elements: [] }),
      directions: (b) => {
        bodies.push(b);
        if (mode === 'fail') return { __status: 404, error: { code: 2009, message: 'Route could not be found - Unable to find a route between points 1 (4.8 45.7) and 2 (4.9 45.8).' } };
        return mode === 'alts' ? alt3 : nav;
      },
    });
    await computeRoute(page);
    const end = bodies[0].coordinates.at(-1);
    await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
    await page.click('#btn-nav-start');
    await page.waitForSelector('#nav:not([hidden])');
    // En roulant : grisé, message, aucun calcul.
    for (let i = 1; i <= 3; i += 1) { await setGeo(page, { lon: line[i][0], lat: line[i][1], accuracy: 5, speed: 14 }); await page.waitForTimeout(1000); }
    check(await page.getAttribute('#btn-nav-alt', 'aria-disabled') === 'true', `${tag} : « Autres itinéraires » grisé en roulant`);
    const n0 = bodies.length;
    await page.click('#btn-nav-alt', { force: true }); // aria-disabled : le doigt peut quand même le toucher
    await page.waitForTimeout(400);
    check(/Disponible à l'arrêt/.test(await page.textContent('#nav-toast')) && await page.isHidden('#nav-alts') && bodies.length === n0,
      `${tag} : en roulant → « Disponible à l'arrêt », aucun calcul`);
    // À l'arrêt depuis 3 s : panneau, calcul depuis la position reçue.
    const stopAt = line[3];
    for (let i = 0; i < 5; i += 1) { await setGeo(page, { lon: stopAt[0], lat: stopAt[1], accuracy: 5, speed: 0 }); await page.waitForTimeout(1000); }
    check(await page.getAttribute('#btn-nav-alt', 'aria-disabled') === 'false', `${tag} : actif à l'arrêt`);
    mode = 'alts';
    await page.click('#btn-nav-alt');
    await page.waitForSelector('#nav-alts .route-card', { timeout: 10000 }).catch(() => {});
    const sent = bodies.slice(n0);
    check(await page.getAttribute('#btn-nav-overview', 'aria-pressed') === 'true', `${tag} : vue d'ensemble`);
    check(sent.length >= 1 && sent.length <= 3 && sent.every((b) => Math.abs(b.coordinates[0][0] - stopAt[0]) < 1e-6
      && Math.abs(b.coordinates[0][1] - stopAt[1]) < 1e-6 && String(b.coordinates.at(-1)) === String(end)),
    `${tag} : 1 à 3 requêtes, de la position reçue vers la même arrivée`, JSON.stringify(sent.map((b) => b.coordinates)));
    check(sent.every((b) => b.options?.vehicle_type === 'hgv'), `${tag} : profil camion`);
    const cards = await page.locator('#nav-alts .route-card').count();
    check(cards === 3 && /^Recommandé/.test((await page.locator('#nav-alts .route-card').first().textContent()).trim()), `${tag} : 3 fiches, « Recommandé » en tête`, String(cards));
    check(await page.isVisible('#btn-alts-go') && /Réglementation|Véhicule/.test(await page.textContent('#nav-alts')), `${tag} : fiche et notes comme au départ`);
    await noHorizontalScroll(page, `${tag} autres itinéraires`);
    await page.screenshot({ path: join(SHOTS, `${width}x${height}-${theme}-autres-itineraires.png`) });
    await page.locator('#nav-alts .route-card').nth(1).click();
    await page.waitForTimeout(300);
    check(await page.getAttribute('#nav-alts .route-card >> nth=1', 'aria-checked') === 'true', `${tag} : 2e fiche choisie`);
    const chosen = alt3.features[1].geometry.coordinates;
    await page.click('#btn-alts-go');
    await page.waitForTimeout(1200);
    const routeNow = await page.evaluate(() => window.__maps.at(-1).getSource('route')?._data?.features?.[0]?.geometry?.coordinates?.length ?? null);
    check(await page.isHidden('#nav-alts') && await page.isVisible('#nav') && routeNow === chosen.length,
      `${tag} : « Guider par cet itinéraire » → guidage reparti sur la 2e fiche`, `${routeNow} / ${chosen.length}`);
    // Panneau ouvert puis le véhicule roule : fermé, aucun changement.
    for (let i = 0; i < 5; i += 1) { await setGeo(page, { lon: chosen[0][0], lat: chosen[0][1], accuracy: 5, speed: 0 }); await page.waitForTimeout(1000); }
    await page.click('#btn-nav-alt');
    await page.waitForSelector('#nav-alts .route-card', { timeout: 10000 }).catch(() => {});
    for (let i = 1; i <= 3; i += 1) { await setGeo(page, { lon: chosen[i][0], lat: chosen[i][1], accuracy: 5, speed: 14 }); await page.waitForTimeout(1000); }
    check(await page.isHidden('#nav-alts') && /disponible à l'arrêt/.test(await page.textContent('#nav-toast')), `${tag} : panneau fermé dès que le véhicule roule, message`);
    // Échec : message du calcul de départ, rien d'affiché ni guidé.
    for (let i = 0; i < 5; i += 1) { await setGeo(page, { lon: chosen[3][0], lat: chosen[3][1], accuracy: 5, speed: 0 }); await page.waitForTimeout(1000); }
    mode = 'fail';
    await page.click('#btn-nav-alt');
    await page.waitForFunction(() => /itinéraire|camion|départ|arrivée/i.test(document.querySelector('#nav-alts-status')?.textContent ?? '') && !/Calcul des/.test(document.querySelector('#nav-alts-status').textContent), null, { timeout: 15000 }).catch(() => {});
    const failText = await page.textContent('#nav-alts-status');
    check(!/Calcul des/.test(failText) && await page.locator('#nav-alts .route-card').count() === 0 && await page.isHidden('#btn-alts-go'),
      `${tag} : échec → message, aucune fiche ni guidage`, failText);
    const spoken = await page.evaluate(() => window.__spoken ?? []);
    check(!spoken.some((t) => /autres itinéraires|aucun itinéraire/i.test(t)), `${tag} : rien dit à voix haute sur le choix ni l'échec`, spoken.join(' | '));
    await page.click('#btn-alts-close');
    await stopGuidance(page);
    check(errors.length === 0, `${tag} : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
}

/**
 * v43 : « Recommandé » jamais par un tunnel interdit confirmé. Deux itinéraires (Mont-Blanc, préférence d'ORS ;
 * contournement SYNTHÉTIQUE décalé de 0,2° vers l'ouest, deux fois plus long) : Euro 3 → contournement en tête avec la
 * ligne, Mont-Blanc en « Préférence ORS » ; Euro 6 → ordre d'ORS ; ADR code E → contournement ; un seul itinéraire
 * (Mont-Blanc) en Euro 3 → « Tous les itinéraires… ». Aucune requête de plus. 412×900 jour, 900×412 nuit.
 */
async function recommendedTunnelCheck(browser, base) {
  const mb = fixture('ors-directions-mont-blanc.json');
  const detour = JSON.parse(JSON.stringify(mb.features[0]));
  detour.geometry.coordinates = detour.geometry.coordinates.map(([x, y]) => [x - 0.2, y]);
  detour.properties.summary = { distance: 60000, duration: 3000 };
  Object.assign(detour.properties.segments[0], { distance: 60000, duration: 3000 });
  const two = { ...mb, features: [mb.features[0], detour] };
  const veh = (euroClass) => ({ id: 'v1', name: 'Semi 44 t', height: 4, width: 2.55, length: 16.5, weight: 44, axleload: 11.5, maxSpeed: 90, critair: '2', euroClass });
  const AVOIDED = /Recommandé parce qu'il ne traverse pas de tunnel interdit à ton profil, contrairement à un autre itinéraire calculé\. La signalisation fait foi\./;
  const cards = (page) => page.$$eval('.route-card', (n) => n.map((c) => c.textContent));
  for (const [width, height, theme] of [[412, 900, 'day'], [900, 412, 'night']]) {
    const tag = `${width}×${height} ${theme}`;
    let calls = 0;
    const run = async (opts) => {
      calls = 0;
      const o = await open(browser, base, { width, height, theme, voice: true, overpass: () => ({ elements: [] }), ...opts, directions: () => { calls += 1; return opts.directions(); } });
      await computeRoute(o.page);
      return o;
    };
    let o = await run({ vehicle: veh('3'), directions: () => two });
    let c = await cards(o.page);
    check(c.length === 2 && AVOIDED.test(c[0]) && /^Recommandé/.test(c[0].trim()) && /Préférence ORS/.test(c[1]) && /Mont-Blanc interdit/.test(c[1]),
      `${tag} : Euro 3 → contournement recommandé, Mont-Blanc en « Préférence ORS »`, c.join(' || '));
    check(calls === 1, `${tag} : aucune requête de plus`, String(calls));
    const spoken = await o.page.evaluate(() => window.__spoken ?? []);
    check(!spoken.some((t) => /tunnel/i.test(t)), `${tag} : rien dit à voix haute`);
    await noHorizontalScroll(o.page, `${tag} recommandé`);
    await o.page.screenshot({ path: join(SHOTS, `${width}x${height}-${theme}-recommande-tunnel.png`) });
    check(o.errors.length === 0, `${tag} : aucune erreur JavaScript`, o.errors.join(' | '));
    await o.ctx.close();
    if (theme !== 'day') continue;
    o = await run({ vehicle: veh('6'), directions: () => two });
    c = await cards(o.page);
    check(!AVOIDED.test(c.join(' ')) && /Tunnel|Mont-Blanc|admise/.test(await o.page.textContent('#route-notes')) && !/Préférence ORS/.test(c.join(' ')),
      `${tag} : Euro 6 → ordre d'ORS`, c.join(' || '));
    await o.ctx.close();
    o = await run({ vehicle: veh('6'), settings: { adr: { enabled: true, adrClass: '', unNumber: '', tunnelCode: 'E' } }, directions: () => two });
    c = await cards(o.page);
    check(AVOIDED.test(c[0] ?? ''), `${tag} : ADR code E → contournement recommandé`, c.join(' || '));
    await o.ctx.close();
    o = await run({ vehicle: veh('3'), directions: () => mb });
    c = await cards(o.page);
    check(/Tous les itinéraires calculés traversent un tunnel interdit à ton profil : choix habituel gardé, à vérifier avant le départ\. La signalisation fait foi\./.test(c[0] ?? ''),
      `${tag} : tous par le tunnel → la fiche le dit`, c.join(' || '));
    await o.ctx.close();
  }
}

/**
 * Phase 12a bis : limites de poids d'OSM sur l'itinéraire synthétique de Colombier (fixture osm-poids-colombier,
 * SYNTHÉTIQUE). Fiche (3 lignes « à vérifier », desserte possible), résumé, repères « 3,5 t », ligne technique,
 * repère touché → panneau et « Éviter ce passage » (restriction de poids), guidage : aucun repère, rien à l'écran ni à
 * voix haute ; réglage désactivé ; copie absente. 412×900 jour, 900×412 nuit, 360×760 nuit.
 */
async function weightsCheck(browser, base) {
  const col = fixture('ors-directions-colombier.json');
  const line = col.features[0].geometry.coordinates;
  const T35 = "Limite de poids de 3,5 t d'après OpenStreetMap, que le calcul n'a peut-être pas prise en compte : à vérifier. La signalisation fait foi.";
  for (const [width, height, theme] of [[412, 900, 'day'], [900, 412, 'night'], [360, 760, 'night']]) {
    const tag = `${width}×${height} ${theme}`;
    const { page, ctx, errors, stats } = await open(browser, base, {
      width, height, theme, voice: true, directions: () => col, overpass: () => ({ elements: [] }), weightsCopy: 'fixture',
    });
    await computeRoute(page);
    await page.waitForFunction((t) => (document.querySelector('#route-notes')?.textContent ?? '').includes(t), T35, { timeout: 10000 }).catch(() => {});
    const notes = await page.$$eval('.rules-notes li', (n) => n.map((li) => ({ cls: li.className, text: li.textContent })));
    const lines = notes.filter((n) => n.text.startsWith('Limite de poids de '));
    check(lines.length === 3 && lines.every((l) => l.cls === 'warn'), `${tag} : 3 limites de poids sur la fiche`, lines.map((l) => l.text).join(' | '));
    check(lines[0]?.text === `${T35} (km 1)`, `${tag} : Rue du Viaduc 3,5 t, texte exact`, lines[0]?.text);
    check(/12 t d'après OpenStreetMap \(desserte locale possible\)/.test(lines[1]?.text ?? ''), `${tag} : variante « desserte locale possible »`);
    check(!notes.some((n) => /7,5 t|50 t/.test(n.text)), `${tag} : route qui croise et limite au-dessus du PTAC ignorées`);
    check(/3 limites de poids à vérifier/.test(await page.textContent('.route-card[aria-checked="true"]')), `${tag} : résumé de la fiche`);
    const markers = await page.locator('.bridge-marker.weight-marker').count();
    check(markers === 3, `${tag} : 3 repères de limite de poids à l'arrêt`, String(markers));
    check(/^3,5 t$/.test((await page.locator('.weight-marker').first().textContent()).trim()), `${tag} : repère « 3,5 t »`);
    check((stats.weights ?? []).includes('index.json') && (stats.weights ?? []).includes('6_47.json'), `${tag} : copie data/poids-osm/ lue`, (stats.weights ?? []).join(','));
    await page.locator('.route-diag summary').click();
    await page.waitForFunction(() => /Limites de poids : /.test(document.querySelector('.route-diag-text')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
    check(/Limites de poids : 3/.test(await page.textContent('.route-diag-text')), `${tag} : ligne technique « Limites de poids : 3 »`);
    // Repère touché : panneau (texte, aide), « Éviter ce passage » → restriction de poids au point du tracé.
    await page.locator('.weight-marker').first().click({ force: true });
    await page.waitForSelector('#bridge-panel:not([hidden])', { timeout: 5000 }).catch(() => {});
    check(/^Limite de poids de 3,5 t .*La signalisation fait foi\. \(km 1\)$/.test(await page.textContent('#bridge-panel-text')), `${tag} : repère touché → texte de la limite`);
    check(/restriction de poids/.test(await page.textContent('#bridge-panel-help')), `${tag} : aide « Éviter ce passage » (poids)`);
    await page.click('#btn-bridge-avoid');
    await page.waitForTimeout(200);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gabarit.data')).restrictions);
    check(stored.length === 1 && stored[0].type === 'weight' && stored[0].value === 3.5 && stored[0].origin === 'osm-weight'
      && stored[0].osmId === 190520091 && Math.abs(stored[0].lon - line[0][0]) < 1e-6,
    `${tag} : restriction de poids enregistrée au point du tracé`, JSON.stringify(stored));
    await noHorizontalScroll(page, `${tag} limites de poids`);
    await page.screenshot({ path: join(SHOTS, `${width}x${height}-${theme}-poids.png`) });
    await page.click('#btn-bridge-close');
    if (width === 412) {
      await page.click('#btn-settings');
      await page.waitForSelector('#weight-warnings');
      check(await page.isChecked('#weight-warnings'), `${tag} : case « Signaler les limites de poids » cochée par défaut`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
      await page.click('#btn-nav-start');
      await page.waitForSelector('#nav:not([hidden])');
      await page.waitForTimeout(1200);
      check(await page.locator('.bridge-marker').count() === 0, `${tag} : aucun repère pendant le guidage`);
      check(!/poids|\d t\b/i.test(await page.textContent('#nav')), `${tag} : rien sur les limites de poids dans l'écran de guidage`);
      await drive(ctx, page, line, 50, 85);
      const spoken = await page.evaluate(() => window.__spoken ?? []);
      check(!spoken.some((t) => /poids|tonne/i.test(t)), `${tag} : aucune limite de poids dite à voix haute`, spoken.join(' | '));
    }
    check(errors.length === 0, `${tag} : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
  const off = await open(browser, base, { width: 412, height: 900, directions: () => col, overpass: () => ({ elements: [] }), weightsCopy: 'fixture', settings: { weightWarnings: false } });
  await computeRoute(off.page);
  await off.page.waitForTimeout(800);
  check(!/Limite de poids de/.test(await off.page.textContent('#route-notes')) && await off.page.locator('.weight-marker').count() === 0, 'réglage désactivé : aucune limite de poids signalée');
  await off.ctx.close();
  const none = await open(browser, base, { width: 412, height: 900, directions: () => col, overpass: () => ({ elements: [] }) });
  await computeRoute(none.page);
  await none.page.waitForTimeout(800);
  check(/Limites de poids : données non chargées/.test(await none.page.textContent('#route-notes')), 'copie absente → « données non chargées »');
  await none.ctx.close();
}

/**
 * Phase 12b : Mes restrictions. « Éviter ce passage » depuis le repère du viaduc de Colombier (point de croisement),
 * liste dans Réglages, recalcul avec avoid_polygons et « Évite 1 restriction saisie par toi », échec 2009 avec la
 * phrase au conditionnel, rien en guidage, boutons refusés en roulant ; jour / nuit, portrait / paysage.
 */
async function restrictionsCheck(browser, base) {
  const col = fixture('ors-directions-colombier.json');
  const line = col.features[0].geometry.coordinates;
  for (const [width, height, theme] of [[412, 900, 'day'], [900, 412, 'night']]) {
    const tag = `${width}×${height} ${theme}`;
    const bodies = [];
    const { page, ctx, errors } = await open(browser, base, {
      width, height, theme, voice: true, overpass: () => ({ elements: [] }), bridgesCopy: 'fixture',
      directions: (b) => { bodies.push(b); return col; },
    });
    // Départ et arrivée saisis en coordonnées autour du viaduc (zone du trajet), sans géocodage.
    const coordsRoute = async () => {
      for (const [field, p] of [['from', line[0]], ['to', line.at(-1)]]) {
        await page.fill(`#${field}-input`, `${p[1]}, ${p[0]}`);
        await page.waitForSelector(`#${field}-list li`);
        await page.dispatchEvent(`#${field}-list li`, 'pointerdown');
      }
      await page.click('#btn-route');
      await page.waitForSelector('.route-card', { timeout: 10000 });
      await page.waitForTimeout(1200);
    };
    await coordsRoute();
    check(bodies.every((b) => !b.options?.avoid_polygons), `${tag} : sans restriction, aucun avoid_polygons`);
    await page.locator('.bridge-marker.high').first().click({ force: true });
    await page.waitForSelector('#bridge-panel:not([hidden])', { timeout: 5000 });
    check(/bloque aussi la route du dessus/.test(await page.textContent('#bridge-panel-help')), `${tag} : aide « Éviter ce passage » (pont routier)`);
    await page.click('#btn-bridge-avoid');
    await page.waitForTimeout(200);
    check(/évité au prochain calcul/.test(await page.textContent('#bridge-panel-status')), `${tag} : passage enregistré`);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gabarit.data')).restrictions);
    check(stored.length === 1 && stored[0].type === 'avoid' && stored[0].origin === 'osm-bridge', `${tag} : restriction enregistrée (origine pont OSM)`, JSON.stringify(stored));
    await noHorizontalScroll(page, `${tag} panneau du pont`);
    await page.screenshot({ path: join(SHOTS, `${width}x${height}-${theme}-pont-eviter.png`) });
    // Nouveau calcul : polygone autour du point de croisement, ligne « Évite 1 restriction saisie par toi ».
    bodies.length = 0;
    await page.click('#btn-route');
    await page.waitForTimeout(1500);
    const poly = bodies[0]?.options?.avoid_polygons;
    const ring = poly?.coordinates?.[0]?.[0] ?? [];
    const cx = ring.slice(0, -1).reduce((a, p) => a + p[0], 0) / Math.max(1, ring.length - 1);
    const cy = ring.slice(0, -1).reduce((a, p) => a + p[1], 0) / Math.max(1, ring.length - 1);
    check(poly?.type === 'MultiPolygon' && bodies.every((b) => b.options?.avoid_polygons) && Math.abs(cx - line[0][0]) < 0.0001,
      `${tag} : recalcul avec avoid_polygons au point de croisement`, `${cx.toFixed(5)}, ${cy.toFixed(5)}`);
    check((await page.textContent('#route-notes')).includes('Évite 1 restriction saisie par toi.'), `${tag} : « Évite 1 restriction saisie par toi »`);
    // Réglages › Mes restrictions : liste.
    await page.click('#btn-settings');
    await page.waitForSelector('#restr-list li.restr-item', { timeout: 5000 });
    check(/À éviter/.test(await page.textContent('#restr-list')) && /150 km/.test(await page.textContent('#restrictions-help')), `${tag} : liste et aide de Mes restrictions`);
    check(!(await page.isDisabled('#btn-restr-add')), `${tag} : « Ajouter » actif à l'arrêt`);
    await page.locator('#restrictions-card').scrollIntoViewIfNeeded();
    await noHorizontalScroll(page, `${tag} Mes restrictions`);
    await page.screenshot({ path: join(SHOTS, `${width}x${height}-${theme}-mes-restrictions.png`) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (theme === 'day') {
      // Guidage en roulant : rien sur les restrictions, ajout refusé.
      await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
      await page.click('#btn-nav-start');
      await page.waitForSelector('#nav:not([hidden])');
      check(await page.isHidden('#bridge-panel'), `${tag} : panneau du pont fermé en guidage`);
      await setGeo(page, { lon: line[3][0], lat: line[3][1], accuracy: 5, speed: 14 });
      await page.waitForTimeout(800);
      await page.evaluate(() => document.querySelector('#btn-restr-add').click());
      const after = await page.evaluate(() => JSON.parse(localStorage.getItem('gabarit.data')).restrictions.length);
      check(after === 1 && /arrêt seulement/.test(await page.textContent('#restr-status')), `${tag} : ajout refusé en roulant`);
      check(!/restriction/i.test(await page.textContent('#nav')), `${tag} : rien sur les restrictions dans le guidage`);
      const spoken = await page.evaluate(() => window.__spoken ?? []);
      check(!spoken.some((t) => /restriction|pont/i.test(t)), `${tag} : rien à voix haute`, spoken.join(' | '));
    }
    check(errors.length === 0, `${tag} : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
  // 2009 avec une restriction dans la zone : phrase au conditionnel.
  const r = [{ id: 'r1', lat: 45.7618, lon: 4.84, type: 'avoid', date: '2026-11-22', origin: 'manual' }];
  const err = { __status: 404, error: { code: 2009, message: 'Route could not be found - Unable to find a route between points 1 (4.8357000 45.7640000) and 2 (4.8467000 45.7597000).' } };
  const f = await open(browser, base, { width: 412, height: 900, directions: () => err, restrictions: r });
  await computeRoute(f.page).catch(() => {});
  await f.page.waitForSelector('#message:not([hidden])', { timeout: 10000 }).catch(() => {});
  const msg = await f.page.textContent('#message');
  check(/Une restriction saisie bloque peut-être le seul passage\./.test(msg), 'échec 2009 avec restriction : phrase au conditionnel', msg);
  await f.ctx.close();
}

/** Éléments visibles du bandeau du haut qui passent sous la barre du bas (ou sortent du bandeau borné). */
async function bannerOverBottom(page) {
  return page.evaluate(() => {
    const bottom = document.querySelector('#nav .nav-bottom').getBoundingClientRect().top;
    const top = document.querySelector('#nav .nav-top').getBoundingClientRect();
    return [...document.querySelectorAll('#nav .nav-top > *')]
      .filter((n) => !n.hidden && n.getClientRects().length && getComputedStyle(n).display !== 'none')
      .filter((n) => { const b = n.getBoundingClientRect(); return b.bottom > bottom + 0.5 || b.bottom > top.bottom + 0.5; })
      .map((n) => `${n.id || n.className} (bas ${Math.round(n.getBoundingClientRect().bottom)} > ${Math.round(Math.min(bottom, top.bottom))})`);
  });
}

/** Décompte enregistré : `seconds` de conduite à 90 km/h finissant maintenant (guidages précédents). */
function drivenFor(seconds, end = Date.now()) {
  let d = emptyDriving();
  for (let t = end - seconds * 1000; t <= end; t += 1000) d = trackDriving(d, t, 90);
  return d;
}

/**
 * Phase 5 (PR B) : temps de conduite et vent fort. 4 h 25 de conduite déjà comptées, rafales de 95 km/h partout
 * (Open-Meteo simulé). Fiches (vent, pause conseillée, attribution Open-Meteo, une seule requête par calcul), guidage
 * avec le GPS émulé : ligne du temps de conduite, bandeau vent, bouton « Pas une pause (travail) » seulement à
 * l'arrêt, sans recouvrir les boutons de carte ; 360, 412 px, tablette et paysage. Puis Réglages, copie sur
 * l'appareil (pas de seconde requête) et Open-Meteo en échec (« Météo indisponible », guidage normal).
 */
async function driveWindCheck(browser, base) {
  const line = fixture('ors-directions-nav.json').features[0].geometry.coordinates;
  for (const [width, height] of [[360, 760], [412, 900], [800, 1280], [1280, 800], [760, 360], [900, 412]]) {
    const label = `${width}×${height}`;
    const { page, ctx, stats, errors } = await open(browser, base, {
      width, height, wind: () => 95, driving: drivenFor(4 * 3600 + 25 * 60), overpass: () => fixture('overpass-aires.json'),
    });
    await computeRoute(page);
    await page.waitForSelector('.wind-credit', { timeout: 10000 });
    const notes = await page.$$eval('.rules-notes li', (n) => n.map((li) => li.textContent));
    check(notes.some((t) => /^Vent fort : rafales jusqu'à 95 km\/h/.test(t)), `${label} : fiche, vent fort à l'heure de passage`, notes.join(' | '));
    check(notes.some((t) => /^Pause de 45 min conseillée après \d+ min de route/.test(t))
      && notes.some((t) => /^Temps de conduite : 4 h 2\d depuis la dernière pause.*chronotachygraphe fait foi/.test(t)),
    `${label} : fiche, pause conseillée et rappel « le chronotachygraphe fait foi »`);
    check(/Pause conseillée/.test(await page.textContent('.route-card[aria-checked="true"] .route-card-rules')), `${label} : résumé « Pause conseillée »`);
    check(/Rafales 95 km\/h/.test(await page.textContent('.route-card[aria-checked="true"] .route-card-rules')), `${label} : résumé sur la fiche`);
    check(await page.getAttribute('.wind-credit a', 'href') === 'https://open-meteo.com/'
      && /Weather data by Open-Meteo\.com \(CC BY 4\.0\)/.test(await page.textContent('.wind-credit'))
      && await page.getAttribute('.wind-credit a:last-child', 'href') === 'https://creativecommons.org/licenses/by/4.0/',
    `${label} : attribution Open-Meteo (CC BY 4.0) avec liens`);
    const cards = await page.locator('.route-card').count();
    if (cards > 1) { await page.locator('.route-card').nth(1).click(); await page.waitForTimeout(400); }
    check(stats.wind === 1, `${label} : une seule requête Open-Meteo pour le calcul (choix d'itinéraire compris)`, `${stats.wind}`);
    await noHorizontalScroll(page, `${label} fiches, vent et conduite`);
    await page.locator('#route-notes').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, `${width}x${height}-conduite-fiche.png`) });

    // Guidage, GPS émulé (une position par seconde, vitesse fournie).
    if (cards > 1) await page.locator('.route-card').nth(0).click();
    await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
    await page.click('#btn-nav-start');
    await drive(ctx, page, line, 50, 4);
    await showDriving(page);
    const main = await page.textContent('#nav-drive-main');
    check(await page.isVisible('#nav-drive') && /^Conduite 4 h 2\d · pause 45 min conseillée dans \d+ min$/.test(main)
      && await page.getAttribute('#nav-drive', 'data-level') === 'soon', `${label} : temps de conduite en guidage (orange)`, main);
    check(!(await page.isVisible('#btn-nav-work')), `${label} : pas de bouton « travail » en roulant`);
    await closeDetails(page);
    const windText = `${await page.textContent('#nav-rule')} ${await page.textContent('#nav-more-list')}`;
    check(/Rafales (jusqu'à )?95 km\/h.*\(Open-Meteo\)/.test(windText), `${label} : bandeau vent fort avec Open-Meteo`, windText);
    check(!/obligatoire/i.test(await page.textContent('body')), `${label} : jamais « obligatoire »`);
    let foot = await footOverlaps(page);
    check(foot.out.length === 0, `${label} : boutons de carte hors du bandeau (conduite, vent)`, foot.out.join(' ; '));
    let under = await bannerOverBottom(page);
    check(under.length === 0, `${label} : bandeau au-dessus de la barre du bas`, under.join(' ; '));
    let over = await overflowingNavText(page);
    check(over.length === 0, `${label} : textes du guidage dans leurs cases`, over.join(' ; '));
    await page.screenshot({ path: join(SHOTS, `${width}x${height}-conduite-guidage.png`) });

    // À l'arrêt (vitesse 0) : bouton d'un seul appui, l'arrêt compte comme travail.
    const last = line[Math.min(line.length - 1, 3)];
    for (let i = 0; i < 6; i += 1) {
      // Position qui bouge d'un mètre : un vrai GPS envoie une position par seconde même à l'arrêt.
      await setGeo(page, { lon: last[0] + (i % 2) * 1e-5, lat: last[1], accuracy: 5, speed: 0 });
      await page.waitForTimeout(1000);
    }
    foot = await footOverlaps(page);
    check(foot.out.length === 0 && foot.sizes.every((h) => h >= 56), `${label} : à l'arrêt, boutons de carte toujours libres`, foot.out.join(' ; '));
    under = await bannerOverBottom(page);
    check(under.length === 0, `${label} : à l'arrêt, bandeau au-dessus de la barre du bas`, under.join(' ; '));
    check(!/Signal GPS perdu/.test(await page.textContent('#nav-alert')), `${label} : GPS émulé reçu à l'arrêt`);
    await showDriving(page);
    check(await page.isVisible('#btn-nav-work') && (await page.textContent('#btn-nav-work')) === 'Pas une pause (travail)',
      `${label} : bouton « Pas une pause (travail) » à l'arrêt`);
    const work = await page.locator('#btn-nav-work').boundingBox();
    check(work.height >= 56, `${label} : bouton « travail » d'au moins 56 px`, `${Math.round(work.height)} px`);
    await page.click('#btn-nav-work');
    check(/compté comme travail/.test(await page.textContent('#nav-drive-main'))
      && (await page.textContent('#btn-nav-work')) === 'Compter comme pause', `${label} : arrêt retiré du décompte`);
    over = await overflowingNavText(page);
    check(over.length === 0, `${label} : textes dans leurs cases à l'arrêt`, over.join(' ; '));
    await noHorizontalScroll(page, `${label} guidage, temps de conduite`);
    await page.screenshot({ path: join(SHOTS, `${width}x${height}-conduite-arret.png`) });
    await stopGuidance(page);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gabarit.driving')));
    check(saved?.v === 1 && saved.sinceBreak >= 4 * 3600 + 25 * 60, `${label} : décompte enregistré sur la tablette`, `${saved?.sinceBreak}`);
    check(errors.length === 0, `${label} : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }

  // Réglages, copie sur l'appareil, Open-Meteo en échec.
  {
    const { page, ctx, stats, errors } = await open(browser, base, { width: 412, height: 900, wind: () => 60 });
    await page.click('#btn-settings');
    check(await page.isChecked('#drive-voice') && await page.isChecked('#wind-voice') && (await page.inputValue('#wind-gust')) === '70',
      'Réglages : voix des pauses et du vent activées, seuil 70 km/h par défaut');
    await page.fill('#wind-gust', '55');
    await page.click('#btn-wind-save');
    check(/55 km\/h/.test(await page.textContent('#wind-status')), 'Réglages : seuil enregistré (55 km/h)');
    await page.uncheck('#wind-voice');
    await page.click('#dlg-settings [data-close]');
    const set = await page.evaluate(() => JSON.parse(localStorage.getItem('gabarit.data')).settings);
    check(set.windGust === 55 && set.windVoice === false && set.driveVoice === true, 'Réglages : seuil et voix gardés', JSON.stringify(set).slice(0, 60));
    await computeRoute(page);
    await page.waitForSelector('.wind-credit', { timeout: 10000 });
    check((await page.$$eval('.rules-notes li', (n) => n.map((li) => li.textContent))).some((t) => /rafales jusqu'à 60 km\/h/.test(t)),
      'seuil de Réglages appliqué (rafales de 60 km/h signalées)');
    await page.click('#btn-route');
    await page.waitForTimeout(1500);
    check(stats.wind === 1, 'même trajet recalculé : prévisions reprises sur l\'appareil, pas de seconde requête', `${stats.wind}`);
    check(errors.length === 0, 'Réglages : aucune erreur JavaScript', errors.join(' | '));
    await ctx.close();
  }
  {
    const { page, ctx, errors } = await open(browser, base, { width: 360, height: 760, wind: null });
    await computeRoute(page);
    await page.waitForTimeout(800);
    const notes = await page.$$eval('.rules-notes li', (n) => n.map((li) => li.textContent));
    check(notes.includes('Météo indisponible : vent non vérifié sur ce trajet.') && !(await page.$('.wind-credit')),
      'Open-Meteo en échec : « Météo indisponible », sans bloquer', notes.join(' | '));
    check(await page.isVisible('#btn-nav-start'), 'Open-Meteo en échec : guidage possible');
    check(errors.length === 0, 'Open-Meteo en échec : aucune erreur JavaScript', errors.join(' | '));
    await ctx.close();
  }
}

/** Alertes empilées sous le bandeau (cartes visibles) : 2 au plus. */
async function stackedAlerts(page) {
  return page.evaluate(() => [...document.querySelectorAll('#nav-alerts > #nav-alert, #nav-alerts > #nav-drive, #nav-rule > span')]
    .filter((n) => !n.hidden && n.getClientRects().length && !n.closest('[hidden]')).length);
}

/** Carte du guidage : tracé, partie parcourue, bulles des rues, photos, cap (window.__maps, posé par open()). */
async function guidanceMap(page) {
  return page.evaluate(() => {
    const map = window.__maps?.at(-1);
    const style = map?.getStyle();
    const has = (id) => !!map?.getLayer(id);
    return {
      route: has('route-line') && has('route-casing'),
      doneLayers: has('route-done-line') && has('route-done-casing'),
      done: (map?.getSource('route-done')?._data ?? style?.sources?.['route-done']?.data)?.features?.[0]?.geometry?.coordinates?.length ?? 0,
      doneRaw: JSON.stringify(map?.getSource('route-done')?._data ?? null).slice(0, 120),
      width: has('route-line') ? map.getPaintProperty('route-line', 'line-width') : null,
      bubble: has('highway-name-minor') ? map.getLayoutProperty('highway-name-minor', 'icon-image') : null,
      bubbleFit: has('highway-name-minor') ? map.getLayoutProperty('highway-name-minor', 'icon-text-fit') : null,
      bubbleImage: !!map?.hasImage('gabarit-bubble'),
      brightness: has('ign-ortho') ? map.getPaintProperty('ign-ortho', 'raster-brightness-max') : null,
      bearing: map ? Math.round(map.getBearing()) : null,
      marker: !!document.querySelector('.maplibregl-marker.me-marker'),
      theme: document.documentElement.dataset.theme,
      disclaimer: (() => {
        const d = document.querySelector('.disclaimer');
        const b = d.getBoundingClientRect();
        return getComputedStyle(d).display !== 'none' && b.height > 0 && b.bottom <= window.innerHeight + 0.5;
      })(),
    };
  });
}

/**
 * Phase 2c : écran de guidage façon GPS de téléphone. Téléphone (412×900, 900×412, et 760×360 de jour), tablette
 * (800×1280, 1280×800) ; jour, nuit (412×900 : mode auto, le soleil se couche à Lyon pendant le guidage, un 21
 * décembre ; ailleurs nuit choisie) et satellite de nuit ; GPS émulé (une position par seconde, vitesse fournie), 4 h 25 de conduite et rafales (alertes,
 * « +N »). Rien ne se chevauche, boutons ronds ≥ 56 px, texte jamais coupé, 2 alertes au plus, « Autres itinéraires »
 * grisé en roulant et actif après 3 s à l'arrêt, boussole (nord en haut), Recentrer après un glissé seulement,
 * confirmation pour quitter, tracé épais et partie parcourue, bulles des rues ; nuit : voile sombre pendant le
 * changement de style, tracé, partie parcourue, marqueur et bulles remis ; satellite de nuit assombri (0,6) ;
 * « la signalisation fait foi » toujours visible.
 */
async function guidanceCheck(browser, base) {
  const nav = fixture('ors-directions-nav.json');
  const line = nav.features[0].geometry.coordinates;
  const runs = [];
  for (const size of [[412, 900], [900, 412], [800, 1280], [1280, 800]]) for (const mode of ['jour', 'nuit', 'satellite']) runs.push([size, mode]);
  runs.push([[760, 360], 'jour']);
  // Filtre facultatif : node tools/ui-check.mjs guidage 412x900 (ou « nuit »).
  const only = process.argv[3];
  for (const [[width, height], mode] of runs) {
    if (only && only !== `${width}x${height}` && only !== mode) continue;
    const label = `${width}×${height} ${mode}`;
    const night = mode === 'nuit';
    // Mode auto, une fois : tablette réglée 8 s avant le coucher du soleil à Lyon ; la nuit tombe pendant le guidage
    // (réévaluation chaque minute).
    const auto = night && width === 412;
    const sunset = sunTimes(Date.parse('2026-12-21T12:00:00Z'), START[1], START[0]).sunset;
    const { page, ctx, errors, stats } = await open(browser, base, {
      width, height, streets: true, directions: () => nav,
      theme: auto ? 'auto' : night || mode === 'satellite' ? 'night' : 'day',
      now: auto ? sunset - 8000 : null,
      wind: () => 95, driving: night ? null : drivenFor(4 * 3600 + 25 * 60), overpass: () => manyAreas(line),
      osmCopy: manyAreas(line).elements,
    });
    await computeRoute(page);
    await page.waitForTimeout(400);
    if (auto) {
      check((await guidanceMap(page)).theme === 'day', `${label} : mode auto, soleil encore levé → jour`);
      // Voile de la carte pendant le changement de style : sa couleur à chaque apparition.
      await page.evaluate(() => {
        window.__veil = [];
        const v = document.querySelector('.map-veil');
        new MutationObserver(() => { if (v.classList.contains('on')) window.__veil.push(getComputedStyle(v).backgroundColor); })
          .observe(v, { attributes: true, attributeFilter: ['class'] });
      });
    }
    await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
    await page.click('#btn-nav-start');
    if (mode === 'satellite') await navLayer(page);
    await drive(ctx, page, line, 50, 6);
    await page.waitForTimeout(400);

    if (auto) await page.waitForFunction(() => document.documentElement.dataset.theme === 'night', null, { timeout: 75000 }).catch(() => {});
    if (auto) await drive(ctx, page, line.slice(1), 50, 3);
    let m = await guidanceMap(page);
    if (auto) {
      const veil = await page.evaluate(() => window.__veil);
      check(m.theme === 'night', `${label} : la nuit tombe pendant le guidage (soleil couché à la position)`, m.theme);
      check(veil.length > 0 && veil.every((c) => c === 'rgb(20, 22, 28)'), `${label} : voile sombre pendant le changement de style, jamais de blanc`, veil.join(', '));
      check(!isDay(await mapColor(page)), `${label} : fond de carte jamais clair après la bascule`);
    }
    check(m.route && m.doneLayers && m.done >= 2 && m.width === 12, `${label} : tracé épais et partie parcourue (grise)`, JSON.stringify(m));
    check(m.bubble === 'gabarit-bubble' && m.bubbleFit === 'both' && m.bubbleImage, `${label} : noms des rues en bulles`, `${m.bubble} ${m.bubbleFit} ${m.bubbleImage}`);
    check(m.marker && m.disclaimer, `${label} : marqueur et « la signalisation fait foi » visibles`);
    if (mode === 'satellite') check(m.brightness === SATELLITE_NIGHT_BRIGHTNESS.normal, `${label} : photos IGN assombries la nuit (Normal : 0,8)`, String(m.brightness));
    let foot = await footOverlaps(page);
    check(foot.out.length === 0, `${label} : en roulant, rien ne se chevauche`, foot.out.join(' ; '));
    check(foot.sizes.length >= 4 && foot.sizes.every((x) => x >= 56), `${label} : boutons ronds d'au moins 56 px`, foot.sizes.join(', '));
    const under = await bannerOverBottom(page);
    check(under.length === 0, `${label} : bandeau au-dessus du panneau du bas`, under.join(' ; '));
    const over = await overflowingNavText(page);
    check(over.length === 0, `${label} : textes dans leurs cases`, over.join(' ; '));
    check(await stackedAlerts(page) <= 2, `${label} : 2 alertes au plus sous le bandeau`);
    check(await page.getAttribute('#btn-nav-alt', 'aria-disabled') === 'true', `${label} : « Autres itinéraires » grisé en roulant`);
    // aria-disabled : Playwright le tient pour désactivé, le doigt peut quand même le toucher.
    await page.click('#btn-nav-alt', { force: true });
    check(/Disponible à l'arrêt/.test(await page.textContent('#nav-toast')), `${label} : message « Disponible à l'arrêt »`);
    check(!(await page.isVisible('#btn-nav-recenter')), `${label} : pas de « Recentrer » tant que la carte suit`);
    await noHorizontalScroll(page, label);
    const tag = `${width}x${height}`;
    await page.screenshot({ path: join(SHOTS, `2c-${mode}-${tag}-route.png`) });

    // Boussole : nord en haut, puis cap en haut.
    await page.click('#btn-nav-compass');
    await drive(ctx, page, line.slice(2), 50, 2);
    m = await guidanceMap(page);
    check(m.bearing === 0 && await page.getAttribute('#btn-nav-compass', 'aria-pressed') === 'true', `${label} : boussole → nord en haut`, String(m.bearing));
    await page.click('#btn-nav-compass');

    // Carte déplacée au doigt : « Recentrer » apparaît dans la colonne, sous la boussole.
    const mapBox = await page.locator('#map').boundingBox();
    await page.mouse.move(mapBox.x + mapBox.width * 0.6, mapBox.y + mapBox.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(mapBox.x + mapBox.width * 0.4, mapBox.y + mapBox.height * 0.45, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const order = await page.evaluate(() => {
      const c = document.querySelector('#btn-nav-compass').getBoundingClientRect();
      const r = document.querySelector('#btn-nav-recenter').getBoundingClientRect();
      return r.top >= c.bottom - 0.5 || r.left >= c.right - 0.5;
    });
    check(await page.isVisible('#btn-nav-recenter') && order, `${label} : « Recentrer » après un glissé, sous la boussole`);
    foot = await footOverlaps(page);
    check(foot.out.length === 0, `${label} : Recentrer visible, rien ne se chevauche`, foot.out.join(' ; '));
    await page.click('#btn-nav-recenter');
    check(!(await page.isVisible('#btn-nav-recenter')), `${label} : recentré, bouton masqué`);

    // Loupe : rangée de catégories (aucune saisie).
    await page.click('#btn-nav-search');
    check(await page.isVisible('#btn-nav-areas') && await page.isVisible('#btn-nav-layer')
      && (await page.$$('#nav input, #nav textarea')).length === 0, `${label} : loupe → Aires PL, Plan/Satellite, sans saisie`);
    foot = await footOverlaps(page);
    check(foot.out.length === 0, `${label} : rangée de la loupe libre`, foot.out.join(' ; '));
    await page.click('#btn-nav-search');

    // Phase 2d : liste défilante des aires et parkings PL, en roulant (50 km/h).
    const land = width > height;
    const reqBefore = stats.directions;
    await navAreas(page);
    await drive(ctx, page, line.slice(3), 50, 2);
    await checkAreaList(page, `${label} en roulant`, land);
    const camBefore = await cameraCenter(page);
    await page.locator('#nav-areas-list .nav-area').first().click();
    await page.waitForTimeout(400);
    let al = await areaListState(page);
    check(al.card && al.selected === 1, `${label} : appui sur une aire → fiche courte et repère mis en évidence`, `fiche ${al.card}, repère ${al.selected}`);
    check(!(await page.isVisible('#btn-nav-recenter')) && sameCenter(camBefore, await cameraCenter(page)),
      `${label} : en roulant, la caméra ne bouge pas vers l'aire`);
    check(al.go === 'true' && al.sheet === 'true', `${label} : « Y aller » et « Fiche complète » grisés à 50 km/h`, `${al.go} ${al.sheet}`);
    await page.click('#btn-nav-area-go', { force: true });
    check(/Disponible à l'arrêt/.test(await page.textContent('#nav-toast')), `${label} : « Y aller » en roulant → « Disponible à l'arrêt »`);
    await page.click('#btn-nav-area-sheet', { force: true });
    check(!(await page.isVisible('#dlg-area')), `${label} : « Fiche complète » en roulant n'ouvre rien`);
    await checkAreaList(page, `${label} fiche courte ouverte`, land);
    await page.screenshot({ path: join(SHOTS, `2d-${mode}-${width}x${height}-aires-roulant.png`) });

    // À l'arrêt (vitesse 0 pendant plus de 3 s) : « Autres itinéraires » actif (vue d'ensemble pour l'instant).
    const stopAt = line[Math.min(line.length - 1, 4)];
    // Vitesse lissée par le moteur (50 → 25 → 12 → 6 → 3 km/h), puis 3 s sous 5 km/h.
    for (let i = 0; i < 9; i += 1) {
      await setGeo(page, { lon: stopAt[0] + (i % 2) * 1e-5, lat: stopAt[1], accuracy: 5, speed: 0 });
      await page.waitForTimeout(1000);
    }
    check(await page.getAttribute('#btn-nav-alt', 'aria-disabled') === 'false', `${label} : « Autres itinéraires » actif à l'arrêt`);
    foot = await footOverlaps(page);
    check(foot.out.length === 0, `${label} : à l'arrêt, rien ne se chevauche`, foot.out.join(' ; '));
    check((await overflowingNavText(page)).length === 0 && (await bannerOverBottom(page)).length === 0, `${label} : à l'arrêt, textes et bandeau à leur place`);
    await page.screenshot({ path: join(SHOTS, `2c-${mode}-${tag}-arret.png`) });
    const altBefore = stats.directions;
    await page.click('#btn-nav-alt');
    await page.waitForSelector('#nav-alts .route-card', { timeout: 10000 }).catch(() => {});
    // v44 : vue d'ensemble et panneau « Autres itinéraires » (scénario « autres » pour le détail) : 1 à 3 requêtes
    // voulues par l'appui, hors du compte « aucun recalcul » de la liste des aires.
    const altReq = stats.directions - altBefore;
    check(await page.getAttribute('#btn-nav-overview', 'aria-pressed') === 'true' && await page.isVisible('#nav-alts') && altReq >= 1 && altReq <= 3,
      `${label} : à l'arrêt, « Autres itinéraires » ouvre la vue d'ensemble et le choix (1 à 3 requêtes)`, String(altReq));
    await page.click('#btn-alts-close');
    await page.click('#btn-nav-recenter');

    // Phase 2d : à l'arrêt, « Y aller » et « Fiche complète » actifs ; l'aire touchée est montrée sur la carte.
    if (!(await page.isVisible('#nav-areas'))) await navAreas(page);
    await page.waitForTimeout(300);
    al = await areaListState(page);
    check(al.go === 'false' && al.sheet === 'false', `${label} : « Y aller » et « Fiche complète » actifs après 3 s d'arrêt`, `${al.go} ${al.sheet}`);
    await checkAreaList(page, `${label} à l'arrêt`, land);
    await page.locator('#nav-areas-list .nav-area').nth(1).click();
    await page.waitForTimeout(900);
    check(await page.isVisible('#btn-nav-recenter'), `${label} : à l'arrêt, la carte montre l'aire touchée (Recentrer proposé)`);
    await page.screenshot({ path: join(SHOTS, `2d-${mode}-${width}x${height}-aires-arret.png`) });
    await page.click('#btn-nav-area-go');
    await page.waitForTimeout(700);
    check(await page.getAttribute('#btn-nav-overview', 'aria-pressed') === 'true' && /bientôt/.test(await page.textContent('#nav-toast')),
      `${label} : « Y aller » à l'arrêt → vue d'ensemble, « Y aller : bientôt »`);
    check(stats.directions - altReq === reqBefore, `${label} : liste des aires, aucun recalcul`, `${stats.directions - altReq - reqBefore} requête(s)`);
    await page.click('#btn-nav-recenter');
    if (!(await page.isVisible('#nav-areas'))) await navAreas(page);
    await page.click('#btn-nav-areas-close');
    check(!(await page.isVisible('#nav-areas')) && (await page.$$('.area-marker.selected')).length === 0,
      `${label} : « Fermer » ferme la liste, repère remis`);
    if (width === 412 && mode === 'jour') {
      await navAreas(page);
      await page.waitForTimeout(20_600);
      check(!(await page.isVisible('#nav-areas')), `${label} : liste fermée seule après 20 s sans toucher`);
    }

    // Panneau du bas : détails du trajet (lecture seule), puis « +N » s'il y a plus de 2 alertes.
    await page.click('#btn-nav-sheet');
    check(await page.isVisible('#nav-details') && (await page.$$('#nav-details input, #nav-details textarea')).length === 0,
      `${label} : détails du trajet en lecture seule`);
    await page.screenshot({ path: join(SHOTS, `2c-${mode}-${tag}-details.png`) });
    await page.click('#btn-nav-sheet');
    if (await page.isVisible('#btn-nav-more')) {
      const b = await page.locator('#btn-nav-more').boundingBox();
      check(b.width >= 56 && b.height >= 56, `${label} : « +N » d'au moins 56 px`, `${Math.round(b.width)}×${Math.round(b.height)}`);
      await page.click('#btn-nav-more');
      check(await page.isVisible('#nav-details') && (await page.isVisible('#nav-more-list') || await page.isVisible('#nav-drive-slot #nav-drive')),
        `${label} : « +N » ouvre les détails avec les autres alertes`);
      await page.click('#btn-nav-sheet');
    }

    // ✕ : confirmation, « Continuer » garde le guidage.
    await page.click('#btn-nav-stop');
    check(await page.isVisible('#nav-confirm'), `${label} : ✕ demande confirmation`);
    await page.click('#btn-nav-keep');
    check(!(await page.isVisible('#nav-confirm')) && await page.isVisible('#nav'), `${label} : « Continuer » garde le guidage`);
    await stopGuidance(page);
    check(!(await page.isVisible('#nav')), `${label} : « Quitter » termine le guidage`);
    check(errors.length === 0, `${label} : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
  // Phase 2d : nuit aux trois niveaux de luminosité (filtre facultatif : node tools/ui-check.mjs guidage niveaux).
  if (!only || only === 'niveaux') await nightLevelsCheck(browser, base);
}

/**
 * Phase 2d : luminosité de la carte la nuit (Sombre, Normal, Clair) choisie dans Réglages › Affichage, appliquée sans
 * rechargement ni éclair clair (voile sombre, fond toujours sombre), fond de plus en plus clair ; guidage de nuit à
 * chaque niveau (captures de l'interface, satellite 0,6 / 0,8 / 0,9). Téléphone 412×900 et tablette 1280×800.
 */
async function nightLevelsCheck(browser, base) {
  const nav = fixture('ors-directions-nav.json');
  const line = nav.features[0].geometry.coordinates;
  for (const [width, height] of [[412, 900], [1280, 800]]) {
    const tag = `${width}×${height} nuit`;
    const { page, ctx, errors } = await open(browser, base, {
      width, height, theme: 'night', nightLevel: 'dark', streets: true, directions: () => nav,
      overpass: () => fixture('overpass-aires.json'),
    });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      window.__veil = [];
      const v = document.querySelector('.map-veil');
      new MutationObserver(() => { if (v.classList.contains('on')) window.__veil.push(getComputedStyle(v).backgroundColor); })
        .observe(v, { attributes: true, attributeFilter: ['class'] });
    });
    const lum = ([r, g, b]) => r + g + b;
    const colors = {};
    for (const level of NIGHT_LEVELS) {
      if (level !== 'dark') {
        await page.click('#btn-settings');
        await page.check(`input[name="night-level"][value="${level}"]`);
        await page.click('#dlg-settings [data-close]');
        // Pendant le changement : le fond reste sombre à chaque mesure (jamais d'éclair clair).
        const samples = [];
        for (let i = 0; i < 6; i += 1) { samples.push(await mapColor(page)); await page.waitForTimeout(120); }
        check(samples.every(isDark), `${tag} → ${level} : fond jamais clair pendant le changement`, samples.map((c) => c.join('/')).join(' '));
        await page.waitForTimeout(900);
      }
      colors[level] = await mapColor(page);
      check(near(colors[level], NIGHT_PALETTES[level].background, 8), `${tag} ${level} : fond de carte ${NIGHT_PALETTES[level].background}`,
        `couleur ${colors[level]}`);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gabarit.data')).settings.nightMapLevel);
      check(stored === level, `${tag} ${level} : réglage mémorisé sur l'appareil`, String(stored));
    }
    const veil = await page.evaluate(() => window.__veil);
    check(veil.length >= 2 && veil.every((c) => c === 'rgb(20, 22, 28)'), `${tag} : voile sombre à chaque changement de luminosité`, veil.join(', '));
    check(lum(colors.dark) < lum(colors.normal) && lum(colors.normal) < lum(colors.light), `${tag} : Sombre < Normal < Clair`,
      NIGHT_LEVELS.map((l) => colors[l].join('/')).join(' < '));
    check(await page.evaluate(() => performance.getEntriesByType('navigation').length === 1 && !!window.__maps && window.__maps.length === 1),
      `${tag} : appliqué sans rechargement ni nouvelle carte`);

    // Guidage de nuit à chaque niveau : captures (panneau du bas, boutons ronds, alertes), satellite assombri.
    for (const level of ['light', 'normal', 'dark']) {
      if (level !== 'light') {
        await page.click('#btn-settings');
        await page.check(`input[name="night-level"][value="${level}"]`);
        await page.click('#dlg-settings [data-close]');
        await page.waitForTimeout(1200);
      }
      await computeRoute(page);
      await page.waitForTimeout(300);
      await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
      await page.click('#btn-nav-start');
      await drive(ctx, page, line, 50, 4);
      await page.waitForTimeout(400);
      const foot = await footOverlaps(page);
      check(foot.out.length === 0, `${tag} ${level} : guidage, rien ne se chevauche`, foot.out.join(' ; '));
      await page.screenshot({ path: join(SHOTS, `2d-nuit-${level}-${width}x${height}-plan.png`) });
      await navLayer(page);
      await page.waitForTimeout(800);
      const m = await guidanceMap(page);
      check(m.brightness === SATELLITE_NIGHT_BRIGHTNESS[level], `${tag} ${level} : photos IGN à ${SATELLITE_NIGHT_BRIGHTNESS[level]}`, String(m.brightness));
      await page.screenshot({ path: join(SHOTS, `2d-nuit-${level}-${width}x${height}-satellite.png`) });
      await stopGuidance(page);
      await page.waitForTimeout(400);
    }
    check(errors.length === 0, `${tag} : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
/** Tracés dessinés sur la carte : features de la source 'route', couche 'route-line' présente et visible. */
async function drawnRoutes(page) {
  return page.evaluate(() => {
    const map = window.__maps?.at(-1);
    if (!map) return { maps: 0 };
    const src = map.getSource('route');
    const features = src?._data?.features?.length ?? 0;
    const layer = map.getLayer('route-line');
    const visible = !!layer && map.getLayoutProperty('route-line', 'visibility') !== 'none';
    const order = (map.getStyle()?.layers ?? []).map((l) => l.id);
    return { maps: window.__maps.length, features, layer: !!layer, visible, top: order.at(-1), loaded: map.isStyleLoaded() };
  });
}

/** Pixels ambre du tracé choisi (--route #E8A93B, 2c-a) dans la carte : le tracé est vraiment rendu. */
async function bluePixels(page) {
  const png = await page.locator('#map').screenshot();
  return page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 205 && d[i + 1] > 150 && d[i + 1] < 190 && d[i + 2] < 95) n += 1;
    return n;
  }, png.toString('base64'));
}

/**
 * Régression v17 : tuiles encore en chargement (map.isStyleLoaded() faux) au moment du calcul → aucun tracé.
 * Calcul, autre fiche, Plan / Satellite, rechargement puis nouveau calcul : tracés toujours dessinés.
 */
async function drawCheck(browser, base) {
  const { page, ctx, errors } = await open(browser, base, { width: 1280, height: 800, theme: 'day', layer: 'plan', slowTiles: true });
  // Pixels ambre déjà là sans tracé (titre, point GPS) : le tracé doit en ajouter nettement.
  let baseline = await bluePixels(page);
  const expect = async (label, n) => {
    await page.waitForTimeout(1500);
    const d = await drawnRoutes(page);
    const blue = (await bluePixels(page)) - baseline;
    check(d.features === n && d.layer && d.visible && blue > 2000, `${label} : tracés dessinés`,
      `source ${d.features}/${n}, couche ${d.layer ? (d.visible ? 'visible' : 'masquée') : 'absente'}, +${blue} px ambre, tuiles chargées : ${d.loaded}`);
  };
  // Fond qui bouge encore (tuiles lentes en cours) au moment du calcul, comme sur la tablette.
  await page.evaluate(() => window.__maps.at(-1).panBy([200, 120], { duration: 0 }));
  await computeRoute(page);
  const cards = await page.locator('.route-card').count();
  await expect('après « Calculer l\'itinéraire »', cards);
  await page.screenshot({ path: join(SHOTS, 'draw-calcul.png') });
  if (cards > 1) {
    await page.locator('.route-card').nth(1).click();
    await expect('autre fiche touchée', cards);
  }
  await page.click('[data-layer="satellite"]');
  await expect('satellite', cards);
  await page.click('[data-layer="plan"]');
  await expect('retour au plan', cards);
  await page.reload();
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
  await page.waitForTimeout(800);
  baseline = await bluePixels(page);
  await page.evaluate(() => window.__maps.at(-1).panBy([-200, 80], { duration: 0 }));
  await computeRoute(page);
  await expect('page rechargée puis nouveau calcul', await page.locator('.route-card').count());
  check(errors.length === 0, 'aucune erreur JavaScript', errors.join(' | '));
  await ctx.close();
}

/**
 * Phase 5h ter : un calcul réussi puis un calcul en échec (404, code 2009) : ancien tracé et repères de départ /
 * d'arrivée effacés ; même trajet possible sans les restrictions du profil (requête de diagnostic) → message
 * « peut-être joignable seulement en franchissant une limite », rien en voix, aucun tracé.
 */
async function failedCheck(browser, base) {
  const err2009 = (points) => ({ __status: 404, error: { code: 2009, message: `Route could not be found - Unable to find a route between points ${points}.` } });
  for (const [width, height] of [[360, 760], [1280, 800]]) {
    let failing = false;
    let first = null; // premier point du calcul en échec : repère le trajet inverse (phase 2f)
    const sent = [];
    const { page, errors } = await open(browser, base, {
      width, height, voice: true, overpass: () => ({ elements: [] }),
      directions: (body) => {
        sent.push(body);
        if (!failing) return body.alternative_routes ? fixture('ors-directions-alternatives.json') : fixture('ors-directions-nav.json');
        first ??= body.coordinates[0];
        const reverse = body.coordinates.length === 2 && String(body.coordinates[1]) === String(first);
        // Metz → Nancy (tablette v35 à v37) : l'aller échoue, le trajet inverse passe.
        if (failing === 'start') return reverse ? fixture('ors-directions.json') : err2009('1 (6.1796300 49.1151600) and 2 (6.1782900 48.6903000)');
        // Arrivée non routable : aller et retour en échec, point de passage en échec sur le 2e tronçon.
        return body.coordinates.length === 3 ? err2009('2 (6.1789600 48.9027300) and 3 (6.1782900 48.6903000)') : err2009('1 (6.1796300 49.1151600) and 2 (6.1782900 48.6903000)');
      },
    });
    await computeRoute(page);
    const routeShown = () => page.evaluate(() => {
      const m = window.__maps.at(-1);
      return { source: !!m.getSource('route'), layer: !!m.getLayer('route-line') };
    });
    const markersOf = () => page.evaluate(() => document.querySelectorAll('.maplibregl-marker:not(.me-marker)').length);
    const before = await routeShown();
    const mBefore = await markersOf();
    check(before.source && before.layer && mBefore >= 2, `${width} px : premier calcul, tracé et repères affichés`, JSON.stringify({ before, mBefore }));
    failing = 'start';
    sent.length = 0;
    await page.click('#btn-route');
    await page.waitForSelector('#message:not([hidden]) .message-detail', { timeout: 10000 });
    await page.waitForTimeout(500);
    const after = await routeShown();
    const mAfter = await markersOf();
    check(!after.source && !after.layer, `${width} px : calcul en échec, ancien tracé effacé (trajet inverse jamais affiché)`, JSON.stringify(after));
    check(mAfter <= mBefore - 2, `${width} px : repères de départ et d'arrivée retirés`, `${mBefore} → ${mAfter}`);
    check(await page.locator('.route-card:visible').count() === 0, `${width} px : aucune fiche d'itinéraire visible`);
    const msg = await page.textContent('#message');
    check(/^Aucun itinéraire autorisé pour ce gabarit\..*Le départ semble sans sortie pour un camion \(sens unique, zone piétonne, sortie interdite\) : le trajet inverse passe\. Pose le départ sur une route voisine plus large \(appui long\)\. La signalisation fait foi\..*code 2009/.test(msg),
      `${width} px : 2009, trajet inverse possible → message « départ sans sortie »`, msg);
    check(sent.length === 2 && sent[1].coordinates.length === 2, `${width} px : aller + trajet inverse, budget de 3`, String(sent.length));
    // Aller et retour impossibles, point de passage en échec sur le 2e tronçon → arrivée en cause.
    failing = 'end';
    first = null;
    sent.length = 0;
    await page.click('#btn-route');
    await page.waitForFunction(() => /L'arrivée semble/.test(document.querySelector('#message')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
    const dead = await page.textContent('#message');
    check(/^Aucun itinéraire autorisé pour ce gabarit\..*L'arrivée semble inaccessible à ton camion \(sens unique, zone piétonne, accès interdit ou limite de gabarit\)\. Pose l'arrivée sur une route voisine plus large \(appui long\)\. La signalisation fait foi\..*code 2009/.test(dead) && !/Le départ semble/.test(dead),
      `${width} px : point de passage en échec au 2e tronçon, message « arrivée »`, dead);
    check(sent.length <= 3 && sent.filter((b) => b.coordinates.length === 3 && Array.isArray(b.radiuses) && b.radiuses.length === 3 && !b.alternative_routes).length === 1,
      `${width} px : une requête avec point de passage (un rayon par point), budget de 3`, String(sent.length));
    check(!(await routeShown()).source, `${width} px : toujours aucun tracé`);
    const spoken = await page.evaluate(() => window.__spoken ?? []);
    check(!spoken.some((x) => /joignable|limite|semble/.test(x)), `${width} px : rien en voix`, spoken.join(' | '));
    await noHorizontalScroll(page, `${width} px message 2009`);
    if (width === 360) await page.screenshot({ path: join(SHOTS, `${width}-failed.png`) });
    check(errors.length === 0, `${width} px : aucune erreur JavaScript`, errors.join(' | '));
    await page.context().close();
  }
}

/**
 * Phase 2c-a — couleurs Panier Perdu : jour, nuit et satellite ; accueil, itinéraire, guidage (GPS émulé), Réglages ;
 * portrait 412 × 900 et paysage 900 × 412. Tracé au-dessus des ZFE (aussi après changement de thème), bord du tracé
 * de 2 px de chaque côté, flèche « Auto » cochée par défaut, pastilles lisibles, capture de jour zoomée sur le tracé.
 */
async function paletteCheck(browser, base) {
  const nav = fixture('ors-directions-nav.json');
  const line = nav.features[0].geometry.coordinates;
  const [cx, cy] = line[Math.floor(line.length / 2)];
  const d = 0.006;
  const zfe = {
    updated: '2026-03-26',
    zones: [{
      id: 'TEST-ZFE-001', name: 'Testville', start: '2025-01-01', end: null,
      pl: { critair: 'V3', hours: '24/7' }, vul: { critair: 'V3', hours: '24/7' }, url: 'https://example.org/arrete-zfe.pdf',
      polygons: [[[[cx - d, cy - d], [cx + d, cy - d], [cx + d, cy + d], [cx - d, cy + d], [cx - d, cy - d]]]],
    }],
    voies: [],
  };
  const css = (sel, prop) => (pg) => pg.evaluate(([q, k]) => {
    const n = document.querySelector(q);
    return n ? getComputedStyle(n)[k] : null;
  }, [sel, prop]);
  const layerInfo = (pg) => pg.evaluate(() => {
    const map = window.__maps?.at(-1);
    const ids = (map?.getStyle()?.layers ?? []).map((l) => l.id);
    const paint = (id, k) => (map?.getLayer(id) ? map.getPaintProperty(id, k) : null);
    return {
      ids, bg: paint(ids[0], 'background-color'),
      casing: paint('route-casing', 'line-color'), line: paint('route-line', 'line-color'),
      wCasing: paint('route-casing', 'line-width'), wLine: paint('route-line', 'line-width'),
    };
  });
  const above = (info) => {
    const top = Math.max(info.ids.indexOf('zfe-fill'), info.ids.indexOf('zfe-line'));
    const low = Math.min(...['route-alt-casing', 'route-alt-line', 'route-casing', 'route-line'].map((id) => info.ids.indexOf(id)));
    return top >= 0 && low > top;
  };
  for (const theme of ['day', 'night']) {
    const tname = theme === 'day' ? 'jour' : 'nuit';
    const bgHex = theme === 'day' ? '#EDEAE3' : MAP_PALETTE.night.background;
    for (const [width, height] of [[412, 900], [900, 412]]) {
      const tag = `${tname} ${width}×${height}`;
      const file = (what) => join(SHOTS, `2ca-${tname}-${width}x${height}-${what}.png`);
      const { page, ctx, errors } = await open(browser, base, { width, height, theme, zfe, directions: () => nav });
      await page.waitForTimeout(600);
      // Accueil : barre du haut noire, titre ambre, fond de carte recoloré.
      check(await css('.topbar', 'backgroundColor')(page) === 'rgb(20, 22, 28)', `${tag} : barre du haut #14161C`);
      check(await css('.brand', 'color')(page) === 'rgb(232, 169, 59)', `${tag} : titre « Gabarit » ambre`);
      const c = await mapColor(page);
      check(near(c, bgHex), `${tag} : fond de carte recoloré ${bgHex}`, `couleur ${c}`);
      await page.screenshot({ path: file('accueil') });

      // Réglages : « Auto (noir le jour, ambre la nuit) » cochée par défaut, pastilles lisibles.
      await page.click('#btn-settings');
      const auto = await page.evaluate(() => {
        const r = document.querySelector('input[name="arrow-color"][value="auto"]');
        return { checked: r.checked, text: r.closest('label').textContent.trim() };
      });
      check(auto.checked && auto.text === 'Auto (noir le jour, ambre la nuit)', `${tag} : flèche « Auto » cochée par défaut`, JSON.stringify(auto));
      const sw = await page.$$eval('.swatch', (n) => n.map((e) => {
        const st = getComputedStyle(e);
        return { border: st.borderTopColor, width: st.borderTopWidth, w: e.getBoundingClientRect().width };
      }));
      const fg = theme === 'day' ? 'rgb(20, 22, 28)' : 'rgb(237, 234, 227)';
      check(sw.length === 4 && sw.every((x) => x.border === fg && x.width === '2px' && x.w >= 28),
        `${tag} : 4 pastilles de couleur bordées de la couleur du texte`, JSON.stringify(sw[0]));
      await page.screenshot({ path: file('reglages'), fullPage: true });
      await page.click('#dlg-settings [data-close]');

      // Itinéraire : tracé ambre bordé de noir, 2 px de bord de chaque côté, au-dessus de la ZFE.
      await computeRoute(page);
      await page.waitForTimeout(800);
      let info = await layerInfo(page);
      check(above(info), `${tag} : tracé au-dessus des contours ZFE`, info.ids.filter((i) => /route|zfe/.test(i)).join(' < '));
      check(/^#e8a93b$/i.test(info.line) && /^#(14161c|000000)$/i.test(info.casing), `${tag} : tracé ambre bordé de noir`, `${info.line} / ${info.casing}`);
      check((info.wCasing - info.wLine) / 2 >= 2, `${tag} : bord du tracé ≥ 2 px de chaque côté`, `${info.wLine} / ${info.wCasing}`);
      await page.screenshot({ path: file('itineraire') });

      if (theme === 'day' && width === 412) {
        // Capture zoomée (z 17) sur le tracé, fond crème.
        await page.evaluate(([x, y]) => window.__maps.at(-1).jumpTo({ center: [x, y], zoom: 17 }), line[3]);
        await page.waitForTimeout(700);
        await page.locator('#map').screenshot({ path: file('trace-zoom17') });
      }

      // Guidage, GPS émulé comme le vrai.
      await setGeo(page, { lon: line[0][0], lat: line[0][1], speed: 0 });
      await page.click('#btn-nav-start');
      await drive(ctx, page, line, 50, 6);
      check(await css('.nav-maneuver', 'backgroundColor')(page) === 'rgb(20, 22, 28)', `${tag} : bandeau de manœuvre noir`);
      check(await css('.nav-icon', 'color')(page) === 'rgb(232, 169, 59)', `${tag} : pictogramme ambre`);
      check(await css('.nav-dist', 'color')(page) === 'rgb(237, 234, 227)', `${tag} : texte du bandeau crème`);
      const ok = theme === 'day' ? 'rgb(39, 107, 62)' : 'rgb(143, 214, 164)';
      // Phase 2c : temps restant en vert, « km • heure d'arrivée » en gris (--muted).
      const muted = theme === 'day' ? 'rgb(92, 95, 105)' : 'rgb(169, 167, 158)';
      check(await css('#nav-time', 'color')(page) === ok && await css('#nav-eta', 'color')(page) === muted, `${tag} : temps restant en vert, arrivée en gris`);
      const arrow = await page.evaluate(() => {
        const st = getComputedStyle(document.documentElement);
        return [st.getPropertyValue('--arrow-fill').trim(), st.getPropertyValue('--arrow-stroke').trim()];
      });
      const want = theme === 'day' ? ['#14161c', '#e8a93b'] : ['#e8a93b', '#14161c'];
      check(arrow.join() === want.join(), `${tag} : flèche auto`, arrow.join(' / '));
      const over = await overflowingNavText(page);
      check(over.length === 0, `${tag} guidage : textes dans leurs cases`, over.join(' ; '));
      await page.screenshot({ path: file('guidage') });

      // Satellite (photos IGN factices rouges) : tracé ambre bordé de #14161C.
      await navLayer(page);
      await drive(ctx, page, line.slice(1), 50, 2);
      await page.waitForTimeout(800);
      info = await layerInfo(page);
      check(isPhoto(await mapColor(page)) && /^#14161c$/i.test(info.casing), `${tag} : satellite, bord du tracé #14161C`, info.casing);
      await page.screenshot({ path: file('guidage-satellite') });
      await navLayer(page);
      await stopGuidance(page);
      await page.waitForTimeout(600);

      // Satellite à l'arrêt (accueil avec itinéraire).
      await page.click('[data-layer="satellite"]');
      await page.waitForTimeout(800);
      await page.screenshot({ path: file('satellite') });
      await page.click('[data-layer="plan"]');

      if (width === 412) {
        // Changement de thème (setStyle + transformStyle) : fond recoloré, tracé toujours au-dessus des ZFE.
        const other = theme === 'day' ? 'night' : 'day';
        await setTheme(page, other);
        await page.waitForTimeout(1200);
        info = await layerInfo(page);
        const otherHex = other === 'day' ? '#EDEAE3' : MAP_PALETTE.night.background;
        check(String(info.bg).toUpperCase() === otherHex && above(info), `${tag} → ${other} : fond recoloré, tracé au-dessus des ZFE`,
          `${info.bg} ; ${info.ids.filter((i) => /route|zfe/.test(i)).join(' < ')}`);
      }
      await noHorizontalScroll(page, tag);
      check(errors.length === 0, `${tag} : aucune erreur JavaScript`, errors.join(' | '));
      await ctx.close();
    }
  }
}

// ───────── Phase 2e : bandeau de manœuvre, échelle, bouton grisé ─────────

/**
 * Bandeau : la consigne entière est visible (ni coupée par le bandeau, ni par la pile du haut), sa taille reste
 * ≥ 70 % de la taille d'origine ; références de route sur une seule ligne.
 */
async function bannerClip(page) {
  return page.evaluate(() => {
    const instr = document.querySelector('#nav-instr');
    const top = instr.closest('.nav-top');
    const r = instr.getBoundingClientRect();
    const out = [];
    for (let n = instr.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = n.getBoundingClientRect();
      if (r.bottom > b.bottom + 1 || r.top < b.top - 1 || r.right > b.right + 1) out.push(`consigne coupée par ${n.id || n.className} (${Math.round(r.bottom)} > ${Math.round(b.bottom)})`);
    }
    const m = instr.closest('.nav-maneuver').getBoundingClientRect();
    if (r.bottom > m.bottom + 1) out.push(`consigne sous le bandeau (${Math.round(r.bottom)} > ${Math.round(m.bottom)})`);
    if (instr.scrollHeight > instr.clientHeight + 2 || instr.scrollWidth > instr.clientWidth + 1) out.push('consigne plus grande que sa case');
    const inline = instr.style.fontSize;
    const used = parseFloat(getComputedStyle(instr).fontSize);
    instr.style.fontSize = '';
    const base = parseFloat(getComputedStyle(instr).fontSize);
    instr.style.fontSize = inline;
    for (const b of instr.querySelectorAll('.nav-badge')) if (b.getClientRects().length !== 1) out.push(`badge « ${b.textContent} » sur deux lignes`);
    // Référence sans badge : jamais de retour à la ligne à l'intérieur (espaces insécables).
    if (/\b[ADN] \d/.test(instr.textContent)) out.push(`référence avec espace sécable : « ${instr.textContent} »`);
    return { out, scale: used / base, scrolled: top.scrollHeight > top.clientHeight + 1, text: instr.textContent,
      badges: [...instr.querySelectorAll('.nav-badge')].map((b) => b.textContent) };
  });
}

async function scaleShown(page) {
  return page.evaluate(() => {
    const vis = (sel) => { const n = document.querySelector(sel); return !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden'; };
    return { scale: vis('.maplibregl-ctrl-scale'), attrib: vis('.maplibregl-ctrl-attrib') };
  });
}

async function bannerCheck(browser, base) {
  const nav = fixture('ors-directions-nav.json');
  const line = nav.features[0].geometry.coordinates;
  const variants = {
    rue: { name: 'Rue de Tortelet, D 120 E', instruction: 'Tournez à droite sur Rue de Tortelet, D 120 E' },
    longue: { name: 'D 120 E', instruction: 'Tournez à droite sur la D 120 E en direction de Saint-Martin-de-Belleville, Moûtiers, Courchevel' },
  };
  // Police agrandie (Android : Réglages › Affichage › Taille de la police) : les rem grossissent.
  const runs = [];
  for (const size of [[412, 900], [900, 412], [760, 360], [1280, 800]]) for (const kind of Object.keys(variants)) runs.push([size, kind, 1]);
  for (const size of [[900, 412], [1280, 800]]) for (const kind of Object.keys(variants)) runs.push([size, kind, 1.3]);
  // Écran bas et police très grande : la consigne est réduite (70 % au plus bas), puis la pile du haut défile.
  for (const kind of Object.keys(variants)) runs.push([[760, 360], kind, 1.6]);
  for (const [[width, height], kind, font] of runs) {
    {
      const v = variants[kind];
      const label = `${width}×${height} consigne ${kind}${font !== 1 ? ` police ${Math.round(font * 100)} %` : ''}`;
      const data = JSON.parse(JSON.stringify(nav));
      Object.assign(data.features[0].properties.segments[0].steps[1], v);
      // Deux alertes : 4 h 25 de conduite déjà comptées et rafales.
      const { page, ctx, errors } = await open(browser, base, {
        width, height, streets: true, directions: () => data, wind: () => 95, driving: drivenFor(4 * 3600 + 25 * 60),
      });
      if (font !== 1) await page.addStyleTag({ content: `html { font-size: ${font * 100}% }` });
      await computeRoute(page);
      await page.waitForTimeout(300);
      let sc = await scaleShown(page);
      check(sc.scale && sc.attrib, `${label} : échelle et attribution visibles hors guidage`, JSON.stringify(sc));
      await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
      await page.click('#btn-nav-start');
      await drive(ctx, page, line, 50, 4);
      await page.waitForTimeout(400);
      sc = await scaleShown(page);
      check(!sc.scale && sc.attrib, `${label} : échelle cachée en guidage, attribution visible`, JSON.stringify(sc));
      const b = await bannerClip(page);
      check(b.out.length === 0, `${label} : aucun texte du bandeau coupé`, `${b.out.join(' ; ')} « ${b.text} »`);
      check(b.scale >= 0.69, `${label} : consigne à 70 % de sa taille au moins`, b.scale.toFixed(2));
      if (kind === 'rue') check(b.badges.includes('D 120 E'), `${label} : badge « D 120 E »`, b.badges.join(', '));
      if (kind === 'longue') check(/D 120 E/.test(b.text), `${label} : « D 120 E » d'un seul tenant dans la consigne`, b.text);
      const alerts = await stackedAlerts(page);
      check(alerts === 2, `${label} : 2 alertes actives`, String(alerts));
      const over = await overflowingNavText(page);
      check(over.length === 0, `${label} : textes dans leurs cases`, over.join(' ; '));
      if (b.scrolled) {
        // Pile du haut qui défile (dernier recours) : son cadre reste au-dessus du panneau du bas.
        const gap = await page.evaluate(() => {
          const t = document.querySelector('#nav .nav-top').getBoundingClientRect();
          const bt = document.querySelector('#nav .nav-bottom').getBoundingClientRect();
          const sp = document.querySelector('#nav .nav-speedo')?.getBoundingClientRect();
          const hit = (o) => o && o.width && t.left < o.right && o.left < t.right && t.bottom > o.top + 0.5;
          return [hit(bt) && 'panneau du bas', hit(sp) && 'compteur'].filter(Boolean);
        });
        check(gap.length === 0, `${label} : pile du haut défilante, rien dessous`, gap.join(', '));
      } else {
        const foot = await footOverlaps(page);
        check(foot.out.length === 0, `${label} : rien ne se chevauche`, foot.out.join(' ; '));
      }
      const alt = await page.evaluate(() => {
        const n = document.querySelector('#btn-nav-alt');
        const cs = getComputedStyle(n);
        return { dis: n.getAttribute('aria-disabled'), opacity: cs.opacity, bg: cs.backgroundColor };
      });
      check(alt.dis === 'true' && alt.opacity === '1' && /^rgb\(/.test(alt.bg),
        `${label} : « Autres itinéraires » grisé opaque`, JSON.stringify(alt));
      await page.screenshot({ path: join(SHOTS, `2e-${kind}-${width}x${height}-${Math.round(font * 100)}.png`) });
      await stopGuidance(page);
      sc = await scaleShown(page);
      check(sc.scale, `${label} : échelle de retour après le guidage`);
      await noHorizontalScroll(page, label);
      check(errors.length === 0, `${label} : aucune erreur JavaScript`, errors.join(' | '));
      await ctx.close();
    }
  }
}

const only = process.argv[2];
try {
  const all = { layout: layoutChecks, long: longTextCheck, satellite: satelliteThemeCheck, context: contextLossCheck,
    parked: parkedCheck, comfort: comfortCheck, destinations: destinationsCheck,
    overview: overviewGpsCheck, press: pressThenTypeCheck, areas: areasCheck, foot: footCheck, rules: rulesCheck,
    drive: driveWindCheck, adr: adrCheck, draw: drawCheck, border: borderCheck, access: accessCheck, winter: winterCheck, euro: euroCheck,
    tolls: tollsCheck, failed: failedCheck, palette: paletteCheck, guidage: guidanceCheck, bandeau: bannerCheck,
    ponts: bridgesCheck, restrictions: restrictionsCheck, poids: weightsCheck,
    recommande: recommendedTunnelCheck, autres: otherRoutesCheck, camion: truckIconCheck };
  for (const [name, fn] of Object.entries(all)) {
    if (only && only !== name) continue;
    console.log(`\n— ${name}`);
    try {
      await fn(browser, base);
    } catch (err) {
      check(false, `${name} : scénario interrompu`, err.message.split('\n')[0]);
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} vérification(s) en échec` : '\nTout est vert');
process.exit(failures ? 1 : 0);


