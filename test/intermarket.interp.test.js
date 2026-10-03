// Interprétation intermarchés : sens d'une corrélation selon les familles d'actifs, profil d'un marché face aux grands moteurs,
// paragraphe « Intermarchés » du débrief (indices uniquement) et lecture affichée sur la page.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const I = require('../intermarket.js'), CALC = require('../calc.js'), { debrief } = require('../debrief.js'), { interStory } = require('../narrative.js');
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

test('profile : corrélations avec les moteurs, sans le marché lui-même ni sa propre famille ; variation à 5 séances du moteur', () => {
  const base = walk(300, 1), series = { nasdaq: null, sp500: rows(base), '10-year-t-note': rows(base.map(r => -r)), 'us-dollar': rows(walk(300, 5)), gold: rows(base.map(r => r * 0.5)), 'crude-oil': rows(walk(300, 9)) };
  const nq = rows(base.map(r => r * 1.2)); series['nasdaq-100'] = nq;
  const p = I.profile({ slug: 'nasdaq-100', group: 'Indices' }, series, CALC.correlation);
  assert.deepEqual(p.drivers.map(d => d.slug), ['10-year-t-note', 'us-dollar', 'gold', 'crude-oil']);   // sp500 écarté : même famille que l'indice
  assert.ok(p.drivers[0].r60 < -0.99 && p.drivers[2].r60 > 0.99); assert.equal(p.family, 'actions');
  assert.ok(Math.abs(p.drivers[3].r60) < 0.4);
  const d = p.drivers[0], n = series['10-year-t-note'].length; assert.equal(d.chg5, Math.round((series['10-year-t-note'][n - 1][1] / series['10-year-t-note'][n - 6][1] - 1) * 1e5) / 1e3);
  assert.equal(I.profile({ slug: 'x', group: 'Indices' }, { x: rows(walk(40, 2)) }, CALC.correlation), null, 'moins de 60 séances : pas de profil');
  assert.deepEqual(I.profile({ slug: 'euro-fx', group: 'Currencies' }, { ...series, 'euro-fx': rows(walk(300, 4)) }, CALC.correlation).drivers.map(d => d.slug), ['sp500', '10-year-t-note', 'gold', 'crude-oil']);   // dollar écarté pour une devise
});

const market = { slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini', group: 'Indices' };
const bias = k => ({ week: { key: k, label: k }, day: { key: 'flat', label: 'neutre' } });
const row = { group: 'Indices', name: market.name };
const driver = (slug, name, family, r60, rMax, chg5) => ({ slug, name, family, r60, r250: r60, rMax, chg5, flip: I.isShift(r60, rMax) });

test('récit : liens nets expliqués, changement de régime signalé, mouvement récent du moteur rapproché du biais', () => {
  const inter = { family: 'actions', drivers: [driver('10-year-t-note', 'T-Note 10 ans', 'obligations', 0.42, -0.26, -0.8), driver('crude-oil', 'Pétrole (WTI)', 'petrole', -0.57, 0.15, 3.2), driver('us-dollar', 'Dollar américain', 'dollar', -0.1, -0.2, 0.5)] };
  const t = interStory(row, market, inter, bias('down'));
  assert.match(t, /T-Note 10 ans : Nasdaq 100 E-Mini évolue dans le même sens \(corrélation 0,42 sur 60 séances, −0,26 sur l'historique, modérée\) — le lien s'est inversé par rapport à l'historique\. Actions et obligations bougent ensemble/);
  assert.match(t, /Sur 5 séances, T-Note 10 ans recule de 0,80 %, ce qui a plutôt pesé sur l'indice, dans le sens du biais de la semaine\./);
  assert.match(t, /Pétrole \(WTI\) : Nasdaq 100 E-Mini évolue en sens inverse \(corrélation −0,57[^)]*modérée\)[^.]*inversé[^.]*\. Le pétrole pèse sur les actions/);
  assert.match(t, /Sur 5 séances, Pétrole \(WTI\) progresse de 3,20 %, ce qui a plutôt pesé sur l'indice, dans le sens du biais de la semaine\./);
  assert.match(t, /Peu de lien récent avec Dollar américain\./); assert.match(t, /Au moins un lien a changé de régime/); assert.match(t, /pas une relation de cause à effet/);
  assert.doesNotMatch(interStory(row, market, inter, bias('up')), /dans le sens du biais de la semaine/, 'biais haussier : le vent contraire est à l\'inverse');
  assert.match(interStory(row, market, inter, bias('up')), /à l'inverse du biais de la semaine \(à surveiller\)/);
});

test('récit : aucun lien net → message dédié sans « changement de régime » ; données absentes → paragraphe omis', () => {
  const calme = { family: 'actions', drivers: [driver('gold', 'Or', 'or', 0.05, 0.1, 0.0), driver('us-dollar', 'Dollar américain', 'dollar', -0.1, -0.2, 1)] };
  const t = interStory(row, market, calme, bias('flat'));
  assert.match(t, /Aucune corrélation nette \(au-delà de 0,3 en valeur absolue\) avec Or, Dollar américain/); assert.doesNotMatch(t, /changé de régime|Sur 5 séances/);
  for (const v of [null, undefined, { drivers: [] }, { drivers: [driver('gold', 'Or', 'or', null, null, 1)] }]) assert.equal(interStory(row, market, v, bias('up')), null);
});

test('indices uniquement : ni paragraphe ni section pour un métal, une obligation ou une matière première', () => {
  const inter = { family: 'actions', drivers: [driver('us-dollar', 'Dollar américain', 'dollar', -0.5, -0.4, 0.5)] };
  const mk = (slug, group) => ({ market: { slug, name: slug, group }, row: { slug, name: slug, fresh: 'ok', roll: false, price: 1, chgPct: 0.1, priceDate: 1, group, wr: -50, idx6: 50, idx36: 50, score: 0, sig: { cot: 0, season: 0, wr: 0, oi: 0 }, season: null, oi: null }, now: Date.parse('2026-09-28T08:00:00Z'), inter });
  const idx = debrief(mk('nasdaq-100', 'Indices'));
  assert.ok(idx.story.some(p => p.title === 'Intermarchés')); assert.match(idx.sections.find(s => s.title === 'Intermarchés').lines.join('\n'), /Corrélation 60 séances avec Dollar américain : −0,50 \(historique : −0,40\)/);
  for (const [s, g] of [['gold', 'Metals'], ['10-year-t-note', 'Bonds'], ['wheat', 'Grains'], ['bitcoin', 'Crypto'], ['euro-fx', 'Currencies']]) {
    const d = debrief(mk(s, g)); assert.ok(!d.story.some(p => p.title === 'Intermarchés'), s); assert.ok(!d.sections.some(x => x.title === 'Intermarchés'), s);
  }
});

test('débrief d\'un indice sans données intermarchés : rien d\'ajouté, aucune exception', () => {
  const d = debrief({ market, row: { ...row, slug: 'nasdaq-100', fresh: 'ok', roll: false, price: 1, chgPct: 0.1, priceDate: 1, wr: -50, idx6: 50, idx36: 50, score: 0, sig: { cot: 0, season: 0, wr: 0, oi: 0 }, season: null, oi: null }, now: Date.parse('2026-09-28T08:00:00Z') });
  assert.ok(!d.story.some(p => p.title === 'Intermarchés'));
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
