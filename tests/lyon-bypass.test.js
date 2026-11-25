// « Contourner par la rocade Est » (v76) : vraie réponse ORS Mâcon → Valence (44 t, 24/11/2026), copie des points
// sensibles du dépôt, cases réduites des axes (voies à 300 m du tracé + toutes les A46, N346, A6, A7 de ses cases),
// contour IGN de la Métropole de Lyon (data/contours-ign.json). Aucune API appelée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fixture } from './helpers.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { parseAxesTile, mergeAxesTiles, matchRouteAxes } from '../src/lib/axis-match.js';
import {
  sensitiveRules, parseSensitiveTile, mergeSensitiveTiles, parseSensitiveSections,
} from '../src/lib/sensitive-points.js';
import {
  LYON_BYPASS, LYON_RULE_TEXT, LYON_REASON_TEXTS, lyonBypassPlan, rocadePoints, carriagewayPoints, inMetro,
  withBypassStops, bypassCost, bypassNote,
} from '../src/lib/lyon-bypass.js';
import { cleanStop, sanitizeStops, legLines, shownStopPoints, STOPS } from '../src/lib/stops.js';
import { placeStops, remainingStops, withoutViaArrivals } from '../src/lib/navigation.js';
import { prepareLine } from '../src/lib/nav-geo.js';
import { guidanceParams, optionStops, rocadeOption } from '../src/lib/route-options.js';

const AX_DIR = new URL('./fixtures/axes-osm-macon-valence/', import.meta.url);
const AXES = {
  status: 'ok',
  data: mergeAxesTiles(readdirSync(AX_DIR).filter((f) => f !== 'index.json')
    .map((f) => parseAxesTile(JSON.parse(readFileSync(new URL(f, AX_DIR), 'utf8'))))),
};
const SP_DIR = new URL('../data/points-sensibles/', import.meta.url);
const SP_INDEX = JSON.parse(readFileSync(new URL('index.json', SP_DIR), 'utf8'));
const SENS = {
  status: 'ok', updated: SP_INDEX.updated, meta: { sections: parseSensitiveSections(SP_INDEX) },
  data: mergeSensitiveTiles(['4_44', '4_45', '4_46'].map((k) => parseSensitiveTile(JSON.parse(readFileSync(new URL(`${k}.json`, SP_DIR), 'utf8'))))),
};
const CONTOURS = JSON.parse(readFileSync(new URL('../data/contours-ign.json', import.meta.url), 'utf8'));
const METRO = { status: 'ok', rings: CONTOURS.metropoleLyon };
const SEMI = { weight: 44, height: 4 };
const VAN = { weight: 3.5, height: 2.8 };
const route = () => parseDirections(fixture('ors-directions-macon-valence.json'));

/** Itinéraire retourné (Valence → Mâcon) : mêmes points dans l'autre ordre, étapes retournées. */
function reversed(r) {
  const n = r.coordinates.length;
  return {
    ...r,
    coordinates: [...r.coordinates].reverse(),
    steps: r.steps.map((s) => ({ ...s, wayPoints: s.wayPoints ? [n - 1 - s.wayPoints[1], n - 1 - s.wayPoints[0]] : null })).reverse(),
    roadExtras: null,
  };
}

function planFor(r, { vehicle = SEMI, metro = METRO, axes = AXES, start = null, end = null, stops = [] } = {}) {
  const geo = matchRouteAxes(r, axes.data, { copyTolerance: 3 });
  const items = sensitiveRules(r, { vehicle, copy: SENS, geo: geo.status === 'ok' ? geo : null }).items;
  return lyonBypassPlan(r, { items, sensitive: SENS, axes, metro, start, end, stops });
}

const onRef = (p, ref) => AXES.data.lines.some((l) => l.refs.includes(ref) && l.coords.some((q) => q[0] === p[0] && q[1] === p[1]));

test('constantes : sections lyon-a6 / lyon-a7, 3 points, 30°, 3 km, +30 % / +60 km ; textes et sources', () => {
  assert.deepEqual(LYON_BYPASS.SECTIONS, ['lyon-a6', 'lyon-a7']);
  assert.equal(LYON_BYPASS.VIA_COUNT, 3);
  assert.equal(LYON_BYPASS.MAX_HEADING_DEG, 30);
  assert.equal(LYON_BYPASS.JUNCTION_GAP_M, 3000);
  assert.equal(LYON_BYPASS.LONGER_SHARE, 0.30);
  assert.equal(LYON_BYPASS.LONGER_M, 60000);
  assert.match(LYON_RULE_TEXT, /Interdit aux plus de 7,5 t en transit, sauf desserte locale\. À vérifier\. La signalisation fait foi\./i);
  assert.match(LYON_RULE_TEXT, /dépliant des interdictions 2020/);
  assert.match(LYON_RULE_TEXT, /question n° 146 de l'Assemblée nationale, JO du 29\/01\/2008/);
  assert.equal(CONTOURS.props.metropoleLyon.nom_officiel, 'Métropole de Lyon');
});

test('44 t, Mâcon → Valence : bouton, nord→sud, 3 points A46 → N346 → A46 dans l\'ordre de la chaîne', () => {
  const plan = planFor(route());
  assert.equal(plan.concerned, true);
  assert.equal(plan.ok, true, plan.reason);
  assert.equal(plan.dir, 'south');
  assert.equal(plan.via.length, 3);
  assert.ok(plan.via.every((v) => v.via === true && v.label === LYON_BYPASS.VIA_LABEL));
  const [n, m, s] = plan.via.map((v) => [v.lon, v.lat]);
  assert.ok(onRef(n, 'A46') && onRef(m, 'N346') && onRef(s, 'A46'), 'sommets des voies de la copie, aucune coordonnée tapée');
  // Ordre de la chaîne A46 → N346 → A46 : le point milieu est plus à l'est que les deux autres.
  assert.ok(m[0] > n[0] && m[0] > s[0], JSON.stringify(plan.via));
  assert.ok(n[1] > m[1] && m[1] > s[1], 'du nord au sud');
  // Chaussée au cap du sens de marche (vers le sud).
  for (const [p, ref] of [[n, 'A46'], [m, 'N346'], [s, 'A46']]) {
    assert.ok(carriagewayPoints(AXES.data.lines, ref, 180).some((q) => q === p || (q[0] === p[0] && q[1] === p[1])), `${ref} ${p}`);
  }
  assert.ok(plan.lines.some((l) => l.level === 'warn' && l.text === LYON_RULE_TEXT));
});

test('sud→nord (même trajet retourné) : ordre inversé, chaussée vers le nord, autre chaussée que vers le sud', () => {
  const south = planFor(route());
  const north = planFor(reversed(route()));
  assert.equal(north.ok, true, north.reason);
  assert.equal(north.dir, 'north');
  const [s, m, n] = north.via.map((v) => [v.lon, v.lat]);
  assert.ok(m[0] > s[0] && m[0] > n[0], 'point milieu plus à l\'est');
  assert.ok(s[1] < m[1] && m[1] < n[1], 'du sud au nord');
  assert.ok(carriagewayPoints(AXES.data.lines, 'N346', 0).some((q) => q[0] === m[0] && q[1] === m[1]));
  const sm = south.via[1];
  assert.notDeepEqual([sm.lon, sm.lat], m, 'chaussées opposées de la N346');
  assert.deepEqual(rocadePoints(AXES.data.lines, SENS, 'north').map((p) => p.join()), north.via.map((v) => `${v.lon},${v.lat}`));
});

test('3,5 t : aucune interdiction Lyon, aucun bouton', () => {
  const plan = planFor(route(), { vehicle: VAN });
  assert.equal(plan.concerned, false);
  assert.equal(plan.ok, false);
  assert.equal(plan.lines.length, 0);
});

test('départ dans la Métropole de Lyon (point du tracé de la fixture) : desserte locale, pas de bouton', () => {
  const r = route();
  const inside = r.coordinates.find((p) => inMetro(p, METRO.rings));
  assert.ok(inside, 'la fixture traverse la Métropole');
  assert.equal(inMetro(r.coordinates[0], METRO.rings), false, 'Mâcon hors du contour');
  const plan = planFor(r, { start: inside });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'local');
  assert.ok(plan.lines[0].text.startsWith(LYON_RULE_TEXT) && plan.lines[0].text.endsWith(LYON_REASON_TEXTS.local));
  // Étape de l'utilisateur dans la Métropole : de même ; point de passage technique : ignoré.
  assert.equal(planFor(r, { stops: [{ label: 'Livraison', lon: inside[0], lat: inside[1] }] }).reason, 'local');
});

test('contour non chargé, axes sans rocade, étapes pleines, rocade déjà prise : pas de bouton, texte', () => {
  const r = route();
  assert.equal(planFor(r, { metro: { status: 'failed', rings: null } }).reason, 'metro');
  assert.equal(planFor(r, { metro: null }).reason, 'metro');
  const noRocade = { status: 'ok', data: { lines: AXES.data.lines.filter((l) => !l.refs.includes('N346')) } };
  assert.equal(planFor(r, { axes: noRocade }).reason, 'points', 'aucune N346 au bon cap → pas de bouton');
  assert.equal(planFor(r, { axes: { status: 'failed', data: { lines: [] } } }).reason, 'points');
  const far = (i) => ({ label: `É${i}`, lon: 4.8, lat: 46.2 + i * 0.001 });
  const eight = Array.from({ length: 8 }, (_, i) => far(i));
  const full = planFor(r, { stops: eight });
  assert.equal(full.reason, 'full');
  assert.match(full.lines[0].text, new RegExp(STOPS.FULL_TEXT.replace(/[.]/g, '\\.')));
  assert.equal(planFor(r, { stops: eight.slice(0, 7) }).ok, true, '7 + 3 = 10 : permis');
  const applied = planFor(r, { stops: planFor(r).via });
  assert.equal(applied.ok, false);
  assert.equal(applied.applied, true);
  assert.equal(applied.reason, 'applied');
});

test('étapes : points de passage rangés à leur place sur le tracé, dans l\'ordre de marche', () => {
  const r = route();
  const plan = planFor(r);
  const line = prepareLine(r.coordinates);
  const { locateOnLine } = { locateOnLine: (p) => { let best = 0; let bd = Infinity; r.coordinates.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = line.cum[i]; } }); return best; } };
  const before = { label: 'Mâcon nord', lon: r.coordinates[50][0], lat: r.coordinates[50][1] };
  const after = { label: 'Valence', lon: r.coordinates[1600][0], lat: r.coordinates[1600][1] };
  const list = withBypassStops([before, after], plan.via, locateOnLine);
  assert.deepEqual(list.map((x) => x.label), ['Mâcon nord', LYON_BYPASS.VIA_LABEL, LYON_BYPASS.VIA_LABEL, LYON_BYPASS.VIA_LABEL, 'Valence']);
  assert.deepEqual(list.slice(1, 4), plan.via);
  assert.equal(withBypassStops([], plan.via, locateOnLine).length, 3);
});

test('écart : « Allonge de X km / Y min » au-delà de +30 % de durée ou +60 km', () => {
  const orig = { distance: 180000, duration: 8700 };
  assert.equal(bypassCost(orig, { distance: 200000, duration: 9500 }), null);
  const km = bypassCost(orig, { distance: 245000, duration: 9500 });
  assert.match(km.text, /^Allonge de 65 km \/ 13 min par rapport à l'itinéraire de départ\. À vérifier\.$/);
  const time = bypassCost(orig, { distance: 210000, duration: 8700 * 1.31 });
  assert.ok(time && time.duration > 0);
  assert.equal(bypassCost(null, orig), null);
  assert.match(bypassNote(km), /^Itinéraire par la rocade Est .*La signalisation fait foi\. Allonge de 65 km/);
  assert.equal(bypassNote(null), LYON_REASON_TEXTS.applied);
});

test('étape `via` : gardée au nettoyage, au placement, au recalcul ; jamais une arrivée intermédiaire ni un repère', () => {
  const v = { label: LYON_BYPASS.VIA_LABEL, lon: 4.9, lat: 45.7, via: true };
  assert.deepEqual(cleanStop(v), v);
  assert.equal(cleanStop({ label: 'A', lon: 4.9, lat: 45.7, via: 'oui' }).via, undefined);
  assert.deepEqual(sanitizeStops([v]), [v]);
  assert.deepEqual(shownStopPoints([{ label: 'A', lon: 1, lat: 2 }, v]), [[1, 2]]);
  const r = route();
  const line = prepareLine(r.coordinates);
  const placed = placeStops([{ label: 'A', lon: 4.8, lat: 46.0 }, v], { ...r, wayPoints: null }, line);
  assert.equal(placed[1].via, true);
  assert.equal(placed[0].via, undefined);
  assert.deepEqual(remainingStops({ stops: placed, nextStop: 0 }).map((x) => x.via === true), [false, true]);
  // ORS : une arrivée (type 10) par tronçon ; celle du point de passage retirée, celle de l'étape gardée.
  const ms = [{ type: 10, waypoint: true, at: 1 }, { type: 0, at: 2 }, { type: 10, waypoint: true, at: 3 }, { type: 10, at: 9 }];
  assert.deepEqual(withoutViaArrivals(ms, [{ label: 'A' }, v]).map((m) => m.at), [1, 2, 9]);
  assert.deepEqual(withoutViaArrivals(ms, [v, { label: 'A' }]).map((m) => m.at), [2, 3, 9]);
  assert.equal(withoutViaArrivals(ms, [{ label: 'A' }]), ms);
  // Fiche : tronçons de part et d'autre du point de passage réunis.
  const legs = legLines({ legs: [{ duration: 600, distance: 10000 }, { duration: 1200, distance: 20000 }, { duration: 300, distance: 5000 }] },
    [{ label: 'A' }, v], new Date(2026, 10, 26, 8, 0));
  assert.equal(legs.length, 2);
  assert.match(legs[1].detail, /^25 min · 25,0 km/, 'A → point de passage → arrivée : un seul tronçon');
  assert.equal(legLines({ legs: [{ duration: 1, distance: 1 }, { duration: 1, distance: 1 }] }, [v]).length, 0);
});

test('fiche « Rocade Est » : ses étapes servent au guidage et au recalcul ; les autres fiches gardent celles du trajet', () => {
  const v = { label: LYON_BYPASS.VIA_LABEL, lon: 4.9, lat: 45.7, via: true };
  const base = { key: 'recommended', request: { avoidTolls: false, preference: 'recommended', avoidPolygons: null }, route: route() };
  const ro = rocadeOption(base, route(), [v], 'note');
  assert.equal(ro.key, 'rocade');
  assert.equal(ro.label, 'Rocade Est');
  assert.deepEqual(guidanceParams(ro, { start: [1, 2], end: [3, 4], stops: [] }).stops, [v]);
  assert.deepEqual(guidanceParams(base, { start: [1, 2], end: [3, 4], stops: [{ label: 'A', lon: 1, lat: 1 }] }).stops.length, 1);
  assert.deepEqual(optionStops(base, null), []);
});
