// Copie DiaLog (phase 12c) pour l'Action « DiaLog (copie) » (.github/workflows/dialog.yml) : télécharge le XML
// DATEX II de DiaLog, garde les interdictions d'accès avec une limite de hauteur ou de poids (tools/dialog-convert.mjs)
// et écrit data/dialog/ (index.json + une case de 1° par fichier, jamais précachés par le service worker).
// Licence Ouverte 2.0. « DiaLog n'a pas de valeur juridique. Seul l'arrêté fait foi. »
//
// Sûreté : domaines limités (www.data.gouv.fr, static.data.gouv.fr, dialog.beta.gouv.fr), lecteur XML maison en flux
// (DOCTYPE refusé, rien d'évalué, géométrie par JSON.parse), taille limitée. Si le téléchargement, la lecture ou la
// taille échoue : data/dialog/ n'est pas touché, le journal le dit, sortie en échec.
//
// Usage : node tools/dialog-update.mjs            (télécharge, écrit data/dialog/)
//         node tools/dialog-update.mjs fichier.xml (lit un fichier local, pour essai)

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIALOG_URL, feedXml, openStream } from './dialog-etude.mjs';
import { convertDialog, createDialogCollector, dialogLog } from './dialog-convert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_ATTEMPTS = 3;

/** Grille de couverture France reprise de la copie OSM des poids (même parseIndex dans l'appli). */
export function readGrid(path) {
  try { return JSON.parse(readFileSync(path, 'utf8'))?.grid ?? null; } catch { return null; }
}

/**
 * Lit un flux XML et convertit. Lève une erreur si le XML est mal formé.
 * @returns {{ stats:object, result:object, bytes:number }}
 */
export async function convertStream(chunks, { today, grid, limits } = {}) {
  const { handler, measures, stats } = createDialogCollector({ today });
  const bytes = await feedXml(chunks, handler);
  const result = convertDialog(measures, { publication: stats.publicationTime, updated: today, grid, limits });
  return { stats, result, bytes };
}

/**
 * Écrit la copie dans un dossier neuf voisin puis remplace `dir` d'un coup (l'ancien est retiré seulement après
 * l'écriture complète du nouveau).
 */
export function writeCopy(dir, result) {
  const tmp = `${dir}.nouveau`;
  const old = `${dir}.ancien`;
  rmSync(tmp, { recursive: true, force: true });
  rmSync(old, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const [key, tile] of result.tiles) writeFileSync(join(tmp, `${key}.json`), `${JSON.stringify(tile)}\n`);
  writeFileSync(join(tmp, 'index.json'), `${JSON.stringify(result.index)}\n`);
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(tmp, dir);
  rmSync(old, { recursive: true, force: true });
}

/**
 * Une copie complète : lecture, conversion, écriture si tout va bien.
 * @returns {{ ok:boolean, log:string }}
 */
export async function runCopy(chunks, { dir, grid, today, limits } = {}) {
  let out;
  try {
    out = await convertStream(chunks, { today, grid, limits });
  } catch (err) {
    return { ok: false, log: `Copie non remplacée : lecture impossible (${String(err?.message || err).slice(0, 300)}). Les anciens fichiers restent.` };
  }
  const log = [`Fichier lu : ${(out.bytes / 1024 / 1024).toFixed(1)} Mo.`, dialogLog(out.stats, out.result)];
  if (out.result.problem) {
    log.push(`Copie non remplacée : ${out.result.problem}. Les anciens fichiers restent.`);
    return { ok: false, log: log.join('\n') };
  }
  writeCopy(dir, out.result);
  log.push(`Copie écrite : ${out.result.index.count} mesures, ${out.result.tiles.size} cases (data/dialog/).`);
  return { ok: true, log: log.join('\n') };
}

async function main() {
  const t0 = performance.now();
  const today = new Date().toISOString().slice(0, 10);
  console.log(`Copie DiaLog — ${today}. DiaLog n'a pas de valeur juridique : seul l'arrêté fait foi.`);
  const grid = readGrid(join(ROOT, 'data/poids-osm/index.json'));
  const dir = join(ROOT, 'data/dialog');
  const local = process.argv[2];
  let res;
  if (local) res = await runCopy(createReadStream(local), { dir, grid, today });
  else {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      console.log(`\n── essai ${attempt}/${MAX_ATTEMPTS} : ${DIALOG_URL}`);
      let stream;
      try { stream = (await openStream(DIALOG_URL)).body; } catch (err) {
        res = { ok: false, log: `Copie non remplacée : téléchargement impossible (${String(err?.message || err).slice(0, 300)}). Les anciens fichiers restent.` };
        console.log(`   échec : ${res.log}`);
        if (/domaine refusé|pas https/.test(err?.message ?? '')) break;
        continue;
      }
      res = await runCopy(stream, { dir, grid, today });
      if (res.ok || !/lecture impossible/.test(res.log) || /XML /.test(res.log)) break;
    }
  }
  console.log(`\n${res.log}`);
  console.log(`Durée : ${Math.round((performance.now() - t0) / 1000)} s.`);
  if (!res.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
