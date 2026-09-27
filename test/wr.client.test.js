// Williams %R journalier : le vrai code de la page (wr.js) exécuté dans un faux DOM.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { render } = require('../tools/fake-dom.js');
const CALC = require('../calc.js');

const ROOT = path.join(__dirname, '..'), NOW = Date.parse('2026-09-25T16:00:00Z'), M = { name: 'Nasdaq 100 E-Mini', code: '209742' };
const daily = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'nq-daily.json'), 'utf8'));

async function run({ d = daily } = {}) {
  return render({ src: path.join(ROOT, 'wr.js'), fnName: 'renderWR', args: M, now: NOW, calc: CALC, overrides: { daily: async () => d } });
}
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('journalier : valeur, zone et graphiques identiques à la formule commune', async () => {
  const { rec, el } = await run();
  const exp = CALC.williamsR(daily, 14), lastV = exp.at(-1)[1];
  assert.equal(rec.charts['#cWr'].series[0].data.length, exp.length);
  assert.equal(rec.charts['#cWr'].series[0].data.at(-1)[0], daily.at(-1)[0] * 1e3);        // abscisses en millisecondes
  assert.ok(Math.abs(rec.charts['#cWr'].series[0].data.at(-1)[1] - lastV) < 1e-9);
  assert.match(text(el('#wk').innerHTML), new RegExp('Williams %R \\(14\\) ' + lastV.toFixed(1).replace('-', '-').replace('.', '\\.')));
  assert.equal(rec.charts['#cPx'].series[0].data.length, daily.length);                    // prix sur toute la série
});

test('gabarit : graphiques décrits, boutons à état, aucun style en ligne, zone actuelle dans la description', async () => {
  const { root } = await run(), html = root.innerHTML;
  const canvases = html.match(/<canvas[^>]*>/g);
  assert.equal(canvases.length, 2);
  canvases.forEach(c => { assert.match(c, /role="img"/); assert.match(c, /aria-label="[^"]{30,}"/); });
  assert.match(html, /aria-label="Williams %R sur 14 séances[^"]*Valeur actuelle : -?\d+\.\d, zone (surachat|survente|neutre)/);
  assert.match(html, /aria-pressed="true"/); assert.match(html, /role="group"/);
  assert.doesNotMatch(html, /\sstyle=/);
});


test('plus aucun élément hebdomadaire dans la section Williams %R', async () => {
  const { root } = await run();
  assert.doesNotMatch(root.innerHTML, /hebdomadaire|cWrW|wkw|wrCombo/);
});
