// Copie de la Base nationale des ZFE dans data/zfe.json (phase 5).
// Lancé par .github/workflows/zfe.yml (chaque semaine, ou à la main) ; Node 22, sans dépendance npm.
//
//   node tools/zfe-update.mjs                              télécharge les fichiers indiqués par data.gouv.fr
//   node tools/zfe-update.mjs aires.geojson voies.geojson ids.csv [AAAA-MM-JJ]   lit des fichiers locaux
//                                                   (date de mise à jour de la base, facultative)
//
// Les adresses des fichiers changent à chaque mise à jour de la base : elles sont lues dans la fiche du jeu de
// données (API publique de data.gouv.fr). Échec (téléchargement, aucune zone lue) : data/zfe.json n'est pas touché,
// code de sortie 1. voies.geojson est facultatif (en échec : zones seules, avertissement).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertBnzfe, parseZfeIds } from '../src/lib/zfe-convert.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'data', 'zfe.json');
const DATASET = 'https://www.data.gouv.fr/api/1/datasets/base-nationale-consolidee-des-zones-a-faibles-emissions/';
const UA = { 'user-agent': 'Gabarit (GitHub Action, mise a jour hebdomadaire)' };

async function get(url, as = 'json') {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Téléchargement impossible (HTTP ${res.status}) : ${url}`);
  return as === 'json' ? res.json() : res.text();
}

function pick(resources, test) {
  return resources.find((r) => test(`${r.title ?? ''} ${r.url ?? ''}`.toLowerCase())) ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  let aires; let voies = null; let ids = new Map(); let updated = null;
  if (args.length) {
    aires = JSON.parse(readFileSync(args[0], 'utf8'));
    if (args[1]) voies = JSON.parse(readFileSync(args[1], 'utf8'));
    if (args[2]) ids = parseZfeIds(readFileSync(args[2], 'utf8'));
    if (/^\d{4}-\d{2}-\d{2}$/.test(args[3] ?? '')) updated = args[3];
  } else {
    const ds = await get(DATASET);
    const res = Array.isArray(ds?.resources) ? ds.resources : [];
    console.log(`Jeu : ${ds?.title ?? '?'} — licence ${ds?.license ?? '?'} — mis à jour ${ds?.last_update ?? '?'}`);
    for (const r of res) console.log(`  ressource « ${r.title} » (${r.format}) : ${r.url}`);
    const a = pick(res, (t) => t.includes('aires') && t.includes('geojson'));
    const v = pick(res, (t) => t.includes('voies') && t.includes('geojson'));
    const i = pick(res, (t) => t.includes('identifiant') || t.includes('zfe_ids'));
    if (!a) throw new Error('Ressource aires.geojson introuvable dans la fiche du jeu de données.');
    aires = await get(a.url);
    updated = (a.last_modified ?? ds.last_update ?? '').slice(0, 10) || null;
    if (v) {
      try { voies = await get(v.url); } catch (err) { console.log(`⚠ voies.geojson : ${err.message} (zones seules)`); }
    } else console.log('⚠ voies.geojson absent de la fiche (zones seules)');
    if (i) {
      try { ids = parseZfeIds(await get(i.url, 'text')); } catch (err) { console.log(`⚠ identifiants : ${err.message}`); }
    }
  }
  const { data, log } = convertBnzfe(aires, voies, ids, { updated });
  for (const line of log) console.log(line);
  for (const z of data.zones) {
    console.log(`  ${z.id} — ${z.name} — du ${z.start} au ${z.end ?? '…'} — PL ${z.pl.critair ?? 'sans restriction'} (${z.pl.hours || 'horaires ?'})`);
  }
  if (!data.zones.length) throw new Error('Aucune zone lue : data/zfe.json garde l\'ancienne copie.');
  if (existsSync(OUT)) {
    const old = JSON.parse(readFileSync(OUT, 'utf8'));
    if (old.zones?.length && data.zones.length < old.zones.length / 2) {
      console.log(`⚠ Beaucoup moins de zones qu'avant (${data.zones.length} contre ${old.zones.length}).`);
    }
  }
  writeFileSync(OUT, `${JSON.stringify(data)}\n`);
  console.log(`Écrit : data/zfe.json (${data.zones.length} zones, ${data.voies.length} tronçons).`);
}

main().catch((err) => {
  console.error(`Échec : ${err.message}`);
  process.exit(1);
});
