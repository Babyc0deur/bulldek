// Mode week-end : bilan des annonces publiées depuis lundi, agenda de lundi, et pas de mélange entre les deux.
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../macro.js'), { debrief } = require('../debrief.js');

const SAT = Date.parse('2026-09-26T10:00:00Z'), MON = Date.parse('2026-09-28T08:00:00Z');
const market = { slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini' };
const macro = { cpi: { yoy: { USA: [['2026-05', 3.0], ['2026-08', 3.4]] } }, rates: { immediate: { USA: [['2026-08', 3.64]] } } };
const row = (o = {}) => ({ slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini', fresh: 'ok', roll: false, price: 24500, chgPct: 0.1, priceDate: Date.parse('2026-09-25T00:00:00Z') / 1e3, group: 'Indices',
  wr: -12.7, idx36: 1, idx6: 0, score: -3, sig: { cot: -1, season: -1, wr: -1, oi: 0 }, season: { n: 10, avgPct: -1.39, up: 4 }, oi: null, ...o });
const ev = (iso, ccy, title, impact = 'High', forecast = '', previous = '') => ({ t: Date.parse(iso), ccy, title, impact, forecast, previous });
const EVENTS = [
  ev('2026-09-20T22:00:00Z', 'USD', 'Sunday Old'),                                         // dimanche précédent : hors bilan
  ev('2026-09-21T13:45:00Z', 'USD', 'Flash Manufacturing PMI', 'High', '52', '51'),       // lundi
  ev('2026-09-23T14:30:00Z', 'USD', 'Crude Oil Inventories', 'Medium'),                   // mercredi
  ev('2026-09-24T12:30:00Z', 'USD', 'Unemployment Claims', 'Medium', '215K', '218K'),      // jeudi
  ev('2026-09-25T12:30:00Z', 'USD', 'Core PCE Price Index m/m', 'High', '0.2%', '0.3%'),  // vendredi
  ev('2026-09-25T12:30:00Z', 'EUR', 'German Ifo', 'High'),                                 // autre devise : hors bilan pour le Nasdaq
  ev('2026-09-28T12:30:00Z', 'USD', 'ISM Manufacturing PMI', 'High', '49', '48'),         // lundi
  ev('2026-09-30T12:15:00Z', 'USD', 'ADP Employment', 'High'),                             // mercredi 30 : dans la semaine qui s'ouvre
  ev('2026-10-02T12:30:00Z', 'USD', 'Non-Farm Employment Change', 'High'),                 // vendredi 2 octobre : dans la semaine qui s'ouvre
  ev('2026-10-05T12:30:00Z', 'USD', 'Two weeks away', 'High'),                             // semaine d'après : hors fenêtre
];
const by = (d, title) => d.story.find(p => p.title === title).text;

test('bilan : les annonces depuis lundi sont reprises (devises du marché, importance moyenne ou forte), pas celles d\'avant lundi', () => {
  const win = M.horizon(SAT), list = M.recent(EVENTS, ['USD'], SAT, win.recapHours);
  assert.deepEqual(list.map(e => e.title), ['Flash Manufacturing PMI', 'Crude Oil Inventories', 'Unemployment Claims', 'Core PCE Price Index m/m']);
  assert.equal(win.recapHours, 130);                                 // lundi 00 h UTC → samedi 10 h UTC
  assert.deepEqual(M.recent(EVENTS, ['USD', 'EUR'], SAT, win.recapHours).length, 5);
  assert.equal(M.recent(EVENTS, ['USD'], MON, 12).length, 0);
});

test('bilan dans le récit : jours, prévisions, source sans résultat publié, et réaction de la dernière séance', () => {
  const d = debrief({ market, row: row(), macro, events: EVENTS, now: SAT }), t = by(d, 'Les annonces de la semaine écoulée');
  assert.match(t, /^4 annonces d'importance moyenne ou forte ont rythmé la semaine \(dont 2 d'importance forte\)\./);
  assert.match(t, /Lundi : indicateur d'activité « Flash Manufacturing PMI » \(USD\) \(prévision 52, précédent 51\)/); assert.match(t, /Mercredi : publication « Crude Oil Inventories » \(USD, importance moyenne\)/);
  assert.match(t, /Jeudi : donnée d'emploi « Unemployment Claims » \(USD, importance moyenne\) \(prévision 215K, précédent 218K\)/);
  assert.match(t, /Vendredi : chiffre d'inflation « Core PCE Price Index m\/m » \(USD\) \(prévision 0\.2%, précédent 0\.3%\)/);
  assert.match(t, /n'est pas repris par notre source/); assert.match(t, /Nasdaq 100 E-Mini a terminé la dernière séance à \+0,10 %, un mouvement modeste/);
  assert.doesNotMatch(t, /Sunday Old|Ifo/);
  const fort = by(debrief({ market, row: row({ chgPct: -1.4 }), macro, events: EVENTS, now: SAT }), 'Les annonces de la semaine écoulée');
  assert.match(fort, /à −1,40 %, une réaction plutôt négative/);
});

test('week-end : le récit garde son ordre (point de clôture, indicateurs, prix, macro, bilan, agenda, invalidation)', () => {
  const d = debrief({ market, row: row(), macro, events: EVENTS, now: SAT });
  assert.deepEqual(d.story.map(p => p.title), ['Le point de clôture', 'Ce que disent les indicateurs entre eux', 'Prix, open interest et momentum', 'Le contexte macro', 'Rendements, volatilité et corrélations', 'Les annonces de la semaine écoulée', 'Les annonces à venir', 'Ce qui ferait changer la lecture']);
  const semaine = debrief({ market, row: row(), macro, events: EVENTS, now: MON });
  assert.equal(semaine.story.length, 7); assert.equal(semaine.story[0].title, 'Le point du jour');
});

test('week-end : agenda = toute la semaine qui s\'ouvre (jusqu\'au samedi 00 h UTC), bilan = depuis lundi ; sections détaillées cohérentes', () => {
  const d = debrief({ market, row: row(), macro, events: EVENTS, now: SAT });
  const agenda = by(d, 'Les annonces à venir'), lines = t => d.sections.find(s => t.test(s.title)).lines.join('\n');
  assert.match(agenda, /Lundi 28 septembre à 14:30 \(heure de Paris\) : ISM Manufacturing PMI/); assert.match(agenda, /la semaine prochaine/); assert.match(agenda, /Mercredi : |ADP Employment/); assert.match(agenda, /Non-Farm Employment Change/); assert.doesNotMatch(agenda, /Core PCE|Two weeks away/);
  assert.match(lines(/écoulée/), /Unemployment Claims/); assert.match(lines(/écoulée/), /Core PCE/); assert.doesNotMatch(lines(/écoulée/), /ISM/);
  assert.match(lines(/qui s'ouvre/), /ISM Manufacturing PMI/); assert.match(lines(/qui s'ouvre/), /ADP Employment/); assert.doesNotMatch(lines(/qui s'ouvre/), /Core PCE|Unemployment|Two weeks away/);
});

test('week-end sans annonce : messages dédiés pour le bilan et pour lundi', () => {
  const d = debrief({ market, row: row(), events: [], now: SAT });
  assert.match(by(d, 'Les annonces de la semaine écoulée'), /Aucune annonce d'importance moyenne ou forte n'a été publiée depuis lundi/);
  assert.match(by(d, 'Les annonces à venir'), /pas encore publié par notre source/);
  assert.match(d.sections.find(s => /écoulée/.test(s.title)).lines[0], /Aucune annonce importante depuis lundi/);
});

test('en semaine : pas de section « semaine écoulée » ; les annonces du jour déjà publiées restent signalées', () => {
  const d = debrief({ market, row: row(), macro, events: [ev('2026-09-28T06:00:00Z', 'USD', 'Early data', 'High')], now: MON });
  assert.ok(!d.sections.some(s => /écoulée/.test(s.title))); assert.ok(!d.story.some(p => /écoulée/.test(p.title)));
  assert.match(d.sections.find(s => /Agenda/.test(s.title)).lines.join('\n'), /Early data.*déjà publiée/);
});

test('accords : le biais est masculin, sur la semaine et sur la dernière séance (week-end) ou la journée', () => {
  assert.match(debrief({ market, row: row(), macro, events: [], now: SAT }).story[0].text, /Le biais est baissier sur la semaine et baissier sur la dernière séance/);
  assert.match(debrief({ market, row: row(), macro, events: [], now: MON }).story[0].text, /Le biais est baissier sur la semaine et baissier sur la journée/);
});
