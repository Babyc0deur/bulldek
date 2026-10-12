// Rendements, courbe, taux réels, VIX (FRED) : analyse du CSV, variations, corrélations glissantes avec le prix, et intégration au débrief.
const test = require('node:test'), assert = require('node:assert/strict');
const Y = require('../yields.js'), CALC = require('../calc.js');

const NOW = Date.parse('2026-09-28T08:00:00Z');
const market = { slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini' };
const day = i => new Date(Date.UTC(2026, 5, 1) + i * 864e5).toISOString().slice(0, 10);

test('adresses : une requête par série (plusieurs séries = ZIP), 12 séries, fenêtre de 6 ans', () => {
  const u = Y.yieldsUrls(NOW);
  assert.deepEqual(u.map(x => x[0]), ['us2y', 'us5y', 'us10y', 'us30y', 'curve', 'real10y', 'breakeven', 'vix', 'vix3m', 'pceLevel', 'pceCoreLevel', 'dxy']);
  for (const [, url] of u) { assert.match(url, /^https:\/\/fred\.stlouisfed\.org\/graph\/fredgraph\.csv\?id=[A-Z0-9]+&cosd=2020-01-01$/); assert.ok(!url.includes(',')); }
});

test('CSV FRED : valeurs manquantes (« . » ou vide) ignorées, arrondi, série vérifiée', () => {
  assert.deepEqual(Y.parseSeries('observation_date,DGS10\n2026-09-22,5.11\n2026-09-23,.\n2026-09-24,5.183456\n2026-09-25,\r\n', 'DGS10'), [['2026-09-22', 5.11], ['2026-09-24', 5.1835]]);
  assert.throws(() => Y.parseSeries('observation_date,DGS2\n2026-09-22,4.8', 'DGS10'), /inattendue/);
  assert.throws(() => Y.parseSeries('PK\u0003\u0004binaire', 'DGS10'), /inattendue/);
  assert.throws(() => Y.parseSeries('observation_date,DGS10\n2026-09-22,.', 'DGS10'), /vide/);
  const all = Y.parseYields([['us10y', 'observation_date,DGS10\n2026-09-24,5.18'], ['vix', 'observation_date,VIXCLS\n2026-09-22,14.21']]);
  assert.deepEqual(all, { us10y: [['2026-09-24', 5.18]], vix: [['2026-09-22', 14.21]] });
  assert.throws(() => Y.parseYields([['us10y', 'observation_date,DGS2\n2026-09-24,5.18']]), /inattendue/);
});

test('variation sur n observations : dernière valeur, écart, série trop courte', () => {
  const s = [['a', 1], ['b', 1.5], ['c', 2.25]];
  assert.deepEqual(Y.change(s, 2), { date: 'c', value: 2.25, delta: 1.25 }); assert.equal(Y.change(s, 5).delta, null); assert.equal(Y.change([], 1), null); assert.equal(Y.change(undefined, 1), null);
});

// Prix construit pour être parfaitement lié à la série : rendement du jour = k × variation de la série.
function linked(k, n = 80) {
  const series = [], daily = []; let v = 4, close = 1000;
  for (let i = 0; i < n; i++) {
    const step = i === 0 ? 0 : Math.sin(i * 1.3) * 0.05 + (i % 7) * 0.004;                // variation quotidienne de la série (pas constante)
    v += step; if (i) close *= 1 + k * step / 100;
    series.push([day(i), v]); daily.push([Date.parse(day(i) + 'T13:30:00Z') / 1e3, close, close, close]);
  }
  return { series, daily };
}

test('corrélation glissante : +1 si lié dans le même sens, −1 si en sens inverse, 60 séances communes', () => {
  const up = linked(1), dn = linked(-1);
  const a = Y.assetCorrelation(up.daily, up.series, CALC.correlation), b = Y.assetCorrelation(dn.daily, dn.series, CALC.correlation);
  assert.ok(a.r > 0.999 && a.n === 60); assert.ok(b.r < -0.999 && b.n === 60);
  assert.equal(Y.assetCorrelation(up.daily, up.series, CALC.correlation, 30).n, 30);
});

test('corrélation : seules les dates communes comptent ; trop peu de données ou série constante → null', () => {
  const { series, daily } = linked(1);
  const trous = series.filter((_, i) => i % 2 === 0);                                       // une date sur deux : rendements calculés entre dates communes
  assert.ok(Y.assetCorrelation(daily, trous, CALC.correlation).n <= 40);
  assert.equal(Y.assetCorrelation(daily.slice(0, 10), series.slice(0, 10), CALC.correlation), null);
  assert.equal(Y.assetCorrelation(daily, series.map(([d]) => [d, 4]), CALC.correlation), null);
  assert.equal(Y.assetCorrelation(null, series, CALC.correlation), null); assert.equal(Y.assetCorrelation(daily, undefined, CALC.correlation), null);
});

test('force de la corrélation : faible < 0,3 ≤ modérée < 0,6 ≤ forte', () => {
  assert.deepEqual([0.1, -0.29, 0.3, -0.59, 0.6, -0.9].map(Y.strength), ['faible', 'faible', 'modérée', 'modérée', 'forte', 'forte']);
});

// ---------- intégration au débrief ----------
function yieldsFixture(k) {
  const { series, daily } = linked(k), vix = series.map(([d, v]) => [d, 15 + (v - 4) * 3]);
  const last = series.at(-1)[0];
  const pceYoy = [['2026-06-01', 3.5], ['2026-07-01', 3.4]], pceCoreYoy = [['2026-06-01', 3.3], ['2026-07-01', 3.34]], dxy = series.map(([d, v]) => [d, 118 + (v - 4)]);
  return { daily, yields: { us10y: series, us2y: series.map(([d, v]) => [d, v - 0.3]), curve: [[last, 0.36]], real10y: [[last, 2.85]], breakeven: [[last, 2.34]], vix, pceYoy, pceCoreYoy, dxy } };
}
const row = (o = {}) => ({ slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini', fresh: 'ok', roll: false, price: 24500, chgPct: 0.1, priceDate: Date.parse('2026-09-25T00:00:00Z') / 1e3, group: 'Indices',
  wr: -50, idx36: 50, idx6: 50, score: 0, sig: { cot: 0, season: 0, wr: 0, oi: 0 }, season: null, oi: null, ...o });
const paragraphe = d => d.story.find(p => p.title === 'Rendements, volatilité et corrélations').text;

test('yoyFromIndex : variation sur un an d\'une série mensuelle en niveau ; sans le même mois un an plus tôt → exclu', () => {
  const s = [['2025-01-01', 100], ['2025-06-01', 102], ['2026-01-01', 104], ['2026-06-01', 107.1]];
  assert.deepEqual(Y.yoyFromIndex(s), [['2026-01-01', 4], ['2026-06-01', 5]]);
  assert.deepEqual(Y.yoyFromIndex([['2025-01-01', 100], ['2025-06-01', 102]]), []);
});

test('parseYields : pceYoy et pceCoreYoy calculées à partir des niveaux PCEPI/PCEPILFE ; absentes si la série n\'est pas demandée', () => {
  const pce = 'observation_date,PCEPI\n2025-07-01,120\n2026-07-01,124.8', core = 'observation_date,PCEPILFE\n2025-07-01,118\n2026-07-01,121.54';
  const out = Y.parseYields([['pceLevel', pce], ['pceCoreLevel', core]]);
  assert.deepEqual(out.pceYoy, [['2026-07-01', 4]]); assert.deepEqual(out.pceCoreYoy, [['2026-07-01', 3]]);
  assert.equal(Y.parseYields([['us10y', 'observation_date,DGS10\n2026-09-24,5.18']]).pceYoy, undefined);
});
