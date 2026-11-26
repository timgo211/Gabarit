// Trafic (phase 10 A, PR 2, v88) : lecture vérifiée du fichier national, distance au tracé (point, droite départ →
// arrivée sur route courbe, croisement), sens, événements terminés, « Ancien », textes. Tracés synthétiques ; fichier
// produit par tools/trafic-convert.mjs depuis la fixture synthétique tests/fixtures/trafic-datex.xml. Aucun réseau,
// aucune horloge (`now` fixe), travail mesuré par compteur.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  TRAFFIC, DIRECTION_TEXTS, cleanEvent, eventsNearRoute, fromStartText, hhmm, isOld, itemTexts, parseTrafficJson,
  planBearing, roadText, sourceText, trafficDirection,
} from '../src/lib/traffic.js';
import { TRAFFIC_URL } from '../src/lib/config.js';
import { cacheStrategy } from '../src/lib/sw-routing.js';
import { collectXml, convertTraffic } from '../tools/trafic-convert.mjs';

const NOW = Date.parse('2026-11-26T12:30:00Z');
const TZ = 'UTC';
const M_LAT = 1 / 111195; // degrés de latitude par mètre

// Tracé droit vers l'est sur 45° N, de 5,00 à 5,10 (≈ 7,9 km), un point tous les 0,001°.
const STRAIGHT = Array.from({ length: 101 }, (_, i) => [5 + i * 0.001, 45]);
const ev = (over) => ({ id: 'e1', k: 'bouchon', st: null, p: [5.05, 45], l: null, s: null, e: null, d: null, dv: null, r: null, c: null, ...over });

function fileFromFixture() {
  const c = collectXml(readFileSync(new URL('./fixtures/trafic-datex.xml', import.meta.url), 'utf8'));
  return convertTraffic(c.records, { now: NOW, stats: c.stats, lastModified: 'Thu, 26 Nov 2026 11:24:35 GMT' }).text;
}

test('fichier de l\'Action relu par l\'appli : schéma, champs typés, dates en ms', () => {
  const res = parseTrafficJson(fileFromFixture());
  assert.equal(res.ok, true);
  assert.equal(res.events.length, 7);
  assert.equal(res.dropped, 0);
  assert.equal(res.publication, Date.parse('2026-11-26T11:24:34Z'));
  const r1 = res.events.find((e) => e.id === 'r1');
  assert.equal(r1.k, 'fermeture');
  assert.deepEqual(r1.l, [[5.7, 45.09], [5.7, 45.11]]);
  assert.equal(r1.s, Date.parse('2026-11-26T05:00:00Z'));
  assert.equal(r1.dv, 'northBound');
  assert.equal(r1.c, 'Fermeture de la N 85 & déviation par la D 1');
});

test('fichier refusé : JSON abîmé, format, version, taille, trop d\'événements ; champs faux écartés un par un', () => {
  assert.deepEqual(parseTrafficJson('{pas du json'), { ok: false, reason: 'json' });
  assert.equal(parseTrafficJson(null).ok, false);
  assert.equal(parseTrafficJson(JSON.stringify({ format: 'autre', version: 1, events: [] })).reason, 'format');
  assert.equal(parseTrafficJson(JSON.stringify({ format: 'gabarit-trafic', version: 2, events: [] })).reason, 'format');
  assert.equal(parseTrafficJson(' '.repeat(TRAFFIC.MAX_BYTES + 1)).reason, 'taille');
  const many = { format: 'gabarit-trafic', version: 1, events: Array.from({ length: TRAFFIC.MAX_EVENTS + 1 }, (_, i) => ev({ id: `x${i}` })) };
  assert.equal(parseTrafficJson(JSON.stringify(many)).reason, 'taille');
  const mixed = {
    format: 'gabarit-trafic', version: 1, publication: '2026-11-26T11:24:34Z',
    events: [
      ev(), ev({ k: 'inconnu' }), ev({ p: [5, 60] }), ev({ p: ['5', 45] }), ev({ l: [[5, 45], [5.1, 45], [5.2, 45]] }),
      ev({ id: 'x'.repeat(81) }), ev({ c: '<b>gras</b>', r: 'N0007', s: 'pas une date' }), 'texte', null,
    ],
  };
  const res = parseTrafficJson(JSON.stringify(mixed));
  assert.equal(res.ok, true);
  assert.equal(res.events.length, 2);
  assert.equal(res.dropped, 7);
  assert.equal(res.events[1].c, '<b>gras</b>', 'texte gardé tel quel : affiché en textContent, jamais interprété');
  assert.equal(res.events[1].s, null, 'date illisible → inconnue');
  assert.equal(cleanEvent({ id: 'a', k: 'accident', p: [5, 45], d: 'n importe' }).d, null);
});

test('distance au tracé : point à 50 m gardé, à 150 m écarté ; distance depuis le départ ; tri', () => {
  const events = [
    ev({ id: 'loin', p: [5.03, 45 + 150 * M_LAT] }),
    ev({ id: 'b', p: [5.08, 45 + 50 * M_LAT] }),
    ev({ id: 'a', p: [5.02, 45 - 50 * M_LAT] }),
  ];
  const { items } = eventsNearRoute(events, STRAIGHT, { now: NOW });
  assert.deepEqual(items.map((i) => i.ev.id), ['a', 'b'], 'triés du départ vers l\'arrivée, 150 m écarté');
  assert.ok(Math.abs(items[0].along - 0.02 * 111195 * Math.cos(45 * Math.PI / 180)) < 15, 'distance depuis le départ');
  assert.equal(items[0].approx, false);
  assert.ok(Math.abs(items[0].point[1] - 45) < 1e-9, 'repère posé sur le tracé');
});

test('ligne droite sur route courbe : la droite dépasse 100 m, l\'événement est gardé et « tracé approximatif »', () => {
  // Quart de cercle de 2 km de rayon autour de (5,00 ; 45,00) : la corde s'écarte de 2000 × (1 − cos 45°) ≈ 586 m.
  const r = 2000;
  const kx = 1 / (111195 * Math.cos(45 * Math.PI / 180));
  const arc = Array.from({ length: 91 }, (_, i) => {
    const a = (i * Math.PI) / 180;
    return [5 + r * Math.sin(a) * kx, 45 + r * Math.cos(a) * M_LAT];
  });
  const chord = [arc[0], arc[90]];
  const mid = [(chord[0][0] + chord[1][0]) / 2, (chord[0][1] + chord[1][1]) / 2];
  const { items } = eventsNearRoute([ev({ id: 'courbe', k: 'fermeture', p: mid, l: chord })], arc, { now: NOW });
  assert.equal(items.length, 1, 'gardé par ses extrémités, même si le milieu de la droite est à ≈ 586 m');
  assert.equal(items[0].approx, true);
  assert.ok(items[0].along < 50, 'premier point touché : le départ de la droite');
  assert.match(itemTexts(items[0], NOW, TZ).facts, /tracé approximatif/);
  // Le point d'affichage seul (milieu de la corde) serait écarté : c'est bien la droite qui garde l'événement.
  assert.equal(eventsNearRoute([ev({ p: mid })], arc, { now: NOW }).items.length, 0);
});

test('ligne droite qui suit le tracé gardée ; simple croisement écarté', () => {
  const along = ev({ id: 'long', l: [[4.95, 45 + 30 * M_LAT], [5.15, 45 + 30 * M_LAT]], p: [5.05, 45] });
  const cross = ev({ id: 'croise', l: [[5.05, 45 - 1000 * M_LAT], [5.05, 45 + 1000 * M_LAT]], p: [5.05, 45 + 1000 * M_LAT] });
  const { items } = eventsNearRoute([along, cross], STRAIGHT, { now: NOW });
  assert.deepEqual(items.map((i) => i.ev.id), ['long']);
  assert.ok(items[0].along < 60, 'touche le tracé dès son début');
});

test('événements terminés retirés ; à venir gardés avec « à partir du »', () => {
  const events = [
    ev({ id: 'fini', e: NOW - 60e3 }),
    ev({ id: 'avenir', s: NOW + 3 * 86400e3, e: NOW + 4 * 86400e3 }),
    ev({ id: 'encours', s: NOW - 3600e3, p: [5.06, 45] }),
  ];
  const res = eventsNearRoute(events, STRAIGHT, { now: NOW });
  assert.deepEqual(res.items.map((i) => i.ev.id), ['avenir', 'encours']);
  assert.equal(res.ended, 1);
  const t = itemTexts(res.items[0], NOW, TZ);
  assert.match(t.dates, /^à partir du 29\/11 à 12:30 · fin prévue le 30\/11 à 12:30$/);
  assert.equal(t.future, true);
  assert.match(itemTexts(res.items[1], NOW, TZ).dates, /^depuis le 26\/11 à 11:30 · fin non précisée$/);
});

test('sens : deux sens, votre sens, sens opposé, un sens sans savoir lequel, non précisé', () => {
  const east = [[5.02, 45], [5.04, 45]];
  assert.equal(Math.round(planBearing(east[0], east[1])), 90);
  assert.equal(trafficDirection(ev({ d: 'both' }), 90), 'both');
  assert.equal(trafficDirection(ev({ d: 'one', dv: 'eastBound', l: east }), 90), 'same');
  assert.equal(trafficDirection(ev({ d: 'one', dv: 'eastBound', l: east }), 270), 'opposite');
  assert.equal(trafficDirection(ev({ d: 'one', dv: 'westBound', l: east }), 90), 'one', 'droite contraire au sens publié');
  assert.equal(trafficDirection(ev({ d: 'one', dv: 'eastBound', l: east }), 0), 'one', 'tracé perpendiculaire');
  assert.equal(trafficDirection(ev({ d: 'one', dv: 'innerRing', l: east }), 90), 'one', 'périphérique : pas de point cardinal');
  assert.equal(trafficDirection(ev({ d: 'one' }), 90), 'one', 'point seul');
  assert.equal(trafficDirection(ev({ d: null }), 90), 'unknown');
  // Dans la liste : le sens est jugé au cap du tracé à l'endroit de l'événement, jamais caché.
  const west = [...STRAIGHT].reverse();
  const items = (route) => eventsNearRoute([ev({ d: 'one', dv: 'eastBound', l: east, p: [5.03, 45] })], route, { now: NOW }).items;
  assert.equal(items(STRAIGHT)[0].dir, 'same');
  assert.equal(items(west)[0].dir, 'opposite');
  assert.match(itemTexts(items(west)[0], NOW, TZ).facts, new RegExp(DIRECTION_TEXTS.opposite));
});

test('« Ancien » au-delà de 3 h ; sans date = ancien', () => {
  assert.equal(isOld(NOW - 2 * 3600e3, NOW), false);
  assert.equal(isOld(NOW - 3 * 3600e3 - 60e3, NOW), true);
  assert.equal(isOld(null, NOW), true);
  assert.equal(TRAFFIC.OLD_TEXT, 'Ancien');
});

test('textes : source, couverture, liste vide, route, distance depuis le départ', () => {
  assert.equal(sourceText(Date.parse('2026-11-26T11:24:34Z'), NOW, TZ),
    'Source : Bison Futé (DIR), mis à jour à 11:24 — à vérifier, la signalisation fait foi.');
  assert.equal(sourceText(Date.parse('2026-11-25T23:24:34Z'), NOW, TZ),
    'Source : Bison Futé (DIR), mis à jour à 25/11 à 23:24 — à vérifier, la signalisation fait foi.');
  assert.equal(TRAFFIC.COVERAGE_TEXT, 'Routes nationales et autoroutes non concédées : les autoroutes à péage ne sont pas couvertes.');
  assert.equal(TRAFFIC.EMPTY_TEXT, 'Aucun événement trouvé dans la source. Ce n\'est pas une garantie : la signalisation fait foi.');
  assert.doesNotMatch(TRAFFIC.EMPTY_TEXT, /route libre/i);
  assert.equal(hhmm(Date.parse('2026-11-26T07:05:00Z'), TZ), '07:05');
  assert.equal(roadText('N0125'), 'N 125');
  assert.equal(roadText('A0013'), 'A 13');
  assert.equal(roadText('75000C02'), '75000C02');
  assert.equal(fromStartText(320), 'à 300 m du départ');
  assert.equal(fromStartText(4230), 'à 4,2 km du départ');
  assert.equal(fromStartText(37400), 'à 37 km du départ');
  const t = itemTexts({ ev: { ...ev({ k: 'fermeture', st: 'closedPermanentlyForTheWinter', r: 'N0085' }), s: null, e: null }, along: 1500, approx: false, dir: 'both' }, NOW, TZ);
  assert.equal(t.title, 'Fermeture (fermée pour l\'hiver) · N 85');
  assert.equal(t.facts, 'à 1,5 km du départ · deux sens');
  assert.equal(itemTexts({ ev: ev({ st: 'unknownCode' }), along: 0, approx: false, dir: 'unknown' }, NOW, TZ).title, 'Bouchon', 'sous-type inconnu : rien ajouté');
});

test('travail mesuré : 3 000 événements loin du tracé ne coûtent aucune mesure de distance', () => {
  const far = Array.from({ length: 3000 }, (_, i) => ev({ id: `f${i}`, p: [2 + (i % 50) * 0.01, 48 + Math.floor(i / 50) * 0.01] }));
  const res = eventsNearRoute(far, STRAIGHT, { now: NOW });
  assert.equal(res.items.length, 0);
  assert.equal(res.work, 0);
  const near = eventsNearRoute([ev()], STRAIGHT, { now: NOW });
  assert.ok(near.work > 0 && near.work < 40, `quelques segments seulement (${near.work})`);
});

test('adresse du fichier : https, sans paramètre (aucune position), jamais mise en cache par le service worker', () => {
  const u = new URL(TRAFFIC_URL);
  assert.equal(u.protocol, 'https:');
  assert.equal(u.hostname, 'raw.githubusercontent.com');
  assert.equal(u.search, '');
  assert.equal(cacheStrategy('GET', TRAFFIC_URL, 'https://timgo211.github.io'), 'bypass');
});
