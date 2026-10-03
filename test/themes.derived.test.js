// Couleurs calculées à partir du thème (pastilles, badges) : lisibles dans chaque thème. Et plus aucune couleur figée dans le code.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const ROOT = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const THEMES = [...read('themes.css').matchAll(/\[data-theme="([a-z]+)"\]\{([^}]*)\}/g)].map(m => ({ nom: m[1], v: Object.fromEntries([...m[2].matchAll(/--([\w-]+):(#[0-9a-f]{6})/gi)].map(x => [x[1], x[2]])) }));
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = h => { const c = rgb(h).map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (fg, bg, pct) => '#' + rgb(fg).map((c, i) => Math.round(c * pct / 100 + rgb(bg)[i] * (100 - pct) / 100).toString(16).padStart(2, '0')).join('');   // color-mix(fg pct%, transparent) sur bg

test('badges de variation : texte blanc sur --green et --red, lisible dans chaque thème', () => {
  for (const t of THEMES) for (const c of ['green', 'red']) { const r = ratio('#ffffff', t.v[c]); assert.ok(r >= 4.5, `${t.nom} : blanc sur --${c} = ${r.toFixed(2)}:1`); }
});

test('pastilles de signal (Achat / Vente / Patience) : la couleur reste lisible sur sa propre teinte, sur une carte, dans chaque thème', () => {
  const POURCENT = { greenl: 15, redl: 15, gold: 12 };                                             // valeurs de .sig.buy / .sig.sell / .sig.wait dans shared.css
  const css = read('shared.css');
  for (const [k, p] of Object.entries(POURCENT)) assert.match(css, new RegExp('color-mix\\(in srgb,var\\(--' + k + '\\) ' + p + '%,transparent\\)'), k + ' ' + p + ' %');
  for (const t of THEMES) for (const k of Object.keys(POURCENT)) { const fond = mix(t.v[k], t.v.panel, POURCENT[k]), r = ratio(t.v[k], fond); assert.ok(r >= 4.5, `${t.nom} : --${k} sur sa teinte = ${r.toFixed(2)}:1`); }
});

test('lien d\'évitement : texte --bg sur fond --accent lisible dans chaque thème', () => {
  assert.match(read('shared.css'), /\.skip\{[^}]*background:var\(--accent\);color:var\(--bg\)/);
  for (const t of THEMES) { const r = ratio(t.v.bg, t.v.accent); assert.ok(r >= 4.5, `${t.nom} : ${r.toFixed(2)}:1`); }
});

test('aucune couleur figée dans le code des pages : tout passe par le thème (B.tc / B.alpha)', () => {
  for (const f of ['cot.js', 'seasonal.js', 'wr.js', 'oi.js', 'compare.js', 'screener.js', 'market.js']) {
    const t = read(f), figees = [...t.matchAll(/#[0-9a-fA-F]{6}\b|rgba?\([^)]*\)/g)].map(m => m[0]);
    assert.deepEqual(figees, [], `${f} : couleurs figées`);
  }
  const shared = read('shared.js').replace(/const FALLBACK = \{[\s\S]*?\};/, '');                       // seule exception : le repli hors navigateur (tests)
  assert.deepEqual([...shared.matchAll(/#[0-9a-fA-F]{6}\b|rgba\([^)]*\)/g)].map(m => m[0]).filter(c => !c.startsWith('rgba(\' +')), [], 'shared.js : couleurs figées hors repli');
});

test('shared.css : hors palette :root, seules quelques couleurs neutres sont figées (bouton « i », blanc des badges)', () => {
  const css = read('shared.css').replace(/:root\{[^}]*\}/, '');
  const figees = [...new Set([...css.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}(?![0-9a-fA-F])|rgba\(255,255,255,\.\d+\)/g)].map(m => m[0].toLowerCase()))].sort();
  assert.deepEqual(figees, ['#7a4c05', '#c98a1a', '#fff', 'rgba(255,255,255,.03)'].sort());
});

test('le thème par défaut du menu, celui des pages et celui de la CSS sont le même : Terminal', () => {
  assert.match(read('theme.js'), /DEFAULT = 'terminal'/);
  for (const f of ['market.html', 'screener.html', 'compare.html', 'about.html', 'themes.html', 'inflation.html', 'rates.html', 'intermarket.html']) assert.match(read(f), /<html lang="fr" data-theme="terminal">/, f);
  assert.ok(THEMES.some(t => t.nom === 'terminal'));
});
