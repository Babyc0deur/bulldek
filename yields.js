// Rendements américains, courbe, taux réels, anticipations d'inflation, VIX, inflation PCE et indice dollar : séries de FRED
// (Réserve fédérale de Saint-Louis, CSV public sans clé). Ce module ne fait aucun appel réseau : adresse, analyse de la
// réponse, variations et corrélations avec le prix d'un marché.
const FRED = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
const SERIES = { DGS2: 'us2y', DGS5: 'us5y', DGS10: 'us10y', DGS30: 'us30y', T10Y2Y: 'curve', DFII10: 'real10y', T10YIE: 'breakeven', VIXCLS: 'vix', VXVCLS: 'vix3m',
  PCEPI: 'pceLevel', PCEPILFE: 'pceCoreLevel', DTWEXBGS: 'dxy' };                          // PCE et cœur PCE : indices, la variation sur un an est calculée ci-dessous ; FRED ne fournit pas directement le pourcentage via cette adresse
const IDS = Object.keys(SERIES);
// Plusieurs séries dans une même requête renvoient un fichier ZIP : une requête par série (12 au total, une fois toutes les 6 h).
const yieldsUrls = (now = Date.now(), years = 6) => IDS.map(id => [SERIES[id], `${FRED}?id=${id}&cosd=${new Date(now).getUTCFullYear() - years}-01-01`]);

// CSV « observation_date,ID » ; valeurs manquantes notées « . » ou vides → [[« AAAA-MM-JJ », valeur], …]
function parseSeries(text, id) {
  const lines = String(text).trim().split(/\r?\n/), head = lines[0].split(',');
  if (head.length !== 2 || !/^(observation_date|date)$/i.test(head[0]) || (id && head[1] !== id)) throw new Error('réponse FRED inattendue');
  const out = [];
  for (const l of lines.slice(1)) { const c = l.split(','), v = parseFloat(c[1]); if (/^\d{4}-\d{2}-\d{2}$/.test(c[0]) && isFinite(v)) out.push([c[0], Math.round(v * 10000) / 10000]); }
  if (!out.length) throw new Error('FRED : série vide');
  return out;
}
const ID_OF = Object.fromEntries(Object.entries(SERIES).map(([id, k]) => [k, id]));
// Variation sur un an d'une série mensuelle en niveau (indice) : [[date, %]]. Cherche la même date un an plus tôt (les séries FRED
// mensuelles tombent toutes le 1er du mois, donc la correspondance exacte fonctionne) ; absente → ce mois n'est pas inclus.
function yoyFromIndex(series) {
  const byDate = new Map(series);
  return series.map(([d, v]) => {
    const dt = new Date(d + 'T00:00:00Z'); dt.setUTCFullYear(dt.getUTCFullYear() - 1);
    const p = byDate.get(dt.toISOString().slice(0, 10));
    return p == null ? null : [d, Math.round((v / p - 1) * 100000) / 1000];
  }).filter(Boolean);
}
// parts : [[clé, texte CSV], …] → { us2y: [[date, valeur], …], …, pceYoy, pceCoreYoy calculées à partir des niveaux }
function parseYields(parts) {
  const out = Object.fromEntries(parts.map(([key, text]) => [key, parseSeries(text, ID_OF[key])]));
  if (out.pceLevel) out.pceYoy = yoyFromIndex(out.pceLevel);
  if (out.pceCoreLevel) out.pceCoreYoy = yoyFromIndex(out.pceCoreLevel);
  return out;
}

const lastOf = s => (s && s.length ? s[s.length - 1] : null);
// Dernière valeur et variation sur n observations.
function change(series, n) {
  const l = lastOf(series), b = series && series.length > n ? series[series.length - 1 - n] : null;
  return l ? { date: l[0], value: l[1], delta: b ? Math.round((l[1] - b[1]) * 10000) / 10000 : null } : null;
}

// Corrélation entre les variations quotidiennes d'une série (différence, en points) et le rendement du marché (en %) sur les `window` dernières
// séances communes. `daily` : [t en secondes, clôture, …] ; `corr` : CALC.correlation. Renvoie { r, n } ou null si trop peu de données.
function assetCorrelation(daily, series, corr, window = 60) {
  if (!daily || !series) return null;
  const sv = new Map(series), pairs = [];
  let prev = null;
  for (const d of daily) {
    const date = new Date(d[0] * 1e3).toISOString().slice(0, 10), v = sv.get(date);
    if (v == null) continue;
    if (prev) pairs.push([d[0], (d[1] / prev.close - 1) * 100, v - prev.v]);
    prev = { close: d[1], v };
  }
  const w = pairs.slice(-window), r = w.length >= 20 ? corr(w) : null;
  return r == null ? null : { r, n: w.length };
}
const strength = r => { const a = Math.abs(r); return a >= 0.6 ? 'forte' : a >= 0.3 ? 'modérée' : 'faible'; };

module.exports = { SERIES, yieldsUrls, parseSeries, parseYields, yoyFromIndex, change, assetCorrelation, strength, lastOf };
