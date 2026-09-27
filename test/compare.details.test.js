// Comparaison : seuils des descriptions, fenêtres de corrélation et fenêtre du COT Index.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { render } = require('../tools/fake-dom.js');
const CALC = require('../calc.js');

const ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'compare.js'), NOW = Date.parse('2026-09-25T16:00:00Z');
const nq = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'nq-daily.json'), 'utf8'));
const corrWords = new Function(fs.readFileSync(SRC, 'utf8') + '\nreturn corrWords;')();

test('description de la corrélation : seuils exacts 0.3 et 0.7, dans les deux sens', () => {
  const cas = [[1, 'forte, même sens'], [0.7, 'forte, même sens'], [0.6999, 'modérée, même sens'], [0.3, 'modérée, même sens'], [0.2999, 'faible'],
    [0, 'faible'], [-0.2999, 'faible'], [-0.3, 'modérée, sens opposé'], [-0.6999, 'modérée, sens opposé'], [-0.7, 'forte, sens opposé'], [-1, 'forte, sens opposé'], [null, 'indisponible']];
  for (const [r, mots] of cas) assert.equal(corrWords(r), mots, `r = ${r}`);
});

const A = { slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini', code: '209742' }, B = { slug: 'gold', name: 'Gold', code: '088691' };
const row = { slug: 'x', name: 'x', price: 1, chgPct: 0, idx6: 50, idx36: 50, wr: -50, roll: false, season: { n: 10, avgPct: 0, up: 5 }, sig: { cot: 0, season: 0, wr: 0 }, score: 0 };
const run = (dailyB, cot) => render({ src: SRC, fnName: 'renderCompare', now: NOW, calc: CALC,
  args: { a: A, b: B, daily: { a: nq, b: dailyB }, cot, rows: { a: row, b: row }, now: NOW } });
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const cotHist = n => Array.from({ length: 300 }, (_, i) => [new Date(Date.UTC(2020, 0, 7) + i * 7 * 864e5).toISOString().slice(0, 10), 100 + ((i * n * 37) % 90), 40 + ((i * 11) % 23), 5, 5, 5, 5, 500]);

// B suit A pendant toute l'histoire SAUF les 100 dernières séances, où il évolue à l'inverse : les fenêtres 3 mois / 1 an / 3 ans donnent des corrélations très différentes.
function retournee() {
  let c = 1000; const cut = nq.length - 100;
  return nq.map((r, i) => { if (i) { const ra = r[1] / nq[i - 1][1] - 1; c *= 1 + (i < cut ? ra : -ra); } return [r[0], c, c, c]; });
}

test('chaque libellé de corrélation correspond à sa fenêtre (3 mois = 63 jours, 1 an = 252, 3 ans = 756)', async () => {
  const b = retournee(), pairs = CALC.alignedReturns(nq, b);
  const attendu = Object.fromEntries(CALC.rollingCorrelation === undefined ? [] : [[63, CALC.correlation(pairs.slice(-63))], [252, CALC.correlation(pairs.slice(-252))], [756, CALC.correlation(pairs.slice(-756))]]);
  assert.ok(attendu[63] < -0.9 && attendu[252] < attendu[756] && attendu[756] > 0.3, 'le scénario doit donner trois valeurs distinctes : ' + JSON.stringify(attendu));
  const { root } = await run(b, { a: cotHist(7), b: cotHist(11) }), t = text(root.innerHTML);
  for (const [w, label] of [[63, '3 mois'], [252, '1 an'], [756, '3 ans']]) {
    const v = attendu[w].toFixed(2), m = t.match(new RegExp('Corrélation ' + label + ' (-?\\d\\.\\d\\d)'));
    assert.ok(m, `KPI « ${label} » introuvable`);
    assert.equal(m[1], v, `${label} : la valeur affichée doit être celle de la fenêtre de ${w} jours`);
  }
  assert.match(t, new RegExp('évoluent de façon ' + corrWords(attendu[252])));                      // la phrase de synthèse parle de la fenêtre d'1 an
});

test('COT Index : fenêtre de 36 mois (156 semaines), sur les positions nettes commerciaux (longs − shorts)', async () => {
  const cot = { a: cotHist(7), b: cotHist(11) };
  const { rec } = await run(nq.map(r => [r[0], r[1] * 1.5, r[2], r[3]]), cot);
  for (const [k, hist] of [['a', cot.a], ['b', cot.b]]) {
    const net = hist.map(r => r[1] - r[2]), i36 = CALC.cotIndex(net, 156), i6 = CALC.cotIndex(net, 26), serie = rec.charts['#cCot'].series[k === 'a' ? 0 : 1].data;
    assert.equal(serie.length, hist.length);
    serie.forEach(([x, v], j) => { assert.equal(x, Date.parse(hist[j][0])); if (j % 40 === 0 || j === hist.length - 1) assert.ok(Math.abs(v - i36[j]) < 1e-9, `${k}[${j}] : ${v} vs ${i36[j]}`); });
    assert.notEqual(i36.at(-1).toFixed(3), i6.at(-1).toFixed(3), 'le jeu de test doit distinguer 6 mois et 36 mois');
  }
});
