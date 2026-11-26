// Trafic (phase 10 A, PR 1) : conversion du flux DATEX II v2 de Bison Futé (DIR) en JSON national pour l'appli.
// Fermeture, bouchon, accident, chantier, obstacle ; autres types, sans position, terminés, à venir, suspendus, hors de
// France, doublons ; ligne = droite départ → arrivée seulement ; XML mal formé et DOCTYPE refusés ; plafonds 3 000
// événements et taille ; journal sans coordonnées. Fixtures SYNTHÉTIQUES (coordonnées à 2 décimales). Aucun réseau,
// aucune horloge (`now` fixe).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import {
  CLOSURE_CODES, KINDS, TRAFIC, collectXml, convertTraffic, kindOf, listingStats, trafficLog,
} from '../tools/trafic-convert.mjs';
import { checkUrl, convertText, decodeBody } from '../tools/trafic-update.mjs';

const XML = readFileSync(new URL('./fixtures/trafic-datex.xml', import.meta.url), 'utf8');
const BAD = readFileSync(new URL('./fixtures/trafic-malformed.xml', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-26T12:30:00Z');

function convert(xml = XML, opts = {}) {
  const c = collectXml(xml);
  const result = convertTraffic(c.records, { now: NOW, stats: c.stats, ...opts });
  return { ...c, result };
}
const byId = (result, id) => result.json.events.find((e) => e.id === id);

test('fixture : événements gardés, ordre de priorité, types', () => {
  const { result, stats } = convert();
  assert.equal(stats.situations, 11);
  assert.equal(stats.records, 16);
  assert.deepEqual(result.json.events.map((e) => [e.id, e.k]), [
    ['r1', 'fermeture'], ['r15', 'fermeture'], ['r3', 'accident'], ['r9', 'accident'],
    ['r5', 'obstacle'], ['r2', 'bouchon'], ['r4', 'chantier'],
  ]);
  assert.deepEqual(result.json.counts, { fermeture: 2, accident: 2, obstacle: 1, bouchon: 1, chantier: 1 });
  assert.equal(result.json.count, 7);
  assert.deepEqual(stats.skipped, {
    autres: 2, sansPosition: 1, horsFrance: 1, termine: 1, suspendu: 1, futur: 1, doublonId: 1, doublonLieu: 1, dateIllisible: 0,
  });
  assert.deepEqual(stats.recordTypes, {
    RoadOrCarriagewayOrLaneManagement: 3, AbnormalTraffic: 2, Accident: 6, MaintenanceWorks: 1, GeneralObstruction: 1,
    PoorEnvironmentConditions: 1, ConstructionWorks: 2,
  });
  assert.deepEqual(stats.roclmTypes, { roadClosed: 1, laneClosures: 1, carriagewayClosures: 1 });
});

test('fermeture : codes roadClosed / carriagewayClosures seulement ; voies réduites écartées', () => {
  assert.deepEqual(CLOSURE_CODES, ['roadClosed', 'carriagewayClosures']);
  assert.equal(kindOf('RoadOrCarriagewayOrLaneManagement', 'roadClosed'), 'fermeture');
  assert.equal(kindOf('RoadOrCarriagewayOrLaneManagement', 'carriagewayClosures'), 'fermeture');
  assert.equal(kindOf('RoadOrCarriagewayOrLaneManagement', 'laneClosures'), null);
  assert.equal(kindOf('AbnormalTraffic', 'slowTraffic'), 'bouchon');
  assert.equal(kindOf('Accident', null), 'accident');
  assert.equal(kindOf('MaintenanceWorks', null), 'chantier');
  assert.equal(kindOf('ConstructionWorks', null), 'chantier');
  assert.equal(kindOf('VehicleObstruction', null), 'obstacle');
  assert.equal(kindOf('PoorEnvironmentConditions', null), null);
  const { result } = convert();
  const r1 = byId(result, 'r1');
  assert.equal(r1.st, 'roadClosed');
  assert.equal(r1.r, 'N85');
  assert.equal(r1.c, 'Fermeture de la N 85 & déviation par la D 1', 'espaces et retours à la ligne normalisés');
  assert.equal(r1.s, '2026-11-26T05:00:00Z');
  assert.equal(r1.e, '2026-11-27T17:00:00Z');
  assert.equal(r1.v, '2026-11-26T10:00:00Z');
  assert.equal(byId(result, 'r7'), undefined, 'laneClosures : pas une fermeture');
});

test('positions : point d\'affichage, ligne droite départ → arrivée seulement, itinéraire indexé = point', () => {
  const { result, stats } = convert();
  const r1 = byId(result, 'r1');
  assert.deepEqual(r1.p, [5.7, 45.1], 'point d\'affichage');
  assert.deepEqual(r1.l, [[5.7, 45.09], [5.7, 45.11]], 'droite départ → arrivée (ordre from → to)');
  const r15 = byId(result, 'r15');
  assert.deepEqual(r15.p, [0.7, 47.5]);
  assert.equal(r15.l, undefined, 'itinéraire indexé : jamais une ligne');
  const r2 = byId(result, 'r2');
  assert.deepEqual(r2.p, [4.8, 45.2], 'pointByCoordinates');
  assert.equal(r2.l, undefined);
  for (const ev of result.json.events) {
    assert.ok(!ev.l || ev.l.length === 2, 'une ligne a exactement 2 points');
  }
  assert.deepEqual(stats.positions, { point: 12, ligne: 2, aucune: 2 });
  assert.equal(stats.indexedItineraries, 1);
  assert.equal(result.lines, 2);
  assert.deepEqual(stats.groupTypes, { Linear: 2, Point: 12, ItineraryByIndexedLocations: 1 });
});

test('sens : un sens, deux sens, inconnu', () => {
  const { result, stats } = convert();
  assert.equal(byId(result, 'r1').d, 'one', 'tpegDirection northBound');
  assert.equal(byId(result, 'r2').d, 'both', 'alertCDirectionCoded both');
  assert.equal(byId(result, 'r4').d, 'both', 'tpegDirection bothWays');
  assert.equal(byId(result, 'r3').d, null, 'tpegDirection unknown');
  assert.equal(byId(result, 'r5').d, null, 'aucune balise de sens');
  assert.deepEqual(stats.dirKept, { both: 2, one: 1, inconnu: 4 });
  assert.equal(stats.directions['tpegDirection=northBound'], 1);
  assert.equal(stats.directions['alertCDirectionCoded=both'], 1);
});

test('événement sans position, hors de France, terminé, suspendu, début lointain : écartés ; à venir gardé', () => {
  const { result, stats } = convert();
  for (const id of ['r8', 'r14', 'r10', 'r13', 'r12', 'r6']) assert.equal(byId(result, id), undefined, id);
  const r4 = byId(result, 'r4');
  assert.equal(r4.s, '2026-11-29T20:00:00Z', 'chantier dans 3 jours : gardé avec son début');
  assert.equal(stats.future, 1);
  assert.deepEqual(stats.times, { debut: 11, fin: 0, lesDeux: 3, aucun: 2 });
});

test('doublons : même id → version la plus haute ; même type, lieu et début → un seul', () => {
  const { result } = convert();
  const r9 = result.json.events.filter((e) => e.id === 'r9');
  assert.equal(r9.length, 1);
  assert.equal(r9[0].c, 'Version 2', 'version 2, commentaire en français');
  assert.equal(byId(result, 'r11'), undefined, 'r11 = même bouchon que r2');
  assert.ok(byId(result, 'r2'));
});

test('JSON national : format, licence, dates de la source, taille', () => {
  const { result } = convert(XML, { lastModified: 'Thu, 26 Nov 2026 11:24:34 GMT' });
  const j = JSON.parse(result.text);
  assert.equal(j.format, 'gabarit-trafic');
  assert.equal(j.version, 1);
  assert.equal(j.licence, 'Licence Ouverte Etalab 2.0');
  assert.match(j.source, /Bison Futé \(DIR\)/);
  assert.equal(j.publication, '2026-11-26T11:24:34Z');
  assert.equal(j.lastModified, '2026-11-26T11:24:34Z');
  assert.equal(j.copied, '2026-11-26T12:30:00Z');
  assert.equal(j.count, j.events.length);
  assert.equal(result.bytes, Buffer.byteLength(result.text));
  assert.ok(result.bytes < TRAFIC.MAX_JSON_BYTES);
  assert.equal(result.problem, null);
  for (const ev of j.events) {
    assert.deepEqual(Object.keys(ev).filter((k) => k !== 'l'), ['id', 'k', 'st', 'p', 's', 'e', 'd', 'r', 'c', 'v']);
    assert.ok(KINDS.includes(ev.k));
    assert.ok(ev.p.every(Number.isFinite));
  }
});

test('trop gros : commentaires retirés d\'abord, puis copie refusée', () => {
  const full = convert().result.bytes;
  const lean = convert(XML, { maxBytes: 1e9 });
  for (const ev of lean.result.json.events) ev.c = null;
  const noComment = Buffer.byteLength(`${JSON.stringify(lean.result.json)}\n`);
  assert.ok(noComment < full);
  const cut = convert(XML, { maxBytes: noComment + 1 }).result;
  assert.deepEqual(cut.reductions, ['commentaires retirés']);
  assert.equal(cut.problem, null);
  assert.ok(cut.json.events.every((e) => e.c === null));
  const refused = convert(XML, { maxBytes: noComment - 1 }).result;
  assert.match(refused.problem, /JSON trop gros/);
});

test('plafond de 3 000 événements : les fermetures passent avant les chantiers', () => {
  const rec = (i, type, extra = '') => `<situation id="g${i}" version="1"><situationRecord xsi:type="${type}" id="g${i}" version="1">`
    + `<validity><validityStatus>active</validityStatus><validityTimeSpecification><overallStartTime>2026-11-26T0${i % 10}:${String(i % 60).padStart(2, '0')}:00Z</overallStartTime></validityTimeSpecification></validity>`
    + `<groupOfLocations xsi:type="Point"><locationForDisplay><latitude>${(45 + (i % 300) / 100).toFixed(2)}</latitude><longitude>${(2 + Math.floor(i / 300) / 100).toFixed(2)}</longitude></locationForDisplay></groupOfLocations>${extra}</situationRecord></situation>`;
  const body = [];
  for (let i = 0; i < 3000; i += 1) body.push(rec(i, 'MaintenanceWorks'));
  for (let i = 3000; i < 3010; i += 1) body.push(rec(i, 'RoadOrCarriagewayOrLaneManagement', '<roadOrCarriagewayOrLaneManagementType>roadClosed</roadOrCarriagewayOrLaneManagementType>'));
  const xml = `<d2LogicalModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><payloadPublication><publicationTime>2026-11-26T12:00:00Z</publicationTime>${body.join('')}</payloadPublication></d2LogicalModel>`;
  const { result, stats } = convert(xml);
  assert.equal(stats.records, 3010);
  assert.equal(result.json.count, TRAFIC.MAX_EVENTS);
  assert.equal(result.beyond, 10);
  assert.equal(result.json.counts.fermeture, 10, 'toutes les fermetures gardées');
  assert.equal(result.json.counts.chantier, 2990);
  assert.ok(result.bytes < TRAFIC.MAX_JSON_BYTES, '3 000 événements tiennent dans 1 Mo');
});

test('XML mal formé : erreur, rien de converti, l\'ancien JSON reste', () => {
  assert.throws(() => collectXml(BAD), /XML mal formé/);
  const res = convertText(BAD, { now: NOW });
  assert.equal(res.ok, false);
  assert.equal(res.result, undefined);
  assert.match(res.log, /Flux illisible .*l'ancien JSON reste/);
});

test('DOCTYPE et entités externes refusés', () => {
  const evil = '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><d2LogicalModel>&x;</d2LogicalModel>';
  assert.throws(() => collectXml(evil), /DOCTYPE/);
  assert.equal(convertText(evil, { now: NOW }).ok, false);
  assert.throws(() => collectXml('<a>&inconnue;</a>'), /entité inconnue/);
});

test('flux sans enregistrement : copie refusée', () => {
  const res = convertText('<d2LogicalModel><payloadPublication><publicationTime>2026-11-26T12:00:00Z</publicationTime></payloadPublication></d2LogicalModel>', { now: NOW });
  assert.equal(res.ok, false);
  assert.match(res.log, /sans aucun enregistrement/);
});

test('convertText : journal et complétude par la liste du dossier', () => {
  const html = '<html><body><a href="content.xml">content.xml</a> <a href="r1.xml">r1.xml</a> <a href="./r2.xml">r2</a> <a href="inconnu.xml">x</a> <a href="autre.txt">t</a></body></html>';
  const res = convertText(XML, { now: NOW, bytesRead: 12345, listing: (ids) => listingStats(html, ids) });
  assert.equal(res.ok, true);
  assert.match(res.log, /3 fichiers \.xml listés dans le dossier, 2 portent un id de content\.xml/);
  assert.match(res.log, /Complétude de content\.xml : incomplet ou noms différents/);
  assert.match(res.log, /Codes des fermetures : roadClosed 1, carriagewayClosures 1/);
  assert.match(res.log, /ligne droite départ → arrivée 2/);
  assert.deepEqual(listingStats('<p>rien</p>', new Set()), { files: 0, matched: 0, examples: [] });
  assert.equal(listingStats(null, new Set()), null);
  const unreachable = convertText(XML, { now: NOW, listing: { error: 'HTTP 403' } });
  assert.match(unreachable.log, /Dossier du flux : non mesurable \(HTTP 403\)/);
});

test('journal : chiffres seulement, aucune coordonnée', () => {
  const { result, stats } = convert();
  const log = trafficLog(stats, result, { bytesRead: 9000, lastModified: 'Thu, 26 Nov 2026 11:24:34 GMT' });
  assert.doesNotMatch(log, /\d+\.\d{2,}/, 'aucun nombre à 2 décimales ou plus (coordonnées)');
  for (const c of ['45.1', '5.7', '4.8', '47.5']) assert.ok(!log.includes(c), c);
  assert.match(log, /Gardés : 7/);
  assert.match(log, /Sens des gardés : deux sens 2 ; un sens 1 ; inconnu 4/);
  assert.match(log, /Réponses aux « À vérifier »/);
});

test('téléchargement : https et domaine tipi seulement ; gzip, BOM et UTF-8 strict', () => {
  assert.equal(checkUrl('https://tipi.bison-fute.gouv.fr/x.xml').hostname, 'tipi.bison-fute.gouv.fr');
  assert.throws(() => checkUrl('http://tipi.bison-fute.gouv.fr/x.xml'), /pas https/);
  assert.throws(() => checkUrl('https://exemple.test/x.xml'), /domaine refusé/);
  const gz = gzipSync(Buffer.from(`﻿${XML}`, 'utf8'));
  const dec = decodeBody(gz);
  assert.equal(dec.text, XML, 'gzip décompressé, BOM retirée');
  assert.throws(() => decodeBody(Buffer.from([0x3c, 0x61, 0xff, 0x3e])), TypeError);
  assert.throws(() => decodeBody(gzipSync(Buffer.alloc(2000, 0x20)), 1000));
});
