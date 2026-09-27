// Calendrier de publication du rapport COT, vérifié contre le calendrier OFFICIEL de la CFTC pour 2026
// (https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule — consulté le 25/09/2026).
const test = require('node:test'), assert = require('node:assert/strict');
const CALC = require('../calc.js');

// Les 52 dates officielles de 2026 ; « * » = publication décalée par un jour férié fédéral.
const OFFICIEL = `
2026-01: 05* 09 16 23 30
2026-02: 06 13 20 27
2026-03: 06 13 20 27
2026-04: 03 10 17 24
2026-05: 01 08 15 22 29
2026-06: 05 12 22* 26
2026-07: 06* 10 17 24 31
2026-08: 07 14 21 28
2026-09: 04 11 18 25
2026-10: 02 09 16 23 30
2026-11: 06 16* 20 30*
2026-12: 04 11 18 28*`.trim().split('\n').flatMap(l => { const [ym, rest] = l.split(': '); return rest.split(' ').map(x => ({ date: `${ym}-${x.replace('*', '')}`, delayed: x.endsWith('*') })); });

test('le calendrier officiel de référence contient bien 52 publications dont 6 décalées', () => {
  assert.equal(OFFICIEL.length, 52);
  assert.deepEqual(OFFICIEL.filter(x => x.delayed).map(x => x.date), ['2026-01-05', '2026-06-22', '2026-07-06', '2026-11-16', '2026-11-30', '2026-12-28']);
});

test('les 52 dates de publication de 2026 sont retrouvées, y compris les 6 décalées par un jour férié', () => {
  // Mardis de positions : du 30/12/2025 (publié le 5/01/2026) au 22/12/2026 (publié le 28/12/2026).
  const calcule = []; let t = Date.parse('2025-12-30T00:00:00Z');
  for (; t <= Date.parse('2026-12-22T00:00:00Z'); t += 7 * 864e5) { const r = CALC.cotReleaseDate(new Date(t).toISOString().slice(0, 10)); calcule.push({ date: r.date, delayed: r.delayed }); }
  assert.equal(calcule.length, 52);
  assert.deepEqual(calcule, OFFICIEL);
});

test('jours fériés fédéraux 2026 (dates observées)', () => {
  const H = CALC.usFederalHolidays(2026);
  for (const d of ['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03' /* 4 juillet = samedi → vendredi */, '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25'])
    assert.ok(H.has(d), d);
  assert.ok(!H.has('2026-07-04'));                                                 // le jour « observé » remplace le samedi
  assert.equal([...H].filter(d => d.startsWith('2026')).length, 11);
});

test('jour férié observé le 31 décembre (1er janvier un samedi) : 2022 → vendredi 31/12/2021', () => {
  assert.ok(CALC.usFederalHolidays(2022).has('2021-12-31'));
  assert.ok(CALC.usFederalHolidays(2021).has('2021-12-31'));                        // vu aussi depuis l'année précédente
});

test('jour férié du lundi : pas de décalage ; jour férié en semaine : un jour ouvré de plus', () => {
  assert.deepEqual(CALC.cotReleaseDate('2026-09-08'), { date: '2026-09-11', delayed: false });      // Labor Day (lundi 7/09) : publication normale le vendredi
  assert.deepEqual(CALC.cotReleaseDate('2026-11-10'), { date: '2026-11-16', delayed: true });       // Veterans Day (mercredi 11/11) : vendredi 13 → lundi 16
  // Noël 2021 tombait un samedi : fermeture observée le vendredi 24/12 → publication du vendredi reportée au lundi 27/12
  assert.ok(CALC.usFederalHolidays(2021).has('2021-12-24'));
  assert.deepEqual(CALC.cotReleaseDate('2021-12-21'), { date: '2021-12-27', delayed: true });
});

test('heure de publication : 15h30 à New York, en heure d\'été comme d\'hiver', () => {
  const iso = t => new Date(t).toISOString();
  assert.equal(iso(CALC.etInstant('2026-10-02')), '2026-10-02T19:30:00.000Z');    // EDT (UTC−4)
  assert.equal(iso(CALC.etInstant('2026-12-04')), '2026-12-04T20:30:00.000Z');    // EST (UTC−5)
  assert.equal(iso(CALC.etInstant('2026-03-06')), '2026-03-06T20:30:00.000Z');    // juste avant le passage à l'heure d'été (8/03)
  assert.equal(iso(CALC.etInstant('2026-03-13')), '2026-03-13T19:30:00.000Z');    // juste après
  assert.equal(iso(CALC.etInstant('2026-11-06')), '2026-11-06T20:30:00.000Z');    // juste après le retour à l'heure d'hiver (1/11)
});

test('prochain rapport d\'après les dernières positions disponibles', () => {
  // Dernières positions : mardi 15/09/2026 → prochain : mardi 22/09, publié le vendredi 25/09/2026 à 15h30 New York (19:30 UTC)
  const n = CALC.nextCotRelease('2026-09-15', Date.parse('2026-09-25T10:00:00Z'));
  assert.equal(n.reportDate, '2026-09-22'); assert.equal(n.releaseDate, '2026-09-25'); assert.equal(n.delayed, false);
  assert.equal(new Date(n.at).toISOString(), '2026-09-25T19:30:00.000Z');
  assert.equal(n.overdue, false); assert.equal(n.msLeft, 9.5 * 3600e3);
  assert.equal(CALC.nextCotRelease('2026-09-15', Date.parse('2026-09-25T19:30:01Z')).overdue, true);   // publié mais pas encore repris dans nos données
  const noel = CALC.nextCotRelease('2026-12-15', Date.parse('2026-12-20T12:00:00Z'));                  // Noël un vendredi
  assert.equal(noel.releaseDate, '2026-12-28'); assert.equal(noel.delayed, true);
});
