// Récit du debrief (narrative.js) et mode week-end : les indicateurs sont reliés entre eux et confrontés à la macro et aux annonces.
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../macro.js'), { debrief } = require('../debrief.js');

const SAT = Date.parse('2026-09-26T10:00:00Z'), FRI_LATE = Date.parse('2026-09-25T23:00:00Z'), SUN_LATE = Date.parse('2026-09-27T22:30:00Z'), MON = Date.parse('2026-09-28T08:00:00Z');
const market = { slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini' };
const macro = { cpi: { yoy: { USA: [['2026-05', 3.0], ['2026-06', 3.1], ['2026-07', 3.2], ['2026-08', 3.4]] } }, rates: { immediate: { USA: [['2026-02', 3.6], ['2026-03', 3.6], ['2026-04', 3.6], ['2026-05', 3.6], ['2026-06', 3.6], ['2026-07', 3.6], ['2026-08', 3.64]] } } };
const story = d => d.story.map(p => p.title + '\n' + p.text).join('\n');
const bearRow = (o = {}) => ({ slug: 'nasdaq-100', name: 'Nasdaq 100 E-Mini', fresh: 'ok', roll: false, price: 24500, chgPct: 0.1, priceDate: Date.parse('2026-09-25T00:00:00Z') / 1e3, group: 'Indices',
  wr: -12.7, idx6: 1, idx36: 0, score: -3, sig: { cot: -1, season: -1, wr: -1, oi: 0 }, season: { n: 10, avgPct: -1.39, up: 4 },
  oi: { last: 1, chgPct: -12.1, priceChgPct: 7.2, key: 'covering', label: 'Hausse fragile' }, ...o });

test('récit : six parties rédigées (pas une liste d\'indicateurs), sans NaN', () => {
  const d = debrief({ market, row: bearRow(), macro, events: [], now: MON }), t = story(d);
  assert.deepEqual(d.story.map(p => p.title), ['Le point du jour', 'Ce que disent les indicateurs entre eux', 'Prix, open interest et momentum', 'Le contexte macro', 'Rendements, volatilité et corrélations', 'Les annonces à venir', 'Ce qui ferait changer la lecture']);
  assert.ok(d.story.every(p => p.text.length > 60)); assert.doesNotMatch(t, /NaN|undefined|\[object/);
});

test('récit : convergences et contradictions entre indicateurs expliquées', () => {
  const conv = debrief({ market, row: bearRow(), now: MON }).story[1].text;
  assert.match(conv, /Le positionnement des commerciaux \(COT\), la saisonnalité et le Williams %R convergent vers la baisse, tandis que l'open interest reste neutre : la convergence est forte/);
  assert.match(conv, /à 1 % de leur amplitude sur 6 mois/); assert.match(conv, /zone de vente/);
  const mixte = debrief({ market, row: bearRow({ sig: { cot: 1, season: 0, wr: -1, oi: 0 }, score: 0 }), now: MON }).story[1].text;
  assert.match(mixte, /se contredisent/); assert.match(mixte, /arbitrage, pas d'un consensus/);
  assert.match(debrief({ market, row: bearRow({ sig: { cot: 0, season: 0, wr: 0, oi: 0 }, score: 0 }), now: MON }).story[1].text, /Aucun des quatre indicateurs/);
});

test('récit : prix ↔ open interest (hausse fragile = rachats) et Williams %R en surachat après une forte hausse', () => {
  const t = debrief({ market, row: bearRow(), now: MON }).story[2].text;
  assert.match(t, /le prix fait \+7,20 % pendant que l'open interest fait −12,10 %/); assert.match(t, /rachètent pour se couvrir/); assert.match(t, /fragile/);
  assert.match(t, /surachat après un mouvement haussier déjà avancé/);
});

test('récit : macro reliée au type de marché et confrontée au biais (accord ou contradiction)', () => {
  const restrictif = debrief({ market, row: bearRow(), macro, now: MON }).story[3].text;
  assert.match(restrictif, /Aux États-Unis : l'inflation et\/ou les taux montent/); assert.match(restrictif, /pèsent en général sur les valorisations/);
  assert.match(restrictif, /même sens que le biais de la semaine \(baissier\)/);
  const gold = debrief({ market: { slug: 'gold', name: 'Gold' }, row: bearRow({ group: 'Metals', sig: { cot: 1, season: 1, wr: 0, oi: 0 }, score: 2 }), macro, now: MON }).story[3].text;
  assert.match(gold, /coût de détention/); assert.match(gold, /à l'inverse du biais de la semaine \(haussier\)/);
  const eurMacro = { cpi: { yoy: { ...macro.cpi.yoy, EA20: [['2026-05', 2.5], ['2026-06', 2.4], ['2026-07', 2.2], ['2026-08', 2.0]] } }, rates: { immediate: { ...macro.rates.immediate, EA20: [['2026-02', 2.5], ['2026-03', 2.5], ['2026-04', 2.4], ['2026-05', 2.3], ['2026-06', 2.2], ['2026-07', 2.1], ['2026-08', 2.0]] } } };
  const eur = debrief({ market: { slug: 'euro-fx', name: 'Euro FX' }, row: bearRow({ group: 'Currencies' }), macro: eurMacro, now: MON }).story[3].text;
  assert.match(eur, /Côté monnaie, euro : l'inflation et\/ou les taux refluent/); assert.match(eur, /avantage du dollar/);
  assert.match(debrief({ market, row: bearRow(), now: MON }).story[3].text, /omise plutôt qu'inventée/);
});

test('récit : annonce décrite avec heure de Paris, prévision, précédent et transmission au marché', () => {
  const ev = [{ t: Date.parse('2026-09-28T12:30:00Z'), ccy: 'USD', title: 'Core PCE Price Index m/m', impact: 'High', forecast: '0.2%', previous: '0.3%' }];
  const t = debrief({ market, row: bearRow(), events: ev, now: MON }).story.find(p => p.title === 'Les annonces à venir').text;
  assert.match(t, /1 annonce d'importance forte/); assert.match(t, /Lundi 28 septembre à 14:30 \(heure de Paris\) : Core PCE Price Index m\/m \(USD\) \(prévision 0\.2%, précédent 0\.3%\)/);
  assert.match(t, /plus élevé que prévu est lu comme restrictif/); assert.match(t, /résultat restrictif serait plutôt défavorable/); assert.match(t, /laisser le marché digérer/);
  assert.match(debrief({ market, row: bearRow(), events: [{ ...ev[0], title: 'Unemployment Claims' }], now: MON }).story.find(p => p.title === 'Les annonces à venir').text, /la lecture est inversée/);
  assert.match(debrief({ market: { slug: 'corn', name: 'Corn' }, row: bearRow({ group: 'Grains' }), events: ev, now: MON }).story.find(p => p.title === 'Les annonces à venir').text, /transmission est peu directe/);
});

test('récit : conditions d\'invalidation chiffrées selon le biais', () => {
  assert.match(debrief({ market, row: bearRow(), now: MON }).story.find(p => p.title === 'Ce qui ferait changer la lecture').text, /baissier serait remis en cause si le COT Index 6 mois remontait au-dessus de 20 % \(actuellement 1 %\)/);
  const up = bearRow({ idx6: 85, score: 3, sig: { cot: 1, season: 1, wr: 0, oi: 1 } });
  assert.match(debrief({ market, row: up, now: MON }).story.find(p => p.title === 'Ce qui ferait changer la lecture').text, /haussier serait remis en cause si le COT Index 6 mois repassait sous 80 % \(actuellement 85 %\)/);
});

test('week-end : fenêtre du vendredi 22 h UTC au dimanche 22 h UTC, agenda tourné vers la semaine suivante', () => {
  const h = M.horizon;
  assert.equal(h(SAT).weekend, true); assert.equal(h(FRI_LATE).weekend, true); assert.equal(h(Date.parse('2026-09-27T12:00:00Z')).weekend, true);
  assert.equal(h(SUN_LATE).weekend, false); assert.equal(h(MON).weekend, false); assert.equal(h(Date.parse('2026-09-25T15:00:00Z')).weekend, false);
  assert.equal(h(SAT).back, 0); assert.ok(Math.abs(h(SAT).hours - 158) < 0.01);
  assert.ok(Math.abs(h(Date.parse('2026-09-27T20:00:00Z')).hours - 124) < 0.01);
});

