// Chartes graphiques : chaque thème doit définir toutes les variables du site et respecter le contraste AA.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const ROOT = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const themesCss = read('themes.css'), sharedCss = read('shared.css');
const THEMES = [...themesCss.matchAll(/\[data-theme="([a-z]+)"\]\{([^}]*)\}/g)].map(m => ({ nom: m[1], vars: Object.fromEntries([...m[2].matchAll(/--([\w-]+):([^;}]+)/g)].map(x => [x[1], x[2].trim()])) }));
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const ROOT_VARS = Object.fromEntries([...sharedCss.match(/:root\{([^}]*)\}/)[1].matchAll(/--([\w-]+):(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2]]));
const FORME = ['font-body', 'font-head', 'radius', 'logo-weight'];

test('six thèmes définis (actuel + cinq propositions)', () => {
  assert.deepEqual(THEMES.map(t => t.nom), ['papier', 'terminal', 'nordique', 'graphite', 'indigo', 'actuel']);
});

test('chaque thème redéfinit TOUTES les couleurs de la feuille de style et les variables de forme', () => {
  for (const t of THEMES) {
    for (const k of Object.keys(ROOT_VARS)) assert.ok(t.vars[k] && /^#[0-9a-f]{6}$/i.test(t.vars[k]), `${t.nom} : --${k} manquante ou invalide`);
    for (const k of FORME) assert.ok(t.vars[k], `${t.nom} : --${k} manquante`);
  }
});

test('le thème « actuel » reproduit exactement les couleurs de shared.css (rappel fidèle)', () => {
  const actuel = THEMES.find(t => t.nom === 'actuel');
  for (const [k, v] of Object.entries(ROOT_VARS)) assert.equal(actuel.vars[k].toLowerCase(), v.toLowerCase(), '--' + k);
});

test('contraste AA (4,5:1 minimum) pour le texte et les couleurs de signal, dans chaque thème', () => {
  const paires = [['text', 'bg'], ['text', 'panel'], ['muted', 'bg'], ['muted', 'panel'], ['accent', 'bg'], ['accent', 'panel'], ['gold', 'panel'], ['redl', 'panel'], ['greenl', 'panel'], ['bluel', 'panel']];
  for (const t of THEMES) for (const [fg, bg] of paires) { const r = ratio(t.vars[fg], t.vars[bg]); assert.ok(r >= 4.5, `${t.nom} : --${fg} sur --${bg} = ${r.toFixed(2)}:1`); }
});

test('polices : piles système uniquement (aucune police externe : la CSP et l\'engagement de la page À propos l\'interdisent)', () => {
  assert.doesNotMatch(themesCss, /@font-face|@import|url\(|https?:\/\//);
  for (const t of THEMES) for (const k of ['font-body', 'font-head']) if (t.vars[k] !== 'inherit') assert.match(t.vars[k], /(system-ui|Georgia|monospace)/, `${t.nom} --${k}`);
});

test('shared.css lit les variables de forme et n\'a plus de couleurs de bordure codées en dur', () => {
  for (const k of FORME) assert.match(sharedCss, new RegExp('var\\(--' + k), '--' + k + ' non utilisée');
  assert.doesNotMatch(sharedCss, /#1d2a58|#12205a/);
});
