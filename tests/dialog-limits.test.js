// Limites officielles DiaLog (phase 12c) : lecture des cases, détection sur le tracé (tronçon suivi, cap modulo 180°,
// jamais un croisement), hauteur et poids (valeur = maximum autorisé), temporaire expirée, début futur, doublon avec
// OSM, textes. Cas du type de l'étude (boîte Vosges) : Rosières-aux-Salines (54, hauteur 3,4 m, beffroi), Frizon
// (« PONT FRAGILE », 3,5 t), Eloyes (3,5 t, travaux, jusqu'au 31/12/2026). Géométries synthétiques courtes près de ces
// communes, cases fabriquées par les fonctions de l'Action (tools/dialog-convert.mjs). Aucun réseau.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { convertDialog } from '../tools/dialog-convert.mjs';
import {
  dialogAlongRoute, dialogApplies, dialogLines, dialogRules, dialogText, frDate, mergeDialogTiles, mergeWithOsm,
  parseDialogTile, periodText,
} from '../src/lib/dialog-limits.js';
import { fromDialog, validateRestriction } from '../src/lib/restrictions.js';
import { routeRules } from '../src/lib/route-rules.js';

const GRID = JSON.parse(readFileSync(new URL('../data/poids-osm/index.json', import.meta.url), 'utf8')).grid;

// Lignes droites est-ouest d'environ 700 m (0,01° de longitude à 48° N).
const ew = (lon, lat) => [[lon, lat], [lon + 0.005, lat], [lon + 0.01, lat]];
const ROSIERES = { k: 'h', value: 3.4, title: 'éviter le passage des semi-remorques sous le beffroi', org: 'Rosieres-aux-Salines', start: '2024-02-02', end: null, rec: false, negate: false, lines: [ew(6.33, 48.6)] };
const FRIZON = { k: 'w', value: 3.5, title: 'PONT FRAGILE', org: 'Frizon', start: '2026-05-06', end: null, rec: false, negate: false, lines: [ew(6.36, 48.29)] };
const ELOYES = { k: 'w', value: 3.5, title: 'interdiction pl travaux rue jarmenil', org: 'Eloyes', start: '2026-06-07', end: '2026-12-31', rec: false, negate: false,
  lines: [[[6.6, 48.1], [6.603, 48.1]], [[6.603, 48.1], [6.607, 48.1]], [[6.607, 48.1], [6.61, 48.1]]] };

function copyOf(measures) {
  const res = convertDialog(measures, { publication: '2026-11-26T13:14:00+00:00', updated: '2026-11-26', grid: GRID });
  assert.equal(res.problem, null);
  const tiles = [...res.tiles.values()].map((t) => parseDialogTile(JSON.parse(JSON.stringify(t))));
  return { status: 'ok', data: mergeDialogTiles(tiles), updated: res.index.updated };
}
const route = (coords) => ({ coordinates: coords });
const along = (m, extra = 0.004) => route([[m.lines[0][0][0] - extra, m.lines[0][0][1]], ...m.lines.flat(), [m.lines.at(-1).at(-1)[0] + extra, m.lines[0][0][1]]]);
const TRUCK = { height: 4, weight: 19 };
const TODAY = '2026-11-26';

test('Rosières-aux-Salines : hauteur 3,4 m visée selon la hauteur du profil (+ 0,1 m)', () => {
  const c = copyOf([ROSIERES]);
  const r = along(ROSIERES);
  assert.equal(dialogAlongRoute(r, c.data, { vehicle: { height: 3.3, weight: 19 }, today: TODAY }).items.length, 1, '3,3 + 0,1 ≥ 3,4');
  assert.equal(dialogAlongRoute(r, c.data, { vehicle: { height: 3.2, weight: 19 }, today: TODAY }).items.length, 0, '3,2 m passe');
  const [it] = dialogAlongRoute(r, c.data, { vehicle: TRUCK, today: TODAY }).items;
  assert.equal(it.k, 'h');
  assert.equal(it.value, 3.4);
  assert.equal(dialogText(it, TODAY), 'Hauteur limitée à 3,4 m (DiaLog) — « éviter le passage des semi-remorques sous le beffroi » — '
    + 'Rosieres-aux-Salines — permanent. À vérifier — seul l\'arrêté fait foi — la signalisation fait foi.');
  assert.ok(it.length > 600 && it.length < 800, `passage ≈ 700 m (${it.length})`);
});

test('Frizon : « PONT FRAGILE » 3,5 t = maximum autorisé (3,5 t passe, 3,6 t visé)', () => {
  const c = copyOf([FRIZON]);
  const r = along(FRIZON);
  assert.equal(dialogAlongRoute(r, c.data, { vehicle: { height: 4, weight: 3.5 }, today: TODAY }).items.length, 0);
  assert.equal(dialogAlongRoute(r, c.data, { vehicle: { height: 4, weight: 3.6 }, today: TODAY }).items.length, 1);
  const [it] = dialogAlongRoute(r, c.data, { vehicle: TRUCK, today: TODAY }).items;
  assert.match(dialogText(it, TODAY), /^Poids limité à 3,5 t \(DiaLog\) — « PONT FRAGILE » — Frizon — permanent\. À vérifier/);
});

test('Eloyes : travaux jusqu\'au 31/12/2026 (visé le 30/12/2026, ignoré le 01/01/2027), lignes réunies', () => {
  const c = copyOf([ELOYES]);
  const r = along(ELOYES);
  const res = dialogAlongRoute(r, c.data, { vehicle: TRUCK, today: '2026-12-30' });
  assert.equal(res.items.length, 1, 'trois morceaux de la même mesure : un seul passage');
  assert.equal(periodText(res.items[0], '2026-12-30'), 'du 07/06/2026 au 31/12/2026');
  assert.equal(dialogAlongRoute(r, c.data, { vehicle: TRUCK, today: '2026-12-31' }).items.length, 1);
  assert.equal(dialogAlongRoute(r, c.data, { vehicle: TRUCK, today: '2027-01-01' }).items.length, 0);
});

test('début futur : jamais « en vigueur » ; période récurrente « sur période » ; dérogation signalée', () => {
  const future = { ...FRIZON, start: '2027-02-01', rec: true, negate: true };
  const c = copyOf([future]);
  const [it] = dialogAlongRoute(along(future), c.data, { vehicle: TRUCK, today: TODAY }).items;
  assert.ok(it, 'montrée (à vérifier)');
  const t = dialogText(it, TODAY);
  assert.match(t, /à partir du 01\/02\/2027, sur période — dérogations possibles\./);
  assert.doesNotMatch(t, /en vigueur/);
  assert.equal(periodText({ start: '2026-01-01', end: null }, TODAY), 'permanent');
  assert.equal(periodText({ start: null, end: '2026-12-31' }, TODAY), 'jusqu\'au 31/12/2026');
});

test('croisement à angle droit et route parallèle à 40 m : rien', () => {
  const c = copyOf([ROSIERES]);
  const cross = route([[6.335, 48.595], [6.335, 48.605]]);
  assert.equal(dialogAlongRoute(cross, c.data, { vehicle: TRUCK, today: TODAY }).items.length, 0);
  const parallel = route(ew(6.33, 48.60036)); // ≈ 40 m au nord
  assert.equal(dialogAlongRoute(parallel, c.data, { vehicle: TRUCK, today: TODAY }).items.length, 0);
  const reverse = route([...along(ROSIERES).coordinates].reverse());
  assert.equal(dialogAlongRoute(reverse, c.data, { vehicle: TRUCK, today: TODAY }).items.length, 1, 'sens inverse : cap modulo 180°');
});

test('profil sans hauteur ni PTAC : montré (donnée de sécurité manquante = à vérifier)', () => {
  assert.equal(dialogApplies({ k: 'h', value: 3.4 }, {}, TODAY), true);
  assert.equal(dialogApplies({ k: 'w', value: 3.5 }, null, TODAY), true);
  assert.equal(dialogApplies({ k: 'w', value: 3.5, end: '2026-11-25' }, TRUCK, TODAY), false);
});

test('doublon avec OSM : même valeur à 15 m → une ligne, deux sources ; valeur différente → deux lignes', () => {
  const c = copyOf([FRIZON]);
  const r = along(FRIZON);
  const [it] = dialogAlongRoute(r, c.data, { vehicle: TRUCK, today: TODAY }).items;
  const osmSame = { id: 42, limit: 3.5, along: it.along + 10, length: it.length - 20 };
  const osmOther = { id: 43, limit: 7.5, along: it.along, length: it.length };
  const osmFar = { id: 44, limit: 3.5, along: it.along + it.length + 200, length: 100 };
  const m = mergeWithOsm([it], [osmOther, osmSame, osmFar]);
  assert.equal(m.items[0].osm, true);
  assert.deepEqual([...m.absorbed].map((o) => o.id), [42]);
  assert.match(dialogText(m.items[0], TODAY), /^Poids limité à 3,5 t \(DiaLog et OpenStreetMap\)/);
  const h = mergeWithOsm([{ ...it, k: 'h' }], [osmSame]);
  assert.equal(h.absorbed.size, 0, 'hauteur jamais fusionnée avec une limite de poids');
});

test('fiche : 5 au plus + « +N », ligne technique, réglage, copie absente = rien', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ ...FRIZON, title: `Pont ${i}`, lines: [ew(6.36 + i * 0.02, 48.29)] }));
  const c = copyOf(many);
  const r = route([[6.355, 48.29], [6.51, 48.29]]);
  const out = dialogRules(r, { vehicle: TRUCK, copy: c, today: TODAY });
  assert.equal(out.items.length, 7);
  assert.equal(out.lines.length, 6);
  assert.equal(out.lines[5].text, '+2 limites officielles (DiaLog) à vérifier (voir la carte).');
  assert.ok(out.lines.every((l) => l.level === 'warn' && l.sev === 'check'));
  assert.match(out.lines[0].text, /\(km \d+\)$/);
  assert.equal(out.tech, 'Limites DiaLog : 7 (hauteur 0, poids 7) ; copie du 26/11/2026');
  assert.deepEqual(out.short, ['7 limites officielles à vérifier']);
  const off = dialogRules(r, { vehicle: TRUCK, copy: c, enabled: false, today: TODAY });
  assert.equal(off.lines.length, 0);
  assert.match(off.tech, /désactivé/);
  for (const copy of [null, { status: 'failed', data: { ways: [] } }, { status: 'loading', data: { ways: [] } }]) {
    const none = dialogRules(r, { vehicle: TRUCK, copy, today: TODAY });
    assert.deepEqual([none.lines, none.short, none.tech], [[], [], ''], 'aucun message');
  }
  assert.equal(dialogLines([], TODAY).length, 0);
});

test('routeRules : ligne DiaLog dans la fiche, limite OSM identique absorbée', () => {
  const c = copyOf([FRIZON]);
  const r = along(FRIZON);
  const osmWays = { status: 'ok', data: { ways: [{ id: 7, limit: 3.5, local: false, coords: FRIZON.lines[0] }] } };
  const rules = routeRules(r, { vehicle: TRUCK, weightLimits: osmWays, dialog: c, departure: new Date('2026-11-26T10:00:00') });
  assert.equal(rules.dialogLimits.items.length, 1);
  assert.equal(rules.weightLimits.items.length, 0, 'ligne OSM absorbée');
  const texts = rules.lines.map((l) => l.text);
  assert.equal(texts.filter((t) => /3,5 t/.test(t)).length, 1, 'une seule ligne');
  assert.ok(texts.some((t) => /DiaLog et OpenStreetMap/.test(t)));
  const solo = routeRules(r, { vehicle: TRUCK, weightLimits: osmWays, dialog: null });
  assert.equal(solo.weightLimits.items.length, 1, 'sans copie DiaLog : la ligne OSM reste');
});

test('cases : lignes illisibles ignorées, textes jamais interprétés (« <b> » reste du texte)', () => {
  assert.equal(parseDialogTile(null), null);
  assert.equal(parseDialogTile({ o: [], m: 'x' }), null);
  const t = parseDialogTile({
    o: [['<b>Titre</b>\u0007 en gras', 'Org', '2026-01-01', null], ['x', 5, null, null]],
    m: [[1, 1, 0, 3.4, 0, 0, 633000, 4860000, 500, 0], [2, 1, 2, 3.4, 0, 0, 1, 1, 1, 1], [3, 2, 1, 3.5, 1, 0, 1, 1, 1, 1],
      [4, 3, 1, -1, 0, 0, 1, 1, 1, 1], [5, 4, 1, 3.5, 0, 0, 1.5, 1, 1, 1]],
  });
  assert.equal(t.ways.length, 1);
  assert.equal(t.ways[0].title, '<b>Titre</b> en gras');
  assert.equal(frDate('2026-12-31'), '31/12/2026');
  assert.equal(frDate('n\'importe'), '');
});

test('« Éviter ce passage » : restriction hauteur ou poids au point du tracé, origine dialog', () => {
  const it = { k: 'h', value: 3.4, point: [6.335, 48.6], title: 'beffroi', along: 300 };
  const raw = fromDialog(it, { now: new Date('2026-11-26T10:00:00Z') });
  assert.deepEqual(raw, { lat: 48.6, lon: 6.335, type: 'height', value: 3.4, note: 'Limite DiaLog : beffroi', date: '2026-11-26', origin: 'dialog' });
  const n = validateRestriction(raw, { now: new Date('2026-11-26T10:00:00Z'), makeId: () => 'r1' });
  assert.equal(n.origin, 'dialog');
  assert.equal(fromDialog({ ...it, k: 'w', value: 3.5 }).type, 'weight');
});
