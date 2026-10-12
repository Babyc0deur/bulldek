// Interprétation intermarchés : sens d'une corrélation selon les familles d'actifs, profil d'un marché face aux grands moteurs,
// paragraphe « Intermarchés » du débrief (indices uniquement) et lecture affichée sur la page.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const I = require('../intermarket.js'), CALC = require('../calc.js');
const { render } = require('../tools/fake-dom.js');

const rng = seed => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5; };
const T0 = Date.UTC(2024, 0, 1), rows = rets => { let p = 100; return rets.map((r, i) => [(T0 + i * 864e5) / 1e3, p *= 1 + r / 100]); };
const walk = (n, seed) => { const g = rng(seed); return Array.from({ length: n }, () => g() * 2); };

test('familles : marchés connus, repli par groupe pour les autres (matières premières, énergie, devises…)', () => {
  assert.equal(I.familyOf('sp500'), 'actions'); assert.equal(I.familyOf('10-year-t-note'), 'obligations'); assert.equal(I.familyOf('us-dollar'), 'dollar');
  assert.equal(I.familyOf('wheat', 'Grains'), 'matiere'); assert.equal(I.familyOf('natural-gas', 'Energy'), 'petrole'); assert.equal(I.familyOf('euro-fx', 'Currencies'), 'devises');
  assert.equal(I.familyOf('inconnu'), 'matiere');
});

test('interprétation : actions/obligations, actions/pétrole, dollar/matières, selon le signe ; texte de repli sinon', () => {
  const m = I.meaning;
  assert.match(m('actions', 'obligations', 0.4), /ne jouent plus leur rôle de protection/); assert.match(m('obligations', 'actions', -0.4), /refuge classique/);
  assert.match(m('actions', 'petrole', -0.5), /vent contraire/); assert.match(m('petrole', 'actions', 0.5), /demande économique/);
  assert.match(m('dollar', 'or', -0.5), /Effet dollar habituel/); assert.match(m('or', 'dollar', 0.4), /refuge ou de demande mondiale/);
  assert.match(m('actions', 'cuivre', 0.5), /croissance industrielle/); assert.match(m('actions', 'crypto', 0.5), /actif de croissance/); assert.match(m('actions', 'refuge', -0.3), /rôle de refuge/);
  assert.match(m('actions', 'or', -0.3), /rôle de refuge face aux actions/); assert.match(m('actions', 'matiere', -0.4), /offre/);
  assert.match(m('crypto', 'matiere', 0.5), /même facteur dominant/); assert.match(m('crypto', 'matiere', -0.5), /sens inverse/);
});

test('changement de régime : seuils 0,3 (récent) et 0,15 (historique), signes opposés', () => {
  assert.equal(I.isShift(0.4, -0.2), true); assert.equal(I.isShift(-0.4, 0.2), true);
  assert.equal(I.isShift(0.29, -0.5), false); assert.equal(I.isShift(0.4, -0.14), false); assert.equal(I.isShift(0.4, 0.3), false); assert.equal(I.isShift(null, 0.3), false);
});

test('page : lecture affichée sous chaque relation et chaque changement de régime ; absente quand il n\'y a rien à dire', async () => {
  const ASSETS = [{ slug: 'a', name: 'Alpha', short: 'ALP' }, { slug: 'b', name: 'Bravo', short: 'BRV' }];
  const data = { updated: 1, asOf: '2026-10-02', assets: ASSETS, windows: [20, 60, 120, 250, 'max'], matrix: Object.fromEntries([20, 60, 120, 250, 'max'].map(w => [w, [[1, 0.1], [0.1, 1]]])),
    pairs: [{ a: 'a', b: 'b', aName: 'Alpha', bName: 'Bravo', expect: 1, why: 'x', r60: 0.5, r250: 0.4, rMax: 0.3, status: { key: 'ok', label: 'Conforme à la théorie' }, reading: 'Phrase de lecture.' },
      { a: 'b', b: 'a', aName: 'Bravo', bName: 'Alpha', expect: 1, why: 'y', r60: 0.1, r250: 0.1, rMax: 0.1, status: { key: 'weak', label: 'Lien faible en ce moment' }, reading: null }],
    shifts: [{ a: 'a', b: 'b', aName: 'Alpha', bName: 'Bravo', r60: 0.5, rMax: -0.3, gap: 0.8, reading: 'Sens du changement.' }] };
  const { el } = await render({ src: path.join(__dirname, '..', 'intermarketview.js'), fnName: '((a, root) => renderIntermarket(a, root))', args: data, now: Date.now(), calc: {} });
  assert.match(el('#imPairs').innerHTML, /Conforme à la théorie<\/span><br><small>Phrase de lecture\.<\/small>/);
  assert.match(el('#imPairs').innerHTML, /Lien faible en ce moment<\/span><\/td>/, 'pas de lecture : pas de saut de ligne ni de texte vide');
  assert.match(el('#imShifts').innerHTML, /<em>Sens du changement\.<\/em>/);
});

const ratio = (id, label, num, den, chg60, pos250, dir, reading) => ({ id, label, num, den, last: 1.23, chg20: 0, chg60, pos250, dir, reading });
const RATIOS = [
  ratio('nasdaq-sp500', 'Nasdaq 100 / S&P 500', 'nasdaq-100', 'sp500', 4.2, 95, 'up', 'Nasdaq 100 / S&P 500 progresse de 4,2 % sur 3 mois — le Nasdaq surperforme.'),
  ratio('nasdaq-dow', 'Nasdaq 100 / Dow Jones', 'nasdaq-100', 'dow-jones', -3.1, 40, 'down', 'Nasdaq 100 / Dow Jones recule de 3,1 % sur 3 mois — la valeur surperforme.'),
  ratio('sp500-dollar', 'S&P 500 / Dollar américain', 'sp500', 'us-dollar', 0.3, 50, 'flat', 'stable'),
  ratio('cuivre-obligations', 'Cuivre / T-Note 10 ans', 'copper', '10-year-t-note', 9.4, 50, 'up', 'Cuivre / T-Note 10 ans progresse de 9,4 % sur 3 mois — demande industrielle en hausse.'),
];
const REGIME = { key: 'inflation', label: 'Régime inflationniste', r60: 0.42, r250: 0.24 };
