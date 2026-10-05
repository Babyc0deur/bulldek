// Volatilité des actions américaines (module serveur uniquement) : VIX, VIX à 3 mois (structure), volatilité réalisée du S&P 500.
// vix, vix3m : séries FRED [[« AAAA-MM-JJ », valeur]] ; spx : séances quotidiennes [[t (s), clôture, …]] (série ajustée des changements de contrat).
// Lecture :
//  - niveau du VIX : < 15 calme, 15-20 normal, 20-30 tendu, > 30 stress ; rang sur 1 an (0 % = plus bas de l'année, 100 % = plus haut) ;
//  - structure : VIX / VIX 3 mois. En temps normal, la volatilité attendue à 1 mois est inférieure à celle à 3 mois (ratio < 1, « normale »).
//    Un ratio ≥ 1 (« inversée ») signale une inquiétude immédiate : historiquement, c'est l'état des phases de stress (2008, 2020, 2022…) ;
//  - prime de volatilité : VIX moins volatilité réalisée sur 20 séances. Positive en temps normal (on paie une assurance) ; négative quand
//    le marché bouge plus que ce que les options anticipaient.
const r1 = v => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = v => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);

// Volatilité réalisée annualisée (%) des n dernières séances : écart-type des rendements logarithmiques × √252.
function realized(rows, n = 20) {
  if (!rows || rows.length < n + 1) return null;
  const r = []; for (let i = rows.length - n; i < rows.length; i++) r.push(Math.log(rows[i][1] / rows[i - 1][1]));
  const m = r.reduce((s, x) => s + x, 0) / n, v = r.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1);
  return Math.sqrt(v * 252) * 100;
}
const level = v => (v < 15 ? { key: 'calm', label: 'calme' } : v < 20 ? { key: 'normal', label: 'normal' } : v < 30 ? { key: 'tense', label: 'tendu' } : { key: 'stress', label: 'stress' });
const structure = ratio => (ratio == null ? null : ratio >= 1 ? { key: 'inverted', label: 'inversée' } : ratio >= 0.95 ? { key: 'flat', label: 'presque plate' } : { key: 'normal', label: 'normale' });

function volatility({ vix, vix3m, spx }) {
  if (!vix || !vix.length) return null;
  const [date, last] = vix[vix.length - 1];
  const prev5 = vix.length > 5 ? vix[vix.length - 6][1] : null;
  const year = vix.filter(([d]) => d > String(+date.slice(0, 4) - 1) + date.slice(4)).map(x => x[1]);
  const rank = year.length > 20 ? Math.round(year.filter(v => v <= last).length / year.length * 100) : null;
  const v3 = vix3m && vix3m.length ? vix3m[vix3m.length - 1] : null;
  const ratio = v3 && v3[1] ? last / v3[1] : null, st = structure(ratio);
  const rv20 = realized(spx, 20), rv60 = realized(spx, 60), premium = rv20 == null ? null : last - rv20, lv = level(last);
  const f = v => String(r1(v)).replace('.', ',');
  const parts = [`Le VIX est à ${f(last)} (${lv.label})${rank != null ? `, ${rank} % de sa fourchette sur 1 an` : ''}${prev5 != null ? `, ${last >= prev5 ? 'en hausse' : 'en baisse'} de ${f(Math.abs(last - prev5))} point${Math.abs(last - prev5) >= 2 ? 's' : ''} sur 5 séances` : ''}.`];
  if (st) parts.push(st.key === 'inverted' ? `La structure est inversée (VIX / VIX 3 mois = ${String(r2(ratio)).replace('.', ',')}) : le marché paie plus cher la protection immédiate que celle à 3 mois, signe d'une inquiétude à court terme, typique des phases de stress.`
    : st.key === 'flat' ? `La structure est presque plate (ratio ${String(r2(ratio)).replace('.', ',')}) : l'écart habituel entre court et moyen terme s'est réduit, la nervosité monte.`
    : `La structure est normale (ratio ${String(r2(ratio)).replace('.', ',')}) : la volatilité attendue à 1 mois reste sous celle à 3 mois, pas de stress immédiat.`);
  if (rv20 != null) parts.push(premium >= 0 ? `Le S&P 500 a bougé à un rythme de ${f(rv20)} % annualisé sur 20 séances, moins que ce qu'anticipe le VIX (prime de ${f(premium)} points) : situation habituelle.`
    : `Le S&P 500 a bougé à un rythme de ${f(rv20)} % annualisé sur 20 séances, plus que ce qu'anticipe le VIX : le marché est plus agité que prévu.`);
  return { date, vix: r2(last), chg5: prev5 == null ? null : r2(last - prev5), rank, level: lv, vix3m: v3 ? r2(v3[1]) : null, ratio: r2(ratio), structure: st,
    rv20: r1(rv20), rv60: r1(rv60), premium: r1(premium), reading: parts.join(' ') };
}

module.exports = { realized, level, structure, volatility };
