// Open interest : la section (oi.js) et le panneau de l'historique COT (cot.js), exécutés dans un faux DOM.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { render } = require('../tools/fake-dom.js');
const CALC = require('../calc.js');

const ROOT = path.join(__dirname, '..'), NOW = Date.parse('2026-09-25T20:00:00Z');
const nq = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'nq-daily.json'), 'utf8'));
const M = { name: 'Nasdaq 100 E-Mini', code: '209742', slug: 'nasdaq-100', tff: false, disagg: false };

// 400 rapports hebdomadaires se terminant le 15/09/2026, open interest connu à chaque ligne
const END = Date.UTC(2026, 8, 15), OI = i => 250000 + ((i * 37) % 60) * 1000 + i * 100;
const hist = Array.from({ length: 400 }, (_, i) => [new Date(END - (399 - i) * 7 * 864e5).toISOString().slice(0, 10), 100000 + i, 200000, 50000, 60000, 10000, 20000, OI(i)]);
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const runOI = (over = {}) => render({ src: path.join(ROOT, 'oi.js'), fnName: 'renderOI', args: M, now: NOW, calc: CALC,
  overrides: { cot: async () => ({ hist }), daily: async () => nq, ...over } });

test('indicateurs : valeur, variations, écart à la moyenne, position sur 36 mois — identiques à CALC.oiWeek', async () => {
  const { el } = await runOI(), t = text(el('#oiK').innerHTML), W = CALC.oiWeek(hist, nq);
  const nf = n => Math.round(n).toLocaleString('en-US');
  assert.ok(t.includes(nf(W.last)), 'open interest'); assert.ok(t.includes('positions du 15/09/2026'));
  assert.ok(t.includes((W.chg > 0 ? '+' : '') + nf(W.chg)), 'variation en contrats');
  assert.ok(t.includes((W.chg4Pct > 0 ? '+' : '') + W.chg4Pct.toFixed(2) + ' %'), 'variation sur 4 semaines');
  assert.ok(t.includes((W.vsAvgPct > 0 ? '+' : '') + W.vsAvgPct.toFixed(2) + ' %') && t.includes('moyenne : ' + nf(W.avg52)));
  assert.ok(t.includes(W.idx36.toFixed(0) + ' %'), 'position sur 36 mois');
});

test('lecture prix × open interest : libellé, texte et pastille de couleur', async () => {
  const { el } = await runOI(), W = CALC.oiWeek(hist, nq), html = el('#oiRead').innerHTML;
  assert.ok(text(html).includes(W.reading.label)); assert.ok(text(html).includes(W.reading.text));
  const attendue = { 'trend-up': 'buy', 'trend-down': 'sell' }[W.reading.key] || 'wait';
  assert.ok(html.includes('sig sm ' + attendue), 'pastille ' + attendue);
  assert.match(text(html), /pas un conseil en investissement/);
  assert.ok(text(html).includes('semaine du 08/09/2026 au 15/09/2026'));
});

test('graphique comparé : open interest (avec points) en base 100 et prix ; plus de doublon de la courbe seule', async () => {
  const { rec, root } = await runOI(), [a, b] = rec.charts['#cOiPx'].series;
  assert.equal(a.name, 'Open interest'); assert.equal(a.dots, true); assert.equal(b.name, 'Prix');
  assert.equal(rec.charts['#cOiMain'], undefined); assert.ok(!root.innerHTML.includes('cOiMain'));
});

test('comparaison base 100 : open interest et prix partent tous deux de 100 au début de la période', async () => {
  const { rec, el } = await runOI(), cmp = () => rec.charts['#cOiPx'];
  const [o, p] = cmp().series; assert.equal(o.name, 'Open interest'); assert.equal(p.name, 'Prix');
  assert.ok(Math.abs(o.data[0][1] - 100) < 1e-9 && Math.abs(p.data[0][1] - 100) < 1e-9);
  assert.ok((cmp().xmax - cmp().xmin) / 864e5 > 360 && (cmp().xmax - cmp().xmin) / 864e5 < 370, '1 an par défaut');
  el('#oiRng').onclick({ target: { closest: () => ({ dataset: { m: '6' } }) } });
  const span = (cmp().xmax - cmp().xmin) / 864e5; assert.ok(span > 178 && span < 186, '6 mois : ' + span);
  assert.ok(Math.abs(cmp().series[0].data[0][1] - 100) < 1e-9, 'la base 100 suit la fenêtre');
});

test('tableau des 4 dernières semaines : du plus récent au plus ancien, variations et prix du mardi', async () => {
  const { root } = await runOI(), rows = [...root.innerHTML.matchAll(/<tr><th scope="row">(\d\d\/\d\d\/\d{4})<\/th>([\s\S]*?)<\/tr>/g)];
  assert.equal(rows.length, 4);
  assert.equal(rows[0][1], '15/09/2026'); assert.equal(rows[3][1], '25/08/2026');
  const t0 = text(rows[0][2]), i = hist.length - 1;
  assert.ok(t0.includes(OI(i).toLocaleString('en-US')));
  const d = OI(i) - OI(i - 1); assert.ok(t0.includes((d > 0 ? '+' : '') + d.toLocaleString('en-US')));
  const px = CALC.closeOnOrBefore(nq, '2026-09-15'); assert.ok(t0.includes(px.toLocaleString('en-US', { maximumFractionDigits: 2 })), 'prix du mardi du rapport');
});

test('sans prix : la section reste utilisable (pas de lecture inventée, pas d\'exception)', async () => {
  const { el, rec } = await runOI({ daily: async () => [] });
  assert.match(text(el('#oiRead').innerHTML), /Indisponible/);
  assert.equal(rec.charts['#cOiPx'].series[0].data.length > 0, true);
});

test('historique COT trop court ou absent : message clair', async () => {
  const { el } = await runOI({ cot: async () => ({ hist: hist.slice(0, 5) }) });
  assert.match(el('#msg').textContent, /Open interest indisponible/);
  const e2 = await runOI({ cot: async () => { throw new Error('hors ligne'); } });
  assert.match(e2.el('#msg').textContent, /indisponible/);
});

test('gabarit : graphiques décrits (avec la valeur), boutons à état, aucun style en ligne', async () => {
  const { root } = await runOI(), html = root.innerHTML, cv = html.match(/<canvas[^>]*>/g);
  assert.equal(cv.length, 1); cv.forEach(c => { assert.match(c, /role="img"/); assert.match(c, /aria-label="[^"]{40,}"/); });
  assert.match(html, /aria-pressed="true"/); assert.match(html, /role="group"/); assert.doesNotMatch(html, /\sstyle=/);
  assert.match(html, /inférieure à 0,5 % \(prix\) ou 0,5 % \(open interest\)/, 'la note cite les seuils réels');
});

// ---------- panneau « Open interest » dans l'historique du rapport COT (cot.js) ----------
const latest = { report_date_as_yyyy_mm_dd: '2026-09-15T00:00:00.000', contract_units: 'x' };
const runCot = () => render({ src: path.join(ROOT, 'cot.js'), fnName: 'renderCot', args: M, now: NOW, calc: CALC, overrides: { cot: async () => ({ latest, hist }) } });

test('historique COT : un panneau Open interest (courbe à points) entre les positions nettes et le COT Index', async () => {
  const { rec, root } = await runCot(), s = rec.charts['#cOi'].series[0];
  assert.equal(s.name, 'Open interest'); assert.equal(s.dots, true); assert.equal(s.data.length, hist.length);
  s.data.forEach(([x, v], i) => { if (i % 50 === 0 || i === hist.length - 1) { assert.equal(x, Date.parse(hist[i][0])); assert.equal(v, OI(i)); } });
  const html = root.innerHTML, order = ['id="cNet"', 'id="cOi"', 'id="cIdx"'].map(k => html.indexOf(k));
  assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], 'ordre : positions nettes, open interest, COT Index : ' + order);
  assert.match(html, /<canvas id="cOi" role="img" aria-label="Open interest hebdomadaire du Nasdaq/);
});

test('historique COT : le panneau suit les boutons de période avec les autres graphiques', async () => {
  const { rec, el } = await runCot(), oi = () => rec.charts['#cOi'], net = () => rec.charts['#cNet'];
  assert.equal(oi().xmin, net().xmin); assert.equal(oi().xmax, net().xmax);
  el('#ranges').onclick({ target: { closest: () => ({ dataset: { m: '6' } }) } });
  assert.equal(oi().xmin, net().xmin); assert.equal(oi().xmin, rec.charts['#cIdx'].xmin);
  assert.ok((oi().xmax - oi().xmin) / 864e5 < 190, 'fenêtre de 6 mois');
});

test('période par défaut : 1 an, bouton « 1a » seul actif', async () => {
  const { root, rec } = await runOI();
  const boutons = [...root.innerHTML.match(/<div class="ranges" id="oiRng"[\s\S]*?<\/div>/)[0].matchAll(/<button class="btn ?(on)?" data-m="(\d+)" aria-pressed="(true|false)">(\w+)</g)];
  assert.deepEqual(boutons.map(b => [b[4], !!b[1], b[3]]), [['6m', false, 'false'], ['1a', true, 'true'], ['2a', false, 'false'], ['3a', false, 'false'], ['5a', false, 'false'], ['10a', false, 'false']]);
  const j = c => (c.xmax - c.xmin) / 864e5; assert.ok(j(rec.charts['#cOiPx']) > 360 && j(rec.charts['#cOiPx']) < 370);
});
