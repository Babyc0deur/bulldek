// Fiabilité mesurée de la confluence (module serveur uniquement) : rejoue l'historique semaine par semaine, sans regarder le futur, et mesure ce qui a suivi.
// Chaque vendredi soir (dernière séance de la semaine), la confluence est recalculée avec ce qui était connu ce jour-là :
//  - COT : seulement les rapports déjà publiés (positions du mardi, publiées le vendredi, plus tard en cas de jour férié) ;
//  - saisonnalité de la semaine qui commence, d'après les années antérieures uniquement ;
//  - Williams %R filtré par la tendance (moyenne 200 séances) ; open interest : les deux derniers rapports publiés.
// On compare ensuite avec le prix 5 séances plus tard. Résultat par marché : quand la confluence était haussière (≥ +2), part des semaines où le marché était plus haut
// 5 séances après ; quand elle était baissière (≤ −2), part où il était plus bas ; et la référence (toutes les semaines).
// Limites : ni frais ni glissement ; un passé favorable ne garantit rien ; un test par marché, donc quelques résultats flatteurs apparaissent par hasard.
const CALC = require('./calc.js'), { cotSeries, cotSig } = require('./cotsource.js');

const HORIZON = 5, DAY = 86400, MIN_WEEKS = 30;
const iso = t => new Date(t * 1e3).toISOString().slice(0, 10);
const pct = (k, n) => (n ? Math.round(k / n * 1000) / 10 : null);

// rows : séries ajustées [[t, clôture, haut, bas]] ; raw : séries brutes (même dates) pour repérer les changements de contrat comme le screener ;
// legacyHist : historique COT Legacy compact ; cotSource : source du signal COT (legacy par défaut) ; tffHist : historique TFF (si la source en dépend).
function samples({ rows, raw = rows, legacyHist, tffHist = null, cotSource = 'legacy', seasonCap = 60, crypto = false }) {
  const n = rows ? rows.length : 0;
  if (n < 400 || !legacyHist || legacyHist.length < 30) return [];
  const TH = CALC.THRESHOLDS, T = rows.map(r => r[0]), Cl = rows.map(r => r[1]);
  const wr = new Array(n).fill(null);
  for (let i = TH.wrPeriod - 1; i < n; i++) { let hh = -Infinity, ll = Infinity; for (let j = i - TH.wrPeriod + 1; j <= i; j++) { hh = Math.max(hh, rows[j][2]); ll = Math.min(ll, rows[j][3]); } wr[i] = hh === ll ? -50 : (hh - Cl[i]) / (hh - ll) * -100; }
  const ma = CALC.sma(rows, TH.trendSma), cnt = {};
  T.forEach(t => { const y = new Date(t * 1e3).getUTCFullYear(); cnt[y] = (cnt[y] || 0) + 1; });
  const at = lim => { let lo = 0, hi = n - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m] <= lim) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
  const closeOn = d => { const k = at(Date.parse(d + 'T23:59:59Z') / 1e3); return k < 0 ? null : Cl[k]; };
  const jump = raw.map((r, i) => i > 0 && Math.abs(r[1] / raw[i - 1][1] - 1) > TH.rollJump);
  const rollAt = i => { if (crypto) return false; for (let j = Math.max(1, i - TH.rollWindow + 1); j <= i; j++) if (jump[j]) return true; return false; };

  const cot = cotSeries(cotSource, legacyHist, tffHist) || cotSeries('legacy', legacyHist, tffHist), src = cotSeries(cotSource, legacyHist, tffHist) ? cotSource : 'legacy';
  const legacy = cotSeries('legacy', legacyHist, tffHist), oiCol = 7;
  if (!cot || !legacy) return [];
  const monday = t => { const d = new Date(t * 1e3), w = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - w); };
  const shift = (ms, dy) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear() + dy, d.getUTCMonth(), d.getUTCDate()); };
  function seasonAt(mon) {
    const ny = new Date(mon).getUTCFullYear(), sun = mon + 6 * 864e5;
    const years = Object.keys(cnt).map(Number).filter(y => y < ny && cnt[y] > 200).sort((a, b) => a - b).slice(-seasonCap), ch = [];
    for (const y of years) { const dy = y - ny, a = at(shift(mon, dy) / 1e3 - 1), b = at(shift(sun, dy) / 1e3 + DAY - 1); if (a >= 0 && b >= 0) ch.push((Cl[b] - Cl[a]) / Cl[a] * 100); }
    return { n: ch.length, avgPct: ch.length ? ch.reduce((s, v) => s + v, 0) / ch.length : null, up: ch.filter(v => v > 0).length };
  }

  const out = []; let pc = -1, pl = -1;
  for (let i = 199; i < n - 1; i++) {
    if (monday(T[i + 1]) === monday(T[i]) || i + HORIZON >= n) continue;                       // dernière séance de la semaine, avec 5 séances de suite à mesurer
    const day = iso(T[i]);
    while (pc + 1 < cot.length && cot[pc + 1].avail <= day) pc++;
    while (pl + 1 < legacy.length && legacy[pl + 1].avail <= day) pl++;
    if (pc < 0 || pl < 1) continue;
    const season = seasonAt(monday(T[i]) + 7 * 864e5);
    if (season.n < TH.seasonMinYears) continue;
    const roll = rollAt(i), a = legacyHist[pl - 1], b = legacyHist[pl], pa = closeOn(a[0]), pb = closeOn(b[0]);
    const reading = CALC.oiReading(pa && pb ? (pb / pa - 1) * 100 : null, a[oiCol] ? (b[oiCol] / a[oiCol] - 1) * 100 : null);
    const score = cotSig(src, cot[pc].idx6) + CALC.seasonSignal(season) + (roll ? 0 : CALC.wrTrendSignal(wr[i], Cl[i], ma[i])) + (roll ? 0 : CALC.oiSignal(reading));
    out.push({ t: T[i], score, fwd: (Cl[i + HORIZON] / Cl[i] - 1) * 100 });
  }
  return out;
}

// Résumé : { weeks, from, to, base: { up, down }, up: { n, up, down }, down: { n, up, down } } (pourcentages de semaines).
function summarize(list) {
  if (!list.length) return null;
  const share = g => ({ n: g.length, up: pct(g.filter(x => x.fwd > 0).length, g.length), down: pct(g.filter(x => x.fwd < 0).length, g.length) });
  const th = CALC.THRESHOLDS.confluenceStrong, all = share(list);
  return { weeks: list.length, from: iso(list[0].t), to: iso(list[list.length - 1].t), horizon: HORIZON, base: { up: all.up, down: all.down },
    bull: share(list.filter(x => x.score >= th)), bear: share(list.filter(x => x.score <= -th)), minWeeks: MIN_WEEKS };
}

module.exports = { HORIZON, MIN_WEEKS, samples, summarize };
