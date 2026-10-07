// Volatilité (VIX, structure, volatilité réalisée) et dates clés (FOMC, CPI, emploi, échéances et roll des futures sur indices).
const test = require('node:test'), assert = require('node:assert/strict');
const V = require('../vol.js'), K = require('../keydates.js'), N = require('../narrative.js');

const days = (n, f) => Array.from({ length: n }, (_, i) => [new Date(Date.UTC(2025, 9, 1) + i * 864e5).toISOString().slice(0, 10), f(i)]);
const spx = rets => { let c = 100; return [[0, c], ...rets.map((r, i) => [i + 1, c *= 1 + r])]; };

test('volatilité réalisée : nulle sur une hausse régulière, ≈ 16,3 % pour ±1 % un jour sur deux (écart-type d\'échantillon)', () => {
  assert.ok(V.realized(spx(Array(30).fill(0.001)), 20) < 1e-6);
  const rv = V.realized(spx(Array.from({ length: 30 }, (_, i) => (i % 2 ? 0.01 : -0.01))), 20);
  assert.ok(Math.abs(rv - 16.3) < 0.2, String(rv)); assert.equal(V.realized(spx([0.01]), 20), null);
});

test('niveaux et structure du VIX ; lecture en français', () => {
  assert.deepEqual([12, 17, 25, 35].map(v => V.level(v).key), ['calm', 'normal', 'tense', 'stress']);
  assert.deepEqual([0.85, 0.97, 1.05].map(r => V.structure(r).key), ['normal', 'flat', 'inverted']);
  const calm = V.volatility({ vix: days(300, i => 20 - i * 0.02), vix3m: [['2026-07-27', 16]], spx: spx(Array(40).fill(0.0005)) });
  assert.equal(calm.vix, 14.02); assert.equal(calm.level.key, 'calm'); assert.equal(calm.rank, 0, 'plus bas de l\'année');
  assert.equal(calm.structure.key, 'normal'); assert.match(calm.reading, /Le VIX est à 14 \(calme\), 0 % de sa fourchette sur 1 an, en baisse de 0,1 point sur 5 séances\./);
  assert.match(calm.reading, /structure est normale/); assert.match(calm.reading, /situation habituelle/);
  const stress = V.volatility({ vix: days(300, i => 15 + i * 0.1), vix3m: [['2026-07-27', 40]], spx: spx(Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.04 : -0.04))) });
  assert.equal(stress.structure.key, 'inverted'); assert.match(stress.reading, /structure est inversée/); assert.match(stress.reading, /plus agité que prévu/);
  assert.equal(V.volatility({ vix: [] }), null);
});

test('dates clés : vendredi saint, échéance avancée si la Bourse est fermée (Juneteenth 2026), roll 8 jours avant', () => {
  assert.deepEqual([2025, 2026, 2027].map(K.goodFriday), ['2025-04-18', '2026-04-03', '2027-03-26']);
  assert.equal(new Date(K.expiration(2026, 5)).toISOString().slice(0, 10), '2026-06-18', 'le 3e vendredi (19 juin) est férié : jeudi 18');
  assert.equal(new Date(K.expiration(2026, 11)).toISOString().slice(0, 10), '2026-12-18');
  const k = K.keyDates(Date.UTC(2026, 9, 5), 6), at = d => k.dates.filter(x => x.date === d).map(x => x.kind).sort();
  assert.deepEqual(at('2026-12-10'), ['cpi', 'roll']); assert.deepEqual(at('2026-12-18'), ['quad']); assert.deepEqual(at('2026-10-28'), ['fomc']);
  assert.deepEqual(at('2026-11-06'), ['nfp']); assert.deepEqual(at('2026-10-16'), ['opex']);
  assert.ok(k.dates.every(x => x.date >= '2026-10-05' && x.date <= '2027-04-05'), 'fenêtre de 6 mois');
  assert.ok(k.dates.find(x => x.date === '2026-12-09').detail.includes('projections'), 'réunion avec projections économiques');
  assert.equal(k.officialUntil.cpi, '2026-12-31');
});

test('débrief des indices : paragraphe volatilité et dates clés ; rien pour les autres marchés', () => {
  const vol = V.volatility({ vix: days(300, i => 20 - i * 0.02), vix3m: [['2026-07-27', 16]], spx: spx(Array(40).fill(0.0005)) });
  const keyDates = K.keyDates(Date.UTC(2026, 11, 1), 1).dates;
  const t = N.volStory({ group: 'Indices' }, { slug: 'sp500', name: 'S&P 500', group: 'Indices' }, { vol, keyDates });
  assert.match(t, /Le VIX est à 14/); assert.match(t, /Dates clés à venir : .*Roll des futures sur indices le 10 décembre/);
  assert.match(t, /vérifiez l'échéance/); assert.match(t, /stops proches/);
  assert.equal(N.volStory({ group: 'Metals' }, { slug: 'gold', name: 'Or', group: 'Metals' }, { vol, keyDates }), null);
  assert.equal(N.volStory({ group: 'Indices' }, { slug: 'sp500', group: 'Indices' }, { vol: null, keyDates: [] }), null);
});

test('dates clés : les dates lues chaque jour (FRED, page de la Fed) complètent les listes saisies et repoussent leur limite', () => {
  const auto = { fomc: ['2027-01-27', '2027-03-17*'], events: [['2027-01-13', '08:30', 'cpi'], ['2027-01-08', '08:30', 'nfp'], ['2026-10-14', '08:30', 'cpi'], ['2027-01-15', '08:30', 'retail']] };
  const k = K.keyDates(Date.UTC(2026, 11, 15), 2, auto), at = d => k.dates.filter(x => x.date === d).map(x => x.kind);
  assert.deepEqual(at('2027-01-13'), ['cpi']); assert.deepEqual(at('2027-01-08'), ['nfp']); assert.deepEqual(at('2027-01-27'), ['fomc']);
  assert.ok(!k.dates.some(x => x.kind === 'retail'), 'seuls la Fed, l\'inflation et l\'emploi figurent parmi les dates clés');
  assert.deepEqual(at('2027-01-15'), ['opex'], 'le 15 : échéance des options seulement');
  assert.equal(k.officialUntil.cpi, '2027-01-13'); assert.equal(k.officialUntil.nfp, '2027-01-08');
  const none = K.keyDates(Date.UTC(2026, 11, 15), 2, null);
  assert.ok(!none.dates.some(x => x.date === '2027-01-13'), 'sans dates lues : liste saisie seulement (jusqu\'à fin 2026)');
  assert.equal(K.keyDates(Date.UTC(2026, 9, 1), 1, auto).dates.filter(x => x.date === '2026-10-14').length, 1, 'pas de doublon avec la liste saisie');
});
