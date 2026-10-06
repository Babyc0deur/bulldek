// Calendrier du mois pour les indices (module serveur uniquement) : saisonnalité journalière commune S&P 500 / Nasdaq 100 / Dow (ES / NQ / YM)
// sur 15, 20 et 25 ans, annonces économiques américaines (heure de New York) et fermetures de la Bourse de New York.
// Recalculé à chaque mois : la page affiche toujours le mois en cours (et le suivant sur demande).
const CALC = require('./calc.js'), KD = require('./keydates.js');

// ---------- Annonces officielles (heure de New York) ----------
// Calendriers publiés, à compléter chaque année : BLS (bls.gov/schedule), BEA (bea.gov/news/schedule), Census (census.gov/economic-indicators).
// L'emploi (NFP), l'inflation (CPI) et la Fed (FOMC) viennent de keydates.js.
const OFFICIAL = [
  ['2026-10-06', '08:30', 'trade'], ['2026-10-15', '08:30', 'ppi'], ['2026-10-15', '08:30', 'retail'], ['2026-10-16', '08:30', 'importprices'],
  ['2026-10-20', '08:30', 'starts'], ['2026-10-27', '08:30', 'durable'], ['2026-10-27', '10:00', 'newhome'], ['2026-10-29', '08:30', 'gdp', 'PIB du 3e trimestre (1re estimation)'],
  ['2026-10-29', '08:30', 'pce'], ['2026-10-30', '08:30', 'eci'],
  ['2026-11-03', '10:00', 'jolts'], ['2026-11-04', '08:30', 'trade'], ['2026-11-05', '08:30', 'productivity'], ['2026-11-13', '08:30', 'ppi'], ['2026-11-17', '08:30', 'retail'],
  ['2026-11-17', '08:30', 'importprices'], ['2026-11-18', '08:30', 'starts'], ['2026-11-25', '08:30', 'durable'], ['2026-11-25', '08:30', 'gdp', 'PIB du 3e trimestre (2e estimation)'],
  ['2026-11-25', '08:30', 'pce'], ['2026-11-25', '10:00', 'newhome'],
  ['2026-12-01', '10:00', 'jolts'], ['2026-12-08', '08:30', 'productivity'], ['2026-12-08', '08:30', 'trade'], ['2026-12-15', '08:30', 'ppi'], ['2026-12-16', '08:30', 'retail'],
  ['2026-12-17', '08:30', 'starts'], ['2026-12-17', '08:30', 'importprices'], ['2026-12-23', '08:30', 'durable'], ['2026-12-23', '08:30', 'gdp', 'PIB du 3e trimestre (3e estimation)'],
  ['2026-12-23', '08:30', 'pce'], ['2026-12-23', '10:00', 'newhome'],
];
const OFFICIAL_UNTIL = '2026-12-31';
const KINDS = {
  nfp: ['Emploi américain (NFP)', 'high'], cpi: ['Inflation (CPI)', 'high'], fomc: ['Décision de la Fed (FOMC)', 'high'], minutes: ['Compte rendu de la Fed (minutes)', 'high'],
  gdp: ['PIB', 'high'], pce: ['Revenus et dépenses des ménages (PCE, inflation préférée de la Fed)', 'high'], retail: ['Ventes au détail', 'high'],
  ismMfg: ['ISM manufacturier', 'high'], ismSvc: ['ISM services', 'medium'], ppi: ['Prix à la production (PPI)', 'medium'], eci: ['Coût de l\'emploi (ECI)', 'medium'],
  jolts: ['Offres d\'emploi (JOLTS)', 'medium'], claims: ['Inscriptions au chômage', 'medium'], umich: ['Confiance des consommateurs (Michigan)', 'medium'],
  durable: ['Commandes de biens durables', 'medium'], newhome: ['Ventes de logements neufs', 'medium'], starts: ['Mises en chantier et permis de construire', 'low'],
  trade: ['Balance commerciale', 'low'], importprices: ['Prix à l\'import et à l\'export', 'low'], productivity: ['Productivité et coûts unitaires', 'low'],
  opex: ['Échéance mensuelle des options', 'medium'], quad: ['Échéance trimestrielle (« quadruple witching »)', 'high'], roll: ['Roll des futures sur indices', 'medium'],
  speech: ['Discours', 'medium'], other: ['Annonce', 'medium'],
};
// Titres Forex Factory → type d'annonce (pour fusionner sans doublon avec les dates officielles et les rendez-vous habituels).
const FF_KIND = [[/Non-?Farm|Unemployment Rate|Average Hourly Earnings/i, 'nfp'], [/\bCPI\b/i, 'cpi'], [/\bPPI\b/i, 'ppi'], [/Retail Sales/i, 'retail'], [/\bGDP\b/i, 'gdp'],
  [/PCE|Personal (Income|Spending)/i, 'pce'], [/Unemployment Claims|Jobless/i, 'claims'], [/ISM Manufacturing/i, 'ismMfg'], [/ISM (Services|Non-Manufacturing)/i, 'ismSvc'],
  [/UoM|Michigan/i, 'umich'], [/FOMC Meeting Minutes/i, 'minutes'], [/FOMC Statement|Federal Funds Rate|FOMC Press Conference|Economic Projections/i, 'fomc'],
  [/Durable Goods/i, 'durable'], [/Housing Starts|Building Permits/i, 'starts'], [/New Home Sales/i, 'newhome'], [/JOLTS/i, 'jolts'], [/Trade Balance/i, 'trade'],
  [/Employment Cost/i, 'eci'], [/Import Prices/i, 'importprices'], [/Speaks|Testifies/i, 'speech']];
const ffKind = title => (FF_KIND.find(([re]) => re.test(title)) || [null, 'other'])[1];
const HABITUAL = ['claims', 'ismMfg', 'ismSvc', 'umich'];

const DAY = 864e5, ymd = t => new Date(t).toISOString().slice(0, 10);
const utc = (y, m, d) => Date.UTC(y, m, d);
const nthWeekday = (y, m, wd, n) => { const f = new Date(utc(y, m, 1)).getUTCDay(); return utc(y, m, 1 + ((wd - f + 7) % 7) + 7 * (n - 1)); };
const lastWeekday = (y, m, wd) => { const l = new Date(utc(y, m + 1, 0)); return utc(y, m, l.getUTCDate() - ((l.getUTCDay() - wd + 7) % 7)); };
const obs = (y, m, d) => { const w = new Date(utc(y, m, d)).getUTCDay(); return w === 6 ? utc(y, m, d - 1) : w === 0 ? utc(y, m, d + 1) : utc(y, m, d); };

// Jours de fermeture de la Bourse de New York (et demi-séances, fermetures du seul marché obligataire), par année : date → { closed, label }.
function nyseDays(y) {
  const out = {}, add = (t, label, kind = 'closed') => { if (t != null) out[ymd(t)] = { kind, label }; };
  const jan1 = new Date(utc(y, 0, 1)).getUTCDay();
  add(jan1 === 6 ? null : jan1 === 0 ? utc(y, 0, 2) : utc(y, 0, 1), 'Jour de l\'an : Bourse fermée');       // 1er janvier un samedi : pas de jour férié reporté
  add(nthWeekday(y, 0, 1, 3), 'Martin Luther King Day : Bourse fermée');
  add(nthWeekday(y, 1, 1, 3), 'Presidents Day : Bourse fermée');
  add(Date.parse(KD.goodFriday(y)), 'Vendredi saint : Bourse fermée');
  add(lastWeekday(y, 4, 1), 'Memorial Day : Bourse fermée');
  add(obs(y, 5, 19), 'Juneteenth : Bourse fermée');
  add(obs(y, 6, 4), 'Fête nationale : Bourse fermée');
  add(nthWeekday(y, 8, 1, 1), 'Labor Day : Bourse fermée');
  const tg = nthWeekday(y, 10, 4, 4); add(tg, 'Thanksgiving : Bourse fermée'); add(tg + DAY, 'Lendemain de Thanksgiving : clôture anticipée à 13 h', 'early');
  add(obs(y, 11, 25), 'Noël : Bourse fermée');
  const dec24 = new Date(utc(y, 11, 24)).getUTCDay(); if (dec24 >= 1 && dec24 <= 4) add(utc(y, 11, 24), 'Veille de Noël : clôture anticipée à 13 h', 'early');
  const jul3 = new Date(utc(y, 6, 3)).getUTCDay(); if (jul3 >= 1 && jul3 <= 4) add(utc(y, 6, 3), 'Veille du 4 juillet : clôture anticipée à 13 h', 'early');
  add(nthWeekday(y, 9, 1, 2), 'Columbus Day : marché obligataire fermé, actions ouvertes', 'bonds');
  const v = obs(y, 10, 11); if (new Date(v).getUTCDay() !== 0 && new Date(v).getUTCDay() !== 6) add(v, 'Veterans Day : marché obligataire fermé, actions ouvertes', 'bonds');
  return out;
}
const isOpen = (t, H) => { const w = new Date(t).getUTCDay(); return w !== 0 && w !== 6 && !(H[ymd(t)] && H[ymd(t)].kind === 'closed'); };

const nyTime = t => new Intl.DateTimeFormat('fr-FR', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
const nyDate = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));

// Libellé du PIB d'après le mois de publication : 1re estimation le mois suivant la fin du trimestre + 1 (janv., avr., juil., oct.), puis 2e et 3e.
function gdpLabel(d) {
  const m = +d.slice(5, 7) - 1, q = m < 3 ? 4 : Math.floor(m / 3), est = ['1re', '2e', '3e'][m % 3];
  return `PIB du ${q === 1 ? '1er' : q + 'e'} trimestre (${est} estimation)`;
}
// Annonces du mois (année, mois 0-11) : { 'AAAA-MM-JJ': [{ time, kind, label, impact, source }] }. ff = calendrier Forex Factory du site (macro.parseCalendar) ;
// auto = dates lues automatiquement (releases.js → { fomc: [...], events: [[date, heure, type]] }), qui complètent la table OFFICIAL et la remplacent à terme.
function monthEvents(year, month, ff = [], auto = null) {
  const H = { ...nyseDays(year - 1), ...nyseDays(year), ...nyseDays(year + 1) }, prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const ev = {}, put = (date, e) => { if (date.startsWith(prefix)) (ev[date] ||= []).push(e); };
  const mk = (kind, time, source, label) => ({ time, kind, label: label || KINDS[kind][0], impact: KINDS[kind][1], source });
  // Dates officielles.
  for (const [d, time, kind, label] of OFFICIAL) put(d, mk(kind, time, 'officiel', label));
  for (const d of KD.CPI) put(d, mk('cpi', '08:30', 'officiel'));
  for (const d of KD.NFP) put(d, mk('nfp', '08:30', 'officiel'));
  const autoKinds = new Set();                                                // types fournis par FRED ce mois-ci : remplacent les rendez-vous « habituels »
  for (const [d, time, kind] of (auto && auto.events) || []) {
    if (!d.startsWith(prefix) || !KINDS[kind] || (ev[d] || []).some(x => x.kind === kind)) continue;
    autoKinds.add(kind);
    put(d, mk(kind, time, 'officiel', kind === 'gdp' ? gdpLabel(d) : undefined));
  }
  const fomc = new Map(); for (const f of [...KD.FOMC, ...((auto && auto.fomc) || [])]) { const d = f.slice(0, 10); fomc.set(d, fomc.get(d) || f.endsWith('*')); }
  for (const [d, sep] of fomc) {
    if (!(ev[d] || []).some(x => x.kind === 'fomc')) put(d, mk('fomc', '14:00', 'officiel', 'Décision de la Fed (FOMC)' + (sep ? ', avec projections économiques' : '') + ' ; conférence de presse à 14 h 30'));
    const md = ymd(Date.parse(d) + 21 * DAY); if (!(ev[md] || []).some(x => x.kind === 'minutes')) put(md, mk('minutes', '14:00', 'officiel'));                     // la Fed publie le compte rendu trois semaines après la décision
  }
  // Rendez-vous habituels (dates exactes non publiées longtemps à l'avance) et échéances calculées par règle.
  for (let t = utc(year, month, 1); new Date(t).getUTCMonth() === month; t += DAY) {
    const w = new Date(t).getUTCDay(), d = ymd(t), dom = new Date(t).getUTCDate();
    if (w === 4 && !autoKinds.has('claims')) { let c = t; if (!isOpen(c, H)) c -= DAY; put(ymd(c), mk('claims', '08:30', 'habituel')); }        // jeudi ; veille si férié (Thanksgiving)
    if (w === 5 && dom >= 8 && dom <= 14 && isOpen(t, H) && !autoKinds.has('umich')) put(d, mk('umich', '10:00', 'habituel', 'Confiance des consommateurs (Michigan, préliminaire)'));
    if (w === 5 && dom >= 22 && dom <= 28 && isOpen(t, H) && !autoKinds.has('umich')) put(d, mk('umich', '10:00', 'habituel', 'Confiance des consommateurs (Michigan, définitive)'));
  }
  const biz = []; for (let t = utc(year, month, 1); new Date(t).getUTCMonth() === month; t += DAY) if (isOpen(t, H)) biz.push(t);
  if (biz[0]) put(ymd(biz[0]), mk('ismMfg', '10:00', 'habituel'));
  if (biz[2]) put(ymd(biz[2]), mk('ismSvc', '10:00', 'habituel'));
  const exp = KD.expiration(year, month), quarter = month % 3 === 2;
  put(ymd(exp), mk(quarter ? 'quad' : 'opex', '', 'règle'));
  if (quarter) { let r = exp - 8 * DAY; while (!isOpen(r, H)) r -= DAY; put(ymd(r), mk('roll', '', 'règle')); }
  // Forex Factory (semaine en cours) : remplace les rendez-vous habituels de la même semaine, complète les dates officielles (sans doublon).
  const ffUsd = (ff || []).filter(e => e.ccy === 'USD' && /High|Medium/.test(e.impact));
  const weekOf = d => { const t = Date.parse(d), w = (new Date(t).getUTCDay() + 6) % 7; return ymd(t - w * DAY); };
  const ffSeen = new Set();
  for (const e of ffUsd) {
    const d = nyDate(e.t), kind = ffKind(e.title);
    if (!d.startsWith(prefix)) continue;
    if (HABITUAL.includes(kind)) for (const k of Object.keys(ev)) if (weekOf(k) === weekOf(d)) ev[k] = ev[k].filter(x => !(x.kind === kind && x.source === 'habituel'));
    const key = d + '|' + kind;
    if (kind !== 'other' && kind !== 'speech' && ((ev[d] || []).some(x => x.kind === kind && x.source !== 'Forex Factory') || ffSeen.has(key))) continue;
    if (kind !== 'other' && kind !== 'speech') ffSeen.add(key);
    const speaker = /^(?:FOMC Member|Fed Chair|Fed Vice Chair)\s+(.+?)\s+(?:Speaks|Testifies)/i.exec(e.title);
    const label = kind === 'speech' ? (speaker ? `Discours de ${speaker[1]} (Fed)` : e.title) : kind === 'other' ? e.title : KINDS[kind][0];
    put(d, { time: nyTime(e.t), kind, label, impact: e.impact === 'High' ? 'high' : 'medium', source: 'Forex Factory' });
  }
  const order = { high: 0, medium: 1, low: 2 };
  for (const d of Object.keys(ev)) ev[d].sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || order[a.impact] - order[b.impact]);
  return { events: ev, holidays: Object.fromEntries(Object.entries(H).filter(([d]) => d.startsWith(prefix))) };
}

// ---------- Saisonnalité journalière commune ----------
// series : { ES: rows, NQ: rows, YM: rows } (séances [[t (s), clôture, …]], ajustées des changements de contrat) ; caps : { YM: 20 } (années maximales).
// Variation d'un jour J = clôture de la séance tombant le J du mois − clôture de la séance précédente, moyennée sur les N dernières années complètes
// antérieures à `year` où le marché a coté ce jour-là (même règle que le tableau journalier de la fiche marché).
const PERIODS = [15, 20, 25], TAGS = ['ES', 'NQ', 'YM'];
function dayStats(series, year, month, caps = {}) {
  const per = {};
  for (const tag of TAGS) {
    const rows = series[tag] || [], by = {};
    for (let i = 1; i < rows.length; i++) { const d = new Date(rows[i][0] * 1e3); if (d.getUTCMonth() === month) (by[d.getUTCFullYear()] ||= {})[d.getUTCDate()] = (rows[i][1] / rows[i - 1][1] - 1) * 100; }
    per[tag] = { by, first: rows.length ? new Date(rows[0][0] * 1e3).getUTCFullYear() + 1 : year };
  }
  return (day, n) => Object.fromEntries(TAGS.map(tag => {
    const s = per[tag], yrs = Math.min(n, caps[tag] || n), y0 = Math.max(s.first, year - yrs), v = [];
    for (let y = y0; y < year; y++) { const x = s.by[y] && s.by[y][day]; if (x != null) v.push(x); }
    return [tag, { n: v.length, mean: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100 : null, up: v.filter(x => x > 0).length }];
  }));
}
const MIN_OBS = 5, HIT = CALC.THRESHOLDS.seasonHitRate;
// Sens commun sur une période : 1 si les trois moyennes sont positives, −1 si négatives, 0 sinon ; « fort » si chacun a suivi ce sens au moins 60 % des années.
function periodDir(st) {
  const t = TAGS.map(k => st[k]);
  if (t.some(x => x.mean == null || x.n < MIN_OBS)) return { dir: 0, strong: false, regular: false };
  const dir = t.every(x => x.mean > 0) ? 1 : t.every(x => x.mean < 0) ? -1 : 0;
  const share = x => (dir > 0 ? x.up : x.n - x.up) / x.n;
  return { dir, strong: dir !== 0 && t.every(x => share(x) >= HIT), regular: dir === 0 || t.every(x => share(x) > 0.5) };
}
// Lecture d'ensemble des trois périodes.
function reading(dirs) {
  const up = dirs.filter(d => d.dir > 0).length, dn = dirs.filter(d => d.dir < 0).length, s = dirs.filter(d => d.strong).length, irr = dirs.some(d => d.dir !== 0 && !d.regular);
  let key = 'neutral', label = 'Neutre';
  if (up && dn) { key = 'mixed'; label = 'Mixte'; }
  else if (up === 3) { key = s >= 2 ? 'up-strong' : 'up'; label = s >= 2 ? 'Haussier fort' : 'Haussier'; }
  else if (dn === 3) { key = s >= 2 ? 'down-strong' : 'down'; label = s >= 2 ? 'Baissier fort' : 'Baissier'; }
  else if (up === 2) { key = 'up-weak'; label = 'Plutôt haussier'; }
  else if (dn === 2) { key = 'down-weak'; label = 'Plutôt baissier'; }
  return { key, label, irregular: irr && key !== 'neutral' && key !== 'mixed' };
}

// Jours d'une plage de dates [start, start + count jours[. ff : calendrier Forex Factory ; auto : dates lues automatiquement ; caps : années maximales par indice.
const WD = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
function rangeDays({ start, count, series, caps = {}, ff = [], auto = null, today = null }) {
  const perMonth = new Map(), monthData = (y, m) => { const k = y * 12 + m; if (!perMonth.has(k)) perMonth.set(k, { stats: dayStats(series, y, m, caps), ...monthEvents(y, m, ff, auto) }); return perMonth.get(k); };
  const days = [], t0 = Date.parse(start + 'T00:00:00Z');
  for (let t = t0; t < t0 + count * DAY; t += DAY) {
    const { stats, events, holidays } = monthData(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth());
    const d = ymd(t), w = new Date(t).getUTCDay(), dom = new Date(t).getUTCDate(), hol = holidays[d] || null;
    const open = w !== 0 && w !== 6 && !(hol && hol.kind === 'closed');
    const per = Object.fromEntries(PERIODS.map(n => { const st = stats(dom, n); return [n, { ...periodDir(st), ...st }]; }));
    days.push({ date: d, day: dom, weekday: WD[w], weekend: w === 0 || w === 6, open, holiday: hol, today: d === today,
      season: { ...reading(PERIODS.map(n => per[n])), periods: per }, events: events[d] || [] });
  }
  return days;
}
// Dernière date officielle connue (table saisie ou dates lues automatiquement).
const knownUntil = auto => [OFFICIAL_UNTIL, ...(((auto && auto.events) || []).map(e => e[0])), ...(((auto && auto.fomc) || []).map(f => f.slice(0, 10)))].sort().at(-1);
// Calendrier d'un mois.
function monthCalendar({ year, month, series, caps = {}, ff = [], auto = null, today = null }) {
  const start = ymd(utc(year, month, 1)), count = new Date(utc(year, month + 1, 0)).getUTCDate();
  const label = new Date(utc(year, month, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { view: 'month', year, month, start, label, periods: PERIODS, caps, officialUntil: knownUntil(auto), days: rangeDays({ start, count, series, caps, ff, auto, today }) };
}
// Calendrier d'une semaine (lundi → dimanche), éventuellement à cheval sur deux mois.
function weekCalendar({ monday, series, caps = {}, ff = [], auto = null, today = null }) {
  const t = Date.parse(monday + 'T00:00:00Z'), end = new Date(t + 6 * DAY), a = new Date(t);
  const fmt = (d, o) => d.toLocaleDateString('fr-FR', { timeZone: 'UTC', ...o });
  const label = a.getUTCMonth() === end.getUTCMonth() ? `semaine du ${a.getUTCDate()} au ${fmt(end, { day: 'numeric', month: 'long', year: 'numeric' })}`
    : `semaine du ${fmt(a, { day: 'numeric', month: 'long' })} au ${fmt(end, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  return { view: 'week', year: a.getUTCFullYear(), month: a.getUTCMonth(), start: monday, label, periods: PERIODS, caps, officialUntil: knownUntil(auto), days: rangeDays({ start: monday, count: 7, series, caps, ff, auto, today }) };
}

module.exports = { OFFICIAL, KINDS, ffKind, nyseDays, monthEvents, dayStats, periodDir, reading, monthCalendar, weekCalendar, rangeDays, knownUntil, gdpLabel, nyDate, PERIODS };
