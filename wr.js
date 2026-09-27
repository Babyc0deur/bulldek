// Williams %R journalier (14 séances, avec le prix).
// Formule commune : calc.js (CALC.williamsR).
const WR_ZONES = { hi: 'surachat', lo: 'survente', mid: 'neutre' };
const wrZone = v => v > -20 ? 'hi' : v < -80 ? 'lo' : 'mid';

async function renderWR(m, root) {
  const B = BD, K = BD.tc(), $ = s => root.querySelector(s), N = 14;
  let d;
  try { d = await B.daily(m.code); if (!d || d.length < 60 || d[0].length < 4) throw 0; }
  catch { $('#msg').className = 'err'; $('#msg').textContent = 'Prix journaliers indisponibles pour le moment. Réessayez dans une minute.'; return; }

  // %R = (plus haut N séances − clôture) / (plus haut − plus bas N séances) × −100
  const wr = CALC.williamsR(d, N).map(([t, v]) => [t * 1e3, v]);
  const px = d.map(p => [p[0] * 1e3, p[1]]);
  const last = wr.at(-1)[1], prev = wr.at(-2)[1], zoneD = wrZone(last);
  const digits = d.at(-1)[1] < 10 ? 4 : d.at(-1)[1] < 1000 ? 2 : 1;
  const rangeBtns = (list, on) => list.map(([n, l]) => `<button class="btn ${n === on ? 'on' : ''}" data-d="${n}" aria-pressed="${n === on}">${l}</button>`).join('');

  root.innerHTML = `
   <div class="sechead"><h2 class="sec">Williams %R (14 jours) – ${m.name}</h2>
     <div class="ranges" id="wrr" role="group" aria-label="Période affichée">${rangeBtns([[63, '3m'], [126, '6m'], [252, '1a'], [504, '2a']], 126)}</div></div>
   <div class="kpis" id="wk"></div>
   <div class="card"><div class="leg"><b class="ttl">Prix (clôture)</b></div>
     <canvas id="cPx" role="img" aria-label="Prix de clôture du ${m.name} sur la période choisie."></canvas></div>
   <div class="card"><div class="leg"><div class="legkey"><span><i class="sw line blue"></i>Williams %R (14)</span>
     <span><i class="sw band red"></i>Surachat &gt; −20</span><span><i class="sw band green"></i>Survente &lt; −80</span></div></div>
     <canvas id="cWr" role="img" aria-label="Williams %R sur 14 séances du ${m.name}, entre −100 et 0. Au-dessus de −20 : surachat ; sous −80 : survente. Valeur actuelle : ${last.toFixed(1)}, zone ${WR_ZONES[zoneD]}."></canvas></div>

   <p class="note">Williams %R = (plus haut sur 14 périodes − clôture) ÷ (plus haut − plus bas sur 14 périodes) × −100. Au-dessus de −20 : surachat ; sous −80 : survente. Les futures continus ne sont pas ajustés des changements de contrat : un saut peut fausser l'indicateur pendant 14 périodes. Mise à jour automatique.</p>`;

  const tip = t => new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  const xt = (a, b) => Array.from({ length: 6 }, (_, i) => { const t = a + (b - a) * i / 5; return [t, new Date(t).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })]; });
  const band = { hbands: [{ y0: -20, y1: 0, color: B.alpha('redl', .16) }, { y0: -100, y1: -80, color: B.alpha('greenl', .16) }] };
  const cp = B.lineChart($('#cPx'), { series: [], xmin: 0, xmax: 1, tipHead: tip, tipFmt: v => v.toLocaleString('en-US', { maximumFractionDigits: digits }), height: 240,
    yFmt: v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : +v.toFixed(digits) });
  const cw = B.lineChart($('#cWr'), { series: [], xmin: 0, xmax: 1, ymin: -100, ymax: 0, tipHead: tip, tipFmt: v => v.toFixed(1), height: 220, yFmt: v => v, ...band });
  let days = 126;
  function paint() {
    const x1 = wr.at(-1)[0], x0 = wr[Math.max(0, wr.length - days)][0], t = xt(x0, x1);
    cp.redraw({ xmin: x0, xmax: x1, xTicks: t, series: [{ name: 'Prix', color: K.gold, width: 1.8, data: px }] });
    cw.redraw({ xmin: x0, xmax: x1, xTicks: t, series: [{ name: 'Williams %R', color: K.bluel, width: 1.8, data: wr }] });
    const win = wr.slice(-days), ob = win.filter(p => p[1] > -20).length, os = win.filter(p => p[1] < -80).length;
    $('#wk').innerHTML =
      `<div class="kpi"><span>Williams %R (14)</span><b>${last.toFixed(1)}</b></div>` +
      `<div class="kpi"><span>Zone</span><b class="${last > -20 ? 'neg' : last < -80 ? 'pos' : ''}">${WR_ZONES[zoneD][0].toUpperCase() + WR_ZONES[zoneD].slice(1)}</b></div>` +
      `<div class="kpi"><span>Variation / jour</span><b class="${last - prev >= 0 ? 'pos' : 'neg'}">${(last - prev > 0 ? '+' : '') + (last - prev).toFixed(1)}</b></div>` +
      `<div class="kpi"><span>Surachat / survente</span><b>${ob} / ${os} j.</b></div>`;
  }
  const pressed = (box, btn) => [...box.children].forEach(x => { x.classList.toggle('on', x === btn); x.setAttribute('aria-pressed', x === btn); });
  $('#wrr').onclick = e => { const b = e.target.closest('button'); if (!b) return; days = +b.dataset.d; pressed($('#wrr'), b); paint(); };
  paint();

}
