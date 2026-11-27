// Phase 12a : ponts sans hauteur connue (copie OSM data/ponts-osm/, croisement avec l'itinéraire).
// Fixture osm-ponts-colombier.geojsonseq : GÉOMÉTRIE SYNTHÉTIQUE vers 47,66 N 6,21 E (api.openstreetmap.org bloqué
// depuis le conteneur le 22/11/2026), id et étiquettes du constat Besançon → Luxeuil (chemin 243477938 sans maxheight).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BRIDGES, bridgeFromFeature, clearanceFromFeature, convertBridges, osmiumBridgesFilter, sizeProblem, bridgeLayer,
} from '../src/lib/bridges-convert.js';
import {
  BRIDGE, parseBridgeTile, mergeBridgeTiles, bridgesAlongRoute, bridgeLines, bridgeTechText, parseHeight, lowBridgeText,
} from '../src/lib/bridge-check.js';
import { parseGeojsonLine } from '../src/lib/areas-osm-data.js';
import { AGGLO_ZONES } from '../src/lib/agglo-zones.js';
import { haversine } from '../src/lib/nav-geo.js';

const features = readFileSync(new URL('./fixtures/osm-ponts-colombier.geojsonseq', import.meta.url), 'utf8')
  .split('\n').map(parseGeojsonLine).filter(Boolean);
const bridges = features.map(bridgeFromFeature).filter(Boolean);
const clearances = features.map(clearanceFromFeature).filter(Boolean);
const conv = convertBridges(bridges, clearances, { updated: '2026-11-01', grid: null, countries: ['france'] });
// Passage par JSON : comme la case lue par l'appli.
const data = mergeBridgeTiles([...conv.tiles.values()].map((t) => parseBridgeTile(JSON.parse(JSON.stringify(t)))));

/** Itinéraire nord-sud par la Rue du Viaduc (sous le viaduc), puis autoroute au nord (waycategory 1). */
function underRoute() {
  const coordinates = [];
  for (let k = 0; k <= 22; k += 1) coordinates.push([6.21, Math.round((47.650 + k * 0.001) * 1e6) / 1e6]);
  const last = coordinates.length - 1;
  return {
    coordinates,
    steps: [
      { name: 'Rue du Viaduc', wayPoints: [0, 18] },
      { name: 'A 36', wayPoints: [18, last] },
    ],
    roadExtras: { waycategory: [[0, 18, 0], [18, last, 1]], waytype: [[0, 18, 3], [18, last, 1]] },
  };
}
/** Le même itinéraire qui emprunte le viaduc (tracé posé sur le pont). */
function onRoute() {
  const v = bridges.find((b) => b.id === 243477938).coords;
  const coordinates = [[6.2010, 47.6578], ...v, [6.2190, 47.6617]];
  return { coordinates, steps: [{ name: 'Rue de la Gare', wayPoints: [0, coordinates.length - 1] }], roadExtras: null };
}

test('filtre osmium : ponts et hauteurs, voies seulement', () => {
  assert.deepEqual(osmiumBridgesFilter(), ['w/bridge=yes,viaduct', 'w/maxheight', 'w/maxheight:physical']);
  assert.deepEqual(BRIDGES.REGIONS, ['europe/france']);
  assert.equal(BRIDGES.MAX_FILE_BYTES, 5 * 1024 * 1024);
  assert.equal(BRIDGES.MAX_TOTAL_BYTES, 60 * 1024 * 1024);
});

test('extraction : passerelle piétonne, layer < 1 et ponceau écartés ; rail et route gardés', () => {
  const ids = bridges.map((b) => b.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [1004, 1006, 1007, 243477938]);
  const v = bridges.find((b) => b.id === 243477938);
  assert.equal(v.kind, 'rail');
  assert.equal(v.height, null, 'pas de maxheight (constat)');
  assert.equal(v.name, 'Viaduc de Colombier');
  assert.equal(bridges.find((b) => b.id === 1006).height, '3.5');
  assert.equal(bridgeLayer({}), 1, 'layer absent : pont au-dessus du sol');
  assert.equal(bridgeLayer({ layer: '-1' }), -1);
  assert.deepEqual(clearances.map((c) => c.id), [1005]);
  assert.match(conv.log[0], /^Ponts : 4 \(routes 2, rail 2, dont 1 avec hauteur\), 1 tronçons à hauteur connue, 1 cases de 1°/);
  assert.deepEqual(Object.keys(conv.index.tiles), ['6_47']);
  assert.equal(sizeProblem(conv.sizes), null);
  assert.match(sizeProblem({ total: 1, biggest: ['2_48', 6 * 1024 * 1024] }), /plus de 5 Mo/);
  assert.match(sizeProblem({ total: 61 * 1024 * 1024, biggest: ['2_48', 1] }), /plus de 60 Mo/);
});

test('case : géométrie à 5 décimales gardée à l\'aller-retour', () => {
  const v = data.bridges.find((b) => b.id === 243477938);
  assert.deepEqual(v.coords[0], [6.204, 47.6585]);
  assert.equal(parseBridgeTile({ b: 'x' }), null);
});

test('acceptation : itinéraire sous le pont 243477938 → un signalement « haute » ; sur le pont → aucun', () => {
  const under = bridgesAlongRoute(underRoute(), data, { vehicleHeight: 4 });
  const colombier = under.items.filter((it) => it.id === 243477938);
  assert.equal(colombier.length, 1);
  assert.equal(colombier[0].level, 'high');
  assert.equal(colombier[0].text, BRIDGE.TEXT);
  assert.equal(BRIDGE.TEXT, "Passage sous un pont dont la hauteur n'est pas renseignée dans OpenStreetMap : à vérifier. La signalisation fait foi.");
  // Point de croisement exact (phase 12b : « Éviter ce passage ») : sur le tracé et sur le pont.
  const p = colombier[0].point;
  assert.ok(Math.abs(p[0] - 6.21) < 1e-6, 'sur le tracé');
  assert.ok(Math.abs(p[1] - 47.66) < 0.0002, 'sur le viaduc, pas à son centre ni à un nœud');
  const on = bridgesAlongRoute(onRoute(), data, { vehicleHeight: 4 });
  assert.equal(on.items.filter((it) => it.id === 243477938).length, 0);
});

test('hauteur connue dessous (tronçon maxheight à moins de 40 m) : ignoré ; autoroute dessous : comptée, jamais signalée', () => {
  const r = bridgesAlongRoute(underRoute(), data, { vehicleHeight: 4 });
  assert.ok(!r.items.some((it) => it.id === 1004), 'D 9 : maxheight du passage dessous connu');
  assert.equal(r.counts.knownBelow, 1);
  assert.ok(!r.items.some((it) => it.id === 1007));
  assert.equal(r.counts.motorway, 1);
  assert.equal(bridgeTechText(r), `Ponts sans hauteur : ${r.counts.high + r.counts.medium} (haute ${r.counts.high}, moyenne ${r.counts.medium}, autoroutes en zone 0, autoroutes ignorées 1)`);
});

test('pont portant sa propre hauteur : signalé si elle ne dépasse pas celle du véhicule', () => {
  const r = bridgesAlongRoute(underRoute(), data, { vehicleHeight: 4 });
  const low = r.items.find((it) => it.id === 1006);
  assert.equal(low.level, 'high');
  assert.equal(low.text, lowBridgeText(3.5));
  assert.match(low.text, /3,5 m.*à vérifier\. La signalisation fait foi\.$/);
  const small = bridgesAlongRoute(underRoute(), data, { vehicleHeight: 3 });
  assert.ok(!small.items.some((it) => it.id === 1006));
  assert.equal(small.counts.knownOk, 1);
  assert.equal(parseHeight('3,8 m'), 3.8);
  assert.equal(parseHeight("12'6\""), null);
  assert.equal(parseHeight('default'), null);
});

test('nationale dessous : priorité moyenne ; tri haute puis moyenne ; 5 au plus puis « +N »', () => {
  const r = underRoute();
  r.steps[0].name = 'N 57';
  r.roadExtras.waytype[0][2] = 1;
  const res = bridgesAlongRoute(r, data, { vehicleHeight: 4 });
  const v = res.items.find((it) => it.id === 243477938);
  assert.equal(v.level, 'medium');
  assert.equal(res.items[0].level, 'high', 'pont bas portant sa hauteur : toujours haute');
  const many = Array.from({ length: 8 }, (_, i) => ({ ...v, along: 1000 * i, level: i < 3 ? 'high' : 'medium' }));
  const lines = bridgeLines(many);
  assert.equal(lines.length, 6);
  assert.equal(lines[5].text, '+3 ponts à vérifier (voir la carte).');
  assert.match(lines[0].text, /^Passage sous un pont .*\(km 0, Viaduc de Colombier, pont ferroviaire ; priorité haute\)$/);
});

test('rien sans données ni tracé', () => {
  assert.deepEqual(bridgesAlongRoute(underRoute(), null).items, []);
  assert.deepEqual(bridgesAlongRoute({ coordinates: [] }, data).items, []);
  const d = haversine([6.21, 47.65], [6.21, 47.672]);
  assert.ok(d > 2000);
});

test('fiche : réglage désactivé → rien ; copie absente → « données non chargées » ; jamais de voix', async () => {
  const { bridgeRules, BRIDGE_UNAVAILABLE_TEXT } = await import('../src/lib/bridge-check.js');
  const { sanitizeData, emptyData } = await import('../src/lib/store.js');
  const ok = { status: 'ok', data, uncovered: false };
  const on = bridgeRules(underRoute(), { vehicle: { height: 4 }, bridges: ok });
  assert.ok(on.lines.some((l) => l.text.startsWith(BRIDGE.TEXT)));
  assert.match(on.short[0], /^\d+ ponts? à vérifier$/);
  assert.match(on.tech, /^Ponts sans hauteur : \d+ \(haute \d+, moyenne \d+, autoroutes en zone 0, autoroutes ignorées 1\)$/);
  const off = bridgeRules(underRoute(), { vehicle: { height: 4 }, bridges: ok, enabled: false });
  assert.deepEqual(off.lines, []);
  assert.deepEqual(off.items, []);
  const failed = bridgeRules(underRoute(), { bridges: { status: 'failed' } });
  assert.equal(failed.lines[0].text, BRIDGE_UNAVAILABLE_TEXT);
  assert.ok(!/[«]?Attention|annonce/i.test(BRIDGE.TEXT));
  // Réglage : activé par défaut, gardé à l'import.
  assert.equal(emptyData().settings.bridgeWarnings, true);
  const v = sanitizeData({ vehicles: [], settings: { bridgeWarnings: false } });
  assert.equal(v.settings.bridgeWarnings, false);
  assert.equal(sanitizeData({ vehicles: [], settings: {} }).settings.bridgeWarnings, true);
});

test('tracé qui monte sur le pont depuis une rue voisine : aucun signalement', () => {
  const v = bridges.find((b) => b.id === 243477938).coords;
  // Rue perpendiculaire qui rejoint le pont à son 3e nœud puis le suit.
  const route = { coordinates: [[6.2100, 47.6560], v[2], v[3], v[4]], steps: [], roadExtras: null };
  assert.equal(bridgesAlongRoute(route, data).items.filter((it) => it.id === 243477938).length, 0);
});

test('guidage : le moteur et l\'écran de guidage n\'importent jamais les ponts', () => {
  for (const f of ['../src/lib/navigation.js', '../src/ui/navigation.js', '../src/ui/voice.js', '../src/lib/nav-guidance.js']) {
    const text = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/bridge-check|bridges/.test(text), `${f} ne doit rien savoir des ponts`);
  }
});

// Données RÉELLES (extrait de la copie de l'Action du 21/11/2026) : pont 243477938 et tronçon 531802661 à 3,8 m dessous.
test('acceptation (données réelles) : sous le pont 243477938 → « haute » à 3,8 m ; sur la voie ferrée → aucun ; 3,5 m de haut → rien', () => {
  const real = mergeBridgeTiles([parseBridgeTile(JSON.parse(readFileSync(new URL('./fixtures/osm-ponts-colombier-reel.json', import.meta.url), 'utf8')))]);
  const v = real.bridges.find((b) => b.id === 243477938);
  assert.deepEqual(v.coords, [[6.21211, 47.65992], [6.21225, 47.65997]]);
  const mid = [(v.coords[0][0] + v.coords[1][0]) / 2, (v.coords[0][1] + v.coords[1][1]) / 2];
  const under = { coordinates: [[mid[0], 47.6590], [mid[0], 47.6610]], steps: [{ name: 'Rue de Colombier', wayPoints: [0, 1] }], roadExtras: null };
  const r = bridgesAlongRoute(under, real, { vehicleHeight: 4 });
  const it = r.items.find((x) => x.id === 243477938);
  assert.equal(it.level, 'high');
  assert.equal(it.text, lowBridgeText(3.8), 'hauteur 3,8 m dessous (531802661) au plus celle du camion de 4 m');
  assert.ok(Math.abs(it.point[0] - mid[0]) < 1e-6 && Math.abs(it.point[1] - 47.659945) < 0.00005, 'point de croisement');
  const onTrack = { coordinates: [[6.2115, 47.6597], ...v.coords, [6.2130, 47.6602]], steps: [], roadExtras: null };
  assert.equal(bridgesAlongRoute(onTrack, real, { vehicleHeight: 4 }).items.filter((x) => x.id === 243477938).length, 0);
  const low = bridgesAlongRoute(under, real, { vehicleHeight: 3.5 });
  assert.ok(!low.items.some((x) => x.id === 243477938), 'véhicule de 3,5 m : hauteur connue dessous suffisante');
  assert.ok(low.counts.knownBelow >= 1);
});

// ───────── v91 : ponts au-dessus des autoroutes, zones des grandes agglomérations (agglo-zones.js) ─────────
// Zones SYNTHÉTIQUES (2 décimales) : carré autour de l'autoroute du nord de underRoute() (47,668 à 47,672 N).
const square = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
function fakeZones(around) {
  const far = square(0.1, 40.1, 0.2, 40.2);
  // Toutes les clés lues par l'appli (v92 : 13 de data/zones-agglo.json), loin du tracé.
  const z = Object.fromEntries(AGGLO_ZONES.ZONES_KEYS.map((k) => [k, far]));
  const c = Object.fromEntries(AGGLO_ZONES.CONTOURS_KEYS.map((k) => [k, far]));
  if (around) z.lille = square(6.20, 47.665, 6.22, 47.68);
  return parseAggloZonesFn(z, c);
}
let parseAggloZonesFn;

test('v91 : pont sans hauteur sur autoroute en zone → priorité moyenne, compté à part ; hors zone → ignoré', async () => {
  ({ parseAggloZones: parseAggloZonesFn } = await import('../src/lib/agglo-zones.js'));
  const inZ = bridgesAlongRoute(underRoute(), data, { vehicleHeight: 4, zones: fakeZones(true) });
  const m = inZ.items.find((it) => it.id === 1007);
  assert.equal(m.level, 'medium');
  assert.equal(m.zone, 'lille');
  assert.equal(m.text, BRIDGE.TEXT);
  assert.equal(inZ.counts.motorwayZone, 1);
  assert.equal(inZ.counts.motorway, 0);
  assert.match(bridgeLines(inZ.items).find((l) => l.text.startsWith(BRIDGE.TEXT) && /moyenne/.test(l.text)).text, /priorité moyenne\)$/);
  assert.equal(bridgeTechText(inZ), `Ponts sans hauteur : ${inZ.counts.high + inZ.counts.medium + 1} (haute ${inZ.counts.high}, moyenne ${inZ.counts.medium}, autoroutes en zone 1, autoroutes ignorées 0)`);
  // Point du croisement dans la zone (2 décimales près) ; les autres ponts du trajet inchangés.
  assert.ok(m.point[1] > 47.665 && m.point[1] < 47.68);
  const out = bridgesAlongRoute(underRoute(), data, { vehicleHeight: 4, zones: fakeZones(false) });
  assert.ok(!out.items.some((it) => it.id === 1007));
  assert.equal(out.counts.motorway, 1);
  assert.equal(out.counts.motorwayZone, 0);
  const none = bridgesAlongRoute(underRoute(), data, { vehicleHeight: 4 });
  assert.deepEqual(out.items, none.items);
  assert.deepEqual(inZ.items.filter((it) => it.id !== 1007), none.items);
});

test('v91 : pont portant une hauteur ≤ véhicule au-dessus d\'une autoroute → priorité haute, en zone ou non', async () => {
  ({ parseAggloZones: parseAggloZonesFn } = await import('../src/lib/agglo-zones.js'));
  const r = underRoute();
  // Tout le tracé en autoroute : le pont 1006 (3,5 m sur le pont) passe au-dessus d'une autoroute.
  r.roadExtras = { waycategory: [[0, r.coordinates.length - 1, 1]], waytype: [[0, r.coordinates.length - 1, 1]] };
  r.steps = [{ name: 'A 36', wayPoints: [0, r.coordinates.length - 1] }];
  const far = square(0.1, 40.1, 0.2, 40.2);
  const zoneAll = parseAggloZonesFn(
    { ...Object.fromEntries(AGGLO_ZONES.ZONES_KEYS.map((k) => [k, far])), ileDeFrance: square(6.1, 47.6, 6.3, 47.7) },
    Object.fromEntries(AGGLO_ZONES.CONTOURS_KEYS.map((k) => [k, far])));
  assert.ok(zoneAll);
  for (const zones of [zoneAll, fakeZones(false), null]) {
    const res = bridgesAlongRoute(r, data, { vehicleHeight: 4, zones });
    const low = res.items.find((it) => it.id === 1006);
    assert.equal(low.level, 'high');
    assert.equal(low.text, lowBridgeText(3.5));
    assert.equal(low.zone, undefined);
  }
});

test('v91 : zones indisponibles → une seule ligne « à vérifier », aucun pont d\'autoroute signalé ; chargement : comme avant', async () => {
  const { bridgeRules } = await import('../src/lib/bridge-check.js');
  const { AGGLO_ZONES } = await import('../src/lib/agglo-zones.js');
  assert.equal(AGGLO_ZONES.UNAVAILABLE_TEXT, 'Zones des grandes agglomérations indisponibles : ponts sans hauteur au-dessus des autoroutes non examinés. La signalisation fait foi.');
  const ok = { status: 'ok', data, uncovered: false };
  const base = bridgeRules(underRoute(), { vehicle: { height: 4 }, bridges: ok });
  const failed = bridgeRules(underRoute(), { vehicle: { height: 4 }, bridges: ok, zones: { status: 'failed', data: null } });
  const zl = failed.lines.filter((l) => l.text === AGGLO_ZONES.UNAVAILABLE_TEXT);
  assert.equal(zl.length, 1);
  assert.equal(zl[0].sev, 'check');
  assert.equal(zl[0].level, 'info');
  assert.deepEqual(failed.items, base.items);
  assert.ok(!failed.items.some((it) => it.id === 1007));
  assert.equal(failed.lines.length, base.lines.length + 1);
  assert.match(failed.tech, /autoroutes ignorées 1\) ; zones des agglomérations indisponibles$/);
  for (const st of ['idle', 'loading']) {
    const r = bridgeRules(underRoute(), { vehicle: { height: 4 }, bridges: ok, zones: { status: st, data: null } });
    assert.deepEqual(r.lines, base.lines);
  }
  // Copie des ponts absente ou réglage désactivé : pas de ligne des zones.
  assert.ok(!bridgeRules(underRoute(), { bridges: { status: 'failed' }, zones: { status: 'failed' } }).lines.some((l) => l.text === AGGLO_ZONES.UNAVAILABLE_TEXT));
  assert.deepEqual(bridgeRules(underRoute(), { bridges: ok, zones: { status: 'failed' }, enabled: false }).lines, []);
  // Zones lues : pont 1007 en zone signalé.
  ({ parseAggloZones: parseAggloZonesFn } = await import('../src/lib/agglo-zones.js'));
  const zr = bridgeRules(underRoute(), { vehicle: { height: 4 }, bridges: ok, zones: { status: 'ok', data: fakeZones(true) } });
  assert.ok(zr.items.some((it) => it.id === 1007 && it.level === 'medium'));
});
