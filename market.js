// Valeur d'un point par contrat (spécifications CME) : contrat standard et micro, pour traduire l'ATR en dollars. À vérifier auprès de son courtier.
const CONTRACTS = { sp500: [['ES', 50], ['MES', 5]], 'nasdaq-100': [['NQ', 20], ['MNQ', 2]], 'dow-jones': [['YM', 5], ['MYM', 0.5]], 'russell-2000': [['RTY', 50], ['M2K', 5]] };
// Encadré « Amplitude moyenne du jour » (ATR 14 séances) : en points, en % du prix et, pour les indices, en dollars par contrat.
function atrBox(m, a) {
  if (!a) return '';
  const pts = v => v.toLocaleString('fr-FR', { maximumFractionDigits: v < 10 ? 4 : v < 100 ? 2 : 1 }), usd = v => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' $';
  const rows = (CONTRACTS[m.slug] || []).map(([c, pv]) => `<tr><th scope="row">${c}</th><td>${usd(a.value * pv)}</td><td>${usd(a.value * pv / 2)}</td><td>${usd(a.last * pv)}</td></tr>`).join('');
  const r = a.lastRatio == null ? '' : a.lastRatio >= 1.3 ? 'séance agitée' : a.lastRatio <= 0.7 ? 'séance calme' : 'séance normale';
  return `<div class="atr-box"><div class="atr-head"><b>Amplitude moyenne du jour</b> <small>ATR ${a.n} séances</small></div>
    <div class="atr-kpi"><span><b>${pts(a.value)}</b> points</span><span><b>${a.pct.toFixed(2).replace('.', ',')} %</b> du prix</span><span>dernière séance : <b>${pts(a.last)}</b> pts (×${a.lastRatio.toFixed(1).replace('.', ',')}, ${r})</span></div>
    ${rows ? `<div class="tw"><table class="cmp atr-t"><thead><tr><th scope="col">Contrat</th><th scope="col">1 ATR</th><th scope="col">½ ATR</th><th scope="col">Dernière séance</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="confl-note">Valeur d'un point : ES 50 $, MES 5 $, NQ 20 $, MNQ 2 $, YM 5 $, MYM 0,5 $, RTY 50 $, M2K 5 $ (spécifications CME, à vérifier auprès de votre courtier). Mesuré sur l'historique des trois indices (entrée à la clôture précédente) : un stop à une demi-ATR est touché environ 4 séances sur 10 d'un côté donné, un stop à 1 ATR environ 1 séance sur 7. Ce chiffre décrit l'agitation, pas la direction.</p>` : ''}</div>`;
}
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
      ${atrBox(m, r.atr)}
      <p class="confl-note">Repère pédagogique, pas un conseil en investissement. <a href="/screener">Voir tous les marchés →</a></p>`;
  } catch { /* panneau facultatif */ }
}
(async () => {
  let m;
  try { m = await BD.shell(); } catch { document.body.innerHTML = '<p class="pad">Erreur de chargement.</p>'; return; }
  const $ = s => document.querySelector(s);
  // Ordre d'affichage : saisonnalité, Williams %R, puis COT (chaque section se charge indépendamment).
  renderConfluence(m);
  await Promise.allSettled([renderSeasonal(m, $('#sSea')), renderWR(m, $('#sWr')), renderCot(m, $('#sCot')), renderOI(m, $('#sOi'))]);
})();
