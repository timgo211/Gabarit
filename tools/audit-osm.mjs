// Audit OpenStreetMap des grands axes de France, en lecture seule (Action « Audit OSM », .github/workflows/audit-osm.yml,
// lancée à la main). Rien n'est jamais écrit dans OpenStreetMap. Node 22, sans dépendance npm ; osmium-tool installé
// par l'Action (apt). Logique dans src/lib/osm-audit.js et src/lib/axes-convert.js.
//
// Un seul téléchargement de l'extrait France de Geofabrik (essais à attente croissante, tools/osm-download.mjs), un seul
// filtrage osmium, un seul export GeoJSON lu deux fois ligne à ligne :
//   passe 1 : voies d'axe (copie data/axes-osm/ et audit), communes (sections d'interdiction) ;
//   passe 2 : ponts, comparés en flux à l'index des axes ; garde-fou : seuls les ponts à moins de 50 m d'un axe sont
//             examinés, aucun pont n'est gardé en mémoire (journal : mémoire max et durée de chaque passe).
// Écrit : data/axes-osm/ (si la taille le permet, sinon ancienne copie gardée, ⚠ au journal), data/audit-osm/,
// docs/audit-osm-axes.md. Téléchargement ou osmium en échec : rien n'est écrit, code de sortie 1.
//
//   node tools/audit-osm.mjs [--levels 1,2,3]                 télécharge l'extrait et audite (niveaux 1-2 par défaut)
//   node tools/audit-osm.mjs [--levels …] fichier.osm.pbf [france.poly]     extrait local (osmium nécessaire)
//   node tools/audit-osm.mjs [--levels …] --geojsonseq export.geojsonseq [france.poly]   export déjà fait (essai)

import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { download, downloadWithFallback, TIMEOUT_POLY_MS } from './osm-download.mjs';
import { buildCoverage, parseGeojsonLine, parsePoly } from '../src/lib/areas-osm-data.js';
import { axisFromFeature, convertAxes } from '../src/lib/axes-convert.js';
import { writeSensitivePoints } from './points-sensibles.mjs';
import {
  AUDIT, auditAxisFromFeature, auditBridgeFromFeature, auditIndex, auditReport, axisCards, bridgeCards, bridgeCrossings,
  bridgeNearAxis, buildAxisIndex, placeFromFeature, placeIndex, restrictionCards, splitCards,
} from '../src/lib/osm-audit.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const AXES_DIR = join(ROOT, 'data', 'axes-osm');
const AUDIT_DIR = join(ROOT, 'data', 'audit-osm');
const REPORT = join(ROOT, 'docs', 'audit-osm-axes.md');
const RULES = join(ROOT, 'tools', 'audit-osm-interdictions.json');
const PONTS_INDEX = join(ROOT, 'data', 'ponts-osm', 'index.json');
const REGION = 'europe/france';
const UA = 'Gabarit (GitHub Action, audit manuel en lecture seule)';
// Extrait France : Geofabrik, puis en secours download.openstreetmap.fr (OpenStreetMap France ; même donnée OSM,
// licence ODbL). Joignabilité du secours vérifiée depuis une Action le 25/11/2026 (run « Textes officiels » 25 :
// liste du dossier HTTP 200, france-latest.osm.pbf du 23/11/2026, 5 Go ; france.state.txt HTTP 200).
const SOURCES = Object.freeze([
  Object.freeze({ name: 'Geofabrik', url: `https://download.geofabrik.de/${REGION}-latest.osm.pbf` }),
  Object.freeze({
    name: 'OpenStreetMap France', url: 'https://download.openstreetmap.fr/extracts/europe/france-latest.osm.pbf',
    state: 'https://download.openstreetmap.fr/extracts/europe/france.state.txt',
  }),
]);
const FAIL = `Audit OSM : téléchargement de l'extrait impossible (${SOURCES.map((s) => s.name).join(' puis ')}, 5 essais `
  + 'chacune) — rien n\'est enregistré (data/axes-osm/, data/audit-osm/ et docs/audit-osm-axes.md inchangés).';

/** Filtre osmium : axes (et secondaires pour le niveau 3), ponts, tunnels, communes. */
const FILTER = [
  'w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link,secondary',
  'w/bridge=yes,viaduct', 'n/place=city,town,village',
];

const mo = (n) => `${(n / 1024 / 1024).toFixed(0)} Mo`;
const log = [];
const say = (line) => { console.log(line); log.push(line); };

function extractDate(file) {
  try {
    const v = execFileSync('osmium', ['fileinfo', '-g', 'header.option.osmosis_replication_timestamp', file], { encoding: 'utf8' }).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  } catch {
    return null;
  }
}

/** Date d'un extrait OpenStreetMap France (fichier state.txt : « timestamp=2026-11-23T02\\:00\\:01Z »), ou null. */
async function stateDate(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_POLY_MS) });
    const m = /timestamp=(\d{4}-\d{2}-\d{2})/.exec(res.ok ? await res.text() : '');
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Lit l'export ligne à ligne ; mémoire max (rss) relevée toutes les 50 000 lignes. */
async function readSeq(seq, fn) {
  const t0 = Date.now();
  let rss = process.memoryUsage().rss;
  let lines = 0;
  const rl = createInterface({ input: createReadStream(seq, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    lines += 1;
    const f = parseGeojsonLine(line);
    if (f) fn(f);
    if (lines % 50000 === 0) rss = Math.max(rss, process.memoryUsage().rss);
  }
  rss = Math.max(rss, process.memoryUsage().rss);
  return { lines, rss, seconds: Math.round((Date.now() - t0) / 1000) };
}

/** Écrit un dossier d'un coup : dossier temporaire complet, puis remplacement. */
function writeDir(dir, files) {
  const tmp = `${dir}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  let total = 0;
  for (const [name, content] of files) {
    const text = `${JSON.stringify(content)}\n`;
    writeFileSync(join(tmp, name), text);
    total += Buffer.byteLength(text);
  }
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
  return total;
}

function parseArgs(argv) {
  const out = { levels: AUDIT.LEVELS.slice(), pbf: null, seq: null, poly: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--levels') {
      // « 1,2,3 » ou « 1-3 » (choix de l'Action).
      const v = String(argv[i += 1] ?? '');
      const range = /^(\d)-(\d)$/.exec(v);
      out.levels = range ? [1, 2, 3].filter((n) => n >= Number(range[1]) && n <= Number(range[2]))
        : v.split(',').map(Number).filter((n) => [1, 2, 3].includes(n));
    } else if (a === '--geojsonseq') out.seq = argv[i += 1];
    else if (a.endsWith('.poly')) out.poly = a;
    else out.pbf = a;
  }
  if (!out.levels.length) out.levels = AUDIT.LEVELS.slice();
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const start = Date.now();
  const dir = mkdtempSync(join(tmpdir(), 'audit-osm-'));
  let updated = null;
  let polyText = args.poly ? readFileSync(args.poly, 'utf8') : null;
  let seq = args.seq;
  let source = args.seq || args.pbf ? `fichier local (${args.seq ?? args.pbf})` : null;
  let stateUrl = null;
  try {
    if (!seq) {
      let pbf = args.pbf;
      if (!pbf) {
        pbf = join(dir, 'france.osm.pbf');
        const t0 = Date.now();
        const used = await downloadWithFallback(SOURCES, pbf, { userAgent: UA, failMessage: FAIL });
        source = `${used.name} (${used.url})`;
        say(`Extrait France : source ${source}, ${mo(statSync(pbf).size)} téléchargés en ${Math.round((Date.now() - t0) / 1000)} s.`);
        if (used.state) stateUrl = used.state;
        if (used !== SOURCES[0]) {
          say('Contour france.poly non demandé à Geofabrik (source de secours) : zone couverte reprise de data/ponts-osm/index.json.');
        } else try {
          const polyFile = join(dir, 'france.poly');
          await download(`https://download.geofabrik.de/${REGION}.poly`, polyFile, { timeoutMs: TIMEOUT_POLY_MS, userAgent: UA });
          polyText = readFileSync(polyFile, 'utf8');
        } catch {
          say('⚠ contour france.poly indisponible : zone couverte reprise de data/ponts-osm/index.json (même extrait).');
        }
      }
      updated = extractDate(pbf);
      if (!updated && stateUrl) updated = await stateDate(stateUrl);
      const kept = join(dir, 'axes.osm.pbf');
      seq = join(dir, 'axes.geojsonseq');
      const t1 = Date.now();
      execFileSync('osmium', ['tags-filter', '--overwrite', '-o', kept, pbf, ...FILTER], { stdio: 'inherit' });
      execFileSync('osmium', ['export', '--overwrite', '-f', 'geojsonseq', '--add-unique-id=type_id', '-o', seq, kept], { stdio: 'inherit' });
      say(`Filtrage et export osmium : ${mo(statSync(kept).size)} en .pbf, ${mo(statSync(seq).size)} de GeoJSON, ${Math.round((Date.now() - t1) / 1000)} s.`);
      rmSync(kept, { force: true });
      if (!args.pbf) rmSync(pbf, { force: true });
    }

    // Passe 1 : axes et communes.
    const copy = new Map();
    const axes = [];
    const places = [];
    const p1 = await readSeq(seq, (f) => {
      const c = axisFromFeature(f);
      if (c) copy.set(c.id, c);
      const a = auditAxisFromFeature(f, args.levels);
      if (a) axes.push(a);
      const p = placeFromFeature(f);
      if (p) places.push(p);
    });
    const index = buildAxisIndex(axes);
    say(`Passe 1 (axes, communes) : ${p1.lines} objets lus, ${copy.size} voies pour la copie, ${axes.length} voies auditées `
      + `(niveaux ${args.levels.join(', ')}), ${places.length} communes, ${index.segments} segments au sol indexés ; `
      + `${p1.seconds} s, mémoire max ${mo(p1.rss)}.`);

    // Passe 2 : ponts, en flux.
    const cards = [];
    let nb = 0; let near = 0; let crossing = 0;
    const p2 = await readSeq(seq, (f) => {
      const b = auditBridgeFromFeature(f);
      if (!b) return;
      nb += 1;
      if (!bridgeNearAxis(b, index)) return;
      near += 1;
      const x = bridgeCrossings(b, axes, index);
      if (!x.length) return;
      crossing += 1;
      cards.push(...bridgeCards(b, x, axes));
    });
    say(`Passe 2 (ponts) : ${nb} ponts lus, ${near} à moins de ${AUDIT.NEAR_M} m d'un axe examinés (garde-fou : les `
      + `autres écartés sans calcul), ${crossing} au-dessus d'un axe ; ${p2.seconds} s, mémoire max ${mo(p2.rss)}.`);
    if (existsSync(PONTS_INDEX)) {
      try {
        const pi = JSON.parse(readFileSync(PONTS_INDEX, 'utf8'));
        say(`Recoupement : data/ponts-osm/ (copie du ${pi.updated ?? '?'}) compte ${pi.count ?? '?'} objets ; l'audit a lu ${nb} ponts (passerelles comprises).`);
      } catch { say('Recoupement : data/ponts-osm/index.json illisible.'); }
    }

    // Voies d'axe et interdictions connues.
    cards.push(...axisCards(axes));
    const rules = JSON.parse(readFileSync(RULES, 'utf8'));
    const r = restrictionCards(rules.sections, axes, placeIndex(places));
    cards.push(...r.cards);
    say(`Interdictions : ${r.located.length} sections localisées, ${r.unlocated.length} non localisées, ${r.cards.length} fiches.`);

    // Copie des axes.
    let grid = polyText ? buildCoverage([parsePoly(polyText)]) : null;
    if (!grid && existsSync(PONTS_INDEX)) grid = JSON.parse(readFileSync(PONTS_INDEX, 'utf8')).grid ?? null;
    const day = updated ?? new Date().toISOString().slice(0, 10);
    const ax = convertAxes([...copy.values()], { updated: day, grid, countries: ['france'] });
    for (const l of ax.log) say(l);

    // Écriture (rien avant ce point).
    const files = splitCards(cards);
    const idx = auditIndex(cards, files, { updated: day, levels: args.levels, extra: { sourceExtrait: source } });
    const auditBytes = writeDir(AUDIT_DIR, [...files.entries(), ['index.json', idx]]);
    say(`data/audit-osm/ : ${cards.length} fiches, ${files.size} fichiers + index.json, ${(auditBytes / 1024 / 1024).toFixed(2)} Mo.`);
    if (!ax.problem) {
      const axesBytes = writeDir(AXES_DIR, [...ax.tiles.entries()].map(([k, t]) => [`${k}.json`, t]).concat([['index.json', ax.index]]));
      say(`data/axes-osm/ : ${ax.tiles.size} cases + index.json, ${(axesBytes / 1024 / 1024).toFixed(2)} Mo.`);
    }
    // PR 3b : points sensibles (data/points-sensibles/) tirés des fiches et de la copie des axes qui viennent d'être
    // écrites ; ponts recoupés avec data/ponts-osm/ (déjà signalés par la phase 12a).
    writeSensitivePoints({ root: ROOT, say });
    say(`Durée totale : ${Math.round((Date.now() - start) / 60000)} min.`);
    mkdirSync(dirname(REPORT), { recursive: true });
    writeFileSync(REPORT, auditReport(idx, cards, { located: r.located, unlocated: r.unlocated, axesLog: ax.log, runLog: log }));
    console.log(`${REPORT.slice(ROOT.length)} écrit.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
