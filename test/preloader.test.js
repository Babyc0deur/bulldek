// Écran de chargement (theme.js) : visible dès le départ, retiré quand plus aucune requête n'est en cours après « load », au plus tard après 12 s.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const CODE = fs.readFileSync(path.join(__dirname, '..', 'theme.js'), 'utf8');

// Faux navigateur : minuteries manuelles (avancer le temps avec tick), fetch contrôlé (promesses résolues à la main).
function env() {
  const classes = new Set(), attrs = {}, timers = [], listeners = {}, calls = [];
  let now = 0, id = 0;
  const document = { readyState: 'complete', addEventListener() {}, querySelector: () => null, getElementById: () => null, createElement: () => ({}),
    documentElement: { classList: { add: c => classes.add(c), remove: c => classes.delete(c) }, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; }, getAttribute: k => attrs[k] } };
  const setTimeout = (fn, ms) => { timers.push({ id: ++id, at: now + ms, fn }); return id; };
  const clearTimeout = i => { const k = timers.findIndex(t => t.id === i); if (k >= 0) timers.splice(k, 1); };
  const window = { fetch: () => { let r; const p = new Promise(res => { r = res; }); calls.push(r); return p; }, addEventListener: (e, f) => { listeners[e] = f; } };
  new Function('document', 'localStorage', 'location', 'MutationObserver', 'window', 'setTimeout', 'clearTimeout', CODE)(document, { getItem: () => null }, {}, function () { this.observe = () => {}; }, window, setTimeout, clearTimeout);
  const tick = async ms => { await Promise.resolve(); await Promise.resolve(); now += ms; for (const t of timers.filter(t => t.at <= now).sort((a, b) => a.at - b.at)) { clearTimeout(t.id); t.fn(); } };
  return { classes, attrs, window, listeners, calls, tick, loading: () => classes.has('bd-loading') };
}

test('visible dès le départ (aria-busy), retiré 150 ms après « load » si aucune requête n\'est en cours', async () => {
  const e = env();
  assert.equal(e.loading(), true); assert.equal(e.attrs['aria-busy'], 'true');
  e.listeners.load(); await e.tick(100); assert.equal(e.loading(), true);
  await e.tick(60); assert.equal(e.loading(), false); assert.equal(e.attrs['aria-busy'], undefined);
});

test('reste affiché tant qu\'une requête est en cours, y compris entre deux requêtes enchaînées', async () => {
  const e = env();
  e.window.fetch('/api/screener'); e.listeners.load(); await e.tick(500);
  assert.equal(e.loading(), true, 'requête en cours');
  e.calls[0]({ ok: true }); await e.tick(50); e.window.fetch('/api/seasonal'); await e.tick(200);
  assert.equal(e.loading(), true, 'la page a enchaîné une seconde requête');
  e.calls[1]({ ok: true }); await e.tick(200);
  assert.equal(e.loading(), false);
});

test('filet de sécurité : retiré au bout de 12 s si « load » n\'arrive jamais', async () => {
  const e = env();
  e.window.fetch('/api/x'); await e.tick(11000);
  assert.equal(e.loading(), true); await e.tick(1100); assert.equal(e.loading(), false, 'retiré au bout de 12 s');
});

test('section lente : retiré au plus tard 2,5 s après « load », même si une requête est encore en cours', async () => {
  const e = env();
  e.window.fetch('/api/debrief?slug=sp500'); e.listeners.load(); await e.tick(2400);
  assert.equal(e.loading(), true); await e.tick(150); assert.equal(e.loading(), false, 'la fiche s\'affiche ; le débrief garde son propre message');
});
