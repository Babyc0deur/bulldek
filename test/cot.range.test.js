// Rapport COT : la période affichée par défaut est 1 an, et le bouton actif correspond à la fenêtre réellement tracée.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const { render } = require('../tools/fake-dom.js');
const CALC = require('../calc.js');

const ROOT = path.join(__dirname, '..'), NOW = Date.parse('2026-09-25T20:00:00Z');
const M = { name: 'Gold', code: '088691', slug: 'gold', tff: false, disagg: false };
const END = Date.UTC(2026, 8, 15);
const hist = Array.from({ length: 400 }, (_, i) => [new Date(END - (399 - i) * 7 * 864e5).toISOString().slice(0, 10), 100000 + i, 200000, 50000, 60000, 10000, 20000, 300000 + i]);
const run = () => render({ src: path.join(ROOT, 'cot.js'), fnName: 'renderCot', args: M, now: NOW, calc: CALC,
  overrides: { cot: async () => ({ latest: { report_date_as_yyyy_mm_dd: '2026-09-15T00:00:00.000' }, hist }) } });
const jours = c => (c.xmax - c.xmin) / 864e5;

test('par défaut : 1 an sur les trois graphiques (positions nettes, open interest, COT Index)', async () => {
  const { rec } = await run();
  for (const id of ['#cNet', '#cOi', '#cIdx']) assert.ok(jours(rec.charts[id]) > 360 && jours(rec.charts[id]) < 370, `${id} : ${jours(rec.charts[id])} jours`);
});

test('le bouton « 1a » est le seul actif au chargement (classe et aria-pressed)', async () => {
  const { root } = await run(), boutons = [...root.innerHTML.match(/<div class="ranges" id="ranges"[\s\S]*?<\/div>/)[0].matchAll(/<button class="btn( on)?" data-m="(\d+)" aria-pressed="(true|false)">(\w+)</g)];
  assert.deepEqual(boutons.map(b => [b[4], !!b[1], b[3]]), [['6m', false, 'false'], ['1a', true, 'true'], ['2a', false, 'false'], ['3a', false, 'false']]);
});

test('les autres périodes restent disponibles : 6 mois, 2 ans, 3 ans', async () => {
  const { rec, el } = await run();
  for (const [m, min, max] of [['6', 175, 190], ['24', 725, 735], ['36', 1090, 1100], ['12', 360, 370]]) {
    el('#ranges').onclick({ target: { closest: () => ({ dataset: { m } }) } });
    assert.ok(jours(rec.charts['#cNet']) > min && jours(rec.charts['#cNet']) < max, `${m} mois : ${jours(rec.charts['#cNet'])} jours`);
  }
});
