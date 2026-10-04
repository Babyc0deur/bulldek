// Mise à jour incrémentale des prix quotidiens : fusion avec l'historique stocké, repli sur un téléchargement complet quand elle n'est pas sûre.
const test = require('node:test'), assert = require('node:assert/strict');
const { sinceTs, merge, OVERLAP_DAYS } = require('../dailymerge.js');

const DAY = 86400, T0 = Date.UTC(2020, 0, 1) / 1e3;
const rows = (n, from = 0, price = i => 100 + i) => Array.from({ length: n }, (_, k) => { const i = from + k; return [T0 + i * DAY, price(i), price(i) + 1, price(i) - 1]; });

test('début de la période à retélécharger : 15 jours avant la dernière séance stockée ; historique absent, court ou ancien format → null', () => {
  const old = rows(400);
  assert.equal(sinceTs(old), old[399][0] - OVERLAP_DAYS * DAY); assert.equal(OVERLAP_DAYS, 15);
  assert.equal(sinceTs(undefined), null); assert.equal(sinceTs([]), null); assert.equal(sinceTs(rows(299)), null, 'moins de 300 séances : téléchargement complet');
  assert.equal(sinceTs(old.map(r => [r[0], r[1]])), null, 'ancien format sans plus haut / plus bas : téléchargement complet');
});

test('fusion : les séances récentes remplacent le chevauchement, rien d\'autre ne bouge, les nouvelles séances sont ajoutées', () => {
  const old = rows(400), recent = rows(25, 385);                     // 385 à 409 : 15 séances déjà connues + 10 nouvelles
  const m = merge(old, recent);
  assert.equal(m.length, 410); assert.deepEqual(m.slice(0, 385), old.slice(0, 385)); assert.deepEqual(m.slice(385), recent);
  for (let i = 1; i < m.length; i++) assert.ok(m[i][0] > m[i - 1][0], 'ordre chronologique, sans doublon');
});

test('fusion : petite révision de la dernière clôture (< 0,5 %) acceptée et remplacée', () => {
  const old = rows(400), recent = rows(20, 385); recent[14][1] = old[399][1] * 1.002;
  const m = merge(old, recent); assert.ok(m); assert.equal(m.length, 405); assert.equal(m[399][1], recent[14][1]);
});

test('fusion refusée (null) : clôture déjà connue corrigée de plus de 0,5 %, aucune ligne récente, ou historique vide', () => {
  const old = rows(400), bad = rows(20, 385); bad[3][1] = bad[3][1] * 1.02;
  assert.equal(merge(old, bad), null, 'historique corrigé à la source : on retélécharge tout');
  assert.equal(merge(old, []), null); assert.equal(merge(old, undefined), null); assert.equal(merge([], rows(5)), null); assert.equal(merge(undefined, rows(5)), null);
});

test('fusion : séances récentes sans chevauchement avec les dates stockées (trou) → ajoutées à la suite', () => {
  const old = rows(400), recent = rows(5, 450); const m = merge(old, recent);
  assert.equal(m.length, 405); assert.deepEqual(m.slice(400), recent);
});
