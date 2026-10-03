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

async function bootIntermarket() {
  const root = document.querySelector('#app');
  try { renderIntermarket(await BD.json('/api/intermarket'), root); }
  catch { root.innerHTML = '<div id="msg" class="err">Données indisponibles pour le moment. Réessayez dans une minute.</div>'; }
}
if (typeof document !== 'undefined' && document.body && document.body.dataset && document.body.dataset.page === 'intermarket') bootIntermarket();
