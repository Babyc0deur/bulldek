async function renderCot(m, root) {
  const B = BD, K = BD.tc(), $ = s => root.querySelector(s);
  let cot, tff = null, dis = null;
  try {
    [cot, tff, dis] = await Promise.all([B.cot(m.code), m.tff ? B.json('/api/tff?code=' + m.code).catch(() => null) : null,
      m.disagg ? B.json('/api/disagg?code=' + m.code).catch(() => null) : null]);
  } catch { $('#msg').className = 'err'; $('#msg').textContent = 'Impossible de récupérer les données CFTC pour ce marché.'; return; }

  const L = cot.latest, num = k => +L[k] || 0, pc = k => { const v = parseFloat(L[k]); return isNaN(v) ? '' : v + '%'; };
  const H = cot.hist, T = tff && tff.latest, DH = dis && dis.hist;
  const net = { c: num('comm_positions_long_all') - num('comm_positions_short_all'), l: num('noncomm_positions_long_all') - num('noncomm_positions_short_all'),
    t: num('tot_rept_positions_long_all') - num('tot_rept_positions_short'), s: num('nonrept_positions_long_all') - num('nonrept_positions_short_all') };
  const prev = { c: net.c - (num('change_in_comm_long_all') - num('change_in_comm_short_all')), l: net.l - (num('change_in_noncomm_long_all') - num('change_in_noncomm_short_all')),
    s: net.s - (num('change_in_nonrept_long_all') - num('change_in_nonrept_short_all')) };
  const pctChg = (n, p) => p === 0 ? '' : (n - p) / Math.abs(p) * 100;
  const badge = v => v > 0 ? `<span class="bdg up">+${B.nf(v)}</span>` : v < 0 ? `<span class="bdg dn">${B.nf(v)}</span>` : '';
  const pbadge = v => v === '' ? '' : `<span class="bdg ${v >= 0 ? 'up' : 'dn'} sub">${v > 0 ? '+' : ''}${Math.round(v)}%</span>`;

  // ---- séries historiques et COT Index ----
  const dt = s => Date.parse(s.slice(0, 10));
  const GR = [
    { k: 'c', name: 'Commerciaux', color: K.redl, v: r => r[1] - r[2], src: 'L' },
    { k: 'l', name: 'Grands spéculateurs', color: K.greenl, v: r => r[3] - r[4], src: 'L' },
    { k: 's', name: 'Petits traders', color: K.bluel, v: r => r[5] - r[6], src: 'L' },
  ];
  GR.forEach(g => { g.pts = H.map(r => [dt(r[0]), g.v(r)]); });
  const cotIndex = (pts, w) => { const idx = CALC.cotIndex(pts.map(p => p[1]), w); return pts.map((p, i) => [p[0], idx[i]]); };
  GR.forEach(g => { g.i6 = cotIndex(g.pts, CALC.THRESHOLDS.cotShortWeeks); g.i36 = cotIndex(g.pts, CALC.THRESHOLDS.cotLongWeeks); });
  const gC = GR[0], idx6 = gC.i6.at(-1)[1], idx36 = gC.i36.at(-1)[1];

  // ---- dates / texte d'introduction ----
  const rd = new Date(dt(L.report_date_as_yyyy_mm_dd)), fri = new Date(+rd + 3 * 864e5);
  const fd = d => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  B.setInfo(`<p>Le rapport <b>Commitments of Traders (COT)</b> pour le <b>${m.name}</b> a été publié le vendredi <b>${fd(fri)}</b>. Publié par la CFTC, il contient les positions des acteurs du marché au mardi <b>${fd(rd)}</b> (contrat : ${L.contract_units || m.name}).</p>
    <p>Avec le dernier rapport, les commerciaux ont une position nette de <b>${B.nf(net.c)}</b>, les grands spéculateurs de <b>${B.nf(net.l)}</b> et les petits traders de <b>${B.nf(net.s)}</b>.</p>
    <p>Le COT Index situe cette position par rapport à l'historique : d'après notre calcul sur les commerciaux, il est à <b>${idx6.toFixed(1)} %</b> sur 6 mois et à <b>${idx36.toFixed(1)} %</b> sur 36 mois. Le prochain rapport sortira vendredi prochain, avec les données du mardi précédent.</p>`);

  // ---- gabarit ----
  const chips = GR.map(g => `<button class="chip ${g.k === 'l' ? '' : 'on'}" data-k="${g.k}" data-c="${g.color}" aria-pressed="${g.k !== 'l'}"><i></i>${g.name}</button>`).join('');
  const opts = GR.map(g => `<option value="${g.k}">${g.name}</option>`).join('');
  root.innerHTML = `
   <div class="sechead"><h2 class="sec">Rapport COT – ${m.name}</h2><div class="ranges" id="ranges" role="group" aria-label="Période affichée"><button class="btn" data-m="6" aria-pressed="false">6m</button><button class="btn on" data-m="12" aria-pressed="true">1a</button><button class="btn" data-m="24" aria-pressed="false">2a</button><button class="btn" data-m="36" aria-pressed="false">3a</button></div></div>
   <div class="cd" id="cd" role="timer" aria-live="off"></div>
   <div class="g2"><div class="card"><div class="leg"><div class="chips" id="chips">${chips}</div><b class="ttl">Positions nettes</b></div><canvas id="cNet" role="img" aria-label="Positions nettes historiques (longs moins shorts) des groupes de traders du ${m.name}, sur la période choisie. Les valeurs figurent dans les tableaux plus bas."></canvas></div>
   <div class="card"><div class="leg"><b class="ttl">Open interest</b><div class="legkey"><span><i class="sw line purple"></i>Contrats ouverts (hebdomadaire)</span></div></div>
     <canvas id="cOi" role="img" aria-label="Open interest hebdomadaire du ${m.name}, en nombre de contrats, sur la période choisie."></canvas></div>
   <div class="card wide"><div class="leg"><div class="chips"><select class="btn" id="gsel">${opts}</select></div>
     <div class="legkey"><span><i class="sw line orange"></i>COT Index 6 mois</span><span><i class="sw line white"></i>COT Index 36 mois</span></div></div><canvas id="cIdx" role="img" aria-label="COT Index sur 6 et 36 mois du groupe choisi pour le ${m.name}, de 0 à 100 %. Moins de 20 % : zone de vente ; plus de 80 % : zone d'achat."></canvas></div>
   </div>
   

   <h2 class="sec">COT Legacy – ${m.name}</h2>
   <div class="tw"><table class="cot">
    <thead><tr><th>Legacy</th><th colspan="2" class="cr">COMMERCIAUX</th><th colspan="3" class="cg">GRANDS SPÉCULATEURS</th><th colspan="2" class="co">TOTAL</th><th colspan="2" class="cb">PETITS TRADERS</th></tr>
    <tr><th>${L.report_date_as_yyyy_mm_dd.slice(0, 10)}</th><th>Long</th><th>Short</th><th>Long</th><th>Short</th><th>Spread</th><th>Long</th><th>Short</th><th>Long</th><th>Short</th></tr></thead>
    <tbody>
     <tr><td class="l">Positions</td>${['comm_positions_long_all', 'comm_positions_short_all', 'noncomm_positions_long_all', 'noncomm_positions_short_all', 'noncomm_postions_spread_all', 'tot_rept_positions_long_all', 'tot_rept_positions_short', 'nonrept_positions_long_all', 'nonrept_positions_short_all'].map(k => `<td>${B.nf(num(k))}</td>`).join('')}</tr>
     <tr><td class="l">Variation</td>${['change_in_comm_long_all', 'change_in_comm_short_all', 'change_in_noncomm_long_all', 'change_in_noncomm_short_all', 'change_in_noncomm_spead_all', 'change_in_tot_rept_long_all', 'change_in_tot_rept_short', 'change_in_nonrept_long_all', 'change_in_nonrept_short_all'].map(k => `<td>${badge(num(k))}</td>`).join('')}</tr>
     <tr><td class="l">% de l'OI</td>${['pct_of_oi_comm_long_all', 'pct_of_oi_comm_short_all', 'pct_of_oi_noncomm_long_all', 'pct_of_oi_noncomm_short_all', 'pct_of_oi_noncomm_spread', 'pct_of_oi_tot_rept_long_all', 'pct_of_oi_tot_rept_short', 'pct_of_oi_nonrept_long_all', 'pct_of_oi_nonrept_short_all'].map(k => `<td>${pc(k)}</td>`).join('')}</tr>
     <tr><td class="l">Traders</td>${['traders_comm_long_all', 'traders_comm_short_all', 'traders_noncomm_long_all', 'traders_noncomm_short_all', 'traders_noncomm_spread_all', 'traders_tot_rept_long_all', 'traders_tot_rept_short_all'].map(k => `<td>${B.nf(num(k))}</td>`).join('')}<td></td><td></td></tr>
     <tr><td class="l">Positions nettes</td><td colspan="2">${B.nf(net.c)}${pbadge(pctChg(net.c, prev.c))}</td><td colspan="3">${B.nf(net.l)}${pbadge(pctChg(net.l, prev.l))}</td><td colspan="2">${B.nf(net.t)}</td><td colspan="2">${B.nf(net.s)}${pbadge(pctChg(net.s, prev.s))}</td></tr>
    </tbody></table></div>

   <h2 class="sec">Analyse Legacy</h2>
   <div class="g2">
   <div class="card insight"><div class="lbl">Long vs Short</div><div class="body" id="pLS"></div></div>
   <div class="card insight"><div class="lbl">Open interest en %</div><div class="body" id="pOI"></div></div>
   </div><div class="g2"><div class="card insight"><div class="lbl">Positions nettes</div><div class="body"><canvas id="cBars" class="mw520" role="img" aria-label="Positions nettes Legacy du ${m.name} : commerciaux ${B.nf(net.c)}, grands spéculateurs ${B.nf(net.l)}, petits traders ${B.nf(net.s)}."></canvas></div></div>
   <div class="card"><div class="gauges">
     <div class="figure"><canvas id="g6" role="img" aria-label="Jauge du COT Index 6 mois des commerciaux : ${idx6.toFixed(1)} %."></canvas>COT Index 6 mois (commerciaux)<div id="s6"></div></div>
     <div class="figure"><canvas id="g36" role="img" aria-label="Jauge du COT Index 36 mois des commerciaux : ${idx36.toFixed(1)} %."></canvas>COT Index 36 mois (commerciaux)<div id="s36"></div></div></div>
     <p class="note center">Lecture : index ≥ 80 % → <b class="pos">Achat</b> · index ≤ 20 % → <b class="neg">Vente</b> · entre les deux → <b>Patience</b>. Repère pédagogique sur les positions des commerciaux, pas un conseil en investissement.</p></div>
   </div>
   <div id="tffSec"></div>
   <div id="disSec"></div>
   <p class="note">Mise à jour automatique. Données du ${fd(rd)} (publication du ${fd(fri)}). Position nette = longs − shorts. COT Index = position nette rapportée à sa fourchette min–max sur la période.</p>`;

  B.applyColors(root);                                                                        // couleurs des pastilles (data-c) sans style en ligne

  // ---- Compte à rebours avant le prochain rapport (calendrier officiel CFTC, jours fériés inclus : calc.js) ----
  const lastReport = H[H.length - 1][0];
  const whenFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const tick = () => { const el = $('#cd'); if (el) el.innerHTML = B.countdownHtml(CALC.nextCotRelease(lastReport, Date.now()), Date.now(), whenFmt); };
  tick(); setInterval(() => { if (!document.hidden) tick(); }, 30000);

  // ---- graphiques historiques ----
  const active = new Set(['c', 's']); let months = 12, gsel = 'c';                            // Grands spéculateurs décoché par défaut
  const end = gC.pts.at(-1)[0];
  const xt = (a, b) => Array.from({ length: 6 }, (_, i) => { const t = a + (b - a) * i / 5; return [t, new Date(t).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })]; });
  const tip = t => new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  const netChart = B.lineChart($('#cNet'), { series: [], xmin: 0, xmax: 1, tipHead: tip, tipFmt: B.nf, height: 320 });
  const oiChart = B.lineChart($('#cOi'), { series: [], xmin: 0, xmax: 1, tipHead: tip, tipFmt: v => Math.round(v).toLocaleString('fr-FR') + ' contrats', height: 320,
    yFmt: v => Math.round(v).toLocaleString('fr-FR') });
  const oiPts = H.map(r => [dt(r[0]), r[7]]);                                              // open interest : dernière colonne de l'historique Legacy
  const idxChart = B.lineChart($('#cIdx'), { series: [], xmin: 0, xmax: 1, ymin: 0, ymax: 100, tipHead: tip, tipFmt: v => v.toFixed(1) + ' %', height: 240,
    hbands: [{ y0: 0, y1: 20, color: B.alpha('red', .35) }, { y0: 80, y1: 100, color: B.alpha('green', .35) }] });
  function paint() {
    const a = new Date(end); a.setMonth(a.getMonth() - months); const x0 = +a, ticks = xt(x0, end);
    netChart.redraw({ xmin: x0, xmax: end, xTicks: ticks, series: GR.filter(g => active.has(g.k)).map(g => ({ name: g.name, color: g.color, data: g.pts })) });
    const g = GR.find(z => z.k === gsel);
    oiChart.redraw({ xmin: x0, xmax: end, xTicks: ticks, series: [{ name: 'Open interest', color: K.purple, width: 1.8, data: oiPts, dots: true }] });
    idxChart.redraw({ xmin: x0, xmax: end, xTicks: ticks, series: [{ name: 'Index 6 mois', color: K.accent, data: g.i6, width: 2 }, { name: 'Index 36 mois', color: K.text, data: g.i36, width: 1.6 }] });
  }
  $('#chips').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; const k = b.dataset.k; active.has(k) ? active.delete(k) : active.add(k); b.classList.toggle('on'); b.setAttribute('aria-pressed', active.has(k)); paint(); };
  $('#ranges').onclick = e => { const b = e.target.closest('button'); if (!b) return; months = +b.dataset.m; [...$('#ranges').children].forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); paint(); };
  $('#gsel').onchange = e => { gsel = e.target.value; paint(); };
  paint();

  // ---- camemberts et barres Legacy ----
  const RED = K.red, GRN = K.green, BLU = K.blue, GRY = K.muted;
  const fig = (parent, label, slices, fmt) => { const d = document.createElement('div'); d.className = 'figure'; d.innerHTML = '<canvas role="img" aria-label="Répartition long / short : ' + label + '"></canvas>' + label; $(parent).appendChild(d); B.pie(d.firstChild, slices, 110, fmt); };
  [['Commerciaux', 'comm_positions_long_all', 'comm_positions_short_all', null], ['Grands spéculateurs', 'noncomm_positions_long_all', 'noncomm_positions_short_all', 'noncomm_postions_spread_all'],
   ['Petits traders', 'nonrept_positions_long_all', 'nonrept_positions_short_all', null]].forEach(([n, l, s, sp]) =>
    fig('#pLS', n, [{ v: num(l), color: GRN, name: 'Long' }, ...(sp ? [{ v: num(sp), color: GRY, name: 'Spread' }] : []), { v: num(s), color: RED, name: 'Short' }]));
  const pctFmt = s => `${s.name} : ${s.v.toFixed(1)} %`;
  const oi = side => [{ v: parseFloat(L['pct_of_oi_comm_' + side + '_all']), color: RED, name: 'Commerciaux' }, { v: parseFloat(L['pct_of_oi_noncomm_' + side + '_all']), color: GRN, name: 'Grands spéculateurs' },
    { v: parseFloat(L.pct_of_oi_noncomm_spread), color: GRY, name: 'Spread' }, { v: parseFloat(L['pct_of_oi_nonrept_' + side + '_all']), color: BLU, name: 'Petits traders' }];
  fig('#pOI', '% OI long', oi('long'), pctFmt); fig('#pOI', '% OI short', oi('short'), pctFmt);
  B.bars($('#cBars'), [{ label: 'Commerciaux', v: net.c, color: RED }, { label: 'Gr. spéculateurs', v: net.l, color: GRN }, { label: 'Petits traders', v: net.s, color: BLU }]);
  const signal = v => v >= 80 ? ['Achat', 'buy'] : v <= 20 ? ['Vente', 'sell'] : ['Patience', 'wait'];
  [['6', idx6], ['36', idx36]].forEach(([k, v]) => {
    const [t, c] = signal(v); const col = { buy: K.greenl, sell: K.redl, wait: K.gold }[c];
    B.gauge($('#g' + k), v, col); $('#s' + k).innerHTML = `<span class="sig ${c}">${t}</span>`;
  });

  // ---- Tableaux par groupe : TFF (marchés financiers) et Disaggregated (matières premières) ----
  // defs : [nom, pos long, pos short, pos spread, var long, var short, var spread, %OI long, %OI short, %OI spread, traders long, short, spread]
  function groupSection(sel, id, title, tag, X, defs, labels, colors) {
    const xn = k => +X[k] || 0, xp = k => { const v = parseFloat(X[k]); return isNaN(v) ? '' : v + '%'; };
    const cell = (p, c, o, t) => p == null ? '<td></td><td></td><td></td>' : `<td>${B.nf(xn(p))}${badge(xn(c))}</td><td>${xp(o)}</td><td>${t ? B.nf(xn(t)) : ''}</td>`;
    const rows = defs.map(r => `<tr><td class="l">${r[0]}</td>${cell(r[1], r[4], r[7], r[10])}${cell(r[2], r[5], r[8], r[11])}${r[3] ? cell(r[3], r[6], r[9], r[12]) : '<td></td><td></td><td></td>'}<td>${B.nf(xn(r[1]) - xn(r[2]))}</td></tr>`).join('');
    $(sel).innerHTML = `
     <h2 class="sec">${title} – ${m.name}</h2>
     <div class="tw"><table class="cot"><thead>
      <tr><th>${tag}</th><th colspan="3" class="cg">LONG</th><th colspan="3" class="cr">SHORT</th><th colspan="3" class="cw">SPREAD</th><th class="cb">NET</th></tr>
      <tr><th>${X.report_date_as_yyyy_mm_dd.slice(0, 10)}</th><th>Positions</th><th>OI</th><th>Traders</th><th>Positions</th><th>OI</th><th>Traders</th><th>Positions</th><th>OI</th><th>Traders</th><th>Positions</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
     <h2 class="sec">Analyse ${tag}</h2>
     <div class="g2">
     <div class="card insight"><div class="lbl">Long vs Short</div><div class="body" id="${id}LS"></div></div>
     <div class="card insight"><div class="lbl">Positions nettes ${tag}</div><div class="body"><canvas id="${id}Bars" class="mw640" role="img" aria-label="Positions nettes ${tag} par groupe de traders. Valeurs dans le tableau ci-dessus."></canvas></div></div></div>`;
    defs.forEach(r => fig('#' + id + 'LS', r[0], [{ v: xn(r[1]), color: GRN, name: 'Long' }, ...(r[3] ? [{ v: xn(r[3]), color: GRY, name: 'Spread' }] : []), { v: xn(r[2]), color: RED, name: 'Short' }]));
    B.bars($('#' + id + 'Bars'), defs.map((r, i) => ({ label: labels[i], v: xn(r[1]) - xn(r[2]), color: colors[i] })), 210);
  }
  const COL5 = [K.red, K.green, K.blue, K.purple, K.muted];

  if (T) groupSection('#tffSec', 'tff', 'Traders in Financial Futures', 'TFF', T, [["Dealers / intermédiaires","dealer_positions_long_all","dealer_positions_short_all","dealer_positions_spread_all","change_in_dealer_long_all","change_in_dealer_short_all","change_in_dealer_spread_all","pct_of_oi_dealer_long_all","pct_of_oi_dealer_short_all","pct_of_oi_dealer_spread_all","traders_dealer_long_all","traders_dealer_short_all","traders_dealer_spread_all"],["Asset managers","asset_mgr_positions_long","asset_mgr_positions_short","asset_mgr_positions_spread","change_in_asset_mgr_long","change_in_asset_mgr_short","change_in_asset_mgr_spread","pct_of_oi_asset_mgr_long","pct_of_oi_asset_mgr_short","pct_of_oi_asset_mgr_spread","traders_asset_mgr_long_all","traders_asset_mgr_short_all","traders_asset_mgr_spread"],["Fonds à effet de levier","lev_money_positions_long","lev_money_positions_short","lev_money_positions_spread","change_in_lev_money_long","change_in_lev_money_short","change_in_lev_money_spread","pct_of_oi_lev_money_long","pct_of_oi_lev_money_short","pct_of_oi_lev_money_spread","traders_lev_money_long_all","traders_lev_money_short_all","traders_lev_money_spread"],["Autres déclarants","other_rept_positions_long","other_rept_positions_short","other_rept_positions_spread","change_in_other_rept_long","change_in_other_rept_short","change_in_other_rept_spread","pct_of_oi_other_rept_long","pct_of_oi_other_rept_short","pct_of_oi_other_rept_spread","traders_other_rept_long_all","traders_other_rept_short","traders_other_rept_spread"],["Non déclarants","nonrept_positions_long_all","nonrept_positions_short_all",null,"change_in_nonrept_long_all","change_in_nonrept_short_all",null,"pct_of_oi_nonrept_long_all","pct_of_oi_nonrept_short_all",null,null,null,null]],
    ['Dealers', 'Asset mgr.', 'Levier', 'Autres', 'Non décl.'], COL5);
  // COT Index 6 mois par groupe TFF : affiché pour information (la confluence utilise les commerciaux du Legacy).
  if (T && tff && tff.hist && tff.hist.length > 30) {
    const TFF_IDX = [['Asset managers', r => r[3] - r[4], 'positionnement des investisseurs institutionnels'], ['Fonds à effet de levier', r => r[5] - r[6], 'souvent lus à contre-sens aux extrêmes'], ['Dealers / intermédiaires', r => r[1] - r[2], 'contrepartie des clients']];
    const rows = TFF_IDX.map(([n, f, why]) => { const v = CALC.cotIndex(tff.hist.map(f), CALC.THRESHOLDS.cotShortWeeks).at(-1); return `<tr><th scope="row">${n}<br><small>${why}</small></th><td>${v.toFixed(0)} %</td><td>${v >= CALC.THRESHOLDS.cotBuy ? 'extrême acheteur' : v <= CALC.THRESHOLDS.cotSell ? 'extrême vendeur' : 'neutre'}</td></tr>`; }).join('');
    const box = document.createElement('div'); box.className = 'card';
    box.innerHTML = `<h3>COT Index 6 mois par groupe TFF</h3><div class="tw"><table class="cmp"><thead><tr><th scope="col">Groupe</th><th scope="col">COT Index 6 mois</th><th scope="col">Position</th></tr></thead><tbody>${rows}</tbody></table></div><p class="note">Pour information : sur l'historique testé, ces groupes n'ont pas mieux anticipé les indices que les commerciaux du rapport Legacy, qui restent la source du signal COT de la confluence.</p>`;
    $('#tffSec').appendChild(box);
  }

  if (dis) {
    groupSection('#disSec', 'dis', 'COT Disaggregated', 'Disagg.', dis.latest, [["Producteurs / négociants","prod_merc_positions_long","prod_merc_positions_short",null,"change_in_prod_merc_long","change_in_prod_merc_short",null,"pct_of_oi_prod_merc_long","pct_of_oi_prod_merc_short",null,"traders_prod_merc_long_all","traders_prod_merc_short_all",null],["Swap dealers","swap_positions_long_all","swap__positions_short_all","swap__positions_spread_all","change_in_swap_long_all","change_in_swap_short_all","change_in_swap_spread_all","pct_of_oi_swap_long_all","pct_of_oi_swap_short_all","pct_of_oi_swap_spread_all","traders_swap_long_all","traders_swap_short_all","traders_swap_spread_all"],["Managed money","m_money_positions_long_all","m_money_positions_short_all","m_money_positions_spread","change_in_m_money_long_all","change_in_m_money_short_all","change_in_m_money_spread","pct_of_oi_m_money_long_all","pct_of_oi_m_money_short_all","pct_of_oi_m_money_spread","traders_m_money_long_all","traders_m_money_short_all","traders_m_money_spread_all"],["Autres déclarants","other_rept_positions_long","other_rept_positions_short","other_rept_positions_spread","change_in_other_rept_long","change_in_other_rept_short","change_in_other_rept_spread","pct_of_oi_other_rept_long","pct_of_oi_other_rept_short","pct_of_oi_other_rept_spread","traders_other_rept_long_all","traders_other_rept_short","traders_other_rept_spread"],["Non déclarants","nonrept_positions_long_all","nonrept_positions_short_all",null,"change_in_nonrept_long_all","change_in_nonrept_short_all",null,"pct_of_oi_nonrept_long_all","pct_of_oi_nonrept_short_all",null,null,null,null]],
      ['Producteurs', 'Swap dealers', 'Managed money', 'Autres', 'Non décl.'], COL5);
    // COT Index du managed money (fonds spéculatifs) : lecture de positionnement, pas un signal d'achat ou de vente. Calculé à part : ce groupe n'est plus dans le graphique des positions nettes.
    const mmPts = DH.map(r => [dt(r[0]), r[5] - r[6]]);
    const mm6 = cotIndex(mmPts, CALC.THRESHOLDS.cotShortWeeks).at(-1)[1], mm36 = cotIndex(mmPts, CALC.THRESHOLDS.cotLongWeeks).at(-1)[1];
    const pos = v => v >= 80 ? 'Long extrême' : v <= 20 ? 'Short extrême' : 'Neutre';
    $('#disSec').insertAdjacentHTML('beforeend', `
     <div class="card"><h3>Managed money – COT Index</h3><div class="gauges">
       <div class="figure"><canvas id="gm6" role="img" aria-label="Jauge du COT Index 6 mois du managed money : ${mm6.toFixed(1)} %."></canvas>6 mois<div><span class="sig wait">${pos(mm6)}</span></div></div>
       <div class="figure"><canvas id="gm36" role="img" aria-label="Jauge du COT Index 36 mois du managed money : ${mm36.toFixed(1)} %."></canvas>36 mois<div><span class="sig wait">${pos(mm36)}</span></div></div></div>
       <p class="note center">Positionnement des fonds spéculatifs, pas un signal directionnel : un extrême peut annoncer un retournement comme une poursuite.</p></div>`);
    B.gauge($('#gm6'), mm6, K.gold); B.gauge($('#gm36'), mm36, K.gold);
  }
}
