// Moteur de graphiques (shared.js) : les points d'observation (option dots) sont dessinés là où il faut, et seulement là.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const BD = new Function(fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8') + '\nreturn BD;')();

// Faux canvas : enregistre les appels de dessin (arc, lineTo, moveTo) sans rien dessiner.
function fakeCanvas() {
  const calls = { arc: [], lineTo: 0, moveTo: 0, fillStyle: [] };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'arc') return (x, y, r) => calls.arc.push([x, y, r]);
      if (k === 'lineTo') return () => { calls.lineTo++; };
      if (k === 'moveTo') return () => { calls.moveTo++; };
      if (k === 'measureText') return s => ({ width: String(s).length * 6 });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; if (k === 'fillStyle') calls.fillStyle.push(v); return true; },
  });
  const canvas = { clientWidth: 600, parentElement: { clientWidth: 600 }, style: {}, width: 0, height: 0, getContext: () => ctx };
  return { canvas, calls };
}
global.ResizeObserver = class { observe() {} };
global.devicePixelRatio = 1;

const series = (extra = {}) => ({ name: 's', color: '#abcdef', width: 1.6, data: [[1, 10], [2, 12], [3, 11], [4, 15], [5, 14]], ...extra });
const draw = (s, o = {}) => { const { canvas, calls } = fakeCanvas(); BD.lineChart(canvas, { series: [s], xmin: 1, xmax: 5, height: 200, ...o }); return calls; };

test('sans l\'option dots : aucune pastille dessinée', () => assert.equal(draw(series()).arc.length, 0));
test('avec dots : une pastille par observation visible', () => assert.equal(draw(series({ dots: true })).arc.length, 5));

test('seules les observations comprises dans la fenêtre reçoivent une pastille', () => {
  assert.equal(draw(series({ dots: true }), { xmin: 2, xmax: 4 }).arc.length, 3);
  assert.equal(draw(series({ dots: true }), { xmin: 10, xmax: 20 }).arc.length, 0);
});

test('rayon par défaut 2,4 et rayon personnalisé', () => {
  assert.ok(draw(series({ dots: true })).arc.every(a => a[2] === 2.4));
  assert.ok(draw(series({ dots: true, dotRadius: 4 })).arc.every(a => a[2] === 4));
});

test('les pastilles sont de la couleur de la courbe et positionnées dans la zone de tracé', () => {
  const c = draw(series({ dots: true }));
  assert.ok(c.fillStyle.includes('#abcdef'));
  c.arc.forEach(([x, y]) => { assert.ok(x >= 54 && x <= 600 - 12, 'x dans la zone : ' + x); assert.ok(y >= 10 && y <= 200 - 26, 'y dans la zone : ' + y); });
  const xs = c.arc.map(a => a[0]); assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'de gauche à droite');
  const ys = c.arc.map(a => a[1]); assert.ok(ys[3] < ys[0], 'la valeur 15 est plus haute à l\'écran que la valeur 10');
});

test('plusieurs courbes : seules celles qui demandent des points en reçoivent', () => {
  const { canvas, calls } = fakeCanvas();
  BD.lineChart(canvas, { series: [series({ dots: true }), series({ name: 'b', data: [[1, 1], [5, 2]] })], xmin: 1, xmax: 5, height: 200 });
  assert.equal(calls.arc.length, 5);
});

test('la courbe elle-même est toujours tracée (les points s\'y ajoutent)', () => {
  const sans = draw(series()), avec = draw(series({ dots: true }));
  assert.equal(avec.lineTo, sans.lineTo); assert.equal(avec.moveTo, sans.moveTo);
});
