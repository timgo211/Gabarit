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

const DAY_BG = '#dcdcdc';
const NIGHT_BG = '#305070'; // bien distinct du fond de la page (--panel nuit #0f1720), visible si le canevas est vide
const style = (bg) => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }] });
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
  slowTiles = false,
} = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: width < 700,
    geolocation: { latitude: START[1], longitude: START[0], accuracy: 8 }, permissions: ['geolocation'],
    serviceWorkers: 'block', locale: 'fr-FR', timezoneId: 'Europe/Paris',
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
  const stats = { tiles: 0, directions: 0, pelias: 0, overpass: [], wind: 0 };
  if (driving) await ctx.addInitScript((d) => { if (!sessionStorage.getItem('ui-check-init')) localStorage.setItem('gabarit.driving', d); }, JSON.stringify(driving));
  await ctx.addInitScript(() => {
    window.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { window.__raf += 1; return raf(cb); };
  });
  await ctx.addInitScript(({ theme: t, layer: l, vehicle: v }) => {
    if (sessionStorage.getItem('ui-check-init')) return;
    sessionStorage.setItem('ui-check-init', '1');
    localStorage.setItem('gabarit.orsKey', 'cle-factice-de-test');
    localStorage.setItem('gabarit.data', JSON.stringify({
      version: 1, vehicles: [v ?? { id: 'v1', name: 'Semi-remorque frigorifique 44 t', height: 4, width: 2.55, length: 16.5,
        weight: 44, axleload: 11.5, maxSpeed: 90 }],
      activeVehicleId: 'v1', settings: { theme: t, mapLayer: l, voice: false },
    }));
  }, { theme, layer, vehicle });
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
      return route.fulfill({ json: slowTiles ? slowStyle(bg) : style(bg) });
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
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
  await page.waitForTimeout(800);
  return { page, ctx, stats, errors };
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
const isNight = ([r, g, b]) => Math.abs(r - 0x30) < 14 && Math.abs(g - 0x50) < 14 && Math.abs(b - 0x70) < 14;
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
  const speed = await page.textContent('#nav-speed');
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
  c = await mapColor(page);
  check(isRed(c), 'satellite, jour → nuit : photos affichées', `couleur ${c}`);
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
  // Aire à ≈ 150 m au nord du tracé, GPS qui dérive (jusqu'à 60 m), précision 15 m, camion arrêté.
  for (let i = 0; i < 14; i += 1) {
    if (i === 6) Object.assign(stats, { rafAt6: await page.evaluate(() => window.__raf) });
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
  check(parkedRaf <= 8 * 15, 'camion arrêté, GPS qui dérive : pas de rendu continu', `${parkedRaf} rAF pour 8 positions`);
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
    check(await page.isVisible('#btn-nav-overview') && await page.isVisible('#btn-nav-recenter') && await page.isVisible('#btn-nav-layer'),
      `${width} px : boutons Vue d'ensemble, Recentrer, Satellite en guidage`);
    const road = await page.textContent('#nav-road');
    check(await page.isVisible('#nav-road') && /Route de Lyon|D 306/.test(road ?? ''), `${width} px : nom de la route en cours`, road);
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.nav-maneuver')).backgroundColor);
    check(/rgb\(2[34]\d, 2[34]\d, 2[45]\d\)/.test(bg), `${width} px : bandeau clair en mode jour`, bg);
    const sep = await page.evaluate(() => getComputedStyle(document.querySelectorAll('.nav-stats > div')[1]).borderLeftWidth);
    check(sep === '1px', `${width} px : traits fins entre les valeurs`, sep);
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
    await page.click('#btn-nav-layer');
    await drive(ctx, page, line.slice(1), 50, 2);
    await page.waitForTimeout(800);
    check(stats.tiles > tiles && isRed(await mapColor(page)), `${width} px : satellite en guidage en un appui`, `${stats.tiles - tiles} tuiles`);
    check(/Plan/.test(await page.textContent('#btn-nav-layer')), `${width} px : le bouton propose ensuite le plan`);
    await page.screenshot({ path: join(SHOTS, `${width}-guidage-satellite.png`) });

    // Flèche fluide : plus de requestAnimationFrame quand aucune position n'arrive.
    await page.click('#btn-nav-layer'); // retour au plan (pas de tuiles qui se chargent)
    await page.waitForTimeout(2000);
    const calls = await rafCalls(page, 2000);
    check(calls <= 2, `${width} px : aucun rendu continu sans nouvelle position`, `${calls} rAF en 2 s`);
    const moving = page.evaluate(() => window.__raf);
    await setGeo(page, { lon: line[2][0], lat: line[2][1], speed: 14, heading: 90 });
    await page.waitForTimeout(500);
    const during = (await page.evaluate(() => window.__raf)) - await moving;
    check(during >= 10, `${width} px : flèche animée entre deux positions`, `${during} rAF en 0,5 s`);

    await page.click('#btn-nav-stop');
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
    if (layer === 'satellite') await page.click('#btn-nav-layer');
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

/** Liste, repères, fiche + « Mon avis », secours Overpass, cache, encart en guidage avec un GPS émulé comme le vrai. */
async function areasCheck(browser, base) {
  for (const [width, height] of [[360, 760], [1280, 800]]) {
    const nav = fixture('ors-directions-nav.json');
    const line = nav.features[0].geometry.coordinates;
    const { page, ctx, stats, errors } = await open(browser, base, {
      width, height, directions: () => nav, official: fixture('aires-pl.json'),
      // Premier serveur en échec : le serveur de secours répond.
      overpass: (url) => (url.includes('overpass-api.de') ? null : fixture('overpass-aires.json')),
    });
    await computeRoute(page);
    await page.waitForSelector('#areas-list li', { timeout: 10000 });
    const rows = await page.$$eval('#areas-list .area-row', (n) => n.map((b) => ({ text: b.textContent, other: b.classList.contains('other-side') })));
    check(rows.length === 5, `${width} px : liste des aires du trajet`, `${rows.length} aires`);
    check(rows.filter((r) => r.other).length === 1 && rows.find((r) => r.other)?.text.includes('autre sens ?'),
      `${width} px : aire de l'autre côté en gris « autre sens ? »`);
    check(rows[0].text.includes('km 1') && rows[0].text.includes('40 places PL') && /\d\d:\d\d/.test(rows[0].text),
      `${width} px : km, heure d'arrivée et places PL`, rows[0].text);
    check(stats.overpass.length === 2 && stats.overpass[0] === 'overpass-api.de' && stats.overpass[1] !== 'overpass-api.de',
      `${width} px : une requête Overpass, serveur de secours après un échec`, stats.overpass.join(' → '));
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
    check(await page.isEnabled('[data-avis="full"]'), `${width} px : « Mon avis » possible à l'arrêt`);
    await noHorizontalScroll(page, `${width} px fiche d'une aire`);
    await page.screenshot({ path: join(SHOTS, `${width}-aire-fiche.png`) });
    await page.click('[data-avis="full"]');
    check((await page.textContent('#area-last')).includes('Plein à l\'instant'), `${width} px : avis affiché sur la fiche`);
    await page.click('#dlg-area [data-close]');
    check((await page.textContent('#areas-list')).includes('Plein à l\'instant'), `${width} px : avis affiché dans la liste`);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gabarit.data')).areaReports?.length ?? 0);
    check(saved === 1, `${width} px : avis gardé sur l'appareil (données exportées)`, `${saved}`);
    check(await page.evaluate(() => !!localStorage.getItem('gabarit.areasCache')), `${width} px : aires gardées sur l'appareil`);

    // Même trajet recalculé : aires reprises sur l'appareil, aucune requête Overpass.
    await page.click('#btn-route');
    await page.waitForTimeout(1500);
    check(stats.overpass.length === 2 && (await page.$$('#areas-list li')).length === 5,
      `${width} px : même trajet recalculé sans requête Overpass`, `${stats.overpass.length} requêtes`);

    // Guidage avec le GPS émulé (une position par seconde, vitesse fournie).
    await setGeo(page, { lon: line[0][0], lat: line[0][1], accuracy: 5, speed: 0 });
    await page.click('#btn-nav-start');
    await page.waitForTimeout(1500);
    check(await page.isHidden('#nav-areas'), `${width} px : encart fermé au départ`);
    await page.click('#btn-nav-areas');
    const navRows = async () => page.$$eval('#nav-areas-list .nav-area', (n) => n.map((b) => ({
      name: b.querySelector('.nav-area-name').textContent, dist: b.querySelector('.nav-area-dist').textContent,
      eta: b.querySelector('.nav-area-eta').textContent, places: b.querySelector('.nav-area-places').textContent,
    })));
    await drive(ctx, page, line, 50, 4);
    const r1 = await navRows();
    check(r1.length === 3 && r1[0].name === 'Aire PL de Test-Est' && /\d\d:\d\d/.test(r1[0].eta) && r1[0].places === '40 places PL',
      `${width} px : encart « Prochaines aires » (3 lignes : nom, distance, heure, places)`, JSON.stringify(r1[0]));
    check(r1.every((r) => r.name !== 'Aire de l\'Autre-Sens'), `${width} px : aire de l'autre sens hors de l'encart`);
    await noHorizontalScroll(page, `${width} px guidage, encart des aires`);
    const over = await page.evaluate(() => [...document.querySelectorAll('#nav-areas *')]
      .filter((n) => n.getClientRects().length && n.childElementCount === 0 && n.scrollWidth > n.clientWidth + 1)
      .map((n) => n.textContent));
    check(over.length === 0, `${width} px : textes de l'encart dans leurs cases`, over.join(' ; '));
    const overNav = await overflowingNavText(page);
    check(overNav.length === 0, `${width} px : guidage, textes dans leurs cases avec l'encart`, overNav.join(' ; '));
    await page.screenshot({ path: join(SHOTS, `${width}-aires-guidage.png`) });
    await drive(ctx, page, line, 50, 6);
    const r2 = await navRows();
    const km = (t) => (t === 'Ici' ? 0 : Number.parseFloat(t.replace(',', '.')) * (t.endsWith(' km') ? 1000 : 1));
    check(km(r2[0].dist) < km(r1[0].dist), `${width} px : distance mise à jour à chaque position`, `${r1[0].dist} → ${r2[0].dist}`);
    // Toucher une aire en roulant : fiche en lecture, « Mon avis » désactivé.
    await page.locator('#nav-areas-list .nav-area').first().click();
    await page.waitForSelector('#dlg-area[open]');
    check(await page.isDisabled('[data-avis="ok"]'), `${width} px : « Mon avis » désactivé en roulant`);
    await page.click('#dlg-area [data-close]');
    // À l'arrêt : avis possible.
    const here = r2.length ? line[6] : line[0];
    for (let i = 0; i < 3; i += 1) {
      await setGeo(page, { lon: here[0], lat: here[1], accuracy: 5, speed: 0 });
      await page.waitForTimeout(1000);
    }
    await page.locator('#nav-areas-list .nav-area').first().click();
    await page.waitForSelector('#dlg-area[open]');
    check(await page.isEnabled('[data-avis="ok"]'), `${width} px : « Mon avis » possible à l'arrêt en guidage`);
    await page.click('#dlg-area [data-close]');
    await page.click('#btn-nav-areas');
    check(await page.isHidden('#nav-areas'), `${width} px : encart fermé d'un appui`);
    check(errors.length === 0, `${width} px : aucune erreur JavaScript`, errors.join(' | '));
    await ctx.close();
  }
  // Les deux serveurs Overpass en échec : « Aires indisponibles », itinéraire utilisable.
  const nav = fixture('ors-directions-nav.json');
  const { page, ctx, stats } = await open(browser, base, { width: 360, height: 760, directions: () => nav, overpass: () => null });
  await computeRoute(page);
  await page.waitForFunction(() => /indisponibles/.test(document.querySelector('#areas-status')?.textContent ?? ''), null, { timeout: 10000 });
  check(stats.overpass.length === 2 && await page.isVisible('#btn-nav-start'),
    'deux serveurs en échec : « Aires indisponibles », itinéraire utilisable', await page.textContent('#areas-status'));
  await ctx.close();
}

/** Recouvrements entre boutons de carte, bandeau, encart des aires, nom de la route et barre du bas du guidage. */
async function footOverlaps(page) {
  return page.evaluate(() => {
    const vis = (n) => n && !n.hidden && n.getClientRects().length > 0;
    const box = (n) => n.getBoundingClientRect();
    const name = (n) => n.id || n.className.split(' ')[0];
    const banner = [...document.querySelectorAll('#nav .nav-top > *')].filter(vis);
    const buttons = [...document.querySelectorAll('#nav .nav-mapbtn')].filter(vis);
    const areas = [document.querySelector('#nav-areas')].filter(vis);
    const others = [document.querySelector('#nav-road'), document.querySelector('#nav .nav-bottom')].filter(vis);
    const hit = (a, b) => {
      const p = box(a); const q = box(b);
      return p.left < q.right - 0.5 && q.left < p.right - 0.5 && p.top < q.bottom - 0.5 && q.top < p.bottom - 0.5;
    };
    const out = [];
    for (const a of [...buttons, ...areas]) {
      for (const b of [...banner, ...others, ...(buttons.includes(a) ? areas : [])]) if (hit(a, b)) out.push(`${name(a)} × ${name(b)}`);
      const r = box(a);
      if (r.top < 0 || r.bottom > window.innerHeight + 0.5 || r.left < 0 || r.right > window.innerWidth + 0.5) {
        out.push(`${name(a)} hors de l'écran (${Math.round(r.left)},${Math.round(r.top)} – ${Math.round(r.right)},${Math.round(r.bottom)})`);
      }
    }
    const sizes = buttons.map((b) => Math.round(box(b).height));
    return { out, sizes, areasHeight: areas.length ? Math.round(box(areas[0]).height) : 0 };
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
    check(closed.sizes.length === 4 && closed.sizes.every((h) => h >= 44), `${label} : boutons de carte d'au moins 44 px`,
      closed.sizes.join(', '));
    await page.screenshot({ path: join(SHOTS, `${width}x${height}-pied-ferme.png`) });
    await page.click('#btn-nav-areas');
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
    check(/ZFE Testville interdite/.test(cardRules) && /Interdiction PL samedi 22 h/.test(cardRules),
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
 * alerte), formulaire du véhicule (champs ADR affichés avec la case) ; 360, 412, 800 et 1280 px. Enfin le vrai
 * service worker : « Gabarit v18 » en bas de Réglages.
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

    // Code tunnel vide : aucune alerte ; formulaire du véhicule.
    const empty = await open(browser, base, { width, height, tunnels, vehicle: vehicle(''), overpass: () => fixture('overpass-aires.json') });
    await computeRoute(empty.page);
    await empty.page.waitForTimeout(500);
    const enotes = await empty.page.$$eval('.rules-notes li', (n) => n.map((li) => li.textContent));
    check(!enotes.some((t) => /^Tunnel de Test/.test(t)) && enotes.some((t) => /^Code tunnel non renseigné/.test(t)),
      `${width} px : code vide, aucune alerte tunnel`, enotes.join(' | '));
    await empty.page.click('#btn-vehicles');
    await empty.page.click('#vehicles-body .btn:has-text("Modifier")');
    check(await empty.page.isVisible('.adr-fields') && await empty.page.isVisible('#veh-tunnel'), `${width} px : champs ADR affichés (case cochée)`);
    await empty.page.selectOption('#veh-tunnel', 'E');
    await noHorizontalScroll(empty.page, `${width} px formulaire ADR`);
    await empty.page.screenshot({ path: join(SHOTS, `${width}-adr-profil.png`) });
    await empty.page.uncheck('input[name="hazmat"]');
    check(!(await empty.page.isVisible('.adr-fields')), `${width} px : champs ADR masqués (case décochée)`);
    await empty.page.check('input[name="hazmat"]');
    await empty.page.click('.vehicle-form button[type="submit"]');
    await empty.page.waitForSelector('.vehicle-card');
    check(/ADR \(code E, classe 3, UN 1202\)/.test(await empty.page.textContent('.vehicle-card .dims')), `${width} px : profil enregistré avec le code E`);
    check(empty.errors.length === 0, `${width} px : aucune erreur JavaScript (profil)`, empty.errors.join(' | '));
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
  check(ver === `Gabarit ${swVersion}` && swVersion === 'v18', 'vrai service worker : « Gabarit v18 » en bas de Réglages', ver);
  await ctx.close();
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
    const main = await page.textContent('#nav-drive-main');
    check(await page.isVisible('#nav-drive') && /^Conduite 4 h 2\d · pause 45 min conseillée dans \d+ min$/.test(main)
      && await page.getAttribute('#nav-drive', 'data-level') === 'soon', `${label} : temps de conduite en guidage (orange)`, main);
    check(!(await page.isVisible('#btn-nav-work')), `${label} : pas de bouton « travail » en roulant`);
    check(/Rafales (jusqu'à )?95 km\/h.*\(Open-Meteo\)/.test(await page.textContent('#nav-rule')), `${label} : bandeau vent fort avec Open-Meteo`, await page.textContent('#nav-rule'));
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
    check(await page.isVisible('#btn-nav-work') && (await page.textContent('#btn-nav-work')) === 'Pas une pause (travail)',
      `${label} : bouton « Pas une pause (travail) » à l'arrêt`);
    foot = await footOverlaps(page);
    check(foot.out.length === 0 && foot.sizes.every((h) => h >= 44), `${label} : à l'arrêt, boutons de carte toujours libres`, foot.out.join(' ; '));
    under = await bannerOverBottom(page);
    check(under.length === 0, `${label} : à l'arrêt, bandeau au-dessus de la barre du bas`, under.join(' ; '));
    check(!/Signal GPS perdu/.test(await page.textContent('#nav-alert')), `${label} : GPS émulé reçu à l'arrêt`);
    const work = await page.locator('#btn-nav-work').boundingBox();
    check(work.height >= 44, `${label} : bouton « travail » d'au moins 44 px`, `${Math.round(work.height)} px`);
    await page.click('#btn-nav-work');
    check(/compté comme travail/.test(await page.textContent('#nav-drive-main'))
      && (await page.textContent('#btn-nav-work')) === 'Compter comme pause', `${label} : arrêt retiré du décompte`);
    over = await overflowingNavText(page);
    check(over.length === 0, `${label} : textes dans leurs cases à l'arrêt`, over.join(' ; '));
    await noHorizontalScroll(page, `${label} guidage, temps de conduite`);
    await page.screenshot({ path: join(SHOTS, `${width}x${height}-conduite-arret.png`) });
    await page.click('#btn-nav-stop');
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

/** Pixels bleus du tracé choisi (--route #0b57d0) dans la carte : le tracé est vraiment rendu. */
async function bluePixels(page) {
  const png = await page.locator('#map').screenshot();
  return page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 60 && d[i + 1] > 60 && d[i + 1] < 120 && d[i + 2] > 170) n += 1;
    return n;
  }, png.toString('base64'));
}

/**
 * Régression v17 : tuiles encore en chargement (map.isStyleLoaded() faux) au moment du calcul → aucun tracé.
 * Calcul, autre fiche, Plan / Satellite, rechargement puis nouveau calcul : tracés toujours dessinés.
 */
async function drawCheck(browser, base) {
  const { page, ctx, errors } = await open(browser, base, { width: 1280, height: 800, theme: 'day', layer: 'plan', slowTiles: true });
  // Pixels bleus déjà là sans tracé (bouton « Plan », point GPS) : le tracé doit en ajouter nettement.
  let baseline = await bluePixels(page);
  const expect = async (label, n) => {
    await page.waitForTimeout(1500);
    const d = await drawnRoutes(page);
    const blue = (await bluePixels(page)) - baseline;
    check(d.features === n && d.layer && d.visible && blue > 2000, `${label} : tracés dessinés`,
      `source ${d.features}/${n}, couche ${d.layer ? (d.visible ? 'visible' : 'masquée') : 'absente'}, +${blue} px bleus, tuiles chargées : ${d.loaded}`);
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

const only = process.argv[2];
try {
  const all = { layout: layoutChecks, long: longTextCheck, satellite: satelliteThemeCheck, context: contextLossCheck,
    parked: parkedCheck, comfort: comfortCheck, destinations: destinationsCheck,
    overview: overviewGpsCheck, press: pressThenTypeCheck, areas: areasCheck, foot: footCheck, rules: rulesCheck,
    drive: driveWindCheck, adr: adrCheck, draw: drawCheck };
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
