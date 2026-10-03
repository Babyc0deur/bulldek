// Page « Analyse intermarchés » : route et API du vrai serveur (cache factice), rendu client dans un faux DOM, menu, contraste de la carte de chaleur.
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { render } = require('../tools/fake-dom.js');

const ROOT = path.join(__dirname, '..'), PORT = 20000 + Math.floor(Math.random() * 900), BASE = `http://127.0.0.1:${PORT}`;
const MARKETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'markets.json'), 'utf8')), code = s => MARKETS.find(m => m.slug === s).code;
let proc, tmp;
const get = p => new Promise((res, rej) => http.get(BASE + p, r => { const c = []; r.on('data', x => c.push(x)); r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(c).toString() })); }).on('error', rej));

const rng = seed => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5; };
const daily = (rets) => { let p = 100; const t0 = Date.UTC(2024, 0, 1); return rets.map((r, i) => { p *= 1 + r / 100; return [t0 / 1e3 + i * 86400, +p.toFixed(4), +p.toFixed(4), +p.toFixed(4)]; }); };
const base = (() => { const g = rng(3); return Array.from({ length: 300 }, () => g() * 2); })();

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulldesk-inter-'));
  const d = { [code('sp500')]: daily(base), [code('nasdaq-100')]: daily(base.map(r => r * 1.1)), [code('gold')]: daily(base.map(r => -r)), [code('us-dollar')]: daily(base.map(r => r * 0.2)) };
  fs.writeFileSync(path.join(tmp, 'cache.json'), JSON.stringify({ weekly: {}, daily: d, cot: {}, tff: {}, disagg: {}, macro: {}, _ts: { daily: Object.fromEntries(Object.keys(d).map(k => [k, Date.now()])) } }));
  proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, NO_REFRESH: '1', QUIET: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await get('/health')).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('le serveur ne démarre pas');
});
test.after(async () => { await new Promise(done => { if (!proc || proc.exitCode !== null) return done(); proc.once('exit', done); proc.kill(); }); if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

test('/api/intermarket : matrice calculée sur les marchés en cache (4 ici), fenêtres et lectures présentes', async () => {
  const r = await get('/api/intermarket'), d = JSON.parse(r.body);
  assert.equal(r.status, 200); assert.deepEqual(d.assets.map(a => a.slug).sort(), ['gold', 'nasdaq-100', 'sp500', 'us-dollar']);
  assert.deepEqual(d.windows, [20, 60, 120, 250, 'max']);
  const i = s => d.assets.findIndex(a => a.slug === s);
  assert.ok(d.matrix[60][i('sp500')][i('nasdaq-100')] > 0.99); assert.ok(d.matrix[60][i('sp500')][i('gold')] < -0.99);
  assert.match(d.asOf, /^\d{4}-\d{2}-\d{2}$/); assert.ok(Array.isArray(d.pairs) && Array.isArray(d.shifts));
});

test('/intermarket : page servie avec son script ; le module de calcul reste côté serveur', async () => {
  const p = await get('/intermarket'); assert.equal(p.status, 200); assert.match(p.body, /data-page="intermarket"/); assert.match(p.body, /intermarketview\.js/);
  assert.equal((await get('/intermarketview.js')).status, 200);
  assert.equal((await get('/intermarket.js')).status, 404, 'le module de calcul ne doit pas être servi au navigateur');
});

test('menu : lien « Intermarket » sur toutes les pages (pages fixes et fiche marché), page courante signalée', () => {
  for (const f of ['about.html', 'compare.html', 'screener.html', 'themes.html', 'inflation.html', 'rates.html', 'intermarket.html'])
    assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /<li><a href="\/intermarket"[^>]*>Intermarket<\/a><\/li>/, f);
  assert.match(fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8'), /href="\/intermarket">\$\{ICON_COT\}Intermarket/);
  assert.match(fs.readFileSync(path.join(ROOT, 'intermarket.html'), 'utf8'), /<a href="\/intermarket" class="cur-page">/);
});

// ---------- rendu client ----------
const ASSETS = [{ slug: 'a', name: 'Alpha', short: 'ALP', group: 'x' }, { slug: 'b', name: 'Bravo', short: 'BRV', group: 'x' }, { slug: 'c', name: 'Charlie', short: 'CHL', group: 'x' }];
const mat = (x, y, z) => [[1, x, y], [x, 1, z], [y, z, 1]];
const DATA = { updated: 1, asOf: '2026-10-02', assets: ASSETS, windows: [20, 60, 120, 250, 'max'],
  matrix: { 20: mat(0.1, 0.2, 0.3), 60: mat(0.9, -0.5, null), 120: mat(0, 0, 0), 250: mat(0, 0, 0), max: mat(-0.4, 0.1, 0.2) },
  pairs: [{ a: 'a', b: 'b', aName: 'Alpha', bName: 'Bravo', expect: -1, why: 'Parce que.', r60: -0.5, r250: -0.4, rMax: -0.3, status: { key: 'ok', label: 'Conforme à la théorie' } },
    { a: 'a', b: 'c', aName: 'Alpha', bName: 'Charlie', expect: 0, why: 'Variable.', r60: 0.4, r250: 0.3, rMax: -0.25, status: { key: 'flip', label: 'Régime inversé par rapport à l\'historique' } }],
  shifts: [{ a: 'a', b: 'b', aName: 'Alpha', bName: 'Bravo', r60: 0.9, rMax: -0.4, gap: 1.3 }] };
const run = (data = DATA) => render({ src: path.join(ROOT, 'intermarketview.js'), fnName: '((a, root) => renderIntermarket(a, root))', args: data, now: Date.parse('2026-10-03T10:00:00Z'), calc: {} });
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('matrice : fenêtre de 60 séances par défaut ; cases colorées par force, diagonale neutre, valeur manquante « – »', async () => {
  const { el, root } = await run(), html = el('#imTbl').innerHTML;
  assert.match(root.innerHTML, /data-w="60" aria-pressed="true"/); assert.match(root.innerHTML, /1 an/); assert.match(root.innerHTML, /Historique/);
  assert.match(html, /<th scope="col" title="Alpha">ALP<\/th>/); assert.match(html, /<th scope="row">Bravo<\/th>/);
  assert.match(html, /<td class="hm-p2">0,90<\/td>/); assert.match(html, /<td class="hm-n1">−0,50<\/td>/); assert.match(html, /<td class="hm-na">–<\/td>/); assert.equal((html.match(/hm-self/g) || []).length, 3);
});

test('changer de fenêtre redessine la matrice avec les valeurs de cette fenêtre', async () => {
  const { el } = await run();
  el('#imRng').onclick({ target: { closest: () => ({ dataset: { w: 'max' } }) } });
  assert.match(el('#imTbl').innerHTML, /<td class="hm-n1">−0,40<\/td>/); assert.doesNotMatch(el('#imTbl').innerHTML, /0,90/);
  el('#imRng').onclick({ target: { closest: () => ({ dataset: { w: '20' } }) } });
  assert.match(el('#imTbl').innerHTML, /<td class="hm-0">0,10<\/td>/);
});

test('relations classiques : théorie en français, trois corrélations, lecture colorée ; changements de régime racontés', async () => {
  const { el } = await run(), t = text(el('#imPairs').innerHTML);
  assert.match(t, /Alpha \/ Bravo Parce que\. négative −0,50 −0,40 −0,30 Conforme à la théorie/); assert.match(t, /variable 0,40 0,30 −0,25 Régime inversé/);
  assert.match(el('#imPairs').innerHTML, /sig sm buy">Conforme/); assert.match(el('#imPairs').innerHTML, /sig sm sell">Régime inversé/);
  assert.match(text(el('#imShifts').innerHTML), /Alpha \/ Bravo : 0,90 sur 60 séances contre −0,40 sur l'historique — la relation s'est inversée vers un mouvement conjoint/);
});

test('aucun changement de régime → message dédié ; données insuffisantes → message clair, sans exception', async () => {
  assert.match(text((await run({ ...DATA, shifts: [] })).el('#imShifts').innerHTML), /Aucun changement de régime marqué/);
  const { el } = await run({ assets: [ASSETS[0]], windows: [], matrix: {}, pairs: [], shifts: [] });
  assert.match(el('#msg').textContent, /insuffisantes/); assert.equal(el('#msg').className, 'err');
});

// ---------- accessibilité : texte lisible sur chaque teinte de la carte de chaleur, dans les six thèmes ----------
const themesCss = fs.readFileSync(path.join(ROOT, 'themes.css'), 'utf8');
const THEMES = [...themesCss.matchAll(/\[data-theme="([a-z]+)"\]\{([^}]*)\}/g)].map(m => ({ nom: m[1], v: Object.fromEntries([...m[2].matchAll(/--([\w-]+):([^;}]+)/g)].map(x => [x[1], x[2].trim()])) }));
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = c => { const [r, g, b] = c.map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (top, a, under) => top.map((v, i) => Math.round(v * a + under[i] * (1 - a)));

test('carte de chaleur : texte ≥ 4,5:1 sur chaque teinte (vert/rouge, faible et forte) dans les six thèmes', () => {
  assert.equal(THEMES.length, 6);
  const css = fs.readFileSync(path.join(ROOT, 'shared.css'), 'utf8');
  const part = { p2: +css.match(/\.hm-p2\{background:color-mix\(in srgb,var\(--greenl\) (\d+)%/)[1] / 100, p1: +css.match(/\.hm-p1\{background:color-mix\(in srgb,var\(--greenl\) (\d+)%/)[1] / 100,
    n1: +css.match(/\.hm-n1\{background:color-mix\(in srgb,var\(--redl\) (\d+)%/)[1] / 100, n2: +css.match(/\.hm-n2\{background:color-mix\(in srgb,var\(--redl\) (\d+)%/)[1] / 100 };
  for (const t of THEMES) for (const [k, a] of Object.entries(part)) {
    const teinte = rgb(t.v[k[0] === 'p' ? 'greenl' : 'redl']), fond = mix(teinte, a, rgb(t.v.panel)), r = ratio(rgb(t.v.text), fond);
    assert.ok(r >= 4.5, `${t.nom} .hm-${k} : texte sur teinte = ${r.toFixed(2)}:1`);
  }
});
