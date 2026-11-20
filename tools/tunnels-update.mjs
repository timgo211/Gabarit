// Copie des tunnels signalés aux matières dangereuses (OpenStreetMap) dans data/tunnels-adr.json (phase 5b).
// Lancé par .github/workflows/tunnels.yml (chaque semaine, à la main, ou quand ce fichier change) ; Node 22, sans
// dépendance npm.
//
//   node tools/tunnels-update.mjs                    interroge Overpass, case par case (5°)
//   node tools/tunnels-update.mjs reponse.json       lit une réponse Overpass enregistrée (essai en local)
//
// Serveurs publics souvent pleins (502) : chaque case est demandée aux serveurs TUNNELS_CONVERT.ENDPOINTS, deux tours,
// attente entre deux essais. Une case en échec : data/tunnels-adr.json n'est pas touché (ancienne copie gardée, aucune
// copie partielle), code de sortie 1. Le journal donne la taille du fichier et le recoupement des tunnels de
// Fourvière, du Fréjus et du Mont-Blanc (catégories Bison Futé) avec OpenStreetMap, lu dans l'API principale d'OSM
// (/api/0.6/map), indépendante d'Overpass.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTunnelsQuery, convertTunnels, crossCheck, knownTubesFromMap, tiles, KNOWN_PROBES, TUNNELS_CONVERT,
} from '../src/lib/tunnels-convert.js';
import { overpassBody } from '../src/lib/areas-osm.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'data', 'tunnels-adr.json');
const UA = 'Gabarit (GitHub Action, mise a jour hebdomadaire)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(url, query) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), (TUNNELS_CONVERT.SERVER_TIMEOUT_S + 20) * 1000);
  try {
    const res = await fetch(url, {
      method: 'POST', body: overpassBody(query), signal: ctrl.signal,
      headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = JSON.parse(text);
    if (json.remark && /error|timed out/i.test(json.remark)) throw new Error(json.remark.slice(0, 160));
    if (!Array.isArray(json.elements)) throw new Error('réponse illisible');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function tile(bbox) {
  const query = buildTunnelsQuery(bbox);
  const servers = TUNNELS_CONVERT.ENDPOINTS;
  for (let i = 0; i < servers.length * 2; i += 1) {
    const url = servers[i % servers.length];
    if (i) await sleep(i < servers.length ? 5000 : 30000);
    const t0 = Date.now();
    try {
      const json = await ask(url, query);
      console.log(`Case ${bbox.join(',')} : ${json.elements.length} voies en ${Math.round((Date.now() - t0) / 1000)} s (${new URL(url).host}).`);
      return json;
    } catch (err) {
      console.log(`⚠ case ${bbox.join(',')}, ${new URL(url).host} : ${err.message} après ${Math.round((Date.now() - t0) / 1000)} s`);
    }
  }
  return null;
}

/** Tubes des trois tunnels gardés en dur, lus dans l'API principale d'OSM (sans Overpass). */
async function known() {
  for (const probe of KNOWN_PROBES) {
    const [w, s, e, n] = TUNNELS_CONVERT.KNOWN_BBOX[probe.id];
    try {
      const res = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${w},${s},${e},${n}`, { headers: { 'user-agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tubes = knownTubesFromMap(await res.json(), probe.name);
      console.log(`Recoupement OSM (API) — ${probe.label} (Bison Futé : ${probe.cat}) : ${tubes.length ? '' : 'aucun tube trouvé'}`);
      for (const t of tubes) console.log(`  ${t.id} « ${t.name} » catégorie OSM ${t.cat ?? 'non renseignée'} ; tracé ${JSON.stringify(t.g)}`);
    } catch (err) {
      console.log(`⚠ recoupement ${probe.label} : ${err.message}`);
    }
    await sleep(2000);
  }
}

async function main() {
  const file = process.argv[2];
  let json;
  if (file) json = JSON.parse(readFileSync(file, 'utf8'));
  else {
    await known();
    const seen = new Map();
    let base = null;
    for (const b of tiles()) {
      const part = await tile(b);
      if (!part) throw new Error(`Case ${b.join(',')} injoignable : data/tunnels-adr.json non modifié (pas de copie partielle).`);
      base ??= part.osm3s?.timestamp_osm_base ?? null;
      for (const e of part.elements) seen.set(`${e.type}${e.id}`, e);
      await sleep(3000);
    }
    json = { osm3s: { timestamp_osm_base: base }, elements: [...seen.values()] };
  }
  const updated = (json.osm3s?.timestamp_osm_base ?? new Date().toISOString()).slice(0, 10);
  const { data, log } = convertTunnels(json, { updated });
  for (const line of log) console.log(line);
  for (const line of crossCheck(json, KNOWN_PROBES)) console.log(`Recoupement — ${line}`);
  if (!data.tunnels.length) throw new Error('Aucun tunnel lu : data/tunnels-adr.json non modifié.');
  const text = `${JSON.stringify(data)}\n`;
  writeFileSync(OUT, text);
  console.log(`data/tunnels-adr.json : ${data.tunnels.length} tubes, ${(Buffer.byteLength(text) / 1024).toFixed(0)} Ko (copie OSM du ${updated}).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
