// v79 : contournement automatique par tronçons (ban-detour.js). Copie réelle des points sensibles du dépôt ; tracés
// de test (ligne nord-sud par les points de la N59) et réponses ORS SIMULÉES par des fonctions (aucune API appelée) :
// ce test vérifie la méthode, pas le comportement réel d'ORS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseSensitiveTile, mergeSensitiveTiles, parseSensitiveSections, sensitiveRules } from '../src/lib/sensitive-points.js';
import { routeBans } from '../src/lib/route-bans.js';
import { crowPath, STOPS } from '../src/lib/stops.js';
import {
  DETOUR, sectionPoints, sectionSpan, cutPoints, sectionSquares, detourVias, uturnNear, withDetourStops, detourLegs,
  detourCost, detourNote, detourFailText, planDetour,
} from '../src/lib/ban-detour.js';

const DIR = new URL('../data/points-sensibles/', import.meta.url);
const INDEX = JSON.parse(readFileSync(new URL('index.json', DIR), 'utf8'));
const COPY = {
  status: 'ok', updated: INDEX.updated, meta: { sections: parseSensitiveSections(INDEX) },
  data: mergeSensitiveTiles(readdirSync(DIR).filter((f) => f !== 'index.json')
    .map((f) => parseSensitiveTile(JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))))),
};
const SEMI = { weight: 44, height: 4 };
const PTS = sectionPoints(COPY, 'n59').map((p) => p.point).sort((a, b) => b[1] - a[1]);
const FIRST = PTS[0];
const LAST = PTS[PTS.length - 1];
/** Trajet de test : 45 km au nord, la N59 (points de la copie), 45 km au sud. */
const ROUTE = {
  coordinates: [[FIRST[0], FIRST[1] + 0.4], [FIRST[0], FIRST[1] + 0.2], ...PTS, [LAST[0], LAST[1] - 0.2], [LAST[0], LAST[1] - 0.4]],
  steps: [], distance: 140000, duration: 6000,
};
const BANS = routeBans(ROUTE, sensitiveRules(ROUTE, { vehicle: SEMI, copy: COPY }).items, COPY.meta.sections, { vehicle: SEMI });
const EAST = 0.15;
/** Tronçon simulé : passe 0,15° à l'est de la section. */
const legStub = async (a, b) => ({ coordinates: [a, [FIRST[0] + EAST, FIRST[1]], [(FIRST[0] + LAST[0]) / 2 + EAST, (FIRST[1] + LAST[1]) / 2], [LAST[0] + EAST, LAST[1]], b], steps: [] });
/** Trajet final simulé : départ, points de passage reçus, arrivée (hors de la section). */
const finalStub = async (stops) => ({
  coordinates: [ROUTE.coordinates[0], ROUTE.coordinates[1], ...stops.map((s) => [s.lon, s.lat]), ROUTE.coordinates.at(-2), ROUTE.coordinates.at(-1)],
  steps: [{ type: 11, wayPoints: [0, 1] }], distance: 160000, duration: 7000,
});

test('section sur le tracé, points A / B à 15 km, tronçon sous 150 km à vol d\'oiseau', () => {
  assert.deepEqual(BANS.map((b) => b.id), ['n59']);
  const span = sectionSpan(ROUTE, sectionPoints(COPY, 'n59'));
  assert.ok(span && span.to > span.from && span.from > 20000);
  const cut = cutPoints(ROUTE, span);
  assert.ok(cut.crow < DETOUR.MAX_CROW_M && cut.crow > crowPath([FIRST, LAST]), 'A au nord et B au sud de la section');
  assert.equal(cutPoints({ coordinates: ROUTE.coordinates.slice(2) }, { from: 500, to: 1000 }).a, PTS[0], 'départ plus près que 15 km : départ');
});

test('zone évitée : un carré de 80 m par point, chacun loin des 200 km² et 20 km d\'ORS', () => {
  const sq = sectionSquares(sectionPoints(COPY, 'n59'));
  assert.equal(sq.type, 'MultiPolygon');
  assert.equal(sq.coordinates.length, sectionPoints(COPY, 'n59').length); // un carré par point de la copie
  const ring = sq.coordinates[0][0];
  const w = (ring[1][0] - ring[0][0]) * Math.cos(ring[0][1] * Math.PI / 180) * 111320;
  assert.ok(Math.abs(w - 80) < 1);
});

test('points de passage au milieu du détour, loin de la section ; aucun détour → rien', async () => {
  const leg = await legStub(ROUTE.coordinates[1], ROUTE.coordinates.at(-2));
  const vias = detourVias(ROUTE, leg, sectionPoints(COPY, 'n59'));
  assert.ok(vias.length >= 1 && vias.length <= 2);
  assert.ok(vias.every((v) => v[0] > FIRST[0] + 0.1));
  assert.deepEqual(detourVias(ROUTE, { coordinates: ROUTE.coordinates }, sectionPoints(COPY, 'n59')), []);
});

test('demi-tour (consigne 9) à 1 km d\'un point de passage détecté', () => {
  const v = { lon: 7, lat: 48, via: true };
  assert.equal(uturnNear({ coordinates: [[7, 48.001], [7, 48.01]], steps: [{ type: 9, wayPoints: [0, 1] }] }, [v]), true);
  assert.equal(uturnNear({ coordinates: [[7, 48.1], [7, 48.2]], steps: [{ type: 9, wayPoints: [0, 1] }] }, [v]), false);
  assert.equal(uturnNear({ coordinates: [[7, 48.001]], steps: [{ type: 0, wayPoints: [0, 0] }] }, [v]), false);
  // Boucle sans consigne 9 : aller vers le nord jusqu'au point, 5 km plus loin, retour par l'autre chaussée (40 m).
  const loop = [[7, 47.97], [7, 48], [7, 48.045], [7.0005, 48.045], [7.0005, 48], [7.0005, 47.97]];
  assert.equal(uturnNear({ coordinates: loop, steps: [] }, [v]), true, 'boucle détectée');
  assert.equal(uturnNear({ coordinates: [[7, 47.97], [7, 48], [7, 48.05]], steps: [] }, [v]), false, 'passage simple');
});

test('étapes : points du détour rangés à leur place, étapes du chauffeur et de la rocade gardées', () => {
  const along = (p) => -p[1];
  const list = withDetourStops([{ label: 'A', lon: 7, lat: 49 }, { label: 'B', lon: 7, lat: 47 }], [[7.3, 48.2]], along);
  assert.deepEqual(list.map((s) => s.label), ['A', DETOUR.VIA_LABEL, 'B']);
  assert.equal(list[1].via, true);
});

test('contournement complet : 1 tronçon + 1 trajet final = 2 requêtes, section évitée, note et écart', async () => {
  const legs = [];
  const out = await planDetour({
    route: ROUTE, bans: BANS, copy: COPY, vehicle: SEMI,
    fetchLeg: async (a, b, avoid) => { legs.push({ a, b, avoid }); return legStub(a, b); },
    fetchFinal: finalStub,
  });
  assert.equal(out.ok, true);
  assert.equal(out.requests, 2);
  assert.equal(legs.length, 1);
  assert.ok(crowPath([legs[0].a, legs[0].b]) <= 150000);
  assert.equal(legs[0].avoid.coordinates.length, sectionPoints(COPY, 'n59').length);
  assert.ok(out.stops.some((s) => s.via === true && s.label === DETOUR.VIA_LABEL));
  assert.match(detourCost(ROUTE, out.route), /^Allonge de 20 km \/ 17 min par rapport au trajet direct\.$/);
  assert.match(detourNote(BANS, detourCost(ROUTE, out.route)), /^Contournement appliqué : N59 \/ N159.*À vérifier\. La signalisation fait foi\. Source : Bison Futé, arrêté non lu\. Allonge/);
});

test('échecs : tronçon en erreur, aucun détour, encore la section, demi-tour, trop d\'étapes', async () => {
  const base = { route: ROUTE, bans: BANS, copy: COPY, vehicle: SEMI, fetchLeg: legStub, fetchFinal: finalStub };
  const err = new Error('hors ligne');
  let out = await planDetour({ ...base, fetchLeg: async () => { throw err; } });
  assert.deepEqual([out.ok, out.reason, out.requests, out.error], [false, 'request', 1, err]);
  out = await planDetour({ ...base, fetchLeg: async () => ({ coordinates: ROUTE.coordinates }) });
  assert.equal(out.reason, 'nodetour');
  out = await planDetour({ ...base, fetchFinal: async () => ROUTE });
  assert.equal(out.reason, 'still');
  out = await planDetour({
    ...base,
    fetchFinal: async (stops) => {
      const r = await finalStub(stops);
      const i = r.coordinates.findIndex((p) => p[0] > FIRST[0] + 0.1);
      return { ...r, steps: [{ type: 9, wayPoints: [i, i] }] };
    },
  });
  assert.equal(out.reason, 'uturn');
  const ten = Array.from({ length: STOPS.MAX }, (_, i) => ({ label: `E${i}`, lon: 6, lat: 47 + i * 0.01 }));
  out = await planDetour({ ...base, stops: ten });
  assert.equal(out.reason, 'full');
  assert.equal(detourLegs(ROUTE, [{ id: 'inconnue' }], COPY).reason, 'span');
  assert.match(detourFailText('far'), /150 km à vol d'oiseau/);
});

test('fiche, remplacement (rocade retirée si elle passe par la section), zones, desserte déclarée', async () => {
  const { legAvoid, detourOption, applyDetour, allDeclared, DETOUR_STATES } = await import('../src/lib/ban-detour.js');
  const sq = { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] };
  assert.equal(legAvoid(sq, null).coordinates.length, 1);
  assert.equal(legAvoid(sq, { type: 'Polygon', coordinates: [[[2, 2], [3, 2], [3, 3], [2, 2]]] }).coordinates.length, 2);
  assert.equal(legAvoid(sq, { type: 'MultiPolygon', coordinates: [1, 2].map(() => sq.coordinates[0]) }).coordinates.length, 3);
  const opt = { key: 'recommended', request: { preference: null } };
  const d = detourOption(opt, ROUTE, [], 'note', BANS);
  assert.deepEqual([d.key, d.label, d.auto, d.avoided[0].id, d.avoided[0].local], ['detour', 'Recommandé', true, 'n59', true]);
  const rocade = { key: 'rocade' }; const short = { key: 'shortest' };
  let r = applyDetour({ options: [rocade, short], crosses: [true, false], detour: d, selected: 1 });
  assert.deepEqual([r.options.map((o) => o.key), r.selected, r.replaced, r.hidden], [['detour', 'shortest'], 1, false, [rocade]]);
  r = applyDetour({ options: [rocade, short], crosses: [true, false], detour: d, selected: 0, manual: true });
  assert.deepEqual([r.selected, r.replaced], [0, true]);
  r = applyDetour({ options: [rocade, short], crosses: [false, true], detour: d, selected: 0 });
  assert.deepEqual(r.options.map((o) => o.key), ['detour', 'rocade'], 'rocade hors section gardée');
  assert.equal(allDeclared(d.avoided, { n59: true }), true);
  assert.equal(allDeclared(d.avoided, { n59: false }), false);
  assert.equal(allDeclared([{ id: 'n7-vienne', local: false }], { 'n7-vienne': true }), false);
  assert.equal(allDeclared([], {}), false);
  assert.ok(!DETOUR_STATES.includes('pending'));
});

test('v80 : Mont-Blanc pour 4,80 m : tronçon avec un carré par voie du tunnel', () => {
  const pts = sectionPoints(COPY, 'mont-blanc').map((p) => p.point).sort((a, b) => a[0] - b[0]);
  const route = { coordinates: [[6.4, 45.9], [6.6, 45.9], ...pts, [7.1, 45.75], [7.3, 45.74]], steps: [] };
  const vehicle = { weight: 44, height: 4.8 };
  const bans = routeBans(route, sensitiveRules(route, { vehicle, copy: COPY }).items, COPY.meta.sections, { vehicle });
  assert.deepEqual(bans.map((b) => b.id), ['mont-blanc']);
  const plan = detourLegs(route, bans, COPY);
  assert.equal(plan.ok, true);
  assert.equal(plan.legs[0].avoid.coordinates.length, 9);
});

// ───────── v81 : zone élargie (points de la copie ∪ plages « Accès PL limité » OSM), cas Nancy → Colmar ─────────
// Tracé de synthèse d'après le diagnostic du test tablette du 26/11/2026 (points du diagnostic, arrondis) : Nancy,
// A33 / N4 jusqu'à Lunéville (km ~39), N59 jusqu'à Raon-l'Étape (aucun point dans la copie), puis les points de la
// copie (Raon → tunnel Maurice-Lemaire → N159), D1059, A35, Colmar. Plage OSM simulée : de Lunéville au tunnel.
const { prepareLine, locateOnLine } = await import('../src/lib/nav-geo.js');
// Géométrie de Raon-l'Étape au tunnel prise sur les points de la copie (lat < 48,40) ; Lunéville → Raon tracé à la main
// (à des centaines de mètres de la vraie N59 : les points de la copie de ce tronçon, v82, ne s'y accrochent pas).
const N59_PTS = sectionPoints(COPY, 'n59').map((p) => p.point).filter((p) => p[1] < 48.40).sort((a, b) => a[0] - b[0])
  .filter((p, i, all) => i === 0 || Math.hypot((p[0] - all[i - 1][0]) * 74000, (p[1] - all[i - 1][1]) * 111000) > 300);
const NC_ROUTE = {
  coordinates: [[6.20, 48.70], [6.18, 48.63], [6.305, 48.618], [6.419, 48.591], [6.53, 48.57], [6.642, 48.522],
    [6.743, 48.464], [6.80, 48.42], ...N59_PTS, [7.29, 48.27], [7.38, 48.28], [7.384, 48.18], [7.36, 48.07]],
  steps: [], distance: 152500, duration: 8520,
};
const NC_LINE = prepareLine(NC_ROUTE.coordinates);
const alongOf = (p) => locateOnLine(NC_LINE, p).along;
const LUNEVILLE = alongOf([6.53, 48.57]);
const RAON = alongOf(N59_PTS[0]);
// Voies étiquetées hgv:conditional de Lunéville jusqu'à 1 km avant le premier point de la copie (Raon-l'Étape).
const NC_PLAGES = [{ enter: LUNEVILLE, exit: RAON - 1000, state: 'local' }];
const ncBans = (plages) => routeBans(NC_ROUTE, sensitiveRules(NC_ROUTE, { vehicle: SEMI, copy: COPY }).items, COPY.meta.sections,
  { vehicle: SEMI, copy: COPY, plages });

test('v81 Nancy → Colmar : zone = copie ∪ plages OSM, A avant Lunéville, carrés sur toute la zone', () => {
  const [plain] = ncBans([]);
  assert.ok(plain.span.from > RAON - 2000, 'copie seule : section localisée à partir de Raon seulement');
  const [b] = ncBans(NC_PLAGES);
  assert.equal(b.id, 'n59');
  assert.ok(Math.abs(b.range.from - LUNEVILLE) < 1, 'zone élargie dès Lunéville');
  const plan = detourLegs(NC_ROUTE, [b], COPY);
  assert.equal(plan.ok, true);
  const leg = plan.legs[0];
  assert.ok(alongOf(leg.a) < LUNEVILLE - 14000, 'A 15 km avant le début de la zone élargie');
  assert.ok(leg.points.filter((p) => p.plage).length >= Math.floor((NC_PLAGES[0].exit - LUNEVILLE) / DETOUR.PLAGE_STEP_M));
  assert.equal(leg.avoid.coordinates.length, leg.points.length);
  // Sans plage : comportement v79 (A après Lunéville, dans la zone interdite).
  const old = detourLegs(NC_ROUTE, [plain], COPY).legs[0];
  assert.ok(alongOf(old.a) > LUNEVILLE);
});

test('v81 Nancy → Colmar : point de passage à moins de 2 km de la N59 Lunéville – Raon écarté ; repasse sur la plage → still', async () => {
  const [b] = ncBans(NC_PLAGES);
  // Tronçon simulé : longe la N59 à 1 km au nord entre Lunéville et Raon (routes parallèles), rien d'autre.
  const near = async (a, z) => ({ coordinates: [a, [6.60, 48.555], [6.70, 48.50], [6.78, 48.445], z], steps: [] });
  let out = await planDetour({ route: NC_ROUTE, bans: [b], copy: COPY, vehicle: SEMI, fetchLeg: near, fetchFinal: async () => NC_ROUTE });
  assert.equal(out.reason, 'nodetour');
  assert.ok(out.trace.legs[0].viasDropped >= 1, 'trace : points écartés comptés');
  // Tronçon loin au sud (col), mais trajet final par la N59 de Lunéville à km ~50 puis le détour : still (plages).
  const far = async (a, z) => ({ coordinates: [a, [6.45, 48.40], [6.60, 48.20], [7.00, 48.10], [7.30, 48.15], z], steps: [] });
  const viaN59 = async (stops) => ({
    coordinates: [...NC_ROUTE.coordinates.slice(0, 6), ...stops.map((s) => [s.lon, s.lat]), [7.36, 48.07]], steps: [], distance: 1, duration: 1,
  });
  out = await planDetour({ route: NC_ROUTE, bans: [b], copy: COPY, vehicle: SEMI, fetchLeg: far, fetchFinal: viaN59 });
  assert.equal(out.reason, 'still');
  assert.equal(out.trace.final.still, 'plages');
  // Trajet final loin de toute la zone : réussi.
  const away = async (stops) => ({
    coordinates: [[6.20, 48.70], [6.30, 48.45], ...stops.map((s) => [s.lon, s.lat]), [7.36, 48.07]], steps: [], distance: 190000, duration: 11000,
  });
  out = await planDetour({ route: NC_ROUTE, bans: [b], copy: COPY, vehicle: SEMI, fetchLeg: far, fetchFinal: away });
  assert.equal(out.ok, true, out.reason);
  const { detourTraceText } = await import('../src/lib/ban-detour.js');
  const txt = detourTraceText({ state: 'appliqué', trace: out.trace }).join('\n');
  assert.match(txt, /^Contournement automatique : appliqué\n  n59 : zone km \d+,\d–\d+,\d ; A km \d+,\d ; B km \d+,\d ; vol d'oiseau \d+,\d km ; \d+ carrés \(dont \d+ sur les plages OSM\) ; tronçon ORS \d+,\d km ; points de passage \d \(écartés à moins de 2 km de la zone : \d\)\n  trajet final \d+,\d km$/);
  assert.match(detourTraceText({ state: 'échec', reason: 'nodetour' })[0], /^Contournement automatique : échec \(aucun détour trouvé autour de la section\)$/);
  assert.deepEqual(detourTraceText({}), []);
});
