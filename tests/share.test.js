// Partage (phase 7) : lien d'itinéraire (aller-retour, liens abîmés ou piégés), vie privée du départ « Ma position »,
// GPX 1.1, lien OpenStreetMap, appli, choix entre partage, copie et téléchargement. Aucun appel réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeRouteLink, decodeRouteLink, cleanName, isLonLat, appBaseUrl, osmLink, appShareText, buildGpx, xmlEscape,
  gpxFileName, privacyStartIndex, pickShareMethod, shareResultText, variantId, findVariantIndex,
  SHARE, SHARE_VARIANTS, BAD_LINK_TEXT, SHARED_START_NAME, SHARED_ROUTE_TEXT, SHARED_ROUTE_NO_KEY_TEXT,
} from '../src/lib/share.js';
import { parseDirections } from '../src/lib/ors-response.js';
import { destinationPoint } from '../src/lib/nav-geo.js';
import { defaultVehicle } from '../src/lib/vehicle.js';
import { fixture } from './helpers.js';

const BASE = 'https://exemple.github.io/Gabarit/';
const LYON = [4.83571, 45.76404];
const PARIS = [2.35222, 48.85661];
const hashOf = (url) => url.slice(url.indexOf('#'));
const FAKE_KEY = 'cle-secrete-de-test';

const route = {
  start: LYON, end: PARIS, fromLabel: 'Dépôt Lyon Sud', toLabel: 'Client « Les Halles » & Cie',
  avoidTolls: true, avoidFerries: false, variant: 'shortest',
};

test('lien d\'itinéraire : aller-retour encodage / décodage', () => {
  const url = encodeRouteLink(`${BASE}?x=1#ancien`, route);
  assert.ok(url.startsWith(`${BASE}#`), 'adresse de l\'appli sans paramètres ni ancienne ancre');
  const r = decodeRouteLink(hashOf(url));
  assert.equal(r.ok, true);
  assert.deepEqual(r.route, {
    from: { lon: 4.83571, lat: 45.76404, label: 'Dépôt Lyon Sud' },
    to: { lon: 2.35222, lat: 48.85661, label: 'Client « Les Halles » & Cie' },
    avoidTolls: true, avoidFerries: false, variant: 'shortest',
  });
  // Sans # aussi, et toutes les variantes connues passent.
  for (const variant of SHARE_VARIANTS) {
    const d = decodeRouteLink(hashOf(encodeRouteLink(BASE, { ...route, variant })).slice(1));
    assert.equal(d.route.variant, variant);
  }
  assert.equal(decodeRouteLink(hashOf(encodeRouteLink(BASE, { ...route, avoidFerries: true }))).route.avoidFerries, true);
});

test('lien : coordonnées arrondies à 5 décimales, variante inconnue → recommended', () => {
  const url = encodeRouteLink(BASE, { ...route, end: [2.123456789, 48.987654321], variant: 'pirate' });
  assert.match(url, /to=48\.98765%2C2\.12346/);
  assert.match(url, /variant=recommended/);
});

test('vie privée : départ « Ma position » absent du lien sauf si la case est cochée', () => {
  const mine = { ...route, fromLabel: 'Ma position', startIsMyPosition: true };
  const hidden = encodeRouteLink(BASE, mine);
  assert.doesNotMatch(hidden, /from=/);
  assert.doesNotMatch(hidden, /45\.76/);
  assert.doesNotMatch(hidden, /4\.83/);
  const d = decodeRouteLink(hashOf(hidden));
  assert.equal(d.ok, true);
  assert.equal(d.route.from, null, 'le destinataire part de sa propre position GPS');

  const shown = decodeRouteLink(hashOf(encodeRouteLink(BASE, { ...mine, includeStart: true })));
  assert.deepEqual(shown.route.from, { lon: 4.83571, lat: 45.76404, label: SHARED_START_NAME });
  // Un départ choisi dans la liste (adresse) est toujours partagé, la case ne concerne que « Ma position ».
  assert.match(encodeRouteLink(BASE, { ...route, includeStart: false }), /from=/);
});

test('jamais de clé ni de profil véhicule dans un lien ou un GPX', () => {
  const vehicle = { ...defaultVehicle(), name: 'Mon Actros secret', height: 4.12 };
  const polluted = { ...route, apiKey: FAKE_KEY, key: FAKE_KEY, vehicle, height: 4.12, weight: 44 };
  const url = encodeRouteLink(BASE, polluted);
  const gpx = buildGpx({ route: { coordinates: [LYON, PARIS], apiKey: FAKE_KEY, vehicle }, ...polluted });
  for (const text of [url, decodeURIComponent(url), gpx, JSON.stringify(decodeRouteLink(hashOf(url)))]) {
    assert.doesNotMatch(text, new RegExp(FAKE_KEY));
    assert.doesNotMatch(text, /Actros|4\.12|apiKey|api_key|vehicle|height|weight/i);
  }
  const keys = [...new URLSearchParams(hashOf(url).slice(1)).keys()].sort();
  assert.deepEqual(keys, ['ferries', 'from', 'fromName', 'to', 'toName', 'tolls', 'v', 'variant']);
});

test('liens abîmés ou piégés : refusés sans planter', () => {
  const ok = hashOf(encodeRouteLink(BASE, route));
  const bad = [
    '#v=2&to=48.8,2.3', // version inconnue
    '#v=1', // pas d'arrivée
    '#v=1&to=', '#v=1&to=abc', '#v=1&to=48.8', '#v=1&to=48.8,2.3,1',
    '#v=1&to=91,2.3', '#v=1&to=48.8,181', '#v=1&to=-90.5,0',
    '#v=1&to=NaN,2', '#v=1&to=Infinity,2', '#v=1&to=1e2,2', '#v=1&to=0x10,2', '#v=1&to=48.8%20,2.3',
    '#v=1&to=48.123456789,2.3', // trop de décimales
    '#v=1&to=48.8,2.3&from=999,0', // départ invalide
    '#v=1&to=48.8,2.3&to=45.7,4.8', // doublon ambigu
    '#v=1&v=1&to=48.8,2.3',
    '#v=1&to=48.8,2.3&tolls=oui',
    `${ok}&pad=${'x'.repeat(SHARE.MAX_HASH_LENGTH)}`, // trop long
    '#v=1&to=%E0%A4%A&toName=%', // pourcentages cassés
    '#v=1&to=48.8%2C2.3%00',
  ];
  for (const h of bad) {
    const r = decodeRouteLink(h);
    assert.ok(r && r.ok === false, `devrait être refusé : ${h.slice(0, 60)}`);
    assert.equal(r.error, BAD_LINK_TEXT);
  }
  // Rien à lire : pas d'erreur affichée.
  for (const h of ['', '#', '#section', '#map=12/45/4', null, undefined, 42, {}]) assert.equal(decodeRouteLink(h), null);
});

test('lien piégé : noms nettoyés (balises gardées comme texte, contrôles retirés, raccourcis)', () => {
  const evil = '<img src=x onerror=alert(1)>‮\u0000\n\tRue   du\u0007 Port';
  const url = encodeRouteLink(BASE, { ...route, toLabel: evil, fromLabel: 'x'.repeat(500) });
  const r = decodeRouteLink(hashOf(url));
  assert.equal(r.ok, true);
  assert.equal(r.route.to.label, '<img src=x onerror=alert(1)> Rue du Port', 'texte brut, affiché avec textContent');
  assert.equal([...r.route.from.label].length, SHARE.MAX_NAME_LENGTH);
  assert.ok(r.route.from.label.endsWith('…'));
  // Nom forgé à la main dans un lien : même nettoyage à la réception.
  const forged = decodeRouteLink(`#v=1&to=48.8,2.3&toName=${encodeURIComponent(`A\u0000B${'é'.repeat(300)}`)}`);
  assert.equal(forged.route.to.label.startsWith('A B'), true);
  assert.equal([...forged.route.to.label].length, SHARE.MAX_NAME_LENGTH);
  // Sans nom : coordonnées affichées.
  assert.equal(decodeRouteLink('#v=1&to=48.8,2.3').route.to.label, '48.8, 2.3');
  assert.equal(decodeRouteLink('#v=1&to=48.8,2.3&variant=<script>').route.variant, 'recommended');
});

test('cleanName, isLonLat, appBaseUrl', () => {
  assert.equal(cleanName(null), '');
  assert.equal(cleanName(42), '');
  assert.equal(cleanName('  Saint-Étienne  '), 'Saint-Étienne');
  assert.equal(isLonLat([2, 48]), true);
  for (const p of [null, [2], ['2', '48'], [NaN, 1], [200, 0], [0, -91]]) assert.equal(isLonLat(p), false);
  assert.equal(appBaseUrl('https://a.github.io/Gabarit/index.html?x=1#v=1'), 'https://a.github.io/Gabarit/index.html');
  assert.equal(appBaseUrl('pas une url'), '');
  assert.throws(() => encodeRouteLink(BASE, { ...route, end: null }), /Arrivée inconnue/);
});

test('variante choisie : identifiant partagé et retrouvé chez le destinataire', () => {
  const options = [{ key: 'recommended' }, { key: 'alternative' }, { key: 'alternative' }];
  assert.deepEqual(options.map(variantId), ['recommended', 'alternative-2', 'alternative-3']);
  assert.equal(variantId({ key: 'rerouted' }, 0), 'recommended');
  assert.equal(variantId({ key: 'no-toll' }, 2), 'no-toll');
  assert.equal(findVariantIndex(options, 'alternative-3'), 2);
  const variants = [{ key: 'recommended' }, { key: 'shortest' }, { key: 'no-toll' }];
  assert.equal(findVariantIndex(variants, 'no-toll'), 2);
  assert.equal(findVariantIndex(variants, 'alternative-2'), -1);
  assert.equal(findVariantIndex(null, 'shortest'), -1);
});

test('lien OpenStreetMap d\'un lieu ou de ma position', () => {
  assert.equal(osmLink([2.3522219, 48.856614]),
    'https://www.openstreetmap.org/?mlat=48.85661&mlon=2.35222#map=17/48.85661/2.35222');
  assert.throws(() => osmLink(null), /Position inconnue/);
  assert.throws(() => osmLink([NaN, 2]));
});

test('partage de l\'appli : phrase sur la clé gratuite', () => {
  assert.match(appShareText(), /clé gratuite sur heigit\.org/);
  assert.match(SHARED_ROUTE_TEXT, /Calculer l'itinéraire/);
  assert.match(SHARED_ROUTE_NO_KEY_TEXT, /heigit\.org/);
});

/** Lecture minimale du GPX produit : structure, attributs, entités. */
function parseGpxPoints(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag} lat="(-?[\\d.]+)" lon="(-?[\\d.]+)"`, 'g'))].map((m) => [Number(m[2]), Number(m[1])]);
}

test('GPX 1.1 valide : en-tête, départ, arrivée, tracé, caractères spéciaux échappés', () => {
  const gpx = buildGpx({
    route: { coordinates: [LYON, [3.5, 47.2], PARIS] },
    fromLabel: 'Dépôt <Lyon> & "Sud"', toLabel: 'L\'Arrivée\u0001 > ici', now: new Date('2026-11-19T08:00:00Z'),
  });
  assert.ok(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Gabarit" xmlns="http://www.topografix.com/GPX/1/1"'));
  assert.ok(gpx.trimEnd().endsWith('</gpx>'));
  assert.match(gpx, /<time>2026-11-19T08:00:00.000Z<\/time>/);
  assert.match(gpx, /<name>Dépôt &lt;Lyon&gt; &amp; &quot;Sud&quot;<\/name>/);
  assert.match(gpx, /<name>L&apos;Arrivée &gt; ici<\/name>/);
  assert.doesNotMatch(gpx, /\u0001/);
  // Aucun < ou & brut dans les textes : chaque & ouvre une entité connue.
  for (const m of gpx.matchAll(/&[^;\s]*;?/g)) assert.match(m[0], /^&(amp|lt|gt|quot|apos);$/);
  assert.deepEqual(parseGpxPoints(gpx, 'wpt'), [LYON, PARIS]);
  assert.deepEqual(parseGpxPoints(gpx, 'trkpt'), [LYON, [3.5, 47.2], PARIS]);
  // Balises équilibrées.
  for (const tag of ['gpx', 'metadata', 'trk', 'trkseg']) {
    assert.equal(gpx.match(new RegExp(`<${tag}[\\s>]`, 'g')).length, gpx.split(`</${tag}>`).length - 1, tag);
  }
  assert.throws(() => buildGpx({ route: { coordinates: [LYON] } }), /sans tracé/);
});

test('xmlEscape et nom de fichier GPX', () => {
  assert.equal(xmlEscape('a<b>&"\'\u0000￾'), 'a&lt;b&gt;&amp;&quot;&apos;');
  assert.equal(xmlEscape(null), '');
  assert.equal(gpxFileName('Saint-Étienne (Zone Industrielle) / Quai n°3'), 'gabarit-saint-etienne-zone-industrielle-quai-n-3.gpx');
  assert.equal(gpxFileName('../../etc/passwd'), 'gabarit-etc-passwd.gpx');
  assert.equal(gpxFileName(''), 'gabarit-itineraire.gpx');
  assert.equal(gpxFileName('<>'), 'gabarit-itineraire.gpx');
});

const r6 = (p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))];

/** Ligne droite vers le nord, un point tous les `step` m. */
function straightLine(totalM, step = 100) {
  const pts = [LYON];
  for (let d = step; d <= totalM; d += step) pts.push(destinationPoint(LYON, 0, d));
  return pts;
}

test('vie privée GPX : sans la case, le tracé commence au premier carrefour après 500 m', () => {
  // Manœuvres à 300 m (trop près) puis à 700 m et 1,2 km.
  const coordinates = straightLine(2000);
  const steps = [[0, 3], [3, 7], [7, 12], [12, 20], [20, 20]].map((wayPoints) => ({ wayPoints }));
  assert.equal(privacyStartIndex({ coordinates, steps }), 7);
  const opts = { route: { coordinates, steps }, fromLabel: 'Ma position', toLabel: 'Client', startIsMyPosition: true };
  const hidden = buildGpx(opts);
  const trk = parseGpxPoints(hidden, 'trkpt');
  assert.deepEqual(trk[0], r6(coordinates[7]));
  assert.equal(trk.length, coordinates.length - 7);
  assert.deepEqual(parseGpxPoints(hidden, 'wpt'), [r6(coordinates[20])], 'pas de point de départ, seulement l\'arrivée');
  assert.doesNotMatch(hidden, /Ma position|Point de départ/);
  for (const p of coordinates.slice(0, 7)) assert.ok(!hidden.includes(`lat="${r6(p)[1]}"`));

  // Case cochée : tracé complet et « Point de départ ».
  const shown = buildGpx({ ...opts, includeStart: true });
  assert.deepEqual(parseGpxPoints(shown, 'trkpt')[0], r6(coordinates[0]));
  assert.deepEqual(parseGpxPoints(shown, 'wpt'), [r6(coordinates[0]), r6(coordinates[20])]);
  assert.match(shown, /<name>Point de départ<\/name>/);
});

test('vie privée GPX : réponse ORS réelle (1re manœuvre à 2 km) et cas limites', () => {
  const r = parseDirections(fixture('ors-directions-nav.json'));
  const from = privacyStartIndex(r);
  assert.equal(from, r.steps[1].wayPoints[0], 'début de la 2e manœuvre, à 2 km');
  const gpx = buildGpx({ route: r, startIsMyPosition: true, toLabel: 'Arrivée' });
  assert.deepEqual(parseGpxPoints(gpx, 'trkpt')[0], r6(r.coordinates[from]));

  // Pas de manœuvre au-delà de 500 m : premier point à plus de 500 m.
  const line = straightLine(1500);
  assert.equal(privacyStartIndex({ coordinates: line, steps: [{ wayPoints: [0, 2] }, { wayPoints: [2, 15] }] }), 5);
  assert.equal(privacyStartIndex({ coordinates: line }), 5);
  // Trajet de moins de 500 m : aucun tracé, seulement l'arrivée.
  const short = straightLine(400);
  assert.equal(privacyStartIndex({ coordinates: short }), -1);
  const gpxShort = buildGpx({ route: { coordinates: short }, startIsMyPosition: true });
  assert.doesNotMatch(gpxShort, /<trk>/);
  assert.equal(parseGpxPoints(gpxShort, 'wpt').length, 1);
  assert.equal(privacyStartIndex(null), -1);
  assert.equal(privacyStartIndex({ coordinates: line, steps: [{ wayPoints: null }, null, { wayPoints: ['a', 1] }] }), 5);
});

test('choix entre partage Android, copie, lien affiché et téléchargement', () => {
  assert.equal(pickShareMethod({ kind: 'link', hasShare: true, hasClipboard: true }), 'share');
  assert.equal(pickShareMethod({ kind: 'link', hasShare: false, hasClipboard: true }), 'copy');
  assert.equal(pickShareMethod({ kind: 'link' }), 'show');
  assert.equal(pickShareMethod({ kind: 'file', hasShare: true, canShareFiles: true }), 'share');
  assert.equal(pickShareMethod({ kind: 'file', hasShare: true, canShareFiles: false, hasClipboard: true }), 'download');
  assert.equal(pickShareMethod({ kind: 'file', hasShare: false, canShareFiles: true }), 'download');
  assert.equal(shareResultText('copy'), 'Lien copié : colle-le dans un message.');
  assert.match(shareResultText('download'), /téléchargé/);
  assert.equal(shareResultText('share'), '');
  assert.equal(shareResultText('share', { cancelled: true }), '');
  assert.match(shareResultText('share', { failed: true }), /copie le lien/);
});

test('« Partager Gabarit » : guide d\'installation pas à pas (lien, Chrome, clé HeiGIT, Réglages)', async () => {
  const { INSTALL_STEPS } = await import('../src/lib/share.js');
  assert.equal(INSTALL_STEPS.length, 4);
  assert.match(INSTALL_STEPS[0], /lien.*Chrome/);
  assert.match(INSTALL_STEPS[1], /Installer/);
  assert.match(INSTALL_STEPS[2], /heigit\.org/);
  assert.match(INSTALL_STEPS[3], /Réglages.*colle/);
  const text = appShareText();
  for (const [i, step] of INSTALL_STEPS.entries()) assert.ok(text.includes(`${i + 1}. ${step}`));
  assert.doesNotMatch(text, /cle-|key=|api_key/i, 'jamais de clé');
});
