// Copie mensuelle des données OpenStreetMap lues sans réseau par l'appli : tunnels signalés aux matières dangereuses
// (phase 5b, data/tunnels-adr.json), aires et parkings PL (phase 9b, data/aires-osm/), voies à accès conditionnel
// (phase 5d, data/acces-osm/ : tranches horaires, poids limité par tranche) et réseau des taxes PL régionales
// (phase 5h ter, data/taxes-pl-osm.json : R-Pass et écocontribution du Grand Est, extrait France seulement, découpé
// au cadre des taxes par osmium extract, puis filtré à part : les routes primaires de toute l'Europe ne passent pas
// dans le filtrage commun) et ponts sans hauteur connue (phase 12a, data/ponts-osm/ : extrait France, filtrage à part,
// voir src/lib/bridges-convert.js). Lancé par
// .github/workflows/osm-data.yml (le 1er du mois, à la main, ou quand ce fichier change) ; Node 22, sans dépendance
// npm ; osmium-tool installé par l'Action (apt).
//
// Par pays : un seul téléchargement de l'extrait Geofabrik, un seul filtrage osmium (tunnels hazmat + aires + voies
// conditionnelles), un seul export GeoJSON, lu ligne à ligne et séparé ici en tunnels, aires et voies ; le contour
// .poly de l'extrait donne la zone couverte par la copie des aires et des voies.
//
//   node tools/osm-update.mjs                            télécharge les extraits Geofabrik et les filtre (osmium)
//   node tools/osm-update.mjs fichier.osm[.pbf] …         filtre des fichiers OSM locaux (essai en local ; zone
//                                                         couverte : fichiers .poly passés aussi en arguments)
//   node tools/osm-update.mjs --known                    recoupement des trois tunnels gardés en dur seulement
//
// Un pays en échec (téléchargement, osmium) : rien n'est écrit (ancienne copie des tunnels, aires et voies gardée, aucune
// copie partielle), code de sortie 1. Le journal donne le poids des fichiers, la durée de chaque pays et le
// recoupement des tunnels de Fourvière, du Fréjus et du Mont-Blanc (catégories Bison Futé) avec OpenStreetMap.

import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  convertTunnels, crossCheck, knownTubesFromMap, osmiumFilter, tunnelElementFromFeature, KNOWN_PROBES, TUNNELS_CONVERT,
} from '../src/lib/tunnels-convert.js';
import {
  AREAS_DATA, areaElementFromFeature, buildCoverage, convertAreas, elementKey, parseGeojsonLine, parsePoly,
} from '../src/lib/areas-osm-data.js';
import { accessElementFromFeature, convertAccess, osmiumAccessFilter } from '../src/lib/access-convert.js';
import { tollWayFromFeature } from '../src/lib/hgv-tolls-geo.js';
import { convertTollNetwork, osmiumTollsFilter, tollsBbox } from '../src/lib/hgv-tolls-convert.js';
import { parseTollData } from '../src/lib/hgv-tolls.js';
import {
  BRIDGES, bridgeFromFeature, clearanceFromFeature, convertBridges, osmiumBridgesFilter, sizeProblem,
} from '../src/lib/bridges-convert.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'data', 'tunnels-adr.json');
const AREAS_DIR = join(ROOT, 'data', 'aires-osm');
const ACCESS_DIR = join(ROOT, 'data', 'acces-osm');
const TOLLS_OUT = join(ROOT, 'data', 'taxes-pl-osm.json');
const BRIDGES_DIR = join(ROOT, 'data', 'ponts-osm');
// Réseau des taxes PL : périmètre (cadres, contours IGN, zones exclues) lu dans data/taxes-pl.json.
const TOLL_DATA = parseTollData(JSON.parse(readFileSync(join(ROOT, 'data', 'taxes-pl.json'), 'utf8')));
const TOLL_BBOX = tollsBbox(TOLL_DATA);
const TOLL_REGION = 'europe/france';
// Contours .poly de Geofabrik (© contributeurs OpenStreetMap, ODbL) : secours si leur téléchargement échoue.
const POLY_DIR = join(ROOT, 'data', 'osm-poly');
const POLY_DATES = join(POLY_DIR, 'dates.json');
const UA = 'Gabarit (GitHub Action, mise a jour mensuelle)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Un seul filtrage osmium (tunnels + aires) puis un seul export GeoJSON, lu ligne à ligne (l'export d'un grand pays
 * dépasse la taille maximale d'une chaîne de Node). Les parkings sans hgv=yes/designated ni capacity:hgv sont écartés
 * ici (un filtre osmium hgv=* prendrait toutes les routes ouvertes aux PL).
 */
async function filterFile(file, dir, tunnels, areas, ways) {
  const kept = join(dir, 'kept.osm.pbf');
  const seq = join(dir, 'kept.geojsonseq');
  execFileSync('osmium', ['tags-filter', '--overwrite', '-o', kept, file, ...osmiumFilter(), ...AREAS_DATA.OSMIUM_FILTER, ...osmiumAccessFilter()], { stdio: 'inherit' });
  execFileSync('osmium', ['export', '--overwrite', '-f', 'geojsonseq', '--add-unique-id=type_id', '-o', seq, kept], { stdio: 'inherit' });
  let nt = 0; let na = 0; let nw = 0; let lines = 0;
  const rl = createInterface({ input: createReadStream(seq, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    lines += 1;
    const f = parseGeojsonLine(line);
    if (!f) continue;
    const t = tunnelElementFromFeature(f);
    if (t) { tunnels.set(t.id, t); nt += 1; }
    const a = areaElementFromFeature(f);
    if (a) { areas.set(elementKey(a), a); na += 1; }
    const w = accessElementFromFeature(f);
    if (w) { ways.set(w.id, w); nw += 1; }
  }
  const size = statSync(seq).size;
  rmSync(kept, { force: true });
  rmSync(seq, { force: true });
  return { nt, na, nw, lines, size };
}

/**
 * Réseau des taxes PL (phase 5h ter) : extrait découpé au cadre des taxes (osmium extract -b), routes motorway à
 * tertiary (osmium tags-filter), export GeoJSON lu ligne à ligne ; voies portant une référence gardées
 * (tollWayFromFeature). Lancé sur l'extrait France seulement (et sur chaque fichier local en essai).
 */
async function filterTolls(file, dir, tollWays) {
  if (!TOLL_BBOX) return { n: 0, lines: 0 };
  const box = join(dir, 'taxes-box.osm.pbf');
  const kept = join(dir, 'taxes.osm.pbf');
  const seq = join(dir, 'taxes.geojsonseq');
  execFileSync('osmium', ['extract', '--overwrite', '-s', 'simple', '-b', TOLL_BBOX.join(','), '-o', box, file], { stdio: 'inherit' });
  execFileSync('osmium', ['tags-filter', '--overwrite', '-o', kept, box, ...osmiumTollsFilter()], { stdio: 'inherit' });
  execFileSync('osmium', ['export', '--overwrite', '-f', 'geojsonseq', '--add-unique-id=type_id', '-o', seq, kept], { stdio: 'inherit' });
  let n = 0; let lines = 0;
  const rl = createInterface({ input: createReadStream(seq, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    lines += 1;
    const w = tollWayFromFeature(parseGeojsonLine(line));
    if (w) { tollWays.set(w.id, w); n += 1; }
  }
  for (const f of [box, kept, seq]) rmSync(f, { force: true });
  return { n, lines };
}

/**
 * Ponts et tronçons à hauteur connue (phase 12a) : filtrage osmium à part (ponts et maxheight de toute l'Europe ne
 * tiennent pas dans les limites de taille), export GeoJSON lu ligne à ligne. Pays de BRIDGES.REGIONS seulement (et
 * chaque fichier local en essai).
 */
async function filterBridges(file, dir, bridges, clearances) {
  const kept = join(dir, 'ponts.osm.pbf');
  const seq = join(dir, 'ponts.geojsonseq');
  execFileSync('osmium', ['tags-filter', '--overwrite', '-o', kept, file, ...osmiumBridgesFilter()], { stdio: 'inherit' });
  execFileSync('osmium', ['export', '--overwrite', '-f', 'geojsonseq', '--add-unique-id=type_id', '-o', seq, kept], { stdio: 'inherit' });
  let nb = 0; let nh = 0; let lines = 0;
  const rl = createInterface({ input: createReadStream(seq, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    lines += 1;
    const f = parseGeojsonLine(line);
    if (!f) continue;
    const b = bridgeFromFeature(f);
    if (b) { bridges.set(b.id, b); nb += 1; }
    const h = clearanceFromFeature(f);
    if (h) { clearances.set(h.id, h); nh += 1; }
  }
  const size = statSync(seq).size;
  for (const f of [kept, seq]) rmSync(f, { force: true });
  return { nb, nh, lines, size };
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

// Téléchargements : un délai par essai (une requête bloquée sans réponse ne dure plus 5 min), 5 essais séparés par
// 30 s, 1 min, 2 min puis 4 min (run #9 du 21/11/2026 : spain.poly refusé trois fois, serveur Geofabrik instable).
const TIMEOUT_POLY_MS = 60 * 1000;
const TIMEOUT_PBF_MS = 20 * 60 * 1000;
const RETRY_WAITS_MS = [30000, 60000, 120000, 240000];

async function download(url, file, { timeoutMs = TIMEOUT_PBF_MS } = {}) {
  for (let i = 0; i <= RETRY_WAITS_MS.length; i += 1) {
    if (i) await sleep(RETRY_WAITS_MS[i - 1]);
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(file), { signal });
      return;
    } catch (err) {
      // « fetch failed » cache la vraie raison (connexion refusée, coupée, nom introuvable…) : err.cause l'écrit.
      const cause = err?.cause ? ` (${[err.cause.code, err.cause.message].filter(Boolean).join(' : ')})` : '';
      const why = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? `délai de ${Math.round(timeoutMs / 1000)} s dépassé` : `${err.message}${cause}`;
      console.log(`⚠ téléchargement ${url} (essai ${i + 1}/${RETRY_WAITS_MS.length + 1}) : ${why}`);
    }
  }
  throw new Error(`Téléchargement impossible : ${url} — data/tunnels-adr.json, data/aires-osm/ et data/acces-osm/ non modifiés (pas de copie partielle).`);
}

/**
 * Contour .poly d'un extrait : téléchargé, sinon copie du dépôt (data/osm-poly/, écrite à chaque copie réussie, avec sa
 * date dans dates.json). Les contours téléchargés ne sont enregistrés qu'à la fin, avec les données (rien d'écrit si
 * un pays échoue).
 */
async function loadPoly(region, file, fresh) {
  const name = region.split('/').pop();
  try {
    await download(`https://download.geofabrik.de/${region}.poly`, file, { timeoutMs: TIMEOUT_POLY_MS });
    const text = readFileSync(file, 'utf8');
    fresh.set(name, text);
    return text;
  } catch (err) {
    const copy = join(POLY_DIR, `${name}.poly`);
    if (!existsSync(copy)) throw err;
    const dates = existsSync(POLY_DATES) ? JSON.parse(readFileSync(POLY_DATES, 'utf8')) : {};
    console.log(`⚠ contour ${region}.poly indisponible : copie du dépôt utilisée (data/osm-poly/${name}.poly, copie du ${dates[name] ?? 'date inconnue'}).`);
    return readFileSync(copy, 'utf8');
  }
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

const kb = (n) => `${(n / 1024).toFixed(0)} Ko`;

/**
 * Écrit un dossier de cases (data/aires-osm/, data/acces-osm/) d'un coup : dossier temporaire complet, puis
 * remplacement (aucune case périmée gardée).
 */
function writeTiles(DIR, index, tiles, what) {
  const tmp = `${DIR}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  let total = 0;
  let biggest = ['', 0];
  for (const [key, tile] of tiles) {
    const text = `${JSON.stringify(tile)}\n`;
    writeFileSync(join(tmp, `${key}.json`), text);
    const n = Buffer.byteLength(text);
    total += n;
    if (n > biggest[1]) biggest = [key, n];
  }
  const text = `${JSON.stringify(index)}\n`;
  writeFileSync(join(tmp, 'index.json'), text);
  total += Buffer.byteLength(text);
  rmSync(DIR, { recursive: true, force: true });
  renameSync(tmp, DIR);
  console.log(`data/${DIR.split(/[\\/]/).pop()}/ : ${index.count} ${what}, ${tiles.size} cases + index.json (${kb(Buffer.byteLength(text))}, `
    + `zone couverte ${index.grid.cells} cellules de 0,1°) ; poids total ${(total / 1024 / 1024).toFixed(2)} Mo, `
    + `plus grosse case ${biggest[0]} (${kb(biggest[1])}), ${readdirSync(DIR).length} fichiers.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--known') { await known(); return; }
  const start = Date.now();
  const dir = mkdtempSync(join(tmpdir(), 'osm-'));
  const tunnels = new Map();
  const areas = new Map();
  const ways = new Map();
  const tollWays = new Map();
  const bridges = new Map();
  const clearances = new Map();
  const bridgePolys = [];
  const polys = [];
  const freshPolys = new Map();
  let updated = null;
  try {
    if (args.length) {
      for (const f of args) {
        if (f.endsWith('.poly')) { const p = parsePoly(readFileSync(f, 'utf8')); polys.push(p); bridgePolys.push(p); continue; }
        const r = await filterFile(f, dir, tunnels, areas, ways);
        const t = await filterTolls(f, dir, tollWays);
        const b = await filterBridges(f, dir, bridges, clearances);
        console.log(`${f} : ${b.nb} ponts, ${b.nh} tronçons à hauteur connue (${b.lines} objets exportés).`);
        console.log(`${f} : ${r.nt} voies en tunnel portant hazmat, ${r.na} aires, ${r.nw} voies à accès conditionnel, ${t.n} routes à référence dans le cadre des taxes PL.`);
      }
    } else {
      for (const region of TUNNELS_CONVERT.GEOFABRIK) {
        const url = `https://download.geofabrik.de/${region}-latest.osm.pbf`;
        const file = join(dir, 'pays.osm.pbf');
        const t0 = Date.now();
        await download(url, file);
        const mb = statSync(file).size / 1024 / 1024;
        const t1 = Date.now();
        const polyFile = join(dir, 'pays.poly');
        const poly = parsePoly(await loadPoly(region, polyFile, freshPolys));
        if (!poly.bbox) throw new Error(`Contour illisible : ${region}.poly — data/tunnels-adr.json, data/aires-osm/ et data/acces-osm/ non modifiés.`);
        polys.push(poly);
        const date = extractDate(file);
        if (date && (!updated || date < updated)) updated = date; // date la plus ancienne des extraits
        const r = await filterFile(file, dir, tunnels, areas, ways);
        if (BRIDGES.REGIONS.includes(region)) {
          const t4 = Date.now();
          const b = await filterBridges(file, dir, bridges, clearances);
          bridgePolys.push(poly);
          console.log(`${region} : ${b.nb} ponts, ${b.nh} tronçons à hauteur connue (${b.lines} objets exportés, `
            + `${(b.size / 1024 / 1024).toFixed(0)} Mo de GeoJSON, ${Math.round((Date.now() - t4) / 1000)} s).`);
        }
        if (region === TOLL_REGION) {
          const t3 = Date.now();
          const t = await filterTolls(file, dir, tollWays);
          console.log(`${region} : ${t.n} routes à référence dans le cadre des taxes PL ${TOLL_BBOX.join(',')} (${t.lines} objets exportés, ${Math.round((Date.now() - t3) / 1000)} s).`);
        }
        rmSync(file, { force: true });
        console.log(`${region} : ${r.nt} voies en tunnel portant hazmat, ${r.na} aires, ${r.nw} voies à accès conditionnel (extrait du ${date ?? '?'}, `
          + `${mb.toFixed(0)} Mo téléchargés en ${Math.round((t1 - t0) / 1000)} s, filtrage + export ${Math.round((Date.now() - t1) / 1000)} s, `
          + `${r.lines} objets exportés, ${(r.size / 1024 / 1024).toFixed(0)} Mo de GeoJSON).`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const day = updated ?? new Date().toISOString().slice(0, 10);
  // Tunnels
  const json = { elements: [...tunnels.values()] };
  const { data, log } = convertTunnels(json, { updated: day });
  for (const line of log) console.log(line);
  for (const line of crossCheck(json, KNOWN_PROBES)) console.log(`Recoupement — ${line}`);
  // Aires
  const t2 = Date.now();
  const grid = buildCoverage(polys);
  const countries = TUNNELS_CONVERT.GEOFABRIK.map((c) => c.split('/').pop());
  const conv = convertAreas([...areas.values()], { updated: day, grid, countries });
  for (const line of conv.log) console.log(line);
  console.log(`Zone couverte : grille ${grid.cols} × ${grid.rows}, ${grid.cells} cellules couvertes (${Math.round((Date.now() - t2) / 1000)} s).`);
  // Voies à accès conditionnel (phase 5d)
  const acc = convertAccess([...ways.values()], { updated: day, grid, countries });
  for (const line of acc.log) console.log(line);
  // Réseau des taxes PL (phase 5h ter) : journal par référence (km avant découpage, km gardés après
  // découpage, km exclus pour péage poids lourd), total ECPL, répartition toll / toll:hgv de l'A31 au sud de Toul.
  const tolls = convertTollNetwork([...tollWays.values()], TOLL_DATA, { updated: day });
  for (const line of tolls.log) console.log(line);
  const tollTaxes = Object.keys(tolls.json.taxes);
  const tollsMissing = TOLL_DATA.taxes.filter((t) => !tolls.json.taxes[t.id]).map((t) => t.short);
  // Rien n'est écrit si l'un des jeux est vide (ancienne copie gardée).
  if (!data.tunnels.length) throw new Error('Aucun tunnel lu : data/tunnels-adr.json, data/aires-osm/ et data/acces-osm/ non modifiés.');
  if (!conv.index.count || !grid.cells) throw new Error('Aucune aire ou zone couverte vide : data/tunnels-adr.json, data/aires-osm/ et data/acces-osm/ non modifiés.');
  if (!acc.index.count) throw new Error('Aucune voie à accès conditionnel lue : data/tunnels-adr.json, data/aires-osm/ et data/acces-osm/ non modifiés.');
  // Copie complète : chaque taxe doit avoir son réseau. Essai local (fichiers en arguments) : réseau écrit seulement
  // s'il contient toutes les taxes, sinon avertissement.
  if (tollsMissing.length && !args.length) throw new Error(`Réseau des taxes PL vide (${tollsMissing.join(', ')}) : aucune donnée OSM modifiée.`);
  const text = `${JSON.stringify(data)}\n`;
  writeFileSync(OUT, text);
  console.log(`data/tunnels-adr.json : ${data.tunnels.length} tubes, ${kb(Buffer.byteLength(text))} (extraits du ${data.updated}).`);
  writeTiles(AREAS_DIR, conv.index, conv.tiles, 'aires');
  writeTiles(ACCESS_DIR, acc.index, acc.tiles, 'voies à accès conditionnel');
  if (!tollsMissing.length) {
    const tt = `${JSON.stringify(tolls.json)}\n`;
    writeFileSync(TOLLS_OUT, tt);
    console.log(`data/taxes-pl-osm.json : ${tollTaxes.join(', ')}, ${kb(Buffer.byteLength(tt))} (extraits du ${day}).`);
  } else console.log(`⚠ data/taxes-pl-osm.json non modifié : réseau absent pour ${tollsMissing.join(', ')}.`);
  // Ponts (phase 12a) : écrits seulement si la copie tient dans les limites (5 Mo par fichier, 60 Mo en tout) ;
  // sinon ancienne copie gardée, sans bloquer les autres données.
  if (bridges.size) {
    const bconv = convertBridges([...bridges.values()], [...clearances.values()], {
      updated: day, grid: buildCoverage(bridgePolys), countries: BRIDGES.REGIONS.map((c) => c.split('/').pop()),
    });
    for (const line of bconv.log) console.log(line);
    const problem = sizeProblem(bconv.sizes);
    if (problem) console.log(`⚠ data/ponts-osm/ non modifié : ${problem}.`);
    else writeTiles(BRIDGES_DIR, bconv.index, bconv.tiles, 'ponts et tronçons à hauteur');
  } else console.log('⚠ data/ponts-osm/ non modifié : aucun pont lu.');
  if (freshPolys.size) {
    mkdirSync(POLY_DIR, { recursive: true });
    const dates = existsSync(POLY_DATES) ? JSON.parse(readFileSync(POLY_DATES, 'utf8')) : {};
    const today = new Date().toISOString().slice(0, 10);
    for (const [name, text] of freshPolys) { writeFileSync(join(POLY_DIR, `${name}.poly`), text); dates[name] = today; }
    writeFileSync(POLY_DATES, `${JSON.stringify(dates, null, 1)}\n`);
    console.log(`data/osm-poly/ : ${freshPolys.size} contours enregistrés (copie de secours du ${today}).`);
  }
  console.log(`Durée totale : ${Math.round((Date.now() - start) / 60000)} min.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
