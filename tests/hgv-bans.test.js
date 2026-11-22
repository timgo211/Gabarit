// Phase 5 : jours fériés et interdictions PL des week-ends / jours fériés (arrêtés du 16 avril 2021 et du
// 26 décembre 2025), vérifiés avec le calendrier 2026 de la brochure Bison Futé « Véhicules lourds ».
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frenchHolidays, easterSunday, holidayName, dayKey } from '../src/lib/holidays.js';
import {
  dayBans, banWindows, bansAlongRoute, vehicleBanScope, describeBanConflict, banShortText, guidanceBan, prepareGuidanceBans,
  banAnnounceText, calendarKnown, HGV_BANS, CALENDAR_UNKNOWN_TEXT,
} from '../src/lib/hgv-bans.js';
import { roadRefs, sampleRoute } from '../src/lib/route-samples.js';

const D = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const semi = { name: 'Semi', weight: 44, critair: '5', banStatus: 'concerned' };

/** Plages d'une journée réunies, écrites comme la brochure : « 07-18 et 22-24 ». */
function slots(date, network) {
  const list = dayBans(date, network).sort((a, b) => a.from - b.from);
  const out = [];
  for (const b of list) {
    const last = out[out.length - 1];
    if (last && b.from <= last.to) last.to = Math.max(last.to, b.to);
    else out.push({ ...b });
  }
  return out.map((b) => `${String(b.from / 60).padStart(2, '0')}-${String(b.to / 60).padStart(2, '0')}`).join(' et ') || '-';
}

test('jours fériés 2026 (Code du travail L3133-1) : les 11 jours du calendrier Bison Futé', () => {
  assert.deepEqual(easterSunday(2026), [4, 5]);
  assert.deepEqual(easterSunday(2027), [3, 28]);
  assert.deepEqual([...frenchHolidays(2026).keys()], [
    '2026-01-01', '2026-04-06', '2026-05-01', '2026-05-08', '2026-05-14', '2026-05-25',
    '2026-07-14', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-25',
  ]);
  assert.equal(holidayName(D(2027, 5, 6)), 'Ascension');
  assert.equal(holidayName(D(2027, 5, 17)), 'Lundi de Pentecôte');
  assert.equal(holidayName(D(2026, 4, 5)), null, 'le dimanche de Pâques n\'est pas un jour férié légal');
  assert.equal(dayKey(D(2026, 3, 9)), '2026-03-09');
});

test('calendrier 2026 : mêmes plages que la brochure Bison Futé (France, Île-de-France, Auvergne-Rhône-Alpes)', () => {
  // [date, France entière, Paris > province, province > Paris, Auvergne-Rhône-Alpes] (brochure, page 2)
  const table = [
    [D(2026, 1, 1), '00-22', '00-24', '00-24', '00-22'],
    [D(2026, 1, 2), '-', '16-21', '06-10', '-'],
    [D(2026, 2, 7), '22-24', '10-18 et 22-24', '22-24', '07-18 et 22-24'],
    [D(2026, 3, 7), '22-24', '10-18 et 22-24', '22-24', '07-18 et 22-24'],
    [D(2026, 4, 5), '00-24', '00-24', '00-24', '00-24'],
    [D(2026, 4, 6), '00-22', '00-24', '00-24', '00-22'],
    [D(2026, 4, 7), '-', '-', '06-10', '-'],
    [D(2026, 4, 30), '22-24', '16-24', '22-24', '22-24'],
    [D(2026, 5, 2), '22-24', '10-18 et 22-24', '06-10 et 22-24', '22-24'],
    [D(2026, 5, 14), '00-22', '00-24', '00-24', '00-22'],
    [D(2026, 5, 23), '22-24', '10-18 et 22-24', '22-24', '22-24'],
    [D(2026, 5, 24), '00-24', '00-24', '00-24', '00-24'],
    [D(2026, 7, 11), '07-19', '07-19', '07-19', '07-19'],
    [D(2026, 7, 13), '22-24', '16-24', '06-10 et 22-24', '22-24'],
    [D(2026, 7, 14), '00-22', '00-24', '00-24', '00-22'],
    [D(2026, 8, 8), '07-19', '07-19', '07-19', '07-19'],
    [D(2026, 8, 14), '22-24', '16-24', '22-24', '22-24'],
    [D(2026, 8, 15), '00-24', '00-24', '00-24', '00-24'],
    [D(2026, 8, 16), '00-22', '00-24', '00-24', '00-22'],
    [D(2026, 10, 31), '22-24', '10-24', '22-24', '22-24'],
    [D(2026, 11, 2), '-', '-', '06-10', '-'],
    [D(2026, 12, 24), '22-24', '16-24', '22-24', '22-24'],
    // Samedi 26 décembre : la brochure n'écrit que « 06-10 » (province > Paris, lendemain de Noël) ; c'est aussi un
    // samedi ordinaire (art. 1er : 22 h – 24 h ; art. 3 : 10 h – 18 h vers la province).
    [D(2026, 12, 26), '22-24', '10-18 et 22-24', '06-10 et 22-24', '22-24'],
  ];
  for (const [date, fr, out, inn, aura] of table) {
    const k = dayKey(date);
    assert.equal(slots(date, 'france'), fr, `${k} France`);
    assert.equal(slots(date, 'idf-out'), out, `${k} Paris > province`);
    assert.equal(slots(date, 'idf-in'), inn, `${k} province > Paris`);
    assert.equal(slots(date, 'aura'), aura, `${k} Auvergne-Rhône-Alpes`);
  }
  // Écarts connus de la brochure, l'appli suit le texte de l'arrêté (art. 3 : « les samedis, de 10 heures à
  // 18 heures ») : samedi 4 avril (veille de Pâques, jour non férié) et samedi 9 mai.
  assert.equal(slots(D(2026, 4, 4), 'idf-out'), '10-18 et 22-24');
  // Un samedi ordinaire, un dimanche ordinaire.
  assert.equal(slots(D(2026, 11, 21), 'france'), '22-24');
  assert.equal(slots(D(2026, 11, 22), 'france'), '00-22');
  assert.equal(slots(D(2026, 11, 18), 'france'), '-');
});

test('fenêtres : samedi 22 h → dimanche 22 h ; week-end de Pâques samedi 22 h → lundi 22 h ; samedi d\'été 7 h – 19 h', () => {
  const w = banWindows(D(2026, 11, 20), D(2026, 11, 23));
  assert.equal(w.length, 1);
  assert.deepEqual([w[0].start, w[0].end], [D(2026, 11, 21, 22), D(2026, 11, 22, 22)]);
  const easter = banWindows(D(2026, 4, 3), D(2026, 4, 7));
  assert.deepEqual([easter[0].start, easter[0].end], [D(2026, 4, 4, 22), D(2026, 4, 6, 22)]);
  const summer = banWindows(D(2026, 7, 10), D(2026, 7, 13));
  assert.deepEqual(summer.map((x) => [x.start, x.end, x.kind]), [
    [D(2026, 7, 11, 7), D(2026, 7, 11, 19), 'summer'],
    [D(2026, 7, 12, 0), D(2026, 7, 12, 22), 'general'],
    [D(2026, 7, 13, 22), D(2026, 7, 14, 22), 'general'],
  ]);
  assert.ok(calendarKnown(2026));
  assert.ok(!calendarKnown(2027));
});

test('véhicules concernés : plus de 7,5 t ; article 4 → Île-de-France seulement ; spécialisé ou agricole → aucune', () => {
  assert.deepEqual(vehicleBanScope(semi), { general: true, idf: true });
  assert.deepEqual(vehicleBanScope({ ...semi, weight: 7.5 }), { general: false, idf: false }, '« plus de 7,5 tonnes »');
  assert.deepEqual(vehicleBanScope({ ...semi, banStatus: 'art4' }), { general: false, idf: true });
  assert.deepEqual(vehicleBanScope({ ...semi, banStatus: 'exempt' }), { general: false, idf: false });
  assert.deepEqual(vehicleBanScope({ weight: 19 }), { general: true, idf: true }, 'profil ancien sans le champ');
});

test('références de route des étapes ORS', () => {
  assert.deepEqual(roadRefs('A 6a, E 15'), ['A6A', 'E15']);
  assert.deepEqual(roadRefs('RD 1084'), ['D1084']);
  assert.deepEqual(roadRefs('Route de Lyon, D 306'), ['D306']);
  assert.deepEqual(roadRefs('N 90'), ['N90']);
  assert.deepEqual(roadRefs('Avenue des Frères Lumière'), []);
  assert.deepEqual(roadRefs('Rue du 8 Mai'), []);
});

/** Itinéraire en ligne droite, étapes nommées, vitesse constante. */
function line(from, to, { km, hours, names = ['A 6'] }) {
  const n = 60;
  const coords = Array.from({ length: n + 1 }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n]);
  const per = Math.ceil(n / names.length);
  const steps = names.map((name, k) => ({
    name, wayPoints: [k * per, Math.min(n, (k + 1) * per)], duration: (hours * 3600) / names.length, distance: (km * 1000) / names.length,
  }));
  return { coordinates: coords, steps, duration: hours * 3600, distance: km * 1000 };
}

test('itinéraire : départ samedi 20 h, 4 h de route → interdiction samedi 22 h vers le km 100', () => {
  // Dijon → Mâcon (A 31 / A 6), ≈ 200 km, 4 h (vitesse fictive, pour la date).
  const route = line([5.04, 47.32], [4.83, 46.31], { km: 200, hours: 4, names: ['A 31', 'A 6'] });
  const r = bansAlongRoute(route, { vehicle: semi, departure: D(2026, 11, 21, 20) });
  assert.equal(r.applies, true);
  assert.equal(r.conflicts.length, 1);
  const c = r.conflicts[0];
  assert.equal(c.kind, 'general');
  assert.deepEqual([c.start, c.end], [D(2026, 11, 21, 22), D(2026, 11, 22, 22)]);
  const half = sampleRoute(route, 1000).at(-1).along / 2;
  assert.ok(Math.abs(c.along - half) < 1000, `vers la moitié du trajet (${c.along})`);
  assert.match(describeBanConflict(c), /^Interdiction PL samedi 22 h → dimanche 22 h : vous y seriez vers km \d+ \(samedi 22 h(?: 0\d)?\)\.$/);
  // Même trajet en semaine, ou par un véhicule non concerné : rien.
  assert.equal(bansAlongRoute(route, { vehicle: semi, departure: D(2026, 11, 18, 20) }).conflicts.length, 0);
  const light = bansAlongRoute(route, { vehicle: { ...semi, weight: 7.2 }, departure: D(2026, 11, 21, 20) });
  assert.deepEqual([light.applies, light.conflicts.length], [false, 0]);
  // Hors de France (Allemagne) : les règles françaises ne s'appliquent pas.
  const de = line([8.4, 49.0], [9.2, 48.8], { km: 70, hours: 1 });
  assert.equal(bansAlongRoute(de, { vehicle: semi, departure: D(2026, 11, 21, 21, 30) }).conflicts.length, 0);
});

test('Île-de-France (art. 3) : vendredi 17 h sur l\'A 6 vers la province ; un véhicule de l\'article 4 aussi', () => {
  // Paris (porte d'Orléans) → Lisses sur l'A 6, 30 km, 30 min.
  const route = line([2.326, 48.82], [2.43, 48.6], { km: 30, hours: 0.5, names: ['A 6a', 'A 6'] });
  const friday = D(2026, 11, 20, 17);
  const r = bansAlongRoute(route, { vehicle: semi, departure: friday });
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].kind, 'idf');
  assert.equal(r.conflicts[0].approximate, true);
  assert.match(describeBanConflict(r.conflicts[0]), /Île-de-France .* vendredi 16 h → vendredi 21 h .* Section et sens à vérifier/);
  const art4 = bansAlongRoute(route, { vehicle: { ...semi, banStatus: 'art4' }, departure: friday });
  assert.equal(art4.conflicts.length, 1, 'l\'article 4 ne s\'applique pas à l\'article 3');
  // Sens province → Paris un vendredi soir : autorisé.
  const back = line([2.43, 48.6], [2.326, 48.82], { km: 30, hours: 0.5, names: ['A 6', 'A 6a'] });
  assert.equal(bansAlongRoute(back, { vehicle: semi, departure: friday }).conflicts.length, 0);
  // Véhicule de l'article 4 un samedi 23 h vers la province : l'art. 1er ne le concerne pas, l'art. 3 non plus à cette heure.
  assert.equal(bansAlongRoute(route, { vehicle: { ...semi, banStatus: 'art4' }, departure: D(2026, 11, 21, 23) }).conflicts.length, 0);
});

test('Auvergne-Rhône-Alpes : samedi d\'hiver 2026 sur l\'A 43 (approximatif), pas sur une autre route', () => {
  const a43 = line([5.2, 45.6], [5.9, 45.57], { km: 60, hours: 1, names: ['A 43'] });
  const r = bansAlongRoute(a43, { vehicle: semi, departure: D(2026, 2, 7, 9) });
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].kind, 'winter');
  assert.deepEqual([r.conflicts[0].start, r.conflicts[0].end], [D(2026, 2, 7, 7), D(2026, 2, 7, 18)]);
  const other = line([5.2, 45.6], [5.9, 45.57], { km: 60, hours: 1, names: ['D 520'] });
  assert.equal(bansAlongRoute(other, { vehicle: semi, departure: D(2026, 2, 7, 9) }).conflicts.length, 0);
  assert.equal(bansAlongRoute(a43, { vehicle: semi, departure: D(2027, 2, 6, 9) }).calendarKnown, false);
  assert.match(CALENDAR_UNKNOWN_TEXT, /bison-fute\.gouv\.fr/);
});

test('guidage : annonces 60 puis 15 min avant 22 h si l\'arrivée est après, bandeau, aucune si on arrive avant', () => {
  const bans = prepareGuidanceBans(semi, D(2026, 11, 21, 20).getTime());
  assert.ok(bans.windows.length >= 1);
  const lyon = [4.85, 45.75];
  let st = bans;
  const at = (h, m, arrivalH) => {
    const r = guidanceBan(st, { now: D(2026, 11, 21, h, m).getTime(), arrival: D(2026, 11, 21, arrivalH).getTime(), lonlat: lyon });
    st = { ...st, announced: r.announced };
    return r;
  };
  assert.deepEqual(at(20, 30, 23).speak, null, '1 h 30 avant : rien');
  const h1 = at(21, 0, 23);
  assert.equal(h1.speak, 'Interdiction poids lourds à partir de 22 heures, dans une heure. Pensez à vous garer.');
  assert.equal(h1.view.minutes, 60);
  assert.equal(at(21, 1, 23).speak, null, 'une seule fois');
  assert.equal(at(21, 45, 23).speak, 'Interdiction poids lourds à partir de 22 heures, dans 15 minutes. Pensez à vous garer.');
  const inside = at(22, 10, 23);
  assert.equal(inside.view.active, true);
  assert.match(inside.speak, /en cours jusqu'à dimanche 22 heures/);
  // Arrivée prévue avant 22 h : aucune annonce.
  const early = guidanceBan(prepareGuidanceBans(semi, D(2026, 11, 21, 21).getTime()), {
    now: D(2026, 11, 21, 21, 10).getTime(), arrival: D(2026, 11, 21, 21, 50).getTime(), lonlat: lyon,
  });
  assert.deepEqual([early.view, early.speak], [null, null]);
  // Guidage démarré à 21 h 50 : seule l'annonce « 15 minutes » (pas « une heure »).
  const late = guidanceBan(prepareGuidanceBans(semi, D(2026, 11, 21, 21, 50).getTime()), {
    now: D(2026, 11, 21, 21, 50).getTime(), arrival: D(2026, 11, 21, 23).getTime(), lonlat: lyon,
  });
  assert.match(late.speak, /dans 15 minutes/);
  // Hors de France : rien.
  assert.equal(guidanceBan(bans, { now: D(2026, 11, 21, 21).getTime(), arrival: D(2026, 11, 22, 1).getTime(), lonlat: [8.5, 49] }).view, null);
  assert.deepEqual(prepareGuidanceBans({ ...semi, weight: 3.5 }, Date.now()).windows, []);
  assert.equal(banAnnounceText({ start: D(2026, 7, 11, 7) }, 60), 'Interdiction poids lourds à partir de 7 heures, dans une heure. Pensez à vous garer.');
  assert.deepEqual(HGV_BANS.ANNOUNCE_MIN, [60, 15]);
});

test('points du tracé : heure de passage croissante et route de l\'étape', () => {
  const route = line([5.04, 47.32], [4.83, 46.31], { km: 200, hours: 4, names: ['A 31', 'A 6'] });
  const s = sampleRoute(route, 1000);
  assert.ok(s.length > 100);
  assert.equal(s[0].time, 0);
  assert.ok(Math.abs(s[s.length - 1].time - 4 * 3600) < 1);
  assert.deepEqual(s[0].roads, ['A31']);
  assert.deepEqual(s[s.length - 1].roads, ['A6']);
  for (let i = 1; i < s.length; i += 1) assert.ok(s[i].time >= s[i - 1].time);
});

test('fiche d\'itinéraire (phase 2e) : « à partir de » avant l\'interdiction, « en cours jusqu\'à » pendant', () => {
  const c = { start: D(2026, 11, 21, 22), end: D(2026, 11, 22, 22) };
  assert.equal(banShortText(c, D(2026, 11, 21, 18)), 'Interdiction PL à partir de samedi 22 h');
  assert.equal(banShortText(c, D(2026, 11, 22, 9)), 'Interdiction PL en cours jusqu\'à dimanche 22 h');
  assert.equal(banShortText(c, D(2026, 11, 21, 22)), 'Interdiction PL en cours jusqu\'à dimanche 22 h');
  // Trajet calculé : départ samedi 20 h, 4 h de route → commence avant, finit pendant → « à partir de ».
  const route = line([5.04, 47.32], [4.83, 46.31], { km: 200, hours: 4, names: ['A 31', 'A 6'] });
  const before = bansAlongRoute(route, { vehicle: semi, departure: D(2026, 11, 21, 20) }).conflicts[0];
  assert.equal(banShortText(before, D(2026, 11, 21, 20)), 'Interdiction PL à partir de samedi 22 h');
  // Départ choisi dimanche 9 h, pendant l'interdiction.
  const during = bansAlongRoute(route, { vehicle: semi, departure: D(2026, 11, 22, 9) }).conflicts[0];
  assert.equal(banShortText(during, D(2026, 11, 22, 9)), 'Interdiction PL en cours jusqu\'à dimanche 22 h');
});
