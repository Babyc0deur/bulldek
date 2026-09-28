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
};
const SCRIPTS = new Set(['macroview.js', 'debriefview.js', 'shared.js', 'cot.js', 'seasonal.js', 'wr.js', 'calc.js', 'screener.js', 'market.js', 'compare.js', 'theme.js', 'gallery.js', 'oi.js']);

const CFTC = 'https://publicreporting.cftc.gov/resource/';
const YIELDS = require('./yields.js'), MACRO = require('./macro.js'), { debrief } = require('./debrief.js');
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
async function refreshDaily(code) {
  const res = await yahoo(BY_CODE[code].yahoo, '20y', '1d'), q = res.indicators.quote[0], r = v => +v.toFixed(4);
  // [timestamp, clôture, plus haut, plus bas]
  commit('daily', code, res.timestamp.map((t, i) => [t, q.close[i], q.high[i], q.low[i]]).filter(p => p[1] != null && p[2] != null && p[3] != null).map(p => [p[0], r(p[1]), r(p[2]), r(p[3])]));
}

// ---- COT ----
async function fetchCot(dataset, fields, code) {
  const url = `${CFTC}${dataset}.json?$select=${fields.join(',')}&$order=report_date_as_yyyy_mm_dd DESC&$limit=800&$where=`
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
  for (const name of ['daily', 'weekly', 'cot', 'tff', 'disagg']) {
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
  for (const m of MARKETS) {
    const done = [];
    for (const [name, fn] of [['weekly', refreshWeekly], ...(dailyDue(m) ? [['daily', refreshDaily]] : []), ['cot', refreshCot], ...(m.tff ? [['tff', refreshTff]] : []), ...(m.disagg ? [['disagg', refreshDisagg]] : [])]) {
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
const MACRO_TTL = { cpi: 24 * 3600e3, rates: 24 * 3600e3, calendar: 3 * 3600e3, yields: 6 * 3600e3 };
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
  if (!value || (name === 'calendar' ? !value.length : !Object.keys(Object.values(value)[0] || {}).length)) throw new Error('vide');
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
    ROLL_PCT: Math.round(T.rollJump * 100), ROLL_WINDOW: T.rollWindow, CONF: T.confluenceStrong, OI_FLAT_PCT: T.oiFlatPct, PRICE_FLAT_PCT: T.priceFlatPct,
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
    attention: all.filter(x => x.level !== 'ok').map(x => ({ slug: x.slug, name: x.name, level: x.level })) };
}

// ---- Saisonnalité : rapport complet calculé une fois par jour et par marché, puis servi tel quel ----
const seasonalMemo = new Map();
function seasonalJson(code) {
  const d = cache.daily[code];
  if (!d || d.length < 300) return null;
  const now = new Date(), stamp = (cache.ts.daily[code] || 0) + '|' + d.length + '|' + now.toISOString().slice(0, 10);
  const hit = seasonalMemo.get(code);
  if (hit && hit.stamp === stamp) return hit.json;
  const json = '{"updated":' + (cache.ts.daily[code] || 0) + ',"report":' + JSON.stringify(CALC.seasonalReport(d, now)) + '}';
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

function screener() {
  if (scrMemo.val && Date.now() - scrMemo.at < 60e3) return scrMemo.val;
  const now = new Date(), nowY = now.getUTCFullYear();
  const rows = MARKETS.map(m => {
    const base = { slug: m.slug, name: m.name, group: m.group, fresh: status(m).level };
    const cot = cache.cot[m.code], d = cache.daily[m.code];
    if (!cot || !d || d.length < 30 || d[0].length < 4) return { ...base, missing: true };
    const net = cot.hist.map(r => r[1] - r[2]);                       // commerciaux : longs − shorts
    const TH = CALC.THRESHOLDS, idx6 = CALC.cotIndex(net, TH.cotShortWeeks).at(-1), idx36 = CALC.cotIndex(net, TH.cotLongWeeks).at(-1);
    const wr = CALC.williamsR(d, CALC.THRESHOLDS.wrPeriod), w = wr.at(-1)[1], last = d.at(-1), prev = d.at(-2);
    const season = CALC.seasonalWeek(d, now, 10, nowY);
    // Future continu non ajusté : un saut de plus de 10 % en une séance signale en général un changement de contrat,
    // qui fausse le Williams %R pendant 14 séances. On l'indique et on neutralise ce signal (sauf crypto, très volatile).
    const recent = d.slice(-TH.rollWindow), roll = m.group !== 'Crypto' && recent.some((r, i) => i && Math.abs(r[1] / recent[i - 1][1] - 1) > TH.rollJump);
    // Open interest : lecture de la dernière semaine (prix du mardi contre open interest). Un changement de contrat récent fausse la variation de prix : signal neutralisé.
    const oiw = CALC.oiWeek(cot.hist, d);
    const sig = { cot: CALC.cotSignal(idx6), season: CALC.seasonSignal(season), wr: roll ? 0 : CALC.wrSignal(w), oi: roll || !oiw ? 0 : CALC.oiSignal(oiw.reading) };
    return { ...base, price: last[1], priceDate: last[0], chgPct: (last[1] / prev[1] - 1) * 100, cotDate: cot.hist.at(-1)[0], netC: net.at(-1),
      idx6, idx36, wr: w, roll, season, sig, score: sig.cot + sig.season + sig.wr + sig.oi,
      oi: oiw ? { last: oiw.last, chgPct: oiw.chgPct, priceChgPct: oiw.priceChgPct, key: oiw.reading.key, label: oiw.reading.label } : null };
  });
  scrMemo = { at: Date.now(), val: { week: weekLabel(now), updated: Math.max(0, ...Object.values(cache.ts.daily)), rows } };
  return scrMemo.val;
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
    if (u.pathname === '/api/status') {                                       // sans « code » : résumé global ; avec « code » : un marché
      const c = u.searchParams.get('code');
      if (!c) return send(res, 200, JSON.stringify(statusSummary()));
      return BY_CODE[c] ? send(res, 200, JSON.stringify({ now: Date.now(), ...status(BY_CODE[c]), lastRefresh: cache.lastRefresh || null })) : send(res, 400, '{"error":"marché inconnu"}');
    }
    if (u.pathname === '/api/screener') return send(res, 200, JSON.stringify(screener()));
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
      return send(res, 200, JSON.stringify(debrief({ market: m, row, macro: macroSnapshot(), events: cache.macro.calendar || [], now: Date.now(), daily: cache.daily[m.code] })));
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
const stale = MARKETS.some(m => Date.now() - (cache.ts.weekly[m.code] || 0) > REFRESH_MS || !cache.weekly[m.code] || !cache.cot[m.code] || !cache.daily[m.code] || cache.daily[m.code][0].length < 4 || (m.disagg && !cache.disagg[m.code]));
if (!process.env.NO_REFRESH) {
  logV(stale ? 'cache incomplet ou périmé : mise à jour au démarrage' : 'cache à jour : prochaine mise à jour dans ' + REFRESH_MS / 36e5 + ' h');
  if (stale) refreshAll();
  setInterval(refreshAll, REFRESH_MS);
}

// Arrêt propre : ferme la base pour ne rien perdre (Render envoie SIGTERM à chaque redéploiement).
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); try { store.close(); } catch {} process.exit(0); });
