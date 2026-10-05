// Fiabilité des signaux (module serveur uniquement) : rejoue l'historique semaine par semaine, sans regarder le futur, et mesure ce qui a suivi.
// À chaque clôture de fin de semaine, on recalcule les signaux tels qu'ils étaient connus ce jour-là :
//  - COT : uniquement les rapports déjà publiés (positions du mardi, publiées le vendredi, plus tard en cas de jour férié) ;
//  - saisonnalité : la semaine qui commence, d'après les années antérieures uniquement ;
//  - Williams %R et tendance : à la clôture du jour ; open interest : les deux derniers rapports publiés.
// Puis on mesure la variation des 5, 10 et 20 séances suivantes, sur la série ajustée des changements de contrat quand elle existe (indices).
// Limites : échantillons qui se chevauchent (horizon de 20 séances, mesure chaque semaine), donc la significativité est corrigée en réduisant
// le nombre d'observations ; pas de coûts de transaction ; un passé favorable ne garantit rien.
const CALC = require('./calc.js');

const HORIZONS = [5, 10, 20];
const DAY = 86400;
// Sources possibles du signal COT. net(legacyRow | tffRow) ; contra : signal lu à contre-sens (extrême acheteur = signal de vente).
const COT_SOURCES = {
  legacy: { label: 'COT commerciaux (Legacy)', from: 'legacy', net: r => r[1] - r[2] },
  'tff-am': { label: 'COT asset managers (TFF)', from: 'tff', net: r => r[3] - r[4] },
  'tff-lev': { label: 'COT fonds à levier (TFF, à contre-sens)', from: 'tff', net: r => r[5] - r[6], contra: true },
  'tff-dealer': { label: 'COT dealers (TFF)', from: 'tff', net: r => r[1] - r[2] },
};

const iso = t => new Date(t * 1e3).toISOString().slice(0, 10);
const r2 = v => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);

// Historique COT d'une source : [{ date, avail (date de publication), idx6, idx36 }] (indices calculés de façon causale : fenêtre se terminant au rapport).
function cotSeries(source, legacyHist, tffHist, minRows = 30) {
  const S = COT_SOURCES[source], hist = S && (S.from === 'tff' ? tffHist : legacyHist);
  if (!hist || hist.length < minRows) return null;
  const net = hist.map(S.net), TH = CALC.THRESHOLDS;
  const i6 = CALC.cotIndex(net, TH.cotShortWeeks), i36 = CALC.cotIndex(net, TH.cotLongWeeks);
  return hist.map((r, k) => ({ date: r[0], avail: CALC.cotReleaseDate(r[0]).date, idx6: i6[k], idx36: i36[k], net: net[k] }));
}
const cotSig = (source, idx) => { const s = CALC.cotSignal(idx); return COT_SOURCES[source] && COT_SOURCES[source].contra ? -s : s; };

// Statistiques d'un ensemble de rendements (%).
function stat(v) {
  const n = v.length; if (!n) return { n: 0, mean: null, median: null, hit: null, sd: null };
  const mean = v.reduce((s, x) => s + x, 0) / n, s = v.slice().sort((a, b) => a - b);
  const sd = n > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : null;
  return { n, mean, median: n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2, hit: v.filter(x => x > 0).length / n * 100, sd };
}
// Écart entre deux groupes et sa significativité (t de Welch), avec un nombre d'observations réduit par le chevauchement des horizons.
function spreadTest(a, b, h) {
  if (a.n < 2 || b.n < 2 || a.sd == null || b.sd == null) return { spread: a.mean != null && b.mean != null ? a.mean - b.mean : null, t: null };
  const k = Math.max(1, h / 5), na = a.n / k, nb = b.n / k, se = Math.sqrt(a.sd ** 2 / na + b.sd ** 2 / nb);
  return { spread: a.mean - b.mean, t: se ? (a.mean - b.mean) / se : null };
}
const MIN_CASES = 15;
function verdict(a, b, t) {
  if (a.n < MIN_CASES || b.n < MIN_CASES) return { key: 'few', label: 'Trop peu de cas' };
  if (t == null) return { key: 'none', label: 'Non mesurable' };
  if (t >= 2) return { key: 'good', label: 'Utile' };
  if (t <= -2) return { key: 'bad', label: 'À contre-sens' };
  return { key: 'none', label: 'Non significatif' };
}
const pack = s => ({ n: s.n, mean: r2(s.mean), median: r2(s.median), hit: s.n ? Math.round(s.hit) : null });

// Rejoue un marché. rows : séries ajustées [[t, clôture, haut, bas]] ; raw : séries brutes (même dates) pour repérer les changements de contrat
// comme le fait le screener ; legacyHist / tffHist : historiques COT compacts ; cotSource : source du signal COT de la confluence ;
// seasonCap : nombre maximal d'années de saisonnalité ; crypto : pas de neutralisation des sauts.
function samples({ rows, raw = rows, legacyHist, tffHist = null, cotSource = 'legacy', seasonCap = 60, crypto = false }) {
  const n = rows ? rows.length : 0;
  if (n < 400 || !legacyHist || legacyHist.length < 30) return [];
  const TH = CALC.THRESHOLDS, T = rows.map(r => r[0]), Cl = rows.map(r => r[1]);
  // Williams %R aligné sur rows, moyenne 200 séances, comptage des séances par année (années complètes de la saisonnalité).
  const wr = new Array(n).fill(null);
  for (let i = TH.wrPeriod - 1; i < n; i++) { let hh = -Infinity, ll = Infinity; for (let j = i - TH.wrPeriod + 1; j <= i; j++) { hh = Math.max(hh, rows[j][2]); ll = Math.min(ll, rows[j][3]); } wr[i] = hh === ll ? -50 : (hh - Cl[i]) / (hh - ll) * -100; }
  const ma = CALC.sma(rows, TH.trendSma), cnt = {};
  T.forEach(t => { const y = new Date(t * 1e3).getUTCFullYear(); cnt[y] = (cnt[y] || 0) + 1; });
  const at = lim => { let lo = 0, hi = n - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m] <= lim) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
  const closeOn = d => { const k = at(Date.parse(d + 'T23:59:59Z') / 1e3); return k < 0 ? null : Cl[k]; };
  // Changement de contrat probable sur la série brute (saut > 10 % dans les 15 dernières séances) : comme le screener, Williams %R et open interest neutralisés.
  const jump = raw.map((r, i) => i > 0 && Math.abs(r[1] / raw[i - 1][1] - 1) > TH.rollJump);
  const rollAt = i => { if (crypto) return false; for (let j = Math.max(1, i - TH.rollWindow + 1); j <= i; j++) if (jump[j]) return true; return false; };

  const sources = {};
  for (const s of Object.keys(COT_SOURCES)) { const c = cotSeries(s, legacyHist, tffHist); if (c) sources[s] = c; }
  const legacy = sources.legacy, oiCol = 7;
  const monday = t => { const d = new Date(t * 1e3), w = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - w); };
  const shift = (ms, dy) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear() + dy, d.getUTCMonth(), d.getUTCDate()); };
  // Saisonnalité de la semaine qui commence le lundi `mon` (ms), d'après les années antérieures (mêmes règles que le screener).
  function seasonAt(mon) {
    const ny = new Date(mon).getUTCFullYear(), sun = mon + 6 * 864e5;
    const years = Object.keys(cnt).map(Number).filter(y => y < ny && cnt[y] > 200).sort((a, b) => a - b).slice(-seasonCap);
    const ch = [];
    for (const y of years) {
      const dy = y - ny, a = at(shift(mon, dy) / 1e3 - 1), b = at(shift(sun, dy) / 1e3 + DAY - 1);
      if (a >= 0 && b >= 0) ch.push((Cl[b] - Cl[a]) / Cl[a] * 100);
    }
    return { n: ch.length, avgPct: ch.length ? ch.reduce((s, v) => s + v, 0) / ch.length : null, up: ch.filter(v => v > 0).length };
  }

  const out = [], ptr = {};
  for (let i = 199; i < n; i++) {
    const lastOfWeek = i === n - 1 || monday(T[i + 1]) !== monday(T[i]);
    if (!lastOfWeek || i === n - 1) continue;                                 // la dernière séance n'a pas de suite à mesurer
    const day = iso(T[i]);
    // Dernier rapport publié à cette date, pour chaque source.
    const pub = {};
    for (const [s, list] of Object.entries(sources)) { let k = ptr[s] ?? -1; while (k + 1 < list.length && list[k + 1].avail <= day) k++; ptr[s] = k; if (k >= 0) pub[s] = { k, r: list[k] }; }
    if (!pub.legacy || pub.legacy.k < 1) continue;
    const season = seasonAt(monday(T[i]) + 7 * 864e5);
    if (season.n < TH.seasonMinYears) continue;
    const roll = rollAt(i);
    // Open interest : deux derniers rapports Legacy publiés, prix aux mêmes dates.
    const k = pub.legacy.k, a = legacyHist[k - 1], b = legacyHist[k];
    const pa = closeOn(a[0]), pb = closeOn(b[0]);
    const reading = CALC.oiReading(pa && pb ? (pb / pa - 1) * 100 : null, a[oiCol] ? (b[oiCol] / a[oiCol] - 1) * 100 : null);
    const sig = { season: CALC.seasonSignal(season), wr: roll ? 0 : CALC.wrTrendSignal(wr[i], Cl[i], ma[i]), wrRaw: roll ? 0 : CALC.wrSignal(wr[i]),
      oi: roll ? 0 : CALC.oiSignal(reading), trend: ma[i] == null ? 0 : Cl[i] > ma[i] ? 1 : -1 };
    for (const [s, p] of Object.entries(pub)) sig['cot:' + s] = cotSig(s, p.r.idx6);
    sig.cot = sig['cot:' + cotSource] ?? sig['cot:legacy'];
    const score = sig.cot + sig.season + sig.wr + sig.oi;
    const fwd = {};
    for (const h of HORIZONS) if (i + h < n) fwd[h] = (Cl[i + h] / Cl[i] - 1) * 100;
    out.push({ t: T[i], sig, score, fwd });
  }
  return out;
}

// Statistiques d'un marché à partir des échantillons.
const SIGNALS = ['cot', 'season', 'wr', 'oi', 'wrRaw', 'trend', 'cot:legacy', 'cot:tff-am', 'cot:tff-lev', 'cot:tff-dealer'];
function summarize(list, cotSource = 'legacy') {
  if (!list.length) return null;
  const mid = list[list.length >> 1].t, half = [list.filter(s => s.t < mid), list.filter(s => s.t >= mid)];
  const res = { from: iso(list[0].t), to: iso(list[list.length - 1].t), weeks: list.length, cotSource, horizons: {} };
  for (const h of HORIZONS) {
    const ok = list.filter(s => s.fwd[h] != null), all = stat(ok.map(s => s.fwd[h]));
    const by = f => stat(ok.filter(f).map(s => s.fwd[h]));
    const scores = [];
    for (let v = -4; v <= 4; v++) scores.push({ score: v, ...pack(by(s => s.score === v)) });
    const up = by(s => s.score >= CALC.THRESHOLDS.confluenceStrong), down = by(s => s.score <= -CALC.THRESHOLDS.confluenceStrong), mixed = by(s => Math.abs(s.score) < CALC.THRESHOLDS.confluenceStrong);
    const sp = spreadTest(up, down, h);
    const halves = half.map(hl => { const ok2 = hl.filter(s => s.fwd[h] != null), u = stat(ok2.filter(s => s.score >= 2).map(s => s.fwd[h])), d = stat(ok2.filter(s => s.score <= -2).map(s => s.fwd[h])); return u.n && d.n ? r2(u.mean - d.mean) : null; });
    const signals = {};
    for (const key of SIGNALS) {
      if (!ok.some(s => s.sig[key] != null)) continue;
      const p = by(s => s.sig[key] === 1), z = by(s => s.sig[key] === 0), m = by(s => s.sig[key] === -1), st = spreadTest(p, m, h);
      const hv = half.map(hl => { const ok2 = hl.filter(s => s.fwd[h] != null && s.sig[key] != null), a = stat(ok2.filter(s => s.sig[key] === 1).map(s => s.fwd[h])), b = stat(ok2.filter(s => s.sig[key] === -1).map(s => s.fwd[h])); return a.n && b.n ? r2(a.mean - b.mean) : null; });
      signals[key] = { plus: pack(p), zero: pack(z), minus: pack(m), spread: r2(st.spread), t: r2(st.t), verdict: verdict(p, m, st.t), halves: hv, stable: hv[0] != null && hv[1] != null && Math.sign(hv[0]) === Math.sign(hv[1]) };
    }
    res.horizons[h] = { base: pack(all), scores, up: pack(up), mixed: pack(mixed), down: pack(down), spread: r2(sp.spread), t: r2(sp.t), verdict: verdict(up, down, sp.t), halves,
      stable: halves[0] != null && halves[1] != null && Math.sign(halves[0]) === Math.sign(halves[1]), signals };
  }
  return res;
}

const LABELS = { cot: 'COT (signal de la confluence)', season: 'Saisonnalité de la semaine', wr: 'Williams %R filtré par la tendance', oi: 'Open interest',
  wrRaw: 'Williams %R sans filtre (ancienne règle)', trend: 'Tendance : prix au-dessus / au-dessous de la moyenne 200 séances',
  ...Object.fromEntries(Object.entries(COT_SOURCES).map(([k, v]) => ['cot:' + k, v.label])) };

module.exports = { HORIZONS, COT_SOURCES, LABELS, SIGNALS, cotSeries, cotSig, samples, summarize, stat, spreadTest, verdict };
