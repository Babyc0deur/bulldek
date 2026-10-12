// Réaction historique des indices aux grandes annonces (module serveur uniquement) : ce qu'ont fait ES, NQ et YM les jours d'inflation (CPI),
// d'emploi (NFP) et de décision de la Fed (FOMC).
// Pour chaque jour d'annonce où le marché a coté : variation de la séance (clôture contre clôture précédente) et amplitude (plus haut − plus bas,
// rapportée à la clôture précédente). Comparaison avec les séances ordinaires de la même période (hors jours d'annonce) : l'annonce agite-t-elle
// le marché plus que d'habitude ? Séries ajustées des changements de contrat.
const KINDS = { cpi: 'Inflation (CPI)', nfp: 'Emploi (NFP)', fomc: 'Décision de la Fed (FOMC)' };
const TAGS = ['ES', 'NQ', 'YM'];
const r2 = v => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
const iso = t => new Date(t * 1e3).toISOString().slice(0, 10);

// series : { ES: rows, NQ: rows, YM: rows } ([[t (s), clôture, haut, bas]]) ; dates : { cpi: [...], nfp: [...], fomc: [...] } (AAAA-MM-JJ, « * » toléré).
// Renvoie { kinds: { cpi: { label, from, to, ES: {...}, NQ, YM }, … } } avec, par indice : n, variation moyenne et médiane, mouvement moyen (valeur absolue),
// part de hausses, amplitude moyenne, et rapports à une séance ordinaire (amplitude, mouvement), plus la dernière annonce.
function reactions(series, dates) {
  const all = new Set(), clean = {};
  for (const [k, list] of Object.entries(dates)) { clean[k] = [...new Set((list || []).map(d => String(d).slice(0, 10)))].sort(); clean[k].forEach(d => all.add(d)); }
  const out = { kinds: {} };
  for (const k of Object.keys(KINDS)) out.kinds[k] = { label: KINDS[k] };
  for (const tag of TAGS) {
    const rows = series[tag] || []; if (rows.length < 30) continue;
    const at = new Map(rows.map((r, i) => [iso(r[0]), i]));
    const day = i => ({ chg: (rows[i][1] / rows[i - 1][1] - 1) * 100, range: (rows[i][2] - rows[i][3]) / rows[i - 1][1] * 100 });
    for (const k of Object.keys(KINDS)) {
      const idx = clean[k].map(d => at.get(d)).filter(i => i != null && i > 0);
      if (!idx.length) continue;
      const from = idx[0], ev = idx.map(day);
      // Séances ordinaires : même période, hors jours d'annonce (toutes catégories confondues).
      const base = []; for (let i = Math.max(1, from); i < rows.length; i++) if (!all.has(iso(rows[i][0]))) base.push(day(i));
      const mean = (v, f) => v.reduce((s, x) => s + f(x), 0) / v.length, sorted = ev.map(x => x.chg).sort((a, b) => a - b);
      const baseRange = mean(base, x => x.range), baseAbs = mean(base, x => Math.abs(x.chg)), lastI = idx.at(-1);
      const s = { n: ev.length, meanChg: r2(mean(ev, x => x.chg)), medianChg: r2(sorted[sorted.length >> 1]), meanAbs: r2(mean(ev, x => Math.abs(x.chg))),
        up: Math.round(ev.filter(x => x.chg > 0).length / ev.length * 100), meanRange: r2(mean(ev, x => x.range)),
        rangeRatio: r2(mean(ev, x => x.range) / baseRange), absRatio: r2(mean(ev, x => Math.abs(x.chg)) / baseAbs),
        baseRange: r2(baseRange), last: { date: iso(rows[lastI][0]), ...Object.fromEntries(Object.entries(day(lastI)).map(([a, v]) => [a, r2(v)])) } };
      out.kinds[k][tag] = s;
      const K = out.kinds[k]; K.from = !K.from || iso(rows[from][0]) < K.from ? iso(rows[from][0]) : K.from; K.to = !K.to || s.last.date > K.to ? s.last.date : K.to;
    }
  }
  return out;
}

module.exports = { KINDS, TAGS, reactions };
