// v43 : « Recommandé » jamais par un tunnel interdit confirmé pour le profil (classe Euro, ADR), si un autre itinéraire
// calculé l'évite ; tous par un tunnel interdit → choix gardé et dit sur la fiche. Aucune requête de plus.
// Fixtures de 5g : ors-directions-mont-blanc.json, ors-directions-frejus.json ; le « contournement » est le tracé du
// Mont-Blanc décalé de 0,2° vers l'ouest (SYNTHÉTIQUE : il ne passe dans aucun tube connu), un peu plus long.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDirections, parseAllDirections } from '../src/lib/ors-response.js';
import {
  computeRouteOptions, promoteRecommended, ALL_TUNNELS_NOTE, TUNNEL_AVOIDED_NOTE, AN_PREFERRED_NOTE, VARIANTS,
} from '../src/lib/route-options.js';
import { pickRecommendedIndex } from '../src/lib/road-class.js';
import { confirmedTunnelBans } from '../src/lib/route-rules.js';
import { defaultVehicle } from '../src/lib/vehicle.js';
import { fixture } from './helpers.js';

const semi = (euroClass = '', patch = {}) => ({ ...defaultVehicle(), weight: 44, height: 4, euroClass, ...patch });
const mbJson = () => fixture('ors-directions-mont-blanc.json');

/** Réponse ORS à deux itinéraires : Mont-Blanc (préférence d'ORS) puis contournement synthétique plus long. */
function twoRoutes() {
  const j = mbJson();
  const detour = JSON.parse(JSON.stringify(j.features[0]));
  detour.geometry.coordinates = detour.geometry.coordinates.map(([x, y]) => [x - 0.2, y]);
  detour.properties.summary = { distance: 60000, duration: 3000 };
  detour.properties.segments[0].distance = 60000;
  detour.properties.segments[0].duration = 3000;
  return { ...j, features: [j.features[0], detour] };
}

const opts = (routes) => routes.map((route, i) => ({
  key: i ? 'alternative' : 'recommended', label: i ? `Alternative ${i + 1}` : 'Recommandé', note: '', also: [], route,
  request: { preference: null, avoidTolls: false },
}));

test('tunnels interdits confirmés : Euro (texte officiel, exploitant), ADR ; « à vérifier » et classe vide ne comptent pas', () => {
  const mb = parseDirections(mbJson());
  const fr = parseDirections(fixture('ors-directions-frejus.json'));
  assert.deepEqual(confirmedTunnelBans(mb, { vehicle: semi('3') }), ['Tunnel du Mont-Blanc'], 'Euro 3 : arrêté 2020-0825');
  assert.deepEqual(confirmedTunnelBans(mb, { vehicle: semi('6') }), []);
  assert.deepEqual(confirmedTunnelBans(mb, { vehicle: semi('') }), [], 'classe non précisée : pas confirmé pour le profil');
  assert.deepEqual(confirmedTunnelBans(fr, { vehicle: semi('2') }), ['Tunnel du Fréjus'], 'Euro 2 : arrêté 2017');
  assert.deepEqual(confirmedTunnelBans(fr, { vehicle: semi('4') }), ['Tunnel du Fréjus'], 'Euro 4 : confirmé par l\'exploitant');
  assert.deepEqual(confirmedTunnelBans(fr, { vehicle: semi('5') }), []);
  // ADR : Mont-Blanc catégorie E (Bison Futé), code E interdit, sans le fichier des tunnels.
  assert.deepEqual(confirmedTunnelBans(mb, { vehicle: semi('6', { hazmat: true, tunnelCode: 'E' }) }), ['Tunnel du Mont-Blanc']);
  assert.deepEqual(confirmedTunnelBans(mb, { vehicle: semi('6', { hazmat: false, tunnelCode: 'E' }) }), [], 'sans la case ADR');
  assert.deepEqual(confirmedTunnelBans(mb, { vehicle: semi('6', { hazmat: true, tunnelCode: '' }) }), [], 'code vide');
  // PTAC ≤ 3,5 t : les règles Euro des tunnels ne s'appliquent pas.
  assert.deepEqual(confirmedTunnelBans(mb, { vehicle: semi('3', { weight: 3.5 }) }), []);
});

test('Recommandé écarté s\'il traverse un tunnel interdit, même bien plus rapide ; aucune requête de plus', async () => {
  const sent = [];
  const send = async (req) => { sent.push(req); return twoRoutes(); };
  const vehicle = semi('3');
  const isForbidden = (route) => confirmedTunnelBans(route, { vehicle }).length > 0;
  const { options, requests } = await computeRouteOptions({ start: [6.7037, 45.9145], end: [6.9725, 45.793], vehicle, send, isForbidden });
  assert.equal(requests, 1);
  assert.equal(sent.length, 1);
  assert.equal(options[0].label, 'Recommandé');
  assert.equal(options[0].tunnelPick, 'avoided');
  assert.equal(options[0].route.duration, 3000, 'le contournement (deux fois plus long) passe en tête');
  assert.ok(options[0].note.endsWith(TUNNEL_AVOIDED_NOTE));
  assert.ok(!options[0].note.includes(AN_PREFERRED_NOTE));
  assert.equal(options[1].label, 'Préférence ORS');
  assert.equal(options[1].key, VARIANTS.orsDefault.key);
  assert.match(TUNNEL_AVOIDED_NOTE, /La signalisation fait foi\.$/);
  // Euro 6 : rien d'interdit, ordre d'ORS gardé ; sans vérificateur : comportement de la 2g.
  const ok = await computeRouteOptions({ start: [6.7037, 45.9145], end: [6.9725, 45.793], vehicle: semi('6'), send, isForbidden: (r) => confirmedTunnelBans(r, { vehicle: semi('6') }).length > 0 });
  assert.equal(ok.options[0].route.duration, 1486);
  assert.equal(ok.options[0].tunnelPick, undefined);
  const none = await computeRouteOptions({ start: [6.7037, 45.9145], end: [6.9725, 45.793], vehicle, send });
  assert.equal(none.options[0].route.duration, 1486);
});

test('tous les itinéraires par un tunnel interdit : choix gardé, la fiche le dit en clair', () => {
  const [a, b] = parseAllDirections(twoRoutes());
  const list = opts([a, b]);
  const out = promoteRecommended(list, { forbidden: [true, true] });
  assert.equal(out[0].route, a, 'choix actuel gardé');
  assert.equal(out[0].tunnelPick, 'all');
  assert.ok(out[0].note.endsWith(ALL_TUNNELS_NOTE));
  assert.match(ALL_TUNNELS_NOTE, /^Tous les itinéraires calculés traversent un tunnel interdit/);
  // Un seul itinéraire calculé, interdit : même phrase.
  assert.equal(promoteRecommended([list[0]], { forbidden: [true] })[0].tunnelPick, 'all');
  // Seule une alternative interdite : jamais promue par la part A/N.
  assert.equal(pickRecommendedIndex(list, { excluded: [false, true] }), 0);
  assert.equal(promoteRecommended(list, { forbidden: [false, true] })[0].route, a);
  // Aucun interdit : sans effet.
  assert.deepEqual(promoteRecommended(list, { forbidden: [false, false] }), promoteRecommended(list));
});
