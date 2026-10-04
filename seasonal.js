// Saisonnalité : affichage seulement. Tous les calculs sont faits côté serveur (calc.js → /api/seasonal).
async function renderSeasonal(m, root) {
  const B = BD, K = BD.tc(), $ = s => root.querySelector(s);
  let S;
  try { S = (await B.json('/api/seasonal?code=' + m.code)).report; if (!S) throw 0; }
  catch { $('#msg').className = 'err'; $('#msg').textContent = 'Saisonnalité indisponible pour ce marché pour le moment. Réessayez dans une minute.'; return; }

  const { year: CY, month: CM, day: CD, doy: TODAY, lastClose } = S.meta;
  const MS = CALC.MONTH_STARTS, DM = CALC.DAYS_IN_MONTH, dm = DM[CM];
  const digits = lastClose < 10 ? 4 : lastClose < 1000 ? 2 : 1, fmt = v => B.dec(v, digits);
  const mname = B.MONTHS_L[CM], mshort = B.MONTHS[CM].toLowerCase();
  const PER = [[20, K.gold], [15, K.accent], [10, K.purple], [5, K.bluel], [2, K.greenl], ['max', K.red]], SHOWN = [10, 5, 2];
  const lab = n => (n === 'max' ? `Max (${S.meta.years} ans)` : n + ' ans');
  const cls = v => v == null ? '' : v >= 0 ? 'pos' : 'neg';

  // ---- textes ----
  B.setInfo(`<p>Les tendances saisonnières du <b>${m.name}</b> reposent sur le contrat future. Le rapport présente la saisonnalité sur les 20, 15, 10, 5 et 2 dernières années, ainsi que sur tout l'historique disponible (maximum) et montre comment le marché évolue à certaines périodes de l'année ou de la semaine dans un mois.</p>
    <p>En moyenne sur les 10 dernières années, le ${m.name} a varié de <b>${fmt(S.kpi.avg[10])}</b> en ${mname}.</p>
    <p>Repérez le mois le plus haussier ou le plus baissier de l'année et adaptez votre positionnement. Les données sont recalculées automatiquement à chaque nouvelle année complète. La saisonnalité est plus fiable combinée à l'analyse fondamentale.</p>`);

  // ---- gabarit ----
  const chip = (n, label, color, on) => `<button class="chip ${on ? 'on' : ''}" data-n="${n}" data-c="${color}" aria-pressed="${on}"><i></i>${label}</button>`;
  const chipsY = PER.map(([n, c]) => chip(n, lab(n), c, SHOWN.includes(n))).join('') + chip('ytd', CY, K.text, true);
  const chipsM = PER.filter(p => SHOWN.includes(p[0])).map(([n, c]) => chip(n, lab(n), c, true)).join('') + chip('cur', `${mname} ${CY}`, K.text, true);
  root.innerHTML = `
   <div class="sechead"><h2 class="sec">Saisonnalité annuelle – ${m.name}</h2></div>
   <div class="card"><div class="leg"><div class="chips" id="chipsY" role="group" aria-label="Périodes affichées">${chipsY}</div>
     <div class="legkey"><span><i></i>Mois en cours</span><span><i class="d"></i>Jour en cours</span></div></div>
     <canvas id="cYear" role="img" aria-label="Évolution cumulée moyenne du ${m.name} sur l'année, sur 10, 5 et 2 ans, comparée à l'année en cours. Les valeurs détaillées figurent dans les tableaux ci-dessous."></canvas></div>

   <div class="sechead"><h2 class="sec">Saisonnalité de ${mname}</h2></div>
   <div class="g21">
     <div class="card"><div class="leg"><div class="chips" id="chipsM" role="group" aria-label="Périodes affichées">${chipsM}</div>
     <div class="legkey"><span><i class="d"></i>Jour en cours</span></div></div>
     <canvas id="cMonth" role="img" aria-label="Évolution cumulée moyenne du ${m.name} au cours de ${mname}, jour par jour, sur 10, 5 et 2 ans, comparée au mois en cours."></canvas></div>
     <div class="kpis vert" id="kpis"></div>
   </div>

   <div class="sechead"><h2 class="sec">Variations mensuelles</h2>
     <div class="ranges" id="unit" role="group" aria-label="Unité"><button class="btn on" data-u="pts" aria-pressed="true">Points</button><button class="btn" data-u="pct" aria-pressed="false">%</button></div></div>
   <div class="g21">
     <div class="card"><div class="tw"><table class="mon" id="tbl"></table></div></div>
     <div class="card"><h3>Variation moyenne par mois – 10 ans</h3><canvas id="cMBars" role="img" aria-label="Variation moyenne du ${m.name} pour chacun des 12 mois, sur 10 ans. Valeurs dans le tableau voisin."></canvas></div>
   </div>

   <div class="sechead"><h2 class="sec">Semaines et jours – ${mname}</h2></div>
   <div class="g2 top">
     <div class="col">
       <div class="card"><h3>Variations par semaine</h3><div class="tw"><table class="mon w480" id="wtbl"></table></div></div>
       <div class="card"><h3>Variation moyenne par jour – 10 ans</h3><canvas id="cDay" role="img" aria-label="Variation moyenne du ${m.name} pour chaque jour de ${mname}, sur 10 ans. Valeurs dans le tableau des variations journalières."></canvas></div>
     </div>
     <div class="card fill"><h3>Variations journalières</h3><div class="tw scroll" tabindex="0" role="region" aria-label="Tableau des variations journalières, défilant"><table class="mon w420" id="dtbl"></table></div></div>
   </div>
   <p class="note">Variation mensuelle = clôture de fin de mois − clôture du mois précédent, moyennée sur les années complètes. Courbes annuelles = évolution cumulée depuis la dernière clôture de l'année précédente, moyennée sur la période. Mise à jour automatique.</p>`;
  B.applyColors(root);

  // ---- graphique annuel ----
  const dayLabel = i => { let mo = 11; while (MS[mo] > i) mo--; return `${i - MS[mo] + 1} ${B.MONTHS[mo].toLowerCase()}`; };
  const onY = new Set([10, 5, 2, 'ytd']);
  const cy = B.lineChart($('#cYear'), { series: [], xmin: 0, xmax: 364, xTicks: MS.map((v, i) => [v, B.MONTHS[i]]), tipHead: dayLabel, tipFmt: fmt, height: 400,
    yFmt: v => Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : +v.toFixed(2),
    bands: [{ x0: MS[CM], x1: MS[CM] + dm, color: B.alpha('gold', .12) }], vlines: [{ x: TODAY, color: K.redl }] });
  const points = (arr, x0 = 0) => (arr || []).map((v, i) => v == null ? null : [i + x0, v]).filter(Boolean);
  function paintYear() {
    const s = PER.filter(([n]) => onY.has(n)).map(([n, c]) => ({ name: lab(n), color: c, width: 1.8, data: points(S.annual[n]) }));
    if (onY.has('ytd') && S.ytd) s.push({ name: String(CY), color: K.text, width: 1.6, dash: [5, 4], data: points(S.ytd) });
    cy.redraw({ series: s });
  }
  const toggler = (set, key, paint) => e => {
    const b = e.target.closest('.chip'); if (!b) return;
    const n = b.dataset.n === key || b.dataset.n === 'max' ? b.dataset.n : +b.dataset.n;
    set.has(n) ? set.delete(n) : set.add(n);
    b.classList.toggle('on'); b.setAttribute('aria-pressed', set.has(n)); paint();
  };
  $('#chipsY').onclick = toggler(onY, 'ytd', paintYear);
  paintYear();

  // ---- graphique du mois ----
  const onM = new Set([10, 5, 2, 'cur']);
  const cm = B.lineChart($('#cMonth'), { series: [], xmin: 1, xmax: dm, xTicks: Array.from({ length: dm }, (_, i) => [i + 1, String(i + 1)]).filter(t => t[0] % 2 === 1),
    yFmt: v => +v.toFixed(2), tipHead: x => `${x} ${mshort}`, tipFmt: fmt, vlines: [{ x: Math.min(CD, dm), color: K.redl }], height: 300 });
  function paintMonth() {
    const s = PER.filter(([n]) => onM.has(n)).map(([n, c]) => ({ name: lab(n), color: c, width: 1.8, data: points(S.month[n], 1) }));
    if (onM.has('cur') && S.month.cur) s.push({ name: `${B.MONTHS[CM]} ${CY}`, color: K.text, width: 1.6, dash: [5, 4], data: points(S.month.cur, 1) });
    cm.redraw({ series: s });
  }
  $('#chipsM').onclick = toggler(onM, 'cur', paintMonth);
  paintMonth();

  // ---- indicateurs du mois ----
  const kp = (l, v, c = '') => `<div class="kpi"><span>${l}</span><b class="${c}">${v}</b></div>`;
  $('#kpis').innerHTML = [10, 5, 2].map(n => { const v = S.kpi.avg[n]; return kp(`Moyenne ${n} ans`, v == null ? '–' : fmt(v), cls(v)); }).join('')
    + kp('Ce mois-ci', S.kpi.monthSoFar == null ? '–' : fmt(S.kpi.monthSoFar), cls(S.kpi.monthSoFar)) + kp(`Hausse en ${mname} (10 a.)`, `${S.kpi.up}/${S.kpi.n}`);

  // ---- tableaux ----
  let unit = 'pts';
  const f2 = v => v == null ? '–' : unit === 'pct' ? B.dec(v, 2) + '%' : fmt(v);
  const bars = (canvas, arr, labels, h) => B.bars(canvas, arr.map((v, i) => ({ label: labels[i], v: v || 0, color: (v || 0) >= 0 ? K.greenl : K.redl })), h, false);

  function paintTable() {
    const row = n => S.monthly[unit][n];
    $('#tbl').innerHTML = `<thead><tr><th scope="col">Période</th>${B.MONTHS.map((x, i) => `<th scope="col" class="${i === CM ? 'cur' : ''}">${x}</th>`).join('')}</tr></thead><tbody>`
      + PER.map(([n]) => `<tr><th scope="row">${lab(n)}</th>${row(n).map((v, i) => `<td class="${cls(v)} ${i === CM ? 'cur' : ''}">${f2(v)}</td>`).join('')}</tr>`).join('') + '</tbody>';
    bars($('#cMBars'), row(10), B.MONTHS, 210);
  }
  // Semaines du mois en cours : blocs 1-7, 8-14, 15-21, 22-28, 29-fin.
  function paintWeeks() {
    const blocks = S.weekly.blocks, cur = S.weekly[unit].cur, curWk = blocks.findIndex(([a, e]) => CD >= a && CD <= e);
    const c = (v, k) => `${cls(v)} ${k === curWk ? 'cur' : ''}`;
    $('#wtbl').innerHTML = `<thead><tr><th scope="col">Période</th>${blocks.map(([a, e], k) => `<th scope="col" class="${k === curWk ? 'cur' : ''}">Sem. ${k + 1}<br><small>${a}–${e} ${mshort}</small></th>`).join('')}</tr></thead><tbody>`
      + PER.map(([n]) => `<tr><th scope="row">${lab(n)}</th>${S.weekly[unit][n].map((v, k) => `<td class="${c(v, k)}">${f2(v)}</td>`).join('')}</tr>`).join('')
      + (cur ? `<tr><th scope="row">${CY}</th>${cur.map((v, k) => `<td class="${c(v, k)}">${f2(v)}${k === curWk && v != null ? ' <small>(en cours)</small>' : ''}</td>`).join('')}</tr>` : '') + '</tbody>';
  }
  // Jours du mois : variation moyenne d'une séance à la précédente.
  function paintDays() {
    const D = S.daily[unit], cur = D.cur, today = i => i + 1 === CD ? 'cur' : '';
    $('#dtbl').innerHTML = `<thead><tr><th scope="col">Jour</th>${PER.map(([n]) => `<th scope="col">${lab(n)}</th>`).join('')}<th scope="col">${CY}</th></tr></thead><tbody>`
      + Array.from({ length: dm }, (_, i) => `<tr class="${today(i)}"><th scope="row">${i + 1} ${mshort}</th>${PER.map(([n]) => `<td class="${cls(D[n][i])} ${today(i)}">${f2(D[n][i])}</td>`).join('')}<td class="${cls(cur[i])} ${today(i)}">${f2(cur[i])}</td></tr>`).join('') + '</tbody>';
    bars($('#cDay'), D[10], Array.from({ length: dm }, (_, i) => String(i + 1)), 200);
  }
  $('#unit').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    unit = b.dataset.u;
    [...$('#unit').children].forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    paintTable(); paintWeeks(); paintDays();
  };
  paintTable(); paintWeeks(); paintDays();
  addEventListener('resize', () => { bars($('#cMBars'), S.monthly[unit][10], B.MONTHS, 210); bars($('#cDay'), S.daily[unit][10], Array.from({ length: dm }, (_, i) => String(i + 1)), 200); });
}
