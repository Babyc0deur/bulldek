// Open interest (rapport COT Legacy, futures uniquement) : niveau, variations, courbe, lecture croisée avec le prix et dernières semaines.
// Calculs dans calc.js (CALC.oiWeek) ; ce fichier ne fait que dessiner.
async function renderOI(m, root) {
  const B = BD, K = BD.tc(), $ = s => root.querySelector(s);
  let cot, daily = [];
  try {
    [cot, daily] = await Promise.all([B.cot(m.code), B.daily(m.code).catch(() => [])]);
    if (!cot.hist || cot.hist.length < 10) throw 0;
  } catch { $('#msg').className = 'err'; $('#msg').textContent = 'Open interest indisponible pour ce marché pour le moment.'; return; }

  const H = cot.hist, W = CALC.oiWeek(H, daily), nf = B.nf;
  const pct = v => v == null ? '–' : (v > 0 ? '+' : '') + v.toFixed(2) + ' %', cls = v => v == null ? '' : v >= 0 ? 'pos' : 'neg';
  const fd = s => new Date(s.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  const RANGES = [[6, '6m'], [12, '1a'], [24, '2a'], [36, '3a'], [60, '5a'], [120, '10a']];
  const btns = RANGES.map(([n, l]) => `<button class="btn ${n === 12 ? 'on' : ''}" data-m="${n}" aria-pressed="${n === 12}">${l}</button>`).join('');
  const READ_CLS = { 'trend-up': 'buy', 'trend-down': 'sell' }, rd = W.reading;

  // moyenne mobile sur 52 semaines
  const oi = H.map(r => r[7]), t = H.map(r => Date.parse(r[0].slice(0, 10)));
  const ma = oi.map((_, i) => { const w = oi.slice(Math.max(0, i - 51), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; });

  // dernières semaines : open interest, variation, prix du mardi et sa variation
  const rows = H.slice(-4).map((r, k, a) => {
    const i = H.length - a.length + k, prevDate = H[i - 1] && H[i - 1][0].slice(0, 10), dOi = i ? oi[i] - oi[i - 1] : null, pOi = i ? (oi[i] / oi[i - 1] - 1) * 100 : null;
    const px = CALC.closeOnOrBefore(daily, r[0].slice(0, 10)), pxPrev = prevDate ? CALC.closeOnOrBefore(daily, prevDate) : null;
    return { date: r[0], oi: oi[i], dOi, pOi, px, pPx: px && pxPrev ? (px / pxPrev - 1) * 100 : null };
  }).reverse();
  const tbl = `<table class="cmp"><thead><tr><th scope="col">Rapport du</th><th scope="col">Open interest</th><th scope="col">Variation</th><th scope="col">Prix (clôture)</th><th scope="col">Variation du prix</th></tr></thead><tbody>`
    + rows.map(r => `<tr><th scope="row">${fd(r.date)}</th><td>${nf(r.oi)}</td><td class="${cls(r.dOi)}">${r.dOi == null ? '–' : B.sg(r.dOi) + ' <small>(' + pct(r.pOi) + ')</small>'}</td>`
      + `<td>${r.px == null ? '–' : r.px.toLocaleString('en-US', { maximumFractionDigits: r.px < 10 ? 4 : 2 })}</td><td class="${cls(r.pPx)}">${pct(r.pPx)}</td></tr>`).join('') + '</tbody></table>';

  root.innerHTML = `
   <div class="sechead"><h2 class="sec">Open Interest – ${m.name}</h2>
     <div class="ranges" id="oiRng" role="group" aria-label="Période affichée">${btns}</div></div>
   <div class="oi-k" id="oiK"></div>
   <div>
     <div class="card combo" id="oiRead"></div>
   </div>
   <div class="g2">
     <div class="card"><div class="leg"><div class="legkey"><span><i class="sw line purple"></i>Open interest</span><span><i class="sw line orange"></i>Prix</span></div><b class="ttl">Évolution comparée, base 100</b></div>
       <canvas id="cOiPx" role="img" aria-label="Évolution comparée de l'open interest et du prix du ${m.name}, en base 100 au début de la période choisie."></canvas></div>
     <div class="card"><h3>Les 4 dernières semaines</h3><div class="tw">${tbl}</div></div>
   </div>
   <p class="note">Open interest = nombre total de contrats à terme non dénoués, tous échéances confondues (rapport COT Legacy, futures uniquement), publié chaque semaine avec les positions du mardi. La lecture croisant prix et open interest sur la semaine est une convention d'analyse, pas une prévision : une variation inférieure à ${String(CALC.THRESHOLDS.priceFlatPct).replace('.', ',')} % (prix) ou ${String(CALC.THRESHOLDS.oiFlatPct).replace('.', ',')} % (open interest) n'est pas interprétée. Le prix est la clôture du mardi de chaque rapport (contrats continus). Information éducative, pas un conseil en investissement.</p>`;

  const k = (l, v, sub, c = '') => `<div class="kpi"><span>${l}</span><b class="${c}">${v}</b><small>${sub}</small></div>`;
  $('#oiK').innerHTML =
    k('Open interest', nf(W.last), 'positions du ' + fd(W.date)) +
    k('Variation sur 1 semaine', B.sg(W.chg), pct(W.chgPct), cls(W.chg)) +
    k('Variation sur 4 semaines', pct(W.chg4Pct), 'vs il y a 4 semaines', cls(W.chg4Pct)) +
    k('Écart à la moyenne 52 sem.', pct(W.vsAvgPct), 'moyenne : ' + nf(W.avg52), cls(W.vsAvgPct)) +
    k('Position sur 36 mois', W.idx36.toFixed(0) + ' %', '0 % = plus bas, 100 % = plus haut');
  $('#oiRead').innerHTML = B.sigPill(rd.label, READ_CLS[rd.key] || 'wait')
    + `<p><b>${rd.text}</b><br>Prix : ${pct(W.priceChgPct)} · Open interest : ${pct(W.chgPct)} (semaine du ${fd(W.prevDate)} au ${fd(W.date)}).<br>Contribution à la confluence : <b>${CALC.oiSignal(rd) > 0 ? '+1' : CALC.oiSignal(rd) < 0 ? '−1' : '0'}</b> (seules les lectures « confirmées » comptent ; neutralisée en cas de changement de contrat récent). Repère pédagogique, pas un conseil en investissement.</p>`;

  const tip = x => new Date(x).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  const xt = (a, b) => Array.from({ length: 6 }, (_, i) => { const x = a + (b - a) * i / 5; return [x, new Date(x).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })]; });
  const fr = v => Math.round(v).toLocaleString('fr-FR');
  const cCmp = B.lineChart($('#cOiPx'), { series: [], xmin: 0, xmax: 1, tipHead: tip, tipFmt: v => v.toFixed(1), yFmt: v => Math.round(v), height: 320 });
  const oiPts = t.map((x, i) => [x, oi[i]]);
  function paint(months) {
    const end = t[t.length - 1], d = new Date(end); d.setUTCMonth(d.getUTCMonth() - months);
    const x0 = d.getTime(), ticks = xt(x0, end);
    const win = oiPts.filter(p => p[0] >= x0), base = win.length ? win[0][1] : 1;
    cCmp.redraw({ xmin: x0, xmax: end, xTicks: ticks, series: [{ name: 'Open interest', color: K.purple, width: 1.8, data: win.map(p => [p[0], p[1] / base * 100]), dots: true },
      { name: 'Prix', color: K.accent, width: 1.8, data: CALC.rebase(daily, x0 / 1e3).map(([s, v]) => [s * 1e3, v]) }] });
  }
  $('#oiRng').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    [...$('#oiRng').children].forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    paint(+b.dataset.m);
  };
  paint(12);
}
