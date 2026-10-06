// Dates officielles à venir, lues automatiquement (module serveur uniquement) : plus aucune saisie manuelle pour le calendrier des indices.
//  - FRED (Réserve fédérale de Saint-Louis), API avec clé gratuite (variable d'environnement FRED_API_KEY) : dates de publication programmées
//    des grandes statistiques américaines (BLS, BEA, Census, Département du Travail, Université du Michigan) ;
//  - Fed : page publique des réunions du FOMC (sans clé).
// Les heures (New York) sont celles, fixes, de chaque publication ; Forex Factory les confirme la semaine même.
const FRED_API = 'https://api.stlouisfed.org/fred/release/dates';
const FOMC_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
// type d'annonce (monthcal.js → KINDS) : [identifiant de publication FRED, heure de New York]
const RELEASES = {
  nfp: [50, '08:30'], cpi: [10, '08:30'], ppi: [46, '08:30'], retail: [9, '08:30'], gdp: [53, '08:30'], pce: [54, '08:30'],
  jolts: [192, '10:00'], eci: [11, '08:30'], claims: [180, '08:30'], starts: [27, '08:30'], newhome: [97, '10:00'], trade: [51, '08:30'],
  importprices: [188, '08:30'], productivity: [47, '08:30'], umich: [91, '10:00'],
};

// Adresse FRED : dates de publication d'une statistique à partir de `from` (AAAA-MM-JJ), y compris les dates futures sans données encore.
const fredUrl = (key, rid, from) => `${FRED_API}?release_id=${rid}&api_key=${encodeURIComponent(key)}&file_type=json&realtime_start=${from}&realtime_end=9999-12-31`
  + '&include_release_dates_with_no_data=true&sort_order=asc&limit=1000';
// Réponse FRED → dates AAAA-MM-JJ à partir de `from`, triées, sans doublon.
function parseFredDates(json, from = '0000-00-00') {
  if (!json || !Array.isArray(json.release_dates)) throw new Error('réponse FRED inattendue' + (json && json.error_message ? ' : ' + String(json.error_message).slice(0, 80) : ''));
  return [...new Set(json.release_dates.map(r => String(r.date)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= from))].sort();
}

// Page des réunions du FOMC → ['AAAA-MM-JJ' (jour de la décision, 2e jour), suivi de « * » si projections économiques].
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseFomcPage(html) {
  const out = [], parts = String(html).split(/(\d{4}) FOMC Meetings/);
  for (let i = 1; i < parts.length; i += 2) {
    const year = +parts[i], body = parts[i + 1].split(/FOMC Meetings|panel-footer/)[0];
    for (const m of body.matchAll(/fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>\s*<\/div>\s*<div[^>]*fomc-meeting__date[^>]*>([^<]+)</g)) {
      const months = m[1].trim().toLowerCase().split('/').map(s => MONTHS[s.slice(0, 3)]), date = m[2].trim();
      const d = /^(\d{1,2})(?:-(\d{1,2}))?(\*)?$/.exec(date.replace(/\s/g, ''));
      if (!d || months.some(x => x == null)) continue;                                   // réunion exceptionnelle, vote par écrit… : ignorés
      const day = +(d[2] || d[1]), mon = d[2] && months.length > 1 && +d[2] < +d[1] ? months[1] : months[months.length > 1 && !d[2] ? 1 : 0];
      out.push(new Date(Date.UTC(year, mon, day)).toISOString().slice(0, 10) + (d[3] ? '*' : ''));
    }
  }
  return [...new Set(out)].sort();
}

// Assemble le résultat stocké en cache : { at, fomc: [...], events: [[date, heure, type]], sources: {...} }.
function build({ fred = {}, fomc = [] }, now = Date.now()) {
  const events = [];
  for (const [kind, dates] of Object.entries(fred)) for (const d of dates) events.push([d, RELEASES[kind][1], kind]);
  events.sort((a, b) => a[0].localeCompare(b[0]));
  return { at: now, fomc, events, sources: { fred: Object.keys(fred).length, fomc: fomc.length } };
}

module.exports = { RELEASES, FOMC_URL, fredUrl, parseFredDates, parseFomcPage, build };
