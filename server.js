// BullDesk : sert le site et rafraîchit automatiquement prix (Yahoo) et COT (CFTC). Aucune dépendance.
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const CALC = require('./calc.js');
const { createLimiter, clientIp, singleFlight } = require('./guard.js');
const { assess, LIMITS } = require('./freshness.js');
const PORT = process.env.PORT || 8123;
const REFRESH_MS = (+process.env.REFRESH_HOURS || 6) * 3600e3;
const DAILY_MS = 24 * 3600e3;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

const MARKETS = JSON.parse(fs.readFileSync(path.join(__dirname, 'markets.json'), 'utf8'));
const BY_CODE = Object.fromEntries(MARKETS.map(m => [m.code, m]));
const DEFAULT_SLUG = 'nasdaq-100';

const STATIC = {
  '/shared.css': ['shared.css', 'text/css'],
  '/markets.json': ['markets.json', 'application/json'], '/themes.css': ['themes.css', 'text/css'],
  '/favicon.svg': ['assets/logo-icon.svg', 'image/svg+xml'], '/logo.svg': ['assets/logo.svg', 'image/svg+xml'], '/loader.svg': ['assets/loader.svg', 'image/svg+xml'], '/logo-anim.svg': ['assets/logo-anim.svg', 'image/svg+xml'],
};
const SCRIPTS = new Set(['calendarview.js', 'intermarketview.js', 'macroview.js', 'debriefview.js', 'shared.js', 'cot.js', 'seasonal.js', 'wr.js', 'calc.js', 'screener.js', 'market.js', 'compare.js', 'theme.js', 'gallery.js', 'oi.js']);

const CFTC = 'https://publicreporting.cftc.gov/resource/';
const DAILY_MERGE = require('./dailymerge.js'), ADJ = require('./adjust.js'), REL = require('./cotsource.js'), VOL = require('./vol.js'), KEYDATES = require('./keydates.js'), MONTHCAL = require('./monthcal.js'), RELEASES = require('./releases.js'), INTER = require('./intermarket.js'), YIELDS = require('./yields.js'), MACRO = require('./macro.js'), { debrief } = require('./debrief.js');
const { LEGACY_FIELDS, TFF_FIELDS, DISAGG_FIELDS, compactLegacy, compactTff, compactDisagg } = require('./cftc.js');

// Cache en mémoire (lecture rapide), persisté ligne par ligne dans SQLite (repli JSON si indisponible). Voir store.js.
const store = require('./store.js').openStore(DATA_DIR);
const loaded = store.load();
const cache = { ...loaded.data, ts: loaded.ts, lastRefresh: loaded.meta.lastRefresh || 0 };     // ts[jeu][marché] = date de dernière mise à jour
// Journal : horodaté, verbeux par défaut (rafraîchissements, sources macro, requêtes). QUIET=1 ne garde que les échecs et alertes.
// Aucune adresse IP ni en-tête n'est jamais écrit (voir la page « À propos », section Vie privée).
const QUIET = process.env.QUIET === '1';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const logV = (...a) => { if (!QUIET) log(...a); };
const logRequest = (method, target, status, ms) => logV(method, target, status, ms + ' ms');
log('stockage :', store.kind);
const errors = {};                                                                          // 'jeu:marché' → { at, msg } : dernier échec de mise à jour, tant qu'il n'a pas été résolu
const noteError = (name, code, e) => { errors[name + ':' + code] = { at: Date.now(), msg: String((e && e.message) || e).slice(0, 120) }; };
function commit(name, code, value) {
  delete errors[name + ':' + code];                                                          // enregistre une donnée fraîche : mémoire + base, avec son horodatage
  const ts = Date.now();
  cache[name][code] = value; cache.ts[name][code] = ts; store.put(name, code, value, ts);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Journal des appels sortants : « ↗ source chemin statut durée » (adresse courte, sans paramètre long ; jamais de donnée personnelle).
const shortUrl = MACRO.redactUrl;
async function outbound(url, options, read) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, options);
    logV('↗', shortUrl(url), r.status, (Date.now() - t0) + ' ms');
    if (!r.ok) throw new Error(r.status);
    return await read(r);
  } catch (e) {
    if (!(e && /^\d+$/.test(String(e.message)))) logV('↗', shortUrl(url), 'échec', (Date.now() - t0) + ' ms', (e && e.name) || '');    // les erreurs HTTP sont déjà journalisées avec leur statut
    throw e;
  }
}
const getJSON = url => outbound(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(25000) }, r => r.json());
const getText = url => outbound(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'fr' }, signal: AbortSignal.timeout(40000) }, r => r.text());
const yahoo = (sym, range, interval) =>
  getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`).then(j => j.chart.result[0]);

// ---- Prix ----
async function refreshWeekly(code) {
  const res = await yahoo(BY_CODE[code].yahoo, '10y', '1wk'), q = res.indicators.quote[0];
  // [timestamp, clôture, plus haut, plus bas]
  commit('weekly', code, res.timestamp.map((t, i) => [t, q.close[i], q.high[i], q.low[i]]).filter(p => p[1] != null && p[2] != null && p[3] != null));
}
// Historique quotidien : téléchargé en entier une fois, puis mis à jour en ne retéléchargeant que les dernières semaines (dailymerge.js).
// Un téléchargement complet est refait si l'historique stocké est absent, trop court, ou si la source a corrigé des clôtures déjà connues.
async function dailyRows(sym, since) {
  // period1 explicite : avec range=max, Yahoo ne renvoie que des points mensuels.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${Math.max(0, Math.floor(since))}&period2=${Math.floor(Date.now() / 1e3) + 864e2}&interval=1d`;
  const res = await getJSON(url).then(j => j.chart.result[0]), q = res.indicators.quote[0], r = v => +v.toFixed(4);
  // [timestamp, clôture, plus haut, plus bas]
  return (res.timestamp || []).map((t, i) => [t, q.close[i], q.high[i], q.low[i]]).filter(p => p[1] != null && p[2] != null && p[3] != null).map(p => [p[0], r(p[1]), r(p[2]), r(p[3])]);
}
async function refreshDaily(code) {
  const since = DAILY_MERGE.sinceTs(cache.daily[code]);
  if (since != null) {
    const merged = DAILY_MERGE.merge(cache.daily[code], await dailyRows(BY_CODE[code].yahoo, since));
    if (merged) { logV(BY_CODE[code].slug + ' : prix quotidiens mis à jour par fusion (' + (merged.length - cache.daily[code].length) + ' séances ajoutées)'); return commit('daily', code, merged); }
    logV(BY_CODE[code].slug + ' : fusion impossible (historique corrigé à la source ?), retéléchargement complet');
  }
  commit('daily', code, await dailyRows(BY_CODE[code].yahoo, 0));
}
// Indice au comptant d'un future sur indice (adjust.js) : sert uniquement à mesurer les changements de contrat. Même mise à jour incrémentale ;
// téléchargement complet depuis 2000 (les futures de Yahoo ne remontent pas plus loin).
const CASH_FROM = Date.UTC(2000, 0, 1) / 1e3;
async function refreshCash(code) {
  const sym = ADJ.CASH[BY_CODE[code].slug]; if (!sym) return;
  const old = cache.cash[code], since = DAILY_MERGE.sinceTs(old);
  if (since != null) { const merged = DAILY_MERGE.merge(old, await dailyRows(sym, since)); if (merged) return commit('cash', code, merged); }
  commit('cash', code, await dailyRows(sym, CASH_FROM));
}
// Série quotidienne ajustée des changements de contrat (indices) ou série brute (autres marchés), mémorisée tant que les données ne changent pas.
// Sert aux calculs qui additionnent des variations : saisonnalité, tendance, corrélations, ratios, fiabilité des signaux. Les prix affichés restent bruts.
const adjMemo = new Map();
function adjusted(m) {
  const d = cache.daily[m.code], c = cache.cash[m.code];
  if (!d || !c || !ADJ.CASH[m.slug]) return { rows: d, rolls: [] };
  const stamp = (cache.ts.daily[m.code] || 0) + '|' + d.length + '|' + (cache.ts.cash[m.code] || 0) + '|' + c.length, hit = adjMemo.get(m.code);
  if (hit && hit.stamp === stamp) return hit.val;
  const val = ADJ.rollAdjust(d, c);
  adjMemo.set(m.code, { stamp, val });
  return val;
}

// ---- COT ----
async function fetchCot(dataset, fields, code) {
  const url = `${CFTC}${dataset}.json?$select=${fields.join(',')}&$order=report_date_as_yyyy_mm_dd DESC&$limit=1500&$where=`
    + encodeURIComponent(`cftc_contract_market_code='${code}'`);
  return getJSON(url);
}
async function refreshCot(code) {
  const rows = await fetchCot('6dca-aqww', LEGACY_FIELDS, code);
  if (!rows.length) throw new Error('vide');
  // historique compact, du plus ancien au plus récent : [date, comm L, comm S, noncomm L, noncomm S, nonrept L, nonrept S, OI]
  const hist = compactLegacy(rows);
  commit('cot', code, { at: Date.now(), latest: rows[0], hist });
  return cache.cot[code];
}
async function refreshTff(code) {
  const rows = await fetchCot('gpe5-46if', TFF_FIELDS, code);
  if (!rows.length) throw new Error('vide');
  const hist = compactTff(rows);
  commit('tff', code, { at: Date.now(), latest: rows[0], hist });
  return cache.tff[code];
}

async function refreshDisagg(code) {
  const rows = await fetchCot('72hh-3qpy', DISAGG_FIELDS, code);
  if (!rows.length) throw new Error('vide');
  // historique compact : [date, prod L, prod S, swap L, swap S, managed money L, managed money S, autres L, autres S, non déclarants L, non déclarants S]
  const hist = compactDisagg(rows);
  commit('disagg', code, { at: Date.now(), latest: rows[0], hist });
  return cache.disagg[code];
}

// Renvoie le cache, le rafraîchit s'il est absent ou périmé (garde l'ancien en cas d'échec).
const flights = {};                                                       // une file par type de donnée : jamais deux appels simultanés identiques
const flight = (name, fn) => (flights[name] ||= singleFlight(fn));
async function fresh(name, code, ttl, fn) {
  let c = cache[name][code];
  const at = cache.ts[name][code] || 0;
  if (!c || Date.now() - at > ttl) { try { await flight(name, fn)(code); c = cache[name][code]; } catch (e) { noteError(name, code, e); if (!c) throw e; } }
  return c;
}

// État du cache en une ligne par jeu de données : combien de marchés, âge de la plus ancienne et de la plus récente mise à jour.
function cacheSummary() {
  const age = ms => (ms < 3600e3 ? Math.round(ms / 60e3) + ' min' : ms < 48 * 3600e3 ? (ms / 3600e3).toFixed(1) + ' h' : Math.round(ms / 864e5) + ' j');
  const now = Date.now();
  for (const name of ['daily', 'cash', 'weekly', 'cot', 'tff', 'disagg']) {
    const ts = Object.values(cache.ts[name] || {}).filter(Boolean);
    logV('cache ' + name + ' : ' + ts.length + ' marché' + (ts.length > 1 ? 's' : '') + (ts.length ? ', mis à jour il y a ' + age(now - Math.max(...ts)) + ' (le plus ancien : ' + age(now - Math.min(...ts)) + ')' : ' — vide'));
  }
  logV('cache macro : ' + Object.keys(MACRO_TTL).map(n => n + ' ' + (cache.ts.macro[n] ? 'il y a ' + age(now - cache.ts.macro[n]) : 'vide')).join(', '));
}

async function refreshAll() {
  const now = Date.now();
  const t0 = Date.now(); let fails = 0;
  logV('rafraîchissement : ' + MARKETS.length + ' marchés');
  const dailyDue = m => !cache.daily[m.code] || cache.daily[m.code][0].length < 4 || now - (cache.ts.daily[m.code] || 0) > DAILY_MS;
  const cashDue = m => ADJ.CASH[m.slug] && (!cache.cash[m.code] || now - (cache.ts.cash[m.code] || 0) > DAILY_MS);
  for (const m of MARKETS) {
    const done = [];
    for (const [name, fn] of [['weekly', refreshWeekly], ...(dailyDue(m) ? [['daily', refreshDaily]] : []), ...(cashDue(m) ? [['cash', refreshCash]] : []), ['cot', refreshCot], ...(m.tff ? [['tff', refreshTff]] : []), ...(m.disagg ? [['disagg', refreshDisagg]] : [])]) {
      const t1 = Date.now();
      try { await fn(m.code); done.push(name + ' ' + (Date.now() - t1) + ' ms'); } catch (e) { fails++; noteError(name, m.code, e); log(m.slug, name, 'échec:', e.message); }
    }
    logV(m.slug + ' : ' + (done.join(', ') || 'rien de mis à jour'));
    await sleep(300);
  }
  for (const name of Object.keys(MACRO_TTL)) macroData(name).catch(() => {});                 // en arrière-plan : l'OCDE peut prendre quelques minutes
  cache.lastRefresh = Date.now(); store.putMeta('lastRefresh', cache.lastRefresh);
  cacheSummary();
  log('données rafraîchies en ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s (' + fails + ' échec' + (fails > 1 ? 's' : '') + ')');
}

// ---- Macro : inflation et taux (OCDE, une requête groupée par jeu, limite d'appels stricte → 24 h et pause après un échec) ; calendrier (3 h) ----
// L'OCDE accepte environ une requête toutes les 30 s (au-delà : réponses 429 ou 500). Toutes les requêtes OCDE passent par une file unique, espacées d'au moins
// OECD_GAP_MS, et chaque lot est retenté jusqu’à 6 fois (l’OCDE répond parfois 500 au hasard). Un rafraîchissement complet (6 lots) dure environ 3 minutes, en arrière-plan, une fois par jour.
const OECD_GAP = +process.env.OECD_GAP_MS || 30000;
let oecdChain = Promise.resolve(), oecdLast = 0;
function oecdGet(url) {
  const run = async () => { const w = oecdLast + OECD_GAP - Date.now(); if (w > 0) await sleep(w); try { return await getText(url); } finally { oecdLast = Date.now(); } };
  const p = oecdChain.then(run); oecdChain = p.catch(() => {}); return p;
}
const sequential = async (urls, fn) => {
  const out = [];
  for (const u of urls) for (let n = 1; ; n++) { try { out.push(await fn(u)); break; } catch (e) { if (n >= 6) throw e; } }
  return out;
};
const MACRO_TTL = { cpi: 24 * 3600e3, rates: 24 * 3600e3, calendar: 3 * 3600e3, yields: 6 * 3600e3, releases: 24 * 3600e3 };
const MACRO_RETRY_MS = 60 * 60e3;
const macroFail = {};
const MACRO_FETCH = {
  cpi: async () => MACRO.mergeCpi(await sequential(MACRO.cpiUrls(), u => oecdGet(u).then(MACRO.parseCpi))),
  rates: async () => MACRO.mergeRates(await sequential(MACRO.ratesUrls(), u => oecdGet(u).then(MACRO.parseRates))),
  yields: async () => {                                                        // FRED : une requête par série (plusieurs séries = fichier ZIP)
    const parts = [];
    for (const [key, url] of YIELDS.yieldsUrls()) { parts.push([key, await getText(url)]); await sleep(300); }
    return YIELDS.parseYields(parts);
  },
  // Dates officielles à venir (releases.js) : page FOMC de la Fed (sans clé) et, avec FRED_API_KEY, dates programmées des statistiques sur FRED.
  // Une statistique en échec n'empêche pas les autres ; sans aucune date, l'échec est signalé (nouvel essai une heure plus tard).
  releases: async () => {
    const from = new Date(Date.now() - 62 * 864e5).toISOString().slice(0, 10), fred = {}, failed = {};
    let fomc = [];
    try { fomc = RELEASES.parseFomcPage(await getText(RELEASES.FOMC_URL)); if (!fomc.length) failed.fomc = 'page lue mais aucune réunion trouvée'; }
    catch (e) { failed.fomc = String(e.message).slice(0, 120); log('calendrier officiel : page FOMC illisible (' + e.message + ')'); }
    const key = process.env.FRED_API_KEY;
    if (key) {
      for (const [kind, [rid]] of Object.entries(RELEASES.RELEASES)) {
        try { fred[kind] = RELEASES.parseFredDates(await getJSON(RELEASES.fredUrl(key, rid, from)), from); } catch (e) { failed[kind] = String(e.message).slice(0, 120); log('calendrier officiel : FRED ' + kind + ' indisponible (' + e.message + ')'); }
        await sleep(300);
      }
    } else logV('calendrier officiel : FRED_API_KEY absente, seules les décisions de la Fed sont lues automatiquement');
    const out = { ...RELEASES.build({ fred, fomc }), fredKey: !!key, failed };
    if (!out.events.length && !out.fomc.length) throw new Error('aucune date officielle lue : ' + Object.entries(failed).map(([k, v]) => k + ' ' + v).join(' ; ').slice(0, 300));
    logV('calendrier officiel : ' + out.fomc.length + ' réunions de la Fed, ' + out.events.length + ' publications FRED (' + Object.keys(fred).length + ' statistiques)');
    return out;
  },
  calendar: async () => {
    const key = process.env.FMP_API_KEY;                                   // facultative : avec elle, le calendrier inclut le chiffre publié
    if (key) {
      try {
        const ev = MACRO.parseFmpCalendar(await getJSON(MACRO.fmpUrl(key)));
        if (ev.length) { logV('calendrier : source FMP, ' + ev.length + ' événements (chiffres publiés inclus)'); return ev; }
        log('calendrier FMP vide : repli sur Forex Factory');
      } catch (e) { log('calendrier FMP indisponible (' + e.message + ') : repli sur Forex Factory'); }
    }                                                  // cette semaine + la suivante (indisponible avant le week-end : on l'ignore)
    const week = MACRO.parseCalendar(await getJSON(MACRO.CALENDAR_URL));
    const next = await getJSON(MACRO.CALENDAR_NEXT_URL).then(MACRO.parseCalendar).catch(() => []);
    return week.concat(next).sort((a, b) => a.t - b.t);
  },
};
async function refreshMacro(name) {
  const t0 = Date.now();
  logV('macro ' + name + ' : téléchargement…');
  const value = await MACRO_FETCH[name]();
  const empty = name === 'calendar' ? !value.length : name === 'releases' ? !((value.events || []).length || (value.fomc || []).length) : !Object.keys(Object.values(value)[0] || {}).length;
  if (!value || empty) throw new Error('vide');
  commit('macro', name, value);
  logV('macro ' + name + ' : ok en ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  return value;
}
// Renvoie les données macro (anciennes si la source est en échec) ; ne retente pas avant MACRO_RETRY_MS.
async function macroData(name) {
  const c = cache.macro[name], at = cache.ts.macro[name] || 0;
  if (c && Date.now() - at <= MACRO_TTL[name]) return c;
  if (Date.now() - (macroFail[name] || 0) < MACRO_RETRY_MS) return c || null;
  try { return await flight('macro:' + name, refreshMacro)(name); }
  catch (e) { macroFail[name] = Date.now(); noteError('macro', name, e); log('macro', name, 'échec :', e.message); return c || null; }
}
const macroSnapshot = () => ({ cpi: cache.macro.cpi || null, rates: cache.macro.rates || null, yields: cache.macro.yields || null });

// ---- HTTP ----
// Réponse avec ETag (304 si inchangé) et compression gzip au-delà de 1 Ko.
const send = (res, code, body, type = 'application/json') => {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const h = { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
  if (code === 200) {
    h.ETag = '"' + crypto.createHash('md5').update(buf).digest('hex') + '"';
    if (res.req.headers['if-none-match'] === h.ETag) { res.writeHead(304, h); return res.end(); }
  }
  if (buf.length > 1024 && /gzip/.test(res.req.headers['accept-encoding'] || '')) { buf = zlib.gzipSync(buf); h['Content-Encoding'] = 'gzip'; }
  h['Content-Length'] = buf.length;
  res.writeHead(code, h);
  res.end(res.req.method === 'HEAD' ? undefined : buf);
};

// ---- Pages documentaires : les valeurs {{CLE}} sont injectées depuis le code (seuils, délais), la méthodologie publiée ne peut donc pas les contredire ----
function docValues() {
  const T = CALC.THRESHOLDS;
  return { REFRESH_HOURS: REFRESH_MS / 36e5, COT_SHORT_WEEKS: T.cotShortWeeks, COT_LONG_WEEKS: T.cotLongWeeks, COT_BUY: T.cotBuy, COT_SELL: T.cotSell,
    WR_PERIOD: T.wrPeriod, WR_HIGH: T.wrHigh, WR_LOW: T.wrLow, SEASON_MIN_YEARS: T.seasonMinYears, SEASON_HIT_PCT: Math.round(T.seasonHitRate * 100),
    ROLL_PCT: Math.round(T.rollJump * 100), ROLL_WINDOW: T.rollWindow, CONF: T.confluenceStrong, TREND_SMA: T.trendSma, OI_FLAT_PCT: T.oiFlatPct, PRICE_FLAT_PCT: T.priceFlatPct,
    STALE_SESSION_DAYS: LIMITS.sessionMaxAge / 864e5, FETCH_MAX_HOURS: LIMITS.fetchMaxAge / 36e5, GRACE_HOURS: LIMITS.cotOverdueGrace / 36e5 };
}
function docPage(file) {
  const v = docValues();
  return fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in v ? String(v[k]).replace('-', '\u2212').replace('.', ',') : m));   // signe moins typographique
}

// ---- Fraîcheur des données (règles dans freshness.js) ----
function status(m) {
  const d = cache.daily[m.code], cot = cache.cot[m.code], suffix = ':' + m.code;
  return { slug: m.slug, name: m.name, ...assess({
    now: Date.now(), lastSession: d && d.length ? d[d.length - 1][0] * 1e3 : null, pricesAt: cache.ts.daily[m.code] || 0,
    reportDate: cot && cot.hist.length ? cot.hist[cot.hist.length - 1][0] : null, cotAt: cache.ts.cot[m.code] || 0,
    errors: Object.entries(errors).filter(([k]) => k.endsWith(suffix)).map(([k, v]) => ({ store: k.split(':')[0], ...v })),
  }) };
}
function statusSummary() {
  const all = MARKETS.map(status), count = l => all.filter(x => x.level === l).length;
  return { now: Date.now(), storage: store.kind, lastRefresh: cache.lastRefresh || null, uptimeSec: Math.round(process.uptime()),
    markets: { total: all.length, ok: count('ok'), warn: count('warn'), bad: count('bad') },
    attention: all.filter(x => x.level !== 'ok').map(x => ({ slug: x.slug, name: x.name, level: x.level })),
    // Sources macro : dernière mise à jour et dernier échec (message court, jamais de clé d'accès) ; détail de la lecture des dates officielles.
    macro: Object.fromEntries(Object.keys(MACRO_TTL).map(n => [n, { updated: cache.ts.macro[n] || 0, error: errors['macro:' + n] ? errors['macro:' + n].msg : null,
      retryAfter: macroFail[n] ? macroFail[n] + MACRO_RETRY_MS : null }])),
    releases: cache.macro.releases ? { at: cache.macro.releases.at, fredKey: !!cache.macro.releases.fredKey, fomc: (cache.macro.releases.fomc || []).length,
      events: (cache.macro.releases.events || []).length, failed: cache.macro.releases.failed || {} } : { fredKey: !!process.env.FRED_API_KEY, fomc: 0, events: 0 } };
}

// ---- Saisonnalité : rapport complet calculé une fois par jour et par marché, puis servi tel quel ----
const seasonalMemo = new Map();
function seasonalJson(code) {
  const m0 = BY_CODE[code], adj = m0 ? adjusted(m0) : { rows: cache.daily[code], rolls: [] }, all = adj.rows, cap = SEASON_CAPS[(m0 || {}).slug];                // marché plafonné (Dow : 20 ans) : on ne garde que les années voulues
  const d = all && cap ? all.filter(r => new Date(r[0] * 1e3).getUTCFullYear() >= new Date().getUTCFullYear() - cap) : all;
  if (!d || d.length < 300) return null;
  const now = new Date(), stamp = (cache.ts.daily[code] || 0) + '|' + d.length + '|' + now.toISOString().slice(0, 10);
  const hit = seasonalMemo.get(code);
  if (hit && hit.stamp === stamp) return hit.json;
  const json = '{"updated":' + (cache.ts.daily[code] || 0) + ',"adjusted":' + JSON.stringify({ rolls: adj.rolls.length, last: adj.rolls.at(-1) || null }) + ',"report":' + JSON.stringify(CALC.seasonalReport(d, now)) + '}';
  seasonalMemo.set(code, { stamp, json });
  return json;
}

// ---- Screener : COT Index, Williams %R 14 jours et saisonnalité du mois pour tous les marchés ----
let scrMemo = { at: 0, val: null };
// Libellé court de la semaine calendaire en cours (lundi–dimanche), ex. « 22–28 sept. » ou « 29 sept.–5 oct. » si elle chevauche deux mois.
function weekLabel(now) {
  const dow = (now.getUTCDay() + 6) % 7, monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow)), sunday = new Date(+monday + 6 * 864e5);
  const mon = d => d.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }).replace('.', '');
  return monday.getUTCMonth() === sunday.getUTCMonth() ? `${monday.getUTCDate()}–${sunday.getUTCDate()} ${mon(sunday)}` : `${monday.getUTCDate()} ${mon(monday)}–${sunday.getUTCDate()} ${mon(sunday)}`;
}

// Source du signal COT de la confluence, par marché (cotsource.js → COT_SOURCES). Par défaut : commerciaux du rapport Legacy.
// Le rapport TFF (asset managers, fonds à levier) a été testé sur les indices : il n'a pas fait mieux que le Legacy, il reste donc affiché
// à titre d'information. Pour basculer un marché : { 'sp500': 'tff-am' }.
const COT_SOURCE = {};
const SEASON_YEARS = 60, SEASON_CAPS = { 'dow-jones': 20 };               // plafond d'années par marché : le Dow est volontairement limité à 20 ans ; le Russell 2000 garde tout ce qui existe (8 ans)
function screener() {
  if (scrMemo.val && Date.now() - scrMemo.at < 60e3) return scrMemo.val;
  const now = new Date(), nowY = now.getUTCFullYear();
  const dow = now.getUTCDay(), target = new Date(Date.UTC(nowY, now.getUTCMonth(), now.getUTCDate() + (dow === 6 ? 2 : dow === 0 ? 1 : 0)));     // week-end : la prochaine séance est lundi
  const day = { iso: target.toISOString().slice(0, 10), label: target.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(/\./g, '') };
  const rows = MARKETS.map(m => {
    const base = { slug: m.slug, name: m.name, group: m.group, fresh: status(m).level };
    const cot = cache.cot[m.code], d = cache.daily[m.code];
    if (!cot || !d || d.length < 30 || d[0].length < 4) return { ...base, missing: true };
    const src = COT_SOURCE[m.slug] && cache.tff[m.code] ? COT_SOURCE[m.slug] : 'legacy', tff = cache.tff[m.code] && cache.tff[m.code].hist;
    const cs = REL.cotSeries(src, cot.hist, tff) || REL.cotSeries('legacy', cot.hist, tff, 1);
    if (!cs) return { ...base, missing: true };
    const cl = cs.at(-1), net = cs.map(r => r.net);
    const TH = CALC.THRESHOLDS, idx6 = cl.idx6, idx36 = cl.idx36;
    // Lectures TFF (marchés financiers) : affichées à titre d'information, hors confluence sauf configuration contraire.
    const tffIdx = tff ? Object.fromEntries(['tff-am', 'tff-lev'].map(s => { const c = REL.cotSeries(s, cot.hist, tff); return [s, c ? Math.round(c.at(-1).idx6) : null]; })) : null;
    const A = adjusted(m).rows || d, ma = CALC.sma(A).at(-1), trend = ma == null ? null : { ma: +ma.toFixed(4), pct: +((A.at(-1)[1] / ma - 1) * 100).toFixed(2), up: A.at(-1)[1] > ma };
    const wr = CALC.williamsR(d, CALC.THRESHOLDS.wrPeriod), w = wr.at(-1)[1], last = d.at(-1), prev = d.at(-2);
    const seasonDay = CALC.seasonalDay(A, day.iso, SEASON_CAPS[m.slug] || SEASON_YEARS, nowY);
    const season = CALC.seasonalWeek(A, now, SEASON_CAPS[m.slug] || SEASON_YEARS, nowY);       // toutes les années complètes disponibles (≈ 25 pour les futures sur indices) ; moins si l'historique du marché est plus court
    // Future continu non ajusté : un saut de plus de 10 % en une séance signale en général un changement de contrat,
    // qui fausse le Williams %R pendant 14 séances. On l'indique et on neutralise ce signal (sauf crypto, très volatile).
    const recent = d.slice(-TH.rollWindow), roll = m.group !== 'Crypto' && recent.some((r, i) => i && Math.abs(r[1] / recent[i - 1][1] - 1) > TH.rollJump);
    // Open interest : lecture de la dernière semaine (prix du mardi contre open interest). Un changement de contrat récent fausse la variation de prix : signal neutralisé.
    const oiw = CALC.oiWeek(cot.hist, d);
    const sig = { cot: REL.cotSig(src, idx6), season: CALC.seasonSignal(season), wr: roll ? 0 : CALC.wrTrendSignal(w, A.at(-1)[1], ma), oi: roll || !oiw ? 0 : CALC.oiSignal(oiw.reading) };
    return { ...base, price: last[1], priceDate: last[0], chgPct: (last[1] / prev[1] - 1) * 100, cotDate: cl.date, netC: net.at(-1), cotSource: src, cotLabel: REL.COT_SOURCES[src].label, tffIdx, trend, wrZone: CALC.wrSignal(w),
      idx6, idx36, wr: w, roll, season, seasonDay, sig, score: sig.cot + sig.season + sig.wr + sig.oi,
      oi: oiw ? { last: oiw.last, chgPct: oiw.chgPct, priceChgPct: oiw.priceChgPct, key: oiw.reading.key, label: oiw.reading.label } : null };
  });
  scrMemo = { at: Date.now(), val: { week: weekLabel(now), day, updated: Math.max(0, ...Object.values(cache.ts.daily)), rows } };
  return scrMemo.val;
}

// ---- Analyse intermarchés : corrélations croisées calculées sur les séances quotidiennes déjà en cache (aucun appel externe), mémorisées 5 minutes ----
let interMemo = { at: 0, val: null };
function intermarket() {
  if (interMemo.val && Date.now() - interMemo.at < 300e3) return interMemo.val;
  const series = {};
  for (const slug of INTER.SLUGS) { const m = MARKETS.find(x => x.slug === slug), d = m && adjusted(m).rows; if (d && d.length > 60) series[slug] = d; }
  interMemo = { at: Date.now(), val: INTER.build(series, CALC.correlation) };
  return interMemo.val;
}

// ---- Ratios intermarchés : séries calculées sur les séances en cache, mémorisées 5 minutes ----
let ratioMemo = { at: 0, val: null };
function ratiosData() {
  if (ratioMemo.val && Date.now() - ratioMemo.at < 300e3) return ratioMemo.val;
  const series = {};
  for (const slug of INTER.RATIO_SLUGS) { const m = MARKETS.find(x => x.slug === slug), d = m && adjusted(m).rows; if (d && d.length > 60) series[slug] = d; }
  ratioMemo = { at: Date.now(), val: INTER.ratios(series) };
  return ratioMemo.val;
}

// ---- Volatilité (vol.js : VIX, VIX 3 mois, volatilité réalisée du S&P 500) et dates clés (keydates.js) ----
function volData() {
  const y = cache.macro.yields || {}, sp = MARKETS.find(m => m.slug === 'sp500');
  return VOL.volatility({ vix: y.vix, vix3m: y.vix3m, spx: sp && adjusted(sp).rows });
}

// ---- Calendrier du mois (monthcal.js) : saisonnalité commune ES / NQ / YM et annonces, heure de New York ----
// Mois proposés : du mois en cours (à New York) jusqu'au dernier mois couvert par les calendriers officiels, et au moins le mois suivant.
function calendarMonths(now = Date.now()) {
  const [y, m] = MONTHCAL.nyDate(now).split('-').map(Number), end = MONTHCAL.knownUntil(cache.macro.releases).slice(0, 7), out = [];
  for (let k = -6; k <= 12; k++) { const i = (m - 1) + k, yy = y + Math.floor(i / 12), mm = ((i % 12) + 12) % 12, key = yy + '-' + String(mm + 1).padStart(2, '0'); if (k > 1 && key > end) break; out.push(key); }
  return out;
}
const calMemo = new Map();
function calendarData(key, now = Date.now(), week = null) {
  const [y, m] = key.split('-').map(Number), today = MONTHCAL.nyDate(now);
  const series = {}; for (const [tag, slug] of [['ES', 'sp500'], ['NQ', 'nasdaq-100'], ['YM', 'dow-jones']]) { const mk = MARKETS.find(x => x.slug === slug); series[tag] = (mk && adjusted(mk).rows) || []; }
  const id = week || key, stamp = id + '|' + today + '|' + Object.values(series).map(s => s.length).join(',') + '|' + (cache.ts.macro.calendar || 0) + '|' + (cache.ts.macro.releases || 0), hit = calMemo.get(id);
  if (hit && hit.stamp === stamp) return hit.val;
  const opts = { series, caps: { YM: SEASON_CAPS['dow-jones'] }, ff: cache.macro.calendar || [], auto: cache.macro.releases || null, today };
  const months = calendarMonths(now), monday = MONTHCAL.nyDate(Date.parse(today + 'T12:00:00Z') - ((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7) * 864e5);
  const val = { months, today, thisWeek: monday, ...(week ? MONTHCAL.weekCalendar({ monday: week, ...opts }) : MONTHCAL.monthCalendar({ year: y, month: m - 1, ...opts })) };
  if (calMemo.size > 60) calMemo.clear();
  calMemo.set(id, { stamp, val });
  return val;
}

// ---- Protections : en-têtes de sécurité, limite de débit, validation des requêtes ----
// CSP stricte : ni script ni style en ligne, aucune ressource tierce.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
// Nombre de proxys de confiance devant le serveur (Render : 1). 0 = on ignore X-Forwarded-For (non falsifiable).
const TRUST_PROXY = +process.env.TRUST_PROXY || 0;
const RATE_WINDOW_MS = +process.env.RATE_WINDOW_MS || 60000;
const RATE_API = +process.env.RATE_API || 120, RATE_WEB = +process.env.RATE_WEB || 300;   // requêtes par fenêtre et par client
const MAX_URL = 2048;
let warnedProxy = false;
const limiter = createLimiter({ windowMs: RATE_WINDOW_MS });
setInterval(() => limiter.sweep(), RATE_WINDOW_MS).unref();

const server = http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
  const t0 = Date.now();
  res.on('finish', () => { if (req.url !== '/health') logRequest(req.method, req.url.slice(0, 120), res.statusCode, Date.now() - t0); });      // sans IP ni en-têtes
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.url.length > MAX_URL) return send(res, 414, '{"error":"URL trop longue"}');
  let u;
  try { u = new URL(req.url, 'http://x'); } catch { return send(res, 400, '{"error":"requête invalide"}'); }
  if (!TRUST_PROXY && req.headers['x-forwarded-for'] && !warnedProxy) {
    warnedProxy = true;
    console.log('ATTENTION : X-Forwarded-For reçu alors que TRUST_PROXY=0. Derrière un proxy (Render, nginx…), tous les visiteurs partageraient le même compteur de limite de débit : définissez TRUST_PROXY=1.');
  }
  if (u.pathname !== '/health') {                                            // /health reste libre pour les sondes de supervision
    const api = u.pathname.startsWith('/api/');
    const r = limiter.hit(clientIp(req, TRUST_PROXY) + (api ? '|api' : '|web'), api ? RATE_API : RATE_WEB);
    res.setHeader('RateLimit-Limit', r.limit); res.setHeader('RateLimit-Remaining', r.remaining);
    if (!r.ok) { res.setHeader('Retry-After', r.retryAfter); return send(res, 429, '{"error":"trop de requêtes, réessayez dans quelques instants"}'); }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return send(res, 405, '{"error":"méthode non autorisée"}'); }
  try {
    if (u.pathname === '/health') return send(res, 200, '{"ok":true}');
    if (u.pathname === '/favicon.ico') { res.writeHead(301, { Location: '/favicon.svg' }); return res.end(); }
    if (u.pathname === '/api/status') {                                       // sans « code » : résumé global ; avec « code » : un marché
      const c = u.searchParams.get('code');
      if (!c) return send(res, 200, JSON.stringify(statusSummary()));
      return BY_CODE[c] ? send(res, 200, JSON.stringify({ now: Date.now(), ...status(BY_CODE[c]), lastRefresh: cache.lastRefresh || null })) : send(res, 400, '{"error":"marché inconnu"}');
    }
    if (u.pathname === '/api/screener') return send(res, 200, JSON.stringify(screener()));
    if (u.pathname === '/api/intermarket') return send(res, 200, JSON.stringify(intermarket()));
    if (u.pathname === '/api/ratios') return send(res, 200, JSON.stringify(ratiosData()));
    if (u.pathname === '/api/volatility') { await macroData('yields').catch(() => {}); return send(res, 200, JSON.stringify({ updated: cache.ts.macro.yields || 0, vol: volData() })); }
    if (u.pathname === '/api/calendrier') {                                    // ?m=AAAA-MM (mois, mois en cours par défaut) ou ?w=AAAA-MM-JJ (semaine commençant ce lundi)
      const months = calendarMonths(), cur = MONTHCAL.nyDate(Date.now()).slice(0, 7), w = u.searchParams.get('w');
      if (w != null) {
        const t = Date.parse(w + 'T00:00:00Z');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(w) || !isFinite(t) || new Date(t).getUTCDay() !== 1) return send(res, 400, JSON.stringify({ error: 'semaine : un lundi au format AAAA-MM-JJ', months }));
        if (!months.includes(w.slice(0, 7)) && !months.includes(new Date(t + 6 * 864e5).toISOString().slice(0, 7))) return send(res, 400, JSON.stringify({ error: 'semaine non disponible', months }));
        await macroData('calendar').catch(() => {}); macroData('releases').catch(() => {});
        return send(res, 200, JSON.stringify(calendarData(w.slice(0, 7), Date.now(), w)));
      }
      const key = u.searchParams.get('m') || cur;
      if (!months.includes(key)) return send(res, 400, JSON.stringify({ error: 'mois non disponible', months }));
      await macroData('calendar').catch(() => {}); macroData('releases').catch(() => {});
      return send(res, 200, JSON.stringify(calendarData(key)));
    }
    if (u.pathname === '/api/keydates') return send(res, 200, JSON.stringify(KEYDATES.keyDates(Date.now(), 6)));
    if (u.pathname === '/api/macro') {                                          // inflation ou taux : ?kind=cpi | rates
      const kind = u.searchParams.get('kind');
      if (kind !== 'cpi' && kind !== 'rates') return send(res, 400, '{"error":"kind : cpi ou rates"}');
      // Jamais d'attente ici : le rafraîchissement OCDE dure quelques minutes. On sert le cache et on relance la mise à jour en arrière-plan.
      const data = cache.macro[kind] || null;
      macroData(kind).catch(() => {});
      return send(res, 200, JSON.stringify({ updated: cache.ts.macro[kind] || 0, areas: MACRO.AREAS, data, loading: !data && Date.now() - (macroFail[kind] || 0) >= MACRO_RETRY_MS }));
    }
    if (u.pathname === '/api/yields') { const y = await macroData('yields'); return send(res, 200, JSON.stringify({ updated: cache.ts.macro.yields || 0, data: y })); }
    if (u.pathname === '/api/calendar') { const ev = await macroData('calendar'); return send(res, 200, JSON.stringify({ updated: cache.ts.macro.calendar || 0, events: ev || [] })); }
    if (u.pathname === '/api/debrief') {                                        // ?slug=… : synthèse du jour d'un marché
      const m = MARKETS.find(x => x.slug === u.searchParams.get('slug'));
      if (!m) return send(res, 400, '{"error":"marché inconnu"}');
      await macroData('calendar');                                                // rapide, indispensable
      await macroData('yields');                                                              // FRED : rapide et fiable
      for (const n of ['cpi', 'rates']) macroData(n).catch(() => {});                        // l'OCDE est lente et capricieuse : le debrief n'attend pas, il utilise ce qui est en cache
      const row = screener().rows.find(r => r.slug === m.slug);
      let inter = null;                                                           // intermarchés : indices uniquement
      if (m.group === 'Indices') { const series = {}; for (const s of [m.slug, ...INTER.DRIVERS]) { const mm = MARKETS.find(x => x.slug === s); if (mm && cache.daily[mm.code]) series[s] = adjusted(mm).rows; } inter = { vol: volData(), keyDates: KEYDATES.keyDates(Date.now(), 2).dates, ...(INTER.profile(m, series, CALC.correlation) || {}), regime: intermarket().regime, ratios: ratiosData().ratios.map(({ series: _s, ...r }) => r) }; }
      return send(res, 200, JSON.stringify(debrief({ market: m, row, macro: macroSnapshot(), events: cache.macro.calendar || [], now: Date.now(), daily: adjusted(m).rows, inter })));
    }
    if (u.pathname.startsWith('/api/')) {
      const m = BY_CODE[u.searchParams.get('code')];
      if (!m) return send(res, 400, '{"error":"marché inconnu"}');
      const k = m.code;
      if (u.pathname === '/api/prices') { await fresh('weekly', k, REFRESH_MS, refreshWeekly); return send(res, 200, JSON.stringify({ updated: cache.ts.weekly[k] || 0, data: cache.weekly[k] })); }
      if (u.pathname === '/api/daily') { await fresh('daily', k, DAILY_MS, refreshDaily); return send(res, 200, JSON.stringify({ updated: cache.ts.daily[k] || 0, data: cache.daily[k] })); }
      if (u.pathname === '/api/seasonal') {
        await fresh('daily', k, DAILY_MS, refreshDaily);
        const json = seasonalJson(k);
        return json ? send(res, 200, json) : send(res, 502, '{"error":"historique de prix insuffisant"}');
      }
      if (u.pathname === '/api/cot') return send(res, 200, JSON.stringify(await fresh('cot', k, REFRESH_MS, refreshCot)));
      if (u.pathname === '/api/tff') {
        if (!m.tff) return send(res, 404, '{"error":"pas de rapport TFF pour ce marché"}');
        return send(res, 200, JSON.stringify(await fresh('tff', k, REFRESH_MS, refreshTff)));
      }
      if (u.pathname === '/api/disagg') {
        if (!m.disagg) return send(res, 404, '{"error":"pas de rapport Disaggregated pour ce marché"}');
        return send(res, 200, JSON.stringify(await fresh('disagg', k, REFRESH_MS, refreshDisagg)));
      }
      return send(res, 404, '{"error":"not found"}');
    }
    const s = STATIC[u.pathname];
    if (s) return send(res, 200, fs.readFileSync(path.join(__dirname, s[0])), s[1]);
    const [, section, slug] = u.pathname.split('/');
    if (u.pathname === '/screener') return send(res, 200, fs.readFileSync(path.join(__dirname, 'screener.html')), 'text/html');
    if (u.pathname === '/a-propos') return send(res, 200, docPage('about.html'), 'text/html');
    if (u.pathname === '/themes') return send(res, 200, fs.readFileSync(path.join(__dirname, 'themes.html')), 'text/html');
    if (u.pathname === '/inflation' || u.pathname === '/taux') return send(res, 200, fs.readFileSync(path.join(__dirname, u.pathname === '/inflation' ? 'inflation.html' : 'rates.html')), 'text/html');
    if (u.pathname === '/calendrier') return send(res, 200, fs.readFileSync(path.join(__dirname, 'calendar.html')), 'text/html');
    if (u.pathname === '/intermarket') return send(res, 200, fs.readFileSync(path.join(__dirname, 'intermarket.html')), 'text/html');
    if (u.pathname === '/compare') return send(res, 200, fs.readFileSync(path.join(__dirname, 'compare.html')), 'text/html');
    if (SCRIPTS.has(section) && !slug) return send(res, 200, fs.readFileSync(path.join(__dirname, section)), 'text/javascript');
    // Une seule page combinée par marché ; les anciennes adresses y redirigent.
    if (u.pathname === '/' || ['market', 'cot-report', 'seasonal-tendencies'].includes(section)) {
      const known = MARKETS.some(m => m.slug === slug);
      if (section !== 'market' || !slug) { res.writeHead(302, { Location: `/market/${known ? slug : DEFAULT_SLUG}` }); return res.end(); }
      if (known) return send(res, 200, fs.readFileSync(path.join(__dirname, 'market.html')), 'text/html');
    }
    send(res, 404, '{"error":"not found"}');
  } catch (e) { log('erreur', u.pathname, e.message); send(res, 502, JSON.stringify({ error: 'source indisponible' })); }
});
// Délais : évite les connexions lentes qui occupent le serveur (slowloris) et les requêtes qui traînent.
server.headersTimeout = 10000; server.requestTimeout = 15000; server.keepAliveTimeout = 5000; server.maxRequestsPerSocket = 1000;
server.on('error', e => { if (e.code === 'EADDRINUSE') { log('ERREUR : le port ' + PORT + ' est déjà utilisé (une autre instance tourne ?). Arrêtez-la ou lancez avec un autre port : PORT=8124 npm start'); process.exit(1); } throw e; });
server.listen(PORT, () => { log('BullDesk sur le port', PORT); cacheSummary(); logV('config : données dans ' + DATA_DIR + ', mise à jour toutes les ' + REFRESH_MS / 36e5 + ' h' + (process.env.NO_REFRESH ? ' (désactivée)' : '') + ', TRUST_PROXY=' + TRUST_PROXY); });
process.on('unhandledRejection', e => log('rejet non géré :', e && e.message));

// Rafraîchissement automatique : au démarrage si le cache est périmé, puis à intervalle régulier.
const stale = MARKETS.some(m => Date.now() - (cache.ts.weekly[m.code] || 0) > REFRESH_MS || !cache.weekly[m.code] || !cache.cot[m.code] || !cache.daily[m.code] || cache.daily[m.code][0].length < 4 || (m.disagg && !cache.disagg[m.code]) || (ADJ.CASH[m.slug] && !cache.cash[m.code]));
if (!process.env.NO_REFRESH) {
  // Le débrief a besoin du calendrier et des séries FRED : on les charge tout de suite, sans attendre la mise à jour des 37 marchés (environ 2 min).
  for (const n of ['calendar', 'yields', 'releases']) macroData(n).catch(() => {});
  logV(stale ? 'cache incomplet ou périmé : mise à jour au démarrage' : 'cache à jour : prochaine mise à jour dans ' + REFRESH_MS / 36e5 + ' h');
  if (stale) refreshAll();
  setInterval(refreshAll, REFRESH_MS);
}

// Arrêt propre : ferme la base pour ne rien perdre (Render envoie SIGTERM à chaque redéploiement).
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); try { store.close(); } catch {} process.exit(0); });
