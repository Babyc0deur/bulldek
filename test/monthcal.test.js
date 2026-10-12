// Calendrier des indices : fermetures de la Bourse de New York, annonces (officielles, habituelles, Forex Factory sans doublon), saisonnalité commune, page.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const MC = require('../monthcal.js');
const { render } = require('../tools/fake-dom.js');

test('fermetures 2026 : Thanksgiving et son lendemain écourté, Noël et sa veille, Columbus et Veterans (obligations seulement), Juneteenth, vendredi saint', () => {
  const h = MC.nyseDays(2026);
  assert.equal(h['2026-11-26'].kind, 'closed'); assert.equal(h['2026-11-27'].kind, 'early'); assert.equal(h['2026-12-25'].kind, 'closed'); assert.equal(h['2026-12-24'].kind, 'early');
  assert.equal(h['2026-10-12'].kind, 'bonds'); assert.equal(h['2026-11-11'].kind, 'bonds'); assert.equal(h['2026-06-19'].kind, 'closed'); assert.equal(h['2026-04-03'].kind, 'closed');
  assert.equal(h['2026-07-03'].kind, 'closed', '4 juillet un samedi : fermé le vendredi 3');
  assert.equal(MC.nyseDays(2022)['2021-12-31'], undefined, '1er janvier un samedi : pas de fermeture reportée au vendredi');
});

test('annonces d\'octobre 2026 : dates officielles, compte rendu de la Fed 3 semaines après la décision, rendez-vous habituels, échéance des options', () => {
  const { events: e } = MC.monthEvents(2026, 9, []), at = d => (e[d] || []).map(x => `${x.time} ${x.kind} ${x.source}`);
  assert.deepEqual(at('2026-10-02'), ['08:30 nfp officiel']); assert.deepEqual(at('2026-10-14'), ['08:30 cpi officiel']);
  assert.deepEqual(at('2026-10-07'), ['14:00 minutes officiel'], 'décision du 16 septembre + 21 jours');
  assert.ok(at('2026-10-28').includes('14:00 fomc officiel')); assert.ok(e['2026-10-28'][0].label.includes('conférence de presse à 14 h 30'));
  assert.deepEqual(at('2026-10-01'), ['08:30 claims habituel', '10:00 ismMfg habituel'], '1er jour ouvré : ISM manufacturier');
  assert.ok(at('2026-10-05').includes('10:00 ismSvc habituel'), '3e jour ouvré : ISM services');
  assert.ok(at('2026-10-16').includes(' opex règle')); assert.ok(at('2026-10-29').includes('08:30 gdp officiel') && at('2026-10-29').includes('08:30 pce officiel'));
  assert.ok(Object.keys(e).every(d => d.startsWith('2026-10')));
});

test('décembre 2026 : échéance trimestrielle et roll ; inscriptions au chômage avancées la semaine de Thanksgiving ; rien de prévu un jour de fermeture', () => {
  const dec = MC.monthEvents(2026, 11, []).events, nov = MC.monthEvents(2026, 10, []).events;
  assert.ok(dec['2026-12-18'].some(x => x.kind === 'quad')); assert.ok(dec['2026-12-10'].some(x => x.kind === 'roll'));
  assert.ok(nov['2026-11-25'].some(x => x.kind === 'claims')); assert.equal(nov['2026-11-26'], undefined);
  assert.equal(dec['2026-12-25'], undefined, 'Noël : pas de Michigan « habituel »');
});

test('Forex Factory : remplace le rendez-vous habituel de la même semaine, ne double pas une date officielle, ajoute discours et autres annonces (heure de New York)', () => {
  const t = s => Date.parse(s);
  const ff = [{ t: t('2026-10-05T14:00:00Z'), ccy: 'USD', title: 'ISM Services PMI', impact: 'Medium' },
    { t: t('2026-10-14T12:30:00Z'), ccy: 'USD', title: 'CPI m/m', impact: 'High' }, { t: t('2026-10-14T12:30:00Z'), ccy: 'USD', title: 'Core CPI m/m', impact: 'High' },
    { t: t('2026-10-08T08:30:00Z'), ccy: 'USD', title: 'FOMC Member Waller Speaks', impact: 'Medium' },
    { t: t('2026-10-09T14:00:00Z'), ccy: 'USD', title: 'Prelim UoM Consumer Sentiment', impact: 'Medium' },
    { t: t('2026-10-09T14:00:00Z'), ccy: 'EUR', title: 'German CPI', impact: 'High' }, { t: t('2026-10-07T14:00:00Z'), ccy: 'USD', title: 'Crude Oil Inventories', impact: 'Low' }];
  const e = MC.monthEvents(2026, 9, ff).events;
  assert.deepEqual(e['2026-10-05'].map(x => `${x.time} ${x.kind} ${x.source}`), ['10:00 ismSvc Forex Factory']);
  assert.deepEqual(e['2026-10-14'].map(x => x.source), ['officiel'], 'CPI officiel conservé, pas de doublon');
  assert.deepEqual(e['2026-10-08'].map(x => `${x.time} ${x.label}`).slice(0, 1), ['04:30 Discours de Waller (Fed)']);
  assert.deepEqual(e['2026-10-09'].map(x => `${x.time} ${x.kind} ${x.source}`), ['10:00 umich Forex Factory'], 'Michigan habituel remplacé');
  assert.ok(!Object.values(e).flat().some(x => /German|Crude/.test(x.label)), 'autres devises et faible importance ignorées');
});

test('saisonnalité du jour : moyenne, médiane et années en hausse par indice ; Dow limité à 20 ans ; jours fermés ; aucune étiquette de sens', () => {
  // ES, NQ, YM : de 2000 à 2025, le 6 octobre monte de 1 % sauf 3 années (2005, 2010, 2025… multiples de 5) où il baisse de 0,5 % ; le 7 baisse de 1 %.
  const mk = () => { const rows = []; let c = 100; for (let y = 2000; y <= 2025; y++) for (let d = 1; d <= 31; d++) { const t = Date.UTC(y, 9, d) / 1e3; const w = new Date(t * 1e3).getUTCDay(); if (w === 0 || w === 6) continue; c *= d === 6 ? (y % 5 === 0 ? 0.995 : 1.01) : d === 7 ? 0.99 : 1; rows.push([t, c, c, c]); } return rows; };
  const series = { ES: mk(), NQ: mk(), YM: mk() };
  const r = MC.monthCalendar({ year: 2026, month: 9, series, caps: { YM: 20 }, today: '2026-10-06' });
  const d6 = r.days.find(d => d.day === 6), d7 = r.days.find(d => d.day === 7), d10 = r.days.find(d => d.day === 10);
  assert.equal(d6.today, true); assert.deepEqual(Object.keys(d6.season), ['periods'], 'aucune étiquette ni sens dans la réponse');
  const es15 = d6.season.periods[15].ES;
  assert.ok(es15.n >= 8 && es15.mean > 0 && es15.median === 1 && es15.up > es15.n / 2 && es15.up < es15.n, JSON.stringify(es15));
  assert.ok(d6.season.periods[25].YM.n <= 20 && d6.season.periods[25].ES.n > d6.season.periods[25].YM.n, 'Dow limité à 20 ans');
  assert.ok(d7.season.periods[20].ES.median < 0 && d7.season.periods[20].ES.up === 0); assert.equal(d10.open, false); assert.equal(d10.weekend, true);
  assert.equal(MC.reading, undefined); assert.equal(MC.periodDir, undefined);
  // La moyenne peut être tirée par une année extrême : médiane et années en hausse montrent l'autre histoire.
  const bad = []; for (let y = 2012; y <= 2025; y++) bad.push([Date.UTC(y, 9, 8) / 1e3, 100], [Date.UTC(y, 9, 9) / 1e3, y === 2015 ? 90 : 100.1]);
  const f = MC.dayStats({ ES: bad }, 2026, 9, {})(9, 15).ES;
  assert.ok(f.n === 13 && f.mean < 0 && f.median > 0 && f.up === 12, 'moyenne négative (une année à −10 %) mais médiane positive et 12 années sur 13 en hausse : ' + JSON.stringify(f));
});

// ---------- page ----------
const fact = (mean, median, up, n) => ({ n, mean, median, up });
const periodsOf = (es, nq, ym) => Object.fromEntries([15, 20, 25].map(p => [p, { ES: es(p), NQ: nq(p), YM: ym(p) }]));
const day = (n, o) => ({ date: `2026-10-${String(n).padStart(2, '0')}`, day: n, weekday: 'mer.', weekend: false, open: true, holiday: null, today: false,
  season: { periods: periodsOf(p => fact(0.12, -0.05, 9, p === 15 ? 15 : 14), p => fact(-0.1, 0.1, 10, 14), p => fact(0.3, 0.2, 8, 12)) }, events: [], ...o });
const MONTH = { view: 'month', year: 2026, month: 9, start: '2026-10-01', label: 'octobre 2026', periods: [15, 20, 25], months: ['2026-09', '2026-10', '2026-11'], officialUntil: '2026-12-23',
  today: '2026-10-06', thisWeek: '2026-10-05',
  days: [day(6, { today: true }), day(10, { weekday: 'sam.', weekend: true, open: false }), day(14, { events: [{ time: '08:30', kind: 'cpi', label: 'Inflation (CPI)', impact: 'high', source: 'officiel' }] }),
    day(28, { events: [{ time: '14:00', kind: 'fomc', label: 'Décision de la Fed (FOMC) ; conférence', impact: 'high', source: 'officiel' }] })] };
const runPage = (data, calls) => render({ src: path.join(__dirname, '..', 'calendarview.js'), fnName: '((a, root) => renderCalendar(a.data, root, q => a.calls.push(q)))', args: { data, calls }, now: Date.parse('2026-10-06T12:00:00Z'), calc: {} });

test('page, vue mois : titre entre deux flèches, « Aujourd\'hui » inactif, jour courant, jours fermés, annonces colorées, annonces majeures, avertissement', async () => {
  const calls = [], { root } = await runPage(MONTH, calls), h = root.innerHTML, text = h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.match(h, /id="calPrev"\s+aria-label="Mois précédent">‹/); assert.match(h, /id="calTitle" aria-live="polite">octobre 2026</); assert.match(h, /id="calNext"\s+aria-label="Mois suivant">›/);
  assert.match(h, /id="calToday" disabled>/); assert.match(h, /data-v="month" aria-pressed="true">Mois/);
  assert.match(h, /<tr class="cal-today">/); assert.match(h, /aujourd'hui/); assert.match(h, /<tr class="cal-off">[\s\S]*?week-end/);
  assert.match(h, /<li class="ev-high"><span class="ev-t">08:30<\/span> Inflation \(CPI\) <small>officiel<\/small><\/li>/);
  assert.match(text, /Annonces de forte importance : mer\. 14 \(Inflation\), mer\. 28 \(Décision de la Fed\)/);
  // Faits sur la période choisie (20 ans par défaut) : moyenne, médiane, années en hausse, pour chaque indice.
  assert.match(text, /ES moy\. \+0,12 % · méd\. −0,05 % · 9\/14 en hausse/); assert.match(text, /NQ moy\. −0,10 % · méd\. \+0,10 % · 10\/14 en hausse/); assert.match(text, /YM moy\. \+0,30 % · méd\. \+0,20 % · 8\/12 en hausse/);
  assert.match(h, /data-p="20" aria-pressed="true">20 ans/); assert.match(h, /title="15 ans : ES moy\. \+0,12 %, méd\. −0,05 %, 9\/15 en hausse/);
  // Avertissement en tête, et plus aucune étiquette de sens.
  assert.match(text, /À lire avant d'utiliser ces chiffres/); assert.match(text, /il ne prédit pas le sens d'un jour/); assert.match(text, /55,9 %.*51,1 %.*54,6 %/);
  const sansAvertissement = h.replace(/<div class="card cal-warn"[\s\S]*?<\/div>/, '');                    // l'avertissement cite volontairement les anciennes étiquettes
  assert.doesNotMatch(sansAvertissement, /Haussier|Baissier|haussier|baissier|class="sig sm (buy|sell)"|↑|↓/, 'aucune étiquette ni flèche de sens dans le calendrier');
});

test('page : le choix de la période (15 / 20 / 25 ans) change les chiffres affichés sans recharger les données', async () => {
  const calls = [], { el, root } = await runPage(MONTH, calls);
  assert.match(root.innerHTML, /9\/14 en hausse/);
  el('#calP').onclick({ target: { closest: () => ({ dataset: { p: '15' } }) } });
  assert.match(root.innerHTML, /ES<\/b> moy\. \+0,12 % · méd\. −0,05 % · <b>9\/15<\/b> en hausse/); assert.deepEqual(calls, [], 'aucun appel au serveur');
  el('#calP').onclick({ target: { closest: () => ({ dataset: { p: '20' } }) } });
});

test('page : flèches (mois précédent / suivant, bornées à la période), passage en vue semaine sur la semaine en cours', async () => {
  const calls = [], { el } = await runPage(MONTH, calls);
  el('#calPrev').onclick(); el('#calNext').onclick();
  el('#calView').onclick({ target: { closest: () => ({ dataset: { v: 'week' } }) } });
  assert.deepEqual(calls, [{ m: '2026-09' }, { m: '2026-11' }, { w: '2026-10-05' }]);
  const last = [], { root } = await runPage({ ...MONTH, year: 2026, month: 10, months: ['2026-10', '2026-11'] }, last);
  assert.match(root.innerHTML, /id="calNext" disabled/, 'dernier mois disponible : flèche suivante inactive');
  assert.match(root.innerHTML, /id="calToday" >|id="calToday">/, '« Aujourd\'hui » actif hors du mois en cours');
});

test('page, vue semaine : sept cases, semaine à cheval sur deux mois, flèches de semaine, retour à la vue mois', async () => {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.UTC(2026, 8, 28 + i)); return day(d.getUTCDate(), { date: d.toISOString().slice(0, 10), weekday: ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'][i], weekend: i > 4, open: i < 5 }); });
  const WEEK = { ...MONTH, view: 'week', year: 2026, month: 8, start: '2026-09-28', label: 'semaine du 28 septembre au 4 octobre 2026', days };
  const calls = [], { root, el } = await runPage(WEEK, calls), h = root.innerHTML;
  assert.equal((h.match(/class="card cal-day/g) || []).length, 7); assert.match(h, /semaine du 28 septembre au 4 octobre 2026/);
  assert.match(h, /lun\. 28 sept/); assert.match(h, /jeu\. 1 oct/); assert.match(h, /aria-label="Semaine précédente"/);
  el('#calPrev').onclick(); el('#calNext').onclick(); el('#calToday').onclick();
  el('#calView').onclick({ target: { closest: () => ({ dataset: { v: 'month' } }) } });
  assert.deepEqual(calls, [{ w: '2026-09-21' }, { w: '2026-10-05' }, { w: '2026-10-05' }, { m: '2026-09' }]);
});
