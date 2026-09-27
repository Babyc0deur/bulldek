const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const CALC = require('../calc.js');

const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≠ ${b}`);
const DAY = 86400, day = n => 1.7e9 - (1.7e9 % DAY) + n * DAY;                    // début du jour n (UTC), en secondes
const row = (n, c, hour = 4) => [day(n) + hour * 3600, c];

test('alignement : seuls les jours communs sont conservés, même avec des heures différentes', () => {
  const a = [row(1, 100), row(2, 110), row(3, 121), row(5, 130)];
  const b = [row(1, 50, 5), row(3, 60, 13), row(4, 70), row(5, 80, 14)];          // 04:00, 05:00, 13:30… : même jour UTC
  const al = CALC.alignByDay(a, b);
  assert.deepEqual(al.map(r => [r[1], r[2]]), [[100, 50], [121, 60], [130, 80]]);
  assert.deepEqual(CALC.alignByDay([], b), []);
});

test('rendements alignés : calculés d\'un jour COMMUN au suivant (les jours manquants d\'un marché sont sautés des deux côtés)', () => {
  const a = [row(1, 100), row(2, 110), row(3, 121), row(4, 133.1)], b = [row(1, 50), row(3, 60), row(4, 66)];
  const r = CALC.alignedReturns(a, b);                                            // jours communs : 1, 3, 4
  assert.equal(r.length, 2);
  near(r[0][1], 0.21); near(r[0][2], 0.2);                                        // 1→3 : A 100→121, B 50→60
  near(r[1][1], 0.1); near(r[1][2], 0.1);                                         // 3→4
});

test('rendements alignés : une clôture nulle ou négative est écartée (pas de division par zéro)', () => {
  const a = [row(1, 100), row(2, 0), row(3, 50)], b = [row(1, 10), row(2, 11), row(3, 12)];
  const r = CALC.alignedReturns(a, b);
  assert.equal(r.length, 1); assert.ok(isFinite(r[0][1]) && isFinite(r[0][2]));
});

// suite pseudo-aléatoire reproductible
const lcg = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5;
const pairsOf = (n, f) => { const r = lcg(42); return Array.from({ length: n }, (_, i) => { const x = r(); return [i, x, f(x, r)]; }); };

test('corrélation : +1, −1, ~0 et cas limites', () => {
  near(CALC.correlation(pairsOf(200, x => 3 * x)), 1, 1e-12);                     // parfaitement corrélés (échelle différente)
  near(CALC.correlation(pairsOf(200, x => -x)), -1, 1e-12);
  const ind = CALC.correlation(pairsOf(5000, (x, r) => r()));                     // indépendants
  assert.ok(Math.abs(ind) < 0.05, `indépendants : ${ind}`);
  const partiel = CALC.correlation(pairsOf(5000, (x, r) => 0.6 * x + 0.8 * r()));      // x et le bruit ont la même variance → corrélation attendue 0.6
  assert.ok(Math.abs(partiel - 0.6) < 0.05, `corrélation partielle : ${partiel}`);
  assert.equal(CALC.correlation(pairsOf(19, x => x)), null);                      // trop peu de points
  assert.equal(CALC.correlation(pairsOf(100, () => 0.01)), null);                 // une série constante : corrélation indéfinie
  assert.equal(CALC.correlation([]), null);
});

test('corrélation glissante : la dernière valeur égale la corrélation de la dernière fenêtre', () => {
  const p = pairsOf(300, (x, r) => x + r());
  const roll = CALC.rollingCorrelation(p, 63);
  assert.equal(roll.length, 300 - 63 + 1);
  near(roll.at(-1)[1], CALC.correlation(p.slice(-63)), 1e-12); assert.equal(roll.at(-1)[0], 299);
  assert.deepEqual(CALC.rollingCorrelation(p.slice(0, 10), 63), []);
});

test('base 100 : première séance de la fenêtre = 100, rapports conservés', () => {
  const rows = [row(1, 50), row(2, 55), row(3, 100), row(4, 75)];
  const r = CALC.rebase(rows, day(2));
  [100, 100 * 100 / 55, 100 * 75 / 55].forEach((v, i) => near(r[i][1], v, 1e-9, 'base ' + i));
  assert.equal(r.length, 3);
  assert.deepEqual(CALC.rebase(rows, day(99)), []);                               // fenêtre après les données
  assert.equal(CALC.rebase(rows, 0)[0][1], 100);
});

test('performance : sur N mois calendaires, dernière séance antérieure ou égale à la date cible', () => {
  // clôture = 100 + numéro de jour, un jour sur deux (séries irrégulières) sur ~2 ans
  const rows = []; for (let i = 0; i < 730; i += 2) rows.push(row(i, 100 + i));
  const last = rows.at(-1), p1m = CALC.performance(rows, 1), p12 = CALC.performance(rows, 12);
  assert.ok(p1m && p12);
  assert.ok(p1m.from <= last[0] - 27 * DAY && p1m.from >= last[0] - 33 * DAY, 'le point de départ est à environ un mois');
  near(p1m.pct, (last[1] / (rows.find(r => r[0] === p1m.from)[1]) - 1) * 100, 1e-9);
  assert.equal(CALC.performance(rows, 36), null);                                 // historique de 2 ans : pas de performance à 3 ans
  assert.equal(CALC.performance([row(1, 100)], 1), null);
});

// Vérification sur de vraies données : Nasdaq contre lui-même, et contre une version décalée
test('données réelles (Nasdaq) : corrélation avec lui-même = 1 ; performance cohérente avec les clôtures', () => {
  const nq = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'nq-daily.json'), 'utf8'));
  const self = CALC.alignedReturns(nq, nq);
  assert.ok(self.length > 5000); near(CALC.correlation(self), 1, 1e-9);
  const inv = self.map(r => [r[0], r[1], -r[2]]); near(CALC.correlation(inv), -1, 1e-9);
  const p1y = CALC.performance(nq, 12), ref = nq.find(r => r[0] === p1y.from);
  near(p1y.pct, (nq.at(-1)[1] / ref[1] - 1) * 100, 1e-9);
  assert.ok((nq.at(-1)[0] - p1y.from) / DAY > 360 && (nq.at(-1)[0] - p1y.from) / DAY < 372, 'un an calendaire');
  const base = CALC.rebase(nq, nq.at(-1)[0] - 365 * DAY);
  near(base[0][1], 100); near(base.at(-1)[1], nq.at(-1)[1] / nq.find(r => r[0] >= nq.at(-1)[0] - 365 * DAY)[1] * 100, 1e-9);
});

test('performance : un trou dans les données autour de la date cible donne « indisponible » plutôt qu\'un chiffre trompeur', () => {
  const rows = []; for (let i = 0; i <= 100; i++) rows.push(row(i, 100 + i));           // 100 premiers jours…
  for (let i = 500; i <= 730; i++) rows.push(row(i, 300 + i));                          // …puis un trou de plus d'un an
  assert.equal(CALC.performance(rows, 12), null);                                       // la cible (≈ jour 365) tombe dans le trou : la dernière séance connue avant est à 265 jours
  assert.ok(CALC.performance(rows, 1));                                                 // un mois en arrière : données présentes
});
