// Phase 2c-a : contraste WCAG AA des couleurs Panier Perdu, de jour comme de nuit (variables de src/styles.css).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrastRatio, cssVars, parseColor, AA_TEXT, AA_LARGE } from '../src/lib/contrast.js';
import { ARROW_COLORS, AUTO_ARROW } from '../src/lib/prefs.js';
import { NIGHT_PALETTES, NIGHT_BUBBLES, NIGHT_LEVELS, PHOTO_NIGHT_LABEL } from '../src/lib/map-palette.js';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const day = cssVars(css, ':root');
const night = { ...day, ...cssVars(css, ':root[data-theme="night"]') };

test('calcul du contraste (valeurs de référence WCAG)', () => {
  assert.equal(contrastRatio('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  assert.equal(contrastRatio('#777', '#fff').toFixed(2), '4.48');
  assert.deepEqual(parseColor('rgba(250, 248, 243, .97)'), { r: 250, g: 248, b: 243, a: 0.97 });
  assert.ok(Number.isNaN(contrastRatio('rouge', '#fff')));
  // Fond transparent : le pire cas (carte claire ou sombre dessous) est retenu.
  assert.ok(contrastRatio('#000', 'rgba(255,255,255,.5)') < contrastRatio('#000', '#fff'));
});

test('palette Panier Perdu présente', () => {
  assert.equal(day['--bg'], '#FAF8F3');
  assert.equal(day['--accent'], '#E8A93B');
  assert.equal(night['--bg'], '#14161C');
  assert.equal(night['--fg'], '#EDEAE3');
  assert.equal(day['--chrome-bg'], '#14161C');
});

const TEXT = [
  ['--fg', '--bg'], ['--fg', '--card'], ['--fg', '--panel'],
  ['--muted', '--bg'], ['--muted', '--panel'], ['--muted', '--card'],
  ['--primary-fg', '--primary'], ['--accent-fg', '--accent'], ['--danger-fg', '--danger'],
  ['--danger', '--card'], ['--danger', '--panel'], ['--ok', '--card'], ['--ok', '--panel'],
  ['--warn', '--card'], ['--warn', '--panel'], ['--error-fg', '--error-bg'],
  ['--chrome-fg', '--chrome-bg'], ['--chrome-muted', '--chrome-bg'], ['--chrome-fg', '--chrome-btn'],
  ['--accent', '--chrome-bg'], // titre « Gabarit »
  ['--nav-fg', '--nav-bg'], ['--nav-card-fg', '--nav-card'], ['--nav-alert-fg', '--nav-alert-bg'],
  ['--ok', '--nav-card'], // temps restant, arrivée
  ['--nav-rule-fg', '--nav-rule-bg'],
  // Phase 2c : pastille de la rue. Déjà vérifiés plus haut : panneau du bas et boutons ronds (--fg, --muted, --ok sur
  // --card), vitesse dépassée (--danger sur --card), boutons choisis (--primary-fg sur --primary).
  ['--street-fg', '--street-bg'],
];
const LARGE = [
  ['--border', '--panel'], ['--border', '--card'], ['--border', '--bg'],
  ['--chrome-border', '--chrome-bg'], ['--focus', '--bg'], ['--focus', '--panel'],
  ['--nav-accent', '--nav-bg'], ['--route', '--route-casing'], ['--route-alt', '--route-alt-casing'],
  ['--fg', '--panel'], // contour des pastilles de couleur de la flèche (Réglages)
];

for (const [name, vars] of [['jour', day], ['nuit', night]]) {
  test(`contraste AA, ${name}`, () => {
    const bad = [];
    for (const [pairs, min] of [[TEXT, AA_TEXT], [LARGE, AA_LARGE]]) {
      for (const [f, b] of pairs) {
        assert.ok(vars[f] && vars[b], `variable manquante ${f} ou ${b}`);
        const r = contrastRatio(vars[f], vars[b]);
        if (!(r >= min)) bad.push(`${f} sur ${b} : ${r.toFixed(2)} < ${min}`);
      }
    }
    assert.deepEqual(bad, []);
  });
}

test('flèche du camion : contour visible sur son remplissage', () => {
  for (const c of [...Object.values(ARROW_COLORS), AUTO_ARROW.day, AUTO_ARROW.night]) {
    assert.ok(contrastRatio(c.fill, c.stroke) >= AA_LARGE, `${c.label} : ${c.fill} / ${c.stroke}`);
  }
  // Auto : ressort sur le fond du thème (crème le jour, presque noir la nuit).
  assert.ok(contrastRatio(AUTO_ARROW.day.fill, day['--panel']) >= AA_TEXT);
  assert.ok(contrastRatio(AUTO_ARROW.night.fill, night['--bg']) >= AA_TEXT);
});

test('phase 2c : panneau de limitation et bulles des rues lisibles', () => {
  assert.ok(contrastRatio('#000000', '#FFFFFF') >= AA_TEXT);
  assert.ok(contrastRatio('#C8102E', '#FFFFFF') >= AA_LARGE, 'bord rouge du panneau');
  // Pastille de la rue : jour noire texte crème, nuit ambre texte noir (demandé).
  assert.equal(day['--street-bg'], '#14161C');
  assert.equal(night['--street-bg'], '#E8A93B');
  assert.equal(night['--street-fg'], '#14161C');
});

// Phase 2d : carte de nuit à trois niveaux de luminosité (Sombre, Normal, Clair, src/lib/map-palette.js).
test('nuit : textes AA aux trois niveaux (libellés sur fond, terre et halo ; bulles des rues)', () => {
  for (const lv of NIGHT_LEVELS) {
    const p = NIGHT_PALETTES[lv];
    for (const v of Object.values(p)) assert.match(v, /^#[0-9A-F]{6}$/);
    for (const bg of ['background', 'land', 'halo']) {
      assert.ok(contrastRatio(p.label, p[bg]) >= AA_TEXT, `${lv} : libellés sur ${bg}`);
    }
    const b = NIGHT_BUBBLES[lv];
    assert.ok(contrastRatio(b.text, b.fill) >= AA_TEXT, `${lv} : bulles`);
    assert.ok(contrastRatio(PHOTO_NIGHT_LABEL.text, PHOTO_NIGHT_LABEL.halo) >= AA_TEXT);
  }
});

test('nuit Clair : tracé ambre et routes ≥ 3:1 sur le fond', () => {
  const p = NIGHT_PALETTES.light;
  assert.ok(contrastRatio(day['--route'], p.background) >= AA_LARGE, 'tracé ambre');
  assert.ok(contrastRatio(p.road, p.background) >= AA_LARGE, 'routes');
  assert.ok(contrastRatio(p.major, p.background) >= AA_LARGE, 'grands axes');
  for (const lv of NIGHT_LEVELS) assert.ok(contrastRatio(day['--route'], NIGHT_PALETTES[lv].background) >= AA_LARGE, `tracé ambre, ${lv}`);
});
