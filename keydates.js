// Dates clés pour les indices (module serveur uniquement) : FOMC, inflation (CPI), emploi (NFP), échéances et roll des futures sur indices.
// Les dates des banques et agences sont celles des calendriers officiels publiés (à mettre à jour chaque année) :
//  - FOMC : federalreserve.gov/monetarypolicy/fomccalendars.htm (2026 et 2027) ; * = réunion avec projections économiques (SEP) ;
//  - CPI : bls.gov/schedule/news_release/cpi.htm (publié jusqu'à décembre 2026) ;
//  - NFP (Employment Situation) : bls.gov/schedule/news_release/empsit.htm (publié jusqu'à décembre 2026).
// Les échéances des futures et options sur indices sont calculées par règle (3e vendredi ; veille ouvrée si la Bourse est fermée).
const CALC = require('./calc.js');

const FOMC = ['2026-01-28', '2026-03-18*', '2026-04-29', '2026-06-17*', '2026-07-29', '2026-09-16*', '2026-10-28', '2026-12-09*',
  '2027-01-27', '2027-03-17*', '2027-04-28', '2027-06-09*', '2027-07-28', '2027-09-15*', '2027-10-27', '2027-12-08*'];       // jour de la décision (2e jour)
const CPI = ['2026-01-13', '2026-02-13', '2026-03-11', '2026-04-10', '2026-05-12', '2026-06-10', '2026-07-14', '2026-08-12', '2026-09-11', '2026-10-14', '2026-11-10', '2026-12-10'];
const NFP = ['2026-01-09', '2026-02-11', '2026-03-06', '2026-04-03', '2026-05-08', '2026-06-05', '2026-07-02', '2026-08-07', '2026-09-04', '2026-10-02', '2026-11-06', '2026-12-04'];
const OFFICIAL_UNTIL = { fomc: '2027-12-31', cpi: '2026-12-31', nfp: '2026-12-31' };

const DAY = 864e5, ymd = t => new Date(t).toISOString().slice(0, 10);
// Vendredi saint (Bourse de New York fermée, pas un jour férié fédéral) : algorithme de Pâques grégorien.
function goodFriday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(Date.UTC(y, month - 1, day) - 2 * DAY);
}
const closed = (t) => { const d = new Date(t), y = d.getUTCFullYear(), w = d.getUTCDay(); return w === 0 || w === 6 || CALC.usFederalHolidays(y).has(ymd(t)) || goodFriday(y) === ymd(t); };
// 3e vendredi du mois ; si la Bourse est fermée ce jour-là, la veille ouvrée.
function expiration(y, m) {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  let t = Date.UTC(y, m, 1 + ((5 - first + 7) % 7) + 14);
  while (closed(t)) t -= DAY;
  return t;
}

// Dates clés entre `from` (ms) et `from + months` mois : [{ date, kind, label, detail }], triées.
function keyDates(from = Date.now(), months = 6) {
  const start = ymd(from), endT = new Date(from); endT.setUTCMonth(endT.getUTCMonth() + months); const end = ymd(+endT);
  const out = [];
  const add = (date, kind, label, detail) => { if (date >= start && date <= end) out.push({ date, kind, label, detail }); };
  for (const f of FOMC) { const d = f.slice(0, 10), sep = f.endsWith('*'); add(d, 'fomc', 'Décision de la Fed (FOMC)', 'Décision à 14 h (heure de New York), conférence de presse à 14 h 30' + (sep ? ' ; avec projections économiques et « dot plot »' : '') + '.'); }
  for (const d of CPI) add(d, 'cpi', 'Inflation américaine (CPI)', 'Publication à 8 h 30 (heure de New York).');
  for (const d of NFP) add(d, 'nfp', 'Emploi américain (NFP)', 'Rapport sur l\'emploi, publication à 8 h 30 (heure de New York).');
  const y0 = new Date(from).getUTCFullYear();
  for (let y = y0; y <= y0 + 1; y++) for (let m = 0; m < 12; m++) {
    const t = expiration(y, m);
    if (m % 3 === 2) {
      add(ymd(t), 'quad', 'Échéance trimestrielle (« quadruple witching »)', 'Expiration simultanée des futures et options sur indices et sur actions : volumes élevés, mouvements parfois erratiques en fin de séance.');
      let roll = t - 8 * DAY; while (closed(roll)) roll -= DAY;           // date de roll CME : 8 jours avant l'échéance (jeudi de la semaine précédente)
      add(ymd(roll), 'roll', 'Roll des futures sur indices', 'Le volume passe au contrat suivant : à partir de cette date, le contrat de référence change (ES, NQ, YM, RTY).');
    } else add(ymd(t), 'opex', 'Échéance mensuelle des options', 'Expiration des options mensuelles sur indices et actions.');
  }
  return { from: start, to: end, officialUntil: OFFICIAL_UNTIL, dates: out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind)) };
}

module.exports = { FOMC, CPI, NFP, OFFICIAL_UNTIL, goodFriday, expiration, keyDates };
