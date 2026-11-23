// Contours IGN Admin Express (COG, millésime le plus récent publié en WFS par la Géoplateforme) pour les taxes PL
// régionales (phase 5h ter, data/taxes-pl.json) : Bas-Rhin (67) et Haut-Rhin (68), région Grand Est (44),
// Meurthe-et-Moselle (54), Eurométropole de Strasbourg (EPCI 246700488). Lancé par l'Action « Contours IGN »
// (.github/workflows/contours-ign.yml) : data.geopf.fr est bloqué depuis le conteneur de développement.
// Simplification Douglas-Peucker en mètres (projection locale) : 150 m (départements, région), 50 m (Eurométropole),
// comme les contours COG 2018 actuels ; coordonnées à 4 décimales (≈ 10 m). Seuls les anneaux extérieurs sont gardés
// (pointInTax ne lit que des anneaux extérieurs). Écrit data/contours-ign.json ; le journal donne le millésime, le
// nombre de points et la taille. Licence Ouverte (Etalab 2.0), © IGN.
//
// Usage : node tools/contours-ign.mjs [sortie]
import { writeFile } from 'node:fs/promises';

const WFS = 'https://data.geopf.fr/wfs/ows';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) Gabarit (contours IGN Admin Express)';
const out = process.argv[2] ?? 'data/contours-ign.json';

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

const RAD = Math.PI / 180;
/** Douglas-Peucker sur un anneau [lon, lat], tolérance en mètres. */
function simplify(ring, tol) {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = 111320 * Math.cos(lat0 * RAD); const ky = 110540;
  const P = ring.map(([x, y]) => [x * kx, y * ky]);
  const keep = new Uint8Array(P.length);
  keep[0] = 1; keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0; let idx = -1;
    const [ax, ay] = P[a]; const [bx, by] = P[b];
    const dx = bx - ax; const dy = by - ay; const L = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i += 1) {
      const d = L === 0 ? Math.hypot(P[i][0] - ax, P[i][1] - ay) : Math.abs(dy * P[i][0] - dx * P[i][1] + bx * ay - by * ax) / L;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const outRing = [];
  for (let i = 0; i < ring.length; i += 1) {
    if (!keep[i]) continue;
    const p = [r4(ring[i][0]), r4(ring[i][1])];
    const last = outRing.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) outRing.push(p);
  }
  if (outRing.length && (outRing[0][0] !== outRing.at(-1)[0] || outRing[0][1] !== outRing.at(-1)[1])) outRing.push(outRing[0]);
  return outRing;
}

/** Anneaux extérieurs simplifiés d'une liste d'objets (Polygon / MultiPolygon). */
function rings(list, tol) {
  const res = [];
  for (const f of list) {
    const g = f.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const r = simplify(poly[0], tol);
      if (r.length >= 4) res.push(r);
    }
  }
  return res;
}

const { prefix, year } = await pickLayerPrefix();
console.log(`Millésime retenu : ${prefix}${year ? '' : ' (année non lue dans les capacités)'}`);
const dep = await features(prefix, 'departement', "code_insee IN ('67','68','54')");
const reg = await features(prefix, 'region', "code_insee='44'");
const epci = await features(prefix, 'epci', "code_siren='246700488'");
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
for (const k of ['alsace', 'grandEst', 'meurtheEtMoselle', 'eurometropole']) {
  console.log(`${k} : ${result[k].length} anneau(x), ${result[k].reduce((s, r) => s + r.length, 0)} points`);
}
const text = `${JSON.stringify(result)}\n`;
await writeFile(out, text);
console.log(`${out} : ${text.length} octets`);
