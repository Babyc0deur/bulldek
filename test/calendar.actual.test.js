// Chiffre publié (« actual ») : source FMP facultative, lecture de la surprise dans le récit, et clé d'accès jamais écrite dans le journal.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const M = require('../macro.js'), { debrief } = require('../debrief.js'), { surprise } = require('../narrative.js');

const SAT = Date.parse('2026-09-26T10:00:00Z');
const market = { slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini' };
const row = { slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini', fresh: 'ok', roll: false, price: 24500, chgPct: 0.1, priceDate: Date.parse('2026-09-25T00:00:00Z') / 1e3, group: 'Indices',
  wr: -50, idx36: 50, idx6: 50, score: 0, sig: { cot: 0, season: 0, wr: 0, oi: 0 }, season: null, oi: null };
const ev = (iso, title, o = {}) => ({ t: Date.parse(iso), ccy: 'USD', title, impact: 'High', forecast: '', previous: '', actual: '', ...o });
const recap = d => d.story.find(p => /écoulée/.test(p.title)).text;

test('FMP : adresse avec fenêtre −8 / +14 jours et clé encodée ; événements normalisés avec le chiffre publié', () => {
  const u = M.fmpUrl('ab c&d', SAT);
  assert.match(u, /^https:\/\/financialmodelingprep\.com\/stable\/economic-calendar\?from=2026-09-18&to=2026-10-10&apikey=ab%20c%26d$/);
  const out = M.parseFmpCalendar([
    { date: '2026-09-25 12:30:00', currency: 'USD', event: 'Core PCE Price Index (MoM)', impact: 'High', estimate: 0.2, previous: 0.3, actual: 0.4 },
    { date: '2026-09-24 12:30:00', currency: 'USD', event: 'Initial Jobless Claims', impact: 'Medium', estimate: 215, previous: 218, actual: null },
    { date: 'pas une date', currency: 'USD', event: 'x', impact: 'Low' }, { date: '2026-09-25 09:00:00', currency: '', event: 'sans devise' }]);
  assert.deepEqual(out.map(e => e.title), ['Initial Jobless Claims', 'Core PCE Price Index (MoM)']);
  assert.equal(out[1].t, Date.parse('2026-09-25T12:30:00Z')); assert.equal(out[1].actual, '0.4'); assert.equal(out[1].forecast, '0.2'); assert.equal(out[1].impact, 'High');
  assert.equal(out[0].actual, '', 'chiffre non encore publié : vide, pas « null »');
});

test('FMP : réponse d\'erreur (clé invalide, offre sans calendrier) rejetée pour laisser le serveur retomber sur Forex Factory', () => {
  assert.throws(() => M.parseFmpCalendar({ 'Error Message': 'Invalid API KEY.' }), /inattendu/);
  assert.throws(() => M.parseFmpCalendar(null), /inattendu/);
  assert.deepEqual(M.parseFmpCalendar([]), []);
});

test('Forex Factory garde la même forme (actual vide) : rien ne casse pour les consommateurs', () => {
  const [e] = M.parseCalendar([{ title: 'CPI', country: 'USD', date: '2026-09-25T08:30:00-04:00', impact: 'High', forecast: '0.2%', previous: '0.3%' }]);
  assert.equal(e.actual, '');
});

test('adresse de journal : jamais de clé d\'accès, quel que soit le nom du paramètre', () => {
  assert.equal(M.redactUrl(M.fmpUrl('SECRETKEY123', SAT)).includes('SECRETKEY123'), false);
  assert.doesNotMatch(M.redactUrl('https://x.test/a?apikey=SECRET&from=1'), /SECRET/); assert.match(M.redactUrl('https://x.test/a?apikey=SECRET&from=1'), /from=1/);
  assert.doesNotMatch(M.redactUrl('https://x.test/a?access_token=SECRET'), /SECRET/); assert.doesNotMatch(M.redactUrl('https://x.test/a?Key=SECRET'), /SECRET/);
  assert.match(M.redactUrl('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=2020-01-01'), /^fred\.stlouisfed\.org\/graph\/fredgraph\.csv\?id=DGS10/);
  assert.doesNotMatch(M.redactUrl('pas une url apikey=SECRET'), /SECRET/);
});

test('le serveur passe par redactUrl pour tout appel sortant et lit la clé dans FMP_API_KEY (jamais en dur)', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(s, /const shortUrl = MACRO\.redactUrl;/); assert.match(s, /process\.env\.FMP_API_KEY/);
  assert.doesNotMatch(s, /apikey=[A-Za-z0-9]{8,}/i);
  const render = fs.readFileSync(path.join(__dirname, '..', 'render.yaml'), 'utf8');
  assert.match(render, /key: FMP_API_KEY\s+sync: false/, 'clé à saisir dans le tableau de bord, jamais dans le dépôt');
});

test('surprise : écart au consensus, lecture restrictive/accommodante, chômage lu à l\'inverse, sans chiffre → null', () => {
  const s = (title, actual, forecast) => surprise({ title, actual, forecast });
  assert.deepEqual(s('Core PCE Price Index m/m', '0.4%', '0.2%'), { dir: 1, hawk: 1 });
  assert.deepEqual(s('Core PCE Price Index m/m', '0.1%', '0.2%'), { dir: -1, hawk: -1 });
  assert.deepEqual(s('Non-Farm Employment Change', '98K', '98K'), { dir: 0, hawk: 0 });
  assert.deepEqual(s('Unemployment Claims', '230K', '215K'), { dir: 1, hawk: -1 });                 // plus de chômage = signe de faiblesse
  assert.deepEqual(s('President Trump Speaks', '1', '0'), { dir: 1, hawk: 0 });                    // hors catégories chiffrées : écart noté, pas de lecture
  assert.equal(s('Core PCE', '', '0.2%'), null); assert.equal(s('Core PCE', '0.4%', ''), null); assert.equal(s('Core PCE', 'n/a', '0.2%'), null);
});

test('récit du week-end : résultat, écart au consensus et effet sur le marché ; la réaction du prix suit', () => {
  const events = [ev('2026-09-25T12:30:00Z', 'Core PCE Price Index m/m', { forecast: '0.2%', previous: '0.3%', actual: '0.4%' }),
    ev('2026-09-24T12:30:00Z', 'Unemployment Claims', { impact: 'Medium', forecast: '215K', previous: '218K', actual: '230K' }),
    ev('2026-09-23T12:30:00Z', 'ISM Services PMI', { forecast: '52', previous: '51', actual: '52' })];
  const t = recap(debrief({ market, row, events, now: SAT }));
  assert.match(t, /Vendredi : chiffre d'inflation « Core PCE Price Index m\/m » \(USD\) \(résultat 0\.4%, prévision 0\.2%, précédent 0\.3%\), supérieur aux attentes \(lecture restrictive, plutôt défavorable à Nasdaq 100 E-Mini\)/);
  assert.match(t, /Jeudi : donnée d'emploi « Unemployment Claims » \(USD, importance moyenne\) \(résultat 230K, prévision 215K, précédent 218K\), supérieur aux attentes \(lecture accommodante, plutôt favorable à Nasdaq 100 E-Mini\)/);
  assert.match(t, /« ISM Services PMI » \(USD\) \(résultat 52, prévision 52, précédent 51\), conforme aux attentes\./);
  assert.match(t, /La réaction du prix dit comment le marché a lu ces chiffres/); assert.doesNotMatch(t, /n'est pas repris par notre source/);
});

test('sans chiffre publié (Forex Factory seul) : le texte l\'assume comme avant, sans verdict inventé', () => {
  const events = [ev('2026-09-25T12:30:00Z', 'Core PCE Price Index m/m', { forecast: '0.2%', previous: '0.3%' })];
  const t = recap(debrief({ market, row, events, now: SAT }));
  assert.match(t, /\(prévision 0\.2%, précédent 0\.3%\)\./); assert.doesNotMatch(t, /\(résultat |, résultat |aux attentes/); assert.match(t, /n'est pas repris par notre source/);
});

test('section détaillée et agenda du jour : « résultat » affiché quand il existe', () => {
  const NOW = Date.parse('2026-09-25T15:00:00Z');                                                   // vendredi, marchés ouverts
  const events = [ev('2026-09-25T12:30:00Z', 'Core PCE Price Index m/m', { forecast: '0.2%', previous: '0.3%', actual: '0.4%' })];
  const d = debrief({ market, row, events, now: NOW }), ag = d.sections.find(s => /Agenda/.test(s.title)).lines.join('\n');
  assert.match(ag, /Core PCE Price Index m\/m · importance forte \(résultat 0\.4%, prévision 0\.2%, précédent 0\.3%\) — déjà publiée/);
  assert.match(d.story.find(p => p.title === 'Les annonces à venir').text, /déjà publiée \(résultat 0\.4%\)/);
  const weekend = debrief({ market, row, events, now: SAT }).sections.find(s => /écoulée/.test(s.title)).lines.join('\n');
  assert.match(weekend, /résultat 0\.4%, prévision 0\.2%, précédent 0\.3%/);
});
