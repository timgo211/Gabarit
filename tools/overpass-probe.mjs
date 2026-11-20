// Sonde temporaire (phase 5b) : durée de la requête Overpass « aires seules » et « aires + tunnels » sur un vrai
// trajet de plus de 500 km (autoroutes A6 puis A43, Paris → Lyon → tunnel du Fréjus). Lancée par une Action.
import { queryLine, buildOverpassQuery, overpassBody, OVERPASS_ENDPOINTS, AREAS_OSM } from '../src/lib/areas-osm.js';
import { haversine } from '../src/lib/ors-response.js';

const UA = { 'user-agent': 'Gabarit-probe/1 (test ponctuel)', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' };
async function post(url, q, ms = 60000) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', body: overpassBody(q), headers: UA, signal: ctrl.signal });
    const text = await r.text();
    return { status: r.status, ms: Date.now() - t0, bytes: text.length, json: r.ok ? JSON.parse(text) : null, text: r.ok ? '' : text.slice(0, 300) };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: String(e) };
  } finally { clearTimeout(timer); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const geo = await post(OVERPASS_ENDPOINTS[0], '[out:json][timeout:120];way["highway"="motorway"]["ref"~"^A ?(6|43)$"](44.9,2.0,49.0,7.0);out geom;', 180000);
console.log('géométrie', geo.status, geo.ms, 'ms', geo.bytes, 'octets', geo.error ?? '');
const paris = [2.35, 48.85];
let pts = [];
for (const w of geo.json?.elements ?? []) for (const g of w.geometry ?? []) pts.push([g.lon, g.lat]);
pts = pts.filter((p) => p[1] > 45.0 || p[0] < 6.8).sort((a, b) => haversine(paris, a) - haversine(paris, b));
let len = 0; for (let i = 1; i < pts.length; i += 1) len += haversine(pts[i - 1], pts[i]);
console.log('points', pts.length, 'de', (haversine(paris, pts[0]) / 1000).toFixed(0), 'à', (haversine(paris, pts.at(-1)) / 1000).toFixed(0), 'km de Paris');
const { line, tolerance } = queryLine(pts);
console.log('ligne simplifiée', line.length, 'points, écart', tolerance, 'm');

const areasQ = buildOverpassQuery(pts);
const fmt = (x) => (Math.round(x * 1e5) / 1e5).toString();
const ptsTxt = line.map(([lon, lat]) => `${fmt(lat)},${fmt(lon)}`).join(',');
const rest = Math.round(AREAS_OSM.REST_RADIUS_M + tolerance);
const park = Math.round(AREAS_OSM.PARKING_RADIUS_M + tolerance);
const tun = Math.round(50 + tolerance);
const extQ = `[out:json][timeout:${AREAS_OSM.SERVER_TIMEOUT_S}];(`
  + `nwr["highway"~"^(rest_area|services)$"](around:${rest},${ptsTxt});`
  + `nwr["amenity"="parking"][~"^(hgv|capacity:hgv)$"~"^(yes|designated|[1-9][0-9]*)$"](around:${park},${ptsTxt});`
  + ')->.a;'
  + '(' + ['hazmat', 'hazmat:B', 'hazmat:C', 'hazmat:D', 'hazmat:E', 'hazmat:adr_tunnel_cat'].map((k) => `way["${k}"]["tunnel"](around:${tun},${ptsTxt});`).join('') + ')->.t;'
  + '.a out center tags;.t out tags geom;';
const tunQ = `[out:json][timeout:${AREAS_OSM.SERVER_TIMEOUT_S}];(`
  + ['hazmat', 'hazmat:B', 'hazmat:C', 'hazmat:D', 'hazmat:E', 'hazmat:adr_tunnel_cat'].map((k) => `way["${k}"]["tunnel"](around:${tun},${ptsTxt});`).join('')
  + ');out tags geom;';
console.log('taille requête aires', areasQ.length, 'étendue', extQ.length);

for (const url of OVERPASS_ENDPOINTS) {
  for (const [name, q] of [['tunnels seuls', tunQ], ['aires', areasQ], ['aires+tunnels', extQ], ['tunnels seuls (2e)', tunQ], ['aires (2e)', areasQ], ['aires+tunnels (2e)', extQ]]) {
    await sleep(15000);
    const r = await post(url, q, 90000);
    const els = r.json?.elements ?? [];
    const tunnels = els.filter((e) => e.type === 'way' && e.tags?.tunnel);
    console.log(`${url} ${name}: HTTP ${r.status} ${r.ms} ms ${r.bytes ?? 0} octets, ${els.length} éléments dont ${tunnels.length} tunnels ${r.error ?? ''} ${r.text ?? ''} ${r.json?.remark ?? ''}`);
    if (name.startsWith('tunnels seuls') && tunnels.length && !globalThis.shown && (globalThis.shown = true)) {
      for (const t of tunnels.slice(0, 40)) {
        const h = Object.fromEntries(Object.entries(t.tags).filter(([k]) => /^(name|ref|tunnel|hazmat|tunnel:name|layer|oneway|length)/.test(k)));
        console.log('  ', t.id, JSON.stringify(h), (t.geometry ?? []).length, 'pts');
      }
    }
  }
}
