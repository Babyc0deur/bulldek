// Saisonnalité journalière : variation de la séance du même jour du calendrier, années où le marché a coté ce jour-là.
const test = require('node:test'), assert = require('node:assert/strict');
const CALC = require('../calc.js');

// Séances du lundi au vendredi de 2020 à 2025 ; clôture = 100 sauf le 5 octobre, où elle vaut 100 + gain[année] (veille = 100).
const rows = gain => { const out = []; for (let t = Date.UTC(2020, 0, 1); t < Date.UTC(2026, 0, 1); t += 864e5) { const d = new Date(t), w = d.getUTCDay(); if (w === 0 || w === 6) continue; const iso = d.toISOString().slice(0, 10); out.push([t / 1e3, iso.slice(5) === '10-05' ? 100 + (gain[d.getUTCFullYear()] || 0) : 100]); } return out; };

test('moyenne des variations du même jour, sur les années où le marché a coté', () => {
  // 5 octobre : 2020 lundi, 2021 mardi, 2022 mercredi, 2023 jeudi, 2024 samedi (pas de séance), 2025 dimanche (pas de séance)
  const r = CALC.seasonalDay(rows({ 2020: 1, 2021: -2, 2022: 3, 2023: 2 }), '2026-10-05', 20, 2026);
  assert.equal(r.n, 4); assert.equal(r.up, 3); assert.equal(r.avgPts, 1); assert.ok(Math.abs(r.avgPct - 1) < 1e-9);
});

test('moins d\'années disponibles que demandé ; année en cours exclue ; jour sans aucune séance → n = 0 et moyenne nulle', () => {
  assert.equal(CALC.seasonalDay(rows({ 2020: 1, 2021: 1, 2022: 1, 2023: 1 }), '2026-10-05', 4, 2026).n, 2, 'nYears = 4 : 2022 à 2025, dont 2024 et 2025 sans séance ce jour-là');
  const none = CALC.seasonalDay(rows({}), '2026-02-30', 20, 2026); assert.equal(none.n, 0); assert.equal(none.avgPct, null); assert.equal(none.up, 0);
  assert.equal(CALC.seasonalDay(rows({ 2020: 5 }), '2026-10-05', 20, 2020).n, 0, 'aucune année complète antérieure à l\'année de référence');
});
