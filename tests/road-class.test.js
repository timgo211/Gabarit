// Phase 2g : classe de route (waycategory, waytype, référence de l'étape), part A/N, « Recommandé ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTE_PREF, ROAD_CLASS, parseRoadExtras, segmentClasses, roadStats, anShare, anShareText, pickRecommendedIndex,
  roadStatsText, classAt,
} from '../src/lib/road-class.js';
import { parseAllDirections } from '../src/lib/ors-response.js';
import { buildDirectionsRequest } from '../src/lib/ors-request.js';
import {
  computeRouteOptions, promoteRecommended, describeOption, AN_PREFERRED_NOTE, VARIANTS, guidanceParams,
} from '../src/lib/route-options.js';
import { routeDiagnosticText } from '../src/lib/route-diagnostic.js';
import { variantId, findVariantIndex } from '../src/lib/share.js';
import { defaultVehicle } from '../src/lib/vehicle.js';
import { fixture } from './helpers.js';

const BES = [6.0241, 47.2378];
const BEL = [6.8628, 47.6397];
const vehicle = defaultVehicle();
const alt = () => parseAllDirections(fixture('ors-directions-an-alternatives.json'));
const opts = (routes) => routes.map((route, i) => ({ key: i ? 'alternative' : 'recommended', label: i ? `Alternative ${i + 1}` : 'Recommandé', note: '', also: [], route, request: { preference: null, avoidTolls: false } }));

test('constantes : 15 % de durée, 30 % de km inconnus', () => {
  assert.equal(ROUTE_PREF.MAX_SLOWER_SHARE, 0.15);
  assert.equal(ROUTE_PREF.MAX_UNKNOWN_SHARE, 0.30);
});

test('requête : waycategory et waytype dans la même requête (aucune de plus)', () => {
  const req = buildDirectionsRequest({ start: BES, end: BEL, vehicle });
  assert.ok(req.body.extra_info.includes('waycategory'));
  assert.ok(req.body.extra_info.includes('waytype'));
});

test('classes : A par waycategory (même sans nom), N seulement avec waytype 1 et référence N, D en « primary » = autre', () => {
  const [f0, f1, f2] = alt();
  const s1 = roadStats(f1);
  assert.ok(s1.motorway > 50000, 'A 36 et bretelle sans nom comptées en autoroute');
  assert.ok(s1.national > 10000, 'N 1019');
  assert.ok(s1.unknown > 0 && s1.unknown < 3000, 'bretelle sans nom : km inconnus');
  // D 683 est « State Road » (primary) dans F0 : jamais une nationale.
  assert.equal(roadStats(f0).national, 0);
  assert.equal(anShare(f0), 0);
  const seg = segmentClasses(f2);
  assert.equal(seg.classes[0], ROAD_CLASS.NATIONAL, 'N 57 en State Road');
  assert.equal(classAt(f2, seg.classes.length - 1), ROAD_CLASS.OTHER, 'D 83 en primary : autre');
  assert.equal(classAt(f2, 9999), null);
  assert.equal(anShareText(f1), `Autoroute et nationale : ${Math.round(anShare(f1) * 100)} %`);
});

test('étapes sans nom : km inconnus > 30 % → part A/N inconnue ; un tronçon inconnu n\'est jamais une nationale', () => {
  const [g] = parseAllDirections(fixture('ors-directions-an-unnamed.json'));
  const s = roadStats(g);
  assert.ok(s.unknown / s.total > ROUTE_PREF.MAX_UNKNOWN_SHARE);
  assert.equal(s.share, null);
  assert.equal(anShare(g), null);
  assert.equal(anShareText(g), 'Autoroute et nationale : inconnue');
  assert.equal(s.national, 0, 'dernière étape sans nom en State Road : pas une nationale');
  assert.match(roadStatsText(g), /km inconnus \(étapes sans nom ni référence\) \d+,\d km ; part A\/N inconnue/);
  // Juste sous le seuil : part connue.
  const r = { ...g, steps: g.steps.map((st, i) => (i === 1 ? { ...st, name: 'A 36' } : st)) };
  const t = roadStats(r);
  assert.ok(t.unknown / t.total <= ROUTE_PREF.MAX_UNKNOWN_SHARE);
  assert.notEqual(t.share, null);
});

test('extras absents → inconnu, ordre d\'ORS gardé', () => {
  assert.equal(parseRoadExtras({ tollways: { values: [] } }), null);
  const [f0, f1] = alt();
  const bare = { ...f0, roadExtras: null };
  assert.equal(anShare(bare), null);
  assert.equal(pickRecommendedIndex(opts([bare, f1])), 0, 'part du premier inconnue : ordre gardé');
  assert.equal(pickRecommendedIndex(opts([f0, { ...f1, roadExtras: null }])), 0, 'part inconnue écartée');
  assert.equal(roadStatsText(bare), 'Classes de route (waycategory, waytype) : absentes');
});

test('seuil de durée : 14 % plus lent que le plus rapide → choisi ; 16 % → non', () => {
  const [f0, f1] = alt();
  const fast = { ...f0, duration: 3600 };
  assert.equal(pickRecommendedIndex(opts([fast, { ...f1, duration: 3600 * 1.14 }])), 1);
  assert.equal(pickRecommendedIndex(opts([fast, { ...f1, duration: 3600 * 1.16 }])), 0);
  assert.equal(pickRecommendedIndex(opts([fast, { ...f1, duration: 3600 * 1.15 }])), 1, '15 % pile : accepté');
});

test('égalité de part A/N → le plus rapide ; le premier peut perdre s\'il est hors délai', () => {
  const [f0] = alt();
  assert.equal(pickRecommendedIndex(opts([{ ...f0, duration: 4000 }, { ...f0, duration: 3900 }])), 1);
  assert.equal(pickRecommendedIndex(opts([{ ...f0, duration: 3900 }, { ...f0, duration: 3900 }])), 0, 'même durée : ordre');
});

test('Besançon → Belfort : l\'A 36 devient « Recommandé », la préférence d\'ORS reste proposée', async () => {
  const sent = [];
  const send = async (req) => { sent.push(req); return fixture('ors-directions-an-alternatives.json'); };
  const { options, requests } = await computeRouteOptions({ start: BES, end: BEL, vehicle, send });
  assert.equal(requests, 1, 'aucune requête de plus');
  assert.equal(sent.length, 1);
  assert.equal(options[0].label, 'Recommandé');
  assert.equal(options[0].promoted, true);
  assert.equal(options[0].key, 'alternative', 'clé et réglages de requête inchangés');
  assert.ok(options[0].route.duration < 3700, 'tracé A 36');
  assert.equal(options[1].label, 'Préférence ORS');
  assert.equal(options[1].key, VARIANTS.orsDefault.key);
  assert.ok(options[0].note.endsWith(AN_PREFERRED_NOTE));
  assert.match(AN_PREFERRED_NOTE, /la signalisation fait foi/);
  assert.ok(!/garanti|sûr|sans restriction/i.test(AN_PREFERRED_NOTE));
  const d = describeOption(options[1], options[0], { vehicle, now: new Date(2026, 10, 22, 8) });
  assert.equal(d.an, 'Autoroute et nationale : 0 %');
  assert.match(d.delta, /^\+/, 'écarts mesurés depuis le nouveau Recommandé');
  // Partage : le destinataire retrouve les mêmes rangs.
  assert.equal(variantId(options[0], 0), 'recommended');
  assert.equal(findVariantIndex(options, variantId(options[1], 1)), 1);
  // Recalcul en guidage : réglages de la requête d'origine.
  assert.equal(guidanceParams(options[0], { start: BES, end: BEL }).preference, null);
  const diag = routeDiagnosticText(options[0].route, { version: 'Gabarit v39' });
  assert.match(diag, /Classes de route : A \d+,\d km, N \d+,\d km, autre \d+,\d km ; km inconnus/);
});

test('promotion d\'une variante nommée : son nom passe en « aussi »', () => {
  const [f0, f1] = alt();
  const list = [
    { key: 'recommended', label: 'Recommandé', note: '', also: [], route: f0, request: { preference: null, avoidTolls: false } },
    { key: 'shortest', label: 'Plus court', note: 'Peut emprunter des routes secondaires', also: [], route: f1, request: { preference: 'shortest', avoidTolls: false } },
  ];
  const out = promoteRecommended(list);
  assert.equal(out[0].label, 'Recommandé');
  assert.deepEqual(out[0].also, ['Plus court']);
  assert.equal(out[0].request.preference, 'shortest', 'recalcul : préférence de la variante choisie');
  assert.ok(out[0].note.startsWith('Peut emprunter'));
  assert.equal(promoteRecommended([list[0]]).length, 1);
  assert.equal(promoteRecommended([list[1], list[0]])[0].key, 'shortest', 'déjà en tête : inchangé');
});
