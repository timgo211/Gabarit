// Copie des communes soumises à l'obligation d'équipements d'hiver (loi Montagne, phase 5f) dans data/hiver/.
// Lancé par .github/workflows/hiver.yml (chaque 15 octobre, à la main, et à chaque envoi qui modifie l'outil) ;
// Node 22, sans dépendance npm. Le tableur (xlsx) est une archive zip : décompressée avec `unzip`.
//
//   node tools/hiver-update.mjs                          télécharge la liste et les contours (WINTER_DATA)
//   node tools/hiver-update.mjs liste.xlsx contours.geojson[.gz] …   fichiers locaux (contours dans l'ordre de priorité)
//   node tools/hiver-update.mjs --austria                lit KFG § 102 (RIS, Autriche) et l'écrit dans le journal
//
// Journal : titres lus, nombre de communes (entières / en partie), départements, codes INSEE sans contour (liste).
// Code de sortie 1 (rien n'est écrit, l'ancienne copie reste) si la liste est illisible ou si plus de 2 % des codes
// INSEE n'ont pas de contour.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSharedStrings, parseXlsxSheet } from '../src/lib/areas-official.js';
import { WINTER_DATA, parseCommuneList, buildTiles, buildIndex } from '../src/lib/winter-convert.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'data', 'hiver');
const UA = { 'user-agent': 'Gabarit (GitHub Action, copie annuelle)' };

const unzipList = (f) => execFileSync('unzip', ['-Z1', f], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').filter(Boolean);
const unzipRead = (f, e) => execFileSync('unzip', ['-p', f, e], { encoding: 'utf8', maxBuffer: 256 << 20 });

async function download(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Téléchargement impossible (HTTP ${res.status}) : ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function readSheets(file) {
  const entries = unzipList(file);
  const shared = entries.includes('xl/sharedStrings.xml') ? parseSharedStrings(unzipRead(file, 'xl/sharedStrings.xml')) : [];
  return entries.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e)).sort()
    .map((e) => ({ name: e, rows: parseXlsxSheet(unzipRead(file, e), shared) }));
}

/** Autriche : KFG 1967 § 102 (équipements d'hiver des camions), lu sur le RIS. Journal seulement. */
async function austria() {
  const url = 'https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10011384&Paragraf=102';
  const res = await fetch(url, { headers: UA });
  console.log(`RIS KFG § 102 : HTTP ${res.status} (${url})`);
  const t = (await res.text()).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const m = /Fassung vom [0-9.]+/.exec(t);
  if (m) console.log(m[0]);
  for (const w of ['(8a)', 'Winterreifen', 'Schneeketten']) {
    let i = t.indexOf(w);
    let n = 0;
    while (i >= 0 && n < 3) { console.log(`… ${t.slice(Math.max(0, i - 300), i + 1200)} …\n`); i = t.indexOf(w, i + 1500); n += 1; }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--austria') { await austria(); return; }
  const dir = mkdtempSync(join(tmpdir(), 'hiver-'));
  try {
    const xlsx = join(dir, 'liste.xlsx');
    writeFileSync(xlsx, args[0] ? readFileSync(args[0]) : await download(WINTER_DATA.LIST_URL));
    if (readFileSync(xlsx).subarray(0, 2).toString('latin1') !== 'PK') throw new Error('La liste reçue n\'est pas un tableur xlsx.');
    const sheets = readSheets(xlsx);
    let list = null;
    for (const s of sheets) {
      const l = parseCommuneList(s.rows);
      console.log(`${s.name} : ${s.rows.length} lignes, titres ${l.header ? JSON.stringify(l.header) : 'non trouvés'}`);
      if (l.communes.length > (list?.communes.length ?? 0)) list = l;
    }
    if (!list?.communes.length) throw new Error('Aucune commune lue (colonnes « Nom Commune » / « Code INSEE Commune » absentes).');
    const partial = list.communes.filter((c) => c.partial).length;
    console.log(`Communes : ${list.communes.length} (${list.communes.length - partial} entières, ${partial} en partie) ; lignes ignorées : ${list.skipped.length}${list.skipped.length ? ` (${list.skipped.slice(0, 20).join(' ; ')})` : ''}`);

    // Contours : premier millésime qui a le code (2022, sinon 2021).
    const contours = new Map();
    const sources = args.length > 1 ? args.slice(1) : WINTER_DATA.CONTOURS_URLS;
    for (const src of sources) {
      let buf = /^https:/.test(src) ? await download(src) : readFileSync(src);
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
      const gj = JSON.parse(buf.toString('utf8'));
      let n = 0;
      for (const f of gj.features ?? []) {
        const code = String(f?.properties?.code ?? f?.properties?.insee ?? '');
        if (code && !contours.has(code) && f.geometry) { contours.set(code, { name: f.properties.nom ?? '', geometry: f.geometry }); n += 1; }
      }
      console.log(`Contours ${src} : ${gj.features?.length ?? 0} communes, ${n} ajoutées`);
    }
    const { tiles, missing, placed } = buildTiles(list.communes, contours);
    const share = missing.length / list.communes.length;
    console.log(`Placées : ${placed} ; sans contour : ${missing.length} (${(share * 100).toFixed(2)} %)`);
    for (const c of missing) console.log(`  sans contour : ${c.code} ${c.name} (${c.dept})`);
    if (share > WINTER_DATA.MAX_MISSING) {
      throw new Error(`Plus de ${WINTER_DATA.MAX_MISSING * 100} % des codes INSEE sans contour : rien n'est écrit.`);
    }
    const index = buildIndex({ updated: new Date().toISOString().slice(0, 10), communes: list.communes, tiles, missing });
    console.log(`Départements : ${index.departments.length} (${index.departments.join(', ')}) ; cases : ${Object.keys(tiles).length}`);
    mkdirSync(OUT, { recursive: true });
    for (const f of readdirSync(OUT)) if (f.endsWith('.json')) rmSync(join(OUT, f));
    let bytes = 0;
    for (const [k, items] of Object.entries(tiles)) {
      const s = JSON.stringify({ communes: items });
      bytes += s.length;
      writeFileSync(join(OUT, `${k}.json`), s);
    }
    writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
    console.log(`Écrit : ${Object.keys(tiles).length} cases, ${(bytes / 1e6).toFixed(2)} Mo, + index.json`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`Échec : ${e.message}`);
  process.exitCode = 1;
});

