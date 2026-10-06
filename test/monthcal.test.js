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

test('saisonnalité commune : sens et « fort » par période, lecture d\'ensemble ; Dow limité ; jours fermés', () => {
  // ES, NQ, YM : chaque année de 2000 à 2025, le 6 octobre monte de 1 % (2 années sur 10 baissent de 0,5 %) ; le 7 baisse.
  const mk = () => { const rows = []; let c = 100; for (let y = 2000; y <= 2025; y++) for (let d = 1; d <= 31; d++) { const t = Date.UTC(y, 9, d) / 1e3; const w = new Date(t * 1e3).getUTCDay(); if (w === 0 || w === 6) continue; c *= d === 6 ? (y % 5 === 0 ? 0.995 : 1.01) : d === 7 ? 0.99 : 1; rows.push([t, c]); } return rows; };
  const series = { ES: mk(), NQ: mk(), YM: mk() };
  const r = MC.monthCalendar({ year: 2026, month: 9, series, caps: { YM: 20 }, today: '2026-10-06' });
  const d6 = r.days.find(d => d.day === 6), d7 = r.days.find(d => d.day === 7), d10 = r.days.find(d => d.day === 10);
  assert.equal(d6.today, true); assert.equal(d6.season.key, 'up-strong'); assert.equal(d6.season.label, 'Haussier fort');
  assert.ok(d6.season.periods[25].YM.n <= 20 && d6.season.periods[25].ES.n > d6.season.periods[25].YM.n, 'Dow limité à 20 ans');
  assert.equal(d7.season.key, 'down-strong'); assert.equal(d10.open, false); assert.equal(d10.weekend, true);
  assert.equal(MC.reading([{ dir: 1, strong: false, regular: true }, { dir: -1, strong: false, regular: true }, { dir: 0 }]).key, 'mixed');
  assert.equal(MC.reading([{ dir: 1, strong: true, regular: true }, { dir: 1, strong: false, regular: false }, { dir: 0 }]).key, 'up-weak');
  assert.equal(MC.reading([{ dir: 1, strong: true, regular: true }, { dir: 1, strong: false, regular: false }, { dir: 0 }]).irregular, true);
});

test('page : boutons des mois, jour courant, jours fermés, annonces colorées par importance, points saillants', async () => {
  const day = (n, o) => ({ date: `2026-10-${String(n).padStart(2, '0')}`, day: n, weekday: 'mer.', weekend: false, open: true, holiday: null, today: false,
    season: { key: 'neutral', label: 'Neutre', irregular: false, periods: Object.fromEntries([15, 20, 25].map(p => [p, { dir: 0, strong: false, ES: { mean: 0.1, up: 6, n: 10 }, NQ: { mean: -0.1, up: 4, n: 10 }, YM: { mean: 0, up: 5, n: 10 } }])) }, events: [], ...o });
  const DATA = { year: 2026, month: 9, label: 'octobre 2026', periods: [15, 20, 25], months: ['2026-10', '2026-11', '2026-12'], officialUntil: '2026-12-31',
    days: [day(6, { today: true }), day(10, { weekday: 'sam.', weekend: true, open: false }), day(14, { events: [{ time: '08:30', kind: 'cpi', label: 'Inflation (CPI)', impact: 'high', source: 'officiel' }] }),
      day(28, { season: { ...day(1).season, key: 'up-strong', label: 'Haussier fort' }, events: [{ time: '14:00', kind: 'fomc', label: 'Décision de la Fed (FOMC) ; conférence', impact: 'high', source: 'officiel' }] })] };
  const { root } = await render({ src: path.join(__dirname, '..', 'calendarview.js'), fnName: '((a, root) => renderCalendar(a, root))', args: DATA, now: Date.parse('2026-10-06T12:00:00Z'), calc: {} });
  const h = root.innerHTML, text = h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.match(h, /data-m="2026-10" aria-pressed="true">octobre 2026/); assert.match(h, /data-m="2026-12"[^>]*>décembre 2026/);
  assert.match(h, /<tr class="cal-today">/); assert.match(h, /aujourd'hui/); assert.match(h, /<tr class="cal-off">[\s\S]*?week-end/);
  assert.match(h, /<li class="ev-high"><span class="ev-t">08:30<\/span> Inflation \(CPI\) <small>officiel<\/small><\/li>/);
  assert.match(text, /Saisonnalité forte : mer\. 28 \(haussier fort\)/); assert.match(text, /le mer\. 28, la saisonnalité forte coïncide avec Décision de la Fed/);
  assert.match(text, /Grosses annonces sans tendance saisonnière nette : mer\. 14 \(Inflation\)/);
  assert.match(text, /15 a · · 20 a · · 25 a ·/);
});
