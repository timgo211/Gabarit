// Étude DiaLog (Action « Étude DiaLog », journal seulement) : lecteur XML en flux et statistiques DATEX II.
// Fixture SYNTHÉTIQUE dialog-datex.xml écrite à la main sur le gabarit officiel (hauteur, poids, deux opérateurs,
// mesure sans géométrie, mesure temporaire, dérogation, CDATA, entités) ; XML mal formés écrits ici. Aucun réseau.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ALLOWED_HOSTS, DIALOG_URL, checkUrl, createXmlReader, decodeEntities, formatReport, geometryBox, pickExamples,
  readStream,
} from '../tools/dialog-etude.mjs';

const XML = readFileSync(new URL('./fixtures/dialog-datex.xml', import.meta.url));
const NOW = Date.parse('2026-11-25T12:00:00Z');

// Découpe en petits morceaux (coupes au milieu des balises, des entités et des caractères UTF-8).
function* chunks(buf, size) { for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size); }

test('fixture : comptes, opérateurs, permanent / temporaire / en vigueur', async () => {
  const { stats: s, bytes } = await readStream(chunks(XML, 7), { now: NOW });
  assert.equal(bytes, XML.length);
  assert.equal(s.publicationTime, '2026-11-25T06:00:00+01:00');
  assert.equal(s.orders, 8);
  assert.equal(s.measures, 10);
  assert.deepEqual(s.dims, { hauteur: 3, poids: 5, largeur: 0, longueur: 0 });
  assert.deepEqual(s.dimsPermanent, { hauteur: 2, poids: 3, largeur: 0, longueur: 0 });
  assert.deepEqual(s.dimsTemporary, { hauteur: 1, poids: 2, largeur: 0, longueur: 0 });
  assert.deepEqual(s.dimsActive, { hauteur: 2, poids: 3, largeur: 0, longueur: 0 });
  assert.equal(s.hw, 8);
  assert.equal(s.hwNoGeometry, 1);
  assert.deepEqual(Object.fromEntries(s.operators), {
    'hauteur lessThanOrEqualTo': 3, 'poids greaterThan': 1, 'poids lessThanOrEqualTo': 4,
    'hauteur (dérogation) lessThanOrEqualTo': 1,
  });
  assert.deepEqual(Object.fromEntries(s.regulationTypes), { 'AccessRestriction/noEntry': 9, SpeedLimit: 1 });
  assert.equal(s.vehicleTargets.get('poids lourd seul'), 3);
  assert.equal(s.vehicleTargets.get('poids lourd et/ou gabarit'), 5);
  assert.equal(s.vehicleTargets.get('tous véhicules (aucun type visé)'), 2);
});

test('fixture : géométrie, cellules, organisations, Vosges, entités et CDATA', async () => {
  const { stats: s } = await readStream([XML], { now: NOW });
  assert.equal(s.withGeometry, 9);
  assert.deepEqual(Object.fromEntries(s.geometryTypes), { LineString: 6, Polygon: 1, Point: 1, MultiLineString: 1 });
  assert.deepEqual(Object.fromEntries(s.hwCells), { '48N 6E': 6, '48N 2E': 1 });
  assert.deepEqual(s.hwBox, { south: 48.1, north: 48.9, west: 2.3, east: 6.61 });
  assert.equal(s.organizations.size, 8);
  assert.deepEqual(s.organizations.get('Commune A'), { measures: 2, hw: 2 });
  assert.deepEqual(s.organizations.get('Département B'), { measures: 2, hw: 1 });
  assert.equal(s.vosges, 6);
  assert.equal(s.vosgesExamples[0].titre, "Arrêté permanent pont de l'Exemple & RD 1");
  assert.equal(s.vosgesExamples[0].conditions, 'hauteur lessThanOrEqualTo 3.5');
  assert.equal(s.exWeight[1].fin, '2026-04-01T00:00:00+02:00');
  assert.equal(s.exWeight[1].centre, '(sans géométrie)');
  const report = formatReport(s, { bytes: XML.length, readAt: '2026-11-25T12:00:00.000Z' });
  assert.match(report, /règlements \(trafficRegulationOrder\) 8, mesures \(trafficRegulation\) 10/);
  assert.match(report, /ex\. 5 : poids lessThanOrEqualTo 19/);
  assert.match(report, /Commune A 2\/2 ; Commune C 1\/1 ; .*Département B 1\/2/);
  assert.ok(report.split('\n').length < 40, 'journal court');
});

test('dérogation (negate=true) comptée à part, période de la mesure', async () => {
  const xml = `<p xmlns:xsi="x"><trafficRegulationOrder>
    <validityByOrder><overallStartTime>2026-01-01T00:00:00Z</overallStartTime></validityByOrder>
    <trafficRegulation><typeOfRegulation xsi:type="AccessRestriction"/>
      <conditions xsi:type="ValidityCondition"><overallStartTime>2026-01-01T00:00:00Z</overallStartTime>
        <overallEndTime>2026-02-01T00:00:00Z</overallEndTime></conditions>
      <conditions xsi:type="VehicleCondition"><negate>true</negate>
        <heightCharacteristic><comparisonOperator>lessThanOrEqualTo</comparisonOperator><vehicleHeight>2</vehicleHeight></heightCharacteristic>
      </conditions>
      <conditions xsi:type="VehicleCondition"><negate>false</negate>
        <widthCharacteristic><comparisonOperator>lessThanOrEqualTo</comparisonOperator><vehicleWidth>2.5</vehicleWidth></widthCharacteristic>
      </conditions>
    </trafficRegulation></trafficRegulationOrder></p>`;
  const { stats: s } = await readStream([xml], { now: NOW });
  assert.equal(s.dimsNegated.hauteur, 1);
  assert.equal(s.dims.hauteur, 0);
  assert.equal(s.dims.largeur, 1);
  assert.equal(s.dimsActive.largeur, 0, 'période de la mesure terminée');
  assert.equal(s.hw, 0);
  assert.equal(s.operators.get('hauteur (dérogation) lessThanOrEqualTo'), 1);
});

test('XML mal formé ou refusé : erreur, jamais de résultat partiel', async () => {
  const bad = [
    ['<a><b></a>', /ferme/],
    ['<a>', /jamais fermé/],
    ['<a><b x="1></b></a>', /fin de fichier|illisible/],
    ['<a>&inconnue;</a>', /entité inconnue/],
    ['<a>A & B</a>', /isolé/],
    ['<a/><b/>', /deux éléments racine/],
    ['', /aucun élément/],
    ['<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>', /DOCTYPE/],
    ['texte<a/>', /hors de l'élément racine/],
  ];
  for (const [xml, re] of bad) {
    await assert.rejects(readStream([xml], { now: NOW }), re, xml);
  }
  await assert.rejects(readStream([Buffer.from([0x3c, 0x61, 0x3e, 0xff, 0x3c, 0x2f, 0x61, 0x3e])]), /encoded data|invalid/i);
});

test('lecteur : entités, attributs, balises coupées entre morceaux', () => {
  assert.equal(decodeEntities('a &lt;b&gt; &amp; &#233;&#x20AC;'), 'a <b> & é€');
  const ev = [];
  const r = createXmlReader({ open: (n, a) => ev.push(['o', n, a]), text: (t) => ev.push(['t', t]), close: (n) => ev.push(['c', n]) });
  for (const c of ['<x:r a', '="1" b=\'&amp;', '\'><v>é&a', 'mp;z</v><w', '/></x:r>']) r.write(c);
  r.end();
  assert.deepEqual(ev, [['o', 'r', { a: '1', b: '&' }], ['o', 'v', {}], ['t', 'é&z'], ['c', 'v'], ['o', 'w', {}], ['c', 'w'], ['c', 'r']]);
});

test('géométrie : boîte englobante sans rien évaluer', () => {
  assert.deepEqual(geometryBox({ type: 'Point', coordinates: [6, 48] }), { south: 48, north: 48, west: 6, east: 6 });
  assert.deepEqual(geometryBox({ type: 'GeometryCollection', geometries: [{ coordinates: [1, 2] }, { coordinates: [[3, 4]] }] }),
    { south: 2, north: 4, west: 1, east: 3 });
  assert.equal(geometryBox({ type: 'Point', coordinates: ['a', 'b'] }), null);
  assert.equal(geometryBox(null), null);
});

test('exemples : 3 hauteur + 2 poids, complétés par l\'autre liste', () => {
  assert.deepEqual(pickExamples([1, 2, 3, 4], [5, 6, 7], 5), [1, 2, 3, 5, 6]);
  assert.deepEqual(pickExamples([1], [5, 6, 7, 8, 9], 5), [1, 5, 6, 7, 8]);
  assert.deepEqual(pickExamples([1, 2, 3, 4, 9], [5], 5), [1, 2, 3, 4, 5]);
});

test('domaines permis seulement, https seulement', () => {
  assert.deepEqual(ALLOWED_HOSTS, ['www.data.gouv.fr', 'static.data.gouv.fr', 'dialog.beta.gouv.fr']);
  assert.equal(checkUrl(DIALOG_URL).hostname, 'www.data.gouv.fr');
  assert.equal(checkUrl('https://dialog.beta.gouv.fr/api/regulations/datex.xml').hostname, 'dialog.beta.gouv.fr');
  assert.throws(() => checkUrl('http://www.data.gouv.fr/x'), /https/);
  assert.throws(() => checkUrl('https://evil.example/x'), /domaine refusé/);
  assert.throws(() => checkUrl('https://www.data.gouv.fr.evil.example/x'), /domaine refusé/);
});
