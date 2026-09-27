// Page Taux (macroview.js) : section « Courbe des taux américains » (5, 10, 30 ans sur un même graphique, données FRED via /api/yields).
// Harnais dédié (plutôt que tools/fake-dom.js) : cette section crée elle-même son élément (document.createElement + appendChild),
// ce que le faux DOM générique ne simule pas ; celui-ci fournit un document minimal mais capable (querySelector partagé).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SHARED_SRC = fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8');
const PAGE_SRC = fs.readFileSync(path.join(ROOT, 'macroview.js'), 'utf8');

function makeDom() {
  const store = {};
  function makeEl(sel) {
    return store[sel] ||= new Proxy({ __sel: sel, className: '', dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, children: [] }, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'querySelector') return s => makeEl(s);
        if (k === 'querySelectorAll') return () => [];
        if (k === 'appendChild') return child => { t.innerHTML = (t.innerHTML || '') + (child.innerHTML || ''); };
        if (k === 'setAttribute' || k === 'insertAdjacentHTML' || k === 'remove') return () => {};
        if (k === 'closest') return () => null;
        return undefined;
      },
      set(t, k, v) { t[k] = v; return true; },
    });
  }
  const document = { createElement: () => makeEl('#box' + Math.random()), querySelector: sel => makeEl(sel), body: { appendChild() {} }, hidden: false, getElementById: () => null };
  return { root: makeEl('#app'), document, makeEl };
}

// Charge shared.js puis macroview.js avec un BD dont lineChart enregistre les séries dessinées ; `json` sert /api/yields (et /api/macro si besoin).
function load({ json, now = Date.parse('2026-09-27T10:00:00Z') } = {}) {
  const { root, document } = makeDom();
  const BD = new Function(SHARED_SRC + '\nreturn BD;')();
  const rec = { charts: {} };
  BD.lineChart = (canvas, o) => { rec.charts[canvas.__sel] = { series: [] }; return { redraw(p) { const c = rec.charts[canvas.__sel]; if (p && p.series) c.series = p.series.map(s => ({ name: s.name, color: s.color, data: s.data })); if (p && p.xmin != null) { c.xmin = p.xmin; c.xmax = p.xmax; } } }; };
  BD.json = json;
  class MockDate extends Date { constructor(...a) { a.length ? super(...a) : super(now); } static now() { return now; } }
  const fn = new Function('BD', 'document', 'Date', 'addEventListener', 'setInterval', PAGE_SRC + '\nreturn renderUsCurve;')(BD, document, MockDate, () => {}, () => 0);
  return { run: () => fn(root), root, rec };
}

const day = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const series = (n, f, endY = 2026, endM = 8, endD = 25) => { const end = Date.UTC(endY, endM, endD); return Array.from({ length: n }, (_, i) => { const t = new Date(end - (n - 1 - i) * 7 * 864e5); return [t.toISOString().slice(0, 10), f(i)]; }); };
const DATA = { us5y: series(60, i => 4 + i / 200), us10y: series(60, i => 4.5 + i / 150), us30y: series(60, i => 5 + i / 100) };

test('trois séries (5, 10, 30 ans) sur un seul graphique, dans cet ordre, avec leurs couleurs propres', async () => {
  const { run, rec, root } = load({ json: async () => ({ data: DATA }) });
  await run();
  const s = rec.charts['#usChart'].series;
  assert.deepEqual(s.map(x => x.name), ['5 ans', '10 ans', '30 ans']);
  assert.equal(new Set(s.map(x => x.color)).size, 3, 'trois couleurs distinctes');
  assert.ok(s.every(x => x.data.length > 0));
  assert.match(root.innerHTML, /Courbe des taux américains/); assert.match(root.innerHTML, /DGS5, DGS10 et DGS30/);
  assert.doesNotMatch(root.innerHTML, /\sstyle=/);
});

test('indicateurs : dernière valeur de chaque maturité', async () => {
  const { run, root } = load({ json: async () => ({ data: DATA }) });
  await run();
  const t = root.querySelector('#usK').innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.match(t, /5 ans \d,\d\d %/); assert.match(t, /10 ans \d,\d\d %/); assert.match(t, /30 ans \d,\d\d %/);
});

test('fenêtre par défaut : 5 ans (60 mois), bouton actif ; le changement de période redessine', async () => {
  const { run, rec, root } = load({ json: async () => ({ data: DATA }) });
  await run();
  assert.match(root.innerHTML, /data-m="60" aria-pressed="true"/);
  const span1 = rec.charts['#usChart'].xmax - rec.charts['#usChart'].xmin;
  root.querySelector('#usRng').onclick({ target: { closest: () => ({ dataset: { m: '12' } }) } });
  const span2 = rec.charts['#usChart'].xmax - rec.charts['#usChart'].xmin;
  assert.ok(span2 < span1);
});

test('données indisponibles (erreur réseau ou absence de us10y) : message clair, aucune exception', async () => {
  const { run: r1, root: root1 } = load({ json: async () => { throw new Error('hors ligne'); } });
  await r1(); assert.match(root1.querySelector('#usMsg').innerHTML, /indisponibles/);
  const { run: r2, root: root2 } = load({ json: async () => ({ data: { us5y: DATA.us5y } }) });
  await r2(); assert.match(root2.querySelector('#usMsg').innerHTML, /indisponibles/);
});

test('section secondaire de la page Taux : son échec n\'empêche pas le reste (vérifié via bootMacro)', async () => {
  const { root, document } = makeDom();
  const BD = new Function(SHARED_SRC + '\nreturn BD;')();
  BD.lineChart = () => ({ redraw() {} });
  let calls = 0;
  BD.json = async u => { calls++; if (u.startsWith('/api/macro')) return { areas: [{ code: 'USA', name: 'États-Unis', ccy: 'USD' }], data: { immediate: { USA: [['2026-08', 3.6]] }, short: {}, long: {} } }; throw new Error('FRED indisponible'); };
  document.body = { dataset: { kind: 'rates' } };
  const fn = new Function('BD', 'document', 'addEventListener', 'setInterval', PAGE_SRC + '\nreturn bootMacro;')(BD, document, () => {}, () => 0);
  await fn();
  assert.match(root.querySelector('#mTitle').textContent, /Taux d'intérêt/); assert.match(root.querySelector('#usMsg').innerHTML, /indisponibles/); assert.ok(calls >= 2, 'les deux sources ont été appelées');
});
