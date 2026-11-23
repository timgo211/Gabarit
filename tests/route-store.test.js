// v53 : la mémoire de l'itinéraire (src/ui/route-save.js) ne plante jamais si IndexedDB est absent, refusé, bloqué
// ou plein : lecture → null, écriture / effacement → false, aucune exception ni rejet non géré (le guidage continue).
// Faux globalThis.indexedDB, aucun vrai stockage.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRouteStore, OPEN_TIMEOUT_MS } from '../src/ui/route-save.js';

const later = (fn) => setTimeout(fn, 0);

/** Base qui fonctionne (mémoire), avec écriture refusée si `full`. */
function fakeIdb({ full = false, throwOnWrite = false } = {}) {
  const data = new Map();
  return {
    open() {
      const req = {};
      later(() => {
        const db = {
          close() {},
          transaction(_store, mode) {
            const tx = {};
            const store = {
              get(k) { const r = {}; later(() => { r.result = data.get(k); later(() => tx.oncomplete?.()); }); return r; },
              put(v, k) {
                if (throwOnWrite) { const e = new Error('plein'); e.name = 'QuotaExceededError'; throw e; }
                const r = {};
                later(() => {
                  if (full && mode === 'readwrite') { tx.error = Object.assign(new Error('plein'), { name: 'QuotaExceededError' }); tx.onabort?.(); return; }
                  data.set(k, v); later(() => tx.oncomplete?.());
                });
                return r;
              },
              delete(k) { const r = {}; later(() => { data.delete(k); later(() => tx.oncomplete?.()); }); return r; },
            };
            tx.objectStore = () => store;
            return tx;
          },
          createObjectStore() {},
        };
        req.result = db;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

async function withIdb(idb, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'indexedDB');
  const before = globalThis.indexedDB;
  const rejections = [];
  const onRej = (r) => rejections.push(r);
  process.on('unhandledRejection', onRej);
  if (idb === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = idb;
  try {
    await fn();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(rejections, [], 'aucun rejet non géré');
  } finally {
    process.off('unhandledRejection', onRej);
    if (had) globalThis.indexedDB = before; else delete globalThis.indexedDB;
  }
}

async function expectSilent(store) {
  assert.equal(await store.load(), null);
  assert.equal(await store.put({ format: 1 }), false);
  assert.equal(await store.clear(), false);
}

test('IndexedDB absent (navigateur sans stockage) : rien gardé, aucune erreur', async () => {
  await withIdb(undefined, () => expectSilent(createRouteStore()));
});

test('IndexedDB refusé : open qui lève (navigation privée, réglage) ou qui échoue', async () => {
  await withIdb({ open() { throw Object.assign(new Error('refusé'), { name: 'SecurityError' }); } }, () => expectSilent(createRouteStore()));
  await withIdb({
    open() { const req = {}; later(() => { req.error = new Error('refusé'); req.onerror?.(); }); return req; },
  }, () => expectSilent(createRouteStore()));
});

test('IndexedDB bloquée ou sans réponse : abandon, jamais pendu', async () => {
  await withIdb({ open() { const req = {}; later(() => req.onblocked?.()); return req; } }, () => expectSilent(createRouteStore()));
  assert.ok(OPEN_TIMEOUT_MS <= 2000);
  // Aucune réponse : le délai de garde rend la main (null), la lecture ne reste jamais en attente.
  await withIdb({ open() { return {}; } }, async () => {
    assert.equal(await createRouteStore().load(), null);
  });
});

test('stockage plein : écriture refusée (transaction annulée ou exception) → false, lecture inchangée', async () => {
  await withIdb(fakeIdb({ full: true }), async () => {
    const store = createRouteStore();
    assert.equal(await store.put({ format: 1 }), false);
    assert.equal(await store.load(), null);
  });
  await withIdb(fakeIdb({ throwOnWrite: true }), async () => {
    assert.equal(await createRouteStore().put({ format: 1 }), false);
  });
});

test('IndexedDB qui marche : écrit, relit, efface', async () => {
  await withIdb(fakeIdb(), async () => {
    const store = createRouteStore();
    assert.equal(await store.put({ format: 1, kind: 'plan' }), true);
    assert.deepEqual(await store.load(), { format: 1, kind: 'plan' });
    assert.equal(await store.clear(), true);
    assert.equal(await store.load(), null);
  });
});
