// Pages Inflation / Taux (macroview.js) exécutées dans un faux DOM.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const { render } = require('../tools/fake-dom.js');

const ROOT = path.join(__dirname, '..'), NOW = Date.parse('2026-09-25T12:00:00Z');
const AREAS = [{ code: 'USA', name: 'États-Unis', ccy: 'USD' }, { code: 'EA20', name: 'Zone euro', ccy: 'EUR' }, { code: 'JPN', name: 'Japon', ccy: 'JPY' }];
const mois = n => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(2021, 8 + i, 1)); return d.toISOString().slice(0, 7); });
const ser = (n, f) => mois(n).map((p, i) => [p, f(i)]);
const PAYLOAD = { areas: AREAS, data: { yoy: { USA: ser(60, i => 2 + i / 30), EA20: ser(60, i => 1 + i / 40) }, mom: { USA: ser(60, () => 0.2) } } };
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const run = (payload = PAYLOAD, kind = 'cpi', pick) => render({ src: path.join(ROOT, 'macroview.js'), fnName: '((a, root) => renderMacro(a.kind, a.payload, root, a.pick))', args: { kind, payload, pick }, now: NOW, calc: {} });

test('inflation : deux zones, mesure annuelle, fenêtre de 5 ans par défaut, dernières valeurs en indicateurs', async () => {
  const { rec, root } = await run(), html = root.innerHTML;
  const s = rec.charts['#mChart'].series;
  assert.deepEqual(s.map(x => x.name), ['États-Unis', 'Zone euro']);
  assert.equal(s[0].data.length, 60); assert.ok(s[0].data.every(p => p[0] > 1e12));
  assert.match(html, /Zone A/); assert.match(html, /Variation annuelle \(%\)/); assert.match(html, /Source : OCDE \(indices des prix/);
  assert.doesNotMatch(html, /\sstyle=/); assert.match(html, /aria-pressed="true"/); assert.match(html, /<canvas id="mChart" role="img" aria-label="[^"]{30,}"/);
});

test('inflation : zones sans donnée non proposées ; une seule zone si B = aucune', async () => {
  const { root, el } = await run(PAYLOAD, 'cpi', { a: 'USA', b: '' }), html = root.innerHTML;
  assert.doesNotMatch(html, /Japon/); assert.match(html, /<select id="mB" class="btn selB"><option value="">Aucune/);
  assert.doesNotMatch(el('#mTbl').innerHTML, /Zone euro/); assert.match(el('#mTbl').innerHTML, /États-Unis/);
});

test('taux : mesures immédiat / court / long terme proposées', async () => {
  const p = { areas: AREAS, data: { immediate: { USA: ser(30, () => 3.6) }, short: {}, long: {} } };
  const { root, el } = await run(p, 'rates', { b: '' });
  assert.match(root.innerHTML, /Taux immédiat/); assert.match(root.innerHTML, /Court terme, 3 mois/); assert.match(root.innerHTML, /Long terme/); assert.match(el('#mTitle').textContent, /^Taux d'intérêt – Taux immédiat/);
});

test('source indisponible (data = null) : message clair, pas d\'exception', async () => {
  const { el } = await run({ areas: AREAS, data: null });
  assert.match(el('#msg').textContent, /indisponibles/);
});

test('première récupération en cours (loading) : message d’attente, pas d’erreur', async () => {
  const { el } = await run({ areas: AREAS, data: null, loading: true });
  assert.match(el('#msg').textContent, /Première récupération des données OCDE en cours/);
  assert.notEqual(el('#msg').className, 'err');
});
