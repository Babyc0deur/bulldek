// Données macroéconomiques : inflation (CPI) et taux d'intérêt de l'OCDE, calendrier des annonces économiques.
// Ce module ne fait aucun appel réseau : il construit les adresses et analyse les réponses (le serveur fait les appels).
const OECD = 'https://sdmx.oecd.org/public/rest/data/';
const CPI_FLOW = 'OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0', KEI_FLOW = 'OECD.SDD.STES,DSD_KEI@DF_KEI,4.0';

// Zones proposées (code OCDE) → nom, devise du calendrier économique.
const AREAS = [
  { code: 'USA', name: 'États-Unis', ccy: 'USD' }, { code: 'EA20', name: 'Zone euro', ccy: 'EUR' }, { code: 'DEU', name: 'Allemagne', ccy: 'EUR' },
  { code: 'FRA', name: 'France', ccy: 'EUR' }, { code: 'ITA', name: 'Italie', ccy: 'EUR' }, { code: 'GBR', name: 'Royaume-Uni', ccy: 'GBP' },
  { code: 'JPN', name: 'Japon', ccy: 'JPY' }, { code: 'CAN', name: 'Canada', ccy: 'CAD' }, { code: 'AUS', name: 'Australie', ccy: 'AUD' },
  { code: 'NZL', name: 'Nouvelle-Zélande', ccy: 'NZD' }, { code: 'CHE', name: 'Suisse', ccy: 'CHF' }, { code: 'CHN', name: 'Chine', ccy: 'CNY' },
  { code: 'IND', name: 'Inde', ccy: 'INR' }, { code: 'BRA', name: 'Brésil', ccy: 'BRL' }, { code: 'MEX', name: 'Mexique', ccy: 'MXN' },
  { code: 'TUR', name: 'Turquie', ccy: 'TRY' }, { code: 'ZAF', name: 'Afrique du Sud', ccy: 'ZAR' }, { code: 'KOR', name: 'Corée du Sud', ccy: 'KRW' },
  { code: 'IDN', name: 'Indonésie', ccy: 'IDR' },
];
const AREA_CODES = AREAS.map(a => a.code);

// Devise principale de chaque marché (les autres sont cotés en dollars). Sert à choisir l'inflation, les taux et les annonces pertinents.
const MARKET_CCY = { 'euro-fx': 'EUR', 'british-pound': 'GBP', 'japanese-yen': 'JPY', 'canadian-dollar': 'CAD', 'swiss-franc': 'CHF', 'australian-dollar': 'AUD', 'new-zealand-dollar': 'NZD' };
const marketCurrencies = slug => (MARKET_CCY[slug] ? [MARKET_CCY[slug], 'USD'] : ['USD']);
const areaOfCcy = ccy => (AREAS.find(a => a.ccy === ccy && a.code !== 'DEU' && a.code !== 'FRA' && a.code !== 'ITA') || {}).code;

// ---- Adresses (une seule requête groupée par jeu de données : l'API de l'OCDE limite fortement le nombre d'appels) ----
const since = (now, years) => `${new Date(now).getUTCFullYear() - years}-01`;
// L'API répond « 500 » au-delà d'environ 7 zones par requête : les zones sont groupées par lots.
const CHUNK = 7, chunks = () => Array.from({ length: Math.ceil(AREA_CODES.length / CHUNK) }, (_, i) => AREA_CODES.slice(i * CHUNK, (i + 1) * CHUNK));
const cpiUrls = (now = Date.now(), years = 6) => chunks().map(c => `${OECD}${CPI_FLOW}/${c.join('+')}.M.N.CPI.PA._T.N.GY+G1?startPeriod=${since(now, years)}&format=csv`);
const ratesUrls = (now = Date.now(), years = 6) => chunks().map(c => `${OECD}${KEI_FLOW}/${c.join('+')}.M.IRSTCI+IR3TIB+IRLT.PA....?startPeriod=${since(now, years)}&format=csv`);
const merge = (parts, keys) => { const o = Object.fromEntries(keys.map(k => [k, {}])); for (const p of parts) for (const k of keys) Object.assign(o[k], p[k]); return o; };
const mergeCpi = parts => merge(parts, ['yoy', 'mom']), mergeRates = parts => merge(parts, ['immediate', 'short', 'long']);
const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json', CALENDAR_NEXT_URL = 'https://nfs.faireconomy.media/ff_calendar_nextweek.json';

// ---- Analyse du CSV SDMX de l'OCDE ----
function parseCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  const head = lines[0].split(',');
  if (!head.includes('TIME_PERIOD') || !head.includes('OBS_VALUE')) throw new Error('réponse OCDE inattendue');
  return lines.slice(1).filter(Boolean).map(l => { const c = l.split(','); return Object.fromEntries(head.map((h, i) => [h, c[i]])); });
}
// → { zone: { clé: [[période « AAAA-MM », valeur], …] } } trié par période ; `keyField` = colonne qui distingue les séries.
function groupSeries(text, keyField) {
  const out = {};
  for (const r of parseCsv(text)) {
    const v = parseFloat(r.OBS_VALUE);
    if (!/^\d{4}-\d{2}$/.test(r.TIME_PERIOD) || !isFinite(v)) continue;
    ((out[r.REF_AREA] ||= {})[r[keyField]] ||= []).push([r.TIME_PERIOD, Math.round(v * 1000) / 1000]);
  }
  for (const z of Object.values(out)) for (const k of Object.keys(z)) z[k].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}
// Inflation : glissement annuel (GY) et variation mensuelle (G1). Taux : immédiat (IRSTCI), court terme 3 mois (IR3TIB), long terme (IRLT).
function parseCpi(text) {
  const g = groupSeries(text, 'TRANSFORMATION'), out = { yoy: {}, mom: {} };
  for (const [a, s] of Object.entries(g)) { if (s.GY) out.yoy[a] = s.GY; if (s.G1) out.mom[a] = s.G1; }
  return out;
}
function parseRates(text) {
  const g = groupSeries(text, 'MEASURE'), out = { immediate: {}, short: {}, long: {} };
  for (const [a, s] of Object.entries(g)) { if (s.IRSTCI) out.immediate[a] = s.IRSTCI; if (s.IR3TIB) out.short[a] = s.IR3TIB; if (s.IRLT) out.long[a] = s.IRLT; }
  return out;
}

// ---- Calendrier économique ----
const IMPACTS = ['High', 'Medium', 'Low', 'Holiday'];
function parseCalendar(list) {
  if (!Array.isArray(list)) throw new Error('calendrier inattendu');
  return list.map(e => ({ t: Date.parse(e.date), ccy: String(e.country || ''), title: String(e.title || ''), impact: IMPACTS.includes(e.impact) ? e.impact : 'Low', forecast: String(e.forecast || ''), previous: String(e.previous || '') }))
    .filter(e => isFinite(e.t) && e.ccy && e.title).sort((a, b) => a.t - b.t);
}
// Annonces à venir (ou de la journée) pour des devises données, importance moyenne ou forte uniquement.
function upcoming(events, ccys, now, hours = 48, back = 12) {
  return (events || []).filter(e => ccys.includes(e.ccy) && (e.impact === 'High' || e.impact === 'Medium') && e.t >= now - back * 36e5 && e.t <= now + hours * 36e5).sort((a, b) => a.t - b.t);
}

// Fenêtre d'analyse du debrief. Du vendredi 22 h UTC au dimanche 22 h UTC les marchés à terme sont fermés : le debrief repose sur la clôture
// du vendredi et l'agenda regarde vers la semaine qui s'ouvre (jusqu'au samedi suivant). Le reste du temps : 12 h en arrière, 48 h en avant.
function horizon(now) {
  const d = new Date(now), day = d.getUTCDay(), h = d.getUTCHours();
  const weekend = day === 6 || (day === 0 && h < 22) || (day === 5 && h >= 22);
  if (!weekend) return { weekend: false, hours: 48, back: 0 + 12 };
  const monday = ((1 - day + 7) % 7) || 7, start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + monday), end = start + 5 * 864e5;   // samedi 00 h UTC : fin de la semaine qui s'ouvre
  const mon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((day - 1 + 7) % 7));       // lundi 00 h UTC : début du bilan de la semaine écoulée
  return { weekend: true, hours: Math.max(1, (end - now) / 36e5), back: 0, start, recapHours: (now - mon) / 36e5 };
}

// Annonces déjà publiées (bilan) : importance moyenne ou forte, devises données, dans les `hours` dernières heures.
const recent = (events, ccys, now, hours) => (events || []).filter(e => ccys.includes(e.ccy) && (e.impact === 'High' || e.impact === 'Medium') && e.t < now && e.t >= now - hours * 36e5).sort((a, b) => a.t - b.t);

// ---- Lectures simples d'une série [[période, valeur]] ----
const lastOf = s => (s && s.length ? s[s.length - 1] : null);
const back = (s, n) => (s && s.length > n ? s[s.length - 1 - n] : null);

module.exports = { AREAS, AREA_CODES, MARKET_CCY, marketCurrencies, areaOfCcy, cpiUrls, ratesUrls, mergeCpi, mergeRates, CALENDAR_URL, CALENDAR_NEXT_URL, parseCsv, groupSeries, parseCpi, parseRates, parseCalendar, upcoming, recent, horizon, lastOf, back };
