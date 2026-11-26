// v84 : menu « Informations du trajet » (src/lib/route-info.js) : niveau de chaque ligne, tri, récap, état replié.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers.js';
import {
  SEV, lineSeverity, sortLines, recapText, worstSeverity, countSeverities, createTripInfoState, TRIP_INFO,
} from '../src/lib/route-info.js';
import { routeRules, tunnelRules } from '../src/lib/route-rules.js';
import { parseTunnelData, ADR } from '../src/lib/adr.js';
import { convertTunnels } from '../src/lib/tunnels-convert.js';
import { defaultVehicle } from '../src/lib/vehicle.js';
import { bridgeLines, bridgeRules, BRIDGE_UNAVAILABLE_TEXT } from '../src/lib/bridge-check.js';
import { weightLines, weightRules, WEIGHT_UNAVAILABLE_TEXT } from '../src/lib/weight-check.js';
import { sensitiveRules } from '../src/lib/sensitive-points.js';
import { CALENDAR_UNKNOWN_TEXT } from '../src/lib/hgv-bans.js';

const data = parseTunnelData(JSON.parse(JSON.stringify(convertTunnels(fixture('overpass-tunnels.json'), { updated: '2026-11-17' }).data)));
const adr = (tunnelCode) => ({ ...defaultVehicle(), hazmat: true, tunnelCode });
function eastRoute() {
  const n = 400;
  const coords = Array.from({ length: n + 1 }, (_, i) => [4.9 + (0.5 * i) / n, 45.05]);
  return { coordinates: coords, steps: [{ name: 'A 99', instruction: 'Suivez A 99', type: 11, wayPoints: [0, n], duration: 1800, distance: 39400 }], duration: 1800, distance: 39400, bbox: [4.9, 45.05, 5.4, 45.05] };
}

test('niveau : sev posé par la règle, sinon warn → alerte, info → info', () => {
  assert.equal(lineSeverity({ level: 'warn', sev: 'ban' }), SEV.BAN);
  assert.equal(lineSeverity({ level: 'info', sev: 'check' }), SEV.CHECK);
  assert.equal(lineSeverity({ level: 'warn' }), SEV.ALERT);
  assert.equal(lineSeverity({ level: 'info' }), SEV.INFO);
  assert.equal(lineSeverity({ level: 'warn', sev: 'inconnu' }), SEV.ALERT);
});

test('niveau de chaque information (liste du plan) : interdits, à vérifier, données manquantes', () => {
  const route = eastRoute();
  // Tunnel interdit au code du chargement : interdit ; rappel ADR : info.
  const r = routeRules(route, { vehicle: adr('C'), departure: new Date(2026, 10, 18, 10), tunnels: { status: 'ok', data } });
  const tun = r.lines.filter((l) => /^Tunnel de Test/.test(l.text) && l.level === 'warn');
  assert.ok(tun.length >= 1 && tun.every((l) => lineSeverity(l) === SEV.BAN));
  assert.equal(lineSeverity(r.lines.find((l) => l.text === ADR.REMINDER_TEXT)), SEV.INFO);
  // Tunnels ADR : sans code (contrôle impossible) et alerte indisponible : à vérifier.
  assert.equal(lineSeverity(tunnelRules(route, { vehicle: adr(''), tunnels: { status: 'ok', data } }).lines[0]), SEV.CHECK);
  const off = tunnelRules(route, { vehicle: adr('C'), tunnels: { status: 'failed', data: null } });
  assert.equal(lineSeverity(off.lines.find((l) => l.text === ADR.UNAVAILABLE_TEXT)), SEV.CHECK);
  // Ponts et limites de poids : « à vérifier », y compris données non chargées.
  const items = Array.from({ length: 7 }, (_, i) => ({ text: 'Pont', along: i * 1000, level: 'high', kind: 'road', name: '' }));
  assert.ok(bridgeLines(items).every((l) => lineSeverity(l) === SEV.CHECK));
  assert.ok(weightLines(items).every((l) => lineSeverity(l) === SEV.CHECK));
  const b = bridgeRules(route, { bridges: { status: 'failed' } }).lines;
  assert.equal(b[0].text, BRIDGE_UNAVAILABLE_TEXT);
  assert.equal(lineSeverity(b[0]), SEV.CHECK);
  const w = weightRules(route, { weights: { status: 'failed' } }).lines;
  assert.equal(w[0].text, WEIGHT_UNAVAILABLE_TEXT);
  assert.equal(lineSeverity(w[0]), SEV.CHECK);
  assert.equal(lineSeverity(sensitiveRules(route, { copy: { status: 'failed' } }).lines[0]), SEV.CHECK);
  // Textes et level inchangés (seul sev est ajouté).
  assert.equal(b[0].level, 'info');
  assert.equal(typeof CALENDAR_UNKNOWN_TEXT, 'string');
});

test('tri : interdits, alertes, à vérifier, infos ; ordre gardé dans un niveau ; aucune ligne perdue', () => {
  const lines = [
    { level: 'info', text: 'i1' }, { level: 'warn', text: 'a1' }, { level: 'warn', sev: 'check', text: 'c1' },
    { level: 'warn', sev: 'ban', text: 'b1' }, { level: 'info', sev: 'check', text: 'c2' }, { level: 'warn', text: 'a2' },
    { level: 'warn', sev: 'ban', text: 'b2' }, { level: 'info', text: 'i2' },
  ];
  const sorted = sortLines(lines);
  assert.deepEqual(sorted.map((l) => l.text), ['b1', 'b2', 'a1', 'a2', 'c1', 'c2', 'i1', 'i2']);
  assert.equal(sorted.length, lines.length);
  assert.ok(lines.every((l) => sorted.includes(l)), 'mêmes objets, textes identiques');
  assert.deepEqual(sortLines(null), []);
  // Fiche réelle : toutes les lignes de routeRules dans le menu.
  const r = routeRules(eastRoute(), { vehicle: adr('C'), departure: new Date(2026, 10, 18, 10), tunnels: { status: 'ok', data } });
  assert.deepEqual(new Set(sortLines(r.lines)), new Set(r.lines));
});

test('récap : aucune alerte, un interdit, plusieurs alertes, niveaux présents seulement', () => {
  assert.equal(recapText([]), TRIP_INFO.NONE_TEXT);
  assert.equal(recapText([{ level: 'info', text: 'x' }]), 'Aucune alerte');
  assert.equal(recapText([{ level: 'warn', sev: 'ban', text: 'x' }]), '1 interdit');
  assert.equal(recapText([{ level: 'warn', text: 'x' }, { level: 'warn', text: 'y' }]), '2 alertes');
  assert.equal(recapText([
    { level: 'warn', sev: 'check', text: 'c' }, { level: 'warn', text: 'a' }, { level: 'warn', sev: 'ban', text: 'b' },
    { level: 'warn', text: 'a' }, { level: 'info', sev: 'check', text: 'c' }, { level: 'warn', sev: 'check', text: 'c' },
  ]), '1 interdit · 2 alertes · 3 à vérifier');
  assert.equal(recapText([{ level: 'warn', sev: 'check', text: 'c' }]), '1 à vérifier');
  assert.deepEqual(countSeverities([{ level: 'info' }]), { ban: 0, alert: 0, check: 0, info: 1 });
});

test('pire niveau', () => {
  assert.equal(worstSeverity([]), SEV.INFO);
  assert.equal(worstSeverity([{ level: 'info' }, { level: 'warn', sev: 'check' }]), SEV.CHECK);
  assert.equal(worstSeverity([{ level: 'warn' }, { level: 'warn', sev: 'check' }]), SEV.ALERT);
  assert.equal(worstSeverity([{ level: 'warn' }, { level: 'warn', sev: 'ban' }]), SEV.BAN);
});

test('menu : replié au premier affichage et à chaque nouveau calcul, jamais ouvert tout seul, gardé pendant le calcul', () => {
  const s = createTripInfoState();
  assert.equal(s.isOpen(1), false);
  assert.equal(s.isOpen(1), false, 'redessin : toujours replié sans action');
  s.set(1, true);
  assert.equal(s.isOpen(1), true, 'même calcul (changement de fiche, données chargées) : ouvert');
  assert.equal(s.isOpen(2), false, 'nouveau calcul : replié');
  assert.equal(s.isOpen(1), false, 'retour à un ancien numéro : replié');
  s.set(3, false);
  assert.equal(s.isOpen(3), false);
});

test('summary.js : un seul menu, ouverture par l\'état seulement, cartes et boutons hors du menu', () => {
  const src = readFileSync(new URL('../src/ui/summary.js', import.meta.url), 'utf8');
  assert.equal((src.match(/makeCollapsible\(/g) ?? []).length, 1);
  assert.match(src, /open: state\.isOpen\(calcId\)/);
  // Hors menu : question desserte locale et boutons d'action (visible), cartes dans node (pas notesNode).
  assert.match(src, /\.\.\.block\.visible,\s*tripInfoMenu\(/);
  assert.match(src, /const visible = \[\s*\.\.\.questions,\s*canAvoid/);
  // Pas de nouvelle voix : summary.js ne parle jamais.
  assert.doesNotMatch(src, /speak|speechSynthesis/);
});
