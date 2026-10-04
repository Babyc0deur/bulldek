// Comparaison de deux marchés : signaux, performance relative, corrélation et positionnement COT côte à côte.
// renderCompare() est un affichage pur (données déjà chargées) : testable sans réseau. Le chargement est tout en bas (boot).
const CMP_RANGES = [[3, '3m'], [6, '6m'], [12, '1a'], [36, '3a'], [60, '5a'], [120, '10a']];
const CMP_PERF = [[1, '1 mois'], [3, '3 mois'], [6, '6 mois'], [12, '1 an'], [36, '3 ans'], [60, '5 ans']];
const CMP_CORR = [[63, '3 mois'], [252, '1 an'], [756, '3 ans']];

// Force de la corrélation en mots (seuils usuels).
function corrWords(r) {
  if (r == null) return 'indisponible';
  const s = r >= 0 ? 'même sens' : 'sens opposé', a = Math.abs(r);
  return a >= 0.7 ? 'forte, ' + s : a >= 0.3 ? 'modérée, ' + s : 'faible';
}

function renderCompare({ a, b, daily, cot, rows, now }, root) {
  const B = BD, K = BD.tc(), $ = s => root.querySelector(s), pct = v => v == null ? '–' : (v > 0 ? '+' : '') + v.toFixed(2) + ' %';
  const cls = v => v == null ? '' : v >= 0 ? 'pos' : 'neg', px = v => v.toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 4 : v < 1000 ? 2 : 1 });
  const day = t => new Date(t * 1e3).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  const CMP_COLORS = { a: K.bluel, b: K.accent }, na = a.name, nb = b.name, lastT = Math.min(daily.a.at(-1)[0], daily.b.at(-1)[0]);

  // ---- signaux côte à côte (mêmes règles que le screener) ----
  const cotCell = i => { const s = CALC.cotSignal(i); return i.toFixed(0) + ' % ' + B.sigPill(CALC.cotLabel(i), s > 0 ? 'buy' : s < 0 ? 'sell' : 'wait'); };
  const zone = v => v > -20 ? B.sigPill('Surachat', 'sell') : v < -80 ? B.sigPill('Survente', 'buy') : B.sigPill('Neutre', 'wait');
  const cells = r => r.missing ? Array(8).fill('<td>indisponible</td>') : [
    px(r.price), `<span class="${cls(r.chgPct)}">${pct(r.chgPct)}</span>`, cotCell(r.idx6), cotCell(r.idx36),
    r.wr.toFixed(1) + ' ' + (r.roll ? B.sigPill('Non fiable', 'wait') : zone(r.wr)),
    r.oi ? `<span class="${cls(r.oi.chgPct)}">${pct(r.oi.chgPct)}</span> ` + B.sigPill(r.oi.label, r.sig.oi > 0 ? 'buy' : r.sig.oi < 0 ? 'sell' : 'wait') : '–',
    `<span class="${cls(r.season.avgPct)}">${pct(r.season.avgPct)}</span> <small>${r.season.up}/${r.season.n} hausse</small>`,
    B.sigDot(r.sig.cot, 'COT') + B.sigDot(r.sig.season, 'Saison') + B.sigDot(r.sig.wr, 'Williams %R') + B.sigDot(r.sig.oi, 'Open interest') + ' ' + B.sigPill((r.score > 0 ? '+' : '') + r.score, CALC.confluenceClass(r.score)),
  ].map(x => '<td>' + x + '</td>');
  const LABELS = ['Prix', 'Variation du jour', 'COT Index 6 mois', 'COT Index 36 mois', 'Williams %R (14 j)', 'Open interest (semaine)', 'Saison de la semaine (max)', 'Confluence'];
  const ca = cells(rows.a), cb = cells(rows.b);
  const sigTable = `<table class="cmp"><thead><tr><th scope="col"><span class="sr-only">Indicateur</span></th><th scope="col" class="a-c">${na}</th><th scope="col" class="b-c">${nb}</th></tr></thead><tbody>`
    + LABELS.map((l, i) => `<tr><th scope="row">${l}</th>${ca[i]}${cb[i]}</tr>`).join('') + '</tbody></table>';

  // ---- performances ----
  const perfRow = ([m, l]) => { const pa = CALC.performance(daily.a, m), pb = CALC.performance(daily.b, m);
    const diff = pa && pb ? pa.pct - pb.pct : null;
    return `<tr><th scope="row">${l}</th><td class="${cls(pa && pa.pct)}">${pa ? pct(pa.pct) : '–'}</td><td class="${cls(pb && pb.pct)}">${pb ? pct(pb.pct) : '–'}</td><td class="${cls(diff)}">${diff == null ? '–' : (diff > 0 ? '+' : '') + diff.toFixed(2) + ' pts'}</td></tr>`; };
  const perfTable = `<table class="cmp"><thead><tr><th scope="col">Période</th><th scope="col" class="a-c">${na}</th><th scope="col" class="b-c">${nb}</th><th scope="col">Écart A − B</th></tr></thead><tbody>${CMP_PERF.map(perfRow).join('')}</tbody></table>`;

  // ---- corrélation (rendements quotidiens sur les jours communs) ----
  const pairs = CALC.alignedReturns(daily.a, daily.b), corr = CMP_CORR.map(([w, l]) => ({ l, w, r: CALC.correlation(pairs.slice(-w)) }));
  const kpi = c => `<div class="kpi"><span>Corrélation ${c.l}</span><b>${c.r == null ? '–' : c.r.toFixed(2)}</b><small>${corrWords(c.r)}</small></div>`;
  const main = corr[1], rangeBtns = (on) => CMP_RANGES.map(([m, l]) => `<button class="btn ${m === on ? 'on' : ''}" data-m="${m}" aria-pressed="${m === on}">${l}</button>`).join('');

  root.innerHTML = `
   <div class="sechead"><h2 class="sec">Signaux côte à côte</h2></div>
   <div class="card"><div class="tw">${sigTable}</div></div>

   <div class="sechead"><h2 class="sec">Performance relative</h2>
     <div class="ranges" id="rng" role="group" aria-label="Période affichée">${rangeBtns(12)}</div></div>
   <div class="g21">
     <div class="card"><div class="leg"><div class="legkey"><span><i class="sw line blue"></i>${na}</span><span><i class="sw line orange"></i>${nb}</span></div><b class="ttl">Base 100 au début de la période</b></div>
       <canvas id="cPerf" role="img" aria-label="Performance comparée de ${na} et ${nb}, en base 100 au début de la période choisie. Les chiffres exacts figurent dans le tableau voisin."></canvas></div>
     <div class="card"><div class="tw">${perfTable}</div></div>
   </div>

   <div class="sechead"><h2 class="sec">Corrélation</h2></div>
   <p class="corr-sum">Sur 1 an, <b>${na}</b> et <b>${nb}</b> évoluent de façon <b>${corrWords(main.r)}</b>${main.r == null ? '' : ' (r = ' + main.r.toFixed(2) + ')'} · ${pairs.length.toLocaleString('fr-FR')} jours de bourse communs au total.</p>
   <div class="corr-k">${corr.map(kpi).join('')}</div>
   <div class="card"><div class="leg"><div class="legkey"><span><i class="sw line white"></i>Corrélation glissante sur 63 jours</span></div></div>
     <canvas id="cCorr" role="img" aria-label="Corrélation glissante sur 63 jours entre les rendements quotidiens de ${na} et de ${nb}, entre −1 et +1."></canvas></div>

   <div class="sechead"><h2 class="sec">Positionnement COT (commerciaux)</h2></div>
   <div class="card"><div class="leg"><div class="legkey"><span><i class="sw line blue"></i>${na}</span><span><i class="sw line orange"></i>${nb}</span></div><b class="ttl">COT Index 36 mois</b></div>
     <canvas id="cCot" role="img" aria-label="COT Index sur 36 mois des positions nettes des commerciaux pour ${na} et ${nb}, entre 0 et 100."></canvas></div>
   <p class="note">Performance : dernière clôture rapportée à celle du même jour calendaire de la période (dernière séance antérieure). Corrélation : Pearson sur les rendements quotidiens des jours de bourse communs aux deux marchés ; elle mesure un mouvement conjoint, pas une relation de cause à effet, et varie beaucoup dans le temps. Les futures continus ne sont pas ajustés des changements de contrat : un saut isolé peut fausser la corrélation. Repères pédagogiques, pas un conseil en investissement.</p>`;

  // ---- graphiques ----
  const tip = t => new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  const xt = (x0, x1) => Array.from({ length: 6 }, (_, i) => { const t = x0 + (x1 - x0) * i / 5; return [t, new Date(t).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })]; });
  const cPerf = B.lineChart($('#cPerf'), { series: [], xmin: 0, xmax: 1, tipHead: tip, tipFmt: v => v.toFixed(1), height: 320, yFmt: v => Math.round(v) });
  const cCorr = B.lineChart($('#cCorr'), { series: [], xmin: 0, xmax: 1, ymin: -1, ymax: 1, tipHead: tip, tipFmt: v => v.toFixed(2), height: 240, yFmt: v => +v.toFixed(1) });
  const cCot = B.lineChart($('#cCot'), { series: [], xmin: 0, xmax: 1, ymin: 0, ymax: 100, tipHead: tip, tipFmt: v => v.toFixed(1) + ' %', height: 260,
    hbands: [{ y0: 0, y1: 20, color: B.alpha('red', .35) }, { y0: 80, y1: 100, color: B.alpha('green', .35) }] });
  const roll = CALC.rollingCorrelation(pairs, 63), ms = rows_ => rows_.map(([t, v]) => [t * 1e3, v]);
  const idx = h => { const net = h.map(r => r[1] - r[2]), i = CALC.cotIndex(net, CALC.THRESHOLDS.cotLongWeeks); return h.map((r, k) => [Date.parse(r[0].slice(0, 10)), i[k]]); };
  const ia = idx(cot.a), ib = idx(cot.b), rollMs = ms(roll);
  function paint(months) {
    const d = new Date(lastT * 1e3); d.setUTCMonth(d.getUTCMonth() - months);
    const x0 = d.getTime(), x1 = lastT * 1e3, ticks = xt(x0, x1), from = x0 / 1e3;
    cPerf.redraw({ xmin: x0, xmax: x1, xTicks: ticks, series: [{ name: na, color: CMP_COLORS.a, width: 1.8, data: ms(CALC.rebase(daily.a, from)) }, { name: nb, color: CMP_COLORS.b, width: 1.8, data: ms(CALC.rebase(daily.b, from)) }] });
    cCorr.redraw({ xmin: x0, xmax: x1, xTicks: ticks, series: [{ name: 'Corrélation 63 j', color: K.text, width: 1.6, data: rollMs }] });
    cCot.redraw({ xmin: x0, xmax: x1, xTicks: ticks, series: [{ name: na, color: CMP_COLORS.a, width: 1.8, data: ia }, { name: nb, color: CMP_COLORS.b, width: 1.8, data: ib }] });
  }
  $('#rng').onclick = e => {
    const btn = e.target.closest('button'); if (!btn) return;
    [...$('#rng').children].forEach(x => { x.classList.toggle('on', x === btn); x.setAttribute('aria-pressed', x === btn); });
    paint(+btn.dataset.m);
  };
  paint(12);
}

// ---- Chargement : marchés choisis dans l'adresse (?a=…&b=…), données du serveur, puis affichage ----
async function bootCompare() {
  const B = BD, $ = s => document.querySelector(s);
  const markets = await B.json('/markets.json'), q = new URLSearchParams(location.search);
  const find = (slug, fb) => markets.find(m => m.slug === slug) || markets.find(m => m.slug === fb);
  let a = find(q.get('a'), 'nasdaq-100'), b = find(q.get('b'), 'sp500');
  if (a.slug === b.slug) b = markets.find(m => m.slug !== a.slug);
  const GROUPS = ['Currencies', 'Crypto', 'Indices', 'Bonds', 'Energy', 'Metals', 'Grains', 'Softs', 'Livestock'];
  const options = sel => GROUPS.map(g => `<optgroup label="${g}">` + markets.filter(x => x.group === g).map(x => `<option value="${x.slug}" ${x.slug === sel ? 'selected' : ''}>${x.name}</option>`).join('') + '</optgroup>').join('');
  const sync = () => {
    $('#selA').innerHTML = options(a.slug); $('#selB').innerHTML = options(b.slug);
    history.replaceState(null, '', `/compare?a=${a.slug}&b=${b.slug}`);
    document.title = `${a.name} contre ${b.name} – Comparaison | BullDesk`;
  };
  async function load() {
    const app = $('#app'); app.innerHTML = '<div id="msg">Chargement des données…</div>';
    try {
      const [da, db, ca, cb, scr] = await Promise.all([B.daily(a.code), B.daily(b.code), B.json('/api/cot?code=' + a.code), B.json('/api/cot?code=' + b.code), B.json('/api/screener')]);
      const ra = scr.rows.find(r => r.slug === a.slug), rb = scr.rows.find(r => r.slug === b.slug);
      if (!da || !db || da.length < 60 || db.length < 60 || !ca.hist || !cb.hist || !ra || !rb) throw 0;
      renderCompare({ a, b, daily: { a: da, b: db }, cot: { a: ca.hist, b: cb.hist }, rows: { a: ra, b: rb }, now: Date.now() }, app);
    } catch { app.innerHTML = '<div id="msg" class="err">Données indisponibles pour cette comparaison pour le moment. Réessayez dans une minute.</div>'; }
  }
  const change = (which, slug) => {
    const m = markets.find(x => x.slug === slug), other = which === 'a' ? b : a;
    if (m.slug === other.slug) { $('#cmpMsg').textContent = 'Choisissez deux marchés différents.'; sync(); return; }
    $('#cmpMsg').textContent = ''; if (which === 'a') a = m; else b = m; sync(); load();
  };
  $('#selA').onchange = e => change('a', e.target.value);
  $('#selB').onchange = e => change('b', e.target.value);
  $('#swap').onclick = () => { [a, b] = [b, a]; sync(); load(); };
  BD.freshness($('#fresh'));
  sync(); load();
}
if (typeof document !== 'undefined' && document.getElementById('selA')) bootCompare();
