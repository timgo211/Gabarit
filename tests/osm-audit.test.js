import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGeojsonLine } from '../src/lib/areas-osm-data.js';
import {
  AUDIT, KNOWN_GAPS, auditAxisFromFeature, auditBridgeFromFeature, auditIndex, auditReport, axisCards, axisLevel,
  bridgeCards, bridgeCrossings, bridgeNearAxis, buildAxisIndex, locateSection, normName, placeFromFeature, placeIndex,
  restrictionCards, restrictionPresent, restrictionProposal, segmentCrossing, sortCards, splitCards,
} from '../src/lib/osm-audit.js';

const FEATURES = readFileSync(new URL('./fixtures/osm-audit-axes.geojsonseq', import.meta.url), 'utf8')
  .split('\n').map(parseGeojsonLine).filter(Boolean);

const RULES = [
  { id: 'lyon-a6', refs: ['A6'], de: 'Lissieu', a: 'Limonest', zone: [4.2, 45.4, 5.2, 46.3], nature: 'poids', valeur: 7.5,
    sens: '2 sens', texte: 'A6 test', arrete: 'arrêté test', source: 'test', lu: 'arrêté' },
  { id: 'homonymes', refs: ['A7'], de: 'Ternay', a: 'Saint-Fons', zone: [4.2, 45.4, 5.2, 46.3], nature: 'interdit',
    sens: '2 sens', texte: 't', arrete: 'inconnu', source: 'test', lu: 'Bison Futé' },
  { id: 'non-localisable', refs: ['A55'], localisable: false, raison: 'échangeurs', texte: 't', arrete: 'inconnu', source: 'test' },
];

/** Audit complet sur la fixture (même enchaînement que tools/audit-osm.mjs, sans fichiers). */
function run(levels = [1, 2]) {
  const axes = []; const places = []; const bridges = [];
  for (const f of FEATURES) {
    const a = auditAxisFromFeature(f, levels); if (a) axes.push(a);
    const p = placeFromFeature(f); if (p) places.push(p);
  }
  const index = buildAxisIndex(axes);
  const cards = [];
  let near = 0;
  for (const f of FEATURES) {
    const b = auditBridgeFromFeature(f);
    if (!b) continue;
    bridges.push(b);
    if (!bridgeNearAxis(b, index)) continue;
    near += 1;
    cards.push(...bridgeCards(b, bridgeCrossings(b, axes, index), axes));
  }
  cards.push(...axisCards(axes));
  const r = restrictionCards(RULES, axes, placeIndex(places));
  cards.push(...r.cards);
  return { axes, places, bridges, near, cards, r };
}

test('niveaux : autoroutes, nationales (trunk ou primary N), grandes départementales (D)', () => {
  assert.equal(axisLevel({ highway: 'motorway' }), 1);
  assert.equal(axisLevel({ highway: 'motorway_link' }), 1);
  assert.equal(axisLevel({ highway: 'trunk', ref: 'D 1' }), 2);
  assert.equal(axisLevel({ highway: 'primary', ref: 'N 7' }), 2);
  assert.equal(axisLevel({ highway: 'primary', ref: 'RN 7' }), 2);
  assert.equal(axisLevel({ highway: 'primary', ref: 'D 1084' }), 3);
  assert.equal(axisLevel({ highway: 'secondary', ref: 'D 306' }), 3);
  assert.equal(axisLevel({ highway: 'primary' }), null);
  assert.equal(axisLevel({ highway: 'secondary', ref: 'N 7' }), null);
  assert.equal(axisLevel({ highway: 'tertiary', ref: 'D 3' }), null);
});

test('voies auditées en niveaux 1-2 : départementales et primaires sans N écartées', () => {
  const { axes } = run();
  assert.deepEqual(axes.map((a) => a.id).sort((x, y) => x - y), [11, 12, 13, 14, 16, 17]);
  assert.deepEqual(axes.find((a) => a.id === 11).refs, ['A6']);
  assert.equal(axes.find((a) => a.id === 16).tunnel, true);
  assert.equal(axes.find((a) => a.id === 16).layer, -1);
});

test('croisement : bout du pont posé sur l\'axe ignoré, sommet de l\'axe sous le pont compté', () => {
  assert.ok(segmentCrossing([0, 45], [0.002, 45.002], [0, 45.002], [0.002, 45]));
  assert.equal(segmentCrossing([0.001, 45.001], [0.002, 45.002], [0, 45.002], [0.002, 45]), null); // bout du pont
  assert.ok(segmentCrossing([0, 45], [0.002, 45.002], [0.001, 45.001], [0.003, 45])); // sommet de l'axe
  assert.equal(segmentCrossing([0, 45], [0.001, 45], [0, 45.001], [0.001, 45.001]), null); // parallèles
});

test('ponts : garde-fou des 50 m, couches, passerelles gardées', () => {
  const { bridges, near } = run();
  const ids = bridges.map((b) => b.id);
  assert.ok(!ids.includes(104), 'pont en couche -1 écarté');
  assert.ok(ids.includes(103), 'passerelle piétonne gardée (hauteur limitée au-dessus d\'une autoroute)');
  assert.equal(near, 3, 'pont isolé (102) et pont au-dessus d\'une départementale non auditée (105) écartés sans calcul');
});

test('fiches niveaux 1-2 : ponts sans hauteur, hauteur sur le pont, tunnel, hauteur basse, interdiction', () => {
  const { cards } = run();
  const by = (way, type) => cards.filter((c) => c.way === way && c.type.startsWith(type));
  assert.equal(by(11, 'pont sans hauteur').length, 1);
  assert.equal(by(12, 'pont sans hauteur').length, 1);
  const onBridge = by(14, 'hauteur sur le pont seulement');
  assert.equal(onBridge.length, 1);
  assert.equal(onBridge[0].priorite, 2, '4,1 m < 4,30 m');
  assert.deepEqual(onBridge[0].etiquettesProposees, { maxheight: '4.1' });
  assert.equal(onBridge[0].pont, 101);
  assert.equal(by(16, 'tunnel sans hauteur').length, 1);
  assert.equal(by(17, 'hauteur basse connue').length, 1);
  assert.equal(by(17, 'pont').length + by(17, 'hauteur sur').length, 0, 'axe à hauteur connue : pas de fiche de pont');
  const ban = cards.filter((c) => c.priorite === 1);
  assert.deepEqual(ban.map((c) => c.way), [11], 'w12 porte déjà hgv:conditional weight>7.5');
  assert.equal(ban[0].orsLit, 'non (hgv:conditional ignoré par ORS)');
  assert.equal(ban[0].confiance, 'moyenne');
  assert.equal(cards.length, 6);
  for (const c of cards) {
    assert.equal(c.note, 'à vérifier sur place');
    assert.match(c.url, /^https:\/\/www\.openstreetmap\.org\/way\/\d+$/);
  }
});

test('niveau 3 : pont au-dessus d\'une grande départementale', () => {
  const { cards } = run([1, 2, 3]);
  assert.equal(cards.filter((c) => c.way === 15 && c.niveau === 3).length, 1);
  assert.equal(cards.length, 7);
});

test('sections : communes homonymes et lignes non localisables jamais devinées', () => {
  const { r } = run();
  assert.equal(r.located.length, 1);
  const reasons = Object.fromEntries(r.unlocated.map((u) => [u.entry.id, u.reason]));
  assert.match(reasons.homonymes, /Ternay.*2 nœud/);
  assert.equal(reasons['non-localisable'], 'échangeurs');
  assert.ok(locateSection({ refs: ['A6'], zone: [0, 0, 1, 1], de: 'X', a: 'Y' }, new Map()).reason);
  assert.equal(normName('Le Péage-de-Roussillon'), 'le peage de roussillon');
});

test('étiquettes attendues et lecture par ORS', () => {
  const poids = { nature: 'poids', valeur: 7.5 };
  assert.equal(restrictionPresent(poids, {}), false);
  assert.equal(restrictionPresent(poids, { hgv: 'no' }), true);
  assert.equal(restrictionPresent(poids, { 'hgv:conditional': 'no @ (weight>12)' }), false, 'seuil plus haut : ne couvre pas');
  assert.equal(restrictionPresent(poids, { maxweight: '7.5' }), true);
  assert.equal(restrictionPresent({ nature: 'transit' }, { hgv: 'destination' }), true);
  assert.equal(restrictionPresent({ nature: 'interdit' }, { 'hgv:forward': 'no' }), true);
  assert.equal(restrictionPresent({ nature: 'hauteur', valeur: 4.3 }, { maxheight: '4.3' }), true);
  assert.equal(restrictionPresent({ nature: 'hauteur', valeur: 4.3 }, { maxheight: '4.5' }), false);
  assert.deepEqual(restrictionProposal({ nature: 'interdit', sens: '2 sens' }), { proposed: { hgv: 'no' }, ors: 'oui' });
  assert.equal(restrictionProposal({ nature: 'transit', valeur: 3.5 }).proposed.hgv, 'destination');
  assert.equal(restrictionProposal({ nature: 'transit', valeur: 7.5 }).proposed['hgv:conditional'], 'destination @ (weight>7.5)');
  assert.equal(restrictionProposal({ nature: 'poids', valeur: 26, desserte: true }).proposed['hgv:conditional'], 'destination @ (weight>26)');
  const one = restrictionProposal({ nature: 'interdit', sens: 'nord → sud' });
  assert.equal(one.ors, 'à vérifier (un seul sens)');
  assert.match(one.proposed.sens, /:forward ou :backward/);
});

test('tri : interdiction > hauteur basse > hauteur inconnue, puis niveau', () => {
  const { cards } = run();
  const sorted = sortCards(cards);
  assert.deepEqual(sorted.map((c) => c.priorite), [1, 2, 2, 3, 3, 3]);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].priorite === sorted[i - 1].priorite) assert.ok(sorted[i].niveau >= sorted[i - 1].niveau);
  }
});

test('découpage : fichiers par niveau, chacun sous la limite', () => {
  const { cards } = run();
  const files = splitCards(cards);
  assert.deepEqual([...files.keys()], ['niveau-1.json', 'niveau-2.json']);
  const many = Array.from({ length: 400 }, (_, i) => ({ ...cards[0], way: i + 1 }));
  const small = splitCards(many, 20000);
  assert.ok(small.size > 1);
  for (const [name, f] of small) {
    assert.match(name, /^niveau-1-\d+\.json$/);
    assert.ok(Buffer.byteLength(JSON.stringify(f)) <= 20000, `${name} trop gros`);
  }
  assert.equal([...small.values()].reduce((n, f) => n + f.fiches.length, 0), 400);
});

test('rapport : chiffres, trous connus, rien de deviné, à vérifier sur place', () => {
  const { cards, r } = run();
  const files = splitCards(cards);
  const index = auditIndex(cards, files, { updated: '2026-11-25', levels: [1, 2] });
  assert.equal(index.total, 6);
  assert.deepEqual(index.parPriorite, { 1: 1, 2: 2, 3: 3 });
  const md = auditReport(index, cards, { located: r.located, unlocated: r.unlocated, axesLog: ['Axes : test.'] });
  for (const s of ['à vérifier sur place', 'la signalisation fait foi', 'rien n\'est écrit dans OpenStreetMap', '## Trous connus',
    'RN 118', 'Duplex A86', 'La Défense', 'Transit dans Paris', 'homonymes', '2 à 3 semaines']) {
    assert.ok(md.includes(s), `rapport sans « ${s} »`);
  }
  assert.equal(KNOWN_GAPS.length, 4);
  assert.ok(md.includes('https://www.openstreetmap.org/way/11'));
});

test('liste des interdictions (tools/audit-osm-interdictions.json) : schéma, rien de deviné', () => {
  const json = JSON.parse(readFileSync(new URL('../tools/audit-osm-interdictions.json', import.meta.url), 'utf8'));
  assert.match(json.source, /à vérifier/);
  const ids = new Set();
  for (const s of json.sections) {
    assert.ok(!ids.has(s.id), `id en double : ${s.id}`); ids.add(s.id);
    assert.ok(s.texte && s.arrete && s.source, `${s.id} : texte, arrêté et source requis`);
    if (s.localisable === false) { assert.ok(s.raison, `${s.id} : raison requise`); continue; }
    assert.ok(Array.isArray(s.refs) && s.refs.length && s.de && s.a, `${s.id} : refs, de, a`);
    assert.ok(Array.isArray(s.zone) && s.zone.length === 4 && s.zone[0] < s.zone[2] && s.zone[1] < s.zone[3], `${s.id} : zone`);
    assert.ok(['interdit', 'poids', 'transit', 'hauteur'].includes(s.nature), `${s.id} : nature`);
    if (s.nature !== 'interdit') assert.ok(typeof s.valeur === 'number' && s.valeur > 0, `${s.id} : valeur`);
    assert.ok(['arrêté', 'Bison Futé'].includes(s.lu), `${s.id} : lu`);
    // Numéro d'arrêté jamais inventé : soit « inconnu », soit un numéro cité par l'étude.
    if (!/inconnu/.test(s.arrete)) {
      const study = readFileSync(new URL('../docs/etude-osm-axes.md', import.meta.url), 'utf8');
      const num = /(DDT[-_][\w-]+|\d{2}\/\d{2}\/\d{4})/.exec(s.arrete)?.[1];
      assert.ok(num && study.includes(num), `${s.id} : « ${num} » absent de l'étude`);
    }
  }
  assert.ok(json.sections.length >= 15);
});

test('constantes : 5 Mo par fichier, seuil de tri 4,30 m, garde-fou 50 m', () => {
  assert.equal(AUDIT.MAX_FILE_BYTES, 5 * 1024 * 1024);
  assert.equal(AUDIT.LOW_HEIGHT_M, 4.3);
  assert.equal(AUDIT.NEAR_M, 50);
});
