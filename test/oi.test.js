// Open interest : résumé, lecture prix / open interest, accès aux clôtures.
const test = require('node:test'), assert = require('node:assert/strict');
const CALC = require('../calc.js'), T = CALC.THRESHOLDS;
const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≠ ${b}`);

// historique compact du rapport Legacy : [date, …, open interest] (open interest = colonne 7)
const row = (date, oi) => [date, 1, 2, 3, 4, 5, 6, oi];
const weekly = n => Array.from({ length: n }, (_, i) => row(new Date(Date.UTC(2020, 0, 7) + i * 7 * 864e5).toISOString().slice(0, 10), 1000 + i * 10));

test('résumé : valeur, variations en contrats et en %, moyenne 52 semaines', () => {
  const s = CALC.oiSummary(weekly(200));                        // 1000, 1010 … 2990
  assert.equal(s.last, 2990); assert.equal(s.prev, 2980); assert.equal(s.chg, 10); near(s.chgPct, 10 / 2980 * 100);
  near(s.chg4Pct, (2990 / 2950 - 1) * 100);                     // 4 semaines = 4 lignes en arrière
  const moy = Array.from({ length: 52 }, (_, i) => 1000 + (148 + i) * 10).reduce((a, b) => a + b, 0) / 52;
  near(s.avg52, moy); near(s.vsAvgPct, (2990 / moy - 1) * 100);
  assert.equal(s.weeks, 200); assert.equal(s.date, weekly(200).at(-1)[0]); assert.equal(s.prevDate, weekly(200).at(-2)[0]);
});

test('résumé : position sur 36 mois (0 = plus bas, 100 = plus haut des 156 dernières semaines)', () => {
  assert.equal(CALC.oiSummary(weekly(200)).idx36, 100);         // série croissante : toujours au plus haut
  const bas = weekly(200).map((r, i) => row(r[0], 5000 - i * 10)); assert.equal(CALC.oiSummary(bas).idx36, 0);
});

test('résumé : peu d\'historique, variation à 4 semaines indisponible, moins de 2 lignes = null', () => {
  assert.equal(CALC.oiSummary([row('2026-01-06', 100)]), null); assert.equal(CALC.oiSummary([]), null);
  const s = CALC.oiSummary(weekly(4)); assert.equal(s.chg4Pct, null); assert.ok(s.avg52 > 0);
  assert.equal(CALC.oiSummary([row('2026-01-06', 0), row('2026-01-13', 100)]).chgPct, null);      // précédent nul : pas de division par zéro
  near(CALC.oiSummary([row('2026-01-06', 100), row('2026-01-13', 0)]).chgPct, -100);              // dernier nul : -100 %
});

test('lecture prix × open interest : les quatre cas classiques', () => {
  const cas = [[2, 3, 'trend-up', 'Hausse confirmée'], [2, -3, 'covering', 'Hausse fragile'], [-2, 3, 'trend-down', 'Baisse confirmée'], [-2, -3, 'liquidation', 'Baisse par liquidation']];
  for (const [p, o, key, label] of cas) { const r = CALC.oiReading(p, o); assert.equal(r.key, key); assert.equal(r.label, label); assert.ok(r.text.length > 30); }
});

test('lecture : frontières exactes (0,5 % = déjà lisible, en dessous = stable)', () => {
  assert.equal(CALC.oiReading(T.priceFlatPct, 3).key, 'trend-up');           // seuil inclus
  assert.equal(CALC.oiReading(T.priceFlatPct - 0.001, 3).key, 'flat');
  assert.equal(CALC.oiReading(2, T.oiFlatPct).key, 'trend-up');
  assert.equal(CALC.oiReading(2, T.oiFlatPct - 0.001).key, 'flat');
  assert.equal(CALC.oiReading(-T.priceFlatPct, -T.oiFlatPct).key, 'liquidation');
  assert.equal(CALC.oiReading(null, 3).key, 'na'); assert.equal(CALC.oiReading(2, null).key, 'na');
});

test('clôture à une date : dernière séance antérieure ou égale, fin de journée comprise', () => {
  const d = (s, c) => [Date.parse(s + 'T04:00:00Z') / 1e3, c];
  const rows = [d('2026-09-08', 100), d('2026-09-09', 101), d('2026-09-11', 103), d('2026-09-15', 105)];
  assert.equal(CALC.closeOnOrBefore(rows, '2026-09-15'), 105);              // le jour même compte
  assert.equal(CALC.closeOnOrBefore(rows, '2026-09-13'), 103);              // week-end : dernière séance avant
  assert.equal(CALC.closeOnOrBefore(rows, '2026-09-08'), 100);
  assert.equal(CALC.closeOnOrBefore(rows, '2026-09-07'), null);             // avant le début des données
});

test('semaine : variation de prix entre les deux dernières dates de rapport, lecture associée', () => {
  const d = (s, c) => [Date.parse(s + 'T04:00:00Z') / 1e3, c];
  const daily = [d('2026-09-08', 100), d('2026-09-15', 103)];
  const w = CALC.oiWeek([row('2026-09-01', 1000), row('2026-09-08', 1000), row('2026-09-15', 1050)], daily);
  near(w.priceChgPct, 3); near(w.chgPct, 5); assert.equal(w.reading.key, 'trend-up');
  const baisse = CALC.oiWeek([row('2026-09-08', 1000), row('2026-09-15', 950)], [d('2026-09-08', 100), d('2026-09-15', 97)]);
  assert.equal(baisse.reading.key, 'liquidation');
  assert.equal(CALC.oiWeek([row('2026-09-08', 1000), row('2026-09-15', 950)], []).reading.key, 'na');        // pas de prix : pas de lecture inventée
});

test('données réelles (Nasdaq) : la dernière lecture est cohérente avec les données du serveur', () => {
  const fs = require('node:fs'), path = require('node:path');
  const daily = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'nq-daily.json'), 'utf8'));
  const hist = Array.from({ length: 300 }, (_, i) => row(new Date(Date.UTC(2021, 0, 5) + i * 7 * 864e5).toISOString().slice(0, 10), 300000 + (i % 17) * 3000));
  const w = CALC.oiWeek(hist, daily);
  assert.ok(w.priceChgPct != null && Math.abs(w.priceChgPct) < 25 && ['trend-up', 'covering', 'trend-down', 'liquidation', 'flat'].includes(w.reading.key));
});
