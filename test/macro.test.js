// Données macro (inflation, taux OCDE, calendrier) et debrief du jour : analyse des réponses, règles de lecture, texte produit.
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../macro.js'), { debrief, trend } = require('../debrief.js');

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

test('annonces à venir : devises concernées, importance moyenne ou forte, fenêtre 48 h', () => {
  const h = 36e5, ev = [
    { t: NOW + 2 * h, ccy: 'USD', title: 'a', impact: 'High' }, { t: NOW + 30 * h, ccy: 'USD', title: 'b', impact: 'Medium' }, { t: NOW + 60 * h, ccy: 'USD', title: 'c', impact: 'High' },
    { t: NOW + 2 * h, ccy: 'USD', title: 'd', impact: 'Low' }, { t: NOW + 2 * h, ccy: 'EUR', title: 'e', impact: 'High' }, { t: NOW - 20 * h, ccy: 'USD', title: 'f', impact: 'High' }, { t: NOW - 3 * h, ccy: 'USD', title: 'g', impact: 'High' }];
  assert.deepEqual(M.upcoming(ev, ['USD'], NOW).map(e => e.title), ['b', 'a', 'g'].sort((x, y) => ev.find(e => e.title === x).t - ev.find(e => e.title === y).t));
  assert.deepEqual(M.upcoming(ev, ['USD', 'EUR'], NOW, 24).map(e => e.title).sort(), ['a', 'e', 'g']);
});

test('devises des marchés : dollar par défaut ; paires de devises = devise + dollar', () => {
  assert.deepEqual(M.marketCurrencies('gold'), ['USD']); assert.deepEqual(M.marketCurrencies('euro-fx'), ['EUR', 'USD']); assert.deepEqual(M.marketCurrencies('japanese-yen'), ['JPY', 'USD']);
  assert.equal(M.areaOfCcy('EUR'), 'EA20'); assert.equal(M.areaOfCcy('USD'), 'USA'); assert.equal(M.areaOfCcy('XXX'), undefined);
});

// ---------- debrief ----------
const market = { slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini' };
const row = (o = {}) => ({ slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini', wr: -12.7, roll: false, idx6: 10, idx36: 85, score: 3, fresh: 'ok',
  season: { n: 10, avgPct: 1.8, up: 7 }, oi: { last: 1, chgPct: 3.2, priceChgPct: 1.1, key: 'trend-up', label: 'Hausse confirmée' }, sig: { cot: 1, season: 1, wr: 0, oi: 1 }, ...o });
const YIELDS = { us10y: [['2026-09-24', 5.18]], us2y: [['2026-09-24', 4.87]], curve: [['2026-09-25', 0.36]], real10y: [['2026-09-24', 2.85]], breakeven: [['2026-09-25', 2.34]], vix: [['2026-09-22', 14.21]] };
const macro = { yields: YIELDS, cpi: { yoy: { USA: [['2026-05', 3.0], ['2026-06', 3.1], ['2026-07', 3.2], ['2026-08', 3.4]] } }, rates: { immediate: { USA: [['2026-02', 3.6], ['2026-03', 3.6], ['2026-04', 3.6], ['2026-05', 3.6], ['2026-06', 3.6], ['2026-07', 3.6], ['2026-08', 3.64]] } } };
const txt = d => d.sections.map(s => s.title + '\n' + s.lines.join('\n')).join('\n');

test('debrief : toutes les sections, chiffres repris des indicateurs, virgule décimale', () => {
  const d = debrief({ market, row: row(), macro, events: [], now: NOW }), t = txt(d);
  assert.deepEqual(d.sections.map(s => s.title), ['Synthèse', 'Technique', 'Positionnement (COT)', 'Contexte macro', 'Rendements, courbe et risque', 'Agenda économique (48 h)']);
  assert.match(t, /Confluence \+3 sur 4 : biais haussier marqué/); assert.match(t, /Williams %R \(14 jours\) : -12,7|Williams %R \(14 jours\) : −12,7|12,7 — zone de surachat/);
  assert.match(t, /\+1,80 % en moyenne sur 10 ans, haussier 7 années sur 10|\+1,80 % en moyenne sur 10 ans/); assert.match(t, /Hausse confirmée/);
  assert.match(t, /COT Index des commerciaux : 10 % sur 6 mois \(zone de vente, utilisé pour la confluence\) et 85 % sur 36 mois \(zone d'achat\)/);
  assert.match(t, /États-Unis \(dollar américain\) : inflation 3,4 % sur un an \(août 2026\), \+0,40 pt en 3 mois/);
  assert.match(t, /Aucune annonce importante prévue/); assert.match(d.note, /sans prévision ni conseil/);
});

test('debrief : lecture macro « restrictive » quand l\'inflation remonte et que les taux ne baissent pas', () => {
  assert.match(txt(debrief({ market, row: row(), macro, events: [], now: NOW })), /environnement plutôt restrictif/);
  const cool = { ...macro, cpi: { yoy: { USA: [['2026-05', 3.6], ['2026-06', 3.5], ['2026-07', 3.3], ['2026-08', 3.2]] } }, rates: { immediate: { USA: [['2026-02', 3.9], ['2026-03', 3.9], ['2026-04', 3.9], ['2026-05', 3.8], ['2026-06', 3.7], ['2026-07', 3.6], ['2026-08', 3.6]] } } };
  assert.match(txt(debrief({ market, row: row(), macro: cool, events: [], now: NOW })), /environnement plutôt accommodant/);
});

test('debrief : annonces des devises du marché uniquement, avec prévision, précédent et heure de Paris', () => {
  const ev = [{ t: Date.parse('2026-09-25T12:30:00Z'), ccy: 'USD', title: 'Core PCE', impact: 'High', forecast: '0.2%', previous: '0.3%' }, { t: NOW + 3 * 36e5, ccy: 'EUR', title: 'ECB Speaks', impact: 'High', forecast: '', previous: '' }];
  const d = debrief({ market, row: row(), events: ev, now: NOW }), ag = d.sections.find(s => s.title.startsWith('Agenda')).lines;
  assert.equal(ag.length, 1); assert.match(ag[0], /14:30 \(Paris\) · USD · Core PCE · importance forte \(prévision 0\.2%, précédent 0\.3%\)/);
  const eur = debrief({ market: { slug: 'euro-fx', name: 'Euro FX' }, row: row({ slug: 'euro-fx' }), events: ev, now: NOW }).sections.find(s => s.title.startsWith('Agenda')).lines;
  assert.equal(eur.length, 2);
});

test('debrief : annonce forte < 24 h → vigilance ; changement de contrat et données périmées signalés', () => {
  const ev = [{ t: NOW + 5 * 36e5, ccy: 'USD', title: 'NFP', impact: 'High', forecast: '', previous: '' }];
  const d = debrief({ market, row: row({ roll: true, fresh: 'stale' }), macro, events: ev, now: NOW }), v = d.sections.find(s => s.title === 'Points de vigilance').lines.join('\n');
  assert.match(v, /Changement de contrat/); assert.match(v, /pas à jour/); assert.match(v, /importance forte dans les prochaines 24 h/);
  assert.match(txt(d), /volatilité peut dépasser/); assert.match(txt(d), /signal neutralisé/);
});

test('debrief : sans macro ni calendrier → texte honnête, aucune valeur inventée ; marché sans données → indisponible', () => {
  const d = debrief({ market, row: row(), now: NOW }), t = txt(d);
  assert.match(t, /Données indisponibles/); assert.match(t, /pas encore chargées/); assert.doesNotMatch(t, /NaN|undefined/);
  const none = debrief({ market, row: { missing: true }, now: NOW }); assert.equal(none.available, false);
  assert.equal(debrief({ market, row: undefined, now: NOW }).available, false);
});

test('debrief : confluence nulle, faible et négative décrites sans biais inventé', () => {
  const h = s => debrief({ market, row: row({ score: s }), now: NOW }).sections[0].lines[0];
  assert.match(h(0), /Confluence nulle/); assert.match(h(1), /léger biais haussier/); assert.match(h(-1), /léger biais baissier/); assert.match(h(-2), /−2 sur 4 : biais baissier marqué/);
});

test('trend : variation sur n observations, série trop courte → pas de variation', () => {
  assert.deepEqual(trend([['2026-01', 1], ['2026-02', 2], ['2026-03', 4]], 2), { value: 4, period: '2026-03', delta: 3 });
  assert.equal(trend([['2026-01', 1]], 3).delta, null); assert.equal(trend([], 3), null);
});

test('biais : semaine = COT + saison + open interest (±2 pour trancher) ; journée = Williams %R + dernière séance (±1)', () => {
  const { biases } = require('../debrief.js');
  const b = (sig, chg) => biases({ sig: { cot: 0, season: 0, wr: 0, oi: 0, ...sig }, chgPct: chg });
  assert.equal(b({ cot: 1, season: 1, oi: 0 }, 0).week.key, 'up'); assert.equal(b({ cot: 1, season: 0, oi: 0 }, 0).week.key, 'flat');
  assert.equal(b({ cot: -1, season: -1, oi: -1 }, 0).week.label, 'baissière'); assert.equal(b({ cot: -1, season: -1, oi: 1 }, 0).week.key, 'flat');
  assert.equal(b({ wr: 1 }, 0.1).day.key, 'up'); assert.equal(b({ wr: -1 }, -0.1).day.label, 'baissière'); assert.equal(b({ wr: 0 }, 0.4).day.key, 'flat');
  assert.equal(b({ wr: 0 }, 0.5).day.key, 'up'); assert.equal(b({ wr: 0 }, -0.5).day.key, 'down'); assert.equal(b({ wr: 1 }, -1).day.key, 'flat');
  assert.match(b({ wr: 0 }, 0.2).day.why, /trop faible/);
});

test('debrief : la synthèse indique le biais de la semaine et de la journée, et le résultat les expose', () => {
  const d = debrief({ market, row: row({ chgPct: 0.8 }), now: NOW }), t = d.sections[0].lines.join('\n');
  assert.equal(d.bias.week.key, 'up'); assert.equal(d.bias.day.key, 'up');
  assert.match(t, /Semaine : haussière \(COT \+1, saisonnalité \+1, open interest \+1\)/); assert.match(t, /Journée : haussière \(Williams %R 0, dernière séance \+0,80 %\)/);
});
