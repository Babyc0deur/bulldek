// Évalue si les données d'un marché sont à jour. Fonction pure (horloge injectée) : utilisable par le serveur et testable seule.
// Deux notions distinctes : l'âge de la DONNÉE (dernière séance, date du dernier rapport COT) et l'âge de notre DERNIÈRE MISE À JOUR
// (si le serveur n'a pas pu rafraîchir depuis 2 jours, quelque chose ne va pas même si la donnée semble récente).
const CALC = require('./calc.js');
const DAY = 864e5, HOUR = 36e5;

const LIMITS = {
  sessionMaxAge: 4 * DAY,      // âge maximal de la dernière séance, mesuré à la fin de cette séance : couvre un week-end de 3 jours + 1 jour de retard
  fetchMaxAge: 2 * DAY,        // âge maximal de notre dernière mise à jour réussie (prix comme COT)
  cotOverdueGrace: 30 * HOUR,  // délai toléré après l'heure officielle de publication (cycle de mise à jour de 6 h + marge)
};

// entrée : { now, lastSession (ms, jour de la dernière séance), pricesAt (ms), reportDate ('AAAA-MM-JJ', mardi des dernières positions),
//            cotAt (ms), errors: [{ store, at, msg }] }
function assess({ now, lastSession, pricesAt, reportDate, cotAt, errors = [] }) {
  const prices = { lastSession: lastSession ?? null, updatedAt: pricesAt || null, missing: lastSession == null, stale: false, reason: null };
  if (!prices.missing) {
    if (now - (lastSession + DAY) > LIMITS.sessionMaxAge) { prices.stale = true; prices.reason = 'session'; }        // la donnée elle-même est ancienne
    else if (now - (pricesAt || 0) > LIMITS.fetchMaxAge) { prices.stale = true; prices.reason = 'fetch'; }           // notre mise à jour est ancienne
  }
  const cot = { reportDate: reportDate ?? null, updatedAt: cotAt || null, missing: reportDate == null, stale: false, reason: null, next: null };
  if (!cot.missing) {
    cot.next = CALC.nextCotRelease(reportDate, now);                                                                 // publication attendue, jours fériés compris
    if (now - cot.next.at > LIMITS.cotOverdueGrace) { cot.stale = true; cot.reason = 'overdue'; }                    // le rapport attendu n'est pas arrivé
    else if (now - (cotAt || 0) > LIMITS.fetchMaxAge) { cot.stale = true; cot.reason = 'fetch'; }
  }
  const level = prices.missing || cot.missing ? 'bad' : prices.stale || cot.stale || errors.length ? 'warn' : 'ok';
  return { level, prices, cot, errors };
}

module.exports = { assess, LIMITS };
