// Dates officielles lues automatiquement : page FOMC de la Fed, réponses FRED, fusion dans le calendrier (sans doublon, remplacement des « habituels »).
const test = require('node:test'), assert = require('node:assert/strict');
const R = require('../releases.js'), MC = require('../monthcal.js'), M = require('../macro.js');

// Extrait fidèle à la structure de federalreserve.gov/monetarypolicy/fomccalendars.htm.
const row = (month, date) => `<div class="row fomc-meeting"> <div class="fomc-meeting__month col-xs-5"><strong>${month}</strong></div> <div class="fomc-meeting__date col-xs-4">${date}</div> </div>`;
const PAGE = `<h4><a id="1">2027 FOMC Meetings</a></h4>${row('January', '26-27')}${row('March', '16-17*')}${row('Apr/May', '30-1')}${row('June', '8 (notation vote)')}<div class="panel-footer">* SEP</div>`
  + `<h4><a id="2">2026 FOMC Meetings</a></h4>${row('October', '27-28')}${row('December', '8-9*')}<div class="panel-footer">x</div>`;

test('page FOMC : jour de la décision (2e jour), projections (*), réunion à cheval sur deux mois, votes écrits ignorés', () => {
  assert.deepEqual(R.parseFomcPage(PAGE), ['2026-10-28', '2026-12-09*', '2027-01-27', '2027-03-17*', '2027-05-01']);
  assert.deepEqual(R.parseFomcPage('<html>rien</html>'), []);
});

test('FRED : adresse (clé masquée dans le journal), dates futures, réponse d\'erreur rejetée', () => {
  const u = R.fredUrl('SECRETKEY123', 10, '2026-08-01');
  assert.match(u, /release_id=10/); assert.match(u, /include_release_dates_with_no_data=true/); assert.match(u, /realtime_start=2026-08-01/);
  assert.doesNotMatch(M.redactUrl(u), /SECRETKEY123/, 'jamais la clé dans le journal');
  assert.deepEqual(R.parseFredDates({ release_dates: [{ release_id: 10, date: '2026-11-10' }, { date: '2026-07-14' }, { date: '2026-10-14' }, { date: '2026-10-14' }, { date: 'x' }] }, '2026-08-01'),
    ['2026-10-14', '2026-11-10']);
  assert.throws(() => R.parseFredDates({ error_code: 400, error_message: 'Bad Request. The value for variable api_key is not registered.' }), /api_key is not registered/);
  assert.equal(Object.keys(R.RELEASES).length, 15); assert.deepEqual(R.RELEASES.nfp, [50, '08:30']); assert.deepEqual(R.RELEASES.jolts, [192, '10:00']);
});

test('fusion : dates FRED ajoutées (heure fixe), sans doublon avec la table saisie ; chômage hebdomadaire et Michigan remplacent les rendez-vous « habituels »', () => {
  const auto = R.build({ fred: { cpi: ['2027-01-13'], claims: ['2027-01-07', '2027-01-14'], umich: ['2027-01-08'], gdp: ['2027-01-28'], retail: ['2026-10-15'] }, fomc: ['2027-01-27'] });
  const jan = MC.monthEvents(2027, 0, [], auto).events, at = d => (jan[d] || []).map(x => `${x.time} ${x.kind} ${x.source}`);
  assert.deepEqual(at('2027-01-13'), ['08:30 cpi officiel']); assert.deepEqual(at('2027-01-07'), ['08:30 claims officiel']);
  assert.ok(!Object.values(jan).flat().some(x => x.kind === 'claims' && x.source === 'habituel'), 'plus de jeudi « habituel » quand FRED donne les dates');
  assert.ok(!Object.values(jan).flat().some(x => x.kind === 'umich' && x.source === 'habituel'));
  assert.equal(jan['2027-01-28'].find(x => x.kind === 'gdp').label, 'PIB du 4e trimestre (1re estimation)');
  assert.deepEqual(at('2027-01-27'), ['14:00 fomc officiel'], 'décision lue sur la page de la Fed (et déjà connue : pas de doublon)');
  const oct = MC.monthEvents(2026, 9, [], auto).events;
  assert.equal(oct['2026-10-15'].filter(x => x.kind === 'retail').length, 1, 'date déjà dans la table saisie : pas de doublon');
  assert.equal(MC.knownUntil(auto), '2027-01-28'); assert.equal(MC.knownUntil(null), '2026-12-31');
});
