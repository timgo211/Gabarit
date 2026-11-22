// Vérifications statiques : syntaxe, chemins relatifs, service worker, absence de clé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['.git', 'node_modules']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(ROOT);
const rel = (p) => relative(ROOT, p).split('\\').join('/');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const jsFiles = files.filter((f) => ['.js', '.mjs'].includes(extname(f)));
const textFiles = files.filter((f) => ['.js', '.mjs', '.html', '.css', '.json', '.webmanifest', '.md', '.yml', '.svg'].includes(extname(f)));

test('node --check sur chaque module', () => {
  assert.ok(jsFiles.length > 10);
  for (const f of jsFiles) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${rel(f)} : ${r.stderr}`);
  }
});

test('aucun chemin absolu dans l\'appli (HTML, manifest, JS, CSS)', () => {
  const app = files.filter((f) => !rel(f).startsWith('tests/') && !rel(f).startsWith('tools/')
    && ['.js', '.html', '.css', '.webmanifest'].includes(extname(f)));
  const bad = [
    /\b(?:src|href|action)\s*=\s*["']\/(?!\/)/, // src="/..."
    /url\(\s*["']?\/(?!\/)/, // CSS url(/...)
    /\bfrom\s+["']\/(?!\/)/, // import from '/...'
    /\bimport\(\s*["']\/(?!\/)/,
    /\b(?:fetch|register)\(\s*["']\/(?!\/)/,
    /"(?:src|start_url|scope|id)"\s*:\s*"\/(?!\/)/, // manifest
  ];
  for (const f of app) {
    const text = readFileSync(f, 'utf8');
    for (const re of bad) assert.doesNotMatch(text, re, `${rel(f)} contient un chemin absolu (${re})`);
  }
});

test('les imports internes sont relatifs et pointent vers des fichiers existants', () => {
  for (const f of jsFiles.filter((p) => !rel(p).startsWith('tests/'))) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('node:')) continue;
      assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${rel(f)} : import non relatif ${spec}`);
      assert.ok(existsSync(join(f, '..', spec)), `${rel(f)} : import introuvable ${spec}`);
    }
  }
});

test('manifest : chemins relatifs et icônes présentes', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.lang, 'fr');
  for (const icon of m.icons) assert.ok(existsSync(join(ROOT, icon.src)), `icône manquante ${icon.src}`);
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
});

test('phase 2c-a : écran de chargement, barre d\'état et logo aux couleurs Panier Perdu', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.background_color, '#14161C');
  assert.equal(m.theme_color, '#14161C');
  assert.match(read('index.html'), /<meta name="theme-color" content="#14161C">/);
  const svg = read('icons/icon.svg');
  assert.match(svg, /<rect width="512" height="512" fill="#14161C"\/>/);
  assert.ok(!/#0f1720|#ffb000/i.test(svg), 'anciennes couleurs du logo');
  // Icône « maskable » : tout le camion dans la zone sûre (cercle centré de rayon 40 % = 204,8 px sur 512).
  // Source : W3C, Web App Manifest, « icon masks » (https://www.w3.org/TR/appmanifest/#icon-masks).
  let far = 0;
  for (const r of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)) {
    const [x, y, w, h] = r.slice(1).map(Number);
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) far = Math.max(far, Math.hypot(px - 256, py - 256));
  }
  const sw = Number(/stroke-width="(\d+)"/.exec(svg)[1]);
  for (const c of svg.matchAll(/<circle cx="(\d+)" cy="(\d+)" r="(\d+)"/g)) {
    const [x, y, r] = c.slice(1).map(Number);
    far = Math.max(far, Math.hypot(x - 256, y - 256) + r + sw / 2);
  }
  assert.ok(far > 150 && far <= 204.8, `camion à ${far.toFixed(1)} px du centre`);
  // PNG régénérés par tools/make-icons.mjs : premier pixel (fond) = #14161C.
  assert.match(read('tools/make-icons.mjs'), /const BG = \[0x14, 0x16, 0x1c\]/);
});

test('service worker : ne met pas en cache les API, liste complète et relative', () => {
  const sw = read('sw.js');
  assert.doesNotMatch(sw, /heigit|openrouteservice|pelias|api_key|openfreemap|versatiles/i, 'sw.js ne doit citer aucune API');
  assert.match(sw, /cacheStrategy\(/);
  assert.match(sw, /if \(strategy === 'bypass'\) return;/);
  const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('message'"));
  assert.ok(install.length > 0);
  assert.doesNotMatch(install, /skipWaiting\(/, 'pas de skipWaiting automatique à l\'installation');

  const listed = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);
  for (const p of listed) {
    if (p === '') continue;
    assert.ok(existsSync(join(ROOT, p)), `sw.js liste un fichier absent : ${p}`);
  }
  const appFiles = files.map(rel).filter((p) => p.startsWith('src/') || p.startsWith('icons/'));
  for (const p of appFiles) assert.ok(listed.includes(p), `sw.js ne met pas en cache ${p} (hors ligne cassé)`);
  for (const p of ['index.html', 'manifest.webmanifest']) assert.ok(listed.includes(p));
});

test('version MapLibre épinglée et identique partout', () => {
  const html = read('index.html');
  const versions = [...html.matchAll(/maplibre-gl@([\d.]+)/g)].map((m) => m[1]);
  assert.equal(versions.length, 2);
  const v = versions[0];
  assert.match(v, /^\d+\.\d+\.\d+$/);
  assert.ok(versions.every((x) => x === v));
  assert.match(read('src/lib/config.js'), new RegExp(`MAPLIBRE_VERSION = '${v.replace(/\./g, '\\.')}'`));
  assert.ok([...read('src/lib/sw-routing.js').matchAll(/maplibre-gl@([\d.]+)/g)].every((m) => m[1] === v));
});

test('aucune clé API dans le dépôt, aucun log', () => {
  for (const f of textFiles) {
    const name = rel(f);
    const text = readFileSync(f, 'utf8');
    // Les clés ORS/HeiGIT sont de longues chaînes alphanumériques (ou base64).
    // data/ et fixtures : les liens publics des jeux de données (arrêtés ZFE…) peuvent contenir de longs jetons :
    // retirés d'abord.
    let scanned = name.startsWith('data/') || name.startsWith('tests/fixtures/') ? text.replace(/"https?:\/\/[^"]*"/g, '""') : text;
    // data/aires-osm/index.json et data/acces-osm/index.json : zone couverte en base64 (grid.bits, phases 9b et 5d),
    // seul champ retiré.
    if (name === 'data/aires-osm/index.json' || name === 'data/acces-osm/index.json') scanned = scanned.replace(/"bits":"[A-Za-z0-9+/=]*"/, '"bits":""');
    let suspects = (scanned.match(/[A-Za-z0-9+=_]{32,}/g) ?? []).filter((m) => /\d/.test(m) && /[A-Za-z]/.test(m));
    // data/ : données publiques converties par une Action (identifiants « aire_de_douane_…_a0027 », noms de fichiers
    // « Donnees_statiques_… ») ; une clé (base64) n'a pas de « _ » entre des mots.
    if (name.startsWith('data/')) suspects = suspects.filter((m) => !/^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/.test(m));
    assert.deepEqual(suspects, [], `${name} contient une longue chaîne suspecte (clé ?)`);
    assert.doesNotMatch(text, /api_key=[A-Za-z0-9]{8,}/, `${name} contient une clé en clair`);
  }
  for (const f of jsFiles.filter((p) => rel(p).startsWith('src/') || rel(p) === 'sw.js')) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /console\.(log|debug|info)/, `${rel(f)} : pas de console.log`);
  }
});

test('bandeau OpenStreetMap présent en permanence', () => {
  assert.match(read('index.html'), /Restrictions basées sur OpenStreetMap : la signalisation fait foi\./);
});
