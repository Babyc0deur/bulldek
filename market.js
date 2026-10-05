// Panneau de confluence : mêmes calculs que le screener (API /api/screener), un seul endroit pour les formules.
async function renderConfluence(m) {
  const box = document.getElementById('confl');
  try {
    const d = await (await fetch('/api/screener')).json(), r = d.rows.find(x => x.slug === m.slug);
    if (!r || r.missing) return;
    const cls = s => s > 0 ? 'up' : s < 0 ? 'dn' : 'nt', txt = s => s > 0 ? 'haussier' : s < 0 ? 'baissier' : 'neutre';
    const zone = r.wr > -20 ? 'surachat' : r.wr < -80 ? 'survente' : 'neutre', se = r.season;
    const tot = { buy: ['buy', 'Haussière'], sell: ['sell', 'Baissière'], wait: ['wait', 'Mixte'] }[CALC.confluenceClass(r.score)];
    const item = (href, s, label, main, sub) => `<a class="ci" href="${href}"><i class="dot ${cls(s)}"></i><span><small>${label}</small><b>${main}</b><em>${sub}</em></span></a>`;
    box.innerHTML = `<div class="confl-head"><b>Confluence</b><span class="sig ${tot[0]}">${(r.score > 0 ? '+' : '') + r.score} · ${tot[1]}</span>
        <small>COT + saisonnalité + Williams %R + open interest</small></div>
      <div class="confl-items">
        ${item('#sCot', r.sig.cot, 'COT · index 6 mois', CALC.cotLabel(r.idx6) + ' (' + r.idx6.toFixed(0) + ' %)', 'Signal ' + txt(r.sig.cot))}
        ${item('#sSea', r.sig.season, 'Saison · ' + d.week, (se.avgPct == null ? '–' : (se.avgPct > 0 ? '+' : '') + se.avgPct.toFixed(2) + ' %') + ' en moyenne', se.up + '/' + se.n + ' années hausse · ' + txt(r.sig.season))}
        ${item('#sWr', r.sig.wr, 'Williams %R (14 j)', r.wr.toFixed(1) + ' · ' + (r.roll ? 'non fiable ⚠' : zone), r.roll ? 'Changement de contrat récent' : (r.wrZone && !r.sig.wr ? 'Contre la tendance (moyenne 200 séances) : ignoré' : 'Signal ' + txt(r.sig.wr)) + (r.trend ? ' · tendance ' + (r.trend.up ? 'haussière' : 'baissière') : ''))}
        ${item('#sOi', r.sig.oi, 'Open interest · semaine', r.oi ? (r.oi.chgPct > 0 ? '+' : '') + r.oi.chgPct.toFixed(2) + ' %' : '–', r.oi ? r.oi.label + ' · ' + (r.roll ? 'neutralisé (changement de contrat)' : 'Signal ' + txt(r.sig.oi)) : 'Indisponible')}
      </div>
      <p class="confl-note">Repère pédagogique, pas un conseil en investissement. <a href="/screener">Voir tous les marchés →</a></p>`;
  } catch { /* panneau facultatif */ }
}
(async () => {
  let m;
  try { m = await BD.shell(); } catch { document.body.innerHTML = '<p class="pad">Erreur de chargement.</p>'; return; }
  const $ = s => document.querySelector(s);
  // Ordre d'affichage : saisonnalité, Williams %R, puis COT (chaque section se charge indépendamment).
  renderConfluence(m);
  await Promise.allSettled([renderDebrief(m, $('#sDeb')), renderSeasonal(m, $('#sSea')), renderWR(m, $('#sWr')), renderCot(m, $('#sCot')), renderOI(m, $('#sOi'))]);
})();
