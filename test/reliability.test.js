// Fiabilité des signaux : rejeu sans regarder le futur, statistiques, significativité et verdicts.
const test = require('node:test'), assert = require('node:assert/strict');
const R = require('../reliability.js'), CALC = require('../calc.js');

const DAY = 86400, iso = t => new Date(t * 1e3).toISOString().slice(0, 10);
// Séances du lundi au vendredi de 2012 à 2020, hausse régulière (+0,05 % par séance).
function daily(from = '2012-01-02', to = '2020-12-31', step = 0.0005) {
  const out = []; let c = 100;
  for (let t = Date.parse(from + 'T21:00:00Z') / 1e3; t <= Date.parse(to + 'T21:00:00Z') / 1e3; t += DAY) {
    const w = new Date(t * 1e3).getUTCDay(); if (w === 0 || w === 6) continue;
    c *= 1 + step; out.push([t, +c.toFixed(4), +(c * 1.003).toFixed(4), +(c * 0.997).toFixed(4)]);
  }
  return out;
}
// Rapports Legacy du mardi : [date, comm L, comm S, noncomm L, S, nonrept L, S, OI]. net(k) = position nette des commerciaux du k-ième rapport.
function legacy(net, from = '2012-01-03', to = '2020-12-29') {
  const out = []; let k = 0;
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 7 * 864e5, k++) out.push([iso(t / 1e3), 100000 + net(k), 100000, 0, 0, 0, 0, 500000]);
  return out;
}

test('statistiques : moyenne, médiane, part de hausses ; écart et t de Welch réduit par le chevauchement des horizons', () => {
  const s = R.stat([1, 2, 3, -1]);
  assert.equal(s.n, 4); assert.equal(s.mean, 1.25); assert.equal(s.median, 1.5); assert.equal(s.hit, 75);
  const a = R.stat([2, 3, 2, 3, 2, 3]), b = R.stat([0, 1, 0, 1, 0, 1]);
  const t5 = R.spreadTest(a, b, 5), t20 = R.spreadTest(a, b, 20);
  assert.equal(t5.spread, 2); assert.ok(Math.abs(t20.t - t5.t / 2) < 1e-9, 'horizon de 20 séances mesuré chaque semaine : 4 fois moins d\'observations indépendantes');
  assert.equal(R.verdict({ n: 20 }, { n: 20 }, 2.1).key, 'good'); assert.equal(R.verdict({ n: 20 }, { n: 20 }, -2.5).key, 'bad');
  assert.equal(R.verdict({ n: 20 }, { n: 20 }, 1.2).key, 'none'); assert.equal(R.verdict({ n: 14 }, { n: 40 }, 5).key, 'few');
});

test('sources COT : commerciaux Legacy par défaut ; fonds à levier du TFF lus à contre-sens', () => {
  assert.equal(R.cotSig('legacy', 90), 1); assert.equal(R.cotSig('tff-am', 90), 1); assert.equal(R.cotSig('tff-lev', 90), -1); assert.equal(R.cotSig('tff-lev', 10), 1);
  const tff = legacy(k => k).map(r => [r[0], 1, 2, 10 + r[1], 5, 3, 4, 0, 0, 0, 0]);
  assert.equal(R.cotSeries('tff-am', null, tff).at(-1).idx6, 100); assert.equal(R.cotSeries('legacy', null, tff), null);
  assert.equal(R.cotSeries('legacy', legacy(() => 0).slice(0, 10), null), null, 'moins de 30 rapports : pas de série');
});

test('rejeu sans regarder le futur : un rapport COT ne compte qu\'à partir de sa date de publication (vendredi, plus tard si férié)', () => {
  const rows = daily(), hist = legacy(() => 0);
  hist[hist.length - 20][1] += 50000;                                 // un seul rapport extrême (COT Index 100 %) vers la fin
  const special = hist[hist.length - 20][0], avail = CALC.cotReleaseDate(special).date;
  const list = R.samples({ rows, legacyHist: hist });
  assert.ok(list.length > 150, String(list.length));
  const before = list.filter(s => iso(s.t) < avail), after = list.filter(s => iso(s.t) >= avail);
  assert.ok(before.every(s => s.sig.cot === 0 || iso(s.t) < special), 'aucune semaine antérieure à la publication ne voit le rapport');
  assert.equal(before.filter(s => s.sig.cot === 1).length, 0);
  assert.equal(after[0].sig.cot, 1, 'la semaine de publication voit le rapport');
  assert.ok(list.every(s => new Date(s.t * 1e3).getUTCDay() === 5), 'mesure le vendredi soir (dernière séance de la semaine)');
});

test('rejeu : performance mesurée sur les séances suivantes ; saisonnalité d\'après les années antérieures uniquement (5 ans minimum)', () => {
  const rows = daily(), list = R.samples({ rows, legacyHist: legacy(k => k % 52) });
  const first = list[0], i = rows.findIndex(r => r[0] === first.t);
  assert.ok(Math.abs(first.fwd[5] - (rows[i + 5][1] / rows[i][1] - 1) * 100) < 1e-9);
  assert.ok(new Date(first.t * 1e3).getUTCFullYear() >= 2017, 'au moins 5 années complètes avant la première mesure : ' + iso(first.t));
  assert.ok(list.every(s => s.sig.season === 1), 'hausse régulière chaque année : saisonnalité haussière');
  assert.ok(list.every(s => s.score === s.sig.cot + s.sig.season + s.sig.wr + s.sig.oi));
});

test('synthèse : buckets de score, signaux et verdicts ; marché sans assez d\'historique → aucune mesure', () => {
  const rows = daily(), res = R.summarize(R.samples({ rows, legacyHist: legacy(k => (k % 30) * 10) }), 'legacy');
  assert.deepEqual(Object.keys(res.horizons).map(Number), R.HORIZONS);
  const H = res.horizons[5];
  assert.equal(H.scores.length, 9); assert.equal(H.scores.reduce((s, x) => s + x.n, 0), H.base.n);
  assert.ok(H.signals.cot && H.signals.season && H.signals.wr && H.signals.oi && H.signals.wrRaw && H.signals.trend);
  assert.equal(H.signals.trend.minus.n, 0, 'toujours au-dessus de la moyenne 200 séances');
  assert.equal(H.signals.season.verdict.key, 'few', 'jamais baissière : trop peu de cas pour comparer');
  assert.deepEqual(R.samples({ rows: rows.slice(0, 300), legacyHist: legacy(() => 0) }), []);
  assert.equal(R.summarize([]), null);
});
