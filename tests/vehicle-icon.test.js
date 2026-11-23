// v45 : repère du véhicule — flèche ou camion vu de dessus (dessin original), camion par défaut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_ICONS, VEHICLE_ICON_LABELS, DEFAULT_VEHICLE_ICON } from '../src/ui/vehicle-icon.js';
import { sanitizeVehicleIcon, VEHICLE_ICON_CHOICES } from '../src/lib/prefs.js';
import { createStore, memoryStorage } from '../src/lib/store.js';

const box = (shapes) => {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [tag, a] of shapes) {
    if (tag === 'rect') { x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, a.x + a.width); y1 = Math.max(y1, a.y + a.height); }
    if (tag === 'path') for (const [, x, y] of a.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)) { x0 = Math.min(x0, +x); x1 = Math.max(x1, +x); y0 = Math.min(y0, +y); y1 = Math.max(y1, +y); }
  }
  return { x0, y0, x1, y1 };
};

test('réglage : camion par défaut, flèche au choix, valeur inconnue → camion', () => {
  assert.deepEqual(VEHICLE_ICON_CHOICES, ['arrow', 'truck']);
  assert.equal(DEFAULT_VEHICLE_ICON, 'truck');
  assert.equal(sanitizeVehicleIcon('arrow'), 'arrow');
  assert.equal(sanitizeVehicleIcon('car'), 'truck');
  assert.equal(sanitizeVehicleIcon(undefined), 'truck');
  assert.deepEqual(VEHICLE_ICON_LABELS, { arrow: 'Flèche', truck: 'Camion' });
  const store = createStore(memoryStorage());
  assert.equal(store.load().settings.vehicleIcon, 'truck');
  // Anciens réglages (sans le champ) : camion.
  const st = memoryStorage();
  st.setItem('gabarit.data', JSON.stringify({ version: 1, vehicles: [], settings: { arrowColor: 'bleu' } }));
  assert.equal(createStore(st).load().settings.vehicleIcon, 'truck');
});

test('camion : même place que la flèche (centré sur le halo, emprise comparable), avant vers le haut, pare-brise', () => {
  const t = box(VEHICLE_ICONS.truck);
  const a = box(VEHICLE_ICONS.arrow);
  assert.ok(Math.abs((t.x0 + t.x1) / 2 - 32) < 0.5, 'centré en x');
  assert.ok(Math.abs((t.y0 + t.y1) / 2 - 32) < 1, 'centré en y');
  assert.ok(t.x0 >= 2 && t.x1 <= 62 && t.y0 >= 2 && t.y1 <= 62, 'dans le halo (rayon 30)');
  assert.ok(t.x1 - t.x0 <= a.x1 - a.x0, 'pas plus large que la flèche');
  assert.ok(t.y1 - t.y0 <= 50, 'hauteur comparable à la flèche (40)');
  const glass = VEHICLE_ICONS.truck.find(([, , c]) => c === 'me-glass');
  assert.ok(glass && glass[1].y < 20, 'pare-brise à l\'avant (haut)');
});
