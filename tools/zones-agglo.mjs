// Contours des grandes agglomérations (data/zones-agglo.json), produits par l'Action « Contours IGN »
// (tools/contours-ign.mjs) à côté de data/contours-ign.json, jamais dedans (taxes PL et contournement de Lyon en
// dépendent : ses clés et sa structure ne changent pas). Règle de Timothée (PR 3, à coder) : un pont au-dessus d'une
// autoroute n'est pas un point sensible, sauf en Île-de-France et dans les grandes agglomérations.
//
// Chaque zone est cherchée par son NOM dans la couche IGN Admin Express COG (comme la Métropole de Lyon en v76),
// jamais par un code deviné ; le code lu (code_insee, code_siren…) est écrit dans props. Nom comparé sans accents,
// sans casse, apostrophes ’ et ' confondues, espaces regroupés.
// Les noms seront vérifiés par le run de l'Action (data.geopf.fr est bloqué depuis le conteneur de développement).
// v92 : les 13 zones sont obligatoires (toutes lues par l'appli et l'audit, AGGLO_ZONES.ZONES_KEYS de
// src/lib/agglo-zones.js, tout ou rien). Une zone absente, ambiguë (0 ou plusieurs objets au nom exact), sans anneau
// lisible ou dont la requête a échoué : ⚠ au journal avec les noms proches trouvés, et RIEN n'est écrit (l'ancien
// data/zones-agglo.json reste, jamais un fichier partiel) ; exitCode = 1 dans le résultat.
//
// Seuls les anneaux extérieurs ; Douglas-Peucker en mètres (projection locale) : 150 m (région), 50 m (métropoles) ;
// coordonnées à 4 décimales. Plafond ZONES_MAX_BYTES (500 Ko) : au-delà, rien écrit (jamais un fichier partiel).
// Logique pure (aucun réseau), testée par tests/zones-agglo.test.js. Licence Ouverte (Etalab 2.0), © IGN.

/** Zones cherchées : clé du fichier, couche IGN, nom officiel cherché, mot sans accent du filtre WFS, tolérance (m). */
export const ZONES = Object.freeze([
  { key: 'ileDeFrance', layer: 'region', name: 'Île-de-France', like: 'France', tol: 150 },
  { key: 'metropoleGrandParis', layer: 'epci', name: 'Métropole du Grand Paris', like: 'Grand Paris', tol: 50 },
  { key: 'aixMarseille', layer: 'epci', name: "Métropole d'Aix-Marseille-Provence", like: 'Marseille', tol: 50 },
  { key: 'lille', layer: 'epci', name: 'Métropole Européenne de Lille', like: 'Lille', tol: 50 },
  { key: 'bordeaux', layer: 'epci', name: 'Bordeaux Métropole', like: 'Bordeaux', tol: 50 },
  { key: 'toulouse', layer: 'epci', name: 'Toulouse Métropole', like: 'Toulouse', tol: 50 },
  { key: 'nantes', layer: 'epci', name: 'Nantes Métropole', like: 'Nantes', tol: 50 },
  { key: 'nice', layer: 'epci', name: "Métropole Nice Côte d'Azur", like: 'Nice', tol: 50 },
  { key: 'montpellier', layer: 'epci', name: 'Montpellier Méditerranée Métropole', like: 'Montpellier', tol: 50 },
  { key: 'rennes', layer: 'epci', name: 'Rennes Métropole', like: 'Rennes', tol: 50 },
  { key: 'grenoble', layer: 'epci', name: 'Grenoble-Alpes-Métropole', like: 'Grenoble', tol: 50 },
  { key: 'rouen', layer: 'epci', name: 'Métropole Rouen Normandie', like: 'Rouen', tol: 50 },
  { key: 'toulon', layer: 'epci', name: 'Métropole Toulon-Provence-Méditerranée', like: 'Toulon', tol: 50 },
].map((z) => Object.freeze(z)));

export const ZONES_MAX_BYTES = 500_000;

/** Nom comparable : sans accents, minuscules, apostrophes confondues, espaces regroupés. */
export function normName(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘ʼ`´]/g, "'")
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Objet IGN au nom exact (propriété nom_officiel). Renvoie { status: 'ok', feature } (un seul),
 * 'absent' (aucun) ou 'ambigu' (plusieurs), avec les noms trouvés (noms proches, pour le journal).
 */
export function pickByName(list, name) {
  const want = normName(name);
  const names = [...new Set((list ?? []).map((f) => String(f?.properties?.nom_officiel ?? '').trim()).filter(Boolean))];
  const exact = (list ?? []).filter((f) => normName(f?.properties?.nom_officiel) === want);
  if (exact.length === 1) return { status: 'ok', feature: exact[0], names };
  return { status: exact.length ? 'ambigu' : 'absent', count: exact.length, names };
}

const RAD = Math.PI / 180;
/** Douglas-Peucker sur un anneau [lon, lat], tolérance en mètres ; coordonnées à 4 décimales, anneau fermé. */
export function simplify(ring, tol) {
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
export function rings(list, tol) {
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

/**
 * Fichier des zones. found : { clé: liste d'objets IGN candidats (filtre WFS sur le mot `like`) }, ou absent si la
 * requête a échoué. Renvoie { text, data, log, exitCode } : text = null et exitCode = 1 si rien n'est à écrire (une
 * des 13 zones manquante, ou plafond dépassé) ; sinon exitCode = 0. Jamais un fichier partiel.
 */
export function buildZones(found, { prefix = null, year = null, read = null, maxBytes = ZONES_MAX_BYTES } = {}) {
  const log = [];
  const data = {
    source: `IGN Admin Express COG (${prefix}, WFS Géoplateforme data.geopf.fr), Licence Ouverte Etalab 2.0, © IGN`,
    layer: prefix,
    year,
    read,
    tolerance: { region: 150, epci: 50 },
    names: {},
    props: {},
  };
  const missing = [];
  for (const z of ZONES) {
    const list = found?.[z.key];
    if (!Array.isArray(list)) { missing.push(z.key); log.push(`⚠ ${z.key} (« ${z.name} ») : requête échouée, zone manquante.`); continue; }
    const p = pickByName(list, z.name);
    const near = p.names.length ? p.names.map((n) => `« ${n} »`).join(', ') : 'aucun';
    if (p.status !== 'ok') {
      missing.push(z.key);
      log.push(`⚠ ${z.key} (« ${z.name} ») : ${p.status === 'absent' ? 'absent' : `ambigu (${p.count} objets)`}, zone manquante ; noms proches trouvés : ${near}.`);
      continue;
    }
    const r = rings([p.feature], z.tol);
    if (!r.length) { missing.push(z.key); log.push(`⚠ ${z.key} (« ${z.name} ») : aucun anneau lisible, zone manquante.`); continue; }
    data[z.key] = r;
    data.names[z.key] = String(p.feature.properties.nom_officiel).trim();
    data.props[z.key] = p.feature.properties;
    log.push(`${z.key} : « ${data.names[z.key]} » (${z.layer}, code ${p.feature.properties.code_insee ?? p.feature.properties.code_siren ?? 'non lu'}), `
      + `${r.length} anneau(x), ${r.reduce((s, x) => s + x.length, 0)} points (${z.tol} m).`);
  }
  if (missing.length) {
    log.push(`⚠ data/zones-agglo.json : ${missing.length} zone(s) manquante(s) sur ${ZONES.length} (${missing.join(', ')}) : `
      + 'rien écrit, l\'ancien fichier reste.');
    return { text: null, data, log, exitCode: 1 };
  }
  const text = `${JSON.stringify(data)}\n`;
  const bytes = Buffer.byteLength(text);
  if (bytes > maxBytes) {
    log.push(`⚠ data/zones-agglo.json : ${bytes} octets > plafond ${maxBytes} octets : rien écrit.`);
    return { text: null, data, log, exitCode: 1 };
  }
  log.push(`data/zones-agglo.json : ${ZONES.length}/${ZONES.length} zone(s), ${bytes} octets (plafond ${maxBytes}).`);
  return { text, data, log, exitCode: 0 };
}
