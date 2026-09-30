(async () => {
  const $ = s => document.querySelector(s);
  let data;
  try { data = await (await fetch('/api/screener')).json(); }
  catch { $('#tbl').innerHTML = '<tbody><tr><td class="neg">Données indisponibles pour le moment.</td></tr></tbody>'; return; }
  BD.freshness(document.querySelector('#fresh'));                                          // résumé de fraîcheur (non bloquant)
  const rows = data.rows, GR = [...new Set(rows.map(r => r.group))];
  GR.forEach(g => $('#grp').add(new Option(g, g)));
  if (GR.includes('Indices')) $('#grp').value = 'Indices';                                   // catégorie par défaut du screener
  $('#upd').textContent = `Saison : ${data.week}` + (data.updated ? ` · prix mis à jour le ${new Date(data.updated).toLocaleString('fr-FR')}` : '');

  const COLS = [
    ['name', 'Actif'], ['price', 'Prix'], ['chgPct', 'Jour'], ['idx6', 'COT 6 mois'],
    ['season', `Saison ${data.week} (10 a.)`], ['oi', 'Open interest'], ['wr', 'Williams %R (14)'], ['score', 'Confluence'],
  ];
  const val = (r, k) => k === 'season' ? r.season.avgPct : k === 'oi' ? (r.oi ? r.oi.chgPct : null) : r[k];
  let sk = 'score', dir = -1;
  const WARN = ' <span title="Saut probable dû au changement de contrat (future continu non ajusté) : Williams %R non fiable pendant 14 séances" class="warn-i">⚠</span>';
  const pill = (t, c) => `<span class="sig sm ${c}">${t}</span>`;
  const cot = i => { const s = CALC.cotSignal(i); return `${i.toFixed(0)} % ${pill(CALC.cotLabel(i), s > 0 ? 'buy' : s < 0 ? 'sell' : 'wait')}`; };
  const px = v => v.toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 4 : v < 1000 ? 2 : 1 });
  const dot = BD.sigDot;                                                                       // point de signal accessible (role img + aria-label), commun avec la fiche et la comparaison

  function paint() {
    const q = $('#q').value.trim().toLowerCase(), g = $('#grp').value, b = $('#bias').value;
    const list = rows.filter(r => !r.missing && (!q || r.name.toLowerCase().includes(q)) && (!g || r.group === g)
      && (!b || CALC.confluenceClass(r.score) === (b === 'bull' ? 'buy' : b === 'bear' ? 'sell' : 'wait')));
    list.sort((a, c) => {
      const x = val(a, sk), y = val(c, sk);
      return (typeof x === 'string' ? x.localeCompare(y) : (x ?? -1e9) - (y ?? -1e9)) * dir || a.name.localeCompare(c.name);
    });
    const head = COLS.map(([k, t]) => `<th data-k="${k}" class="s ${k === sk ? 'on' : ''}">${t}${k === sk ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const body = list.map(r => {
      const z = r.wr > -20 ? ['Surachat', 'sell'] : r.wr < -80 ? ['Survente', 'buy'] : ['Neutre', 'wait'];
      const cls = CALC.confluenceClass(r.score);
      const s = r.season;
      return `<tr data-href="/market/${r.slug}"><td class="nm"><a href="/market/${r.slug}">${r.name}</a>${r.fresh !== 'ok' ? ' <span class="warn-i" role="img" title="Données à vérifier pour ce marché (voir sa fiche)" aria-label="Données à vérifier">⚠</span>' : ''}<small>${r.group}</small></td>
        <td>${px(r.price)}</td><td class="${r.chgPct >= 0 ? 'pos' : 'neg'}">${(r.chgPct > 0 ? '+' : '') + r.chgPct.toFixed(2)} %${r.roll ? WARN : ''}</td>
        <td>${cot(r.idx6)}</td>
        <td class="${s.avgPct == null ? '' : s.avgPct >= 0 ? 'pos' : 'neg'}">${s.avgPct == null ? '–' : (s.avgPct > 0 ? '+' : '') + s.avgPct.toFixed(2) + ' %'} <small>${s.up}/${s.n} hausse</small></td>
        <td class="${r.oi && r.oi.chgPct >= 0 ? 'pos' : 'neg'}">${r.oi ? (r.oi.chgPct > 0 ? '+' : '') + r.oi.chgPct.toFixed(2) + ' % ' + pill(r.oi.label, r.sig.oi > 0 ? 'buy' : r.sig.oi < 0 ? 'sell' : 'wait') : '–'}</td>
        <td>${r.wr.toFixed(1)} ${r.roll ? pill('Non fiable', 'wait') + WARN : pill(z[0], z[1])}</td>
        <td class="cf">${dot(r.sig.cot, 'COT')}${dot(r.sig.season, 'Saison')}${dot(r.sig.wr, 'Williams %R')}${dot(r.sig.oi, 'Open interest')} ${pill((r.score > 0 ? '+' : '') + r.score, cls)}</td></tr>`;
    }).join('');
    $('#tbl').innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="8">Aucun marché ne correspond.</td></tr>'}</tbody>`;
    const miss = rows.filter(r => r.missing).length, old = $('#miss');
    if (old) old.remove();
    if (miss) $('.scr-wrap').insertAdjacentHTML('afterend', `<p class="note tight" id="miss">${miss} marché(s) en cours de chargement côté serveur, réessayez dans une minute.</p>`);
  }
  $('#tbl').onclick = e => {
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a')) { location.href = tr.dataset.href; return; }
    const th = e.target.closest('th.s'); if (!th) return; const k = th.dataset.k; dir = k === sk ? -dir : (k === 'name' ? 1 : -1); sk = k; paint(); };
  ['#q', '#grp', '#bias'].forEach(s => $(s).addEventListener('input', paint));
  paint();
})();
