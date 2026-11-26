// Contours IGN Admin Express (COG, millésime le plus récent publié en WFS par la Géoplateforme) pour les taxes PL
// régionales (phase 5h ter, data/taxes-pl.json) : Bas-Rhin (67) et Haut-Rhin (68), région Grand Est (44),
// Meurthe-et-Moselle (54), Eurométropole de Strasbourg (EPCI 246700488). v76 (PR 1 du contournement de Lyon) :
// aussi la Métropole de Lyon (couche epci, cherchée par son nom, jamais par un code deviné ; code lu écrit dans
// props.metropoleLyon), limite de la desserte locale des sections lyon-a6 / lyon-a7 ; facultative : absente ou
// ambiguë → clé non écrite, les autres contours restent écrits. Lancé par l'Action « Contours IGN »
// (.github/workflows/contours-ign.yml) : data.geopf.fr est bloqué depuis le conteneur de développement.
// Simplification Douglas-Peucker en mètres (projection locale) : 150 m (départements, région), 50 m (Eurométropole,
// Métropole de Lyon),
// comme les contours COG 2018 actuels ; coordonnées à 4 décimales (≈ 10 m). Seuls les anneaux extérieurs sont gardés
// (pointInTax ne lit que des anneaux extérieurs). Écrit data/contours-ign.json ; le journal donne le millésime, le
// nombre de points et la taille. Licence Ouverte (Etalab 2.0), © IGN.
//
// Zones des grandes agglomérations (Île-de-France, métropoles) : data/zones-agglo.json, fichier à part (logique et
// simplification dans tools/zones-agglo.mjs), jamais dans data/contours-ign.json, dont les clés ne changent pas.
//
// Usage : node tools/contours-ign.mjs [sortie] [sortie des zones]
import { writeFile } from 'node:fs/promises';
import { ZONES, buildZones, rings } from './zones-agglo.mjs';

const WFS = 'https://data.geopf.fr/wfs/ows';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) Gabarit (contours IGN Admin Express)';
const out = process.argv[2] ?? 'data/contours-ign.json';
const outZones = process.argv[3] ?? 'data/zones-agglo.json';

async function get(url, type = 'text') {
  for (let i = 1; i <= 4; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return type === 'json' ? await res.json() : await res.text();
    } catch (err) {
      console.log(`  essai ${i} : ${url.slice(0, 160)} → ${err.message}`);
      if (i === 4) throw err;
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
  return null;
}

/** Millésime : couches ADMINEXPRESS-COG.<année> des capacités WFS, la plus récente ; sinon .LATEST. */
async function pickLayerPrefix() {
  const caps = await get(`${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities`);
  const names = [...new Set([...caps.matchAll(/<(?:wfs:)?Name>(ADMINEXPRESS-COG[^<:]*):([^<]+)<\/(?:wfs:)?Name>/g)].map((m) => `${m[1]}:${m[2]}`))];
  console.log(`Couches Admin Express COG : ${names.filter((n) => /:(departement|region|epci)$/.test(n)).join(', ') || 'aucune'}`);
  const years = names.map((n) => n.match(/^ADMINEXPRESS-COG\.(\d{4}):departement$/)?.[1]).filter(Boolean).map(Number).sort();
  for (const n of ['ADMINEXPRESS-COG.LATEST:departement', `ADMINEXPRESS-COG.${years.at(-1)}:departement`]) {
    const i = caps.indexOf(n);
    if (i >= 0) console.log(`Capacités (${n}) : ${caps.slice(i, i + 900).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')}`);
  }
  if (!years.length) return { prefix: 'ADMINEXPRESS-COG.LATEST', year: null };
  return { prefix: `ADMINEXPRESS-COG.${years.at(-1)}`, year: years.at(-1) };
}

async function features(prefix, layer, filter) {
  const url = `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${encodeURIComponent(`${prefix}:${layer}`)}`
    + `&OUTPUTFORMAT=${encodeURIComponent('application/json')}&SRSNAME=EPSG:4326&CQL_FILTER=${encodeURIComponent(filter)}`;
  const j = await get(url, 'json');
  const list = j?.features ?? [];
  console.log(`${layer} [${filter}] : ${list.length} objet(s) ; propriétés ${JSON.stringify(list[0]?.properties ?? {}).slice(0, 300)}`);
  return list;
}

const { prefix, year } = await pickLayerPrefix();
console.log(`Millésime retenu : ${prefix}${year ? '' : ' (année non lue dans les capacités)'}`);
const dep = await features(prefix, 'departement', "code_insee IN ('67','68','54')");
const reg = await features(prefix, 'region', "code_insee='44'");
const epci = await features(prefix, 'epci', "code_siren='246700488'");
// Métropole de Lyon : nom exact d'abord, sinon les noms qui contiennent « Lyon » (journal) et un seul « Métropole de
// Lyon » gardé. Filtre refusé par le service (propriété absente) : journal, rien de plus.
async function metropoleLyon() {
  const tries = ["nom_officiel='Métropole de Lyon'", "nom_officiel LIKE '%Lyon%'"];
  for (const filter of tries) {
    let list = [];
    try { list = await features(prefix, 'epci', filter); } catch (err) { console.log(`epci [${filter}] : ${err.message}`); continue; }
    for (const f of list) console.log(`  epci : ${JSON.stringify(f.properties ?? {}).slice(0, 300)}`);
    const exact = list.filter((f) => /^Métropole de Lyon$/i.test(String(f.properties?.nom_officiel ?? '').trim()));
    if (exact.length === 1) return exact;
    if (list.length) { console.log(`Métropole de Lyon : ${exact.length} objet(s) au nom exact, ignorée.`); return []; }
  }
  console.log('Métropole de Lyon : introuvable, clé non écrite.');
  return [];
}
const lyon = await metropoleLyon();
const by = (code) => dep.filter((f) => f.properties?.code_insee === code);
if (by('67').length !== 1 || by('68').length !== 1 || by('54').length !== 1 || reg.length !== 1 || epci.length !== 1) {
  console.log('Contours incomplets : rien écrit.');
  process.exit(1);
}
const result = {
  source: `IGN Admin Express COG (${prefix}, WFS Géoplateforme data.geopf.fr), Licence Ouverte Etalab 2.0`,
  layer: prefix,
  year,
  read: new Date().toISOString().slice(0, 10),
  tolerance: { departement: 150, region: 150, epci: 50 },
  alsace: rings([...by('67'), ...by('68')], 150),
  grandEst: rings(reg, 150),
  meurtheEtMoselle: rings(by('54'), 150),
  eurometropole: rings(epci, 50),
  props: { epci: epci[0].properties, region: reg[0].properties },
};
if (lyon.length === 1) {
  result.metropoleLyon = rings(lyon, 50);
  result.props.metropoleLyon = lyon[0].properties;
}
for (const k of ['alsace', 'grandEst', 'meurtheEtMoselle', 'eurometropole', 'metropoleLyon']) {
  if (!result[k]) { console.log(`${k} : absent`); continue; }
  console.log(`${k} : ${result[k].length} anneau(x), ${result[k].reduce((s, r) => s + r.length, 0)} points`);
}
const text = `${JSON.stringify(result)}\n`;
await writeFile(out, text);
console.log(`${out} : ${text.length} octets`);

// Zones des grandes agglomérations, cherchées par leur nom (filtre WFS sur un mot sans accent, ILIKE sans casse, LIKE
// si ILIKE est refusé, puis nom exact comparé sans accents ni casse) ; requête refusée ou échouée : zone absente (⚠),
// les autres restent.
const found = {};
for (const z of ZONES) {
  for (const op of ['ILIKE', 'LIKE']) {
    try {
      const list = await features(prefix, z.layer, `nom_officiel ${op} '%${z.like}%'`);
      for (const f of list) console.log(`  ${z.layer} : ${JSON.stringify(f.properties ?? {}).slice(0, 200)}`);
      found[z.key] = list;
      break;
    } catch (err) { console.log(`⚠ ${z.layer} [${op} ${z.like}] : ${err.message}`); }
  }
}
const zones = buildZones(found, { prefix, year, read: result.read });
for (const line of zones.log) console.log(line);
if (zones.text) await writeFile(outZones, zones.text);
