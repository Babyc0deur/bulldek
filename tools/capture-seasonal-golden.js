// Exécute l'ANCIEN code de seasonal.js (copie figée) dans Node avec un faux DOM et une date fixe,
// puis enregistre ses résultats numériques comme valeurs de référence pour le calcul côté serveur.
// Usage : node tools/capture-seasonal-golden.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const NOW = Date.UTC(2026, 8, 25, 16, 12, 0);                       // 25/09/2026 16:12 UTC

class MockDate extends Date { constructor(...a) { a.length ? super(...a) : super(NOW); } static now() { return NOW; } }

const shared = fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8');
const BD = new Function(shared + '\nreturn BD;')();                 // vraies fonctions de formatage (dec, nf, MONTHS…)
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/nq-daily.json'), 'utf8'));

// faux éléments : n'importe quelle propriété peut être lue ou écrite
const rec = { charts: {}, bars: {} };
const els = {};
function el(sel) {
  return els[sel] ||= new Proxy({ __sel: sel, children: [], dataset: {}, classList: { toggle() {}, add() {}, remove() {} } }, {
    get(t, k) { return k in t ? t[k] : k === 'querySelector' ? () => el(sel + '>') : k === 'insertAdjacentHTML' || k === 'appendChild' || k === 'closest' ? () => null : undefined; },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const root = { querySelector: el, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; } };
BD.daily = async () => fixture; BD.setInfo = () => {};
BD.lineChart = (canvas, o) => { rec.charts[canvas.__sel] = { series: [] }; return { redraw(p) { if (p && p.series) rec.charts[canvas.__sel].series = p.series.map(s => ({ name: s.name, data: s.data })); } }; };
BD.bars = (canvas, arr) => { rec.bars[canvas.__sel] = arr.map(b => ({ label: b.label, v: b.v })); };

const legacy = fs.readFileSync(path.join(ROOT, 'test/fixtures/seasonal.legacy.js.txt'), 'utf8');
const renderSeasonal = new Function('BD', 'Date', 'addEventListener', legacy + '\nreturn renderSeasonal;')(BD, MockDate, () => {});

// « 1,234.5 % » → 1234.5 ; « – » → null ; « +12.0 (en cours) » → 12
const num = t => { const c = t.replace(/<[^>]*>/g, ' ').replace(/\(en cours\)/, '').replace(/hausse/, '').replace(/%/g, '').replace(/,/g, '').trim().split(/\s+/)[0]; return c === '–' || c === '' ? null : +c; };
function parseTable(html) {
  const out = {};
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => c[1]);
    if (/<th/.test(m[1])) continue;
    out[cells[0].replace(/<[^>]*>/g, '').trim()] = cells.slice(1).map(num);
  }
  return out;
}
const round = v => v == null ? null : +v.toFixed(6);
const snap = () => ({ monthly: parseTable(el('#tbl').innerHTML), weekly: parseTable(el('#wtbl').innerHTML), daily: parseTable(el('#dtbl').innerHTML) });

(async () => {
  await renderSeasonal({ name: 'Nasdaq 100 E-Mini', code: '209742' }, root);
  const pts = snap();
  const barsPts = { month: rec.bars['#cMBars'].map(b => b.v), day: rec.bars['#cDay'].map(b => b.v) };
  el('#unit').onclick({ target: { closest: () => ({ dataset: { u: 'pct' } }) } });                 // bascule Points → %
  const pct = snap();
  const barsPct = { month: rec.bars['#cMBars'].map(b => b.v), day: rec.bars['#cDay'].map(b => b.v) };
  const series = id => Object.fromEntries((rec.charts[id].series || []).map(s => [s.name, s.data.map(([x, y]) => [x, round(y)])]));
  const golden = {
    now: new Date(NOW).toISOString(), market: 'nasdaq-100',
    annual: series('#cYear'), month: series('#cMonth'),
    kpis: el('#kpis').innerHTML.replace(/<[^>]*>/g, '|').replace(/\|+/g, '|'),
    pts, pct,
    bars: { pts: barsPts, pct: barsPct },
  };
  const rnd = o => Array.isArray(o) ? o.map(rnd) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, rnd(v)])) : typeof o === 'number' ? round(o) : o;
  const outPath = path.join(ROOT, 'test/fixtures/nq-seasonal-golden.json');
  fs.writeFileSync(outPath, JSON.stringify(rnd(golden)));
  console.log('séries annuelles :', Object.keys(golden.annual).join(', '), '| points :', Object.values(golden.annual).map(a => a.length).join('/'));
  console.log('séries du mois   :', Object.keys(golden.month).join(', '));
  console.log('tableau mensuel  :', Object.keys(pts.monthly).join(', '));
  console.log('tableau semaine  :', Object.keys(pts.weekly).join(', '), '| colonnes :', Object.values(pts.weekly)[0].length);
  console.log('tableau jour     :', Object.keys(pts.daily).slice(0, 3).join(', '), '… ', Object.keys(pts.daily).length, 'lignes');
  console.log('KPIs             :', golden.kpis);
  console.log('exemple 10 ans / sept. :', pts.monthly['10 ans'][8], '(attendu −128.8) | %:', pct.monthly['10 ans'][8]);
  console.log('écrit :', outPath, Math.round(fs.statSync(outPath).size / 1024) + ' Ko');
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
