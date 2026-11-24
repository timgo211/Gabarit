// Phase 6 (v56) : historique des trajets terminés (src/lib/trip-history.js, IndexedDB src/ui/trip-history.js) et
// notes perso sur les aires (src/lib/area-notes.js). Aucun réseau, faux IndexedDB.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HISTORY, buildTrip, sanitizeHistory, addToHistory, mergeHistory, monthlyStats, describeTrip, monthText, safeLabel,
} from '../src/lib/trip-history.js';
import { NOTE_CHOICES, AREA_NOTES, sanitizeAreaNotes, noteFor, setAreaNote, noteShort } from '../src/lib/area-notes.js';
import { createHistoryStore } from '../src/ui/trip-history.js';
import { startNavigation, updateNavigation, rerouteDone } from '../src/lib/navigation.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { createSimulator } from '../src/lib/nav-sim.js';
import { exportData, readExport, emptyData } from '../src/lib/store.js';
import { fixture } from './helpers.js';

const T0 = Date.UTC(2026, 10, 23, 7, 0, 0);
const trip = (over = {}) => buildTrip({
  startedAt: T0, arrivedAt: T0 + 2 * 3600e3 + 5 * 60e3, from: 'Dépôt de Metz', to: 'Client Nancy',
  stops: [{ label: 'Quai 4' }], drivenM: 123456, profile: 'Semi 44 t', ...over,
});

test('trajet : champs gardés, aucune coordonnée, jamais en simulation', () => {
  const t = trip();
  assert.deepEqual(Object.keys(t).sort(), ['date', 'duration', 'from', 'id', 'km', 'profile', 'stops', 'to']);
  assert.equal(t.km, 123.5);
  assert.equal(t.duration, 2 * 3600 + 5 * 60);
  assert.deepEqual(t.stops, ['Quai 4']);
  assert.equal(t.date, new Date(T0).toISOString());
  assert.equal(buildTrip({ ...trip(), startedAt: T0, arrivedAt: T0 + 1000, simulating: true }), null);
  assert.equal(buildTrip({ startedAt: T0, arrivedAt: T0 - 1 }), null);
  // Point choisi par appui long : le libellé est un couple de coordonnées, jamais gardé tel quel.
  const c = trip({ from: '48,69210, 6,18440', stops: [{ label: '48.1, 6.2' }] });
  assert.equal(c.from, HISTORY.MAP_POINT);
  assert.deepEqual(c.stops, [HISTORY.MAP_POINT]);
  assert.equal(safeLabel('Metz'), 'Metz');
  assert.doesNotMatch(JSON.stringify(c), /48[.,]6|6[.,]18/);
  assert.equal(HISTORY.PRIVACY_TEXT, "Gardé seulement sur cet appareil. Inclus dans l'export.");
});

test('liste : triée, sans doublon, 1 000 au plus, champs inconnus ou coordonnées retirés', () => {
  const a = trip();
  const b = trip({ startedAt: T0 + 86400e3, arrivedAt: T0 + 86400e3 + 3600e3, seq: 1 });
  const list = sanitizeHistory([a, b, a, { ...a, id: 'x', lon: 6.1, lat: 48.6, track: [[6, 48]] }, { id: 'bad' }]);
  assert.deepEqual(list.map((t) => t.id), [b.id, 'x', a.id]);
  assert.equal(list[1].lon, undefined);
  assert.equal(list[1].track, undefined);
  const many = Array.from({ length: 1005 }, (_, i) => trip({ startedAt: T0 + i * 1000, arrivedAt: T0 + i * 1000 + 60e3, seq: i }));
  const kept = sanitizeHistory(many);
  assert.equal(kept.length, HISTORY.MAX);
  assert.equal(kept.at(-1).id, many[5].id, 'les plus anciens retirés');
  assert.equal(addToHistory([a], b)[0].id, b.id);
  assert.deepEqual(mergeHistory([a], [a, b]).map((t) => t.id), [b.id, a.id]);
});

test('statistiques par mois : trajets, km, durée', () => {
  const nov = trip();
  const nov2 = trip({ startedAt: T0 + 3 * 86400e3, arrivedAt: T0 + 3 * 86400e3 + 3600e3, drivenM: 76544, seq: 2 });
  const dec = trip({ startedAt: Date.UTC(2026, 11, 2, 9), arrivedAt: Date.UTC(2026, 11, 2, 10), drivenM: 50000, seq: 3 });
  const stats = monthlyStats([nov, dec, nov2]);
  assert.deepEqual(stats.map((m) => [m.month, m.trips, m.km]), [['2026-12', 1, 50], ['2026-11', 2, 200]]);
  assert.equal(stats[1].duration, nov.duration + nov2.duration);
  assert.equal(monthText(stats[1]), 'novembre 2026 : 2 trajets · 200 km · 3 h 05');
  const d = describeTrip(nov);
  assert.equal(d.route, 'Dépôt de Metz → Client Nancy');
  assert.equal(d.stops, 'par Quai 4');
  assert.equal(d.km, '124 km', 'au-delà de 100 km : arrondi au km');
  assert.equal(d.duration, '2 h 05');
});

test('guidage : km parcourus sur le tracé, recalculs compris', () => {
  const route = parseDirections(fixture('ors-directions-nav.json'));
  let s = startNavigation(route, { now: T0 });
  const sim = createSimulator(route.coordinates, { speedKmh: 50 });
  for (let k = 0; k <= 60; k += 1) s = updateNavigation(s, sim.next(T0 + k * 1000)).state;
  const before = s.along;
  assert.ok(before > 500);
  s = rerouteDone(s, route).state;
  assert.ok(Math.abs(s.drivenBefore - before) < 1e-6, 'distance faite avant le recalcul gardée');
  const sim2 = createSimulator(route.coordinates, { speedKmh: 90 });
  let arrived = false;
  for (let k = 0; k <= 400 && !arrived; k += 1) {
    const r = updateNavigation(s, sim2.next(T0 + (100 + k) * 1000));
    s = r.state;
    arrived = r.events.some((e) => e.type === 'arrived');
  }
  assert.ok(arrived);
  assert.ok(Math.abs(s.drivenBefore + s.along - (before + route.distance)) < 300, `${s.drivenBefore + s.along}`);
});

test('export / import : historique inclus, fusionné, notes d\'aires exportées', () => {
  const data = { ...emptyData(), areaNotes: [{ areaId: 'osm:1', ids: ['osm:1'], name: 'Aire', lon: 6, lat: 48, security: 'bad', updatedAt: new Date(T0).toISOString() }] };
  const json = exportData(data, new Date(T0), [trip()]);
  const parsed = JSON.parse(json);
  assert.equal(parsed.history.length, 1);
  assert.equal(parsed.areaNotes.length, 1);
  assert.doesNotMatch(JSON.stringify(parsed.history), /"lon"|"lat"/);
  const back = readExport(json);
  assert.equal(back.history.length, 1);
  assert.equal(back.data.areaNotes[0].security, 'bad');
  assert.equal(back.data.history, undefined, 'historique hors de gabarit.data (IndexedDB)');
  assert.deepEqual(readExport(JSON.stringify({ app: 'gabarit', ...emptyData() })).history, [], 'ancien export sans historique');
});

test('notes d\'aires : 3 critères + texte, une par aire, retirée si vide, ligne courte', () => {
  const area = { id: 'osm:1', ids: ['osm:1', 'bf:9'], name: 'Aire de Toul', lon: 5.9, lat: 48.68 };
  let list = setAreaNote([], area, { security: 'bad', showers: 'yes', clean: 'fair', text: '  Éclairage en panne  ' }, new Date(T0));
  assert.equal(list.length, 1);
  assert.equal(list[0].text, 'Éclairage en panne');
  assert.equal(noteShort(noteFor(list, area)), 'Ma note : sécurité mauvaise · douches oui · propreté moyenne');
  assert.equal(noteFor(list, { id: 'autre', lon: 5.9005, lat: 48.6801 })?.areaId, 'osm:1', 'même aire à 150 m');
  list = setAreaNote(list, area, { security: 'good', text: 'x'.repeat(400) }, new Date(T0 + 1000));
  assert.equal(list.length, 1, 'remplacée');
  assert.equal(list[0].text.length, AREA_NOTES.TEXT_MAX);
  assert.equal(list[0].showers, null);
  assert.deepEqual(setAreaNote(list, area, {}, new Date(T0)), [], 'tout vide → retirée');
  assert.deepEqual(sanitizeAreaNotes([{ areaId: 'a', updatedAt: 'x' }, { areaId: 'b', updatedAt: new Date(T0).toISOString(), security: 'pire' }]), []);
  assert.deepEqual(Object.keys(NOTE_CHOICES), ['security', 'showers', 'clean']);
});

const later = (fn) => setTimeout(fn, 0);
function fakeIdb({ full = false } = {}) {
  const data = new Map();
  return {
    open() {
      const req = {};
      later(() => {
        req.result = {
          close() {},
          createObjectStore() {},
          transaction(_s, mode) {
            const tx = {};
            tx.objectStore = () => ({
              get(k) { const r = {}; later(() => { r.result = data.get(k); later(() => tx.oncomplete?.()); }); return r; },
              put(v, k) {
                const r = {};
                later(() => {
                  if (full && mode === 'readwrite') { tx.error = new Error('plein'); tx.onabort?.(); return; }
                  data.set(k, structuredClone(v)); later(() => tx.oncomplete?.());
                });
                return r;
              },
              delete(k) { const r = {}; later(() => { data.delete(k); later(() => tx.oncomplete?.()); }); return r; },
            });
            return tx;
          },
        };
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

async function withIdb(idb, fn) {
  const before = globalThis.indexedDB;
  if (idb === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = idb;
  try { await fn(); } finally { if (before === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = before; }
}

test('IndexedDB : ajout, lecture, effacement ; absent ou plein → jamais bloquant', async () => {
  await withIdb(fakeIdb(), async () => {
    const st = createHistoryStore();
    assert.deepEqual(await st.list(), []);
    assert.equal(await st.add(trip()), true);
    assert.equal((await st.list()).length, 1);
    assert.equal(await st.merge([trip(), trip({ seq: 4 })]), true);
    assert.equal((await st.list()).length, 2);
    assert.equal(await st.clear(), true);
    assert.deepEqual(await st.list(), []);
  });
  await withIdb(undefined, async () => {
    const st = createHistoryStore();
    assert.equal(await st.list(), null, 'indisponible');
    assert.equal(await st.add(trip()), false);
  });
  await withIdb(fakeIdb({ full: true }), async () => {
    const st = createHistoryStore();
    assert.equal(await st.add(trip()), false, 'plein : refusé sans erreur');
  });
});
