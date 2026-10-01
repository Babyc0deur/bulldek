// Page de comparaison : le vrai code (compare.js) exécuté dans un faux DOM avec des données de corrélation connue.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { render } = require('../tools/fake-dom.js');
const CALC = require('../calc.js');

const ROOT = path.join(__dirname, '..'), NOW = Date.parse('2026-09-25T16:00:00Z');
const nq = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'nq-daily.json'), 'utf8'));
const A = { slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini', code: '209742' }, Bm = { slug: 'gold', name: 'Gold', code: '088691' };

// Marché B construit depuis A : mêmes dates, rendement B = k × rendement A (k = 1 → corrélation +1, k = −1 → −1).
const derive = (rows, k, start = 1000) => { let c = start; return rows.map((r, i) => { if (i) c *= 1 + k * (r[1] / rows[i - 1][1] - 1); return [r[0], c, c * 1.01, c * 0.99]; }); };
const cotHist = n => Array.from({ length: 300 }, (_, i) => [new Date(Date.UTC(2020, 0, 7) + i * 7 * 864e5).toISOString().slice(0, 10), 100 + ((i * n) % 90), 40 + (i % 13), 5, 5, 5, 5, 500]);
const sigRow = (over = {}) => ({ slug: 'x', name: 'x', group: 'Indices', price: 30798, chgPct: 0.1, idx6: 0, idx36: 21.2, wr: -12.7, roll: false,
  season: { n: 10, avgPct: -1.39, up: 4 }, sig: { cot: 0, season: -1, wr: -1, oi: -1 }, score: -3, oi: { last: 325784, chgPct: 10.38, priceChgPct: -1.98, key: 'trend-down', label: 'Baisse confirmée' }, fresh: 'ok', ...over });

async function run({ k = 1, rows = { a: sigRow(), b: sigRow({ price: 4300.5, chgPct: -0.4, idx36: 90, sig: { cot: 1, season: 1, wr: 0, oi: 1 }, score: 3, oi: { last: 500000, chgPct: -3.2, priceChgPct: 1.1, key: 'covering', label: 'Hausse fragile' }, roll: true }) }, dailyB } = {}) {
  const daily = { a: nq, b: dailyB || derive(nq, k) };
  return render({ src: path.join(ROOT, 'compare.js'), fnName: 'renderCompare', args: { a: A, b: Bm, daily, cot: { a: cotHist(7), b: cotHist(11) }, rows, now: NOW }, now: NOW, calc: CALC });
}
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('corrélation +1 : les trois fenêtres valent 1.00 et sont décrites « forte, même sens »', async () => {
  const { root } = await run({ k: 1 }), t = text(root.innerHTML);
  assert.match(t, /Corrélation 3 mois 1\.00 forte, même sens/); assert.match(t, /Corrélation 1 an 1\.00 forte, même sens/); assert.match(t, /Corrélation 3 ans 1\.00 forte, même sens/);
  assert.match(t, /évoluent de façon forte, même sens \(r = 1\.00\)/);
});

test('corrélation −1 : « forte, sens opposé »', async () => {
  const { root } = await run({ k: -1 }), t = text(root.innerHTML);
  assert.match(t, /Corrélation 1 an -1\.00 forte, sens opposé/);
});

test('corrélation faible : marché B indépendant', async () => {
  let s = 7; const r = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5;
  let c = 1000; const indep = nq.map((x, i) => { if (i) c *= 1 + 0.02 * r(); return [x[0], c, c, c]; });
  const { root } = await run({ dailyB: indep }), t = text(root.innerHTML);
  assert.match(t, /Corrélation 3 ans -?0\.0\d faible/);
});

test('deux marchés aux calendriers différents : la corrélation ne compte que les jours communs', async () => {
  const b = derive(nq, 1).filter((_, i) => i % 3 !== 0);                          // B n'a pas un jour sur trois
  const { root } = await run({ dailyB: b }), t = text(root.innerHTML);
  const communs = CALC.alignedReturns(nq, b).length;
  assert.ok(communs > 3000 && communs < nq.length);
  const attendu = (communs.toLocaleString('fr-FR') + ' jours de bourse communs').replace(/\s+/g, ' ');       // l'espace des milliers est insécable : on normalise comme le texte
  assert.ok(t.includes(attendu), 'nombre de jours communs affiché : ' + attendu);
});

test('performances : mêmes valeurs que CALC.performance, écart A − B', async () => {
  const { root } = await run({ k: 2 }), html = root.innerHTML, dB = derive(nq, 2);
  for (const [m, label] of [[1, '1 mois'], [12, '1 an'], [60, '5 ans']]) {
    const pa = CALC.performance(nq, m).pct, pb = CALC.performance(dB, m).pct, diff = pa - pb;
    const rowHtml = html.match(new RegExp('<th scope="row">' + label + '</th>[\\s\\S]*?</tr>'))[0], t = text(rowHtml);
    assert.ok(t.includes((pa > 0 ? '+' : '') + pa.toFixed(2) + ' %'), `${label} A : ${t}`);
    assert.ok(t.includes((pb > 0 ? '+' : '') + pb.toFixed(2) + ' %'), `${label} B : ${t}`);
    assert.ok(t.includes((diff > 0 ? '+' : '') + diff.toFixed(2) + ' pts'), `${label} écart : ${t}`);
  }
});

test('performance indisponible : historique plus court que la période', async () => {
  const court = derive(nq.slice(-300), 1);                                         // ~1 an d'historique
  const { root } = await run({ dailyB: court }), row = root.innerHTML.match(/<th scope="row">5 ans<\/th>[\s\S]*?<\/tr>/)[0];
  assert.match(text(row), /5 ans .*% – –/);                                        // A a 5 ans, B non : « – » et écart indisponible
});

test('signaux côte à côte : les 8 indicateurs des deux marchés, avec les mêmes règles que le screener', async () => {
  const { root } = await run(), html = root.innerHTML, t = text(html);
  for (const l of ['Prix', 'Variation du jour', 'COT Index 6 mois', 'COT Index 36 mois', 'Williams %R \\(14 j\\)', 'Saison de la semaine \\(20 ans max\\)', 'Confluence']) assert.match(t, new RegExp(l));
  assert.match(t, /30,798/); assert.match(t, /4,300\.5/);                           // prix formatés
  assert.match(t, /0 % Vente/); assert.match(t, /90 % Achat/);                      // COT Index 6 mois de A = 0 : Vente ; 36 mois de B = 90 : Achat
  assert.match(t, /-12\.7 Surachat/); assert.doesNotMatch(t, /hebdo/i);             // zones du Williams %R
  assert.match(t, /Non fiable/);                                                    // B a un changement de contrat récent
  assert.match(t, /-1\.39 % 4\/10 hausse/);
  assert.equal((html.match(/class="dot up"/g) || []).length, 3); assert.equal((html.match(/class="dot dn"/g) || []).length, 3);   // 4 points par marché : B a +1 +1 +1, A a −1 −1 −1
  assert.match(html, /sig sm buy">\+3/); assert.match(html, /sig sm sell">-3/);
  assert.match(t, /Open interest \(semaine\)/); assert.match(t, /\+10\.38 % Baisse confirmée/); assert.match(t, /-3\.20 % Hausse fragile/);
  assert.match(html, /aria-label="Open interest : baissier"/); assert.match(html, /aria-label="Open interest : haussier"/);
});

test('marché sans données côté screener : colonne « indisponible » sans planter', async () => {
  const { root } = await run({ rows: { a: sigRow(), b: { slug: 'gold', name: 'Gold', missing: true } } });
  assert.equal((text(root.innerHTML).match(/indisponible/g) || []).length >= 8, true);
});

test('graphiques : séries nommées, fenêtre d\'un an par défaut, boutons de période', async () => {
  const { rec, el } = await run();
  const span = () => (rec.charts['#cPerf'].xmax - rec.charts['#cPerf'].xmin) / 864e5;
  assert.ok(span() > 360 && span() < 370, 'un an par défaut : ' + span());
  const perf = rec.charts['#cPerf'].series; assert.deepEqual(perf.map(s => s.name), [A.name, Bm.name]);
  perf.forEach(s => assert.ok(Math.abs(s.data[0][1] - 100) < 1e-9, 'base 100 au début'));
  assert.equal(rec.charts['#cCorr'].series[0].data.length, CALC.rollingCorrelation(CALC.alignedReturns(nq, derive(nq, 1)), 63).length);
  assert.equal(rec.charts['#cCot'].series.length, 2);
  el('#rng').onclick({ target: { closest: () => ({ dataset: { m: '3' } }) } });
  assert.ok(span() > 88 && span() < 95, '3 mois : ' + span());
  el('#rng').onclick({ target: { closest: () => ({ dataset: { m: '120' } }) } });
  assert.ok(span() > 3600 && span() < 3660, '10 ans : ' + span());
  assert.equal(rec.charts['#cPerf'].series[0].data[0][1], 100);                     // la base 100 suit la fenêtre
});

test('gabarit : graphiques décrits, boutons à état, aucun style en ligne, en-têtes de tableau', async () => {
  const { root } = await run(), html = root.innerHTML, canvases = html.match(/<canvas[^>]*>/g);
  assert.equal(canvases.length, 3);
  canvases.forEach(c => { assert.match(c, /role="img"/); assert.match(c, /aria-label="[^"]{40,}"/); assert.ok(c.includes('Nasdaq') || c.includes('Gold'), 'la description nomme les marchés'); });
  assert.match(html, /aria-pressed="true"/); assert.doesNotMatch(html, /\sstyle=/);
  assert.match(html, /<th scope="col"/); assert.match(html, /<th scope="row"/);
});
