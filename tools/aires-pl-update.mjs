// Copie du jeu officiel des aires de stationnement PL dans data/aires-pl.json (phase 9).
// Lancé par .github/workflows/aires-pl.yml (chaque semaine, ou à la main) ; Node 22, sans dépendance npm.
// Les tableurs (xlsx, ods) sont des archives zip : décompressées avec la commande `unzip` (présente sur GitHub).
//
//   node tools/aires-pl-update.mjs               télécharge les fichiers de OFFICIAL.FILES
//   node tools/aires-pl-update.mjs a.xlsx b.ods  lit des fichiers locaux (même ordre que OFFICIAL.FILES)
//
// Le journal affiche, pour chaque fichier, les en-têtes de colonnes lus, la colonne retenue pour chaque champ et le
// nombre d'aires trouvées. Une colonne attendue (nom, position) absente, un téléchargement raté ou aucune aire lue →
// erreur claire et code de sortie 1 : data/aires-pl.json n'est alors pas modifié.

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

function convert(file, source) {
  console.log(`\n── ${source.network} : ${source.url}`);
  const sheets = readSheets(file, source.format);
  console.log(`Feuilles : ${sheets.map((s) => `${s.name} (${s.rows.length} lignes)`).join(', ') || 'aucune'}`);
  const areas = [];
  const errors = [];
  for (const sheet of sheets) {
    try {
      const r = rowsToAreas(sheet.rows, { network: source.network, prefix: PREFIX[source.network] ?? 'OFF' });
      console.log(`Feuille « ${sheet.name} » — en-têtes lus : ${r.headers.map((h) => `« ${h} »`).join(', ')}`);
      console.log(`  colonnes retenues : ${Object.entries(r.map).map(([f, i]) => `${f} = « ${r.headers[i]} »`).join(', ')}`);
      console.log(`  aires trouvées : ${r.areas.length} (lignes ignorées, sans nom ou position lisible : ${r.skipped})`);
      areas.push(...r.areas);
    } catch (err) {
      errors.push(`feuille « ${sheet.name} » : ${err.message}`);
    }
  }
  if (!areas.length) {
    throw new Error(`Aucune aire lue dans ${source.url}.\n  ${errors.join('\n  ') || 'Tableur vide.'}`);
  }
  for (const e of errors) console.log(`  (ignorée) ${e}`);
  return { areas, rows: sheets.reduce((n, s) => n + s.rows.length, 0) };
}

async function main() {
  const local = process.argv.slice(2);
  const dir = mkdtempSync(join(tmpdir(), 'aires-pl-'));
  try {
    const files = [];
    const all = new Map();
    for (const [i, source] of OFFICIAL.FILES.entries()) {
      const file = local[i] ?? await download(source.url, dir, i);
      const { areas, rows } = convert(file, source);
      for (const a of areas) {
        let id = a.id;
        for (let k = 2; all.has(id); k += 1) id = `${a.id}_${k}`; // identifiant répété dans le tableur
        all.set(id, { ...a, id });
      }
      files.push({ url: source.url, network: source.network, rows, areas: areas.length });
    }
    const areas = [...all.values()].sort((a, b) => a.id.localeCompare(b.id));
    const check = parseOfficialData({ areas });
    if (check.areas.length !== areas.length) {
      throw new Error(`${areas.length - check.areas.length} aire(s) refusée(s) par l'appli (position hors de France ?).`);
    }
    const doc = { source: OFFICIAL.SOURCE, licence: OFFICIAL.LICENCE, updated: new Date().toISOString(), files, areas };
    const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
    const same = prev && JSON.stringify({ ...prev, updated: null }) === JSON.stringify({ ...doc, updated: null });
    console.log(`\nTotal : ${areas.length} aires (${files.map((f) => `${f.network} ${f.areas}`).join(', ')}).`);
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
