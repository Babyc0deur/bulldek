// Agenda du week-end : distinguer « la source n'a pas encore publié la semaine prochaine » de « rien de prévu pour ce marché ».
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../macro.js'), { debrief } = require('../debrief.js');

const SAT = Date.parse('2026-09-26T10:00:00Z');
const market = { slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini' };
const row = { slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini', fresh: 'ok', roll: false, price: 24500, chgPct: 0.1, priceDate: Date.parse('2026-09-25T00:00:00Z') / 1e3, group: 'Indices',
  wr: -50, idx36: 50, idx6: 50, score: 0, sig: { cot: 0, season: 0, wr: 0, oi: 0 }, season: null, oi: null };
const ev = (iso, ccy, title, impact = 'High') => ({ t: Date.parse(iso), ccy, title, impact, forecast: '', previous: '' });
const agenda = d => d.story.find(p => p.title === 'Les annonces à venir').text;

test('fenêtre : début = lundi 00 h UTC de la semaine qui s\'ouvre', () => {
  assert.equal(M.horizon(SAT).start, Date.parse('2026-09-28T00:00:00Z'));
  assert.equal(M.horizon(Date.parse('2026-09-27T12:00:00Z')).start, Date.parse('2026-09-28T00:00:00Z'));
  assert.equal(M.horizon(Date.parse('2026-09-25T23:00:00Z')).start, Date.parse('2026-09-28T00:00:00Z'));
});

test('le flux ne contient que la semaine en cours (dernier événement : samedi) → « pas encore publié », pas « rien de prévu »', () => {
  const feed = [ev('2026-09-25T12:30:00Z', 'USD', 'Core PCE'), ev('2026-09-26T14:00:00Z', 'JPY', 'Saturday item', 'Low')];         // un événement postérieur à « maintenant » mais avant lundi
  const d = debrief({ market, row, events: feed, now: SAT });
  assert.match(agenda(d), /pas encore publié par notre source/); assert.match(d.sections.find(s => /qui s'ouvre/.test(s.title)).lines[0], /pas encore publié/);
});

test('semaine prochaine publiée mais sans annonce pour ces devises → « aucune annonce prévue », clairement distinct', () => {
  const feed = [ev('2026-09-29T08:00:00Z', 'EUR', 'German CPI')];
  const d = debrief({ market, row, events: feed, now: SAT });
  assert.match(agenda(d), /Aucune annonce d'importance moyenne ou forte n'est prévue la semaine prochaine/); assert.doesNotMatch(agenda(d), /pas encore publié/);
});

test('semaine prochaine publiée avec annonces : les plus fortes sont racontées jour par jour (6 au maximum)', () => {
  const feed = ['28', '29', '30'].map(j => ev(`2026-09-${j}T12:30:00Z`, 'USD', 'Event ' + j)).concat([ev('2026-10-01T12:30:00Z', 'USD', 'Event 01'), ev('2026-10-02T12:30:00Z', 'USD', 'Event 02'), ev('2026-10-02T13:00:00Z', 'USD', 'Event 03'), ev('2026-10-02T14:00:00Z', 'USD', 'Event 04')]);
  const t = agenda(debrief({ market, row, events: feed, now: SAT }));
  assert.match(t, /^7 annonces d'importance forte à surveiller la semaine prochaine/); assert.equal((t.match(/Event \d\d/g) || []).length, 6);
});
