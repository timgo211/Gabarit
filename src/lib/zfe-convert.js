// Conversion de la Base nationale des ZFE (aires.geojson, voies.geojson, identifiants) en data/zfe.json (phase 5).
// Appelée par tools/zfe-update.mjs (GitHub Action hebdomadaire) ; logique pure, testée sur fixtures.
//
// Ce que la vraie base contient (lue le 19/11/2026, mise à jour du 26/03/2026 : 35 aires, 6 706 tronçons) et que la
// conversion corrige :
// - identifiants « SIREN-ZFE-NNN », mais aussi « 1 », « 2 »… (Grand Annecy), codes commune « 67447-ZFE-005 »
//   (communes de l'Eurométropole de Strasbourg) ou SIREN avec un chiffre de trop (« 2000234140-ZFE-003», Rouen) :
//   nom cherché dans le fichier des identifiants (zfe_ids.csv : siren;code;epci_principal;autres_siren), puis dans
//   une zone nommée qui contient la zone, puis d'après l'adresse du site d'information ;
// - horaires « 24/7 », « Mo-Su : 00:00-00:00 », « NC », null (lus par parseHours de zfe.js, sinon texte gardé) ;
// - tronçons (voies.geojson) : seuls ceux qui sont dans une zone et y changent la règle sont gardés, lignes
//   simplifiées à 8 m ;
// - coordonnées arrondies à 5 décimales (≈ 1 m).

const round = (x) => Math.round(x * 1e5) / 1e5;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const RAD = Math.PI / 180;
const DATE = /^\d{4}-\d{2}-\d{2}/;

/** Lit le fichier des identifiants (CSV « ; »). @returns {Map<string,string>} SIREN → nom de la collectivité */
export function parseZfeIds(csv) {
  const map = new Map();
  const lines = String(csv ?? '').split(/\r?\n/).filter(Boolean);
  const head = (lines.shift() ?? '').split(';').map((h) => h.trim());
  const iSiren = head.indexOf('siren');
  const iName = head.indexOf('epci_principal');
  const iOther = head.indexOf('autres_siren');
  if (iSiren < 0 || iName < 0) return map;
  for (const line of lines) {
    const c = line.split(';');
    const name = (c[iName] ?? '').trim();
    if (!name) continue;
    for (const s of [c[iSiren], ...(iOther >= 0 ? (c[iOther] ?? '').split(/[,|]/) : [])]) {
      const siren = (s ?? '').trim();
      if (/^\d{9}$/.test(siren)) map.set(siren, name);
    }
  }
  return map;
}

function distToSegment(p, a, b) {
  const kx = Math.cos(p[1] * RAD) * 6371008.8 * RAD;
  const ky = 6371008.8 * RAD;
  const ax = (a[0] - p[0]) * kx; const ay = (a[1] - p[1]) * ky;
  const dx = (b[0] - a[0]) * kx; const dy = (b[1] - a[1]) * ky;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Douglas-Peucker (tolérance en m), extrémités gardées. */
export function simplifyPath(points, tol) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1; let idx = -1;
    for (let i = a + 1; i < b; i += 1) {
      const d = distToSegment(points[i], points[a], points[b]);
      if (d > best) { best = d; idx = i; }
    }
    if (best > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

const cleanPoint = (p) => (Array.isArray(p) && isNum(p[0]) && isNum(p[1]) ? [round(p[0]), round(p[1])] : null);

function cleanRing(ring, tol) {
  const pts = (Array.isArray(ring) ? ring : []).map(cleanPoint).filter(Boolean);
  if (pts.length < 4) return null;
  const s = simplifyPath(pts, tol);
  if (s.length < 4) return pts;
  return s;
}

/** Polygones d'une géométrie GeoJSON : [[contour, trous…], …]. */
function polygonsOf(geometry, tol = 2) {
  const g = geometry ?? {};
  const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return (Array.isArray(list) ? list : [])
    .map((poly) => (Array.isArray(poly) ? poly.map((r) => cleanRing(r, tol)).filter(Boolean) : []))
    .filter((poly) => poly.length);
}

function linesOf(geometry, tol = 8) {
  const g = geometry ?? {};
  const list = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  return (Array.isArray(list) ? list : [])
    .map((l) => simplifyPath((Array.isArray(l) ? l : []).map(cleanPoint).filter(Boolean), tol))
    .filter((l) => l.length >= 2);
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygons = (p, polygons) => polygons.some(([outer]) => inRing(p, outer));

const CRITAIR = new Set(['EL', 'V1', 'V2', 'V3', 'V4', 'V5', 'NC']);
const text = (x, max = 120) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const dateOf = (x) => (typeof x === 'string' && DATE.test(x) ? x.slice(0, 10) : null);
const rule = (props, cat) => ({
  critair: CRITAIR.has(props?.[`${cat}_critair`]) ? props[`${cat}_critair`] : null,
  hours: text(props?.[`${cat}_horaires`]),
});

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Nom de la collectivité d'après l'identifiant (SIREN en tête, ou SIREN avec des chiffres en trop). */
function nameFromId(id, ids) {
  const m = /^(\d{9,})-ZFE/i.exec(id);
  if (!m) return '';
  if (ids.has(m[1])) return ids.get(m[1]);
  for (const [siren, name] of ids) if (m[1].startsWith(siren)) return name;
  return '';
}

/**
 * @param {object} aires GeoJSON aires.geojson
 * @param {object|null} voies GeoJSON voies.geojson
 * @param {Map<string,string>} ids parseZfeIds
 * @returns {{ data:object, log:string[] }}
 */
export function convertBnzfe(aires, voies, ids = new Map(), { updated = null } = {}) {
  const log = [];
  const zones = [];
  const features = Array.isArray(aires?.features) ? aires.features : [];
  features.forEach((f, i) => {
    const p = f?.properties ?? {};
    const id = text(p.id, 80) || `zfe-${i + 1}`;
    const start = dateOf(p.date_debut);
    const polygons = polygonsOf(f?.geometry);
    if (!start || !polygons.length) {
      log.push(`aire ${id} ignorée : ${!start ? 'date_debut absente' : 'géométrie illisible'}`);
      return;
    }
    zones.push({
      id, name: nameFromId(id, ids) || text(p.nom) || text(p.Name) || '', start, end: dateOf(p.date_fin),
      pl: rule(p, 'pl'), vul: rule(p, 'vul'),
      url: text(p.url_arrete, 300) || null,
      info: text(p.url_site_information, 300) || text(p.url_site, 300) || text(p.url_site_informations, 300) || null,
      polygons,
    });
  });
  // Zones sans nom : celui d'une zone nommée qui les contient (communes d'une métropole), sinon l'adresse du site.
  for (const z of zones) {
    if (z.name) continue;
    const p = z.polygons[0][0][0];
    const host = zones.find((o) => o !== z && o.name && inPolygons(p, o.polygons));
    const web = hostOf(z.info ?? z.url ?? '');
    z.name = host ? host.name : web ? `ZFE (${web})` : 'ZFE';
    // Mêmes polygones qu'une zone nommée par son adresse : même nom (étapes successives d'une même ZFE).
  }
  const kept = [];
  let outside = 0;
  let useless = 0;
  for (const f of Array.isArray(voies?.features) ? voies.features : []) {
    const p = f?.properties ?? {};
    const start = dateOf(p.date_debut);
    const lines = linesOf(f?.geometry);
    if (!start || !lines.length) continue;
    const ends = [lines[0][0], lines[0][lines[0].length - 1]];
    const host = zones.filter((z) => ends.some((e) => inPolygons(e, z.polygons)));
    if (!host.length) { outside += 1; continue; }
    const v = { start, end: dateOf(p.date_fin), pl: rule(p, 'pl'), vul: rule(p, 'vul'), url: text(p.url_arrete, 300) || null, lines };
    // Même règle que la zone, aux mêmes dates : le tronçon ne change rien (Nancy, Rouen), il n'est pas gardé.
    const same = (a, b) => a.critair === b.critair && a.hours === b.hours;
    if (host.some((z) => z.start === v.start && z.end === v.end && same(z.pl, v.pl) && same(z.vul, v.vul))) { useless += 1; continue; }
    kept.push(v);
  }
  log.push(`${zones.length} zones, ${kept.length} tronçons spéciaux gardés${outside ? `, ${outside} hors des zones ignorés` : ''}${useless ? `, ${useless} sans effet (même règle que la zone)` : ''}`);
  return {
    data: {
      source: 'Base nationale consolidée des zones à faibles émissions (BNZFE), transport.data.gouv.fr',
      license: 'ODbL (Open Database License), d\'après data.gouv.fr',
      updated,
      zones,
      voies: kept,
    },
    log,
  };
}
