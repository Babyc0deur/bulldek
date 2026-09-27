const test = require('node:test'), assert = require('node:assert/strict');
const { assess, LIMITS } = require('../freshness.js');

const T = s => Date.parse(s + 'Z'), H = 36e5, D = 864e5;
// Situation saine de référence : samedi 26/09/2026 midi UTC — dernière séance vendredi 25, rapport COT du 22/09 publié le 25/09, mises à jour de la veille.
const base = { now: T('2026-09-26T12:00:00'), lastSession: T('2026-09-25T00:00:00'), pricesAt: T('2026-09-26T08:00:00'), reportDate: '2026-09-22', cotAt: T('2026-09-26T08:00:00'), errors: [] };
const lvl = o => assess({ ...base, ...o }).level;

test('données saines : à jour', () => {
  const r = assess(base);
  assert.equal(r.level, 'ok'); assert.equal(r.prices.stale, false); assert.equal(r.cot.stale, false); assert.equal(r.cot.next.releaseDate, '2026-10-02');
});

test('week-end de 3 jours : la dernière séance de vendredi reste à jour le lundi soir', () => {
  assert.equal(lvl({ now: T('2026-09-28T20:00:00'), pricesAt: T('2026-09-28T08:00:00'), cotAt: T('2026-09-28T08:00:00') }), 'ok');
});

test('prix : donnée ancienne (dernière séance il y a plus de 4 jours après sa clôture)', () => {
  const r = assess({ ...base, now: T('2026-09-30T12:00:00'), pricesAt: T('2026-09-30T08:00:00'), cotAt: T('2026-09-30T08:00:00') });
  assert.equal(r.level, 'warn'); assert.equal(r.prices.reason, 'session');
});

test('prix : nos mises à jour sont anciennes (>2 jours) même si la séance semble récente', () => {
  const r = assess({ ...base, pricesAt: T('2026-09-23T08:00:00') });
  assert.equal(r.level, 'warn'); assert.equal(r.prices.reason, 'fetch'); assert.equal(r.cot.stale, false);
});

test('COT : rapport attendu vendredi 15h30 New York (19h30 UTC) : toléré 30 h, puis en retard', () => {
  const at = T('2026-10-02T19:30:00'), b = { ...base, lastSession: T('2026-10-01T00:00:00') };
  const mk = now => assess({ ...b, now, pricesAt: now - 4 * H, cotAt: now - 4 * H });     // dernière mise à jour il y a 4 h : aucun autre motif d'alerte
  assert.equal(mk(at - H).level, 'ok');                                                    // pas encore l'heure
  assert.equal(mk(at + 29 * H).level, 'ok');                                               // publié mais pas encore repris : dans la marge
  const r = mk(at + 31 * H);
  assert.equal(r.level, 'warn'); assert.equal(r.cot.reason, 'overdue');
});

test('COT : un jour férié décale l\'attente (Thanksgiving 2026 → publication le lundi 30/11)', () => {
  // dernières positions : 17/11 → rapport du 24/11 attendu le lundi 30/11 (et non le vendredi 27) : pas d'alerte le samedi 28/11
  const now = T('2026-11-28T12:00:00');
  const r = assess({ ...base, now, lastSession: T('2026-11-27T00:00:00'), reportDate: '2026-11-17', pricesAt: now - 4 * H, cotAt: now - 4 * H });
  assert.equal(r.level, 'ok'); assert.equal(r.cot.next.releaseDate, '2026-11-30'); assert.equal(r.cot.next.delayed, true);
  // sans la règle des jours fériés, l'alerte se déclencherait dès le vendredi 27 + 30 h
});

test('COT : nos mises à jour sont anciennes', () => {
  const r = assess({ ...base, cotAt: T('2026-09-23T08:00:00') });
  assert.equal(r.level, 'warn'); assert.equal(r.cot.reason, 'fetch');
});

test('échec de mise à jour non résolu : avertissement même si les dates sont bonnes', () => {
  const r = assess({ ...base, errors: [{ store: 'daily', at: base.now - H, msg: '429' }] });
  assert.equal(r.level, 'warn'); assert.equal(r.errors.length, 1);
});

test('aucune donnée : niveau « indisponible »', () => {
  assert.equal(lvl({ lastSession: null }), 'bad'); assert.equal(lvl({ reportDate: null }), 'bad');
  const r = assess({ now: base.now, lastSession: null, pricesAt: 0, reportDate: null, cotAt: 0 });
  assert.equal(r.prices.missing && r.cot.missing, true); assert.equal(r.cot.next, null);
});

test('seuils exposés', () => {
  assert.deepEqual(Object.keys(LIMITS).sort(), ['cotOverdueGrace', 'fetchMaxAge', 'sessionMaxAge']);
  assert.ok(LIMITS.sessionMaxAge >= 4 * D && LIMITS.fetchMaxAge >= D);                    // jamais plus strict qu'un week-end prolongé ou un cycle quotidien
});
