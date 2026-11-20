// Copie des tunnels signalés aux matières dangereuses (OpenStreetMap) dans data/tunnels-adr.json (phase 5b).
// Lancé par .github/workflows/tunnels.yml (chaque semaine, à la main, ou quand ce fichier change) ; Node 22, sans
// dépendance npm.
//
//   node tools/tunnels-update.mjs                    interroge Overpass (overpass-api.de, puis le serveur de secours)
//   node tools/tunnels-update.mjs reponse.json       lit une réponse Overpass enregistrée (essai en local)
//
// Serveurs publics souvent pleins (502) : jusqu'à 6 essais, attente croissante. Échec : data/tunnels-adr.json n'est
// pas touché (ancienne copie gardée), code de sortie 1. Le journal donne la taille du fichier et le recoupement des
// tunnels de Fourvière, du Fréjus et du Mont-Blanc (catégories Bison Futé) avec OpenStreetMap.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTunnelsQuery, convertTunnels, crossCheck, KNOWN_PROBES, TUNNELS_CONVERT } from '../src/lib/tunnels-convert.js';
import { OVERPASS_ENDPOINTS, overpassBody } from '../src/lib/areas-osm.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'data', 'tunnels-adr.json');
const HEADERS = {
  'user-agent': 'Gabarit (GitHub Action, mise a jour hebdomadaire)',
  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(url, query) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), (TUNNELS_CONVERT.SERVER_TIMEOUT_S + 30) * 1000);
  try {
    const res = await fetch(url, { method: 'POST', body: overpassBody(query), headers: HEADERS, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = JSON.parse(text);
    if (json.remark && /error/i.test(json.remark)) throw new Error(json.remark.slice(0, 200));
    if (!Array.isArray(json.elements)) throw new Error('réponse illisible');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const file = process.argv[2];
  let json = null;
  if (file) json = JSON.parse(readFileSync(file, 'utf8'));
  else {
    const query = buildTunnelsQuery();
    for (let i = 0; i < 6 && !json; i += 1) {
      const url = OVERPASS_ENDPOINTS[i % OVERPASS_ENDPOINTS.length];
      if (i) await sleep(30000 * i);
      const t0 = Date.now();
      try {
        json = await ask(url, query);
        console.log(`Essai ${i + 1} (${url}) : ${json.elements.length} éléments en ${Math.round((Date.now() - t0) / 1000)} s.`);
      } catch (err) {
        console.log(`⚠ essai ${i + 1} (${url}) en échec après ${Math.round((Date.now() - t0) / 1000)} s : ${err.message}`);
      }
    }
  }
  if (!json) throw new Error('Overpass injoignable : data/tunnels-adr.json non modifié.');
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
