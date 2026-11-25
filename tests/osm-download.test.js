import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { download, downloadWithFallback, RETRY_WAITS_MS } from '../tools/osm-download.mjs';

// Aucun réseau : fetch simulé, attentes à 0 ; on compte les appels (jamais le temps d'horloge).
const SOURCES = [
  { name: 'Geofabrik', url: 'https://download.geofabrik.de/europe/france-latest.osm.pbf' },
  { name: 'OpenStreetMap France', url: 'https://download.openstreetmap.fr/extracts/europe/france-latest.osm.pbf' },
];
const WAITS = [0, 0, 0, 0];

function fakeFetch(okHosts) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const host = new URL(url).host;
    if (!okHosts.includes(host)) {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNREFUSED' };
      throw err;
    }
    return new Response('donnees');
  };
  return { impl, calls };
}

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'osm-download-'));
  return Promise.resolve(fn(join(dir, 'f.pbf'))).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const quiet = async (fn) => {
  const log = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  try { return { res: await fn(), lines }; } finally { console.log = log; }
};

test('mêmes attentes que l\'outil « Données OSM » : 5 essais, 30 s, 1, 2, 4 min', () => {
  assert.deepEqual([...RETRY_WAITS_MS], [30000, 60000, 120000, 240000]);
});

test('Geofabrik joignable : source principale, aucun appel au secours', () => withDir(async (file) => {
  const f = fakeFetch(['download.geofabrik.de']);
  const { res } = await quiet(() => downloadWithFallback(SOURCES, file, { waits: WAITS, fetchImpl: f.impl }));
  assert.equal(res.name, 'Geofabrik');
  assert.equal(f.calls.length, 1);
  assert.equal(readFileSync(file, 'utf8'), 'donnees');
}));

test('Geofabrik refusé aux 5 essais : secours OpenStreetMap France, journal de la source', () => withDir(async (file) => {
  const f = fakeFetch(['download.openstreetmap.fr']);
  const { res, lines } = await quiet(() => downloadWithFallback(SOURCES, file, { waits: WAITS, fetchImpl: f.impl }));
  assert.equal(res.name, 'OpenStreetMap France');
  assert.equal(f.calls.filter((u) => u.includes('geofabrik')).length, 5);
  assert.equal(f.calls.filter((u) => u.includes('openstreetmap.fr')).length, 1);
  assert.ok(lines.some((l) => /ECONNREFUSED/.test(l)));
  assert.ok(lines.some((l) => /source Geofabrik en échec.*secours OpenStreetMap France/.test(l)));
}));

test('toutes les sources en échec : message d\'échec, 5 essais chacune', () => withDir(async (file) => {
  const f = fakeFetch([]);
  await assert.rejects(
    quiet(() => downloadWithFallback(SOURCES, file, { waits: WAITS, fetchImpl: f.impl, failMessage: 'rien n\'est enregistré' })),
    /rien n'est enregistré/,
  );
  assert.equal(f.calls.length, 10);
  await assert.rejects(quiet(() => download(SOURCES[0].url, file, { waits: WAITS, fetchImpl: f.impl })), /Téléchargement impossible/);
}));

test('outil d\'audit : secours après Geofabrik, osm-update.mjs inchangé (pas de relance de « Données OSM »)', () => {
  const tool = readFileSync(new URL('../tools/audit-osm.mjs', import.meta.url), 'utf8');
  const g = tool.indexOf('download.geofabrik.de/${REGION}-latest.osm.pbf');
  const o = tool.indexOf('download.openstreetmap.fr/extracts/europe/france-latest.osm.pbf');
  assert.ok(g > 0 && o > g, 'Geofabrik d\'abord, OpenStreetMap France ensuite');
  assert.match(tool, /downloadWithFallback\(SOURCES/);
  assert.match(tool, /sourceExtrait: source/);
  const updater = readFileSync(new URL('../tools/osm-update.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(updater, /osm-download\.mjs|openstreetmap\.fr/);
});
