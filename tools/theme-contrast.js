// Affiche les contrastes WCAG de chaque thème de themes.css (texte, texte secondaire, accent, couleurs de signal) sur fond et cartes.
const fs = require('fs'), path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'themes.css'), 'utf8');
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const m of css.matchAll(/\[data-theme="([a-z]+)"\]\{([^}]*)\}/g)) {
  const v = Object.fromEntries([...m[2].matchAll(/--([\w-]+):(#[0-9a-f]{6})/gi)].map(x => [x[1], x[2]]));
  const rows = [['text', 'bg'], ['text', 'panel'], ['muted', 'bg'], ['muted', 'panel'], ['accent', 'bg'], ['accent', 'panel'], ['gold', 'panel'], ['redl', 'panel'], ['greenl', 'panel'], ['bluel', 'panel']];
  console.log(m[1].padEnd(9), rows.map(([f, b]) => `${f}/${b} ${ratio(v[f], v[b]).toFixed(1)}`).join('  '));
}
