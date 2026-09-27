// Open interest : couleur de la pastille de lecture pour les quatre situations (prix et open interest construits pour les provoquer).
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const { render } = require('../tools/fake-dom.js');
const CALC = require('../calc.js');

const ROOT = path.join(__dirname, '..'), NOW = Date.parse('2026-09-25T20:00:00Z');
const M = { name: 'Gold', code: '088691', slug: 'gold', tff: false, disagg: false };
const d = (s, c) => [Date.parse(s + 'T04:00:00Z') / 1e3, c];
const END = Date.UTC(2026, 8, 15);

// Historique où l'open interest passe de `avant` à `apres` sur la dernière semaine, et prix du 08/09 au 15/09 : `p0` → `p1`.
async function cas(avant, apres, p0, p1) {
  const hist = Array.from({ length: 30 }, (_, i) => [new Date(END - (29 - i) * 7 * 864e5).toISOString().slice(0, 10), 1, 2, 3, 4, 5, 6, i === 28 ? avant : i === 29 ? apres : 1000]);
  const daily = [d('2026-09-08', p0), d('2026-09-15', p1)];
  const r = await render({ src: path.join(ROOT, 'oi.js'), fnName: 'renderOI', args: M, now: NOW, calc: CALC, overrides: { cot: async () => ({ hist }), daily: async () => daily } });
  return { html: r.el('#oiRead').innerHTML, text: r.el('#oiRead').innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') };
}

const CAS = [
  ['prix en hausse, open interest en hausse', [1000, 1050, 100, 103], 'sig sm buy', 'Hausse confirmée'],
  ['prix en baisse, open interest en hausse', [1000, 1050, 100, 97], 'sig sm sell', 'Baisse confirmée'],
  ['prix en hausse, open interest en baisse', [1050, 1000, 100, 103], 'sig sm wait', 'Hausse fragile'],
  ['prix en baisse, open interest en baisse', [1050, 1000, 100, 97], 'sig sm wait', 'Baisse par liquidation'],
  ['prix quasi stable (+0,2 %)', [1000, 1050, 100, 100.2], 'sig sm wait', 'Peu marqué'],
  ['open interest quasi stable (+0,3 %)', [1000, 1003, 100, 103], 'sig sm wait', 'Peu marqué'],
];
for (const [nom, [a, b, p0, p1], classe, label] of CAS) test(`pastille de lecture : ${nom} → ${label}`, async () => {
  const { html, text } = await cas(a, b, p0, p1);
  assert.ok(html.includes(classe + '">' + label), `attendu « ${label} » en ${classe} : ${html.slice(0, 120)}`);
  assert.ok(text.includes('Prix : '), 'les variations utilisées sont affichées');
});
