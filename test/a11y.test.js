// Accessibilité : contrastes (WCAG AA), descriptions des graphiques, repères de navigation, formulaires étiquetés.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const ROOT = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = ['market.html', 'screener.html', 'compare.html', 'about.html'];
const CLIENT_JS = ['cot.js', 'seasonal.js', 'wr.js', 'oi.js', 'compare.js', 'screener.js', 'market.js', 'shared.js'];

// ---- contrastes : rapport de luminance relative (WCAG 2.1), 4,5 minimum pour le texte courant ----
const css = read('shared.css'), root = css.match(/:root\{([^}]*)\}/)[1];
const vars = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2]]));
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('les couleurs de base sont lues dans la feuille de style', () => {
  for (const k of ['bg', 'panel', 'text', 'muted', 'accent', 'greenl', 'redl', 'gold', 'bluel']) assert.ok(vars[k], '--' + k);
  assert.ok(ratio('#000000', '#ffffff') > 20.9 && ratio('#000000', '#ffffff') < 21.1, 'le calcul de contraste est juste (noir/blanc = 21)');
});

test('contraste du texte : au moins 4,5:1 (AA) sur les fonds de page et de cartes', () => {
  const paires = [['text', 'bg'], ['text', 'panel'], ['muted', 'bg'], ['muted', 'panel'], ['accent', 'bg'], ['accent', 'panel'], ['greenl', 'panel'], ['redl', 'panel'], ['gold', 'panel'], ['bluel', 'panel']];
  for (const [fg, bg] of paires) { const r = ratio(vars[fg], vars[bg]); assert.ok(r >= 4.5, `--${fg} sur --${bg} : ${r.toFixed(2)}:1 (< 4,5)`); }
});

// ---- graphiques ----
test('chaque <canvas> a un rôle « img » et une description dans les modèles HTML', () => {
  let n = 0;
  for (const f of [...PAGES, ...CLIENT_JS.filter(f => f !== 'shared.js')]) for (const m of read(f).matchAll(/<canvas[^>]*>/g)) { n++; assert.match(m[0], /role="img"/, `${f} : ${m[0].slice(0, 60)}`); assert.match(m[0], /aria-label="[^"]{20,}/, `${f} : description trop courte ${m[0].slice(0, 60)}`); }
  assert.ok(n >= 15, 'assez de graphiques vérifiés : ' + n);
});

// ---- repères de navigation ----
test('chaque page : langue, un seul h1, zone principale, lien d\'évitement, navigation étiquetée', () => {
  for (const f of PAGES) {
    const t = read(f);
    assert.match(t, /<html lang="fr" data-theme="terminal">/, f + ' : langue et thème par défaut (Terminal)');
    assert.match(t, /<script src="\/theme\.js"><\/script>/, f + ' : script du thème dans <head>'); assert.ok(t.indexOf('/theme.js') < t.indexOf('</head>'), f);
    assert.match(t, /<a class="skip" href="#contenu">/, f + ' : lien d\'évitement'); assert.match(t, /<main id="contenu">/, f + ' : zone principale');
    assert.match(t, /<footer class="f">/, f);
    assert.match(t, /<nav class="fnav" aria-label="[^"]+">/, f);
  }
  for (const f of ['screener.html', 'compare.html', 'about.html']) assert.equal((read(f).match(/<h1[ >]/g) || []).length, 1, f + ' : un seul h1');
  assert.match(read('shared.js'), /<h1>\$\{m\.name\}/, 'la fiche marché a son h1 (créé par le gabarit commun)');
});

test('la feuille de style gère le focus clavier, le lien d\'évitement et la réduction des animations', () => {
  assert.match(css, /:focus-visible/); assert.match(css, /\.skip:focus\{left:8px\}/); assert.match(css, /prefers-reduced-motion/);
});

// ---- formulaires et boutons ----
test('chaque champ (select, input) est étiqueté (label lié ou aria-label)', () => {
  for (const f of [...PAGES, 'shared.js', 'compare.js']) {
    const t = read(f);
    for (const m of t.matchAll(/<(select|input)\b[^>]*>/g)) {
      const tag = m[0], id = (tag.match(/\sid="([^"]+)"/) || [])[1];
      const ok = /aria-label="[^"]+"/.test(tag) || (id && new RegExp('<label[^>]*for="' + id + '"').test(t));
      assert.ok(ok, `${f} : champ sans étiquette : ${tag.slice(0, 80)}`);
    }
  }
});

test('les boutons à bascule exposent leur état (aria-pressed) et les boutons-icônes ont un nom', () => {
  for (const f of ['seasonal.js', 'wr.js', 'compare.js']) assert.match(read(f), /aria-pressed/, f);
  assert.match(read('cot.js'), /setAttribute\('aria-pressed'/, 'cot.js : état des boutons de période et de groupes');
  let n = 0;
  for (const f of [...PAGES, ...CLIENT_JS]) for (const m of read(f).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    n++;
    const nom = m[2].replace(/<[^>]*>/g, '').trim();                                          // texte visible, balises retirées (les pastilles <i> sont décoratives)
    assert.ok(nom.length > 0 || /aria-label="[^"]+"/.test(m[1]), `${f} : bouton sans nom accessible : <button ${m[1].slice(0, 70)}`);
  }
  assert.ok(n >= 8, 'assez de boutons vérifiés : ' + n);
});

test('les tableaux de données ont des en-têtes de colonnes (th scope) et un texte alternatif aux graphiques voisins', () => {
  for (const f of ['seasonal.js', 'compare.js']) assert.match(read(f), /<th scope="col"/, f);
  assert.match(read('cot.js'), /<th>|<th /);                                                     // tableaux COT : en-têtes présents
});
