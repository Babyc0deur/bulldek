// Affichage de la confluence à 4 signaux : tableau du screener (screener.js) et panneau de la fiche marché (market.js), dans un faux navigateur.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const CALC = require('../calc.js');

const ROOT = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const BD = new Function(read('shared.js') + '\nreturn BD;')();
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const mk = over => ({ slug: 'a', name: 'Alpha', group: 'Indices', price: 100, priceDate: 1, chgPct: 0.5, idx6: 50, idx36: 50, wr: -50, roll: false, fresh: 'ok',
  season: { n: 10, avgPct: 1, up: 6 }, seasonDay: { n: 14, avgPct: -0.35, up: 6 }, sig: { cot: 0, season: 1, wr: 0, oi: 1 }, score: 2,
  oi: { last: 325784, chgPct: 10.38, priceChgPct: 2, key: 'trend-up', label: 'Hausse confirmée' }, ...over });
const ROWS = [
  mk(), mk({ slug: 'b', name: 'Bravo', sig: { cot: -1, season: 0, wr: 0, oi: -1 }, score: -2, oi: { last: 1, chgPct: 4.2, priceChgPct: -2, key: 'trend-down', label: 'Baisse confirmée' } }),
  mk({ slug: 'c', name: 'Charlie', sig: { cot: 0, season: 0, wr: 0, oi: 0 }, score: 0, oi: { last: 1, chgPct: -3.1, priceChgPct: 2, key: 'covering', label: 'Hausse fragile' } }),
  mk({ slug: 'd', name: 'Delta', sig: { cot: 0, season: 0, wr: 0, oi: 0 }, score: 0, oi: null }),
];

// ---------- screener.js ----------
function runScreener(rows) {
  const els = {}, handlers = {};
  const el = sel => els[sel] ||= { value: '', innerHTML: '', textContent: '', add() {}, addEventListener(t, f) { (handlers[sel] ||= {})[t] = f; }, insertAdjacentHTML() {}, remove() {} };
  const document = { querySelector: sel => (sel === '#miss' ? null : el(sel)) };
  const fetch = async () => ({ json: async () => ({ week: '22–28 sept.', day: { iso: '2026-10-05', label: 'lun 5 oct' }, updated: Date.now(), rows }) });
  globalThis.Option = function (t, v) { this.text = t; this.value = v; };
  const stubBD = { ...BD, freshness: () => {} };
  new Function('document', 'fetch', 'BD', 'CALC', 'Option', read('screener.js'))(document, fetch, stubBD, CALC, globalThis.Option);
  return { el, click: async k => { await new Promise(r => setTimeout(r, 5)); el('#tbl').onclick({ target: { closest: s => (s === 'th.s' ? { dataset: { k } } : null) } }); } };
}
const rowsHtml = html => [...html.matchAll(/<tr data-href="\/market\/(\w)">([\s\S]*?)<\/tr>/g)].map(m => ({ slug: m[1], html: m[2] }));
const wait = () => new Promise(r => setTimeout(r, 20));

test('screener : colonne « Open interest » avec variation et lecture, et 4 points de confluence par ligne', async () => {
  const s = runScreener(ROWS); await wait();
  const html = s.el('#tbl').innerHTML;
  assert.match(text(html.match(/<thead>[\s\S]*?<\/thead>/)[0]), /Saison 22–28 sept\. \(max\) · \(lun 5 oct\) Open interest/);
  const rows = rowsHtml(html); assert.equal(rows.length, 4);
  const a = rows.find(r => r.slug === 'a').html, b = rows.find(r => r.slug === 'b').html;
  assert.match(text(a), /\+10\.38 % Hausse confirmée/); assert.match(text(b), /\+4\.20 % Baisse confirmée/);
  for (const r of rows) assert.equal((r.html.match(/class="dot (up|dn|nt)"/g) || []).length, 4, 'quatre points : COT, saison, Williams %R, open interest');
  assert.match(a, /aria-label="Open interest : haussier"/); assert.match(b, /aria-label="Open interest : baissier"/);
  assert.match(rows.find(r => r.slug === 'c').html, /aria-label="Open interest : neutre"/);
});

test('screener : lecture non confirmée en neutre ; marché sans open interest : « – »', async () => {
  const s = runScreener(ROWS); await wait();
  const rows = rowsHtml(s.el('#tbl').innerHTML), c = rows.find(r => r.slug === 'c').html, d = rows.find(r => r.slug === 'd').html;
  assert.match(text(c), /-3\.10 % Hausse fragile/); assert.match(c, /sig sm wait">Hausse fragile/);
  assert.match(text(d), / – /);
  assert.match(rows.find(r => r.slug === 'a').html, /sig sm buy">Hausse confirmée/); assert.match(rows.find(r => r.slug === 'b').html, /sig sm sell">Baisse confirmée/);
});

test('screener : tri par open interest (clic sur l\'en-tête) et pastille de score', async () => {
  const s = runScreener(ROWS); await s.click('oi');
  const ordre = rowsHtml(s.el('#tbl').innerHTML).map(r => r.slug);
  assert.deepEqual(ordre, ['a', 'b', 'c', 'd'], 'décroissant : +10,38 ; +4,20 ; −3,10 ; sans donnée en dernier');
  await s.click('oi'); assert.deepEqual(rowsHtml(s.el('#tbl').innerHTML).map(r => r.slug), ['d', 'c', 'b', 'a']);
  assert.match(rowsHtml(s.el('#tbl').innerHTML).find(r => r.slug === 'a').html, /sig sm buy">\+2</);
});

test('screener : filtre de biais sur la confluence à 4 signaux (±2)', async () => {
  const s = runScreener([mk({ score: 4 }), mk({ slug: 'b', score: 2 }), mk({ slug: 'c', score: 1 }), mk({ slug: 'd', score: -3 }), mk({ slug: 'e', score: -1 })]);
  await wait(); s.el('#bias').value = 'bull'; s.el('#bias').addEventListener; // le filtre se lit à chaque affichage
  const filtre = (v) => { s.el('#bias').value = v; return s.click('score').then(() => s.click('score')); };
  await filtre('bull'); assert.deepEqual(rowsHtml(s.el('#tbl').innerHTML).map(r => r.slug).sort(), ['a', 'b']);
  await filtre('bear'); assert.deepEqual(rowsHtml(s.el('#tbl').innerHTML).map(r => r.slug), ['d']);
  await filtre('mixed'); assert.deepEqual(rowsHtml(s.el('#tbl').innerHTML).map(r => r.slug).sort(), ['c', 'e']);
});

// ---------- market.js : panneau de confluence de la fiche ----------
async function runPanel(row, week = '22–28 sept.') {
  const box = { innerHTML: '' }, store = { confl: box };
  const document = { getElementById: id => store[id] || null, querySelector: () => null, body: {} };
  const fetch = async () => ({ json: async () => ({ week, rows: [row] }) });
  const renderConfluence = new Function('BD', 'CALC', 'fetch', 'document', 'renderSeasonal', 'renderWR', 'renderCot', 'renderOI', 'renderDebrief', read('market.js') + '\nreturn renderConfluence;')(
    { ...BD, shell: async () => null }, CALC, fetch, document, () => {}, () => {}, () => {}, () => {}, () => {});
  await renderConfluence({ slug: row.slug });
  return box.innerHTML;
}

test('fiche : le panneau affiche 4 éléments, le score et le total à 4 signaux', async () => {
  const html = await runPanel(mk({ score: 3, sig: { cot: 1, season: 1, wr: 0, oi: 1 } })), t = text(html);
  assert.equal((html.match(/<a class="ci"/g) || []).length, 4);
  assert.match(t, /COT \+ saisonnalité \+ Williams %R \+ open interest/);
  assert.match(t, /\+3 · Haussière/); assert.match(html, /href="#sOi"/); assert.match(html, /href="#sCot"/); assert.match(html, /href="#sSea"/); assert.match(html, /href="#sWr"/);
});

test('fiche : élément Open interest — variation, lecture et signal, avec la couleur du point', async () => {
  const up = await runPanel(mk()), dn = await runPanel(mk({ sig: { cot: 0, season: 0, wr: 0, oi: -1 }, score: -1, oi: { last: 1, chgPct: 4.2, priceChgPct: -2, key: 'trend-down', label: 'Baisse confirmée' } }));
  assert.match(text(up), /Open interest · semaine \+10\.38 % Hausse confirmée · Signal haussier/); assert.match(up, /<a class="ci" href="#sOi"><i class="dot up"/);
  assert.match(text(dn), /Baisse confirmée · Signal baissier/); assert.match(dn, /<a class="ci" href="#sOi"><i class="dot dn"/);
});

test('fiche : changement de contrat récent → « neutralisé » ; pas de données → « Indisponible »', async () => {
  const roll = await runPanel(mk({ roll: true, sig: { cot: 0, season: 1, wr: 0, oi: 0 }, score: 1 }));
  assert.match(text(roll), /Hausse confirmée · neutralisé \(changement de contrat\)/); assert.match(roll, /<a class="ci" href="#sOi"><i class="dot nt"/);
  assert.match(text(await runPanel(mk({ oi: null, sig: { cot: 0, season: 0, wr: 0, oi: 0 }, score: 0 }))), /Open interest · semaine – Indisponible/);
});

test('CSS : la grille de confluence passe à 4 colonnes, 2 sur tablette, 1 sur mobile', () => {
  const css = read('shared.css');
  assert.match(css, /\.confl-items\{grid-template-columns:repeat\(4,1fr\)\}/); assert.match(css, /max-width:1100px\)\{\.confl-items\{grid-template-columns:repeat\(2,1fr\)\}/);
});

test('screener : chaque ligne a exactement autant de cellules que d\'en-têtes (pas de décalage de colonnes)', async () => {
  const s = runScreener(ROWS); await wait();
  const html = s.el('#tbl').innerHTML, entetes = (html.match(/<thead>[\s\S]*?<\/thead>/)[0].match(/<th /g) || []).length;
  assert.equal(entetes, 8);
  for (const r of rowsHtml(html)) assert.equal((r.html.match(/<td[ >]/g) || []).length, entetes, `ligne ${r.slug} : cellules ≠ en-têtes`);
  assert.doesNotMatch(html, /<!--/, 'aucun commentaire HTML résiduel');
});

test('screener : catégorie « Indices » sélectionnée par défaut quand elle existe', async () => {
  const s = runScreener(ROWS); await wait();
  assert.equal(s.el('#grp').value, 'Indices');
});

test('screener : sans marché « Indices », aucune catégorie n\'est forcée', async () => {
  const s = runScreener([mk({ group: 'Metals' })]); await wait();
  assert.equal(s.el('#grp').value, '');
});

test('screener : saisonnalité du jour entre parenthèses, dans la colonne de la saison de la semaine ; absente → (–)', async () => {
  const s = runScreener([mk(), mk({ slug: 'b', name: 'Bravo', seasonDay: { n: 0, avgPct: null, up: 0 } }), mk({ slug: 'c', name: 'Charlie', seasonDay: { n: 9, avgPct: 0.8, up: 6 } }), mk({ slug: 'd', name: 'Delta', seasonDay: undefined })]); await wait();
  const rows = rowsHtml(s.el('#tbl').innerHTML), cell = slug => text(rows.find(r => r.slug === slug).html);
  assert.match(cell('a'), /\+1\.00 % 6\/10 hausse \(\+?-0\.35 %\)/); assert.match(rows[0].html, /class="sd neg"[^>]*title="Saisonnalité du jour \(lun 5 oct\) : 6\/14 années en hausse"/);
  assert.match(cell('b'), /\+1\.00 % 6\/10 hausse \(–\)/); assert.match(cell('c'), /\(\+0\.80 %\)/); assert.match(rows[2].html, /class="sd pos"/);
  assert.match(cell('d'), /hausse \(–\)/);
});
