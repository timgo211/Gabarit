// Vérification de l'interface dans Chromium (Playwright), sans réseau : à lancer à la main, hors CI.
//
//   npm install --no-save --no-package-lock maplibre-gl@4.7.1   (une fois : MapLibre servi depuis node_modules)
//   node tools/ui-check.mjs                                     (captures dans tools/ui-shots/, ignoré par git)
//
// unpkg et les fonds de carte sont bloqués depuis le conteneur : MapLibre vient du paquet npm, les styles sont
// minimaux (fond uni jour / nuit), les tuiles IGN sont une image rouge unie, ORS et Pelias répondent avec les
// fixtures de tests/fixtures. Aucune vraie API n'est appelée (toute autre requête externe est refusée).

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { deflateSync, crc32 } from 'node:zlib';

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
 * Ouvre l'appli. opts.directions(body) → JSON ORS ; opts.theme : 'day' | 'night'.
 * Renvoie { page, ctx, tiles } (tiles : nombre de tuiles IGN demandées).
 */
async function open(browser, base, { width, height, theme = 'day', layer = 'plan', directions = null } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: width < 700,
    geolocation: { latitude: START[1], longitude: START[0], accuracy: 8 }, permissions: ['geolocation'],
    serviceWorkers: 'block', locale: 'fr-FR',
  });
  const stats = { tiles: 0, directions: 0, pelias: 0 };
  await ctx.addInitScript(() => {
    window.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { window.__raf += 1; return raf(cb); };
  });
  await ctx.addInitScript(({ theme: t, layer: l }) => {
    if (sessionStorage.getItem('ui-check-init')) return;
    sessionStorage.setItem('ui-check-init', '1');
    localStorage.setItem('gabarit.orsKey', 'cle-factice-de-test');
    localStorage.setItem('gabarit.data', JSON.stringify({
      version: 1, vehicles: [{ id: 'v1', name: 'Semi-remorque frigorifique 44 t', height: 4, width: 2.55, length: 16.5,
        weight: 44, axleload: 11.5, maxSpeed: 90 }],
      activeVehicleId: 'v1', settings: { theme: t, mapLayer: l, voice: false },
    }));
  }, { theme, layer });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const url = route.request().url();
    if (url.includes('unpkg.com/maplibre-gl')) {
      const name = url.endsWith('.css') ? 'maplibre-gl.css' : 'maplibre-gl.js';
      return route.fulfill({ body: readFileSync(join(ML, name)), contentType: TYPES[extname(name)] });
    }
    if (url.includes('tiles.openfreemap.org/styles/') || url.includes('tiles.versatiles.org')) {
      return route.fulfill({ json: style(url.includes('/dark') || url.includes('eclipse') ? NIGHT_BG : DAY_BG) });
    }
    if (url.includes('data.geopf.fr')) {
      stats.tiles += 1;
      return route.fulfill({ body: RED_TILE, contentType: 'image/png' });
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
    const r = 60 * Math.abs(Math.sin(i * 0.9));
    const a = (i * 137 * Math.PI) / 180;
    await setGeo(page, { lat: lat + (150 + r * Math.cos(a)) / 110540,
      lon: lon + (r * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), accuracy: 15, speed: 0 });
    await page.waitForTimeout(1000);
  }
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
    await page.screenshot({ path: join(SHOTS, `${width}-reglages.png`), fullPage: true });
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

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const only = process.argv[2];
try {
  const all = { layout: layoutChecks, long: longTextCheck, satellite: satelliteThemeCheck, context: contextLossCheck,
    parked: parkedCheck, comfort: comfortCheck, destinations: destinationsCheck };
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
