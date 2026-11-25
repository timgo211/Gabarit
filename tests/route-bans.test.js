// v78 : interdictions connues sur le trajet (route-bans.js). Copie réelle des points sensibles du dépôt
// (data/points-sensibles/) ; itinéraires de test tracés par les points d'une section (aucune API appelée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  sensitiveRules, parseSensitiveTile, mergeSensitiveTiles, parseSensitiveSections,
} from '../src/lib/sensitive-points.js';
import {
  BANS, routeBans, activeBans, localQuestions, declaredText, confirmText, sanitizeAnswers, oneWayOf, travelAt, zoneLabel,
  localPossible, pointAt,
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

/** Itinéraire de test : points de la section du nord au sud (south) ou du sud au nord. */
function through(id, dir = 'south') {
  const si = SECTIONS.findIndex((s) => s.id === id);
  const pts = COPY.data.points.filter((p) => p.section === si).map((p) => p.point).sort((a, b) => b[1] - a[1]);
  return { coordinates: dir === 'south' ? pts : pts.reverse(), steps: [] };
}
const bansOf = (route, vehicle = SEMI) => routeBans(route, sensitiveRules(route, { vehicle, copy: COPY }).items, SECTIONS);

test('sens de la source et sens de marche', () => {
  assert.equal(oneWayOf('nord → sud'), 'south');
  assert.equal(oneWayOf('sud → nord'), 'north');
  assert.equal(oneWayOf('2 sens'), null);
  assert.equal(oneWayOf(null), null);
  const line = [[5, 46], [5, 45.9], [5, 45.8]];
  assert.equal(travelAt(line, 5000), 'south');
  assert.equal(travelAt([...line].reverse(), 5000), 'north');
  assert.equal(travelAt([[5, 46], [5.2, 46]], 5000), null); // est-ouest : illisible
  assert.deepEqual(pointAt(line, 0), [5, 46]);
  assert.equal(pointAt(null, 0), null);
});

test('N7 Vienne → Le Péage-de-Roussillon (nord → sud) : vers le sud oui, vers le nord non', () => {
  const south = bansOf(through('n7-vienne', 'south'));
  assert.deepEqual(south.map((b) => b.id), ['n7-vienne']);
  assert.equal(south[0].local, false);
  assert.match(south[0].text, /^Interdiction connue sur le trajet \(km \d+\) : N7, Vienne → Le Péage-de-Roussillon : > 3,5 t interdits\. En vigueur : à vérifier\. La signalisation fait foi\. Source : Bison Futé, arrêté non lu\.$/);
  assert.deepEqual(bansOf(through('n7-vienne', 'north')).map((b) => b.id), []);
});

test('transit (N59, N66, Le Puy) et desserte autorisée (RN524) : question « desserte locale » ; 3,5 t : rien', () => {
  for (const id of ['n59', 'n66', 'le-puy', 'rn524']) {
    const bans = bansOf(through(id));
    assert.deepEqual(bans.map((b) => b.id), [id], id);
    assert.equal(bans[0].local, true, id);
  }
  assert.match(bansOf(through('rn524'))[0].text, /Source : arrêté du préfet de la Gironde du 12\/11\/2013/);
  assert.deepEqual(bansOf(through('n59'), VAN), []); // > 3,5 t : un fourgon de 3,5 t n'est pas concerné
  assert.deepEqual(bansOf(through('le-puy'), { weight: 7.5, height: 3 }), []);
});

test('Lyon (rocade, v77) et hauteurs (PR D) exclues', () => {
  assert.ok(BANS.EXCLUDED.includes('lyon-a6') && BANS.EXCLUDED.includes('lyon-a7'));
  assert.deepEqual(bansOf(through('lyon-a7')).map((b) => b.id), []);
  assert.deepEqual(bansOf(through('mont-blanc'), { weight: 44, height: 4.8 }).map((b) => b.id), []);
});

test('réponses : Non par défaut ; Oui retire l\'interdiction (ligne « desserte déclarée ») ; confirmation', () => {
  const bans = bansOf(through('n59'));
  assert.deepEqual(localQuestions(bans, {}), [{ id: 'n59', label: 'N59 / N159, Lunéville → Sélestat (tunnel Maurice-Lemaire)', yes: false, text: 'Desserte locale dans la zone N59 / N159, Lunéville → Sélestat (tunnel Maurice-Lemaire) ?' }]);
  assert.equal(activeBans(bans, {}).length, 1);
  assert.equal(activeBans(bans, { n59: false }).length, 1);
  assert.equal(activeBans(bans, { n59: true }).length, 0);
  assert.equal(localQuestions(bans, { n59: true })[0].yes, true);
  assert.match(declaredText(bans[0]), /^Desserte locale déclarée dans la zone N59 .*Vérifie l'arrêté et la signalisation\. La signalisation fait foi\. Source : Bison Futé/);
  const n7 = bansOf(through('n7-vienne'));
  assert.equal(activeBans(n7, { 'n7-vienne': true }).length, 1, 'pas de desserte pour une interdiction simple');
  assert.equal(confirmText([...bans, ...n7]), 'Itinéraire par une interdiction connue (N59 / N159, Lunéville → Sélestat (tunnel Maurice-Lemaire) ; N7, Vienne → Le Péage-de-Roussillon). Aucune alternative trouvée. À vérifier. Démarrer quand même ?');
});

test('réponses gardées : identifiants courts, booléens seulement, 30 au plus', () => {
  assert.deepEqual(sanitizeAnswers({ n59: true, 'n7-vienne': false, 'X Y': true, n66: 'oui' }), { n59: true, 'n7-vienne': false });
  assert.deepEqual(sanitizeAnswers(null), {});
  assert.deepEqual(sanitizeAnswers([true]), {});
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`z${i}`, true]));
  assert.equal(Object.keys(sanitizeAnswers(many)).length, BANS.MAX_ANSWERS);
});

test('nom de zone et desserte possible', () => {
  assert.equal(zoneLabel({ texte: 'N66, Remiremont → Cernay : > 3,5 t en transit interdits' }), 'N66, Remiremont → Cernay');
  assert.equal(zoneLabel({ id: 'x' }), 'x');
  assert.equal(localPossible({ nature: 'transit', texte: '' }), true);
  assert.equal(localPossible({ nature: 'poids', texte: 'desserte locale autorisée' }), true);
  assert.equal(localPossible({ nature: 'interdit', texte: '> 3,5 t interdits' }), false);
});
