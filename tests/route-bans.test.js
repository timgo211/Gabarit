// v78 : interdictions connues sur le trajet (route-bans.js). Copie réelle des points sensibles du dépôt
// (data/points-sensibles/) ; itinéraires de test tracés par les points d'une section (aucune API appelée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  sensitiveRules, parseSensitiveTile, mergeSensitiveTiles, parseSensitiveSections, SENSITIVE,
} from '../src/lib/sensitive-points.js';

const SENSITIVE_LOW = SENSITIVE.TYPES.LOW;
import {
  BANS, routeBans, activeBans, localQuestions, declaredText, confirmText, sanitizeAnswers, oneWayOf, travelAt, zoneLabel,
  localPossible, pointAt, sectionTitle, sectionRule, widenRange, rangeText, avoidingBansText, rangeCoords,
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
const bansOf = (route, vehicle = SEMI) => routeBans(route, sensitiveRules(route, { vehicle, copy: COPY }).items, SECTIONS, { vehicle });

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
  assert.match(south[0].text, /^N7 \(Vienne – Le Péage-de-Roussillon\) : interdite aux plus de 3,5 t \(sens nord → sud\) · km \d+( à \d+)? · Source : Bison Futé, arrêté non lu · À vérifier\. La signalisation fait foi\.$/);
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

test('Lyon (rocade, v77) exclue', () => {
  assert.ok(BANS.EXCLUDED.includes('lyon-a6') && BANS.EXCLUDED.includes('lyon-a7'));
  assert.deepEqual(bansOf(through('lyon-a7')).map((b) => b.id), []);
});

test('v80 : hauteurs des tunnels (arrêtés) seulement au-dessus de la valeur, hauteur connue ; hauteurs basses OSM jamais', () => {
  const mb = bansOf(through('mont-blanc'), { weight: 44, height: 4.8 });
  assert.deepEqual(mb.map((b) => [b.id, b.local]), [['mont-blanc', false]]);
  assert.match(mb[0].text, /hauteur maximale 4,70 m.*Source : arrêté DDT-2020-0825/);
  assert.deepEqual(bansOf(through('mont-blanc'), { weight: 44, height: 4.7 }).map((b) => b.id), [], '4,70 m passe');
  assert.deepEqual(bansOf(through('mont-blanc'), { weight: 44, height: null }).map((b) => b.id), [], 'hauteur inconnue');
  assert.deepEqual(bansOf(through('frejus'), { weight: 44, height: 4.5 }).map((b) => b.id), ['frejus']);
  assert.deepEqual(bansOf(through('frejus'), { weight: 44, height: 4 }).map((b) => b.id), []);
  const route = through('mont-blanc');
  assert.deepEqual(routeBans(route, sensitiveRules(route, { vehicle: { height: 4.8 }, copy: COPY }).items, SECTIONS).map((b) => b.id), [], 'sans profil : rien');
  const low = { type: SENSITIVE_LOW, section: -1, along: 100, value: 2, ref: 'A86' };
  assert.deepEqual(routeBans({ coordinates: [[2, 48], [2, 49]] }, [low], SECTIONS, { vehicle: SEMI }), [], 'hauteur basse ponctuelle : jamais');
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

// ───────── v81 : une ligne par section, plage km, plages « Accès PL limité » réunies ─────────

test('v81 : titre et règle de chaque section (texte de la source)', () => {
  const by = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
  const want = {
    'lyon-a6': ['A6 (échangeur A89/A6 – échangeur de la Garde)', 'interdite aux transports de marchandises de plus de 7,5 t, sauf desserte locale'],
    'lyon-a7': ['A7 (Saint-Fons – Ternay)', 'interdite aux plus de 7,5 t'],
    'n7-vienne': ['N7 (Vienne – Le Péage-de-Roussillon)', 'interdite aux plus de 3,5 t (sens nord → sud)'],
    n59: ['N59 / N159 (Lunéville – Sélestat)', 'interdite aux plus de 3,5 t en transit'],
    n66: ['N66 (Remiremont – Cernay)', 'interdite aux plus de 3,5 t en transit'],
    'mont-blanc': ['N205 (tunnel du Mont-Blanc)', 'hauteur maximale 4,70 m'],
    rn524: ['RN524 (Langon – Captieux)', 'interdite aux transports de marchandises de plus de 7,5 t, sauf desserte locale'],
    frejus: ['N543 (tunnel du Fréjus)', 'hauteur maximale 4,30 m'],
    'le-puy': ['N88 / N102 (traversée du Puy-en-Velay)', 'interdite aux plus de 7,5 t en transit'],
  };
  for (const [id, [title, rule]] of Object.entries(want)) {
    assert.equal(sectionTitle(by[id]), title, id);
    assert.equal(sectionRule(by[id]), rule, id);
  }
  assert.equal(sectionRule({ texte: 'X : règle inconnue', nature: 'autre' }), 'règle inconnue');
  assert.equal(rangeText({ from: 39200, to: 110400 }), 'km 39 à 110');
  assert.equal(rangeText({ from: 39200, to: 39400 }), 'km 39');
});

test('v81 : plage = points de la copie ∪ plages « Accès PL limité » actives proches (5 km, de proche en proche)', () => {
  const pl = (enter, exit, state = 'local') => ({ enter, exit, state });
  const list = [pl(39000, 47000), pl(52000, 53000), pl(57000, 75000), pl(78000, 93000), pl(120000, 121000), pl(60000, 61000, 'ok')];
  const w = widenRange({ from: 69000, to: 110000 }, list);
  assert.deepEqual([w.from, w.to], [39000, 110000]);
  assert.equal(w.plages.length, 4, 'plage hors tranche et plage à 10 km écartées');
  assert.deepEqual(widenRange({ from: 69000, to: 69000 }, []), { from: 69000, to: 69000, plages: [] });
});

test('v81 : N59 avec les plages OSM : une ligne, plage km élargie, plages gardées pour la fiche et le détour', () => {
  const route = through('n59');
  const items = sensitiveRules(route, { vehicle: SEMI, copy: COPY }).items;
  const plain = routeBans(route, items, SECTIONS, { vehicle: SEMI, copy: COPY });
  assert.ok(plain[0].span && plain[0].span.to > plain[0].span.from);
  const plages = [{ enter: 0, exit: plain[0].span.from - 3000, state: 'local' }];
  const [b] = routeBans(route, items, SECTIONS, { vehicle: SEMI, copy: COPY, plages });
  assert.equal(b.range.from, 0);
  assert.equal(b.range.to, plain[0].span.to);
  assert.equal(b.plages.length, 1);
  assert.match(b.text, /^N59 \/ N159 \(Lunéville – Sélestat\) : interdite aux plus de 3,5 t en transit · km 0 à \d+ · Source : Bison Futé, arrêté non lu · À vérifier\. La signalisation fait foi\.$/);
  assert.match(b.short, /^N59 \/ N159 \(Lunéville – Sélestat\) : interdite aux plus de 3,5 t en transit · km 0–\d+$/);
  assert.equal(b.source, 'Source : Bison Futé, arrêté non lu.');
  const seg = rangeCoords(route.coordinates, b.range.from, b.range.to);
  assert.ok(seg.length >= 2);
  assert.deepEqual(rangeCoords(route.coordinates, 10, 5), []);
});

test('v81 : fiche rouge : autre fiche sans interdiction indiquée (jamais promue), sinon rien', () => {
  const ban = { title: 'N59 / N159 (Lunéville – Sélestat)' };
  const cards = [
    { label: 'Recommandé', blocked: true, bans: [ban], clean: true, duration: 8520, distance: 153000 },
    { label: 'Plus court', blocked: false, bans: [], clean: true, duration: 12180, distance: 134000 },
    { label: 'Sans péage', blocked: true, bans: [ban], clean: true, duration: 9000, distance: 156000 },
  ];
  assert.equal(avoidingBansText(cards, 0), 'Plus court évite N59 / N159 (Lunéville – Sélestat) : +1 h 01, −19 km. Touche la fiche pour la choisir. À vérifier, la signalisation fait foi.');
  assert.match(avoidingBansText(cards, 2), /^Plus court évite/);
  assert.equal(avoidingBansText(cards, 1), '', 'fiche non rouge : rien');
  assert.equal(avoidingBansText([cards[0], { ...cards[1], clean: false }], 0), '', 'autre fiche avec une ZFE interdite : rien');
});
