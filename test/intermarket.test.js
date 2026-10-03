// Analyse intermarchés (intermarket.js) : matrice de corrélations, lecture des relations classiques, changements de régime.
const test = require('node:test'), assert = require('node:assert/strict');
const I = require('../intermarket.js'), CALC = require('../calc.js');

// Générateur pseudo-aléatoire déterministe (rendements reproductibles d'un test à l'autre).
const rng = seed => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5; };
const DAY = 864e5, T0 = Date.UTC(2020, 0, 1);
// Série de clôtures construite à partir de rendements quotidiens (en %) ; `skip` retire des dates (calendriers différents).
const fromReturns = (rets, skip = () => false) => { let p = 100; return rets.map((r, i) => [(T0 + i * DAY) / 1e3, p *= 1 + r / 100]).filter((_, i) => !skip(i)); };
const walk = (n, seed, vol = 1) => { const g = rng(seed); return Array.from({ length: n }, () => g() * vol * 2); };

const N = 400, A = walk(N, 1), noise = walk(N, 7, 0.05);
const series = () => ({ sp500: fromReturns(A), 'nasdaq-100': fromReturns(A.map((r, i) => r * 1.2 + noise[i])), gold: fromReturns(A.map(r => -r)), copper: fromReturns(walk(N, 99)) });

test('matrice : diagonale = 1, symétrique, valeurs bornées ; marchés parfaitement liés → ≈ +1, opposés → ≈ −1', () => {
  const d = I.build(series(), CALC.correlation), idx = s => d.assets.findIndex(a => a.slug === s);
  for (const w of d.windows) {
    const m = d.matrix[w]; assert.equal(m.length, d.assets.length);
    for (let i = 0; i < m.length; i++) { assert.equal(m[i][i], 1); for (let j = 0; j < m.length; j++) { assert.equal(m[i][j], m[j][i]); if (m[i][j] != null) assert.ok(Math.abs(m[i][j]) <= 1); } }
  }
  assert.ok(d.matrix[250][idx('sp500')][idx('nasdaq-100')] > 0.99); assert.ok(d.matrix[250][idx('sp500')][idx('gold')] < -0.999);
  assert.ok(Math.abs(d.matrix.max[idx('sp500')][idx('copper')]) < 0.2, 'série indépendante : corrélation proche de zéro');
});

test('fenêtres : les 20/60/120/250 dernières séances et tout l\'historique ; « max » utilise toutes les observations communes', () => {
  const g = rng(5), half1 = Array.from({ length: 200 }, () => g() * 2), half2 = Array.from({ length: 200 }, () => g() * 2);
  const b = [...half1, ...half2.map(r => -r)], a = [...half1, ...half2];               // liés au début, opposés ensuite
  const d = I.build({ sp500: fromReturns(a), gold: fromReturns(b) }, CALC.correlation);
  assert.deepEqual(d.windows, [20, 60, 120, 250, 'max']);
  assert.ok(d.matrix[20][0][1] < -0.99 && d.matrix[120][0][1] < -0.99);                  // fenêtres récentes : seulement la seconde moitié
  assert.ok(Math.abs(d.matrix.max[0][1]) < 0.2, 'historique complet : les deux moitiés se compensent');
  assert.ok(d.matrix[250][0][1] < 0 && d.matrix[250][0][1] > -0.99);
});

test('calendriers différents : le calcul n\'utilise que les dates communes (week-ends crypto, jours fériés)', () => {
  const b = A.map((r, i) => r * 2);
  const d = I.build({ sp500: fromReturns(A, i => i % 7 === 5 || i % 7 === 6), gold: fromReturns(b) }, CALC.correlation);        // sp500 sans week-end
  assert.ok(d.matrix.max[0][1] > 0.6, 'liens conservés malgré les trous : ' + d.matrix.max[0][1]);
});

test('trop peu d\'observations communes (< 20) ou série constante → null, jamais une valeur inventée ; marché absent ignoré', () => {
  const flat = fromReturns(Array(120).fill(0));
  const d = I.build({ sp500: fromReturns(A), gold: flat, copper: fromReturns(A).slice(0, 30), bitcoin: undefined }, CALC.correlation);
  const names = d.assets.map(a => a.slug); assert.deepEqual(names, ['sp500', 'gold']);                 // copper (30 séances) et bitcoin (absent) écartés
  assert.equal(d.matrix[60][0][1], null);
  const court = I.build({ sp500: fromReturns(A), gold: fromReturns(A.map(r => -r)).slice(-65) }, CALC.correlation);
  assert.ok(court.matrix[60][0][1] != null && court.matrix[250][0][1] === court.matrix.max[0][1], 'fenêtre plus longue que les données : on prend tout ce qui existe');
});

test('lecture d\'une relation : conforme / inversée / faible, et régime comparé à l\'historique pour les relations changeantes', () => {
  const k = (e, r250, rMax) => I.readPair(e, r250, rMax).key;
  assert.equal(k(-1, -0.4, -0.3), 'ok'); assert.equal(k(1, 0.4, 0.3), 'ok');
  assert.equal(k(-1, 0.4, 0.1), 'flip'); assert.equal(k(1, -0.35, 0.2), 'flip');
  assert.equal(k(-1, -0.19, -0.3), 'weak'); assert.equal(k(1, 0.1, 0.1), 'weak');
  assert.equal(k(0, 0.3, -0.25), 'flip'); assert.equal(k(0, 0.3, 0.2), 'stable'); assert.equal(k(0, 0.1, -0.4), 'stable', 'lien récent trop faible pour parler d\'inversion');
  assert.equal(k(1, null, 0.3), 'na'); assert.equal(k(0, null, null), 'na');
  assert.equal(I.readPair(1, 0.5, 0.5).label, 'Conforme à la théorie');
});

test('relations classiques : seulement celles dont les deux marchés sont présents, avec 60 séances, 1 an et historique', () => {
  const d = I.build(series(), CALC.correlation);
  assert.deepEqual(d.pairs.map(p => p.a + '/' + p.b), ['copper/sp500']);                      // seule paire classique complète parmi ces 4 marchés (sp500, nasdaq-100, gold, copper)
  const full = {}; for (const s of I.SLUGS) full[s] = fromReturns(walk(300, s.length * 13));
  const all = I.build(full, CALC.correlation);
  assert.equal(all.pairs.length, I.PAIRS.length);
  for (const p of all.pairs) { assert.ok(p.aName && p.bName && p.why); assert.ok('r60' in p && 'r250' in p && 'rMax' in p); assert.ok(['ok', 'flip', 'weak', 'stable', 'na'].includes(p.status.key)); }
});

test('changements de régime : signe récent opposé à l\'historique avec des liens assez nets ; rien si la relation est stable', () => {
  const g = rng(11), base = Array.from({ length: 500 }, () => g() * 2);
  const flipped = base.map((r, i) => (i < 400 ? r : -r)), stable = base.map(r => r + 0.01);
  const d = I.build({ sp500: fromReturns(base), gold: fromReturns(flipped), copper: fromReturns(stable) }, CALC.correlation);
  const pairs = d.shifts.map(s => s.a + '/' + s.b);
  assert.ok(pairs.includes('sp500/gold') && !pairs.includes('sp500/copper'), pairs.join());
  const s = d.shifts.find(x => x.b === 'gold'); assert.ok(s.r60 < -0.3 && s.rMax > 0.15 && s.gap > 0.4);
  assert.deepEqual(I.build({ sp500: fromReturns(base), copper: fromReturns(stable) }, CALC.correlation).shifts, []);
  assert.ok(d.shifts.length <= 6);
});

test('date des données et horodatage ; aucun marché → structure vide sans exception', () => {
  const d = I.build(series(), CALC.correlation, 1234);
  assert.equal(d.updated, 1234); assert.match(d.asOf, /^\d{4}-\d{2}-\d{2}$/);
  const vide = I.build({}, CALC.correlation); assert.deepEqual(vide.assets, []); assert.equal(vide.asOf, null); assert.deepEqual(vide.pairs, []);
});

test('définitions : marchés existants dans markets.json, abréviations uniques, paires cohérentes', () => {
  const markets = require('../markets.json').map(m => m.slug);
  for (const s of I.SLUGS) assert.ok(markets.includes(s), s + ' absent de markets.json');
  assert.equal(new Set(I.ASSETS.map(a => a[2])).size, I.ASSETS.length, 'abréviations de colonnes uniques');
  for (const p of I.PAIRS) { assert.ok(I.SLUGS.includes(p.a) && I.SLUGS.includes(p.b) && p.a !== p.b); assert.ok([-1, 0, 1].includes(p.expect)); assert.ok(p.why.length > 20); }
});
