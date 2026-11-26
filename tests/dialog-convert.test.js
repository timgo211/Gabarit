// Copie DiaLog (phase 12c) : sélection des mesures, motifs d'ignorance, valeur lue comme maximum (opérateur ignoré),
// temporaire / permanent / période / à venir, cases de 1°, simplification si trop gros, XML mal formé (rien écrit).
// Fixture SYNTHÉTIQUE tests/fixtures/dialog-datex.xml (coordonnées arrondies à 2 décimales). Aucun réseau.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  DIALOG, SKIP, convertDialog, createDialogCollector, dayOf, dialogLog, linesOf, parseLimit,
} from '../tools/dialog-convert.mjs';
import { feedXml } from '../tools/dialog-etude.mjs';
import { runCopy } from '../tools/dialog-update.mjs';
import { parseIndex, routePlan } from '../src/lib/areas-osm-data.js';

const XML = readFileSync(new URL('./fixtures/dialog-datex.xml', import.meta.url));
const GRID = JSON.parse(readFileSync(new URL('../data/poids-osm/index.json', import.meta.url), 'utf8')).grid;
const TODAY = '2026-11-26';

async function collect(xml = XML, today = TODAY) {
  const c = createDialogCollector({ today });
  await feedXml([xml], c.handler);
  return c;
}

test('fixture : mesures gardées, valeurs, validité', async () => {
  const { measures, stats } = await collect();
  assert.equal(stats.read, 10);
  assert.equal(stats.kept, 5);
  assert.deepEqual(stats.byKind, { h: 2, w: 3 });
  const by = (t) => measures.find((m) => m.title?.startsWith(t));
  const beffroi = by('Arrêté permanent passage sous le beffroi');
  assert.deepEqual({ k: beffroi.k, value: beffroi.value, end: beffroi.end, org: beffroi.org }, { k: 'h', value: 3.4, end: null, org: 'Commune C' });
  const pont = by('PONT FRAGILE');
  assert.equal(pont.k, 'w');
  assert.equal(pont.value, 3.5);
  assert.equal(pont.lines.length, 2, 'MultiLineString : deux lignes');
  const travaux = by('Travaux réseau');
  assert.equal(travaux.value, 3.5, '« 3,5 » lu');
  assert.equal(travaux.start, '2026-09-01');
  assert.equal(travaux.end, '2026-12-31', 'fin à minuit pile = fin de la veille');
  const nuit = by('Interdiction de nuit');
  assert.equal(nuit.rec, true);
  assert.equal(nuit.start, '2027-02-01', 'début de la condition de la mesure');
  assert.equal(nuit.end, null);
  const pontExemple = by("Arrêté permanent pont de l'Exemple & RD 1");
  assert.equal(pontExemple.negate, true, 'dérogation emergencyServices gardée en drapeau');
  assert.equal(stats.withNegate, 1);
  assert.equal(stats.recurring, 1);
  assert.equal(stats.future, 1);
  assert.equal(stats.temporary, 1);
  assert.equal(stats.permanent, 4);
});

test('fixture : motifs des mesures ignorées', async () => {
  const { stats } = await collect();
  assert.deepEqual(Object.fromEntries(stats.skipped), {
    [SKIP.NOT_LINEAR]: 1, [SKIP.NO_GEOMETRY]: 1, [SKIP.OTHER]: 1, [SKIP.EXPIRED]: 1, [SKIP.NEGATE_ONLY]: 1,
  });
  const log = dialogLog(stats);
  assert.match(log, /Mesures lues : 10 ; gardées : 5 \(hauteur 2, poids 3\)/);
  assert.match(log, /avec aussi une dérogation \(negate\) 1 \(toujours « à vérifier »\)/);
  assert.match(log, /Organisations \(10 premières/);
  assert.doesNotMatch(log, /\d+\.\d{3,}/, 'aucune coordonnée dans le journal');
});

test('valeur = maximum autorisé : l\'opérateur est ignoré (greaterThan lu comme ≤)', async () => {
  const xml = String(XML).replace(/(<com:heightCharacteristic><com:comparisonOperator>)lessThanOrEqualTo(<\/com:comparisonOperator><com:vehicleHeight>3\.4)/, '$1greaterThan$2');
  assert.match(xml, /greaterThan<\/com:comparisonOperator><com:vehicleHeight>3\.4/);
  const { measures } = await collect(Buffer.from(xml));
  assert.equal(measures.find((m) => m.k === 'h' && m.value === 3.4)?.org, 'Commune C');
});

test('expiration selon le jour de la copie', async () => {
  const before = await collect(XML, '2026-12-31');
  assert.ok(before.measures.some((m) => m.title?.startsWith('Travaux réseau')), 'gardée le 31/12/2026');
  const after = await collect(XML, '2027-01-01');
  assert.ok(!after.measures.some((m) => m.title?.startsWith('Travaux réseau')), 'ignorée le 01/01/2027');
  assert.equal(after.stats.skipped.get(SKIP.EXPIRED), 2);
});

test('dayOf, parseLimit, linesOf', () => {
  assert.equal(dayOf('2026-12-31T23:59:59+01:00', { isEnd: true }), '2026-12-31');
  assert.equal(dayOf('2027-01-01T00:00:00+01:00', { isEnd: true }), '2026-12-31');
  assert.equal(dayOf('2027-01-01T00:00:00+01:00'), '2027-01-01');
  assert.equal(dayOf('2026-02-30'), null);
  assert.equal(dayOf('n\'importe quoi'), null);
  assert.equal(parseLimit('h', '3.4'), 3.4);
  assert.equal(parseLimit('h', '34'), null, 'hauteur hors bornes');
  assert.equal(parseLimit('w', '3,5'), 3.5);
  assert.equal(parseLimit('w', '-2'), null);
  assert.equal(parseLimit('w', '1e3'), null);
  assert.equal(parseLimit('w', '200'), null);
  assert.deepEqual(linesOf(['{"type":"Point","coordinates":[6,48]}']), { skip: SKIP.NOT_LINEAR });
  assert.deepEqual(linesOf(['pas du json']), { skip: SKIP.BAD_GEOMETRY });
  assert.deepEqual(linesOf(['{"type":"LineString","coordinates":[[6,48],["x",1]]}']), { skip: SKIP.BAD_GEOMETRY });
  const gc = linesOf(['{"type":"GeometryCollection","geometries":[{"type":"Point","coordinates":[6,48]},{"type":"LineString","coordinates":[[6,48],[6.01,48]]}]}']);
  assert.equal(gc.lines.length, 1);
});

test('titres : caractères de contrôle retirés, longueur bornée, texte jamais interprété', async () => {
  const long = `&lt;b&gt;${'x'.repeat(400)}`;
  const xml = String(XML).replace('PONT FRAGILE (essai)', long);
  const { measures } = await collect(Buffer.from(xml));
  const m = measures.find((x) => x.title?.startsWith('<b>'));
  assert.ok(m, 'le titre reste du texte brut (« <b> » non interprété)');
  assert.equal(m.title.length, DIALOG.MAX_TITLE);
});

test('cases de 1°, index lisible par parseIndex, hors France = rien', async () => {
  const { measures, stats } = await collect();
  const res = convertDialog(measures, { publication: stats.publicationTime, updated: TODAY, grid: GRID });
  assert.equal(res.problem, null);
  assert.deepEqual([...res.tiles.keys()], ['6_48'], 'zone (Polygon) de Paris ignorée : une seule case');
  const t = res.tiles.get('6_48');
  assert.ok(Array.isArray(t.o) && Array.isArray(t.m));
  const row = t.m.find((r) => r[2] === 0 && r[3] === 3.4);
  assert.ok(row, 'ligne hauteur 3,4 m');
  assert.equal(t.o[row[4]][1], 'Commune C');
  const multi = t.m.filter((r) => r[3] === 3.5 && r[2] === 1 && t.o[r[4]][1] === 'Commune D');
  assert.equal(multi.length, 2, 'deux lignes de la même mesure');
  assert.equal(multi[0][1], multi[1][1], 'même numéro de mesure');
  assert.notEqual(multi[0][0], multi[1][0], 'numéros de ligne distincts');
  const night = t.m.find((r) => r[3] === 12);
  assert.equal(night[5] & 1, 1, 'drapeau période');
  const idx = parseIndex(res.index);
  assert.ok(idx, 'index au format des copies OSM');
  assert.equal(res.index.count, 5);
  assert.deepEqual(res.index.counts, { h: 2, w: 3 });
  assert.equal(res.index.publication, '2026-11-25T06:00:00+01:00');
  assert.equal(res.index.license, 'Licence Ouverte 2.0');
  assert.deepEqual(routePlan([[6.33, 48.59], [6.34, 48.59]], idx).tiles, ['6_48']);
  assert.deepEqual(routePlan([[13.4, 52.5], [13.5, 52.5]], idx).tiles, [], 'Berlin : hors couverture');
});

test('simplification puis problème de taille au-delà des limites', async () => {
  const { measures } = await collect();
  const ok = convertDialog(measures, { updated: TODAY, grid: GRID, limits: { maxFile: 100000, maxTotal: 300000 } });
  assert.equal(ok.problem, null);
  assert.equal(ok.index.tolerance, 3);
  const tooBig = convertDialog(measures, { updated: TODAY, grid: GRID, limits: { maxFile: 50, maxTotal: 100 } });
  assert.match(tooBig.problem, /plus de/);
  assert.equal(tooBig.log.length, 3, '3 m, 8 m, 20 m essayés');
  assert.equal(convertDialog([], { updated: TODAY, grid: GRID }).problem, 'aucune mesure gardée');
  assert.equal(convertDialog(measures, { updated: TODAY, grid: null }).problem, 'grille de couverture France absente');
});

test('outil : copie écrite, puis XML mal formé ou trop gros → anciens fichiers gardés', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dialog-'));
  try {
    const dir = join(root, 'dialog');
    const first = await runCopy([XML], { dir, grid: GRID, today: TODAY });
    assert.equal(first.ok, true, first.log);
    const files = readdirSync(dir).sort();
    assert.ok(files.includes('index.json') && files.includes('6_48.json'));
    assert.match(first.log, /Copie écrite : 5 mesures/);

    const bad = await runCopy([Buffer.from('<?xml version="1.0"?><a><b></a>')], { dir, grid: GRID, today: TODAY });
    assert.equal(bad.ok, false);
    assert.match(bad.log, /Copie non remplacée : lecture impossible \(XML mal formé/);
    assert.deepEqual(readdirSync(dir).sort(), files, 'anciens fichiers gardés');

    const doctype = await runCopy([Buffer.from('<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><a/>')], { dir, grid: GRID, today: TODAY });
    assert.equal(doctype.ok, false);

    const big = await runCopy([XML], { dir, grid: GRID, today: TODAY, limits: { maxFile: 50, maxTotal: 100 } });
    assert.equal(big.ok, false);
    assert.match(big.log, /Copie non remplacée : case .* Les anciens fichiers restent\./);
    assert.deepEqual(readdirSync(dir).sort(), files);
    assert.ok(!existsSync(`${dir}.nouveau`) && !existsSync(`${dir}.ancien`));

    // Remplacement : un fichier en trop de l'ancienne copie disparaît.
    writeFileSync(join(dir, '0_0.json'), '{}\n');
    const again = await runCopy([XML], { dir, grid: GRID, today: TODAY });
    assert.equal(again.ok, true);
    assert.ok(!readdirSync(dir).includes('0_0.json'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
