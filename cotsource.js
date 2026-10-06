// Source du signal COT de la confluence (module serveur uniquement) : rapport Legacy (commerciaux) par défaut, ou un groupe du rapport TFF.
// COT_SOURCES : net(ligne d'historique compact) ; contra : signal lu à contre-sens (extrême acheteur = signal de vente).
const CALC = require('./calc.js');

const COT_SOURCES = {
  legacy: { label: 'COT commerciaux (Legacy)', from: 'legacy', net: r => r[1] - r[2] },
  'tff-am': { label: 'COT asset managers (TFF)', from: 'tff', net: r => r[3] - r[4] },
  'tff-lev': { label: 'COT fonds à levier (TFF, à contre-sens)', from: 'tff', net: r => r[5] - r[6], contra: true },
  'tff-dealer': { label: 'COT dealers (TFF)', from: 'tff', net: r => r[1] - r[2] },
};

// Historique COT d'une source : [{ date, avail (date de publication), idx6, idx36, net }] (indices calculés de façon causale : fenêtre se terminant au rapport).
function cotSeries(source, legacyHist, tffHist, minRows = 30) {
  const S = COT_SOURCES[source], hist = S && (S.from === 'tff' ? tffHist : legacyHist);
  if (!hist || hist.length < minRows) return null;
  const net = hist.map(S.net), TH = CALC.THRESHOLDS;
  const i6 = CALC.cotIndex(net, TH.cotShortWeeks), i36 = CALC.cotIndex(net, TH.cotLongWeeks);
  return hist.map((r, k) => ({ date: r[0], avail: CALC.cotReleaseDate(r[0]).date, idx6: i6[k], idx36: i36[k], net: net[k] }));
}
const cotSig = (source, idx) => { const s = CALC.cotSignal(idx); return COT_SOURCES[source] && COT_SOURCES[source].contra ? -s : s; };

module.exports = { COT_SOURCES, cotSeries, cotSig };
