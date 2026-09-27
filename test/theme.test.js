// theme.js exécuté avec un faux navigateur : thème par défaut Terminal, choix mémorisé, valeurs altérées ignorées, stockage bloqué toléré.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const CODE = fs.readFileSync(path.join(__dirname, '..', 'theme.js'), 'utf8');

// Faux environnement : document minimal, localStorage configurable, location.reload espionné.
function env({ store = {}, throws = false, bar = true } = {}) {
  const attrs = {}, created = [], reloads = [], log = [], state = { observed: null };
  const mk = tag => ({ tag, children: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; }, set textContent(v) { this._t = v; }, get textContent() { return this._t; } });
  const barEl = mk('div'), byId = {};
  const document = {
    readyState: 'complete', documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: k => attrs[k] },
    createElement: t => { const e = mk(t); created.push(e); return e; },
    getElementById: id => byId[id] || null,
    querySelector: sel => (sel === '.top .bar' && bar ? barEl : null),
    addEventListener() {},
  };
  const localStorage = {
    getItem: k => { if (throws) throw new Error('bloqué'); log.push(['get', k]); return k in store ? store[k] : null; },
    setItem: (k, v) => { if (throws) throw new Error('bloqué'); log.push(['set', k, v]); store[k] = String(v); },
    removeItem: k => { if (throws) throw new Error('bloqué'); log.push(['remove', k]); delete store[k]; },
  };
  const location = { reload: () => reloads.push(1) };
  const MutationObserver = function (cb) { this.observe = () => { state.observed = cb; }; this.disconnect = () => {}; };
  const origCreate = document.createElement;
  document.createElement = t => { const e = origCreate(t); return new Proxy(e, { set(o, k, v) { o[k] = v; if (k === 'id') byId[v] = o; return true; } }); };
  new Function('document', 'localStorage', 'location', 'MutationObserver', CODE)(document, localStorage, location, MutationObserver);
  const sel = byId.themeSel;
  return { attrs, store, log, reloads, barEl, sel, byId, state, options: sel ? sel.children.map(o => [o.value, o.textContent, o.selected]) : [] };
}

test('sans choix mémorisé : Terminal est appliqué (thème par défaut)', () => {
  const e = env();
  assert.equal(e.attrs['data-theme'], 'terminal');
  assert.equal(e.log.filter(l => l[0] !== 'get').length, 0, 'rien n\'est écrit tant que le visiteur n\'a rien choisi');
});

test('un thème mémorisé est appliqué dès le chargement', () => {
  for (const t of ['papier', 'nordique', 'graphite', 'indigo', 'actuel', 'terminal']) assert.equal(env({ store: { 'bulldesk-theme': t } }).attrs['data-theme'], t);
});

test('valeur mémorisée altérée ou inconnue : ignorée, thème par défaut', () => {
  for (const v of ['', 'PAPIER', 'inconnu', '<script>alert(1)</script>', '"; DROP', 'terminal ', '__proto__', 'constructor'])
    assert.equal(env({ store: { 'bulldesk-theme': v } }).attrs['data-theme'], 'terminal', JSON.stringify(v));
});

test('stockage local bloqué (navigation privée) : aucune exception, thème par défaut, le menu reste utilisable', () => {
  const e = env({ throws: true });
  assert.equal(e.attrs['data-theme'], 'terminal');
  e.sel.value = 'papier'; e.sel.onchange();                                       // le choix s'applique pour la page en cours, sans recharger (il serait perdu)
  assert.equal(e.attrs['data-theme'], 'papier'); assert.equal(e.reloads.length, 0);
});

test('menu : six thèmes, le thème actif est sélectionné, un libellé accessible est associé', () => {
  const e = env({ store: { 'bulldesk-theme': 'indigo' } });
  assert.deepEqual(e.options.map(o => o[0]), ['terminal', 'papier', 'nordique', 'graphite', 'indigo', 'actuel']);
  assert.deepEqual(e.options.filter(o => o[2]).map(o => o[0]), ['indigo']);
  assert.equal(e.barEl.children.length, 1);
  const label = e.barEl.children[0].children[0]; assert.equal(label.attrs.for, 'themeSel');
  assert.match(e.barEl.children[0].children[0].textContent, /Thème/);
});

test('choisir un thème : mémorisé sous une seule clé, appliqué, page rechargée pour redessiner les graphiques', () => {
  const e = env();
  e.sel.value = 'graphite'; e.sel.onchange();
  assert.deepEqual(e.log.filter(l => l[0] === 'set'), [['set', 'bulldesk-theme', 'graphite']]);
  assert.equal(e.attrs['data-theme'], 'graphite'); assert.equal(e.reloads.length, 1);
});

test('revenir au thème par défaut efface la mémorisation (rien ne reste dans le navigateur)', () => {
  const e = env({ store: { 'bulldesk-theme': 'papier' } });
  e.sel.value = 'terminal'; e.sel.onchange();
  assert.deepEqual(e.store, {}); assert.equal(e.attrs['data-theme'], 'terminal'); assert.equal(e.reloads.length, 1);
});

test('seule la clé bulldesk-theme est utilisée, jamais une autre', () => {
  const e = env({ store: { 'bulldesk-theme': 'papier', autre: 'x' } }); e.sel.value = 'indigo'; e.sel.onchange();
  assert.ok(e.log.every(l => l[1] === 'bulldesk-theme'), JSON.stringify(e.log)); assert.equal(e.store.autre, 'x');
});

test('barre absente au chargement (fiche marché) : le menu est ajouté dès qu\'elle apparaît', () => {
  const e = env({ bar: false });
  assert.equal(e.sel, undefined); assert.equal(e.attrs['data-theme'], 'terminal');         // le thème est appliqué même sans menu
  assert.equal(typeof e.state.observed, 'function', 'un observateur attend la barre');
});

test("barre déjà présente : aucun observateur inutile n'est créé", () => {
  assert.equal(env().state.observed, null);
});
