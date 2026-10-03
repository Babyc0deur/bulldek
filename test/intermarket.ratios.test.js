// Ratios intermarchés pour les indices : calcul (intermarket.js), route du vrai serveur, rendu client dans un faux DOM.
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const I = require('../intermarket.js');
const { render } = require('../tools/fake-dom.js');

const T0 = Date.UTC(2024, 0, 1), DAY = 864e5;
const line = (n, f, skip = () => false) => Array.from({ length: n }, (_, i) => [(T0 + i * DAY) / 1e3, f(i), 0, 0]).filter((_, i) => !skip(i));
const ROOT = path.join(__dirname, '..');
const NQ_SP = (nq, sp, n = 200) => ({ 'nasdaq-100': line(n, nq), sp500: line(n, sp) });             // Nasdaq 100 / S&P 500 : ratio qui sert de support aux tests de calcul
const get1 = d => d.ratios.find(r => r.id === 'nasdaq-sp500');

test('définitions : ratios centrés sur les indices (aucun ratio autour de l\'or), marchés existants, lectures dans les deux sens', () => {
  const slugs = require('../markets.json').map(m => m.slug), ids = I.RATIOS.map(r => r.id);
  assert.deepEqual(ids, ['actions-obligations', 'nasdaq-sp500', 'nasdaq-dow', 'sp500-dollar', 'sp500-petrole']); assert.equal(new Set(ids).size, ids.length);
  for (const r of I.RATIOS) { assert.ok(slugs.includes(r.num) && slugs.includes(r.den) && r.num !== r.den); assert.ok(r.up.length > 20 && r.down.length > 20); assert.ok(!/scale/.test(Object.keys(r).join())); assert.ok(r.label.includes('/')); }
  assert.ok(I.RATIOS.every(r => !['gold', 'silver', 'copper'].includes(r.num) && !['gold', 'silver', 'copper'].includes(r.den)), 'plus aucune jambe métal');
  assert.ok(I.RATIOS.every(r => ['sp500', 'nasdaq-100'].includes(r.num)), 'le numérateur est toujours un indice');
  assert.deepEqual([...I.RATIO_SLUGS].sort(), ['10-year-t-note', 'crude-oil', 'dow-jones', 'nasdaq-100', 'sp500', 'us-dollar']);
});

test('valeur du ratio = marché 1 / marché 2 aux dates communes ; précision conservée pour de petites valeurs', () => {
  const d = I.ratios(NQ_SP(() => 400, () => 100)); assert.equal(get1(d).last, 4); assert.equal(get1(d).series.length, 200);
  const petit = I.ratios({ sp500: line(100, () => 0.0123456789), 'us-dollar': line(100, () => 1) }).ratios[0];
  assert.equal(petit.last, 0.012346, '5 chiffres significatifs, même pour une valeur proche de zéro');
  const trou = I.ratios({ 'nasdaq-100': line(200, () => 300), sp500: line(200, () => 100, i => i % 2 === 1) });
  assert.equal(get1(trou).series.length, 100); assert.equal(get1(trou).last, 3);
});

test('variations 20 et 60 séances, sens sur 3 mois (seuil 1 %), lecture avec chiffres', () => {
  const up = get1(I.ratios(NQ_SP(i => 100 * (1 + i / 400), () => 100)));
  assert.equal(up.dir, 'up'); assert.ok(up.chg60 > 1 && up.chg20 > 0 && up.chg20 < up.chg60);
  assert.match(up.reading, /^Nasdaq 100 \/ S&P 500 progresse de \d+,\d % sur 3 mois — le Nasdaq surperforme le S&P 500 : leadership de la croissance/);
  const down = get1(I.ratios(NQ_SP(i => 100 * (1 - i / 400), () => 100)));
  assert.equal(down.dir, 'down'); assert.match(down.reading, /recule de \d+,\d % sur 3 mois — le S&P 500 surperforme le Nasdaq : rotation hors de la technologie/);
  const flat = get1(I.ratios(NQ_SP(i => 100 + (i % 2) * 0.001, () => 100)));
  assert.equal(flat.dir, 'flat'); assert.match(flat.reading, /est stable depuis 3 mois \([+−]?\d,\d %\) : aucune des deux jambes ne prend le dessus/);
});

test('position sur 1 an : plus haut → 100 %, plus bas → faible ; calculée sur les 250 dernières séances seulement', () => {
  const haut = get1(I.ratios(NQ_SP(i => 1 + i, () => 1000, 300))), bas = get1(I.ratios(NQ_SP(i => 300 - i, () => 1000, 300)));
  assert.equal(haut.pos250, 100); assert.ok(bas.pos250 <= 1);
  assert.equal(get1(I.ratios(NQ_SP(i => (i < 100 ? 1e6 : 1 + i), () => 1000, 400))).pos250, 100, 'un énorme pic ancien (hors des 250 dernières) ne compte pas');
  assert.equal(I.ratios(NQ_SP(() => 1, () => 1, 60)).ratios.length, 0, '60 séances ou moins : pas de ratio');
  assert.equal(get1(I.ratios(NQ_SP(() => 1, () => 1, 61))).pos250, 100, 'série constante : la dernière valeur égale toutes les autres');
});

test('données insuffisantes : ratio ignoré (jamais inventé), structure vide sans exception', () => {
  const d = I.ratios({ sp500: line(300, () => 100), 'nasdaq-100': line(30, () => 200), 'us-dollar': line(300, () => 50) });
  assert.deepEqual(d.ratios.map(r => r.id), ['sp500-dollar']);                                    // Nasdaq : 30 séances → écarté ; S&P/dollar complet
  const vide = I.ratios({}); assert.deepEqual(vide.ratios, []); assert.equal(vide.asOf, null);
  assert.match(I.ratios(NQ_SP(() => 1, () => 1, 100)).asOf, /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- serveur ----------
const PORT = 21000 + Math.floor(Math.random() * 900), BASE = `http://127.0.0.1:${PORT}`;
const MARKETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'markets.json'), 'utf8')), code = s => MARKETS.find(m => m.slug === s).code;
let proc, tmp;
const get = p => new Promise((res, rej) => http.get(BASE + p, r => { const c = []; r.on('data', x => c.push(x)); r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(c).toString() })); }).on('error', rej));
const rows = f => line(300, f).map(r => [r[0], r[1], r[1], r[1]]);

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulldesk-ratios-'));
  const d = { [code('sp500')]: rows(i => 100 + i), [code('nasdaq-100')]: rows(i => 200 + 2 * i), [code('us-dollar')]: rows(() => 50), [code('gold')]: rows(() => 1) };
  fs.writeFileSync(path.join(tmp, 'cache.json'), JSON.stringify({ weekly: {}, daily: d, cot: {}, tff: {}, disagg: {}, macro: {}, _ts: { daily: Object.fromEntries(Object.keys(d).map(k => [k, Date.now()])) } }));
  proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, NO_REFRESH: '1', QUIET: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await get('/health')).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('le serveur ne démarre pas');
});
test.after(async () => { await new Promise(done => { if (!proc || proc.exitCode !== null) return done(); proc.once('exit', done); proc.kill(); }); if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

test('/api/ratios : seuls les ratios dont les deux marchés sont en cache (Nasdaq/S&P et S&P/dollar ici), séries complètes ; l\'or en cache n\'ajoute rien', async () => {
  const r = await get('/api/ratios'), d = JSON.parse(r.body);
  assert.equal(r.status, 200); assert.deepEqual(d.ratios.map(x => x.id).sort(), ['nasdaq-sp500', 'sp500-dollar']);
  const sd = d.ratios.find(x => x.id === 'sp500-dollar'); assert.equal(sd.series.length, 300); assert.equal(sd.last, 7.98); assert.equal(sd.dir, 'up');   // (100 + 299) / 50 = 7,98
  assert.ok(Array.isArray(sd.series[0]) && sd.series[0].length === 2 && sd.series[0][0] > 1e9, 'horodatages en secondes');
});

// ---------- rendu client ----------
const RATIO = (id, label, extra = {}) => ({ id, label, num: 'a', den: 'b', last: 1.56, chg20: 7.66, chg60: 3.92, pos250: 95, dir: 'up', reading: `${label} progresse.`,
  series: Array.from({ length: 120 }, (_, i) => [(T0 + i * DAY) / 1e3, 1 + i / 100]), ...extra });
const DATA = { updated: 1, asOf: '2026-10-02', ratios: [RATIO('nasdaq-sp500', 'Nasdaq 100 / S&P 500'), RATIO('nasdaq-dow', 'Nasdaq 100 / Dow Jones', { chg60: -2.5, dir: 'down', pos250: null })] };
// Historique long (≈ 4 ans) pour distinguer les périodes 1 an / 3 ans / Max.
const LONG_SERIES = Array.from({ length: 1500 }, (_, i) => [(T0 + i * DAY) / 1e3, 1 + i / 1000]);
const LONG = { updated: 1, asOf: '2026-10-02', ratios: [RATIO('nasdaq-sp500', 'Nasdaq 100 / S&P 500', { series: LONG_SERIES })] };
const run = (data = DATA) => render({ src: path.join(ROOT, 'intermarketview.js'), fnName: '((a, root) => renderRatios(a, root))', args: data, now: Date.parse('2026-10-03T10:00:00Z'), calc: {} });
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('un graphique par ratio : ratio puis moyenne sur 50 séances (pointillés), fenêtre de 3 ans par défaut, indicateurs et lecture', async () => {
  const { rec, el, root } = await run();
  for (const [id, nom] of [['nasdaq-sp500', 'Nasdaq 100 / S&P 500'], ['nasdaq-dow', 'Nasdaq 100 / Dow Jones']]) {
    const s = rec.charts['#rc-' + id].series; assert.deepEqual(s.map(x => x.name), [nom, 'Moyenne 50 séances']);
    assert.ok(Array.isArray(s[1].dash)); assert.equal(s[0].data.length, 120); assert.equal(s[1].data.length, 120 - 49, 'moyenne : à partir de la 50e séance');
    assert.ok(s[0].data.every(p => p[0] > 1e12), 'abscisses en millisecondes');
  }
  assert.match(root.innerHTML, /data-m="36" aria-pressed="true"/); assert.match(root.innerHTML, /kpis tri/); assert.doesNotMatch(root.innerHTML, /\sstyle=/);
  assert.equal(text(el('#rk-nasdaq-sp500').innerHTML), 'Valeur 1,56 3 mois +3,9 % Position sur 1 an 95 %');
  assert.match(text(el('#rk-nasdaq-dow').innerHTML), /3 mois −2,5 % Position sur 1 an –$/); assert.equal(el('#rr-nasdaq-dow').textContent, 'Nasdaq 100 / Dow Jones progresse.');
});

test('moyenne mobile : 50e point = moyenne des 50 premières valeurs ; changer de période redessine tous les graphiques', async () => {
  const { rec } = await run();
  const s = rec.charts['#rc-nasdaq-sp500'].series[1].data[0], attendu = Array.from({ length: 50 }, (_, i) => 1 + i / 100).reduce((a, b) => a + b, 0) / 50;
  assert.ok(Math.abs(s[1] - attendu) < 1e-9, s[1] + ' vs ' + attendu);
  assert.equal(rec.charts['#rc-nasdaq-dow'].series[0].data.length, 120, 'historique court : toute la série tient dans la fenêtre de 3 ans');
  const L = await run(LONG), jours = c => (c.xmax - c.xmin) / DAY, ch = () => L.rec.charts['#rc-nasdaq-sp500'];
  assert.ok(jours(ch()) > 1090 && jours(ch()) < 1100, '3 ans par défaut : ' + jours(ch()));
  L.el('#rtRng').onclick({ target: { closest: () => ({ dataset: { m: '0' } }) } });
  assert.equal(ch().series[0].data.length, 1500); assert.ok(jours(ch()) > 1495, 'Max : tout l\'historique');
  L.el('#rtRng').onclick({ target: { closest: () => ({ dataset: { m: '12' } }) } });
  assert.ok(jours(ch()) > 360 && jours(ch()) < 370, '1 an : ' + jours(ch())); assert.ok(ch().series[1].data.length > 0 && ch().series[1].data.every(p => p[0] >= ch().xmin), 'moyenne limitée à la fenêtre');
});

test('aucun ratio disponible : message clair, aucune exception', async () => {
  for (const data of [{ ratios: [] }, null, {}]) assert.match((await run(data)).root.innerHTML, /Ratios indisponibles/);
});

test('page : conteneur des ratios présent, chargé indépendamment de la matrice', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'intermarket.html'), 'utf8'), /<div id="ratios"><\/div>/);
  const v = fs.readFileSync(path.join(ROOT, 'intermarketview.js'), 'utf8');
  assert.match(v, /BD\.json\('\/api\/ratios'\)\.catch\(\(\) => null\)/);
});
