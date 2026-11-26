// v83 : sections d'interdiction lues par la géométrie seule (sans veto du nom d'étape ORS) et fiches « non proposées »
// (route-bans.js). Copie réelle des points sensibles du dépôt ; itinéraires simulés ou vraies réponses ORS figées
// (aucune API appelée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fixture } from './helpers.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { sensitiveRules, parseSensitiveTile, mergeSensitiveTiles, parseSensitiveSections } from '../src/lib/sensitive-points.js';
import {
  BANS, routeBans, activeBans, geoSectionItems, notOfferedCards, notOfferedText, firstOffered,
} from '../src/lib/route-bans.js';

const DIR = new URL('../data/points-sensibles/', import.meta.url);
const INDEX = JSON.parse(readFileSync(new URL('index.json', DIR), 'utf8'));
const COPY = {
  status: 'ok', updated: INDEX.updated, meta: { sections: parseSensitiveSections(INDEX) },
  data: mergeSensitiveTiles(readdirSync(DIR).filter((f) => f !== 'index.json')
    .map((f) => parseSensitiveTile(JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))))),
};
const SECTIONS = COPY.meta.sections;
const SEMI = { weight: 44, height: 4 };
const VAN = { weight: 3.5, height: 2.8 };

/** Tracé simulé par les points d'une section (d'ouest en est), une seule étape nommée `name` sur tout le tracé. */
function through(id, name = '') {
  const si = SECTIONS.findIndex((s) => s.id === id);
  const coordinates = COPY.data.points.filter((p) => p.section === si).map((p) => p.point).sort((a, b) => a[0] - b[0]);
  return { coordinates, steps: name ? [{ name, wayPoints: [0, coordinates.length - 1] }] : [] };
}
const withCopy = (route, vehicle = SEMI) => routeBans(route, sensitiveRules(route, { vehicle, copy: COPY }).items, SECTIONS, { vehicle, copy: COPY });
const withoutCopy = (route, vehicle = SEMI) => routeBans(route, sensitiveRules(route, { vehicle, copy: COPY }).items, SECTIONS, { vehicle });

test('N59 : étape ORS qui garde le nom de son premier tronçon (« N 4 ») : section trouvée par la géométrie seule', () => {
  const route = through('n59', 'Avenue de Lorraine, N 4');
  assert.deepEqual(withoutCopy(route).map((b) => b.id), [], 'veto du nom d\'étape (avant v83 : fiche « Sans péage » sans ligne ⛔)');
  const bans = withCopy(route);
  assert.deepEqual(bans.map((b) => b.id), ['n59']);
  assert.equal(bans[0].local, true); // question « desserte locale » gardée
  assert.match(bans[0].title, /^N59 \/ N159 \(Lunéville – Sélestat\)$/);
  assert.deepEqual(withCopy(route, VAN).map((b) => b.id), [], '3,5 t : non concerné');
  // Étape bien nommée : même résultat qu'avant (une seule entrée, pas de doublon).
  assert.deepEqual(withCopy(through('n59', 'N 59')).map((b) => b.id), ['n59']);
});

test('géométrie seule : un croisement (un point) ou moins de 1 km ne suffit pas', () => {
  const si = SECTIONS.findIndex((s) => s.id === 'n59');
  const p = COPY.data.points.find((q) => q.section === si).point;
  const cross = { coordinates: [[p[0] - 0.01, p[1] - 0.01], p, [p[0] + 0.01, p[1] + 0.01]], steps: [] };
  assert.deepEqual(geoSectionItems(cross, COPY, SEMI), []);
  const full = through('n59');
  const short = { coordinates: full.coordinates.slice(0, 2), steps: [] };
  assert.deepEqual(geoSectionItems(short, COPY, SEMI), []);
  assert.ok(BANS.GEO_MIN_POINTS >= 3 && BANS.GEO_MIN_M >= 1000);
});

test('Lyon (A6 / A7) jamais par la géométrie seule (rocade Est, v77)', () => {
  for (const id of ['lyon-a6', 'lyon-a7']) {
    assert.deepEqual(withCopy(through(id, 'A 46')).map((b) => b.id), [], id);
  }
});

test('Mâcon → Valence (vraie réponse ORS) : rien de plus qu\'avant (Lyon exclu)', () => {
  const route = parseDirections(fixture('ors-directions-macon-valence.json'));
  const before = withoutCopy(route).map((b) => b.id);
  assert.deepEqual(withCopy(route).map((b) => b.id), before);
  assert.deepEqual(geoSectionItems(route, COPY, SEMI).map((it) => SECTIONS[it.section].id), []);
});

test('Nancy → Colmar, contournement N4 / A4 / A355 (vraie réponse ORS) : toujours aucune interdiction', () => {
  const route = parseDirections(fixture('ors-directions-nancy-colmar-contournement.json'));
  assert.deepEqual(withCopy(route).map((b) => b.id), []);
});

test('fiche qui traverse la N59 alors qu\'une autre l\'évite : « … interdite : trajet non proposé »', () => {
  const n59 = withCopy(through('n59', 'N 4'));
  const title = n59[0].title;
  const cards = [
    { blocked: false, names: [] }, // Recommandé (contournement)
    { blocked: false, names: [] }, // Plus court (routes secondaires) : reste proposé, jamais promu
    { blocked: true, names: [title] }, // Sans péage par la N59
  ];
  const out = notOfferedCards(cards, { vehicle: SEMI });
  assert.deepEqual(out, ['', '', 'N59 / N159 (Lunéville – Sélestat) interdite : trajet non proposé']);
  assert.equal(firstOffered(out, 2), 0);
  assert.equal(firstOffered(out, 1), 1);
  // Recommandé par la N59 et contournement en échec, « Plus court » l'évite : le Recommandé n'est pas proposé.
  const head = notOfferedCards([{ blocked: true, names: [title] }, { blocked: false, names: [] }], { vehicle: SEMI });
  assert.equal(head[0], notOfferedText([title]));
  assert.equal(firstOffered(head, 0), 1);
  // Lyon et deux sections : noms réunis.
  assert.equal(notOfferedText(['Lyon, A6 et A7', title, title]), `Lyon, A6 et A7 ; ${title} interdites : trajet non proposé`);
});

test('exceptions : toutes interdites, contournement en cours, ≤ 3,5 t, desserte « Oui »', () => {
  const t = 'N59 / N159 (Lunéville – Sélestat)';
  assert.deepEqual(notOfferedCards([{ blocked: true, names: [t] }, { blocked: true, names: [t] }], { vehicle: SEMI }), ['', ''], 'aucune alternative : rouge + confirmation');
  assert.equal(firstOffered(['', ''], 1), 1);
  assert.equal(firstOffered(['x', 'y'], 0), -1);
  const cards = [{ blocked: false, names: [] }, { blocked: true, names: [t] }];
  assert.deepEqual(notOfferedCards(cards, { pending: true, vehicle: SEMI }), ['', '']);
  assert.deepEqual(notOfferedCards(cards, { vehicle: VAN }), ['', '']);
  assert.deepEqual(notOfferedCards(cards, { vehicle: { weight: null } }), ['', notOfferedText([t])], 'poids inconnu : prudence');
  const bans = withCopy(through('n59', 'N 4'));
  assert.deepEqual(activeBans(bans, { n59: true }), [], 'desserte « Oui » : fiche plus bloquée, donc proposée');
});
