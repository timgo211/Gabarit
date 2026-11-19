// Phase 5 : zones à faibles émissions (BNZFE) — conversion, vignette Crit'Air, horaires, passage de l'itinéraire,
// tronçons spéciaux, « Éviter la ZFE » (limites de l'API publique d'ORS), guidage.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers.js';
import { convertBnzfe, parseZfeIds, simplifyPath } from '../src/lib/zfe-convert.js';
import {
  parseZfeData, zfeAlongRoute, critairCode, bannedBy, categoryOf, thresholdText, parseHours, hoursActive, hoursText,
  avoidPolygonsFor, describeZfePassage, guidanceZfe, zfeBannerText, inZone, safeUrl, ZFE,
} from '../src/lib/zfe.js';
import { haversine } from '../src/lib/nav-geo.js';

const ids = parseZfeIds(readFileSync(new URL('./fixtures/bnzfe-ids.csv', import.meta.url), 'utf8'));
const converted = convertBnzfe(fixture('bnzfe-aires.json'), fixture('bnzfe-voies.json'), ids, { updated: '2026-03-26' });
const data = parseZfeData(JSON.parse(JSON.stringify(converted.data)));
const zone = (id) => data.zones.find((z) => z.id === id);
const D = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const semi = (critair, weight = 44) => ({ name: 'Semi', weight, critair });

/** Itinéraire en ligne droite (vitesse constante). */
function line(from, to, { minutes = 30, n = 200 } = {}) {
  const coords = Array.from({ length: n + 1 }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n]);
  return { coordinates: coords, steps: [{ name: 'Route', wayPoints: [0, n], duration: minutes * 60 }], duration: minutes * 60 };
}

test('conversion de la vraie base (extrait) : noms, dates, règles PL, coordonnées arrondies, tronçons dans les zones', () => {
  assert.equal(converted.data.zones.length, 7);
  assert.equal(converted.data.updated, '2026-03-26');
  assert.match(converted.data.license, /ODbL/);
  assert.equal(zone('217500016-ZFE-001').name, 'Ville de Paris');
  assert.deepEqual(zone('217500016-ZFE-001').pl.critair, 'V4');
  assert.equal(zone('217500016-ZFE-001').pl.hoursRaw, 'Mo-Su 08:00-20:00; PH off');
  assert.equal(zone('1').name, 'ZFE (grandannecy.fr)', 'identifiant « 1 » (Grand Annecy) : nom d\'après le site');
  assert.equal(zone('67212-ZFE-007').name, 'Eurométropole de Strasbourg', 'commune : nom de la zone qui la contient');
  assert.equal(zone('246300701-ZFE-001').name, 'Clermont Auvergne métropole');
  assert.equal(zone('200046977-ZFE-001').start, '2025-01-01');
  assert.equal(zone('200046977-ZFE-001').end, null);
  const flat = converted.data.zones.flatMap((z) => z.polygons.flat(3));
  assert.ok(flat.every((x) => Math.abs(x * 1e5 - Math.round(x * 1e5)) < 1e-3), '5 décimales');
  // 3 tronçons de Lyon (sans restriction PL, qui priment sur la zone V3) gardés ; celui de Grenoble (zone absente
  // de l'extrait) ignoré ; altitude retirée.
  assert.equal(converted.data.voies.length, 3);
  assert.ok(converted.data.voies.every((v) => v.pl.critair === null && v.lines.every((l) => l.every((p) => p.length === 2))));
  assert.match(converted.log.join('\n'), /7 zones, 3 tronçons spéciaux gardés, 1 hors des zones ignorés/);
  assert.equal(ids.get('256900994'), 'Métropole de Lyon', 'autres_siren');
  assert.deepEqual(simplifyPath([[0, 0], [0.5, 0.0000001], [1, 0]], 1), [[0, 0], [1, 0]]);
});

test('data/zfe.json du dépôt : lisible, toutes les zones ont un nom, une date et un contour', () => {
  const real = parseZfeData(JSON.parse(readFileSync(new URL('../data/zfe.json', import.meta.url), 'utf8')));
  assert.ok(real.zones.length >= 30, `${real.zones.length} zones`);
  assert.ok(real.zones.every((z) => z.name && z.start && z.polygons.length && z.bbox.every(Number.isFinite)));
  assert.ok(real.zones.some((z) => z.name === 'Métropole de Lyon' && z.pl.critair === 'V3'));
  assert.ok(real.voies.length > 100);
  // Étapes successives au même contour (Aix-Marseille : V5 depuis 2022, V4 depuis le 1er septembre 2023, le fichier
  // les donne dans l'ordre 002 puis 001) : la plus récente s'applique.
  const marseille = zfeAlongRoute(line([5.33, 43.295], [5.42, 43.295]), { data: real, vehicle: semi('4'), departure: D(2026, 11, 19, 10) });
  assert.equal(marseille[0].name, 'Métropole Aix-Marseille-Provence');
  assert.equal(marseille[0].critair, 'V4');
  assert.equal(marseille[0].banned, true);
});

test('vignette : seuil du schéma etalab (V3 = Crit\'Air 3, 4, 5 et non classés interdits)', () => {
  assert.deepEqual(['0', '1', '2', '3', '4', '5', 'NC', undefined].map(critairCode), ['EL', 'V1', 'V2', 'V3', 'V4', 'V5', 'NC', 'NC']);
  assert.equal(bannedBy('V3', '3'), true);
  assert.equal(bannedBy('V3', '5'), true);
  assert.equal(bannedBy('V3', 'NC'), true);
  assert.equal(bannedBy('V3', '2'), false);
  assert.equal(bannedBy('NC', '5'), false, 'seuil NC : seuls les non classés');
  assert.equal(bannedBy('NC', 'NC'), true);
  assert.equal(bannedBy(null, 'NC'), false, 'null : pas de restriction');
  assert.equal(bannedBy('EL', '0'), true);
  assert.equal(thresholdText('V3'), 'Crit\'Air 3, 4, 5 et non classés interdits');
  assert.equal(thresholdText('NC'), 'véhicules sans vignette (non classés) interdits');
  assert.equal(categoryOf(semi('1')), 'pl');
  assert.equal(categoryOf(semi('1', 3.5)), 'vul', '« Poids lourds (>3,5t) »');
});

test('horaires (opening_hours) vus dans la base', () => {
  assert.equal(parseHours('24/7').always, true);
  const paris = parseHours('Mo-Su 08:00-20:00; PH off');
  assert.equal(hoursActive(paris, D(2026, 11, 19, 10)), true);
  assert.equal(hoursActive(paris, D(2026, 11, 19, 20, 30)), false);
  assert.equal(hoursActive(paris, D(2026, 7, 14, 10)), false, 'jour férié');
  assert.equal(hoursText(paris), 'tous les jours 8 h–20 h, sauf jours fériés');
  const nantes = parseHours('Mo-Fr 07:00-9:00,16:00-19:00');
  assert.equal(hoursActive(nantes, D(2026, 11, 17, 8, 30)), true, 'mardi 8 h 30');
  assert.equal(hoursActive(nantes, D(2026, 11, 17, 12)), false);
  assert.equal(hoursActive(nantes, D(2026, 11, 21, 8, 30)), false, 'samedi');
  assert.equal(hoursText(nantes), 'lun. mar. mer. jeu. ven. 7 h–9 h, 16 h–19 h');
  assert.equal(hoursActive(parseHours('Mo-Su : 00:00-00:00'), D(2026, 11, 19, 3)), true, 'Grand Annecy : toute la journée');
  const rennes = parseHours('Mo-Su 00:00-24:00; May 1 off');
  assert.equal(hoursActive(rennes, D(2026, 5, 1, 12)), false);
  assert.equal(hoursActive(rennes, D(2026, 5, 2, 12)), true);
  assert.equal(hoursActive(parseHours('Mo-Su 00:00-23:59; PH off'), D(2026, 11, 19, 23, 59)), true);
  assert.equal(parseHours('NC'), null, 'illisible');
  assert.equal(hoursActive(null, D(2026, 11, 19)), true, 'illisible : restriction supposée');
  assert.equal(hoursText(null, 'NC'), 'horaires « NC » (à vérifier)');
  assert.equal(hoursActive(parseHours('Mo-Su 22:00-06:00'), D(2026, 11, 19, 2)), true, 'plage qui passe minuit');
});

test('Lyon (V3, 24 h/24) : Crit\'Air 3 interdit d\'un bout à l\'autre de la zone, Crit\'Air 2 autorisé', () => {
  const route = line([4.70, 45.76], [5.0, 45.76]);
  const p = zfeAlongRoute(route, { data, vehicle: semi('3'), departure: D(2026, 11, 19, 10) });
  assert.equal(p.length, 1);
  assert.equal(p[0].name, 'Métropole de Lyon');
  assert.equal(p[0].banned, true);
  assert.ok(p[0].enter > 3000 && p[0].exit > p[0].enter + 5000, `${p[0].enter} → ${p[0].exit}`);
  assert.equal(p[0].destination, false);
  assert.match(describeZfePassage(p[0], semi('3')), /^ZFE Métropole de Lyon interdite : Crit'Air 3, 4, 5 et non classés interdits \(poids lourds, tous les jours, 24 h\/24\) — votre véhicule : Crit'Air 3\. km \d+ → km \d+\.$/);
  const ok = zfeAlongRoute(route, { data, vehicle: semi('2'), departure: D(2026, 11, 19, 10) });
  assert.equal(ok[0].banned, false);
  // Avant le 1er janvier 2025 (date de début de cette étape) : pas de zone.
  assert.equal(zfeAlongRoute(route, { data, vehicle: semi('3'), departure: D(2024, 6, 1, 10) }).length, 0);
});

test('Paris (V4, 8 h – 20 h, sauf jours fériés) : interdit à 10 h, autorisé à 21 h et le 14 juillet', () => {
  const route = line([2.20, 48.86], [2.50, 48.86]);
  const at = (d) => zfeAlongRoute(route, { data, vehicle: semi('4'), departure: d })[0];
  assert.equal(at(D(2026, 11, 19, 10)).banned, true);
  assert.equal(at(D(2026, 11, 19, 21)).banned, false);
  assert.equal(at(D(2026, 7, 14, 10)).banned, false);
  assert.equal(at(D(2026, 11, 19, 10)).critair, 'V4');
});

test('arrivée dans la zone signalée ; zone non restreinte pour ce véhicule (Clermont : non classés seulement)', () => {
  const route = line([4.70, 45.76], [4.85, 45.76]);
  const p = zfeAlongRoute(route, { data, vehicle: semi('3'), departure: D(2026, 11, 19, 10) });
  assert.equal(p[0].destination, true);
  assert.match(describeZfePassage(p[0], semi('3')), /arrivée dans la zone/);
  const clermont = zfeAlongRoute(line([3.0, 45.78], [3.2, 45.78]), { data, vehicle: semi('5'), departure: D(2026, 11, 19, 10) });
  assert.equal(clermont[0].name, 'Clermont Auvergne métropole');
  assert.equal(clermont[0].banned, false);
});

// Données faites à la main : une zone carrée V3, un tronçon spécial sans restriction PL qui la traverse (axe de transit).
const square = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const handmade = parseZfeData({
  zones: [{ id: 'TEST-ZFE-001', name: 'Testville', start: '2025-01-01', end: null, pl: { critair: 'V3', hours: '24/7' }, vul: { critair: 'V3', hours: '24/7' }, polygons: [square(5.0, 45.0, 5.1, 45.1)] }],
  voies: [{ start: '2025-01-01', end: null, pl: { critair: null, hours: '' }, vul: { critair: null, hours: '' }, lines: [[[5.0, 45.05], [5.1, 45.05]]] }],
});

test('tronçon spécial sans restriction (voies.geojson) : prime sur la zone ; quitter le tronçon dans la zone = interdit', () => {
  const transit = line([4.95, 45.05], [5.15, 45.05]);
  const p = zfeAlongRoute(transit, { data: handmade, vehicle: semi('4'), departure: D(2026, 11, 19, 10) });
  assert.equal(p.length, 1);
  assert.equal(p[0].onVoie, true);
  assert.equal(p[0].banned, false, 'axe de transit autorisé');
  const through = line([4.95, 45.07], [5.15, 45.07]);
  const q = zfeAlongRoute(through, { data: handmade, vehicle: semi('4'), departure: D(2026, 11, 19, 10) });
  assert.equal(q[0].banned, true);
  assert.equal(q[0].onVoie, false);
});

test('liens des données : http(s) seulement', () => {
  assert.equal(safeUrl('https://zfe.grandlyon.com/arrete.pdf'), 'https://zfe.grandlyon.com/arrete.pdf');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('pas une adresse'), null);
  assert.ok(data.zones.every((z) => z.url === null || /^https?:/.test(z.url)));
});

/** Aire (m²) et étendue (m) d'un contour, en plan local (comme ORS, à quelques % près). */
function measure(ring) {
  const lat0 = ring[0][1];
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320;
  const ky = 110540;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i += 1) a += (ring[i][0] * kx) * (ring[i + 1][1] * ky) - (ring[i + 1][0] * kx) * (ring[i][1] * ky);
  const xs = ring.map((p) => p[0]); const ys = ring.map((p) => p[1]);
  return {
    area: Math.abs(a / 2),
    extent: Math.max(haversine([Math.min(...xs), lat0], [Math.max(...xs), lat0]), haversine([xs[0], Math.min(...ys)], [xs[0], Math.max(...ys)])),
  };
}

test('« Éviter la ZFE » : polygones sous les limites de l\'API publique d\'ORS (200 km², 20 km), grande zone découpée', () => {
  for (const id of ['200046977-ZFE-001', '217500016-ZFE-001', '246700488-ZFE-001']) {
    const z = zone(id);
    const r = avoidPolygonsFor([z], { start: [4.5, 45.5], end: [5.3, 46.0] });
    assert.equal(r.ok, true, id);
    assert.equal(r.geometry.type, 'MultiPolygon');
    assert.ok(r.tiles >= 2, `${id} : ${r.tiles} morceaux (zone de plus de 12 km)`);
    for (const [ring] of r.geometry.coordinates) {
      const m = measure(ring);
      assert.ok(m.area <= 200e6, `${id} : ${Math.round(m.area / 1e6)} km²`);
      assert.ok(m.extent <= 20000, `${id} : ${Math.round(m.extent)} m`);
      assert.deepEqual(ring[0], ring[ring.length - 1], 'contour fermé');
    }
  }
  // Petite zone : un seul polygone, gardé entier.
  const small = avoidPolygonsFor(handmade.zones, { start: [4.9, 45.0], end: [5.2, 45.1] });
  assert.equal(small.tiles, 1);
});

test('« Éviter la ZFE » : message clair au-delà de 150 km à vol d\'oiseau, départ ou arrivée dans la zone', () => {
  const lyon = zone('200046977-ZFE-001');
  const far = avoidPolygonsFor([lyon], { start: [2.35, 48.85], end: [5.37, 43.3] });
  assert.equal(far.ok, false);
  assert.equal(far.reason, 'distance');
  assert.match(far.text, /150 km au plus à vol d'oiseau/);
  assert.equal(avoidPolygonsFor([lyon], { start: [4.83, 45.76], end: [5.3, 46.0] }).reason, 'start');
  const end = avoidPolygonsFor([lyon], { start: [5.3, 46.0], end: [4.83, 45.76] });
  assert.equal(end.reason, 'end');
  assert.match(end.text, /arrivée est dans la ZFE Métropole de Lyon/);
  assert.equal(avoidPolygonsFor([], { start: [0, 0], end: [0, 0] }).reason, 'none');
  assert.equal(ZFE.AVOID_MAX_DISTANCE_M, 150000);
  assert.ok(inZone([4.83, 45.76], lyon));
});

test('guidage : bandeau sous 20 km, annonce une fois vers 5 km, rien pour une ZFE autorisée', () => {
  const route = line([4.70, 45.76], [5.0, 45.76]);
  const p = zfeAlongRoute(route, { data, vehicle: semi('3'), departure: D(2026, 11, 19, 10) });
  const at = p[0].enter;
  let ann = {};
  const step = (along) => {
    const r = guidanceZfe(p, along, ann);
    ann = r.announced;
    return r;
  };
  assert.equal(step(at - 6000).speak, null);
  assert.match(step(at - 6000).view.text, /^ZFE Métropole de Lyon dans 6 km : interdite à ce véhicule$/);
  const s5 = step(at - 4900);
  assert.equal(s5.speak, 'Attention, zone à faibles émissions Métropole de Lyon dans 5 kilomètres, interdite à votre véhicule.');
  assert.equal(step(at - 4000).speak, null, 'une seule fois');
  assert.match(step(at + 100).view.text, /^Dans la ZFE Métropole de Lyon/);
  assert.equal(step(p[0].exit + 10).view, null);
  const ok = zfeAlongRoute(route, { data, vehicle: semi('1'), departure: D(2026, 11, 19, 10) });
  assert.equal(guidanceZfe(ok, at - 3000, {}).view, null);
  assert.equal(zfeBannerText({ name: 'X' }, 4230), 'ZFE X dans 4,2 km : interdite à ce véhicule');
});
