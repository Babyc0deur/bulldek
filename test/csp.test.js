// Politique de sécurité stricte : ni script ni style en ligne. Le code envoyé au navigateur ne doit en produire aucun.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const ROOT = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CLIENT = fs.readdirSync(ROOT).filter(f => /\.(html|js|css)$/.test(f) && !/^(server|store|guard|cftc|freshness)\.js$/.test(f));

test('aucun attribut style ni bloc <style> dans le code envoyé au navigateur', () => {
  for (const f of CLIENT.filter(f => !f.endsWith('.css'))) {
    const t = read(f);
    assert.doesNotMatch(t, /\sstyle\s*=/i, `${f} : attribut style en ligne`);
    assert.doesNotMatch(t, /<style[\s>]/i, `${f} : bloc <style>`);
    assert.doesNotMatch(t, /setAttribute\(\s*['"]style['"]/, `${f} : setAttribute('style') est bloqué par la CSP`);
    assert.doesNotMatch(t, /\.cssText\s*=/, `${f} : cssText est bloqué par la CSP`);
  }
});

test('la CSP du serveur n\'autorise plus \'unsafe-inline\' nulle part', () => {
  const s = read('server.js'), csp = s.match(/'Content-Security-Policy': "([^"]+)"/)[1];
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|data:.*script/);
  assert.match(csp, /style-src 'self';/); assert.match(csp, /script-src 'self';/);
});

test('les couleurs dynamiques passent par data-c / data-bg puis applyColors (jamais par un attribut style)', () => {
  const shared = read('shared.js');
  assert.match(shared, /function applyColors/); assert.match(shared, /style\.setProperty\('--c'/);
  for (const f of ['cot.js', 'seasonal.js']) { const t = read(f); assert.match(t, /data-c="/, f); assert.match(t, /applyColors\(root\)/, f + ' doit appliquer les couleurs'); }
});

test('les classes utilitaires qui remplacent les anciens styles existent dans la feuille de style', () => {
  const css = read('shared.css');
  for (const c of ['\\.note\\.tight', '\\.note\\.center', 'canvas\\.mw520', 'canvas\\.mw640', '\\.pad', '\\.sw\\.line', '\\.sw\\.band', '\\.ttl', '\\.cur-page', '\\.warn-i', 'section\\{scroll-margin-top'])
    assert.match(css, new RegExp(c), c);
  for (const [f, cls] of [['cot.js', 'mw520'], ['cot.js', 'mw640'], ['cot.js', 'note center'], ['screener.js', 'note tight'], ['market.js', 'class="pad"']]) assert.ok(read(f).includes(cls), `${f} doit utiliser ${cls}`);
});
