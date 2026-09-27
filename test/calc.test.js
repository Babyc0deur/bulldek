const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../calc.js');
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);

test('COT Index : fourchette glissante 0-100', () => {
  const r = C.cotIndex([0, 10, 5, 20, 15], 3);
  [50, 100, 50, 100, 200 / 3].forEach((v, i) => near(r[i], v));
  assert.deepEqual(C.cotIndex([7, 7, 7], 26), [50, 50, 50]);           // fourchette nulle
  const r2 = C.cotIndex([5, 1, 9, 4], 26);                             // fenêtre plus longue que la série
  near(r2[1], 0); near(r2[2], 100); near(r2[3], 37.5);
});

test('Williams %R : formule (plus haut − clôture) / (plus haut − plus bas) × −100', () => {
  const rows = [[1, 10, 11, 9], [2, 12, 13, 11], [3, 11, 12, 10], [4, 13, 14, 12]];
  const r = C.williamsR(rows, 3);
  assert.equal(r.length, 2);
  near(r[0][1], -50);                                                  // hh 13, ll 9, clôture 11
  near(r[1][1], -25);                                                  // hh 14, ll 10, clôture 13
  assert.equal(r[1][0], 4);
  assert.equal(C.williamsR(rows, 5).length, 0);                        // pas assez de données
  near(C.williamsR([[1, 5, 5, 5], [2, 5, 5, 5]], 2)[0][1], -50);       // plus haut = plus bas
});

test('Williams %R : bornes −100 et 0', () => {
  const up = C.williamsR([[1, 1, 2, 1], [2, 2, 3, 2], [3, 3, 3, 2]], 3);
  near(up[0][1], 0);                                                   // clôture = plus haut
  const dn = C.williamsR([[1, 3, 3, 2], [2, 2, 2, 1], [3, 1, 2, 1]], 3);
  near(dn[0][1], -100);                                                // clôture = plus bas
});

// Série synthétique : chaque jour de l'année vaut 1000 + 10 × mois → variation de juin = +10, de janvier = −110.
function synth(y0, y1) {
  const rows = [];
  for (let y = y0; y <= y1; y++) for (let d = 0; d < 365; d++) {
    const t = Date.UTC(y, 0, 1) + d * 864e5, m = new Date(t).getUTCMonth();
    rows.push([t / 1e3, 1000 + 10 * m, 1000 + 10 * m, 1000 + 10 * m]);
  }
  return rows;
}

// Série synthétique pour la semaine calendaire : prix constant à 1000, sauf à partir du dimanche de la semaine choisie
// (mêmes dates chaque année) où il saute à `after(y)`. Permet de contrôler la variation et le sens par année.
const NOW_WK = new Date(Date.UTC(2026, 8, 22));                        // mardi 22 septembre 2026 → semaine du 21 (lundi) au 27 (dimanche)
function synthWeek(y0, y1, after = () => 1050) {
  const dow = (NOW_WK.getUTCDay() + 6) % 7, monday = new Date(Date.UTC(NOW_WK.getUTCFullYear(), NOW_WK.getUTCMonth(), NOW_WK.getUTCDate() - dow));
  const sunday = new Date(+monday + 6 * 864e5);
  const rows = [];
  for (let y = y0; y <= y1; y++) {
    const sun = Date.UTC(y, sunday.getUTCMonth(), sunday.getUTCDate());
    for (let d = 0; d < 365; d++) { const t = Date.UTC(y, 0, 1) + d * 864e5, p = t >= sun ? after(y) : 1000; rows.push([t / 1e3, p, p, p]); }
  }
  return rows;
}
test('Saisonnalité hebdomadaire : semaine calendaire (lundi−dimanche), moyenne, %, années haussières', () => {
  const rows = synthWeek(2010, 2025);
  const s = C.seasonalWeek(rows, NOW_WK, 10, 2026);
  assert.equal(s.n, 10); assert.equal(s.up, 10);
  near(s.avgPts, 50); near(s.avgPct, 5);                               // 1000 → 1050 le dimanche : +50 pts, +5 %
});
test('Saisonnalité hebdomadaire : années baissières comptées séparément (taux de hausse)', () => {
  const rows = synthWeek(2016, 2025, y => (y % 2 === 0 ? 1050 : 950));
  const s = C.seasonalWeek(rows, NOW_WK, 10, 2026);
  assert.equal(s.n, 10); assert.equal(s.up, 5);                        // une année sur deux en hausse
  near(s.avgPts, 0);                                                   // +50 et −50 s'annulent en moyenne
});
test('Saisonnalité hebdomadaire : exclut l\'année en cours et les années incomplètes', () => {
  const rows = synthWeek(2020, 2026).concat(synthWeek(2019, 2019).map(r => [r[0], r[1], r[2], r[3]]).slice(0, 50));
  const s = C.seasonalWeek(rows, NOW_WK, 20, 2026);
  assert.equal(s.n, 6);                                                // 2020-2025 seulement (2026 = année en cours, 2019 = incomplète)
});
test('Saisonnalité hebdomadaire : semaine à cheval sur deux mois, gérée comme les autres', () => {
  const now = new Date(Date.UTC(2026, 8, 29));                         // mardi 29 septembre → semaine du 28 sept. au 4 oct.
  const dow = (now.getUTCDay() + 6) % 7, monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
  assert.equal(monday.getUTCMonth(), 8); assert.equal(new Date(+monday + 6 * 864e5).getUTCMonth(), 9);   // chevauche septembre → octobre
  const rows = [];
  for (let y = 2016; y <= 2025; y++) for (let d = 0; d < 365; d++) { const t = Date.UTC(y, 0, 1) + d * 864e5; rows.push([t / 1e3, 1000, 1000, 1000]); }
  const s = C.seasonalWeek(rows, now, 10, 2026);
  assert.equal(s.n, 10); assert.equal(s.avgPts, 0);                    // prix constant : aucune variation, mais pas d'exception
});

test('Signaux : seuils COT, Williams %R et saisonnalité', () => {
  assert.equal(C.cotSignal(80), 1); assert.equal(C.cotSignal(79.9), 0);
  assert.equal(C.cotSignal(20), -1); assert.equal(C.cotSignal(20.1), 0);
  assert.equal(C.cotLabel(90), 'Achat'); assert.equal(C.cotLabel(0), 'Vente'); assert.equal(C.cotLabel(50), 'Patience');
  assert.equal(C.wrSignal(-85), 1); assert.equal(C.wrSignal(-80), 0);
  assert.equal(C.wrSignal(-10), -1); assert.equal(C.wrSignal(-20), 0);
  assert.equal(C.seasonSignal({ n: 10, avgPct: 1, up: 7 }), 1);
  assert.equal(C.seasonSignal({ n: 10, avgPct: -1, up: 3 }), -1);
  assert.equal(C.seasonSignal({ n: 10, avgPct: 1, up: 5 }), 0);        // pas assez régulier
  assert.equal(C.seasonSignal({ n: 3, avgPct: 5, up: 3 }), 0);         // échantillon trop court
  assert.equal(C.seasonSignal(null), 0);
});
