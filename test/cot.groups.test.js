// Rapport COT : groupes proposés dans le graphique des positions nettes et dans le sélecteur du COT Index.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const { render } = require('../tools/fake-dom.js');
const CALC = require('../calc.js');

const ROOT = path.join(__dirname, '..'), NOW = Date.parse('2026-09-25T20:00:00Z'), END = Date.UTC(2026, 8, 15);
const hist = Array.from({ length: 300 }, (_, i) => [new Date(END - (299 - i) * 7 * 864e5).toISOString().slice(0, 10), 100000 + i, 200000, 50000, 60000, 10000, 20000, 300000 + i]);
const tffHist = hist.map(r => [r[0], 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const disHist = hist.map(r => [r[0], 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const latestT = { report_date_as_yyyy_mm_dd: '2026-09-15T00:00:00.000' };

async function run(m, over = {}) {
  return render({ src: path.join(ROOT, 'cot.js'), fnName: 'renderCot', args: m, now: NOW, calc: CALC,
    overrides: { cot: async () => ({ latest: latestT, hist }), json: async url => (url.includes('/api/tff') ? { latest: latestT, hist: tffHist } : { latest: latestT, hist: disHist }), ...over } });
}
const chips = html => [...html.match(/<div class="chips" id="chips">[\s\S]*?<\/div>/)[0].matchAll(/<\/i>([^<]+)<\/button>/g)].map(m => m[1]);
const options = html => [...html.match(/<select class="btn" id="gsel">[\s\S]*?<\/select>/)[0].matchAll(/<option value="\w+">([^<]+)</g)].map(m => m[1]);
const TFF_GROUPES = ['Dealers / intermédiaires', 'Asset managers', 'Fonds à effet de levier', 'Autres déclarants'];

test('marché financier (TFF) : les positions nettes ne proposent que les 3 groupes Legacy', async () => {
  const { root } = await run({ name: 'Nasdaq 100 E-Mini', code: '209742', slug: 'nasdaq-100', tff: true, disagg: false }), html = root.innerHTML;
  assert.deepEqual(chips(html), ['Commerciaux', 'Grands spéculateurs', 'Petits traders']);
  for (const g of TFF_GROUPES) assert.ok(!chips(html).includes(g), g + ' encore proposé');
});

test('le sélecteur du COT Index suit : plus de groupes TFF non plus', async () => {
  const { root } = await run({ name: 'Nasdaq 100 E-Mini', code: '209742', slug: 'nasdaq-100', tff: true, disagg: false });
  assert.deepEqual(options(root.innerHTML), ['Commerciaux', 'Grands spéculateurs', 'Petits traders']);
});

test('le tableau et l\'analyse TFF restent affichés (seuls les groupes du graphique sont retirés)', async () => {
  const { root, el } = await run({ name: 'Nasdaq 100 E-Mini', code: '209742', slug: 'nasdaq-100', tff: true, disagg: false });
  const tff = el('#tffSec').innerHTML;
  assert.match(tff, /Traders in Financial Futures/); for (const g of TFF_GROUPES.slice(0, 3)) assert.ok(tff.includes(g), g + ' absent du tableau TFF');
  assert.match(tff, /id="tffLS"/);
  assert.ok(root.innerHTML.includes('id="cNet"'));
});

test('le graphique des positions nettes ne contient plus que 3 courbes possibles, Grands spéculateurs décoché par défaut', async () => {
  const { root, rec } = await run({ name: 'Nasdaq 100 E-Mini', code: '209742', slug: 'nasdaq-100', tff: true, disagg: false });
  assert.deepEqual(rec.charts['#cNet'].series.map(s => s.name), ['Commerciaux', 'Petits traders']);
  const c = chips(root.innerHTML); assert.deepEqual(c, ['Commerciaux', 'Grands spéculateurs', 'Petits traders']);
  assert.match(root.innerHTML, /data-k="l" data-c="[^"]*" aria-pressed="false"/); assert.match(root.innerHTML, /data-k="c" data-c="[^"]*" aria-pressed="true"/); assert.match(root.innerHTML, /data-k="s" data-c="[^"]*" aria-pressed="true"/);
});

test('matière première (Disaggregated) : les positions nettes ne proposent plus que les 3 groupes Legacy', async () => {
  const { root, el } = await run({ name: 'Gold', code: '088691', slug: 'gold', tff: false, disagg: true });
  assert.deepEqual(chips(root.innerHTML), ['Commerciaux', 'Grands spéculateurs', 'Petits traders']);
  assert.deepEqual(options(root.innerHTML), ['Commerciaux', 'Grands spéculateurs', 'Petits traders']);
  for (const g of ['Producteurs / négociants', 'Swap dealers', 'Managed money', 'Autres déclarants']) assert.ok(!chips(root.innerHTML).includes(g), g + ' encore proposé');
  assert.match(el('#disSec').innerHTML, /COT Disaggregated/);
});

test('le tableau et l\'analyse Disaggregated restent affichés (seul le graphique des positions nettes est réduit) ; managed money toujours calculé', async () => {
  const { el, rec } = await run({ name: 'Gold', code: '088691', slug: 'gold', tff: false, disagg: true });
  const dis = el('#disSec').innerHTML;
  assert.match(dis, /COT Disaggregated/); for (const g of ['Producteurs', 'Swap dealers', 'Managed money', 'Autres']) assert.ok(dis.includes(g), g + ' absent du tableau Disaggregated');
  assert.equal(rec.gauges.length, 4);                                                       // commerciaux 6/36 mois + managed money 6/36 mois, calculé à part
  assert.deepEqual(rec.charts['#cNet'].series.map(s => s.name), ['Commerciaux', 'Petits traders']);
});

test('camemberts TFF et Disaggregated : toutes les tranches portent un nom, donc l\'infobulle du survol s\'affiche', async () => {
  const calls = [];
  await run({ name: 'Euro FX', code: '099741', slug: 'euro-fx', tff: true, disagg: true }, { pie: (c, slices) => calls.push(slices) });
  assert.ok(calls.length >= 15, 'Legacy (5) + TFF (5) + Disaggregated (5) : ' + calls.length);
  for (const s of calls) assert.ok(s.every(x => typeof x.name === 'string' && x.name), JSON.stringify(s));
  const names = calls.map(s => s.map(x => x.name).join('/'));
  assert.ok(names.filter(n => n === 'Long/Spread/Short').length >= 8 && names.includes('Long/Short'), names.join(' | '));
});
