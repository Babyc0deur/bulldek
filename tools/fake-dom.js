// Faux DOM minimal pour exécuter le code d'affichage des pages (cot.js, seasonal.js, wr.js…) dans Node, sans navigateur.
// Enregistre ce que la page dessine (séries des graphiques, barres, tableaux HTML) pour pouvoir le comparer à une référence.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

// Éléments factices : toute propriété peut être lue ou écrite ; les méthodes DOM courantes ne font rien.
function makeDom() {
  const els = {};
  const el = sel => els[sel] ||= new Proxy({ __sel: sel, children: [], dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, style: { setProperty() {} } }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'querySelector') return () => el(sel + '>');
      if (k === 'querySelectorAll') return () => [];
      if (k === 'setAttribute' || k === 'insertAdjacentHTML' || k === 'appendChild' || k === 'remove') return () => {};
      if (k === 'closest') return () => null;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  const root = { querySelector: el, querySelectorAll: () => [], set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; } };
  return { els, el, root };
}

// Exécute `fnName` défini dans le fichier `src` avec une date figée et un BD dont les graphiques sont enregistrés.
async function render({ src, fnName, args, now, overrides = {}, calc }) {
  class MockDate extends Date { constructor(...a) { a.length ? super(...a) : super(now); } static now() { return now; } }
  const BD = new Function(fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8') + '\nreturn BD;')();
  const { el, root } = makeDom(), rec = { charts: {}, bars: {}, info: '' };
  BD.setInfo = h => { rec.info += h; };
  BD.lineChart = (canvas, o) => { rec.charts[canvas.__sel] = { series: [] }; return { redraw(p) { const c = rec.charts[canvas.__sel]; if (p && p.series) c.series = p.series.map(s => ({ name: s.name, data: s.data, color: s.color, dots: !!s.dots, dash: s.dash })); if (p && p.xmin != null) { c.xmin = p.xmin; c.xmax = p.xmax; } } }; };
  BD.bars = (canvas, arr) => { rec.bars[canvas.__sel] = arr.map(b => ({ label: b.label, v: b.v })); };
  BD.pie = (canvas, slices) => { (rec.pies ||= []).push(slices.map(x => x.v)); }; BD.gauge = (canvas, pct) => { (rec.gauges ||= []).push(pct); };   // dessins réservés au navigateur
  Object.assign(BD, overrides);
  const code = fs.readFileSync(src, 'utf8');
  // setInterval neutralisé : les pages lancent des minuteries (compte à rebours) qui empêcheraient le processus de test de se terminer.
  const fn = new Function('BD', 'CALC', 'Date', 'addEventListener', 'setInterval', 'document', code + '\nreturn ' + fnName + ';')(BD, calc, MockDate, () => {}, () => 0, { hidden: false, getElementById: () => null, createElement: () => ({ firstChild: { __sel: 'fig' }, className: '', innerHTML: '' }) });
  await fn(args, root);
  return { rec, el, root, BD };
}

// « 1,234.5 % » → 1234.5 ; « – » → null ; « +12.0 (en cours) » → 12
const num = t => { const c = t.replace(/<[^>]*>/g, ' ').replace(/\(en cours\)/, '').replace(/hausse/, '').replace(/%/g, '').replace(/,/g, '').trim().split(/\s+/)[0]; return c === '–' || c === '' ? null : +c; };
// Lit un tableau HTML : { libellé de ligne: [valeurs] } (accepte l'ancien balisage <td> et le nouveau <th scope="row">).
function parseTable(html) {
  const out = {};
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    if (/<th[^>]*scope="col"/.test(m[1]) || (/<th/.test(m[1]) && !/scope="row"/.test(m[1]))) continue;           // ligne d'en-tête
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => c[1]);
    out[cells[0].replace(/<[^>]*>/g, '').trim()] = cells.slice(1).map(num);
  }
  return out;
}
module.exports = { render, parseTable, num, makeDom };
