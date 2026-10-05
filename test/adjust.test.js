// Ajustement des changements de contrat des indices : saut de base repéré autour des échéances trimestrielles, mesuré de façon robuste, corrigé vers l'arrière.
const test = require('node:test'), assert = require('node:assert/strict');
const A = require('../adjust.js');

const DAY = 86400;
const iso = t => new Date(t * 1e3).toISOString().slice(0, 10);
// Séances du lundi au vendredi entre deux dates ; comptant : marche régulière ; future = comptant × base, la base saute de `gap` le jour `rollDay`.
function build({ from = '2024-01-02', to = '2024-12-31', gaps = {}, noise = {} } = {}) {
  const cash = [], fut = []; let c = 100, basis = 1.002;
  for (let t = Date.parse(from + 'T14:30:00Z') / 1e3; t <= Date.parse(to + 'T14:30:00Z') / 1e3; t += DAY) {
    const w = new Date(t * 1e3).getUTCDay(); if (w === 0 || w === 6) continue;
    const d = iso(t); c *= 1.0004; if (gaps[d]) basis *= 1 + gaps[d];
    const f = c * basis * (1 + (noise[d] || 0));
    cash.push([t, +c.toFixed(4), c, c]); fut.push([t, +f.toFixed(4), +(f * 1.004).toFixed(4), +(f * 0.996).toFixed(4)]);
  }
  return { cash, fut };
}
const logBasis = (fut, cash) => fut.map((r, i) => Math.log(r[1] / cash[i][1]));

test('3e vendredi et échéances trimestrielles (mars, juin, septembre, décembre)', () => {
  assert.equal(new Date(A.thirdFriday(2026, 2)).toISOString().slice(0, 10), '2026-03-20');
  assert.equal(new Date(A.thirdFriday(2025, 8)).toISOString().slice(0, 10), '2025-09-19');
  assert.deepEqual(A.quarterlyExpiries(2024, 2024).map(t => new Date(t).toISOString().slice(0, 10)), ['2024-03-15', '2024-06-21', '2024-09-20', '2024-12-20']);
});

test('changements de contrat repérés (lundi suivant l\'échéance ou jour même) et série ajustée continue ; dernier prix inchangé', () => {
  const { cash, fut } = build({ gaps: { '2024-03-18': 0.008, '2024-06-21': 0.009, '2024-09-23': 0.007, '2024-12-23': 0.01 } });
  const r = A.rollAdjust(fut, cash);
  assert.deepEqual(r.rolls.map(x => x.date), ['2024-03-18', '2024-06-21', '2024-09-23', '2024-12-23']);
  assert.deepEqual(r.rolls.map(x => Math.round(x.gapPct * 10) / 10), [0.8, 0.9, 0.7, 1]);
  assert.equal(r.rows.at(-1)[1], fut.at(-1)[1], 'le dernier prix reste le prix coté');
  assert.equal(r.rows.length, fut.length);
  const lb = logBasis(r.rows, cash), spread = Math.max(...lb) - Math.min(...lb);
  assert.ok(spread < 0.0005, 'base de la série ajustée quasi constante : ' + spread);
  assert.ok(Math.abs(r.rows[0][2] / r.rows[0][1] - fut[0][2] / fut[0][1]) < 1e-6, 'plus haut / plus bas ajustés avec la clôture');
});

test('saut sous 0,15 % ignoré ; sans série au comptant, série d\'origine', () => {
  const { cash, fut } = build({ gaps: { '2024-03-18': 0.001 } });
  assert.equal(A.rollAdjust(fut, cash).rolls.length, 0);
  assert.equal(A.rollAdjust(fut, []).rows, fut); assert.equal(A.rollAdjust(fut, null).rolls.length, 0);
});

test('mesure robuste : une clôture aberrante le jour du changement ne fausse pas l\'ampleur du saut', () => {
  // Le 18 mars : base +0,8 %, plus un écart d'horaire de clôture de 3 % ce jour-là seulement (séance très agitée).
  const { cash, fut } = build({ gaps: { '2024-03-18': 0.008 }, noise: { '2024-03-18': 0.03 } });
  const r = A.rollAdjust(fut, cash), g = r.rolls.find(x => x.date === '2024-03-18');
  assert.ok(g, 'changement repéré'); assert.ok(Math.abs(g.gapPct - 0.8) < 0.05, 'ampleur mesurée par les médianes : ' + g.gapPct);
});

test('saut de plus de 4 % : pas un changement de contrat, ignoré', () => {
  const { cash, fut } = build({ gaps: { '2024-03-18': 0.06 } });
  assert.equal(A.rollAdjust(fut, cash).rolls.length, 0);
});
