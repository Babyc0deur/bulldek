// Williams %R : frontières exactes des zones (−20 / −80) et signe de la variation affichée.
// Séries plates dont le %R vaut exactement la valeur voulue : plus haut 110, plus bas 90, clôture c → %R = −(110 − c) / 20 × 100.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { render } = require('../tools/fake-dom.js');
const CALC = require('../calc.js');

const ROOT = path.join(__dirname, '..'), NOW = Date.parse('2026-09-25T16:00:00Z'), M = { name: 'Nasdaq 100 E-Mini', code: '209742' };
const daily = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'nq-daily.json'), 'utf8'));
const flat = (c, n) => Array.from({ length: n }, (_, i) => [1.7e9 + i * 86400, c, 110, 90]);
const run = ({ d = daily } = {}) => render({ src: path.join(ROOT, 'wr.js'), fnName: 'renderWR', args: M, now: NOW, calc: CALC,
  overrides: { daily: async () => d } });
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const has = (haystack, needle) => assert.ok(haystack.includes(needle), `« ${needle} » absent de « ${haystack} »`);

const CASES = [                                                     // [clôture, %R attendu, zone attendue]
  [108, -10, 'Surachat'], [107, -15, 'Surachat'], [106.01, -19.95, 'Surachat'],
  [106, -20, 'Neutre'],                                            // frontière : −20 exactement est NEUTRE
  [100, -50, 'Neutre'], [95, -75, 'Neutre'],
  [94, -80, 'Neutre'],                                             // frontière : −80 exactement est NEUTRE
  [93.99, -80.05, 'Survente'], [93, -85, 'Survente'], [90, -100, 'Survente'],
];
for (const [c, wrv, zone] of CASES) {
  test(`frontières des zones : %R = ${wrv} → ${zone}`, async () => {
    const { el } = await run({ d: flat(c, 80) });
    const dj = text(el('#wk').innerHTML);
    const vu = CALC.williamsR(flat(c, 80), 14).at(-1)[1];                                   // valeur réellement calculée (l'arrondi flottant peut décaler le dernier chiffre)
    assert.ok(Math.abs(vu - wrv) < 0.01, `valeur de test incohérente : ${vu} vs ${wrv}`);
    has(dj, `Williams %R (14) ${vu.toFixed(1)} Zone ${zone}`);
  });
}

test('variation affichée : signe et valeur exacts (jour)', async () => {
  const { el } = await run();
  const fmt = (a, b) => ((a - b) > 0 ? '+' : '') + (a - b).toFixed(1);
  const d = CALC.williamsR(daily, 14);
  has(text(el('#wk').innerHTML), 'Variation / jour ' + fmt(d.at(-1)[1], d.at(-2)[1]));
  // cas contrôlés : un %R qui monte s'affiche avec « + », un %R qui baisse avec « - »
  const monte = flat(100, 80); monte[79] = [1.7e9 + 79 * 86400, 108, 110, 90];                  // avant-dernière −50, dernière −10 → +40.0
  has(text((await run({ d: monte })).el('#wk').innerHTML), 'Variation / jour +40.0');
  const baisse = flat(100, 80); baisse[78] = [1.7e9 + 78 * 86400, 108, 110, 90];                // avant-dernière −10, dernière −50 → -40.0
  has(text((await run({ d: baisse })).el('#wk').innerHTML), 'Variation / jour -40.0');
});
