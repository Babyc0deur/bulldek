// Données macro (inflation, taux OCDE, calendrier) : analyse des réponses et règles de lecture.
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../macro.js');

const NOW = Date.parse('2026-09-25T12:00:00Z');
const CPI_CSV = `DATAFLOW,REF_AREA,FREQ,METHODOLOGY,MEASURE,UNIT_MEASURE,EXPENDITURE,ADJUSTMENT,TRANSFORMATION,TIME_PERIOD,OBS_VALUE,OBS_STATUS
X,USA,M,N,CPI,PA,_T,N,GY,2026-08,3.396548,A
X,USA,M,N,CPI,PA,_T,N,GY,2026-06,3.531425,A
X,USA,M,N,CPI,PA,_T,N,GY,2026-07,3.4,A
X,USA,M,N,CPI,PA,_T,N,G1,2026-08,0.2,A
X,GBR,M,N,CPI,PA,_T,N,GY,2026-04,3,A
X,GBR,M,N,CPI,PA,_T,N,GY,2026-05,abc,A`;
const KEI_CSV = `DATAFLOW,REF_AREA,FREQ,MEASURE,UNIT_MEASURE,ACTIVITY,ADJUSTMENT,TRANSFORMATION,TIME_PERIOD,OBS_VALUE,OBS_STATUS
X,USA,M,IRSTCI,PA,_Z,_Z,_Z,2026-02,3.64,A
X,EA20,M,IR3TIB,PA,_Z,_Z,_Z,2026-05,2.2261,A
X,EA20,M,IRLT,PA,_Z,_Z,_Z,2026-05,3.1,A`;

test('OCDE : zones groupées par lots de 7 maximum (au-delà, l’API répond 500), toutes présentes, fusion des lots', () => {
  const us = M.cpiUrls(NOW), rs = M.ratesUrls(NOW), all = us.join(' ');
  assert.equal(us.length, 3); assert.equal(rs.length, 3);
  for (const c of M.AREA_CODES) { assert.ok(all.includes(c) && rs.join(' ').includes(c), c); }
  for (const u of us.concat(rs)) assert.ok(u.match(/\/([A-Z0-9+]+)\.M\./)[1].split('+').length <= 7);
  assert.match(us[0], /GY\+G1\?startPeriod=2020-01&format=csv/); assert.match(rs[0], /IRSTCI\+IR3TIB\+IRLT/);
  assert.ok(us[0].startsWith('https://sdmx.oecd.org/') && M.CALENDAR_URL.startsWith('https://'));
  const m = M.mergeCpi([M.parseCpi(CPI_CSV), { yoy: { FRA: [['2026-08', 1]] }, mom: {} }]); assert.deepEqual(Object.keys(m.yoy).sort(), ['FRA', 'GBR', 'USA']);
});

test('CSV inflation : séries triées par mois, valeurs illisibles ignorées', () => {
  const c = M.parseCpi(CPI_CSV);
  assert.deepEqual(c.yoy.USA, [['2026-06', 3.531], ['2026-07', 3.4], ['2026-08', 3.397]]);
  assert.deepEqual(c.mom.USA, [['2026-08', 0.2]]); assert.deepEqual(c.yoy.GBR, [['2026-04', 3]]);
});

test('CSV taux : immédiat, court terme et long terme séparés', () => {
  const r = M.parseRates(KEI_CSV);
  assert.deepEqual(r.immediate.USA, [['2026-02', 3.64]]); assert.deepEqual(r.short.EA20, [['2026-05', 2.226]]); assert.deepEqual(r.long.EA20, [['2026-05', 3.1]]);
});

test('réponse OCDE inattendue (limite d\'appels dépassée, page d\'erreur) : rejetée, jamais stockée', () => {
  assert.throws(() => M.parseCpi('You have exceeded the number of requests currently permitted'), /inattendue/);
  assert.throws(() => M.parseRates('<html>404</html>'), /inattendue/);
});

test('calendrier : normalisé, trié, importance connue ; format invalide rejeté', () => {
  const ev = M.parseCalendar([{ title: 'CPI y/y', country: 'USD', date: '2026-09-26T08:30:00-04:00', impact: 'High', forecast: '3.3%', previous: '3.4%' }, { title: 'Bank Holiday', country: 'JPY', date: '2026-09-20T19:00:00-04:00', impact: 'Holiday' }, { title: '', country: 'USD', date: '2026-09-26T08:30:00-04:00' }, { title: 'x', country: 'USD', date: 'pas une date' }]);
  assert.equal(ev.length, 2); assert.equal(ev[0].ccy, 'JPY'); assert.equal(ev[1].t, Date.parse('2026-09-26T12:30:00Z')); assert.equal(ev[1].forecast, '3.3%');
  assert.throws(() => M.parseCalendar({}), /inattendu/);
});

test('devises des marchés : dollar par défaut ; paires de devises = devise + dollar', () => {
  assert.deepEqual(M.marketCurrencies('gold'), ['USD']); assert.deepEqual(M.marketCurrencies('euro-fx'), ['EUR', 'USD']); assert.deepEqual(M.marketCurrencies('japanese-yen'), ['JPY', 'USD']);
  assert.equal(M.areaOfCcy('EUR'), 'EA20'); assert.equal(M.areaOfCcy('USD'), 'USA'); assert.equal(M.areaOfCcy('XXX'), undefined);
});
