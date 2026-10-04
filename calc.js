// Formules de l'application (COT Index, Williams %R, saisonnalité, signaux).
// Un seul fichier, utilisé par le serveur (screener), par les pages et par les tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CALC = factory();
})(this, function () {
  // COT Index : position de chaque valeur dans la fourchette min-max des w dernières valeurs (0-100).
  function cotIndex(values, w) {
    return values.map((v, i) => {
      let lo = Infinity, hi = -Infinity;
      for (let j = Math.max(0, i - w + 1); j <= i; j++) { lo = Math.min(lo, values[j]); hi = Math.max(hi, values[j]); }
      return hi === lo ? 50 : (v - lo) / (hi - lo) * 100;
    });
  }

  // Williams %R sur n séances. rows = [[t, clôture, plus haut, plus bas], ...] du plus ancien au plus récent.
  // Renvoie [[t, %R]] (de −100 à 0) à partir de la n-ième séance.
  function williamsR(rows, n = 14) {
    const out = [];
    for (let i = n - 1; i < rows.length; i++) {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, rows[j][2]); ll = Math.min(ll, rows[j][3]); }
      out.push([rows[i][0], hh === ll ? -50 : (hh - rows[i][1]) / (hh - ll) * -100]);
    }
    return out;
  }

  // Saisonnalité de la semaine calendaire en cours (lundi−dimanche) : variation moyenne entre la clôture de la veille
  // du lundi et celle du dimanche (ou la dernière séance connue avant), sur les mêmes dates calendaires les nYears
  // années précédentes. rows = [[t, clôture, ...]] ; now = date de référence (UTC), sert à situer la semaine.
  function seasonalWeek(rows, now, nYears, nowYear) {
    const dow = (now.getUTCDay() + 6) % 7;                              // 0 = lundi … 6 = dimanche
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
    const sunday = new Date(+monday + 6 * 864e5);
    const shift = (d, dy) => new Date(Date.UTC(d.getUTCFullYear() + dy, d.getUTCMonth(), d.getUTCDate()));
    const iso = d => d.toISOString().slice(0, 10);
    const cnt = {};
    rows.forEach(r => { const y = new Date(r[0] * 1e3).getUTCFullYear(); cnt[y] = (cnt[y] || 0) + 1; });
    const years = Object.keys(cnt).map(Number).filter(y => y < nowYear && cnt[y] > 200).sort((a, b) => a - b).slice(-nYears);
    const ch = years.map(y => {
      const dy = y - nowYear, mon = shift(monday, dy), sun = shift(sunday, dy);
      const a = closeOnOrBefore(rows, iso(new Date(+mon - 864e5))), b = closeOnOrBefore(rows, iso(sun));
      return a == null || b == null ? null : { pts: b - a, pct: (b - a) / a * 100 };
    }).filter(Boolean);
    const avg = k => ch.length ? ch.reduce((s, c) => s + c[k], 0) / ch.length : null;
    return { n: ch.length, avgPts: avg('pts'), avgPct: avg('pct'), up: ch.filter(c => c.pts > 0).length };
  }

  // Saisonnalité journalière : variation de la séance du même jour du calendrier (mois + jour) sur les nYears dernières années complètes.
  // target : date ISO (aaaa-mm-jj) de la séance visée. Seules comptent les années où le marché a coté ce jour-là (pas un week-end ni un jour férié) ;
  // la variation est celle de la clôture de ce jour contre la clôture de la séance précédente.
  function seasonalDay(rows, target, nYears, nowYear) {
    const md = target.slice(5), cnt = {}, at = new Map();
    rows.forEach((r, i) => { const d = new Date(r[0] * 1e3), y = d.getUTCFullYear(); cnt[y] = (cnt[y] || 0) + 1; at.set(d.toISOString().slice(0, 10), i); });
    const years = Object.keys(cnt).map(Number).filter(y => y < nowYear && cnt[y] > 200).sort((a, b) => a - b).slice(-nYears);
    const ch = years.map(y => { const i = at.get(y + '-' + md); return i == null || i < 1 ? null : { pts: rows[i][1] - rows[i - 1][1], pct: (rows[i][1] / rows[i - 1][1] - 1) * 100 }; }).filter(Boolean);
    const avg = k => ch.length ? ch.reduce((s, c) => s + c[k], 0) / ch.length : null;
    return { n: ch.length, avgPts: avg('pts'), avgPct: avg('pct'), up: ch.filter(c => c.pts > 0).length };
  }

  // Seuils et paramètres de l'application : source unique. La page « À propos » les affiche depuis ici (le serveur les injecte),
  // si bien que la méthodologie publiée ne peut pas contredire le code.
  const THRESHOLDS = {
    cotBuy: 80, cotSell: 20,                        // COT Index (%) : ≥ 80 achat, ≤ 20 vente, sinon patience
    wrHigh: -20, wrLow: -80, wrPeriod: 14,          // Williams %R : > −20 surachat, < −80 survente ; période de 14 séances ou semaines
    seasonMinYears: 5, seasonHitRate: 0.6,          // saisonnalité : au moins 5 années complètes, 60 % d'années dans le même sens
    cotShortWeeks: 26, cotLongWeeks: 156,           // fenêtres du COT Index : 6 mois et 36 mois (en semaines)
    rollJump: 0.10, rollWindow: 15,                 // saut quotidien de plus de 10 % dans les 15 dernières séances : changement de contrat probable
    oiFlatPct: 0.5, priceFlatPct: 0.5,               // open interest / prix : variation hebdomadaire inférieure à 0,5 % = stable (pas de lecture)
    confluenceStrong: 2,                            // confluence (somme des 4 signaux, de −4 à +4) : ≥ +2 haussière, ≤ −2 baissière
  };
  // Signaux : +1 haussier, −1 baissier, 0 neutre.
  const cotSignal = idx => idx == null ? 0 : idx >= THRESHOLDS.cotBuy ? 1 : idx <= THRESHOLDS.cotSell ? -1 : 0;
  const wrSignal = v => v == null ? 0 : v < THRESHOLDS.wrLow ? 1 : v > THRESHOLDS.wrHigh ? -1 : 0;                 // survente = rebond, surachat = repli
  const seasonSignal = s => {                                                            // moyenne et régularité de la semaine
    if (!s || s.n < THRESHOLDS.seasonMinYears || s.avgPct == null) return 0;
    if (s.avgPct > 0 && s.up / s.n >= THRESHOLDS.seasonHitRate) return 1;
    if (s.avgPct < 0 && (s.n - s.up) / s.n >= THRESHOLDS.seasonHitRate) return -1;
    return 0;
  };
  // Confluence = somme des quatre signaux (−4 à +4) : classe d'affichage buy (haussière), sell (baissière) ou wait (mixte).
  const confluenceClass = score => score >= THRESHOLDS.confluenceStrong ? 'buy' : score <= -THRESHOLDS.confluenceStrong ? 'sell' : 'wait';
  // Signal de l'open interest : seules les lectures « confirmées » comptent (prix et open interest dans le même sens de tendance).
  const oiSignal = reading => !reading ? 0 : reading.key === 'trend-up' ? 1 : reading.key === 'trend-down' ? -1 : 0;
  const cotLabel = idx => idx >= THRESHOLDS.cotBuy ? 'Achat' : idx <= THRESHOLDS.cotSell ? 'Vente' : 'Patience';

  // ---- Rapport de saisonnalité complet (courbes annuelles, mois en cours, tableaux mensuel / hebdomadaire / journalier) ----
  // rows = [[t, clôture, ...]] séances quotidiennes du plus ancien au plus récent ; now = date de référence (UTC).
  // Tout est calculé ici (une seule fois, côté serveur) : la page ne fait que dessiner. Les nombres sont arrondis à 6 décimales (assez fin pour que l'arrondi d'affichage de la page ne soit jamais faussé par un double arrondi).
  const PERIODS = [20, 15, 10, 5, 2];
  const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];                       // rang du 1er de chaque mois dans l'année de 365 jours   // février toujours à 28 : le 29 est ignoré pour aligner les années

  function seasonalReport(rows, now = new Date()) {
    const CY = now.getUTCFullYear(), CM = now.getUTCMonth(), CD = now.getUTCDate(), DM = DAYS_IN_MONTH;
    const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    // jour de l'année sur 365 cases (le 29 février est replié sur le 28)
    const doy = (y, mo, d) => { let i = Math.floor((Date.UTC(y, mo, d) - Date.UTC(y, 0, 1)) / 864e5); if (isLeap(y)) i = i === 59 ? 58 : i > 59 ? i - 1 : i; return Math.min(i, 364); };

    const D = rows.map(r => { const d = new Date(r[0] * 1e3); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), c: r[1] }; });
    const lastM = {}, byY = {}, byYM = {};
    D.forEach(p => { lastM[p.y * 12 + p.m] = p.c; (byY[p.y] ||= []).push(p); (byYM[p.y * 12 + p.m] ||= []).push(p); });
    const years = Object.keys(byY).map(Number).filter(y => y < CY && byY[y].length > 200).sort((a, b) => a - b);   // années complètes uniquement
    const ALL = [...PERIODS, 'max'], take = n => years.slice(n === 'max' ? 0 : -n);                       // « max » : toutes les années complètes disponibles

    // remplit les trous par la dernière valeur connue ; au-delà de upTo (année ou mois en cours) on laisse vide
    const fill = (arr, upTo) => { let last = 0; for (let i = 0; i < arr.length; i++) { if (arr[i] == null) { arr[i] = upTo != null && i > upTo ? null : last; } else last = arr[i]; } return arr; };
    const avg = list => list[0].map((_, i) => list.reduce((s, c) => s + c[i], 0) / list.length);
    const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;

    function yearCurve(y) {                       // évolution cumulée depuis la dernière clôture de l'année précédente
      const base = lastM[(y - 1) * 12 + 11] ?? byY[y][0].c, c = new Array(365).fill(null); let upTo = null;
      byY[y].forEach(p => { const i = doy(y, p.m, p.day); c[i] = p.c - base; upTo = i; });
      return fill(c, y === CY ? upTo : null);
    }
    function monthCurve(y, mo) {                  // évolution cumulée depuis la clôture du mois précédent, jour par jour
      const base = lastM[y * 12 + mo - 1]; if (base == null || !byYM[y * 12 + mo]) return null;
      const c = new Array(DM[mo]).fill(null); let last = null;
      byYM[y * 12 + mo].forEach(p => { if (p.day - 1 < c.length) { c[p.day - 1] = p.c - base; last = p.day - 1; } });
      return fill(c, y === CY && mo === CM ? last : undefined);
    }
    const chg = (y, mo) => { const a = lastM[y * 12 + mo], b = lastM[y * 12 + mo - 1]; return a == null || b == null ? null : { pts: a - b, pct: (a - b) / b * 100 }; };
    const avgMonth = (n, mo, key) => { const v = take(n).map(y => chg(y, mo)).filter(Boolean).map(c => c[key]); return v.length ? mean(v) : null; };

    // --- courbes annuelles ---
    const curves = {}; years.forEach(y => { curves[y] = yearCurve(y); });
    const annual = {}, month = {};
    ALL.forEach(n => { const ys = take(n); annual[n] = ys.length ? avg(ys.map(y => curves[y])) : null; });
    const ytd = byY[CY] ? yearCurve(CY) : null;

    // --- mois en cours ---
    const mcur = monthCurve(CY, CM);
    ALL.forEach(n => { const cs = take(n).map(y => monthCurve(y, CM)).filter(Boolean); month[n] = cs.length ? avg(cs) : null; });
    month.cur = mcur;

    // --- tableau mensuel (12 mois × périodes) ---
    const monthly = { pts: {}, pct: {} };
    ALL.forEach(n => { monthly.pts[n] = Array.from({ length: 12 }, (_, mo) => avgMonth(n, mo, 'pts')); monthly.pct[n] = Array.from({ length: 12 }, (_, mo) => avgMonth(n, mo, 'pct')); });

    // --- semaines du mois en cours : blocs 1-7, 8-14, 15-21, 22-28, 29-fin ---
    const dm = DM[CM], blocks = []; for (let s = 1; s <= dm; s += 7) blocks.push([s, Math.min(s + 6, dm)]);
    const weekVals = (c, base, lastDay) => blocks.map(([a, e], k) => {
      if (lastDay < a) return null;
      const d = c[Math.min(e, lastDay) - 1] - (k ? c[blocks[k - 1][1] - 1] : 0);
      return { pts: d, pct: d / base * 100 };
    });
    const weekly = { blocks, pts: {}, pct: {} };
    ALL.forEach(n => {
      const acc = blocks.map(() => ({ pts: [], pct: [] }));
      take(n).forEach(y => { const c = monthCurve(y, CM); if (c) weekVals(c, lastM[y * 12 + CM - 1], c.length).forEach((v, k) => { if (v) { acc[k].pts.push(v.pts); acc[k].pct.push(v.pct); } }); });
      weekly.pts[n] = acc.map(a => mean(a.pts)); weekly.pct[n] = acc.map(a => mean(a.pct));
    });
    const wc = mcur ? weekVals(mcur, lastM[CY * 12 + CM - 1], mcur.filter(v => v != null).length) : null;
    weekly.pts.cur = wc && wc.map(v => v && v.pts); weekly.pct.cur = wc && wc.map(v => v && v.pct);

    // --- jours du mois en cours : clôture − clôture de la séance précédente, regroupé par jour du mois ---
    const dayChg = {};
    for (let i = 1; i < D.length; i++) { const p = D[i]; ((dayChg[p.y * 12 + p.m] ||= {})[p.day] = { pts: p.c - D[i - 1].c, pct: (p.c / D[i - 1].c - 1) * 100 }); }
    const daily = { pts: {}, pct: {} };
    ['pts', 'pct'].forEach(key => {
      ALL.forEach(n => { daily[key][n] = Array.from({ length: dm }, (_, i) => { const v = take(n).map(y => dayChg[y * 12 + CM]?.[i + 1]?.[key]).filter(x => x != null); return v.length ? mean(v) : null; }); });
      daily[key].cur = Array.from({ length: dm }, (_, i) => dayChg[CY * 12 + CM]?.[i + 1]?.[key] ?? null);
    });

    // --- indicateurs du mois ---
    const up10 = years.slice(-10).map(y => chg(y, CM)).filter(Boolean);
    const kpi = { avg: { 10: avgMonth(10, CM, 'pts'), 5: avgMonth(5, CM, 'pts'), 2: avgMonth(2, CM, 'pts') },
      monthSoFar: mcur ? mcur.filter(v => v != null).at(-1) ?? null : null, up: up10.filter(c => c.pts > 0).length, n: up10.length };

    const round = o => Array.isArray(o) ? o.map(round) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)])) : typeof o === 'number' ? Math.round(o * 1e6) / 1e6 : o;
    return round({ meta: { year: CY, month: CM, day: CD, doy: doy(CY, CM, CD), lastClose: D.length ? D[D.length - 1].c : null, years: years.length, daysInMonth: dm },
      annual, ytd, month, monthly, weekly, daily, kpi });
  }

  // ---- Calendrier de publication du rapport COT (CFTC) ----
  // Publié le vendredi à 15h30 (heure de New York) avec les positions du mardi précédent. Un jour férié fédéral américain tombant
  // entre le mercredi et le vendredi de cette semaine décale la publication d'un jour ouvré ; un jour férié du lundi ne la décale pas.
  // Source : https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule (règle vérifiée sur les 52 dates de 2026).
  // Limites : un jour de deuil national décidé à la dernière minute ne peut pas être prévu ; la CFTC parle d'un décalage « d'un ou deux jours »,
  // seul le cas d'un jour ouvré est confirmé par son calendrier (les deux jours éventuels de fermetures consécutives ne sont pas vérifiés).
  const DAY = 864e5, ymd = t => new Date(t).toISOString().slice(0, 10), utc = (y, m, d) => Date.UTC(y, m, d);
  const nthWeekday = (y, m, wd, n) => { const first = new Date(utc(y, m, 1)).getUTCDay(); return utc(y, m, 1 + ((wd - first + 7) % 7) + 7 * (n - 1)); };
  const lastWeekday = (y, m, wd) => { const last = new Date(utc(y, m + 1, 0)); return utc(y, m, last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7)); };
  const observed = (y, m, d) => { const w = new Date(utc(y, m, d)).getUTCDay(); return w === 6 ? utc(y, m, d - 1) : w === 0 ? utc(y, m, d + 1) : utc(y, m, d); };   // samedi → vendredi, dimanche → lundi

  const holidayCache = {};
  function usFederalHolidays(year) {                       // dates « observées » (jours de fermeture réels), en AAAA-MM-JJ
    if (holidayCache[year]) return holidayCache[year];
    const out = new Set();
    for (const y of [year - 1, year, year + 1]) {           // l'observé du 1er janvier peut tomber le 31 décembre précédent
      [observed(y, 0, 1), nthWeekday(y, 0, 1, 3), nthWeekday(y, 1, 1, 3), lastWeekday(y, 4, 1), observed(y, 5, 19), observed(y, 6, 4),
       nthWeekday(y, 8, 1, 1), nthWeekday(y, 9, 1, 2), observed(y, 10, 11), nthWeekday(y, 10, 4, 4), observed(y, 11, 25)].forEach(t => out.add(ymd(t)));
    }
    return (holidayCache[year] = out);
  }
  const isBusinessDay = (t, H) => { const w = new Date(t).getUTCDay(); return w !== 0 && w !== 6 && !H.has(ymd(t)); };
  const nextBusinessDay = (t, H) => { do { t += DAY; } while (!isBusinessDay(t, H)); return t; };

  // Date de publication du rapport dont les positions datent du mardi `tuesday` (AAAA-MM-JJ) → { date, delayed }.
  function cotReleaseDate(tuesday) {
    const t = Date.parse(tuesday + 'T00:00:00Z'), friday = t + 3 * DAY, H = usFederalHolidays(new Date(friday).getUTCFullYear());
    const delayed = [1, 2, 3].some(k => H.has(ymd(t + k * DAY)));
    return { date: ymd(delayed ? nextBusinessDay(friday, H) : friday), delayed };
  }
  // Instant UTC (ms) correspondant à hh:mm à New York (heure d'été ou d'hiver) le jour AAAA-MM-JJ.
  function etInstant(date, hour = 15, minute = 30) {
    const [y, m, d] = date.split('-').map(Number), fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' });
    for (const off of [4, 5]) { const t = Date.UTC(y, m - 1, d, hour + off, minute); if (+fmt.format(t) === hour) return t; }   // UTC-4 (été) puis UTC-5 (hiver)
    return Date.UTC(y, m - 1, d, hour + 5, minute);
  }
  // Prochain rapport attendu, d'après la date des dernières positions disponibles (un mardi, AAAA-MM-JJ).
  function nextCotRelease(lastReportDate, now = Date.now()) {
    const reportDate = ymd(Date.parse(lastReportDate + 'T00:00:00Z') + 7 * DAY), rel = cotReleaseDate(reportDate), at = etInstant(rel.date);
    return { reportDate, releaseDate: rel.date, delayed: rel.delayed, at, overdue: now > at, msLeft: at - now };
  }

  // ---- Comparaison de deux marchés ----
  // Séries quotidiennes [[t (s), clôture, …]] du plus ancien au plus récent. Tous les marchés partagent la même convention d'horodatage
  // (minuit à New York) : le jour UTC suffit donc à aligner deux séries.
  const dayOf = t => Math.floor(t / 86400);

  // Garde les jours communs aux deux séries → [[t, clôture A, clôture B]].
  function alignByDay(a, b) {
    const mb = new Map(b.map(r => [dayOf(r[0]), r[1]])), out = [];
    for (const r of a) { const k = dayOf(r[0]); if (mb.has(k)) out.push([r[0], r[1], mb.get(k)]); }
    return out;
  }
  // Rendements simples d'un jour commun au suivant → [[t, rendement A, rendement B]] (les jours fériés propres à un marché sont donc sautés des deux côtés).
  function alignedReturns(a, b) {
    const al = alignByDay(a, b), out = [];
    for (let i = 1; i < al.length; i++) if (al[i - 1][1] > 0 && al[i - 1][2] > 0) out.push([al[i][0], al[i][1] / al[i - 1][1] - 1, al[i][2] / al[i - 1][2] - 1]);
    return out;
  }
  // Corrélation de Pearson entre les deux colonnes de rendements ; null si moins de 20 points ou si l'une des séries est constante.
  function correlation(pairs) {
    const n = pairs.length; if (n < 20) return null;
    let sa = 0, sb = 0; for (const p of pairs) { sa += p[1]; sb += p[2]; }
    const ma = sa / n, mb = sb / n; let cov = 0, va = 0, vb = 0;
    for (const p of pairs) { const x = p[1] - ma, y = p[2] - mb; cov += x * y; va += x * x; vb += y * y; }
    // Série constante : la variance n'est pas exactement 0 à cause de l'arrondi flottant (≈1e-36), d'où un seuil plutôt qu'un test d'égalité (rendements : écart-type < 1e-10 = constant).
    return va / n < 1e-20 || vb / n < 1e-20 ? null : cov / Math.sqrt(va * vb);
  }
  // Corrélation glissante sur w jours → [[t, r]].
  function rollingCorrelation(pairs, w) {
    const out = [];
    for (let i = w - 1; i < pairs.length; i++) { const r = correlation(pairs.slice(i - w + 1, i + 1)); if (r != null) out.push([pairs[i][0], r]); }
    return out;
  }
  // Base 100 à la première séance de la fenêtre (t ≥ x0, en secondes) → [[t, valeur]].
  function rebase(rows, x0) {
    const sub = rows.filter(r => r[0] >= x0); if (!sub.length) return [];
    return sub.map(r => [r[0], r[1] / sub[0][1] * 100]);
  }
  // Performance sur `months` mois calendaires : dernière clôture / clôture de la dernière séance antérieure ou égale à la date cible − 1.
  // null si l'historique est plus court que la période demandée (à une semaine près).
  function performance(rows, months) {
    if (rows.length < 2) return null;
    const last = rows[rows.length - 1], d = new Date(last[0] * 1e3); d.setUTCMonth(d.getUTCMonth() - months);
    const target = d.getTime() / 1e3;
    let ref = null; for (let i = rows.length - 1; i >= 0; i--) if (rows[i][0] <= target) { ref = rows[i]; break; }
    if (!ref || target - ref[0] > 7 * 86400) return null;
    return { pct: (last[1] / ref[1] - 1) * 100, from: ref[0] };
  }

  // ---- Open interest (rapport Legacy, hebdomadaire) ----
  // hist = historique compact du rapport COT [[date, …, open interest]] (l'open interest est la dernière colonne), du plus ancien au plus récent.
  const OI_COL = 7;
  const pctChg = (a, b) => b ? (a / b - 1) * 100 : null;
  function oiSummary(hist) {
    const n = hist.length; if (n < 2) return null;
    const oi = hist.map(r => r[OI_COL]), last = oi[n - 1], prev = oi[n - 2], last52 = oi.slice(-52);
    const avg52 = last52.reduce((s, v) => s + v, 0) / last52.length;
    return { date: hist[n - 1][0], prevDate: hist[n - 2][0], last, prev, chg: last - prev, chgPct: pctChg(last, prev),
      chg4Pct: n > 4 ? pctChg(last, oi[n - 5]) : null, avg52, vsAvgPct: pctChg(last, avg52), idx36: cotIndex(oi, THRESHOLDS.cotLongWeeks)[n - 1], weeks: n };
  }
  // Clôture de la dernière séance antérieure ou égale à la date AAAA-MM-JJ (fin de journée). rows = [[t (s), clôture, …]].
  function closeOnOrBefore(rows, date) {
    const limit = Date.parse(date + 'T23:59:59Z') / 1e3;
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i][0] <= limit) return rows[i][1];
    return null;
  }
  // Lecture classique croisant l'évolution du prix et de l'open interest sur la semaine (convention d'analyse, pas une prévision).
  function oiReading(priceChgPct, oiChgPct) {
    const T = THRESHOLDS;
    if (priceChgPct == null || oiChgPct == null) return { key: 'na', label: 'Indisponible', text: 'Historique de prix ou d\'open interest insuffisant.' };
    if (Math.abs(priceChgPct) < T.priceFlatPct || Math.abs(oiChgPct) < T.oiFlatPct) return { key: 'flat', label: 'Peu marqué', text: 'Prix ou open interest quasi stable sur la semaine : pas de lecture nette.' };
    const up = priceChgPct > 0, more = oiChgPct > 0;
    if (up && more) return { key: 'trend-up', label: 'Hausse confirmée', text: 'Prix en hausse et open interest en hausse : de nouveaux contrats s\'ouvrent, la tendance haussière est alimentée.' };
    if (up) return { key: 'covering', label: 'Hausse fragile', text: 'Prix en hausse mais open interest en baisse : des positions courtes se referment (rachats), sans nouvel afflux d\'acheteurs.' };
    if (more) return { key: 'trend-down', label: 'Baisse confirmée', text: 'Prix en baisse et open interest en hausse : de nouveaux contrats s\'ouvrent, la tendance baissière est alimentée.' };
    return { key: 'liquidation', label: 'Baisse par liquidation', text: 'Prix en baisse et open interest en baisse : des positions longues se dénouent, sans nouvel afflux de vendeurs.' };
  }
  // Lecture de la dernière semaine : variation du prix entre les deux dernières dates de rapport (mardis) et de l'open interest.
  function oiWeek(hist, daily) {
    const sum = oiSummary(hist); if (!sum) return null;
    const a = closeOnOrBefore(daily, sum.prevDate), b = closeOnOrBefore(daily, sum.date), priceChgPct = a && b ? pctChg(b, a) : null;
    return { ...sum, priceChgPct, reading: oiReading(priceChgPct, sum.chgPct) };
  }

  return { oiSignal, oiSummary, closeOnOrBefore, oiReading, oiWeek, THRESHOLDS, confluenceClass, cotIndex, williamsR, seasonalWeek, seasonalDay, seasonalReport, PERIODS, DAYS_IN_MONTH, MONTH_STARTS, cotSignal, wrSignal, seasonSignal, cotLabel,
    usFederalHolidays, cotReleaseDate, etInstant, nextCotRelease, alignByDay, alignedReturns, correlation, rollingCorrelation, rebase, performance };
});
