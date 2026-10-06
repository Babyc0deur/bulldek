// Source du signal COT : commerciaux Legacy par défaut, groupes du TFF possibles (fonds à levier lus à contre-sens).
const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../cotsource.js');

const iso = t => new Date(t * 1e3).toISOString().slice(0, 10);
// Rapports Legacy du mardi : [date, comm L, comm S, noncomm L, S, nonrept L, S, OI]. net(k) = position nette des commerciaux du k-ième rapport.
function legacy(net, from = '2012-01-03', to = '2020-12-29') {
  const out = []; let k = 0;
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 7 * 864e5, k++) out.push([iso(t / 1e3), 100000 + net(k), 100000, 0, 0, 0, 0, 500000]);
  return out;
}

test('sources COT : commerciaux Legacy par défaut ; fonds à levier du TFF lus à contre-sens', () => {
  assert.equal(S.cotSig('legacy', 90), 1); assert.equal(S.cotSig('tff-am', 90), 1); assert.equal(S.cotSig('tff-lev', 90), -1); assert.equal(S.cotSig('tff-lev', 10), 1);
  const tff = legacy(k => k).map(r => [r[0], 1, 2, 10 + r[1], 5, 3, 4, 0, 0, 0, 0]);
  assert.equal(S.cotSeries('tff-am', null, tff).at(-1).idx6, 100); assert.equal(S.cotSeries('legacy', null, tff), null);
  assert.equal(S.cotSeries('legacy', legacy(() => 0).slice(0, 10), null), null, 'moins de 30 rapports : pas de série');
});
