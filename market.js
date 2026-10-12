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
    fillConfluenceAccuracy(m.slug, r, box);
  } catch { /* panneau facultatif */ }
}
// Fiabilité mesurée de la confluence sur ce marché (rejeu sans regarder le futur, calculé par le serveur) : ajoutée sous le panneau dès qu'elle est prête.
async function fillConfluenceAccuracy(slug, r, box) {
  const th = CALC.THRESHOLDS.confluenceStrong, p = v => String(v).replace('.', ',');
  for (let i = 0; i < 90; i++) {
    let d; try { d = await (await fetch('/api/confluence-check')).json(); } catch { return; }
    if (d && d.markets) {
      const c = d.markets[slug]; if (!c) return;
      const min = d.minWeeks || 30, ok = g => g && g.n >= min, eb = ok(c.bull) ? c.bull.up - c.base.up : null, ed = ok(c.bear) ? c.bear.down - c.base.down : null;
      const part = (g, own, base, label, verb) => ok(g) ? `${label} : ${verb} dans <b>${p(own)} %</b> des cas (${g.n} semaines ; toutes les semaines : ${p(base)} %)` : `${label} : trop peu de semaines pour mesurer (${g ? g.n : 0})`;
      const notes = [];
      if (ok(c.bear) && c.bear.down < c.base.down) notes.push('les semaines baissières ont baissé moins souvent que la moyenne des semaines');
      if ((eb == null || eb < 5) && (ed == null || ed < 5) && (eb != null || ed != null)) notes.push('l\'écart avec la moyenne reste faible : ce score dit peu de choses sur la semaine à venir');
      box.innerHTML += `<p class="confl-note cf-acc2"><b>Fiabilité mesurée sur ce marché</b> (rejeu sans regarder le futur, ${c.from.slice(0, 4)}-${c.to.slice(0, 4)}, ${c.weeks} semaines, résultat ${d.horizon} séances plus tard) : ${part(c.bull, c.bull.up, c.base.up, 'confluence haussière (≥ +2)', 'marché plus haut')} · ${part(c.bear, c.bear.down, c.base.down, 'confluence baissière (≤ −2)', 'marché plus bas')}.${notes.length ? ' ' + notes.map(n => 'À retenir : ' + n + '.').join(' ') : ''}</p>`;
      return;
    }
    if (!d || !d.loading) return;
    await new Promise(r => setTimeout(r, 2000));
  }
}
(async () => {
  let m;
  try { m = await BD.shell(); } catch { document.body.innerHTML = '<p class="pad">Erreur de chargement.</p>'; return; }
  const $ = s => document.querySelector(s);
  // Ordre d'affichage : saisonnalité, Williams %R, puis COT (chaque section se charge indépendamment).
  renderConfluence(m);
  await Promise.allSettled([renderSeasonal(m, $('#sSea')), renderWR(m, $('#sWr')), renderCot(m, $('#sCot')), renderOI(m, $('#sOi'))]);
})();
