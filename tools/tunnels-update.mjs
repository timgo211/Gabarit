// Copie des tunnels signalés aux matières dangereuses (OpenStreetMap) dans data/tunnels-adr.json (phase 5b).
// Lancé par .github/workflows/tunnels.yml (chaque semaine, à la main, ou quand ce fichier change) ; Node 22, sans
// dépendance npm ; osmium-tool installé par l'Action (apt).
//
//   node tools/tunnels-update.mjs                        télécharge les extraits Geofabrik et les filtre (osmium)
//   node tools/tunnels-update.mjs fichier.osm[.pbf] …    filtre des fichiers OSM locaux (essai en local)
//   node tools/tunnels-update.mjs --known                recoupement des trois tunnels gardés en dur seulement
//
// Un pays en échec (téléchargement, osmium) : data/tunnels-adr.json n'est pas touché (ancienne copie gardée, aucune
// copie partielle), code de sortie 1. Le journal donne la taille du fichier et le recoupement des tunnels de
// Fourvière, du Fréjus et du Mont-Blanc (catégories Bison Futé) avec OpenStreetMap (API principale d'OSM et Nominatim).

import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  convertTunnels, crossCheck, elementsFromGeojsonSeq, knownTubesFromMap, osmiumFilter, KNOWN_PROBES, TUNNELS_CONVERT,
} from '../src/lib/tunnels-convert.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'data', 'tunnels-adr.json');
const UA = 'Gabarit (GitHub Action, mise a jour hebdomadaire)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Voies en tunnel portant hazmat d'un fichier OSM (osmium tags-filter puis export GeoJSON). */
function filterFile(file, dir) {
  const kept = join(dir, 'hazmat.osm.pbf');
  const seq = join(dir, 'hazmat.geojsonseq');
  execFileSync('osmium', ['tags-filter', '--overwrite', '-o', kept, file, ...osmiumFilter()], { stdio: 'inherit' });
  execFileSync('osmium', ['export', '--overwrite', '-f', 'geojsonseq', '--add-unique-id=type_id',
    '--geometry-types=linestring', '-o', seq, kept], { stdio: 'inherit' });
  const elements = elementsFromGeojsonSeq(readFileSync(seq, 'utf8'));
  rmSync(kept, { force: true });
  rmSync(seq, { force: true });
  return elements;
}

/** Date de l'extrait (en-tête osmosis_replication_timestamp du fichier .pbf), ou null. */
function extractDate(file) {
  try {
    const v = execFileSync('osmium', ['fileinfo', '-g', 'header.option.osmosis_replication_timestamp', file], { encoding: 'utf8' }).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  } catch {
    return null;
  }
}

async function download(url, file) {
  for (let i = 0; i < 3; i += 1) {
    if (i) await sleep(30000 * i);
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
      return;
    } catch (err) {
      console.log(`⚠ téléchargement ${url} (essai ${i + 1}) : ${err.message}`);
    }
  }
  throw new Error(`Téléchargement impossible : ${url} — data/tunnels-adr.json non modifié (pas de copie partielle).`);
}

/** Tubes des trois tunnels gardés en dur, lus dans l'API principale d'OSM (sans Overpass). */
async function known() {
  for (const probe of KNOWN_PROBES) {
    const [w, s, e, n] = TUNNELS_CONVERT.KNOWN_BBOX[probe.id];
    try {
      const found = new Map();
      // Recherche par nom (Nominatim, une requête par seconde au plus), puis chaque voie trouvée avec ses nœuds.
      for (const q of probe.search) {
        try {
          await sleep(1500);
          const hits = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&q=${encodeURIComponent(q)}`);
          console.log(`  Nominatim « ${q} » : ${(Array.isArray(hits) ? hits : []).map((h) => `${h.osm_type} ${h.osm_id} (${h.category}/${h.type})`).join(', ') || 'aucun résultat'}`);
          for (const h of Array.isArray(hits) ? hits : []) {
            if (h.osm_type !== 'way') continue;
            await sleep(1500);
            const full = await getJson(`https://api.openstreetmap.org/api/0.6/way/${h.osm_id}/full.json`);
            const way = full.elements?.find((x) => x.type === 'way');
            console.log(`    w${h.osm_id} : ${JSON.stringify(way?.tags ?? {})}`);
            for (const t of knownTubesFromMap(full, probe.name)) found.set(t.id, t);
          }
        } catch (err) {
          console.log(`⚠ recherche ${probe.label} : ${err.message}`);
        }
      }
      // Emprise autour du tunnel ; refusée en ville (trop de nœuds) : découpée en quatre, deux fois au plus.
      const boxes = [[w, s, e, n, 0]];
      while (boxes.length) {
        const [bw, bs, be, bn, depth] = boxes.shift();
        try {
          await sleep(1000);
          for (const t of knownTubesFromMap(await getJson(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bw},${bs},${be},${bn}`), probe.name)) found.set(t.id, t);
        } catch (err) {
          if (depth < 2) {
            const mx = (bw + be) / 2; const my = (bs + bn) / 2;
            boxes.push([bw, bs, mx, my, depth + 1], [mx, bs, be, my, depth + 1], [bw, my, mx, bn, depth + 1], [mx, my, be, bn, depth + 1]);
          } else console.log(`⚠ emprise ${probe.label} ${[bw, bs, be, bn].map((x) => x.toFixed(4)).join(',')} : ${err.message}`);
        }
      }
      const tubes = [...found.values()];
      console.log(`Recoupement OSM (API) — ${probe.label} (Bison Futé : ${probe.cat}) : ${tubes.length ? '' : 'aucun tube trouvé'}`);
      for (const t of tubes) console.log(`  ${t.id} « ${t.name} » catégorie OSM ${t.cat ?? 'non renseignée'} ; tracé ${JSON.stringify(t.g)}`);
    } catch (err) {
      console.log(`⚠ recoupement ${probe.label} : ${err.message}`);
    }
    await sleep(2000);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--known') { await known(); return; }
  const dir = mkdtempSync(join(tmpdir(), 'tunnels-'));
  const seen = new Map();
  let updated = null;
  try {
    if (args.length) {
      for (const f of args) for (const e of filterFile(f, dir)) seen.set(e.id, e);
    } else {
      for (const region of TUNNELS_CONVERT.GEOFABRIK) {
        const url = `https://download.geofabrik.de/${region}-latest.osm.pbf`;
        const file = join(dir, 'pays.osm.pbf');
        const t0 = Date.now();
        await download(url, file);
        const date = extractDate(file);
        if (date && (!updated || date < updated)) updated = date; // date la plus ancienne des extraits
        const elements = filterFile(file, dir);
        rmSync(file, { force: true });
        for (const e of elements) seen.set(e.id, e);
        console.log(`${region} : ${elements.length} voies en tunnel portant hazmat (extrait du ${date ?? '?'}, ${Math.round((Date.now() - t0) / 1000)} s).`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const json = { elements: [...seen.values()] };
  const { data, log } = convertTunnels(json, { updated: updated ?? new Date().toISOString().slice(0, 10) });
  for (const line of log) console.log(line);
  for (const line of crossCheck(json, KNOWN_PROBES)) console.log(`Recoupement — ${line}`);
  if (!data.tunnels.length) throw new Error('Aucun tunnel lu : data/tunnels-adr.json non modifié.');
  const text = `${JSON.stringify(data)}\n`;
  writeFileSync(OUT, text);
  console.log(`data/tunnels-adr.json : ${data.tunnels.length} tubes, ${(Buffer.byteLength(text) / 1024).toFixed(0)} Ko (extraits du ${data.updated}).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
