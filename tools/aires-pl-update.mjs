// Copie du jeu officiel des aires de stationnement PL dans data/aires-pl.json (phase 9).
// Lancé par .github/workflows/aires-pl.yml (chaque semaine, ou à la main) ; Node 22, sans dépendance npm.
// Les tableurs (xlsx, ods) sont des archives zip : décompressées avec la commande `unzip` (présente sur GitHub).
//
//   node tools/aires-pl-update.mjs               télécharge les fichiers de OFFICIAL.FILES
//   node tools/aires-pl-update.mjs a.xlsx b.ods  lit des fichiers locaux (même ordre que OFFICIAL.FILES)
//
// Le journal affiche, pour chaque fichier, les titres lus (avec leur colonne A, B, C…), la colonne retenue pour chaque
// champ, le nombre d'aires lues, les lignes ignorées et pourquoi, et 3 exemples d'aires converties. Chaque fichier est
// traité à part : si l'un échoue (téléchargement, colonne attendue absente, aucune aire), l'autre est enregistré
// (avec l'ancienne copie du fichier en échec, s'il y en a une). Code de sortie 1 seulement si les deux échouent.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OFFICIAL, parseSharedStrings, parseXlsxSheet, parseOdsContent, rowsToAreas, parseOfficialData,
} from '../src/lib/areas-official.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'data', 'aires-pl.json');
const PREFIX = { concédé: 'SCA', 'non concédé': 'ANC' };

function unzipList(file) {
  return execFileSync('unzip', ['-Z1', file], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').filter(Boolean);
}

function unzipRead(file, entry) {
  return execFileSync('unzip', ['-p', file, entry], { encoding: 'utf8', maxBuffer: 256 << 20 });
}

/** Feuilles du tableur : [{ name, rows }]. */
function readSheets(file, format) {
  if (format === 'ods') return parseOdsContent(unzipRead(file, 'content.xml'));
  const entries = unzipList(file);
  const shared = entries.includes('xl/sharedStrings.xml') ? parseSharedStrings(unzipRead(file, 'xl/sharedStrings.xml')) : [];
  return entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]))
    .map((e) => ({ name: e, rows: parseXlsxSheet(unzipRead(file, e), shared) }));
}

async function download(url, dir, i) {
  const res = await fetch(url, { headers: { 'user-agent': 'Gabarit (GitHub Action, mise a jour hebdomadaire)' } });
  if (!res.ok) throw new Error(`Téléchargement impossible (HTTP ${res.status}) : ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100 || buf.subarray(0, 2).toString('latin1') !== 'PK') {
    throw new Error(`Le fichier reçu n'est pas un tableur (zip) : ${url} (${buf.length} octets, type ${res.headers.get('content-type')})`);
  }
  const file = join(dir, `source-${i}`);
  writeFileSync(file, buf);
  return file;
}

/** Lettre de colonne du tableur : 0 → A, 26 → AA. */
const col = (i) => (i < 26 ? '' : String.fromCharCode(64 + Math.floor(i / 26))) + String.fromCharCode(65 + (i % 26));
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Une aire en une ligne de journal. */
function sample(a) {
  const places = [a.freePlaces ? `${a.freePlaces} gratuites` : null, a.paidPlaces ? `${a.paidPlaces} payantes` : null]
    .filter(Boolean).join(' + ') || (a.hgvPlaces ? `${a.hgvPlaces} places` : 'places ?');
  return `${a.name}${a.city ? ` (${a.city})` : ''} — ${a.lat}, ${a.lon} — ${[a.road, a.direction].filter(Boolean).join(' → ') || 'route ?'}`
    + ` — ${places}${a.secure === true ? ', sécurisé' : ''}${a.operator ? ` — ${a.operator}` : ''} [${a.id}]`;
}

function convert(file, source) {
  console.log(`\n── ${source.network} : ${source.url}`);
  const sheets = readSheets(file, source.format);
  console.log(`Feuilles : ${sheets.map((s) => `${s.name} (${s.rows.length} lignes)`).join(', ') || 'aucune'}`);
  const areas = [];
  const errors = [];
  for (const sheet of sheets) {
    try {
      const r = rowsToAreas(sheet.rows, { network: source.network, prefix: PREFIX[source.network] ?? 'OFF' });
      console.log(`Feuille « ${sheet.name} »`);
      for (const line of r.preamble) console.log(`  au-dessus des titres : ${line}`);
      console.log(`  titres (ligne ${r.headerRow + 1}) : ${r.headers.map((h, i) => (h ? `${col(i)} « ${h} »` : null)).filter(Boolean).join(', ')}`);
      console.log(`  colonnes retenues : ${Object.entries(r.map).map(([f, i]) => `${f} = ${col(i)}`).join(', ')}`);
      console.log(`  aires lues : ${r.areas.length} ; lignes ignorées : ${r.skipped}`
        + `${r.skipped ? ` (${Object.entries(r.reasons).map(([why, n]) => `${why} : ${n}`).join(', ')})` : ''}`);
      for (const a of r.areas.slice(0, 3)) console.log(`  exemple : ${sample(a)}`);
      areas.push(...r.areas);
    } catch (err) {
      errors.push(`feuille « ${sheet.name} » : ${err.message}`);
    }
  }
  for (const e of errors) console.log(`  (feuille ignorée) ${e}`);
  if (!areas.length) throw new Error(`Aucune aire lue.\n  ${errors.join('\n  ') || 'Tableur vide.'}`);
  return { areas, rows: sheets.reduce((n, s) => n + s.rows.length, 0) };
}

async function main() {
  const local = process.argv.slice(2);
  const dir = mkdtempSync(join(tmpdir(), 'aires-pl-'));
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
  try {
    const files = [];
    const all = new Map();
    const failed = [];
    const add = (a) => {
      let id = a.id;
      for (let k = 2; all.has(id); k += 1) id = `${a.id}_${k}`; // identifiant répété dans le tableur
      all.set(id, { ...a, id });
    };
    // Chaque fichier à part : si l'un échoue, l'autre est gardé (et l'ancienne copie du fichier en échec, s'il y en a une).
    for (const [i, source] of OFFICIAL.FILES.entries()) {
      try {
        const file = local[i] ?? await download(source.url, dir, i);
        const { areas, rows } = convert(file, source);
        for (const a of areas) add(a);
        files.push({ url: source.url, network: source.network, rows, areas: areas.length });
      } catch (err) {
        console.log(`\n✘ ${source.network} : ÉCHEC — ${err.message}`);
        const kept = (prev?.areas ?? []).filter((a) => a.network === source.network);
        if (kept.length) console.log(`  ${plural(kept.length, 'aire')} de la copie précédente gardée${kept.length > 1 ? 's' : ''}.`);
        for (const a of kept) add(a);
        failed.push(source.network);
        files.push({ url: source.url, network: source.network, error: err.message.split('\n')[0].slice(0, 200), kept: kept.length });
      }
    }
    if (failed.length === OFFICIAL.FILES.length) throw new Error('les deux fichiers ont échoué (voir ci-dessus).');
    const areas = [...all.values()].sort((a, b) => a.id.localeCompare(b.id));
    const check = parseOfficialData({ areas });
    if (check.areas.length !== areas.length) {
      throw new Error(`${areas.length - check.areas.length} aire(s) refusée(s) par l'appli (position hors de France ?).`);
    }
    const doc = { source: OFFICIAL.SOURCE, licence: OFFICIAL.LICENCE, updated: new Date().toISOString(), files, areas };
    const same = prev && JSON.stringify({ ...prev, updated: null }) === JSON.stringify({ ...doc, updated: null });
    console.log(`\nTotal : ${plural(areas.length, 'aire')} (${files.map((f) => `${f.network} ${f.error ? 'en échec' : f.areas}`).join(', ')}).`);
    if (failed.length) {
      console.log(`⚠ Fichier en échec : ${failed.join(', ')} — l'autre est enregistré.`);
      // Avertissement affiché sur la page du passage de l'Action (annotation GitHub).
      if (process.env.GITHUB_ACTIONS) console.log(`::warning::Aires PL : fichier ${failed.join(', ')} en échec, l'autre est enregistré.`);
    }
    if (same) {
      console.log('Aucun changement : data/aires-pl.json conservé.');
      return;
    }
    writeFileSync(OUT, `${JSON.stringify(doc, null, 1)}\n`);
    console.log('data/aires-pl.json écrit.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\nÉCHEC : ${err.message}`);
  process.exit(1);
});
