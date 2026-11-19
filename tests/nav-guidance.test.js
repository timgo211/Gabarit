import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  announceDistances, stageToAnnounce, spokenDistance, announcementText, maneuverText, arrivedText, arrivalSide,
  maneuverIcon, pickFrenchVoice, buildManeuvers, nextManeuver, firstManeuverIndex, STEP_TYPES, UTURN_SAFE_TEXT,
} from '../src/lib/nav-guidance.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { prepareLine } from '../src/lib/nav-geo.js';
import { fixture } from './helpers.js';

const kmh = (v) => v / 3.6;

test('paliers d\'annonce camion : à 90 km/h ≈ 1,5 km, 500 m, 120 m', () => {
  const d = announceDistances(kmh(90));
  assert.equal(Math.round(d.far), 1500);
  assert.equal(Math.round(d.near), 500);
  assert.equal(Math.round(d.now), 120);
});

test('paliers proportionnels à la vitesse, bornés', () => {
  const d50 = announceDistances(kmh(50));
  assert.equal(Math.round(d50.far), 833);
  assert.equal(Math.round(d50.near), 278);
  assert.equal(Math.round(d50.now), 67);
  const d0 = announceDistances(0);
  assert.deepEqual(d0, { far: 400, near: 150, now: 30 });
  const d130 = announceDistances(kmh(130));
  assert.ok(d130.far <= 2500 && d130.near <= 800 && d130.now <= 200);
  assert.deepEqual(announceDistances(null), d0);
});

test('palier à annoncer : un seul par seuil, jamais en arrière', () => {
  const v = kmh(90);
  assert.equal(stageToAnnounce(1600, v), null);
  assert.equal(stageToAnnounce(1490, v), 'far');
  assert.equal(stageToAnnounce(1490, v, 'far'), null);
  assert.equal(stageToAnnounce(590, v, 'far'), null, 'trop près du palier « proche » : on attend');
  assert.equal(stageToAnnounce(480, v, 'far'), 'near');
  assert.equal(stageToAnnounce(140, v, 'far'), null, 'trop près du palier « maintenant »');
  assert.equal(stageToAnnounce(110, v, 'near'), 'now');
  assert.equal(stageToAnnounce(110, v, 'now'), null);
  assert.equal(stageToAnnounce(110, v), 'now', 'manœuvre découverte tard : directement « maintenant »');
});

test('arrivée : pas de palier « maintenant » (remplacé par « Destination atteinte »)', () => {
  assert.equal(stageToAnnounce(100, kmh(90), 'near', true), null);
  assert.equal(stageToAnnounce(130, kmh(90), 'far', true), 'near');
});

test('distances parlées', () => {
  assert.equal(spokenDistance(487), '500 mètres');
  assert.equal(spokenDistance(120), '100 mètres');
  assert.equal(spokenDistance(57), '60 mètres');
  assert.equal(spokenDistance(3), '10 mètres');
  assert.equal(spokenDistance(990), '1 kilomètre');
  assert.equal(spokenDistance(1480), '1,5 kilomètre');
  assert.equal(spokenDistance(2010), '2 kilomètres');
});

test('phrases : « Dans … », « maintenant », « puis … »', () => {
  const right = { type: STEP_TYPES.RIGHT, instruction: 'Tournez à droite sur D 306' };
  const left = { type: STEP_TYPES.LEFT, instruction: 'Tournez à gauche sur Rue de l’Industrie' };
  assert.equal(announcementText({ maneuver: right, stage: 'far', distance: 1490 }), 'Dans 1,5 kilomètre, tournez à droite sur D 306.');
  assert.equal(announcementText({ maneuver: right, stage: 'now', distance: 100 }), 'Tournez à droite sur D 306.');
  assert.equal(
    announcementText({ maneuver: left, stage: 'near', distance: 480, then: right, thenGap: 150 }),
    'Dans 500 mètres, tournez à gauche sur Rue de l’Industrie, puis tournez à droite sur D 306.',
  );
  assert.equal(
    announcementText({ maneuver: left, stage: 'far', distance: 1480, then: right, thenGap: 150 }),
    'Dans 1,5 kilomètre, tournez à gauche sur Rue de l’Industrie.', 'pas de « puis » si loin',
  );
  assert.equal(announcementText({ maneuver: left, stage: 'now', distance: 50, then: right, thenGap: 900 }), 'Tournez à gauche sur Rue de l’Industrie.');
});

test('arrivée : côté repris du texte ORS', () => {
  const goal = { type: STEP_TYPES.GOAL, instruction: 'Arrivé à votre destination, sur la droite' };
  assert.equal(arrivalSide(goal.instruction), 'sur la droite');
  assert.equal(maneuverText(goal), 'Vous arrivez à destination, sur la droite');
  assert.equal(arrivedText(goal), 'Destination atteinte, sur la droite.');
  assert.equal(arrivedText({ type: STEP_TYPES.GOAL, instruction: 'Arrivez à votre destination' }), 'Destination atteinte.');
  assert.equal(arrivedText(null), 'Destination atteinte.');
});

test('demi-tour : phrase prudente si demandé', () => {
  const u = { type: STEP_TYPES.UTURN, instruction: 'Faites un demi-tour sur D 306' };
  assert.equal(maneuverText(u), 'Faites un demi-tour sur D 306');
  assert.equal(maneuverText(u, { uturnSafe: true }), UTURN_SAFE_TEXT);
  assert.equal(UTURN_SAFE_TEXT, 'Faites demi-tour dès que possible, en sécurité');
});

test('pictogrammes des 14 types ORS', () => {
  assert.deepEqual(maneuverIcon(STEP_TYPES.RIGHT), { kind: 'arrow', angle: 90, exit: null });
  assert.deepEqual(maneuverIcon(STEP_TYPES.LEFT), { kind: 'arrow', angle: -90, exit: null });
  assert.equal(maneuverIcon(STEP_TYPES.SHARP_RIGHT).angle, 135);
  assert.equal(maneuverIcon(STEP_TYPES.SLIGHT_LEFT).angle, -45);
  assert.equal(maneuverIcon(STEP_TYPES.KEEP_RIGHT).angle, 30);
  assert.deepEqual(maneuverIcon(STEP_TYPES.ENTER_ROUNDABOUT, 2), { kind: 'roundabout', angle: 0, exit: 2 });
  assert.equal(maneuverIcon(STEP_TYPES.UTURN).kind, 'uturn');
  assert.equal(maneuverIcon(STEP_TYPES.GOAL).kind, 'goal');
  for (let t = 0; t <= 13; t += 1) assert.ok(['arrow', 'roundabout', 'uturn', 'goal'].includes(maneuverIcon(t).kind));
  assert.equal(maneuverIcon(99).angle, 0);
});

test('voix française : fr-FR locale d\'abord', () => {
  const voices = [
    { name: 'English', lang: 'en-US', localService: true, default: true },
    { name: 'Français (Canada)', lang: 'fr-CA', localService: true },
    { name: 'Google français', lang: 'fr-FR', localService: false },
    { name: 'Français (France)', lang: 'fr_FR', localService: true },
  ];
  assert.equal(pickFrenchVoice(voices).name, 'Français (France)');
  assert.equal(pickFrenchVoice(voices.slice(0, 2)).name, 'Français (Canada)');
  assert.equal(pickFrenchVoice([{ lang: 'de-DE' }]), null);
  assert.equal(pickFrenchVoice(undefined), null);
});

test('manœuvres d\'un itinéraire ORS réel (fixture)', () => {
  const route = parseDirections(fixture('ors-directions-nav.json'));
  const line = prepareLine(route.coordinates);
  const ms = buildManeuvers(route.steps, line.cum);
  assert.deepEqual(ms.map((m) => m.type), [11, 1, 7, 0, 1, 10]);
  assert.equal(ms[2].exitNumber, 2);
  assert.ok(Math.abs(ms[1].at - 2000) < 1);
  assert.equal(ms[5].at, line.total, 'arrivée au bout du tracé');
  assert.equal(firstManeuverIndex(ms), 1);

  const n = nextManeuver(ms, 100);
  assert.equal(n.index, 1);
  assert.ok(Math.abs(n.distance - 1900) < 1);
  const n2 = nextManeuver(ms, ms[3].at - 10);
  assert.equal(n2.index, 3);
  assert.equal(n2.then, 4);
  assert.ok(Math.abs(n2.thenGap - 150) < 1);
  assert.equal(nextManeuver(ms, line.total + 5).index, 5, 'au-delà : toujours l\'arrivée');
});

test('ancienne fixture (arrivée sur un tronçon) : manœuvre d\'arrivée au bout du tracé', () => {
  const route = parseDirections(fixture('ors-directions.json'));
  const line = prepareLine(route.coordinates);
  const ms = buildManeuvers(route.steps, line.cum);
  assert.equal(ms[ms.length - 1].at, line.total);
});

test('étapes sans way_points ignorées', () => {
  assert.deepEqual(buildManeuvers([{ instruction: 'x', wayPoints: null }], [0, 10]), []);
  assert.equal(nextManeuver([], 0), null);
});
