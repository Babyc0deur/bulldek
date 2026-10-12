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

test('saisonnalité du jour : étiquette indicative et faits (moyenne, médiane, années en hausse) ; Dow limité à 20 ans ; jours fermés', () => {
  // ES, NQ, YM : de 2000 à 2025, le 6 octobre monte de 1 % sauf 3 années (2005, 2010, 2025… multiples de 5) où il baisse de 0,5 % ; le 7 baisse de 1 %.
  const mk = () => { const rows = []; let c = 100; for (let y = 2000; y <= 2025; y++) for (let d = 1; d <= 31; d++) { const t = Date.UTC(y, 9, d) / 1e3; const w = new Date(t * 1e3).getUTCDay(); if (w === 0 || w === 6) continue; c *= d === 6 ? (y % 5 === 0 ? 0.995 : 1.01) : d === 7 ? 0.99 : 1; rows.push([t, c, c, c]); } return rows; };
  const series = { ES: mk(), NQ: mk(), YM: mk() };
  const r = MC.monthCalendar({ year: 2026, month: 9, series, caps: { YM: 20 }, today: '2026-10-06' });
  const d6 = r.days.find(d => d.day === 6), d7 = r.days.find(d => d.day === 7), d10 = r.days.find(d => d.day === 10);
  assert.equal(d6.today, true); assert.equal(d6.season.key, 'up-strong'); assert.equal(d6.season.label, 'Haussier fort');
  const es15 = d6.season.periods[15].ES;
  assert.ok(es15.n >= 8 && es15.mean > 0 && es15.median === 1 && es15.up > es15.n / 2 && es15.up < es15.n, JSON.stringify(es15));
  assert.ok(d6.season.periods[25].YM.n <= 20 && d6.season.periods[25].ES.n > d6.season.periods[25].YM.n, 'Dow limité à 20 ans');
  assert.ok(d7.season.periods[20].ES.median < 0 && d7.season.periods[20].ES.up === 0); assert.equal(d10.open, false); assert.equal(d10.weekend, true);
  assert.equal(r.days.find(d => d.day === 7).season.key, 'down-strong');
  assert.equal(MC.reading([{ dir: 1, strong: false, regular: true }, { dir: -1, strong: false, regular: true }, { dir: 0 }]).key, 'mixed');
  assert.equal(MC.reading([{ dir: 1, strong: true, regular: true }, { dir: 1, strong: false, regular: false }, { dir: 0 }]).key, 'up-weak');
  assert.equal(MC.reading([{ dir: 1, strong: true, regular: true }, { dir: 1, strong: false, regular: false }, { dir: 0 }]).irregular, true);
  // La moyenne peut être tirée par une année extrême : médiane et années en hausse montrent l'autre histoire.
  const bad = []; for (let y = 2012; y <= 2025; y++) bad.push([Date.UTC(y, 9, 8) / 1e3, 100], [Date.UTC(y, 9, 9) / 1e3, y === 2015 ? 90 : 100.1]);
  const f = MC.dayStats({ ES: bad }, 2026, 9, {})(9, 15).ES;
  assert.ok(f.n === 13 && f.mean < 0 && f.median > 0 && f.up === 12, 'moyenne négative (une année à −10 %) mais médiane positive et 12 années sur 13 en hausse : ' + JSON.stringify(f));
});

test('fiabilité mesurée des étiquettes : rejeu sans regarder le futur, part de hausses et de baisses par étiquette, référence tous jours', () => {
  // Marché sans aucune régularité (hausse un jour sur deux, motif fixe) : une étiquette ne peut pas prédire mieux que le hasard.
  const mk = (seed) => { const rows = []; let c = 100, s = seed; for (let y = 2000; y <= 2025; y++) for (let mo = 0; mo < 12; mo++) for (let d = 1; d <= 28; d++) { const t = Date.UTC(y, mo, d) / 1e3, w = new Date(t * 1e3).getUTCDay(); if (w === 0 || w === 6) continue; s = (s * 1664525 + 1013904223) % 4294967296; c *= 1 + (s / 4294967296 - 0.5) * 0.02; rows.push([t, c, c, c]); } return rows; };
  const a = MC.labelAccuracy({ ES: mk(1), NQ: mk(2), YM: mk(3) }, { YM: 20 }, 2012, 2025);
  assert.ok(a.days > 2500 && a.from === 2012 && a.to === 2025);
  assert.ok(Math.abs(a.all.ES.up + a.all.ES.down - 100) < 0.2, 'hausse + baisse ≈ 100 % (rares jours sans variation)');
  assert.equal(Object.values(a.labels).reduce((s, l) => s + l.n, 0), a.days, 'chaque jour a exactement une étiquette');
  for (const [k, l] of Object.entries(a.labels)) if (l.n > 300) assert.ok(Math.abs(l.ES.up - a.all.ES.up) < 8, k + ' : sans régularité, écart au hasard faible : ' + l.ES.up + ' vs ' + a.all.ES.up);
  // Causal : changer les prix d'une année postérieure ne change pas les étiquettes des années antérieures.
  const s1 = { ES: mk(1), NQ: mk(2), YM: mk(3) }, s2 = { ES: mk(1).map(r => (new Date(r[0] * 1e3).getUTCFullYear() >= 2020 ? [r[0], r[1] * 5 + Math.sin(r[0]), r[2], r[3]] : r)), NQ: mk(2), YM: mk(3) };
  const f1 = MC.dayStats(s1, 2015, 3, {}), f2 = MC.dayStats(s2, 2015, 3, {});
  for (let d = 1; d <= 28; d++) assert.deepEqual(MC.labelOf(f1, d), MC.labelOf(f2, d), 'jour ' + d + ' : les années postérieures ne doivent pas compter');
});

// ---------- page ----------
const fact = (mean, median, up, n) => ({ n, mean, median, up });
const periodsOf = (es, nq, ym) => Object.fromEntries([15, 20, 25].map(p => [p, { ES: es(p), NQ: nq(p), YM: ym(p) }]));
const day = (n, o) => ({ date: `2026-10-${String(n).padStart(2, '0')}`, day: n, weekday: 'mer.', weekend: false, open: true, holiday: null, today: false,
  season: { key: 'neutral', label: 'Neutre', irregular: false, periods: periodsOf(p => fact(0.12, -0.05, 9, p === 15 ? 15 : 14), p => fact(-0.1, 0.1, 10, 14), p => fact(0.3, 0.2, 8, 12)) }, events: [], ...o });
const MONTH = { view: 'month', year: 2026, month: 9, start: '2026-10-01', label: 'octobre 2026', periods: [15, 20, 25], months: ['2026-09', '2026-10', '2026-11'], officialUntil: '2026-12-23',
  today: '2026-10-06', thisWeek: '2026-10-05',
  days: [day(6, { today: true }), day(10, { weekday: 'sam.', weekend: true, open: false }), day(14, { events: [{ time: '08:30', kind: 'cpi', label: 'Inflation (CPI)', impact: 'high', source: 'officiel' }] }),
    day(28, { season: { ...day(1).season, key: 'down-strong', label: 'Baissier fort', irregular: true }, events: [{ time: '14:00', kind: 'fomc', label: 'Décision de la Fed (FOMC) ; conférence', impact: 'high', source: 'officiel' }] })],
  accuracy: { from: 2012, to: 2025, days: 3521, all: { n: 3521, ES: { up: 54.6, down: 44.7 }, NQ: { up: 55, down: 44 }, YM: { up: 54, down: 45 } },
    labels: { 'up-strong': { n: 555, ES: { up: 55.9, down: 43.1 }, NQ: { up: 55.5, down: 44.5 }, YM: { up: 57.3, down: 42.3 } }, 'down-strong': { n: 274, ES: { up: 51.1, down: 48.2 }, NQ: { up: 50.7, down: 48.2 }, YM: { up: 50.7, down: 49.3 } }, neutral: { n: 1003, ES: { up: 55.8, down: 43.7 }, NQ: { up: 55.5, down: 44.5 }, YM: { up: 54.2, down: 45.5 } } } } };
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
  // Étiquettes indicatives, avec leur fiabilité mesurée juste dessous (valeurs venues du serveur), jamais en vert ni en rouge.
  assert.match(h, /<span class="cal-lab">Neutre<\/span>/); assert.match(h, /<span class="cal-lab">Baissier fort<\/span> <small title="[^"]*">irrégulier<\/small>/);
  assert.match(text, /Pas de lecture : le S&P 500 monte 55,8 % de ces jours \(tous les jours : 54,6 %\)/);
  assert.match(text, /S&P 500 : a baissé 48,2 % des jours ainsi étiquetés \(tous les jours : 44,7 %\) · 274 jours/);
  assert.match(h, /title="ES : monte 51,1 %, baisse 48,2 % \(tous les jours : monte 54,6 %, baisse 44,7 %\) · NQ : monte 50,7 %/);
  assert.doesNotMatch(h, /class="sig sm (buy|sell)"|↑|↓/, 'jamais de pastille verte ou rouge, ni de flèche de sens');
  // Avertissement en tête : chiffres mesurés, et phrase exacte (les jours « baissier fort » ont monté plus d'une fois sur deux).
  assert.match(text, /Ces étiquettes sont indicatives, pas des signaux/); assert.match(text, /pas ce qu'ils feront/);
  assert.match(text, /3 521 jours \(2012-2025\), le S&P 500 a monté .*?des jours « haussier fort », 51,1 % des jours « baissier fort » \(donc plus d'une fois sur deux\) et 54,6 % de l'ensemble des jours : l'étiquette ne dit presque rien du sens du jour/);
});

test('page : sans mesure de fiabilité fournie, aucune valeur inventée', async () => {
  const { root } = await runPage({ ...MONTH, accuracy: undefined }, []), text = root.innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.match(text, /Les étiquettes n'ont pas été testées ici/); assert.doesNotMatch(text, /ainsi étiquetés/); assert.match(text, /Baissier fort/);
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
