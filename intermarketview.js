// Page « Analyse intermarchés » : matrice de corrélations (par fenêtre), relations classiques lues par rapport à la théorie, changements de régime.
// Tous les calculs sont faits côté serveur (intermarket.js → /api/intermarket) ; la page ne fait qu'afficher.
const IM_WINDOW_LABELS = { 20: '20 séances', 60: '60 séances', 120: '120 séances', 250: '1 an', max: 'Historique' };

function renderIntermarket(data, root, pick = {}) {
  const $ = s => root.querySelector(s), assets = data.assets;
  if (!assets || assets.length < 2) { $('#msg').className = 'err'; $('#msg').textContent = 'Données de prix insuffisantes pour le moment. Réessayez dans quelques minutes.'; return; }
  let win = pick.win || 60;
  const fr = v => (v == null ? '–' : v.toFixed(2).replace('.', ',').replace('-', '−'));
  const cls = v => (v == null ? 'hm-na' : v >= 0.6 ? 'hm-p2' : v >= 0.3 ? 'hm-p1' : v > -0.3 ? 'hm-0' : v > -0.6 ? 'hm-n1' : 'hm-n2');
  const sgn = e => (e > 0 ? 'positive' : e < 0 ? 'négative' : 'variable');
  const ASOF = data.asOf ? new Date(data.asOf + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '–';

  root.innerHTML = `
   <div class="sechead"><h2 class="sec">Matrice des corrélations</h2>
     <div class="ranges" id="imRng" role="group" aria-label="Fenêtre de calcul">${data.windows.map(w => `<button class="btn ${w === win ? 'on' : ''}" data-w="${w}" aria-pressed="${w === win}">${IM_WINDOW_LABELS[w]}</button>`).join('')}</div></div>
   <div class="card"><div class="tw"><table class="mon hm" id="imTbl"></table></div>
     <p class="hm-key" aria-hidden="true"><span class="hm-n2">≤ −0,6</span><span class="hm-n1">−0,6 à −0,3</span><span class="hm-0">−0,3 à +0,3</span><span class="hm-p1">+0,3 à +0,6</span><span class="hm-p2">≥ +0,6</span></p>
     <p class="note">Corrélation des rendements quotidiens des futures, jusqu'au ${ASOF}. +1 : les deux marchés montent et baissent ensemble ; −1 : ils évoluent en sens inverse ; 0 : aucun lien net. Les obligations sont lues sur le <b>prix</b> du contrat (un prix qui monte = des rendements qui baissent).</p></div>

   <div class="sechead"><h2 class="sec">Relations classiques</h2></div>
   <div class="card"><div class="tw"><table class="cmp" id="imPairs"></table></div>
     <p class="note">« Théorie » : sens habituel de la relation. La lecture compare la corrélation sur 1 an à ce sens attendu ; un écart n'est pas une erreur, c'est souvent le signe d'un changement de régime (inflation, choc d'offre, aversion au risque).</p></div>

   <div class="sechead"><h2 class="sec">Changements de régime récents</h2></div>
   <div class="card" id="imShifts"></div>
   <p class="note">Information éducative, pas un conseil en investissement. Une corrélation passée varie dans le temps et ne préjuge pas de la suite.</p>`;

  $('#imPairs').innerHTML = `<thead><tr><th scope="col">Relation</th><th scope="col">Théorie</th><th scope="col">60 séances</th><th scope="col">1 an</th><th scope="col">Historique</th><th scope="col">Lecture</th></tr></thead><tbody>`
    + data.pairs.map(p => `<tr><th scope="row">${p.aName} / ${p.bName}<br><small>${p.why}</small></th><td>${sgn(p.expect)}</td><td class="${cls(p.r60)}">${fr(p.r60)}</td><td class="${cls(p.r250)}">${fr(p.r250)}</td><td class="${cls(p.rMax)}">${fr(p.rMax)}</td>`
      + `<td><span class="sig sm ${p.status.key === 'ok' || p.status.key === 'stable' ? 'buy' : p.status.key === 'flip' ? 'sell' : 'wait'}">${p.status.label}</span>${p.reading ? `<br><small>${p.reading}</small>` : ''}</td></tr>`).join('') + '</tbody>';

  $('#imShifts').innerHTML = data.shifts.length
    ? '<ul class="im-shifts">' + data.shifts.map(s => `<li><b>${s.aName} / ${s.bName}</b> : ${fr(s.r60)} sur 60 séances contre ${fr(s.rMax)} sur l'historique — la relation s'est ${s.r60 > 0 ? 'inversée vers un mouvement conjoint' : 'inversée vers des mouvements opposés'}.${s.reading ? ` <em>${s.reading}</em>` : ''}</li>`).join('') + '</ul>'
    : '<p class="note">Aucun changement de régime marqué : le signe des corrélations récentes est cohérent avec l\'historique.</p>';

  function paint() {
    const m = data.matrix[win];
    $('#imTbl').innerHTML = `<thead><tr><th scope="col"><span class="sr-only">Marché</span></th>${assets.map(a => `<th scope="col" title="${a.name}">${a.short}</th>`).join('')}</tr></thead><tbody>`
      + assets.map((a, i) => `<tr><th scope="row">${a.name}</th>${m[i].map((v, j) => `<td class="${i === j ? 'hm-self' : cls(v)}">${i === j ? '·' : fr(v)}</td>`).join('')}</tr>`).join('') + '</tbody>';
  }
  $('#imRng').onclick = e => {
    const b = e.target.closest('button'); if (!b) return; win = b.dataset.w === 'max' ? 'max' : +b.dataset.w;
    [...$('#imRng').children].forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); paint();
  };
  paint();
}

// Ratios intermarchés : un graphique par ratio (valeur, moyenne sur 50 séances), période commune, indicateurs et lecture fournis par le serveur (/api/ratios).
const RT_RANGES = [[12, '1a'], [36, '3a'], [60, '5a'], [120, '10a'], [0, 'Max']];
function renderRatios(data, root, pick = {}) {
  const B = BD, K = BD.tc(), $ = s => root.querySelector(s), list = (data && data.ratios) || [];
  if (!list.length) { root.innerHTML = '<div class="sechead"><h2 class="sec">Ratios intermarchés</h2></div><div class="card"><p class="note">Ratios indisponibles pour le moment (historique de prix insuffisant).</p></div>'; return; }
  let months = pick.months === undefined ? 36 : pick.months;
  const fmt = v => (v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : +v.toPrecision(3)), fr = v => String(fmt(v)).replace('.', ',');
  const pct = v => (v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',') + ' %');
  const cls = v => (v == null ? '' : v >= 0 ? 'pos' : 'neg');
  root.innerHTML = `
   <div class="sechead"><h2 class="sec">Ratios intermarchés</h2>
     <div class="ranges" id="rtRng" role="group" aria-label="Période affichée">${RT_RANGES.map(([n, l]) => `<button class="btn ${n === months ? 'on' : ''}" data-m="${n}" aria-pressed="${n === months}">${l}</button>`).join('')}</div></div>
   <div class="g2">${list.map(r => `<div class="card"><div class="leg"><b class="ttl">${r.label}</b><div class="legkey"><span><i class="sw line orange"></i>Ratio</span><span><i class="sw line dash"></i>Moyenne 50 séances</span></div></div>
     <div class="kpis tri" id="rk-${r.id}"></div><canvas id="rc-${r.id}" role="img" aria-label="Évolution du ratio ${r.label} sur la période choisie, avec sa moyenne sur 50 séances."></canvas><p class="note" id="rr-${r.id}"></p></div>`).join('')}</div>
   <p class="note">Un ratio monte quand le premier marché fait mieux que le second. Il dit lequel des deux domine, pas ce qui va se passer. Lecture sur 3 mois ; position sur 1 an = rang de la dernière valeur parmi les 250 dernières séances (0 % = plus bas, 100 % = plus haut). Information éducative, pas un conseil en investissement.</p>`;

  const tip = t => new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const items = list.map(r => {
    const pts = r.series.map(([t, v]) => [t * 1e3, v]);
    const ma = pts.map((p, i) => [p[0], i < 49 ? null : pts.slice(i - 49, i + 1).reduce((s, q) => s + q[1], 0) / 50]).filter(p => p[1] != null);
    return { r, pts, ma, chart: B.lineChart($('#rc-' + r.id), { series: [], xmin: 0, xmax: 1, tipHead: tip, tipFmt: fmt, yFmt: fmt, height: 200 }) };
  });
  for (const { r } of items) {
    $('#rk-' + r.id).innerHTML = `<div class="kpi"><span>Valeur</span><b>${fr(r.last)}</b></div><div class="kpi"><span>3 mois</span><b class="${cls(r.chg60)}">${pct(r.chg60)}</b></div><div class="kpi"><span>Position sur 1 an</span><b>${r.pos250 == null ? '–' : r.pos250 + ' %'}</b></div>`;
    $('#rr-' + r.id).textContent = r.reading;
  }
  function paint() {
    for (const { r, pts, ma, chart } of items) {
      const end = pts[pts.length - 1][0], d = new Date(end); if (months) d.setUTCMonth(d.getUTCMonth() - months);
      const x0 = months ? +d : pts[0][0], win = s => s.filter(p => p[0] >= x0);
      const ticks = Array.from({ length: 6 }, (_, i) => { const x = x0 + (end - x0) * i / 5; return [x, new Date(x).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' })]; });
      chart.redraw({ xmin: x0, xmax: end, xTicks: ticks, series: [{ name: r.label, color: K.accent, width: 1.8, data: win(pts) }, { name: 'Moyenne 50 séances', color: K.muted, width: 1.4, dash: [5, 4], data: win(ma) }] });
    }
  }
  $('#rtRng').onclick = e => {
    const b = e.target.closest('button'); if (!b) return; months = +b.dataset.m;
    [...$('#rtRng').children].forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); paint();
  };
  paint();
}

async function bootIntermarket() {
  const root = document.querySelector('#app');
  const ratiosRoot = document.querySelector('#ratios');
  const ratiosReq = BD.json('/api/ratios').catch(() => null);                    // en parallèle ; son échec n'empêche pas la matrice
  try { renderIntermarket(await BD.json('/api/intermarket'), root); }
  catch { root.innerHTML = '<div id="msg" class="err">Données indisponibles pour le moment. Réessayez dans une minute.</div>'; }
  if (ratiosRoot) { try { renderRatios(await ratiosReq, ratiosRoot); } catch { ratiosRoot.innerHTML = ''; } }
}
if (typeof document !== 'undefined' && document.body && document.body.dataset && document.body.dataset.page === 'intermarket') bootIntermarket();
