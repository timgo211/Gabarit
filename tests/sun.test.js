// Phase 2c : lever et coucher du soleil (algorithme NOAA), mode nuit automatique.
// Valeurs de référence : calculateur solaire NOAA (gml.noaa.gov/grad/solcalc), heures UTC, à ± 3 min.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunTimes, isNight } from '../src/lib/sun.js';
import { resolveTheme } from '../src/lib/theme.js';

const hm = (t) => new Date(t).toISOString().slice(11, 16);
const near = (t, expected, label) => {
  const [h, m] = expected.split(':').map(Number);
  const d = new Date(t);
  const diff = Math.abs(d.getUTCHours() * 60 + d.getUTCMinutes() - (h * 60 + m));
  assert.ok(diff <= 3, `${label} : ${hm(t)} au lieu de ${expected}`);
};
const PARIS = [2.3522, 48.8566];
const STRASBOURG = [7.7521, 48.5734];

test('Paris, solstices et équinoxe', () => {
  let s = sunTimes(new Date('2026-06-21T12:00:00Z'), PARIS[1], PARIS[0]);
  near(s.sunrise, '03:47', 'lever 21 juin'); near(s.sunset, '19:58', 'coucher 21 juin');
  s = sunTimes(new Date('2026-12-21T12:00:00Z'), PARIS[1], PARIS[0]);
  near(s.sunrise, '07:41', 'lever 21 décembre'); near(s.sunset, '15:56', 'coucher 21 décembre');
  s = sunTimes(new Date('2026-03-20T12:00:00Z'), PARIS[1], PARIS[0]);
  near(s.sunrise, '05:55', 'lever 20 mars'); near(s.sunset, '18:02', 'coucher 20 mars');
});

test('Strasbourg en hiver, et le même jour solaire tard le soir', () => {
  const s = sunTimes(new Date('2026-12-21T12:00:00Z'), STRASBOURG[1], STRASBOURG[0]);
  near(s.sunrise, '07:17', 'lever'); near(s.sunset, '15:36', 'coucher');
  const late = sunTimes(new Date('2026-12-21T23:30:00Z'), STRASBOURG[1], STRASBOURG[0]);
  assert.equal(hm(late.sunset), hm(s.sunset));
});

test('jour et nuit polaires (Tromsø)', () => {
  assert.equal(sunTimes(new Date('2026-06-21T12:00:00Z'), 69.65, 18.96).polar, 'day');
  assert.equal(sunTimes(new Date('2026-12-21T12:00:00Z'), 69.65, 18.96).polar, 'night');
  assert.equal(isNight(new Date('2026-06-21T23:00:00Z'), [18.96, 69.65]), false);
  assert.equal(isNight(new Date('2026-12-21T12:00:00Z'), [18.96, 69.65]), true);
});

test('nuit entre coucher et lever, position inconnue → null', () => {
  assert.equal(isNight(new Date('2026-12-21T16:30:00Z'), PARIS), true); // 17 h 30 à Paris : nuit
  assert.equal(isNight(new Date('2026-06-21T18:30:00Z'), PARIS), false); // 20 h 30 en juin : encore jour
  assert.equal(isNight(new Date('2026-06-21T03:00:00Z'), PARIS), true);
  assert.equal(isNight(new Date(), null), null);
  assert.equal(isNight(new Date(), [NaN, 1]), null);
  assert.equal(isNight(new Date(), [500, 1]), null);
});

test('thème auto : soleil à la position, sinon 20 h – 7 h ; le choix manuel l\'emporte', () => {
  const winterEvening = new Date('2026-12-21T16:30:00Z');
  assert.equal(resolveTheme('auto', winterEvening, PARIS), 'night');
  assert.equal(resolveTheme('day', winterEvening, PARIS), 'day');
  const summerEvening = new Date('2026-06-21T18:30:00Z');
  assert.equal(resolveTheme('auto', summerEvening, PARIS), 'day');
  assert.equal(resolveTheme('night', summerEvening, PARIS), 'night');
  const noon = new Date(2026, 5, 21, 12, 0);
  const late = new Date(2026, 5, 21, 22, 0);
  assert.equal(resolveTheme('auto', noon, null), 'day');
  assert.equal(resolveTheme('auto', late, null), 'night');
});
