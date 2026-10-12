// Réaction des indices aux annonces (eventstats.js), archives FOMC de la Fed (releases.js), ATR (calc.js) et leur affichage (calendrier, fiche marché).
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const E = require('../eventstats.js'), R = require('../releases.js'), CALC = require('../calc.js');
const { render } = require('../tools/fake-dom.js');

// Séances de semaine de janvier à juin 2024 : +0,1 % et amplitude de 1 % chaque jour, sauf les jours d'annonce (+2 % ou −1 %, amplitude 3 %).
function rows(special = {}) {
  const out = []; let c = 100;
  for (let t = Date.UTC(2024, 0, 2) / 1e3; t < Date.UTC(2024, 6, 1) / 1e3; t += 86400) {
    const w = new Date(t * 1e3).getUTCDay(); if (w === 0 || w === 6) continue;
    const d = new Date(t * 1e3).toISOString().slice(0, 10), prev = c, s = special[d];
    c = prev * (1 + (s ? s.chg : 0.001)); const range = prev * (s ? 0.03 : 0.01);
    out.push([t, c, Math.max(c, prev) + range / 2, Math.min(c, prev) + range / 2 - range]);
  }
  return out;
}

test('réaction aux annonces : variation, mouvement moyen, part de hausses, amplitude rapportée aux séances ordinaires, dernière annonce', () => {
  const special = { '2024-02-13': { chg: 0.02 }, '2024-03-12': { chg: -0.01 }, '2024-04-10': { chg: 0.02 } };
  const s = rows(special), r = E.reactions({ ES: s, NQ: s, YM: s }, { cpi: ['2024-02-13', '2024-03-12', '2024-04-10', '2024-02-10' /* samedi */, '2027-01-13' /* futur */], fomc: ['2024-03-20*'], nfp: [] });
  const es = r.kinds.cpi.ES;
  assert.equal(es.n, 3, 'week-end et dates futures ignorés'); assert.equal(es.up, 67); assert.equal(es.meanChg, 1); assert.equal(es.meanAbs, 1.67);
  // Amplitude (plus haut − plus bas) = variation du jour + 3 % les jours d'annonce (5 %, 4 %, 5 %), 0,1 % + 1 % les autres jours : rapport ≈ 4,24.
  assert.ok(Math.abs(es.rangeRatio - 4.24) < 0.05, 'amplitude rapportée aux séances ordinaires : ' + es.rangeRatio);
  assert.deepEqual([es.last.date, es.last.chg], ['2024-04-10', 2]); assert.equal(r.kinds.cpi.from, '2024-02-13');
  assert.equal(r.kinds.fomc.ES.n, 1, 'date FOMC avec « * » (projections) acceptée');
  assert.equal(r.kinds.nfp.ES, undefined, 'aucune date : pas de statistique');
  assert.equal(r.kinds.cpi.label, 'Inflation (CPI)');
});

test('archives FOMC de la Fed : réunions programmées, réunion d\'un jour, à cheval sur deux mois ; conférences téléphoniques ignorées', () => {
  const html = '<h5>January 29-30 Meeting - 2008</h5><h5>January 21 Conference Call - 2008</h5><h5>March 18 Meeting - 2008</h5><h5 class="x"> April/May 30-1 Meeting - 2019 </h5>';
  assert.deepEqual(R.parseFomcHistory(html), ['2008-01-30', '2008-03-18', '2019-05-01']);
  assert.equal(R.fomcHistoryUrl(2008), 'https://www.federalreserve.gov/monetarypolicy/fomchistorical2008.htm');
  assert.deepEqual(R.HISTORY_KINDS, ['cpi', 'nfp']); assert.equal(R.HISTORY_FROM, '2000-01-01');
  assert.deepEqual(R.build({ fomcHistory: ['2008-01-30'] }).fomcHistory, ['2008-01-30']);
});

test('ATR de Wilder : amplitude constante, écart d\'ouverture compté, historique trop court', () => {
  const flat = Array.from({ length: 30 }, (_, i) => [i, 100, 105, 95]);
  assert.deepEqual(CALC.atr(flat, 14), { value: 10, pct: 10, last: 10, lastRatio: 1, n: 14 });
  assert.equal(CALC.atr([[0, 100, 101, 99], [1, 110, 111, 109]], 1).value, 11, 'clôture à 100 puis séance 109-111 : vrai range de 11');
  assert.equal(CALC.atr(flat.slice(0, 10), 14), null);
});

test('calendrier : repère de réaction sur l\'annonce (S&P 500, détail au survol) et tableau des trois annonces', async () => {
  const st = (n, a, rr) => ({ n, meanChg: 0.2, medianChg: 0.1, meanAbs: a, up: 55, meanRange: 1.6, rangeRatio: rr, absRatio: 1.2, baseRange: 1.3, last: { date: '2026-09-11', chg: 0.8, range: 1.2 } });
  const day = { date: '2026-10-14', day: 14, weekday: 'mer.', weekend: false, open: true, holiday: null, today: false,
    season: { periods: Object.fromEntries([15, 20, 25].map(p => [p, { ES: { mean: 0, median: 0, up: 5, n: 10 }, NQ: { mean: 0, median: 0, up: 5, n: 10 }, YM: { mean: 0, median: 0, up: 5, n: 10 } }])) },
    events: [{ time: '08:30', kind: 'cpi', label: 'Inflation (CPI)', impact: 'high', source: 'officiel' }, { time: '10:00', kind: 'ismMfg', label: 'ISM manufacturier', impact: 'high', source: 'habituel' }] };
  const DATA = { view: 'month', year: 2026, month: 9, start: '2026-10-01', label: 'octobre 2026', periods: [15, 20, 25], months: ['2026-10'], officialUntil: '2026-12-23', today: '2026-10-14', thisWeek: '2026-10-12', days: [day],
    reactions: { kinds: { cpi: { label: 'Inflation (CPI)', from: '2000-01-14', to: '2026-09-11', ES: st(320, 0.9, 1.4), NQ: st(320, 1.2, 1.3), YM: st(310, 0.8, 1.3) }, nfp: { label: 'Emploi (NFP)' }, fomc: { label: 'Décision de la Fed (FOMC)', from: '2000-10-03', to: '2026-09-16', ES: st(168, 0.87, 1.11) } } } };
  const { root } = await render({ src: path.join(__dirname, '..', 'calendarview.js'), fnName: '((a, root) => renderCalendar(a, root, () => {}))', args: DATA, now: Date.parse('2026-10-14T12:00:00Z'), calc: {} });
  const h = root.innerHTML, text = h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.match(h, /Inflation \(CPI\) <small>officiel<\/small> <span class="ev-r" title="Depuis 2000 : ES : mouvement moyen ±0,9 %, amplitude 1,6 % \(×1,4 une séance ordinaire\), en hausse 55 % des fois, 320 annonces · NQ/);
  assert.match(h, /ES ±0,9 % · ampl\. ×1,4<\/span>/); assert.doesNotMatch(h, /ISM manufacturier <small>habituel<\/small> <span class="ev-r"/, 'pas de repère sans historique');
  assert.match(text, /Réaction des indices aux grandes annonces/); assert.match(text, /Inflation \(CPI\) depuis 2000 ES 320 \+0,2 % ±0,9 % 55 % 1,6 % ×1,4/);
  assert.match(text, /Décision de la Fed \(FOMC\) depuis 2000 ES 168/); assert.doesNotMatch(text, /Emploi \(NFP\) depuis/, 'annonce sans données : pas de ligne');
});

test('stops touchés : part des séances où ½ ATR et 1 ATR sont atteints depuis la clôture précédente, côté long et côté court ; historique trop court → null', () => {
  const flat = Array.from({ length: 60 }, (_, i) => [i, 100, 105, 95]);                       // ATR 10 : bas à 95 = ½ ATR sous la clôture (touché), 1 ATR = 90 (non touché)
  assert.deepEqual(CALC.atrStops(flat, 14), { sessions: 45, half: { long: 100, short: 100, both: 100 }, full: { long: 0, short: 0 } });
  const calm = Array.from({ length: 60 }, (_, i) => [i, 100, i % 2 ? 102 : 100, i % 2 ? 98 : 100]);   // une séance sur deux ne bouge presque pas : ½ ATR touché une fois sur deux au plus
  const s = CALC.atrStops(calm, 14); assert.ok(s.sessions === 45 && s.half.long > 30 && s.half.long < 70 && s.full.long <= s.half.long, JSON.stringify(s));
  assert.equal(CALC.atrStops(flat.slice(0, 10), 14), null);
});

test('calendrier : carte « Amplitude moyenne du jour » (ATR, dollars par contrat standard et micro, stops touchés mesurés) ; absente sans données', async () => {
  const day = { date: '2026-10-14', day: 14, weekday: 'mer.', weekend: false, open: true, holiday: null, today: false, events: [],
    season: { key: 'neutral', label: 'Neutre', irregular: false, periods: Object.fromEntries([15, 20, 25].map(p => [p, { ES: { mean: 0, median: 0, up: 5, n: 10 }, NQ: { mean: 0, median: 0, up: 5, n: 10 }, YM: { mean: 0, median: 0, up: 5, n: 10 } }])) } };
  const atr = (v, pct) => ({ value: v, pct, last: v * 0.5, lastRatio: 0.5, n: 14, stops: { sessions: 6000, half: { long: 40.2, short: 39.1, both: 6 }, full: { long: 14.3, short: 13.8 } } });
  const base = { view: 'month', year: 2026, month: 9, start: '2026-10-01', label: 'octobre 2026', periods: [15, 20, 25], months: ['2026-10'], officialUntil: '2026-12-23', today: '2026-10-14', thisWeek: '2026-10-12', days: [day] };
  const run = data => render({ src: path.join(__dirname, '..', 'calendarview.js'), fnName: '((a, root) => renderCalendar(a, root, () => {}))', args: data, now: Date.parse('2026-10-14T12:00:00Z'), calc: {} });
  const { root } = await run({ ...base, atr: { ES: atr(70, 0.9), NQ: atr(300, 1.2), YM: atr(400, 0.9) } }), text = root.innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /Amplitude moyenne du jour \(ATR 14 séances\)/);
  assert.match(text, /ES S&P 500 70 pts 0,90 % du prix 3 500 \$ 1 750 \$ 1 750 \$ ×0,5 l'ATR 40,2 % \/ 39,1 % 14,3 % \/ 13,8 %/);   // 70 pts × 50 $ ; ½ ATR ; dernière séance 35 pts
  assert.match(text, /MES 70 pts 0,90 % du prix 350 \$ 175 \$ 175 \$/); assert.match(text, /NQ Nasdaq 100 300 pts 1,20 % du prix 6 000 \$/); assert.match(text, /MNQ 300 pts 1,20 % du prix 600 \$/);
  assert.match(text, /YM Dow Jones 400 pts 0,90 % du prix 2 000 \$/); assert.match(text, /MYM 400 pts 0,90 % du prix 200 \$/);
  assert.match(text, /L'ATR décrit l'agitation, pas la direction/);
  assert.doesNotMatch((await run(base)).root.innerHTML, /Amplitude moyenne du jour/, 'pas de données : pas de carte');
});

test('fiche marché : plus d\'encadré « Amplitude moyenne du jour » (déplacé dans le calendrier) ; menu de l\'en-tête sans W %R, COT ni OI', () => {
  const fs = require('node:fs');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'market.js'), 'utf8'), /atrBox|Amplitude moyenne du jour|CONTRACTS/);
  const shared = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');
  assert.doesNotMatch(shared, /href="#sWr"|href="#sCot"|href="#sOi"/); assert.match(shared, /href="#sSea"/);
});
