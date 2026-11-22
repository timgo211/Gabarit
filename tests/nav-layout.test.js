// Phase 2c : décisions d'affichage de l'écran de guidage (alertes, arrêt, caméra, boutons, vitesse, tracé parcouru).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  systemAlert, guidanceAlerts, splitAlerts, parkedState, followPadding, buttonColumn, speedStatus,
  traveledUpdate, traveledCoords, PARK, BUTTONS, areaListBox, AREA_LIST_BOX,
} from '../src/lib/nav-layout.js';
import { prepareLine } from '../src/lib/nav-geo.js';

const base = { onRoute: true, arrived: false, rules: {}, driving: null };

test('alerte système : mêmes textes qu\'avant, proposition de recalcul à l\'arrêt hors du tracé', () => {
  assert.equal(systemAlert(base), null);
  assert.match(systemAlert(base, { gpsLost: true }).text, /Signal GPS perdu/);
  assert.equal(systemAlert(base, { gpsLost: true, sim: true }), null);
  assert.match(systemAlert({ ...base, rerouting: true }).text, /recalcul en cours/);
  assert.match(systemAlert({ ...base, onRoute: false }, { error: 'quota' }).text, /Recalcul impossible : quota/);
  const off = systemAlert({ ...base, onRoute: false, offRouteStopped: true, canRequestReroute: true });
  assert.deepEqual([off.info, off.offer, off.canReroute], [true, true, true]);
  assert.equal(systemAlert({ ...base, arrived: true }, { gpsLost: true }), null);
});

test('ordre des alertes : système, tunnel, ZFE, accès, interdiction, conduite dépassée, frontière, vent, pause bientôt', () => {
  const view = {
    ...base,
    rules: {
      wind: { text: 'Rafales', distance: 100 }, border: { text: 'Suisse', distance: 5000 }, zfe: { text: 'ZFE', distance: 4000 },
      tunnel: { text: 'Tunnel', distance: 9000 }, access: { text: 'Desserte', distance: 3000 }, ban: { text: 'Interdiction', active: true },
    },
    driving: { level: 'soon', main: 'Pause dans 20 min', detail: 'Journée', canMarkWork: false, workLabel: 'x' },
  };
  const sys = systemAlert({ ...view, rerouting: true });
  assert.deepEqual(guidanceAlerts(view, sys).map((a) => a.key),
    ['system', 'tunnel', 'zfe', 'access', 'ban', 'border', 'wind', 'driving']);
  const over = guidanceAlerts({ ...view, driving: { ...view.driving, level: 'over', canMarkWork: true } });
  assert.deepEqual(over.map((a) => a.key), ['tunnel', 'zfe', 'access', 'ban', 'driving', 'border', 'wind']);
  assert.equal(over.find((a) => a.key === 'driving').work, true);
  // Temps de conduite normal : pas d'alerte (ligne du panneau déplié).
  assert.deepEqual(guidanceAlerts({ ...base, driving: { level: 'ok', main: 'Conduite 1 h' } }), []);
  const { shown, more } = splitAlerts(guidanceAlerts(view));
  assert.deepEqual([shown.length, more.length], [2, 5]);
});

test('à l\'arrêt : sous 5 km/h pendant 3 s', () => {
  let p = parkedState(null, 50, 0);
  assert.equal(p.parked, false);
  p = parkedState(p, 4, 1000);
  assert.equal(p.parked, false);
  p = parkedState(p, 0, 1000 + PARK.MS - 1);
  assert.equal(p.parked, false);
  p = parkedState(p, 0, 1000 + PARK.MS);
  assert.equal(p.parked, true);
  p = parkedState(p, 6, 5000);
  assert.equal(p.parked, false);
});

test('à l\'arrêt : vitesse inconnue (null, NaN, absente) = en mouvement, jamais à l\'arrêt (R412-6-2)', () => {
  for (const x of [null, NaN, undefined, Infinity, '0']) {
    let p = null;
    for (let t = 0; t <= 10_000; t += 1000) p = parkedState(p, x, t);
    assert.deepEqual(p, { since: null, parked: false }, String(x));
  }
  // Premier point sans vitesse : en mouvement.
  assert.equal(parkedState(null, null, 0).parked, false);
  // Vitesse perdue au milieu d'un arrêt : compteur remis à zéro, 3 s de nouveau.
  let p = parkedState(null, 0, 0);
  p = parkedState(p, 0, PARK.MS);
  assert.equal(p.parked, true);
  p = parkedState(p, null, PARK.MS + 1000);
  assert.equal(p.parked, false);
  p = parkedState(p, 0, PARK.MS + 2000);
  assert.equal(p.parked, false);
  p = parkedState(p, 0, 2 * PARK.MS + 2000);
  assert.equal(p.parked, true);
});

test('caméra : véhicule à 78 % de la hauteur en portrait, à droite de la colonne en paysage, écran seulement', () => {
  const p = followPadding({ width: 412, height: 900 });
  assert.equal(p.left, 0);
  assert.ok(Math.abs((p.top + 900) / 2 - 0.78 * 900) <= 1);
  const l = followPadding({ width: 900, height: 412 });
  assert.equal(l.left, 360);
  assert.ok(Math.abs((l.top + 412) / 2 - 0.75 * 412) <= 1);
  assert.deepEqual(followPadding({ width: 412, height: 900 }), p); // même taille, même marge
});

test('colonne de boutons : 64 px entre 45 et 85 %, remonte puis 56 px, deux colonnes en dernier', () => {
  const tall = buttonColumn({ height: 1280, count: 5 });
  assert.equal(tall.size, BUTTONS.size);
  assert.ok(tall.top >= 1280 * 0.45 && tall.top + 5 * 64 + 4 * 12 <= 1280 * 0.85 + 1);
  const phone = buttonColumn({ height: 760, minTop: 200, count: 5 });
  assert.ok(phone.size >= 56 && phone.top >= 200 && phone.columns === 1);
  const low = buttonColumn({ height: 360, minTop: 10, count: 6 });
  assert.equal(low.columns, 2);
  assert.ok(low.size >= 56);
});

test('vitesse : panneau seulement si la limite est connue, dépassement', () => {
  assert.deepEqual(speedStatus(87.4), { value: '87', limit: null, over: false });
  assert.deepEqual(speedStatus(95, 90), { value: '95', limit: 90, over: true });
  assert.equal(speedStatus(null).value, '—');
});

test('tracé parcouru : tous les 25 m en roulant, jamais à l\'arrêt', () => {
  assert.equal(traveledUpdate(null, 0, 0), true);
  assert.equal(traveledUpdate(100, 110, 50), false);
  assert.equal(traveledUpdate(100, 130, 50), true);
  assert.equal(traveledUpdate(100, 160, 1), false); // dérive du GPS à l'arrêt
  const line = prepareLine([[0, 0], [0.001, 0], [0.002, 0]]);
  assert.deepEqual(traveledCoords(line, 0), []);
  const c = traveledCoords(line, 150);
  assert.equal(c.length, 3);
  assert.ok(c[2][0] > 0.001 && c[2][0] < 0.002);
});

test('bandeau : badge et nom de rue, ou consigne entière avec une direction', async () => {
  const { bannerText } = await import('../src/lib/nav-layout.js');
  const a = bannerText({ text: 'Tournez à droite sur Route de Lyon, D 906', name: 'Route de Lyon, D 906' });
  assert.deepEqual([a.badges.map((b) => b.ref), a.text, a.long], [['D 906'], 'Route de Lyon', false]);
  const b = bannerText({ text: 'Prenez la sortie 34 en direction de Mâcon', name: 'A 6' });
  assert.deepEqual([b.badges, b.text], [[], 'Prenez la sortie 34 en direction de Mâcon']);
  const c = bannerText({ text: 'Continuez tout droit', name: '' });
  assert.equal(c.text, 'Continuez tout droit');
  assert.equal(bannerText(null).text, '');
});

test('liste des aires (phase 2d) : portrait au-dessus du compteur, 40 % au plus, jamais sur le bandeau', () => {
  // Téléphone 412 × 900 : pile du bandeau jusqu'à 260 px, colonne de boutons à 336 px, compteur à 700 px.
  const p = areaListBox({ width: 412, height: 900, stackBottom: 260, colLeft: 336, speedoTop: 700, sheetTop: 780 });
  assert.equal(p.left, AREA_LIST_BOX.inset);
  assert.equal(412 - p.right, 336 - 8, 'à gauche de la colonne de boutons');
  assert.equal(900 - p.bottom, 692, 'au-dessus du compteur');
  assert.equal(p.maxHeight, 360, '40 % de 900 px');
  assert.ok(p.top >= 260 + 8);
  // Bandeau haut (longue consigne, deux alertes) : la liste rapetisse, jamais au-dessus de la pile.
  const tall = areaListBox({ width: 412, height: 900, stackBottom: 520, colLeft: 336, speedoTop: 700, sheetTop: 780 });
  assert.equal(tall.top, 528);
  assert.equal(tall.maxHeight, 692 - 528);
  // Plus de place : hauteur nulle, jamais négative.
  assert.equal(areaListBox({ width: 412, height: 900, stackBottom: 720, colLeft: 336, speedoTop: 700, sheetTop: 780 }).maxHeight, 0);
});

test('liste des aires (phase 2d) : paysage dans la colonne de gauche, entre bandeau et panneau du bas', () => {
  const p = areaListBox({ width: 1280, height: 800, stackBottom: 220, colLeft: 1204, speedoTop: 700, sheetTop: 660, columnRight: 512 });
  assert.equal(p.left, 12);
  assert.equal(1280 - p.right, 512 - 12, 'même largeur que le bandeau');
  assert.equal(800 - p.bottom, 652, 'au-dessus du panneau du bas');
  assert.equal(p.top, 228);
  assert.equal(p.maxHeight, 652 - 228, 'pas de limite à 40 % en paysage');
});

test('liste des aires (phase 2d) : téléphone en paysage, colonne pleine → sur la carte, à droite de la colonne', () => {
  // 760 × 360 : bandeau et panneau du bas remplissent la colonne de gauche (304 px).
  const p = areaListBox({ width: 760, height: 360, stackBottom: 200, colLeft: 684, speedoTop: 280, sheetTop: 260, columnRight: 304 });
  assert.equal(p.inMap, true);
  assert.equal(p.left, 304 + 12, 'à droite de la colonne de gauche');
  assert.equal(760 - p.right, 684 - 8, 'à gauche des boutons');
  assert.equal(p.top, 12);
  assert.equal(360 - p.bottom, 280 - 8 - AREA_LIST_BOX.toastRoom, 'place du message au-dessus du compteur');
  assert.equal(p.toastBottom, 360 - 280 + 8);
  assert.ok(p.maxHeight >= 100);
  assert.equal(areaListBox({ width: 412, height: 900, stackBottom: 260, colLeft: 336, speedoTop: 700, sheetTop: 780 }).inMap, false);
});

