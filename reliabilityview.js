// Page « Fiabilité des signaux » : affichage seulement. Tout est calculé côté serveur (reliability.js → /api/reliability).
const RL_MAIN = ['cot', 'season', 'wr', 'oi'];                                                   // les quatre signaux de la confluence
const RL_EXTRA = ['wrRaw', 'trend', 'cot:legacy', 'cot:tff-am', 'cot:tff-lev', 'cot:tff-dealer'];  // variantes et repères, hors confluence

function renderReliability(data, root, pick = {}) {
  const $ = s => root.querySelector(s), list = (data && data.markets) || [];
  if (!list.length) { root.innerHTML = '<div id="msg" class="err">Historique insuffisant pour le moment. Réessayez dans quelques minutes.</div>'; return; }
  const groups = [...new Set(list.map(m => m.group))];
  let group = pick.group && groups.includes(pick.group) ? pick.group : groups.includes('Indices') ? 'Indices' : groups[0];
  let h = pick.h || 5, slug = pick.slug;
  const L = data.labels || {};
  const num = (v, d = 2) => (v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d).replace('.', ','));
  const pct = v => (v == null ? '–' : num(v) + ' %');
  const cls = v => (v == null ? '' : v >= 0 ? 'pos' : 'neg');
  const pill = vd => `<span class="sig sm ${vd.key === 'good' ? 'buy' : vd.key === 'bad' ? 'sell' : 'wait'}">${vd.label}</span>`;
  const dateFr = d => new Date(d + 'T00:00:00Z').toLocaleDateString('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' });

  root.innerHTML = `
   <div class="cmp-pick">
     <label for="rlGrp">Catégorie</label><select id="rlGrp" class="btn">${groups.map(g => `<option ${g === group ? 'selected' : ''}>${g}</option>`).join('')}</select>
     <div class="ranges" id="rlH" role="group" aria-label="Horizon de mesure">${data.horizons.map(x => `<button class="btn ${x === h ? 'on' : ''}" data-h="${x}" aria-pressed="${x === h}">${x} séances</button>`).join('')}</div>
   </div>
   <div class="sechead"><h2 class="sec">Résumé par marché</h2></div>
   <div class="card"><div class="tw"><table class="cmp" id="rlSum"></table></div>
     <p class="note">Chaque case : verdict du signal (écart moyen entre semaines haussières et baissières, et sa significativité t). Cliquez sur un marché pour le détail.</p></div>
   <div id="rlDetail"></div>`;

  function summary() {
    const ms = list.filter(m => m.group === group);
    if (!ms.some(m => m.slug === slug)) slug = ms[0] && ms[0].slug;
    const cell = (H, key) => { const s = key === 'conf' ? H : H.signals[key]; if (!s) return '<td>–</td>'; return `<td title="Écart ${pct(s.spread)} · t ${num(s.t, 1)}${s.stable ? ' · stable sur les deux moitiés' : ''}">${pill(s.verdict)}<br><small>${pct(s.spread)}${s.stable ? '' : ' · instable'}</small></td>`; };
    $('#rlSum').innerHTML = `<thead><tr><th scope="col">Marché</th><th scope="col">Période testée</th><th scope="col">Confluence ≥ +2 contre ≤ −2</th><th scope="col">COT</th><th scope="col">Saisonnalité</th><th scope="col">Williams %R</th><th scope="col">Open interest</th></tr></thead><tbody>`
      + ms.map(m => { const H = m.horizons[h]; return `<tr class="${m.slug === slug ? 'rl-on' : ''}" data-slug="${m.slug}"><th scope="row"><a href="#rlDetail" data-slug="${m.slug}">${m.name}</a></th><td><small>${dateFr(m.from)} – ${dateFr(m.to)}<br>${m.weeks} semaines</small></td>${cell(H, 'conf')}${RL_MAIN.map(k => cell(H, k)).join('')}</tr>`; }).join('') + '</tbody>';
  }

  function detail() {
    const m = list.find(x => x.slug === slug); if (!m) { $('#rlDetail').innerHTML = ''; return; }
    const H = m.horizons[h], b = H.base;
    const sigRow = key => { const s = H.signals[key]; if (!s) return ''; const c = (x) => `<td>${x.n}</td><td class="${cls(x.mean)}">${pct(x.mean)}</td>`;
      return `<tr><th scope="row">${L[key] || key}${key === 'cot' ? `<br><small>${L['cot:' + m.cotSource] || ''}</small>` : ''}</th>${c(s.plus)}${c(s.zero)}${c(s.minus)}<td class="${cls(s.spread)}">${pct(s.spread)}</td><td>${num(s.t, 1)}</td><td>${pill(s.verdict)}</td><td>${s.halves.map(pct).join(' / ')}<br><small>${s.stable ? 'stable' : 'instable'}</small></td></tr>`; };
    const head = `<thead><tr><th scope="col" rowspan="2">Signal</th><th scope="colgroup" colspan="2">Haussier (+1)</th><th scope="colgroup" colspan="2">Neutre (0)</th><th scope="colgroup" colspan="2">Baissier (−1)</th><th scope="col" rowspan="2">Écart</th><th scope="col" rowspan="2">t</th><th scope="col" rowspan="2">Verdict</th><th scope="col" rowspan="2">1re / 2e moitié</th></tr>
      <tr><th scope="col">Cas</th><th scope="col">Moy.</th><th scope="col">Cas</th><th scope="col">Moy.</th><th scope="col">Cas</th><th scope="col">Moy.</th></tr></thead>`;
    const extra = RL_EXTRA.filter(k => H.signals[k]);
    $('#rlDetail').innerHTML = `
     <div class="sechead"><h2 class="sec">Détail : ${m.name} · ${h} séances</h2></div>
     <div class="kpis"><div class="kpi"><span>Période</span><b>${dateFr(m.from)} – ${dateFr(m.to)}</b></div><div class="kpi"><span>Semaines testées</span><b>${m.weeks}</b></div>
       <div class="kpi"><span>Moyenne toutes semaines</span><b class="${cls(b.mean)}">${pct(b.mean)}</b></div><div class="kpi"><span>Semaines en hausse</span><b>${b.hit == null ? '–' : b.hit + ' %'}</b></div></div>
     <div class="g2">
       <div class="card"><h3>Selon le score de confluence</h3><div class="tw"><table class="cmp"><thead><tr><th scope="col">Score</th><th scope="col">Cas</th><th scope="col">Moyenne</th><th scope="col">Médiane</th><th scope="col">En hausse</th></tr></thead><tbody>
         ${H.scores.slice().reverse().map(s => `<tr><th scope="row">${s.score > 0 ? '+' : s.score < 0 ? '−' : ''}${Math.abs(s.score)}</th><td>${s.n}</td><td class="${cls(s.mean)}">${pct(s.mean)}</td><td class="${cls(s.median)}">${pct(s.median)}</td><td>${s.hit == null ? '–' : s.hit + ' %'}</td></tr>`).join('')}
         </tbody></table></div>
         <p class="note">Confluence ≥ +2 : ${pct(H.up.mean)} en moyenne (${H.up.n} cas) · ≤ −2 : ${pct(H.down.mean)} (${H.down.n} cas) · écart ${pct(H.spread)}, t ${num(H.t, 1)} → ${H.verdict.label.toLowerCase()}${H.stable ? ', stable sur les deux moitiés' : ', instable d\'une moitié à l\'autre'}. À comparer à la moyenne de toutes les semaines (${pct(b.mean)}).</p></div>
       <div class="card"><h3>Lecture</h3><div id="rlRead"></div></div>
     </div>
     <div class="card"><h3>Signal par signal</h3><div class="tw"><table class="cmp rl-sig">${head}<tbody>${RL_MAIN.map(sigRow).join('')}</tbody></table></div></div>
     ${extra.length ? `<div class="card"><h3>Variantes et repères (hors confluence)</h3><div class="tw"><table class="cmp rl-sig">${head}<tbody>${extra.map(sigRow).join('')}</tbody></table></div>
       <p class="note">Williams %R sans filtre : l'ancienne règle, pour juger l'apport du filtre de tendance. Tendance : prix au-dessus (+1) ou au-dessous (−1) de sa moyenne 200 séances. COT : les autres groupes de traders possibles (TFF pour les marchés financiers) ; « à contre-sens » veut dire qu'un positionnement extrême acheteur est lu comme un signal de vente.</p></div>` : ''}`;
    // Lecture en clair : ce qui marche, ce qui ne marche pas, sur ce marché et cet horizon.
    const good = RL_MAIN.filter(k => H.signals[k] && H.signals[k].verdict.key === 'good'), bad = RL_MAIN.filter(k => H.signals[k] && H.signals[k].verdict.key === 'bad');
    const name = k => (L[k] || k).toLowerCase();
    const parts = [];
    parts.push(good.length ? `Sur ${h} séances, ${good.map(name).join(', ')} ${good.length > 1 ? 'ont' : 'a'} eu un effet net dans le bon sens${good.some(k => !H.signals[k].stable) ? ' (mais pas sur les deux moitiés de l\'historique : prudence)' : ''}.` : `Sur ${h} séances, aucun des quatre signaux n'a eu d'effet statistiquement net sur ce marché.`);
    if (bad.length) parts.push(`${bad.map(name).join(', ')} ${bad.length > 1 ? 'ont' : 'a'} plutôt fonctionné à l'envers.`);
    parts.push(H.verdict.key === 'good' ? 'La confluence forte (±2) a bien séparé les bonnes et les mauvaises semaines.' : 'La confluence forte (±2) n\'a pas séparé nettement les bonnes et les mauvaises semaines.');
    if (H.signals.wr && H.signals.wrRaw && H.signals.wr.t != null && H.signals.wrRaw.t != null) parts.push(H.signals.wr.t > H.signals.wrRaw.t ? 'Le filtre de tendance a amélioré le Williams %R.' : 'Le filtre de tendance n\'a pas amélioré le Williams %R sur ce marché.');
    $('#rlRead').innerHTML = parts.map(p => `<p>${p}</p>`).join('') + `<p class="note">Rappel : un résultat passé n'est pas une promesse, et un verdict isolé peut être dû au hasard.</p>`;
  }

  const paint = () => { summary(); detail(); };
  $('#rlGrp').onchange = e => { group = e.target.value; slug = null; paint(); };
  $('#rlH').onclick = e => { const btn = e.target.closest('button'); if (!btn) return; h = +btn.dataset.h; [...$('#rlH').children].forEach(x => { x.classList.toggle('on', x === btn); x.setAttribute('aria-pressed', x === btn); }); paint(); };
  $('#rlSum').onclick = e => { const a = e.target.closest('[data-slug]'); if (!a) return; slug = a.dataset.slug; paint(); };
  paint();
}

async function bootReliability() {
  const root = document.querySelector('#app');
  try { renderReliability(await BD.json('/api/reliability'), root); }
  catch { root.innerHTML = '<div id="msg" class="err">Données indisponibles pour le moment. Réessayez dans une minute.</div>'; }
}
if (typeof document !== 'undefined' && document.body && document.body.dataset && document.body.dataset.page === 'reliability') bootReliability();
