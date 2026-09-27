// La page (seasonal.js, affichage seulement) doit dessiner exactement ce que dessinait l'ancienne page qui calculait tout elle-même.
// On exécute le vrai code de la page dans un faux DOM, avec le rapport du serveur, et on compare à la référence figée.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { render, parseTable } = require('../tools/fake-dom.js');
const CALC = require('../calc.js');

const ROOT = path.join(__dirname, '..'), fx = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
const rows = fx('nq-daily.json'), golden = fx('nq-seasonal-golden.json'), NOW = Date.parse(golden.now);
const M = { name: 'Nasdaq 100 E-Mini', code: '209742' };

async function run() {
  const report = JSON.parse(JSON.stringify(CALC.seasonalReport(rows, new Date(NOW))));           // aller-retour JSON, comme sur le réseau
  const urls = [];
  const { rec, el, root } = await render({ src: path.join(ROOT, 'seasonal.js'), fnName: 'renderSeasonal', args: M, now: NOW, calc: CALC,
    overrides: { json: async url => { urls.push(url); return { updated: 1, report }; } } });
  const snap = () => ({ monthly: parseTable(el('#tbl').innerHTML), weekly: parseTable(el('#wtbl').innerHTML), daily: parseTable(el('#dtbl').innerHTML) });
  const pts = snap(), bars = { pts: { month: rec.bars['#cMBars'].map(b => b.v), day: rec.bars['#cDay'].map(b => b.v) } };
  el('#unit').onclick({ target: { closest: () => ({ dataset: { u: 'pct' } }) } });                  // clic sur « % »
  const pct = snap(); bars.pct = { month: rec.bars['#cMBars'].map(b => b.v), day: rec.bars['#cDay'].map(b => b.v) };
  return { rec, el, root, pts, pct, bars, urls };
}
const close = (a, b, tol, msg) => assert.ok(a == null || b == null ? a === b : Math.abs(a - b) <= tol + 1e-9, `${msg} : ${a} ≠ ${b}`);
const TOL = { pts: 0.1, pct: 0.01 };                                                                // une unité d'affichage (1 décimale en points, 2 en %)

test('la page interroge /api/seasonal et non plus les prix bruts', async () => {
  const { urls } = await run();
  assert.deepEqual(urls, ['/api/seasonal?code=209742']);
});

test('graphiques : mêmes courbes que la référence (annuel 10/5/2 ans, année en cours, mois)', async () => {
  const { rec } = await run();
  const same = (got, ref, msg) => { assert.equal(got.data.length, ref.length, msg + ' : longueur'); ref.forEach(([x, v], i) => { assert.equal(got.data[i][0], x, `${msg}[${i}] : abscisse`); close(got.data[i][1], v, 1e-3, `${msg}[${i}]`); }); };
  const byName = id => Object.fromEntries(rec.charts[id].series.map(s => [s.name, s]));
  const Y = byName('#cYear'), Mo = byName('#cMonth');
  for (const n of ['10 ans', '5 ans', '2 ans']) { same(Y[n], golden.annual[n], 'annuel ' + n); same(Mo[n], golden.month[n], 'mois ' + n); }
  same(Y['2026'], golden.annual['2026'], 'année en cours');
  same(Mo['Sep 2026'], golden.month['Sep 2026'], 'septembre 2026');
});

for (const unit of ['pts', 'pct']) {
  test(`tableaux (${unit}) : mensuel, par semaine et journalier identiques à la référence`, async () => {
    const got = (await run())[unit], ref = golden[unit];
    for (const t of ['monthly', 'weekly', 'daily']) {
      assert.deepEqual(Object.keys(got[t]), Object.keys(ref[t]), `${t} : lignes`);
      for (const [label, vals] of Object.entries(ref[t])) {
        assert.equal(got[t][label].length, vals.length, `${t}/${label} : colonnes`);
        vals.forEach((v, i) => close(got[t][label][i], v, TOL[unit], `${t}/${label}[${i}]`));
      }
    }
  });
  test(`graphiques en barres (${unit}) identiques`, async () => {
    const { bars } = await run();
    golden.bars[unit].month.forEach((v, i) => close(bars[unit].month[i], v, 1e-3, `mois ${i}`));
    golden.bars[unit].day.forEach((v, i) => close(bars[unit].day[i], v, 1e-3, `jour ${i}`));
  });
}

test('indicateurs du mois : même texte que la référence', async () => {
  const { el } = await run();
  assert.equal(el('#kpis').innerHTML.replace(/<[^>]*>/g, '|').replace(/\|+/g, '|'), golden.kpis);
});

test('accessibilité du gabarit : graphiques décrits, boutons à état, en-têtes de lignes', async () => {
  const { root } = await run(), html = root.innerHTML;
  const canvases = html.match(/<canvas[^>]*>/g);
  assert.equal(canvases.length, 4);
  canvases.forEach(c => { assert.match(c, /role="img"/); assert.match(c, /aria-label="[^"]{40,}"/); assert.ok(c.includes(M.name), 'la description doit nommer le marché : ' + c.slice(0, 80)); });
  assert.match(html, /aria-pressed="true"/); assert.match(html, /role="group"/);
  assert.doesNotMatch(html, /\sstyle=/, 'aucun attribut style en ligne (CSP)');
});
