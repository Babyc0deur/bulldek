// Pages « Inflation » et « Taux d'intérêt » : deux zones comparées sur un graphique et un tableau mensuel (données OCDE, servies par /api/macro).
const MACRO_KINDS = {
  cpi: { title: 'Inflation (CPI)', measures: { yoy: 'Variation annuelle (%)', mom: 'Variation mensuelle (%)' }, first: 'yoy', unit: ' %' },
  rates: { title: 'Taux d\'intérêt', measures: { immediate: 'Taux immédiat (%)', short: 'Court terme, 3 mois (%)', long: 'Long terme (%)' }, first: 'immediate', unit: ' %' },
};

function renderMacro(kind, payload, root, pick = {}) {
  const B = BD, K = BD.tc(), $ = s => root.querySelector(s), cfg = MACRO_KINDS[kind];
  const areas = payload.areas, data = payload.data;
  if (!data) { $('#msg').className = payload.loading ? '' : 'err'; $('#msg').textContent = payload.loading ? 'Première récupération des données OCDE en cours (quelques minutes, la source limite le débit). Revenez dans un instant.' : 'Données indisponibles pour le moment (source OCDE). Réessayez plus tard.'; return; }
  const has = (m, a) => data[m] && data[m][a] && data[m][a].length;
  const list = areas.filter(a => Object.keys(cfg.measures).some(m => has(m, a.code)));
  let A = pick.a || 'USA', Bz = pick.b === undefined ? 'EA20' : pick.b, measure = pick.m || cfg.first, months = pick.months || 60;
  if (!list.some(a => a.code === A)) A = list[0] && list[0].code;
  if (Bz && !list.some(a => a.code === Bz)) Bz = '';
  const opts = (sel, none) => (none ? `<option value="">${none}</option>` : '') + list.map(a => `<option value="${a.code}" ${a.code === sel ? 'selected' : ''}>${a.name}</option>`).join('');
  const nm = code => (areas.find(a => a.code === code) || {}).name || code;
  const pct = v => (v == null ? '–' : v.toFixed(2).replace('.', ',') + ' %');
  const per = p => new Date(Date.UTC(+p.slice(0, 4), +p.slice(5) - 1, 1));
  const fmtP = p => per(p).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' });

  root.innerHTML = `
   <div class="cmp-pick">
     <label for="mA">Zone A</label><select id="mA" class="btn selA">${opts(A)}</select>
     <label for="mB">Zone B</label><select id="mB" class="btn selB">${opts(Bz, 'Aucune')}</select>
     <label for="mM">Mesure</label><select id="mM" class="btn">${Object.entries(cfg.measures).map(([k, l]) => `<option value="${k}" ${k === measure ? 'selected' : ''}>${l}</option>`).join('')}</select>
   </div>
   <div class="sechead"><h2 class="sec" id="mTitle"></h2>
     <div class="ranges" id="mRng" role="group" aria-label="Période affichée">${[[12, '1a'], [36, '3a'], [60, '5a'], [120, 'Max']].map(([n, l]) => `<button class="btn ${n === months ? 'on' : ''}" data-m="${n}" aria-pressed="${n === months}">${l}</button>`).join('')}</div></div>
   <div class="kpis" id="mK"></div>
   <div class="card"><div class="leg"><div class="legkey" id="mLeg"></div></div><canvas id="mChart" role="img" aria-label="Évolution mensuelle de la mesure choisie pour les zones sélectionnées."></canvas></div>
   <div class="card"><h3>Derniers mois</h3><div class="tw" id="mTbl"></div></div>
   <p class="note">Source : OCDE (${kind === 'cpi' ? 'indices des prix à la consommation' : 'indicateurs économiques clés'}). Les publications nationales peuvent précéder celles de l'OCDE de quelques jours ; les dernières valeurs sont parfois révisées. Information éducative, pas un conseil en investissement.</p>`;

  const chart = B.lineChart($('#mChart'), { series: [], xmin: 0, xmax: 1, tipHead: t => new Date(t).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }), tipFmt: v => v.toFixed(2) + ' %', height: 320, yFmt: v => +v.toFixed(1) });
  const serie = code => (code && data[measure] && data[measure][code]) || [];

  function paint() {
    const sa = serie(A), sb = serie(Bz), all = sa.concat(sb);
    $('#mTitle').textContent = `${cfg.title} – ${cfg.measures[measure]}`;
    if (!all.length) { $('#mK').innerHTML = ''; $('#mTbl').innerHTML = '<p class="note">Aucune donnée pour cette mesure et ces zones.</p>'; $('#mLeg').innerHTML = ''; chart.redraw({ xmin: 0, xmax: 1, xTicks: [], series: [] }); return; }
    const end = Math.max(...all.map(p => per(p[0]).getTime())), d = new Date(end); d.setUTCMonth(d.getUTCMonth() - months);
    const x0 = d.getTime(), win = s => s.filter(p => per(p[0]).getTime() >= x0).map(p => [per(p[0]).getTime(), p[1]]);
    const ticks = Array.from({ length: 6 }, (_, i) => { const x = x0 + (end - x0) * i / 5; return [x, new Date(x).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' })]; });
    const series = [{ name: nm(A), color: K.bluel, width: 1.8, data: win(sa) }];
    if (Bz) series.push({ name: nm(Bz), color: K.orange || K.gold, width: 1.8, data: win(sb) });
    chart.redraw({ xmin: x0, xmax: end, xTicks: ticks, series });
    $('#mLeg').innerHTML = `<span><i class="sw line blue"></i>${nm(A)}</span>` + (Bz ? `<span><i class="sw line orange"></i>${nm(Bz)}</span>` : '');
    const kp = code => { const s = serie(code), l = s[s.length - 1], b = s[s.length - 4]; if (!l) return ''; const dl = b ? l[1] - b[1] : null;
      return `<div class="kpi"><span>${nm(code)} (${fmtP(l[0])})</span><b>${pct(l[1])}</b><small>${dl == null ? '' : (dl > 0 ? '+' : dl < 0 ? '−' : '') + Math.abs(dl).toFixed(2).replace('.', ',') + ' pt en 3 mois'}</small></div>`; };
    $('#mK').innerHTML = kp(A) + (Bz ? kp(Bz) : '');
    const periods = [...new Set(all.map(p => p[0]))].sort().reverse().slice(0, 12), get = (s, p) => (s.find(x => x[0] === p) || [])[1];
    $('#mTbl').innerHTML = `<table class="cmp"><thead><tr><th scope="col">Mois</th><th scope="col">${nm(A)}</th>${Bz ? `<th scope="col">${nm(Bz)}</th>` : ''}</tr></thead><tbody>`
      + periods.map(p => `<tr><th scope="row">${fmtP(p)}</th><td>${pct(get(sa, p))}</td>${Bz ? `<td>${pct(get(sb, p))}</td>` : ''}</tr>`).join('') + '</tbody></table>';
  }
  $('#mA').onchange = e => { A = e.target.value; paint(); };
  $('#mB').onchange = e => { Bz = e.target.value; paint(); };
  $('#mM').onchange = e => { measure = e.target.value; paint(); };
  $('#mRng').onclick = e => { const b = e.target.closest('button'); if (!b) return; months = +b.dataset.m; [...$('#mRng').children].forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); paint(); };
  paint();
}

// Courbe des taux américains (FRED, à part de la comparaison OCDE par zone ci-dessus) : 5, 10 et 30 ans sur un même graphique.
async function renderUsCurve(root) {
  const B = BD, K = BD.tc();
  const box = document.createElement('div');
  box.innerHTML = `
   <div class="sechead"><h2 class="sec">Courbe des taux américains</h2>
     <div class="ranges" id="usRng" role="group" aria-label="Période affichée">${[[12, '1a'], [36, '3a'], [60, '5a'], [120, 'Max']].map(([n, l]) => `<button class="btn ${n === 60 ? 'on' : ''}" data-m="${n}" aria-pressed="${n === 60}">${l}</button>`).join('')}</div></div>
   <div id="usMsg"></div>
   <div class="kpis" id="usK"></div>
   <div class="card"><div class="leg"><div class="legkey"><span><i class="sw line blue"></i>5 ans</span><span><i class="sw line orange"></i>10 ans</span><span><i class="sw line purple"></i>30 ans</span></div></div>
     <canvas id="usChart" role="img" aria-label="Rendements du Trésor américain à 5, 10 et 30 ans, sur la période choisie."></canvas></div>
   <p class="note">Source : FRED (Réserve fédérale de Saint-Louis), séries DGS5, DGS10 et DGS30. Rafraîchi toutes les 6 h.</p>`;
  root.appendChild(box);
  const $ = s => box.querySelector(s);

  let data;
  try { data = (await B.json('/api/yields')).data; } catch { data = null; }
  if (!data || !data.us10y) { $('#usMsg').innerHTML = '<p class="note">Rendements américains indisponibles pour le moment.</p>'; return; }

  const pts = s => (s || []).map(([d, v]) => [Date.parse(d + 'T00:00:00Z'), v]);
  const s5 = pts(data.us5y), s10 = pts(data.us10y), s30 = pts(data.us30y);
  const tip = t => new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const chart = B.lineChart($('#usChart'), { series: [], xmin: 0, xmax: 1, tipHead: tip, tipFmt: v => v.toFixed(2) + ' %', height: 320, yFmt: v => +v.toFixed(1) });
  let months = 60;
  function paint() {
    const all = [...s5, ...s10, ...s30]; if (!all.length) { $('#usMsg').innerHTML = '<p class="note">Rendements américains indisponibles pour le moment.</p>'; return; }
    const end = Math.max(...all.map(p => p[0])), d = new Date(end); d.setUTCMonth(d.getUTCMonth() - months);
    const x0 = +d, win = s => s.filter(p => p[0] >= x0);
    const ticks = Array.from({ length: 6 }, (_, i) => { const x = x0 + (end - x0) * i / 5; return [x, new Date(x).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' })]; });
    chart.redraw({ xmin: x0, xmax: end, xTicks: ticks, series: [
      { name: '5 ans', color: K.bluel, width: 1.8, data: win(s5) },
      { name: '10 ans', color: K.accent, width: 1.8, data: win(s10) },
      { name: '30 ans', color: K.purple, width: 1.8, data: win(s30) },
    ] });
    const kp = (label, s) => { const l = s[s.length - 1]; if (!l) return ''; return `<div class="kpi"><span>${label}</span><b>${l[1].toFixed(2).replace('.', ',')} %</b></div>`; };
    $('#usK').innerHTML = kp('5 ans', s5) + kp('10 ans', s10) + kp('30 ans', s30);
  }
  $('#usRng').onclick = e => {
    const b = e.target.closest('button'); if (!b) return; months = +b.dataset.m;
    [...$('#usRng').children].forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); paint();
  };
  paint();
}

async function bootMacro() {
  const kind = document.body.dataset.kind, root = document.querySelector('#app');
  try { renderMacro(kind, await BD.json('/api/macro?kind=' + kind), root); }
  catch { root.innerHTML = '<div id="msg" class="err">Données indisponibles pour le moment. Réessayez dans une minute.</div>'; return; }
  if (kind === 'rates') { try { await renderUsCurve(root); } catch { /* section secondaire : son échec ne casse pas le reste de la page */ } }
}
if (typeof document !== 'undefined' && document.body && document.body.dataset && document.body.dataset.kind) bootMacro();
