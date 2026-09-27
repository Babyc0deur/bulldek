// Camemberts (shared.js) : infobulle au survol (et au toucher) montrant le nom et la valeur de la tranche pointée.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');
const freshBD = () => new Function(SRC + '\nreturn BD;')();            // ré-évalué à chaque test : l'infobulle est un singleton interne au module
global.devicePixelRatio = 1;

// Faux canvas centré en (0,0), de rayon 55 (taille par défaut 110) ; faux document pour l'infobulle (un seul élément, réutilisé).
function fakeCanvas(size = 110) {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? (s => ({ width: 0 })) : () => {}), set: (t, k, v) => (t[k] = v, true) });
  const handlers = {};
  // left/top décalés de moitié : le centre du camembert tombe alors sur (0,0), et les coordonnées passées à fire()/touch() sont directement des écarts (dx,dy) au centre.
  const canvas = { style: {}, width: 0, height: 0, bound: false, getContext: () => ctx, getBoundingClientRect: () => ({ left: -size / 2, top: -size / 2, width: size, height: size }),
    set onmousemove(f) { handlers.move = f; this.bound = true; }, set ontouchmove(f) { handlers.touch = f; }, set onmouseleave(f) { handlers.leave = f; },
    fire: (x, y) => handlers.move({ clientX: x, clientY: y }),
    touch(x, y) { this.prevented = false; handlers.touch({ touches: [{ clientX: x, clientY: y }], preventDefault: () => { this.prevented = true; } }); },
    leave: () => handlers.leave() };
  return canvas;
}
function fakeDoc() {
  const tip = { hidden: true, style: {}, innerHTML: '' };
  global.document = { createElement: () => ({ style: {} }), body: { appendChild: el => Object.assign(tip, el) } };
  // le premier createElement('div') dans pieTip.ensure() doit renvoyer l'objet qu'on inspecte ensuite : on le construit à part.
  global.document.createElement = tag => (tag === 'div' ? tip : {});
  return tip;
}

test('camembert sans nom de tranche : aucun gestionnaire de survol posé (rien à afficher)', () => {
  const c = fakeCanvas();
  freshBD().pie(c, [{ v: 1, color: '#fff' }, { v: 2, color: '#000' }]);
  assert.equal(c.bound, false);
  const c2 = fakeCanvas();
  freshBD().pie(c2, [{ v: 1, color: '#fff', name: 'A' }]);
  assert.equal(c2.bound, true);
});

test('survol d\'une tranche : infobulle avec nom, valeur et part du total (format par défaut)', () => {
  const tip = fakeDoc(), c = fakeCanvas();
  // demi-cercle nord→est = tranche A (25 % du total), reste = tranche B (75 %)
  freshBD().pie(c, [{ v: 25, color: '#fff', name: 'A' }, { v: 75, color: '#000', name: 'B' }]);
  c.fire(30, -30);                                                     // haut-droite : dans la tranche A (nord → est)
  assert.equal(tip.hidden, false); assert.match(tip.innerHTML, /A : 25 \(25 %\)/);
  c.fire(-30, 30);                                                     // bas-gauche : dans la tranche B
  assert.match(tip.innerHTML, /B : 75 \(75 %\)/);
});

test('en dehors du camembert : infobulle masquée ; au départ de la souris (mouseleave) aussi', () => {
  const tip = fakeDoc(), c = fakeCanvas();
  freshBD().pie(c, [{ v: 1, color: '#fff', name: 'A' }, { v: 1, color: '#000', name: 'B' }]);
  c.fire(1, -1); assert.equal(tip.hidden, false);
  c.fire(200, 200); assert.equal(tip.hidden, true);                    // hors rayon
  c.fire(1, -1); assert.equal(tip.hidden, false);
  c.leave(); assert.equal(tip.hidden, true);
});

test('tranche à valeur nulle : jamais celle qui répond au survol (aucune zone d\'angle)', () => {
  const tip = fakeDoc(), c = fakeCanvas();
  freshBD().pie(c, [{ v: 0, color: '#888', name: 'Vide' }, { v: 10, color: '#000', name: 'Pleine' }]);
  c.fire(30, -30); assert.match(tip.innerHTML, /Pleine/); assert.doesNotMatch(tip.innerHTML, /Vide/);
});

test('formateur personnalisé (ex. valeur déjà en pourcentage, comme le camembert « % OI »)', () => {
  const tip = fakeDoc(), c = fakeCanvas();
  const fmt = s => `${s.name} : ${s.v.toFixed(1)} %`;
  freshBD().pie(c, [{ v: 53.3, color: '#f00', name: 'Commerciaux' }, { v: 46.7, color: '#0f0', name: 'Autres' }], 110, fmt);
  c.fire(30, -30);
  assert.match(tip.innerHTML, /Commerciaux : 53\.3 %/); assert.doesNotMatch(tip.innerHTML, /\(/, 'pas de « part du total » ajoutée par le format par défaut');
});

test('le toucher (mobile) affiche aussi l\'infobulle, et empêche le défilement de la page pendant le survol tactile', () => {
  const tip = fakeDoc(), c = fakeCanvas();
  freshBD().pie(c, [{ v: 1, color: '#fff', name: 'A' }, { v: 1, color: '#000', name: 'B' }]);
  c.touch(30, -30);
  assert.equal(tip.hidden, false); assert.match(tip.innerHTML, /A/); assert.equal(c.prevented, true);
});
