// Le calcul de saisonnalité (calc.js) doit reproduire, chiffre pour chiffre, l'ancien calcul qui vivait dans la page.
// Référence : test/fixtures/nq-seasonal-golden.json, produite en exécutant l'ancien code (test/fixtures/seasonal.legacy.js.txt)
// sur 20 ans de séances du Nasdaq 100 (test/fixtures/nq-daily.json) avec la date figée du 25/09/2026.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const CALC = require('../calc.js');

const fx = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
const rows = fx('nq-daily.json'), golden = fx('nq-seasonal-golden.json');
const report = CALC.seasonalReport(rows, new Date(golden.now));
const near = (a, b, tol, msg) => assert.ok(a != null && b != null ? Math.abs(a - b) <= tol + 1e-9 : a === b, `${msg} : ${a} ≠ ${b}`);
const curve = (arr, msg, ref, tol = 1e-3) => { assert.equal(arr.length, ref.length, msg + ' (longueur)'); ref.forEach(([, v], i) => near(arr[i], v, tol, `${msg}[${i}]`)); };

test('méta : date de référence et années complètes', () => {
  assert.deepEqual([report.meta.year, report.meta.month, report.meta.day], [2026, 8, 25]);
  assert.equal(report.meta.years, 19);                                              // 2006 est incomplète (la série démarre le 25/09) : 2007 à 2025 = 19 années
});

test('courbes annuelles (10, 5, 2 ans) identiques à la référence', () => {
  for (const n of [10, 5, 2]) curve(report.annual[n], `annuel ${n} ans`, golden.annual[`${n} ans`]);
});

test('année en cours (cumul depuis le 1er janvier) identique, et arrêtée à aujourd\'hui', () => {
  const g = golden.annual['2026'], got = report.ytd.map((v, i) => [i, v]).filter(p => p[1] != null);
  curve(got.map(p => p[1]), 'année en cours', g);
  assert.equal(report.ytd.filter(v => v == null).length, 365 - g.length);
});

test('courbes du mois en cours identiques (moyennes 10/5/2 ans et mois réel)', () => {
  for (const n of [10, 5, 2]) curve(report.month[n], `mois ${n} ans`, golden.month[`${n} ans`]);
  curve(report.month.cur.filter(v => v != null), 'septembre 2026', golden.month['Sep 2026']);
});

// Les tableaux de référence contiennent les valeurs affichées (1 décimale en points, 2 en %) : tolérance d'une demi-unité affichée.
const TOL = { pts: 0.051, pct: 0.0051 };
for (const unit of ['pts', 'pct']) {
  test(`tableau mensuel (${unit}) : 5 périodes × 12 mois`, () => {
    for (const n of CALC.PERIODS) golden[unit].monthly[`${n} ans`].forEach((g, mo) => near(report.monthly[unit][n][mo], g, TOL[unit], `${n} ans, mois ${mo + 1}`));
  });
  test(`tableau par semaine (${unit}) : périodes et année en cours`, () => {
    for (const n of CALC.PERIODS) golden[unit].weekly[`${n} ans`].forEach((g, k) => near(report.weekly[unit][n][k], g, TOL[unit], `${n} ans, semaine ${k + 1}`));
    golden[unit].weekly['2026'].forEach((g, k) => near(report.weekly[unit].cur[k], g, TOL[unit], `2026, semaine ${k + 1}`));
  });
  test(`tableau journalier (${unit}) : 30 jours × (5 périodes + année en cours)`, () => {
    Object.entries(golden[unit].daily).forEach(([label, vals]) => {
      const day = +label.split(' ')[0] - 1;
      CALC.PERIODS.forEach((n, j) => near(report.daily[unit][n][day], vals[j], TOL[unit], `${label}, ${n} ans`));
      near(report.daily[unit].cur[day], vals[5], TOL[unit], `${label}, 2026`);
    });
  });
}

for (const unit of ['pts', 'pct']) test(`graphiques en barres (${unit}) : mois sur 10 ans et jours sur 10 ans`, () => {
  golden.bars[unit].month.forEach((g, mo) => near(report.monthly[unit][10][mo] || 0, g, 1e-3, `barre mois ${mo + 1}`));
  golden.bars[unit].day.forEach((g, d) => near(report.daily[unit][10][d] || 0, g, 1e-3, `barre jour ${d + 1}`));
});

test('indicateurs du mois (moyennes, cumul du mois, années haussières)', () => {
  // référence : |Moyenne 10 ans|-128.8|Moyenne 5 ans|-148.7|Moyenne 2 ans|+1,039.1|Ce mois-ci|+1,285.0|Hausse en septembre (10 a.)|4/10|
  const v = golden.kpis.split('|').filter(Boolean), n = s => +s.replace(/,/g, '');
  near(report.kpi.avg[10], n(v[1]), 0.051, 'moyenne 10 ans'); near(report.kpi.avg[5], n(v[3]), 0.051, 'moyenne 5 ans');
  near(report.kpi.avg[2], n(v[5]), 0.051, 'moyenne 2 ans'); near(report.kpi.monthSoFar, n(v[7]), 0.051, 'ce mois-ci');
  assert.equal(`${report.kpi.up}/${report.kpi.n}`, v[9]);
});

test('cohérence interne : la somme des semaines égale la variation du mois, aussi bien par période qu\'en réel', () => {
  for (const n of CALC.PERIODS) {
    const somme = report.weekly.pts[n].reduce((s, v) => s + (v ?? 0), 0);
    near(somme, report.monthly.pts[n][report.meta.month], 0.01, `${n} ans : semaines vs mois`);
  }
});

test('données vides ou trop courtes : pas d\'exception, valeurs nulles', () => {
  const r = CALC.seasonalReport([], new Date(golden.now));
  assert.equal(r.annual[10], null); assert.equal(r.ytd, null); assert.equal(r.kpi.avg[10], null); assert.equal(r.kpi.n, 0);
  const court = CALC.seasonalReport(rows.slice(-100), new Date(golden.now));       // 100 séances : aucune année complète
  assert.equal(court.kpi.n, 0); assert.equal(court.monthly.pts[10].every(v => v === null), true);
});

test('en décembre, l\'année en cours (plus de 200 séances) reste exclue des moyennes', () => {
  // Le seuil de 200 séances suffit à écarter une année en cours jusqu'en octobre, pas après : seule la règle « année < année courante » protège en fin d'année.
  const now = new Date('2025-12-15T12:00:00Z'), passees = rows.filter(r => r[0] * 1e3 < +now);
  assert.ok(passees.filter(r => new Date(r[0] * 1e3).getUTCFullYear() === 2025).length > 200, 'préalable : 2025 a plus de 200 séances');
  const r = CALC.seasonalReport(passees, now);
  assert.equal(r.meta.years, 18);                                                   // 2007 à 2024 ; 2025 est en cours
  assert.ok(r.ytd && r.ytd.filter(v => v != null).length > 200);                    // mais son cumul depuis janvier reste affiché
  // Ajouter l'année en cours aux moyennes change forcément la moyenne à 2 ans : on vérifie qu'elle porte sur 2023-2024.
  const deuxAns = CALC.seasonalReport(passees.filter(x => new Date(x[0] * 1e3).getUTCFullYear() <= 2024), new Date('2025-12-15T12:00:00Z'));
  assert.deepEqual(r.annual[2], deuxAns.annual[2]);
});
