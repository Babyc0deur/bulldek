// Les seuils publiés (page « À propos ») viennent de CALC.THRESHOLDS : cette constante doit réellement piloter les signaux.
const test = require('node:test'), assert = require('node:assert/strict');
const CALC = require('../calc.js'), T = CALC.THRESHOLDS;

test('valeurs de référence des seuils (toute modification doit être délibérée et se voir ici)', () => {
  assert.deepEqual(T, { cotBuy: 80, cotSell: 20, wrHigh: -20, wrLow: -80, wrPeriod: 14, seasonMinYears: 5, seasonHitRate: 0.6,
    cotShortWeeks: 26, cotLongWeeks: 156, rollJump: 0.10, rollWindow: 15, oiFlatPct: 0.5, priceFlatPct: 0.5, confluenceStrong: 2, trendSma: 200 });
});

test('COT : les signaux basculent exactement aux seuils de la constante', () => {
  assert.equal(CALC.cotSignal(T.cotBuy), 1); assert.equal(CALC.cotSignal(T.cotBuy - 0.001), 0);
  assert.equal(CALC.cotSignal(T.cotSell), -1); assert.equal(CALC.cotSignal(T.cotSell + 0.001), 0);
  assert.equal(CALC.cotLabel(T.cotBuy), 'Achat'); assert.equal(CALC.cotLabel(T.cotSell), 'Vente'); assert.equal(CALC.cotLabel(50), 'Patience');
});

test('Williams %R : frontières strictes (les seuils eux-mêmes sont neutres)', () => {
  assert.equal(CALC.wrSignal(T.wrHigh), 0); assert.equal(CALC.wrSignal(T.wrHigh + 0.001), -1);
  assert.equal(CALC.wrSignal(T.wrLow), 0); assert.equal(CALC.wrSignal(T.wrLow - 0.001), 1);
});

test('saisonnalité : nombre minimal d\'années et taux de régularité', () => {
  const s = (n, up, avgPct) => ({ n, up, avgPct });
  assert.equal(CALC.seasonSignal(s(T.seasonMinYears, 4, 1)), 1);                         // 4/5 = 80 % ≥ 60 %
  assert.equal(CALC.seasonSignal(s(T.seasonMinYears - 1, 4, 1)), 0);                      // trop peu d'années
  assert.equal(CALC.seasonSignal(s(10, 6, 1)), 1); assert.equal(CALC.seasonSignal(s(10, 5, 1)), 0);           // 60 % exactement : oui ; 50 % : non
  assert.equal(CALC.seasonSignal(s(10, 4, -1)), -1); assert.equal(CALC.seasonSignal(s(10, 5, -1)), 0);         // baissier : 6 années sur 10 à la baisse
});

test('confluence : classes aux frontières ±2, sur toute l\'étendue −4 à +4', () => {
  assert.deepEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4].map(CALC.confluenceClass), ['sell', 'sell', 'sell', 'wait', 'wait', 'wait', 'buy', 'buy', 'buy']);
  assert.equal(T.confluenceStrong, 2);
});

test('cohérence : le score maximal possible (4 signaux) atteint le seuil, et un seul signal ne suffit jamais', () => {
  assert.ok(4 >= T.confluenceStrong && T.confluenceStrong > 1);                          // un seul signal ne suffit jamais à qualifier la confluence
});

test("signal de l'open interest : +1 hausse confirmée, −1 baisse confirmée, 0 pour tout le reste", () => {
  const k = key => CALC.oiSignal({ key });
  assert.deepEqual(['trend-up', 'trend-down', 'covering', 'liquidation', 'flat', 'na'].map(k), [1, -1, 0, 0, 0, 0]);
  assert.equal(CALC.oiSignal(null), 0); assert.equal(CALC.oiSignal(undefined), 0);
  // enchaînement complet : la lecture calculée sur des variations réelles donne le bon signal
  assert.equal(CALC.oiSignal(CALC.oiReading(2, 3)), 1); assert.equal(CALC.oiSignal(CALC.oiReading(-2, 3)), -1);
  assert.equal(CALC.oiSignal(CALC.oiReading(2, -3)), 0); assert.equal(CALC.oiSignal(CALC.oiReading(-2, -3)), 0);
  assert.equal(CALC.oiSignal(CALC.oiReading(0.1, 3)), 0);
});
