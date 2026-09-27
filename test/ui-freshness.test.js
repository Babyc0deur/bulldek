// Affichage de l'indicateur de fraîcheur et du compte à rebours (fonctions de shared.js, exécutées dans Node).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const CALC = require('../calc.js'), { LIMITS } = require('../freshness.js');

const BD = new Function(fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8') + '\nreturn BD;')();
const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });
const T = s => Date.parse(s + 'Z');
const withStatus = async (payload, code) => {                        // exécute freshness() avec une réponse d'API simulée
  const real = global.fetch, el = { innerHTML: 'AVANT' };
  global.fetch = async () => ({ ok: true, json: async () => payload });
  try { await BD.freshness(el, code); } finally { global.fetch = real; }
  return el.innerHTML;
};
const NOW = T('2026-09-26T12:00:00');
const sain = { now: NOW, level: 'ok', prices: { lastSession: T('2026-09-25T00:00:00'), updatedAt: NOW - 3 * 36e5, missing: false, stale: false }, cot: { reportDate: '2026-09-22', updatedAt: NOW - 3 * 36e5, missing: false, stale: false, next: { releaseDate: '2026-10-02' } }, errors: [] };

test('pastille « à jour » : dates de séance et de positions, ancienneté de la mise à jour', async () => {
  const h = await withStatus(sain, '209742');
  assert.match(h, /class="fresh ok"/); assert.match(h, /role="status"/); assert.match(h, /Données à jour/);
  assert.match(h, /séance du 25\/09/); assert.match(h, /positions du 22\/09/); assert.match(h, /actualisé il y a 3 h/);
  assert.doesNotMatch(h, / — /);                                                       // aucune alerte à énumérer
});

test('pastille « à vérifier » : chaque problème est nommé, la couleur n\'est pas le seul indice', async () => {
  const h = await withStatus({ ...sain, level: 'warn', prices: { ...sain.prices, stale: true, reason: 'fetch' }, cot: { ...sain.cot, stale: true, reason: 'overdue' },
    errors: [{ store: 'daily', at: NOW - 2 * 36e5, msg: '429' }] }, '209742');
  assert.match(h, /class="fresh warn"/); assert.match(h, /Données à vérifier/);
  assert.match(h, /prix non actualisés depuis plus de 2 jours/); assert.match(h, /rapport COT du 02\/10 non reçu/); assert.match(h, /échec de mise à jour \(daily\) il y a 2 h/);
});

test('pastille « indisponible » : marché sans données', async () => {
  const h = await withStatus({ now: NOW, level: 'bad', prices: { missing: true }, cot: { missing: true }, errors: [] }, '209742');
  assert.match(h, /class="fresh bad"/); assert.match(h, /Prix : indisponibles/); assert.match(h, /COT : indisponible/);
});

test('résumé global (screener) : nombre de marchés à jour et liste de ceux à vérifier', async () => {
  const ok = await withStatus({ now: NOW, lastRefresh: NOW - 36e5, markets: { total: 37, ok: 37, warn: 0, bad: 0 }, attention: [] });
  assert.match(ok, /fresh ok/); assert.match(ok, /37\/37 marchés à jour/); assert.match(ok, /actualisation il y a 1 h/);
  const warn = await withStatus({ now: NOW, lastRefresh: NOW - 36e5, markets: { total: 37, ok: 35, warn: 1, bad: 1 }, attention: [{ name: 'Lean Hogs', level: 'warn' }, { name: 'Wheat', level: 'bad' }] });
  assert.match(warn, /fresh bad/); assert.match(warn, /35\/37/); assert.match(warn, /à vérifier : Lean Hogs, Wheat/);
});

test('l\'indicateur est facultatif : une erreur réseau le vide sans lever d\'exception', async () => {
  const real = global.fetch, el = { innerHTML: 'AVANT' };
  global.fetch = async () => { throw new Error('réseau'); };
  try { await BD.freshness(el, '209742'); } finally { global.fetch = real; }
  assert.equal(el.innerHTML, '');
  assert.equal(await BD.freshness(null, 'x'), undefined);                              // élément absent : ignoré
});

test('durées relatives', () => {
  assert.equal(BD.ago(20e3), "à l'instant"); assert.equal(BD.ago(5 * 6e4), 'il y a 5 min'); assert.equal(BD.ago(3 * 36e5), 'il y a 3 h');
  assert.equal(BD.ago(47 * 36e5), 'il y a 47 h'); assert.equal(BD.ago(72 * 36e5), 'il y a 3 j');
});

test('compte à rebours : à venir, avec jours, heures et minutes', () => {
  const n = CALC.nextCotRelease('2026-09-22', T('2026-09-26T12:00:00'));               // prochain : vendredi 2/10 à 19h30 UTC
  const h = BD.countdownHtml(n, T('2026-09-26T12:00:00'), fmt);
  assert.match(h, /Prochain rapport COT/); assert.match(h, /vendredi 2 octobre/); assert.match(h, /15h30 à New York/);
  assert.match(h, /dans <b>6 j 7 h 30 min<\/b>/); assert.doesNotMatch(h, /décalée/);
  assert.match(BD.countdownHtml(n, n.at - 5 * 6e4, fmt), /dans <b>0 h 05 min<\/b>/);   // moins d'une heure : pas de « 0 j »
});

test('compte à rebours : publication décalée par un jour férié', () => {
  const n = CALC.nextCotRelease('2026-11-17', T('2026-11-20T12:00:00'));               // Thanksgiving : lundi 30/11 au lieu du vendredi 27
  const h = BD.countdownHtml(n, T('2026-11-20T12:00:00'), fmt);
  assert.match(h, /lundi 30 novembre/); assert.match(h, /publication décalée d'un jour ouvré \(jour férié américain\)/);
});

test('compte à rebours : rapport publié (mise à jour en cours), puis données non actualisées', () => {
  const n = CALC.nextCotRelease('2026-09-15', T('2026-09-25T10:00:00'));               // attendu le 25/09 à 19h30 UTC
  const juste = BD.countdownHtml(CALC.nextCotRelease('2026-09-15', n.at + 3 * 36e5), n.at + 3 * 36e5, fmt);
  assert.match(juste, /Nouveau rapport publié/); assert.match(juste, /mise à jour des données en cours/);
  const tard = BD.countdownHtml(n, n.at + 31 * 36e5, fmt);
  assert.match(tard, /Rapport attendu/); assert.match(tard, /données non actualisées/);
});

test('la tolérance du compte à rebours est la même que celle du serveur (freshness.js)', () => {
  assert.equal(BD.COT_GRACE_MS, LIMITS.cotOverdueGrace);
});
