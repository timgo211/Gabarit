// Étude DiaLog (journal seulement) pour l'Action « Étude DiaLog » (.github/workflows/dialog-etude.yml).
// DiaLog (DGITM) publie la réglementation de circulation en DATEX II v3 (≈ 85 Mo pour la France). Cette étude compte,
// sans rien garder, les mesures avec une condition de hauteur, de poids, de largeur ou de longueur, le sens de
// l'opérateur (comparisonOperator), les types de mesure et de véhicule, la géométrie et les organisations.
// Source : fiche data.gouv.fr « Base de données nationale de la réglementation de circulation »
// (https://www.data.gouv.fr/api/1/datasets/64947a4af5faf2f1f9eee299/), ressource « API DiaLog » ; gabarit XML officiel :
// https://github.com/MTES-MCT/dialog/blob/main/templates/api/regulations.xml.twig (lu le 25/11/2026).
// Avertissement du producteur : « Les restrictions diffusées par DiaLog n'ont pas de valeur juridique. Seul l'arrêté
// fait foi. »
//
// Le XML est une donnée : lu en flux par un petit lecteur maison (modules Node intégrés seulement), DOCTYPE refusé (donc
// aucune entité externe), seules les 5 entités XML prédéfinies et les références numériques sont décodées, rien n'est
// exécuté ni évalué (la géométrie est lue par JSON.parse). Le fichier n'est jamais écrit sur le disque.
//
// Usage : node tools/dialog-etude.mjs            (télécharge et imprime le journal)
//         node tools/dialog-etude.mjs fichier.xml (lit un fichier local, pour essai)

// URL stable de la ressource sur data.gouv.fr (301 → /api/1/datasets/r/… → 302 → dialog.beta.gouv.fr).
export const DIALOG_URL = 'https://www.data.gouv.fr/fr/datasets/r/1b9c1379-79ff-437b-91bf-149179e3bca2';
export const ALLOWED_HOSTS = ['www.data.gouv.fr', 'static.data.gouv.fr', 'dialog.beta.gouv.fr'];
const MAX_ATTEMPTS = 3;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 600 * 1024 * 1024;   // garde-fou : 600 Mo au plus
const MAX_TAG = 1024 * 1024;           // une balise de plus de 1 Mo = XML mal formé
const MAX_TEXT = 64 * 1024 * 1024;     // un texte (géométrie) de plus de 64 Mo = refusé

// Zone de Destord / Vosges demandée par le propriétaire (boîte publique, aucune position personnelle).
export const VOSGES_BOX = { south: 48.0, north: 48.6, west: 5.8, east: 7.0 };

// ── Lecteur XML en flux ─────────────────────────────────────────────────────────────────────────────────────────────

const NAME = /^[A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?$/;
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&([^;&\s]{0,12});?/g, (m, n) => {
    if (!m.endsWith(';')) throw new Error(`XML mal formé : « & » isolé`);
    if (n in ENTITIES) return ENTITIES[n];
    const num = /^#x([0-9a-f]+)$/i.exec(n) ? parseInt(n.slice(2), 16) : /^#(\d+)$/.exec(n) ? Number(n.slice(1)) : NaN;
    if (Number.isFinite(num) && num > 0 && num <= 0x10ffff) return String.fromCodePoint(num);
    throw new Error(`XML mal formé : entité inconnue &${n};`);
  });
}

function parseAttrs(src) {
  const attrs = {};
  const re = /\s*([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m || !NAME.test(m[1])) throw new Error('XML mal formé : attribut illisible');
    attrs[m[1]] = decodeEntities(m[3] ?? m[4]);
    i = re.lastIndex;
  }
  return attrs;
}

const localName = (n) => n.slice(n.indexOf(':') + 1);

// Lecteur en flux : write(morceau de texte) puis end(). Appelle handler.open(nom local, attributs),
// handler.text(texte décodé), handler.close(nom local). Lève une erreur sur tout XML mal formé.
export function createXmlReader(handler) {
  let buf = '';
  const stack = [];
  let rootSeen = false;
  let textParts = [];
  let textLen = 0;

  const flushText = () => {
    if (!textParts.length) return;
    const t = textParts.join('');
    textParts = []; textLen = 0;
    if (!stack.length) {
      if (t.trim()) throw new Error('XML mal formé : texte hors de l\'élément racine');
      return;
    }
    handler.text?.(t);
  };
  const pushText = (t) => {
    if (!t) return;
    textLen += t.length;
    if (textLen > MAX_TEXT) throw new Error('XML refusé : texte trop long');
    textParts.push(t);
  };

  function step(final) {
    let i = 0;
    while (i < buf.length) {
      const lt = buf.indexOf('<', i);
      if (lt < 0) {
        pushText(decodeEntities(cutText(buf.slice(i), final)));
        i = buf.length - pendingAmp;
        break;
      }
      if (lt > i) pushText(decodeEntities(buf.slice(i, lt)));
      i = lt;
      let end;
      if (buf.startsWith('<!--', i)) {
        end = buf.indexOf('-->', i + 4);
        if (end < 0) break;
        i = end + 3;
        continue;
      }
      if (buf.startsWith('<![CDATA[', i)) {
        end = buf.indexOf(']]>', i + 9);
        if (end < 0) break;
        if (!stack.length) throw new Error('XML mal formé : CDATA hors de l\'élément racine');
        pushText(buf.slice(i + 9, end));
        i = end + 3;
        continue;
      }
      if (buf.length - i < 9 && !final) break; // « <!DOCTYPE » ou « <![CDATA[ » peut être coupé
      if (buf.startsWith('<!', i)) throw new Error('XML refusé : DOCTYPE ou déclaration interdite (aucune entité externe)');
      if (buf.startsWith('<?', i)) {
        end = buf.indexOf('?>', i + 2);
        if (end < 0) break;
        i = end + 2;
        continue;
      }
      end = tagEnd(buf, i + 1);
      if (end < 0) {
        if (buf.length - i > MAX_TAG) throw new Error('XML mal formé : balise trop longue');
        break;
      }
      flushText();
      const inner = buf.slice(i + 1, end);
      i = end + 1;
      if (inner.startsWith('/')) {
        const name = inner.slice(1).trim();
        const top = stack.pop();
        if (top !== name) throw new Error(`XML mal formé : </${name}> ferme <${top ?? '(rien)'}>`);
        handler.close?.(localName(name));
        continue;
      }
      const selfClose = inner.endsWith('/');
      const body = selfClose ? inner.slice(0, -1) : inner;
      const m = /^([^\s/>]+)([\s\S]*)$/.exec(body);
      if (!m || !NAME.test(m[1])) throw new Error('XML mal formé : nom de balise illisible');
      if (!stack.length && rootSeen) throw new Error('XML mal formé : deux éléments racine');
      rootSeen = true;
      const attrs = parseAttrs(m[2]);
      stack.push(m[1]);
      handler.open?.(localName(m[1]), attrs);
      if (selfClose) { stack.pop(); handler.close?.(localName(m[1])); }
    }
    buf = buf.slice(i);
  }

  // Texte sans « < » en fin de morceau : on garde une entité éventuellement coupée (« &am|p; »).
  let pendingAmp = 0;
  function cutText(t, final) {
    pendingAmp = 0;
    if (final) return t;
    const amp = t.lastIndexOf('&');
    if (amp >= 0 && t.indexOf(';', amp) < 0 && t.length - amp <= 13) {
      pendingAmp = t.length - amp;
      return t.slice(0, amp);
    }
    return t;
  }

  return {
    write(chunk) { buf += chunk; step(false); },
    end() {
      step(true);
      if (buf.trim()) throw new Error('XML mal formé : fin de fichier au milieu d\'une balise');
      flushText();
      if (!rootSeen) throw new Error('XML mal formé : aucun élément');
      if (stack.length) throw new Error(`XML mal formé : <${stack[stack.length - 1]}> jamais fermé`);
    },
  };
}

// Fin d'une balise ouvrante ou fermante (« > » hors des guillemets).
function tagEnd(s, from) {
  let q = null;
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '>') return j;
    else if (c === '<') throw new Error('XML mal formé : « < » dans une balise');
  }
  return -1;
}

// ── Statistiques DATEX II DiaLog ───────────────────────────────────────────────────────────────────────────────────

const DIM = {
  heightCharacteristic: { key: 'hauteur', value: 'vehicleHeight' },
  grossWeightCharacteristic: { key: 'poids', value: 'grossVehicleWeight' },
  widthCharacteristic: { key: 'largeur', value: 'vehicleWidth' },
  lengthCharacteristic: { key: 'longueur', value: 'vehicleLength' },
};

const inc = (map, k, n = 1) => map.set(k, (map.get(k) ?? 0) + n);
const parseTime = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; };

// Boîte englobante des coordonnées d'une géométrie GeoJSON (tableaux imbriqués), sans rien évaluer.
export function geometryBox(geom) {
  const box = { south: Infinity, north: -Infinity, west: Infinity, east: -Infinity };
  const walk = (c) => {
    if (!Array.isArray(c)) return;
    if (c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
      const [lon, lat] = c;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      box.west = Math.min(box.west, lon); box.east = Math.max(box.east, lon);
      box.south = Math.min(box.south, lat); box.north = Math.max(box.north, lat);
      return;
    }
    for (const x of c) walk(x);
  };
  if (geom?.type === 'GeometryCollection') for (const g of geom.geometries ?? []) walk(g?.coordinates);
  else walk(geom?.coordinates);
  return box.south <= box.north ? box : null;
}

function mergeBox(a, b) {
  if (!b) return a;
  if (!a) return { ...b };
  return { south: Math.min(a.south, b.south), north: Math.max(a.north, b.north),
    west: Math.min(a.west, b.west), east: Math.max(a.east, b.east) };
}

export function createDialogStats({ now = Date.now(), examples = 5, vosgesExamples = 3 } = {}) {
  const s = {
    publicationTime: null, orders: 0, measures: 0,
    dims: { hauteur: 0, poids: 0, largeur: 0, longueur: 0 },
    dimsPermanent: { hauteur: 0, poids: 0, largeur: 0, longueur: 0 },
    dimsTemporary: { hauteur: 0, poids: 0, largeur: 0, longueur: 0 },
    dimsActive: { hauteur: 0, poids: 0, largeur: 0, longueur: 0 },
    dimsNegated: { hauteur: 0, poids: 0, largeur: 0, longueur: 0 },
    operators: new Map(),          // « hauteur lessThanOrEqualTo » → nombre
    regulationTypes: new Map(),    // « AccessRestriction/noEntry » → nombre
    vehicleTargets: new Map(),     // « poids lourd seul » … → nombre
    vehicleTypes: new Map(),       // vehicleType visé (non dérogé) → nombre de mesures
    hw: 0, hwPermanent: 0, hwTemporary: 0, hwActive: 0, hwNoGeometry: 0,
    withGeometry: 0, geometryTypes: new Map(), badGeometry: 0,
    hwCells: new Map(), hwBox: null,
    organizations: new Map(),      // organisation → { measures, hw }
    exHeight: [], exWeight: [], vosges: 0, vosgesExamples: [],
  };

  // État courant
  const path = [];
  let order = null;
  let measure = null;
  let cond = null;          // condition de véhicule en cours
  let dim = null;           // caractéristique en cours
  let validity = null;      // ValidityCondition en cours (niveau mesure)
  let text = '';

  const under = (name) => path.includes(name);
  const parent = (k = 1) => path[path.length - 1 - k];

  function finishMeasure(m) {
    s.measures++;
    const org = order.org || '(sans organisation)';
    const o = s.organizations.get(org) ?? { measures: 0, hw: 0 };
    o.measures++;
    s.organizations.set(org, o);
    inc(s.regulationTypes, m.regType + (m.regSubtype ? `/${m.regSubtype}` : ''));

    const permanent = order.end == null;
    let active = order.start != null && order.start <= now && (order.end == null || order.end >= now);
    if (active && m.validities.length) {
      active = m.validities.some((v) => (v.start == null || v.start <= now) && (v.end == null || v.end >= now));
    }

    const restricted = m.vehicles.filter((v) => !v.negate);
    const types = new Set();
    let dimsOnly = false;
    for (const v of restricted) {
      for (const t of v.types) types.add(t);
      if (!v.types.length && v.dims.length) dimsOnly = true;
      if (v.load) types.add(`loadType:${v.load}`);
      if (v.other) types.add('autre (texte libre)');
      if (v.usage) types.add(`usage:${v.usage}`);
      if (v.emission) types.add(`émission:${v.emission}`);
    }
    if (dimsOnly) types.add('(gabarit sans type)');
    for (const t of types) inc(s.vehicleTypes, t);
    let target;
    if (!restricted.length) target = 'tous véhicules (aucun type visé)';
    else if (types.size === 1 && types.has('heavyGoodsVehicle')) target = 'poids lourd seul';
    else if ([...types].every((t) => t === 'heavyGoodsVehicle' || t === '(gabarit sans type)')) target = 'poids lourd et/ou gabarit';
    else if (types.has('heavyGoodsVehicle')) target = 'poids lourd avec d\'autres types';
    else target = 'autres types';
    inc(s.vehicleTargets, target);

    const seen = new Set();
    for (const v of m.vehicles) {
      for (const d of v.dims) {
        inc(s.operators, `${d.key}${v.negate ? ' (dérogation)' : ''} ${d.op ?? '(sans opérateur)'}`);
        const k = `${d.key}|${v.negate}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (v.negate) { s.dimsNegated[d.key]++; continue; }
        s.dims[d.key]++;
        (permanent ? s.dimsPermanent : s.dimsTemporary)[d.key]++;
        if (active) s.dimsActive[d.key]++;
      }
    }

    let box = null;
    for (const g of m.geometries) {
      let geom;
      try { geom = JSON.parse(g); } catch { s.badGeometry++; continue; }
      inc(s.geometryTypes, typeof geom?.type === 'string' ? geom.type : '(sans type)');
      box = mergeBox(box, geometryBox(geom));
    }
    if (m.geometries.length) s.withGeometry++;

    const hwDims = restricted.flatMap((v) => v.dims.filter((d) => d.key === 'hauteur' || d.key === 'poids'));
    if (!hwDims.length) return;
    s.hw++;
    o.hw++;
    if (permanent) s.hwPermanent++; else s.hwTemporary++;
    if (active) s.hwActive++;
    if (!box) s.hwNoGeometry++;
    let center = null;
    if (box) {
      s.hwBox = mergeBox(s.hwBox, box);
      center = [(box.south + box.north) / 2, (box.west + box.east) / 2];
      inc(s.hwCells, `${Math.floor(center[0])}N ${Math.floor(center[1])}E`);
    }
    const ex = {
      titre: order.title, organisation: org, regulationId: order.regulationId,
      mesure: m.regType + (m.regSubtype ? `/${m.regSubtype}` : ''),
      conditions: hwDims.map((d) => `${d.key} ${d.op ?? '?'} ${d.value ?? '?'}`).join(', '),
      types: [...types].join(', ') || '(aucun)',
      debut: order.startRaw, fin: order.endRaw ?? '(permanent)', vigueur: active,
      centre: center ? center.map((x) => Math.round(x * 1000) / 1000).join(', ') : '(sans géométrie)',
    };
    // Exemples : les premiers du fichier, hauteur et poids gardés à part (mélangés dans le journal).
    const list = hwDims.some((d) => d.key === 'hauteur') ? s.exHeight : s.exWeight;
    const same = (e) => e.titre === ex.titre && e.organisation === ex.organisation;
    if (list.length < examples && !list.some(same)) list.push(ex);
    if (center && center[0] >= VOSGES_BOX.south && center[0] <= VOSGES_BOX.north
      && center[1] >= VOSGES_BOX.west && center[1] <= VOSGES_BOX.east) {
      s.vosges++;
      if (s.vosgesExamples.length < vosgesExamples && !s.vosgesExamples.some(same)) s.vosgesExamples.push(ex);
    }
  }

  const handler = {
    open(name, attrs) {
      const type = attrs['xsi:type'] ? localName(attrs['xsi:type']) : null;
      text = '';
      if (name === 'trafficRegulationOrder') {
        order = { title: null, org: null, regulationId: null, start: null, end: null, startRaw: null, endRaw: null };
      } else if (name === 'trafficRegulation' && order) {
        measure = { regType: '(inconnu)', regSubtype: null, vehicles: [], geometries: [], validities: [] };
      } else if (measure && name === 'typeOfRegulation') {
        measure.regType = type ?? '(sans type)';
      } else if (measure && name === 'conditions' && type === 'VehicleCondition') {
        cond = { negate: false, types: [], dims: [], load: null, other: null, usage: null, emission: null };
      } else if (measure && name === 'conditions' && type === 'ValidityCondition') {
        validity = { start: null, end: null };
      } else if (cond && DIM[name]) {
        dim = { key: DIM[name].key, valueTag: DIM[name].value, op: null, value: null };
      }
      path.push(name);
    },
    text(t) { text += t; },
    close(name) {
      path.pop();
      const t = text.trim();
      text = '';
      if (name === 'publicationTime' && !order) s.publicationTime = t;
      if (name === 'trafficRegulationOrder') { s.orders++; order = null; return; }
      if (name === 'trafficRegulation' && measure) { finishMeasure(measure); measure = null; return; }
      if (!order) return;
      if (!measure) {
        if (name === 'value' && parent(1) === 'description' && parent(2) === 'trafficRegulationOrder') order.title = t;
        else if (name === 'value' && parent(1) === 'issuingAuthority') order.org = t;
        else if (name === 'regulationId' && parent(0) === 'trafficRegulationOrder') order.regulationId = t;
        else if (name === 'overallStartTime' && under('validityByOrder')) { order.startRaw = t; order.start = parseTime(t); }
        else if (name === 'overallEndTime' && under('validityByOrder')) { order.endRaw = t; order.end = parseTime(t); }
        return;
      }
      if (validity) {
        if (name === 'overallStartTime') validity.start = parseTime(t);
        else if (name === 'overallEndTime') validity.end = parseTime(t);
        else if (name === 'conditions') { measure.validities.push(validity); validity = null; }
        return;
      }
      if (name === 'accessRestrictionType' || name === 'roadOrCarriagewayOrLaneManagementType'
        || name === 'generalInstructionToRoadUsersType' || name === 'standingOrParkingRestrictionType') {
        measure.regSubtype = t;
      } else if (name === 'geoJsonGeometry') {
        if (t) measure.geometries.push(t);
      } else if (cond) {
        if (dim) {
          if (name === 'comparisonOperator') dim.op = t;
          else if (name === dim.valueTag) dim.value = t;
          else if (DIM[name]) { cond.dims.push(dim); dim = null; }
          return;
        }
        if (name === 'negate') cond.negate = t === 'true';
        else if (name === 'vehicleType') cond.types.push(t);
        else if (name === 'loadType') cond.load = t;
        else if (name === 'vehicleUsage') cond.usage = t;
        else if (name === 'emissionClassificationOther') cond.emission = t;
        else if (name === 'otherVehicleType') cond.other = t;
        else if (name === 'conditions') { measure.vehicles.push(cond); cond = null; }
      }
    },
  };

  return { handler, stats: s };
}

// ── Journal ────────────────────────────────────────────────────────────────────────────────────────────────────────

const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
const fmtMap = (map, n = 20) => top(map, n).map(([k, v]) => `${k} : ${v}`).join(' ; ') || '(aucune)';
const r3 = (x) => Math.round(x * 1000) / 1000;
const quote = (t) => (t == null ? '(absent)' : `« ${t.replace(/\s+/g, ' ').slice(0, 200)} »`);

// 5 exemples : 3 de hauteur et 2 de poids si possible, complétés par l'autre liste sinon.
export function pickExamples(h, w, n) {
  const nh = Math.min(h.length, Math.max(Math.ceil(n / 2), n - w.length));
  return [...h.slice(0, nh), ...w.slice(0, n - nh)];
}

export function formatReport(s, { bytes, readAt }) {
  const L = [];
  const d = (o) => `hauteur ${o.hauteur}, poids ${o.poids}, largeur ${o.largeur}, longueur ${o.longueur}`;
  L.push(`1. Taille ${bytes} o (${(bytes / 1048576).toFixed(1)} Mo), lu le ${readAt} (UTC), publicationTime ${s.publicationTime ?? '(absent)'}`);
  L.push(`   règlements (trafficRegulationOrder) ${s.orders}, mesures (trafficRegulation) ${s.measures}`);
  L.push(`2. Mesures avec condition (véhicules visés) : ${d(s.dims)}`);
  L.push(`   permanentes (sans date de fin) : ${d(s.dimsPermanent)}`);
  L.push(`   temporaires (avec date de fin) : ${d(s.dimsTemporary)}`);
  L.push(`   en vigueur le ${readAt.slice(0, 10)} : ${d(s.dimsActive)} (périodes récurrentes jour/heure non comptées)`);
  L.push(`   en dérogation (negate=true) : ${d(s.dimsNegated)}`);
  L.push(`   mesures avec hauteur ou poids : ${s.hw} (permanentes ${s.hwPermanent}, temporaires ${s.hwTemporary}, en vigueur ${s.hwActive}, sans géométrie ${s.hwNoGeometry})`);
  L.push(`3. Opérateurs lus : ${fmtMap(s.operators, 30)}`);
  const examples = pickExamples(s.exHeight, s.exWeight, 5);
  examples.forEach((e, k) => {
    L.push(`   ex. ${k + 1} : ${e.conditions} | ${e.mesure} | types ${e.types} | ${quote(e.titre)} | ${e.organisation} | arrêté ${e.regulationId ?? '?'} | ${e.debut} → ${e.fin} | vigueur ${e.vigueur ? 'oui' : 'non'}`);
  });
  L.push(`4. Types de mesure : ${fmtMap(s.regulationTypes)}`);
  L.push(`   véhicules visés (par mesure) : ${fmtMap(s.vehicleTargets)}`);
  L.push(`   types de véhicule cités : ${fmtMap(s.vehicleTypes, 25)}`);
  L.push(`5. Mesures avec GeoJSON ${s.withGeometry} / ${s.measures}, géométries illisibles ${s.badGeometry} ; types : ${fmtMap(s.geometryTypes)}`);
  const b = s.hwBox;
  L.push(`   hauteur ou poids : boîte englobante ${b ? `${r3(b.south)}…${r3(b.north)} N, ${r3(b.west)}…${r3(b.east)} E` : '(aucune)'}, ${s.hwCells.size} cellules d'un degré`);
  L.push(`   30 cellules les plus remplies (coin sud-ouest) : ${fmtMap(s.hwCells, 30)}`);
  const orgs = [...s.organizations.entries()];
  L.push(`6. Organisations : ${orgs.length} (dont ${orgs.filter(([, o]) => o.hw).length} avec hauteur ou poids)`);
  const orgTop = orgs.filter(([, o]) => o.hw).sort((a, c) => c[1].hw - a[1].hw || a[0].localeCompare(c[0])).slice(0, 40);
  L.push(`   40 premières (hauteur ou poids / mesures) : ${orgTop.map(([k, o]) => `${k} ${o.hw}/${o.measures}`).join(' ; ') || '(aucune)'}`);
  L.push(`7. Zone Destord / Vosges (${VOSGES_BOX.south}–${VOSGES_BOX.north} N, ${VOSGES_BOX.west}–${VOSGES_BOX.east} E, centre de la géométrie) : ${s.vosges} mesures avec hauteur ou poids`);
  s.vosgesExamples.forEach((e, k) => {
    L.push(`   ex. ${k + 1} : ${e.conditions} | ${e.mesure} | ${quote(e.titre)} | ${e.organisation} | ${e.debut} → ${e.fin} | centre ${e.centre}`);
  });
  return L.join('\n');
}

// ── Téléchargement (Action seulement) ──────────────────────────────────────────────────────────────────────────────

export function checkUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error(`adresse refusée (pas https) : ${u.protocol}`);
  if (!ALLOWED_HOSTS.includes(u.hostname)) throw new Error(`domaine refusé : ${u.hostname}`);
  return u;
}

// Aussi utilisé par tools/dialog-update.mjs (Action « DiaLog (copie) »).
export async function openStream(url) {
  let current = checkUrl(url).href;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, { redirect: 'manual', headers: { Accept: 'application/xml,text/xml,*/*;q=0.5' },
      signal: AbortSignal.timeout(15 * 60 * 1000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`redirection ${res.status} sans adresse`);
      const next = checkUrl(new URL(loc, current).href).href;
      process.stdout.write(`   ${res.status} → ${next}\n`);
      current = next;
      continue;
    }
    if (res.status !== 200) throw new Error(`HTTP ${res.status} sur ${current}`);
    process.stdout.write(`   200 ${res.headers.get('content-type') ?? ''} ${res.headers.get('content-length') ?? '?'} o, ${current}\n`);
    return res;
  }
  throw new Error('trop de redirections');
}

// Lit un flux (morceaux d'octets) dans un handler du lecteur XML ; aussi utilisé par tools/dialog-update.mjs.
export async function feedXml(chunks, handler) {
  const reader = createXmlReader(handler);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  for await (const chunk of chunks) {
    const b = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    bytes += b.length;
    if (bytes > MAX_BYTES) throw new Error('fichier trop gros');
    reader.write(decoder.decode(b, { stream: true }));
  }
  reader.write(decoder.decode());
  reader.end();
  return bytes;
}

export async function readStream(chunks, opts) {
  const { handler, stats } = createDialogStats(opts);
  const bytes = await feedXml(chunks, handler);
  return { stats, bytes };
}

async function main() {
  const readAt = new Date().toISOString();
  console.log(`Étude DiaLog — lecture du ${readAt} (UTC). Seul l'arrêté fait foi : DiaLog n'a pas de valeur juridique.`);
  const local = process.argv[2];
  if (local) {
    const { createReadStream } = await import('node:fs');
    const { stats, bytes } = await readStream(createReadStream(local), { now: Date.parse(readAt) });
    console.log(formatReport(stats, { bytes, readAt }));
    return;
  }
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`\n── essai ${attempt}/${MAX_ATTEMPTS} : ${DIALOG_URL}`);
    try {
      const res = await openStream(DIALOG_URL);
      const { stats, bytes } = await readStream(res.body, { now: Date.parse(readAt) });
      console.log('\n████ Résultats');
      console.log(formatReport(stats, { bytes, readAt }));
      return;
    } catch (err) {
      lastErr = err;
      console.log(`   échec : ${String(err?.message || err).slice(0, 300)}`);
      // XML mal formé ou refusé : un nouvel essai ne changerait rien.
      if (/^XML /.test(err?.message ?? '') || /domaine refusé|pas https/.test(err?.message ?? '')) break;
    }
  }
  console.log(`\nÉCHEC : ${String(lastErr?.message || lastErr).slice(0, 300)}`);
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
