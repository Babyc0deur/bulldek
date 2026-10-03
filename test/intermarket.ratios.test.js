// Ratios intermarchés : calcul (intermarket.js), route du vrai serveur, rendu client dans un faux DOM.
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const I = require('../intermarket.js');
const { render } = require('../tools/fake-dom.js');

const T0 = Date.UTC(2024, 0, 1), DAY = 864e5;
const line = (n, f, skip = () => false) => Array.from({ length: n }, (_, i) => [(T0 + i * DAY) / 1e3, f(i), 0, 0]).filter((_, i) => !skip(i));
const ROOT = path.join(__dirname, '..');

test('définitions : marchés existants, identifiants uniques, deux lectures par ratio, échelle explicite', () => {
  const slugs = require('../markets.json').map(m => m.slug), ids = I.RATIOS.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length); assert.deepEqual(I.RATIOS.map(r => r.id), ['cuivre-or', 'actions-obligations', 'or-argent', 'petrole-or', 'actions-or']);
  for (const r of I.RATIOS) { assert.ok(slugs.includes(r.num) && slugs.includes(r.den) && r.num !== r.den); assert.ok(r.up.length > 20 && r.down.length > 20); assert.ok(r.scale === 1 || r.scale === 1000); assert.equal(/×1000/.test(r.label), r.scale === 1000); }
  assert.deepEqual([...I.RATIO_SLUGS].sort(), ['10-year-t-note', 'copper', 'crude-oil', 'gold', 'silver', 'sp500']);
});

test('valeur du ratio = marché 1 / marché 2 (× échelle), aux dates communes ; précision conservée pour de petites valeurs', () => {
  const d = I.ratios({ copper: line(100, () => 4), gold: line(100, () => 4000) });
  const r = d.ratios.find(x => x.id === 'cuivre-or'); assert.equal(r.last, 1); assert.equal(r.series.length, 100);
  const petit = I.ratios({ copper: line(100, () => 0.0123456789), gold: line(100, () => 1) }).ratios[0];   // scale ×1000 : 12,3457 ; sans échelle on aurait perdu les décimales
  assert.equal(petit.last, 12.346);
  const trou = I.ratios({ sp500: line(200, () => 100), gold: line(200, () => 50, i => i % 2 === 1) }).ratios.find(x => x.id === 'actions-or');
  assert.equal(trou.series.length, 100); assert.equal(trou.last, 2);
});

test('variations 20 et 60 séances, sens sur 3 mois (seuil 1 %), lecture avec chiffres', () => {
  const up = I.ratios({ copper: line(200, i => 4 * (1 + i / 400)), gold: line(200, () => 4000) }).ratios[0];
  assert.equal(up.dir, 'up'); assert.ok(up.chg60 > 1 && up.chg20 > 0 && up.chg20 < up.chg60);
  assert.match(up.reading, /^Cuivre \/ Or \(×1000\) progresse de \d+,\d % sur 3 mois — le cuivre \(croissance industrielle\) surperforme l'or/);
  const down = I.ratios({ copper: line(200, i => 4 * (1 - i / 400)), gold: line(200, () => 4000) }).ratios[0];
  assert.equal(down.dir, 'down'); assert.match(down.reading, /recule de \d+,\d % sur 3 mois — l'or \(refuge\) surperforme le cuivre/);
  const flat = I.ratios({ copper: line(200, i => 4 + (i % 2) * 0.001), gold: line(200, () => 4000) }).ratios[0];
  assert.equal(flat.dir, 'flat'); assert.match(flat.reading, /est stable depuis 3 mois \([+−]?\d,\d %\) : aucune des deux jambes ne prend le dessus/);
});

test('position sur 1 an : plus haut → 100 %, plus bas → faible ; calculée sur les 250 dernières séances seulement', () => {
  const haut = I.ratios({ copper: line(300, i => 1 + i), gold: line(300, () => 1000) }).ratios[0], bas = I.ratios({ copper: line(300, i => 300 - i), gold: line(300, () => 1000) }).ratios[0];
  assert.equal(haut.pos250, 100); assert.ok(bas.pos250 <= 1);
  // 400 séances : un énorme pic ancien (hors des 250 dernières) ne doit pas écraser la position actuelle
  const pic = I.ratios({ copper: line(400, i => (i < 100 ? 1e6 : 1 + i)), gold: line(400, () => 1000) }).ratios[0];
  assert.equal(pic.pos250, 100);
  assert.equal(I.ratios({ copper: line(60, () => 1), gold: line(60, () => 1) }).ratios.length, 0, '60 séances ou moins : pas de ratio');
  assert.equal(I.ratios({ copper: line(61, () => 1), gold: line(61, () => 1) }).ratios[0].pos250, 100, 'série constante : la dernière valeur égale toutes les autres');
});

test('données insuffisantes : ratio ignoré (jamais inventé), structure vide sans exception', () => {
  const d = I.ratios({ copper: line(30, () => 4), gold: line(300, () => 4000), sp500: line(300, () => 100) });
  assert.deepEqual(d.ratios.map(r => r.id), ['actions-or']);                                    // cuivre : 30 séances → écarté ; actions/or complet
  const vide = I.ratios({}); assert.deepEqual(vide.ratios, []); assert.equal(vide.asOf, null);
  assert.match(I.ratios({ sp500: line(100, () => 1), gold: line(100, () => 1) }).asOf, /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- serveur ----------
const PORT = 21000 + Math.floor(Math.random() * 900), BASE = `http://127.0.0.1:${PORT}`;
const MARKETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'markets.json'), 'utf8')), code = s => MARKETS.find(m => m.slug === s).code;
let proc, tmp;
const get = p => new Promise((res, rej) => http.get(BASE + p, r => { const c = []; r.on('data', x => c.push(x)); r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(c).toString() })); }).on('error', rej));
const rows = f => line(300, f).map(r => [r[0], r[1], r[1], r[1]]);

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulldesk-ratios-'));
  const d = { [code('sp500')]: rows(i => 100 + i), [code('gold')]: rows(() => 50), [code('copper')]: rows(i => 4 + i / 100) };
  fs.writeFileSync(path.join(tmp, 'cache.json'), JSON.stringify({ weekly: {}, daily: d, cot: {}, tff: {}, disagg: {}, macro: {}, _ts: { daily: Object.fromEntries(Object.keys(d).map(k => [k, Date.now()])) } }));
  proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, NO_REFRESH: '1', QUIET: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await get('/health')).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('le serveur ne démarre pas');
});
test.after(async () => { await new Promise(done => { if (!proc || proc.exitCode !== null) return done(); proc.once('exit', done); proc.kill(); }); if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

test('/api/ratios : seuls les ratios dont les deux marchés sont en cache (actions/or et cuivre/or ici), séries complètes', async () => {
  const r = await get('/api/ratios'), d = JSON.parse(r.body);
  assert.equal(r.status, 200); assert.deepEqual(d.ratios.map(x => x.id).sort(), ['actions-or', 'cuivre-or']);
  const ao = d.ratios.find(x => x.id === 'actions-or'); assert.equal(ao.series.length, 300); assert.equal(ao.last, 7.98); assert.equal(ao.dir, 'up');
  assert.ok(Array.isArray(ao.series[0]) && ao.series[0].length === 2 && ao.series[0][0] > 1e9, 'horodatages en secondes');
});

// ---------- rendu client ----------
const RATIO = (id, label, extra = {}) => ({ id, label, num: 'a', den: 'b', last: 1.56, chg20: 7.66, chg60: 3.92, pos250: 95, dir: 'up', reading: `${label} progresse.`,
  series: Array.from({ length: 120 }, (_, i) => [(T0 + i * DAY) / 1e3, 1 + i / 100]), ...extra });
const DATA = { updated: 1, asOf: '2026-10-02', ratios: [RATIO('cuivre-or', 'Cuivre / Or (×1000)'), RATIO('or-argent', 'Or / Argent', { chg60: -2.5, dir: 'down', pos250: null })] };
// Historique long (≈ 4 ans) pour distinguer les périodes 1 an / 3 ans / Max.
const LONG_SERIES = Array.from({ length: 1500 }, (_, i) => [(T0 + i * DAY) / 1e3, 1 + i / 1000]);
const LONG = { updated: 1, asOf: '2026-10-02', ratios: [RATIO('cuivre-or', 'Cuivre / Or (×1000)', { series: LONG_SERIES })] };
const run = (data = DATA) => render({ src: path.join(ROOT, 'intermarketview.js'), fnName: '((a, root) => renderRatios(a, root))', args: data, now: Date.parse('2026-10-03T10:00:00Z'), calc: {} });
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('un graphique par ratio : ratio puis moyenne sur 50 séances (pointillés), fenêtre de 3 ans par défaut, indicateurs et lecture', async () => {
  const { rec, el, root } = await run();
  for (const id of ['cuivre-or', 'or-argent']) {
    const s = rec.charts['#rc-' + id].series; assert.deepEqual(s.map(x => x.name.replace(/ \(×1000\)/, '')), [id === 'cuivre-or' ? 'Cuivre / Or' : 'Or / Argent', 'Moyenne 50 séances']);
    assert.ok(Array.isArray(s[1].dash)); assert.equal(s[0].data.length, 120); assert.equal(s[1].data.length, 120 - 49, 'moyenne : à partir de la 50e séance');
    assert.ok(s[0].data.every(p => p[0] > 1e12), 'abscisses en millisecondes');
  }
  assert.match(root.innerHTML, /data-m="36" aria-pressed="true"/); assert.match(root.innerHTML, /kpis tri/); assert.doesNotMatch(root.innerHTML, /\sstyle=/);
  assert.equal(text(el('#rk-cuivre-or').innerHTML), 'Valeur 1,56 3 mois +3,9 % Position sur 1 an 95 %');
  assert.match(text(el('#rk-or-argent').innerHTML), /3 mois −2,5 % Position sur 1 an –$/); assert.equal(el('#rr-or-argent').textContent, 'Or / Argent progresse.');
});

test('moyenne mobile : 50e point = moyenne des 50 premières valeurs ; changer de période redessine tous les graphiques', async () => {
  const { rec, el } = await run();
  const s = rec.charts['#rc-cuivre-or'].series[1].data[0], attendu = Array.from({ length: 50 }, (_, i) => 1 + i / 100).reduce((a, b) => a + b, 0) / 50;
  assert.ok(Math.abs(s[1] - attendu) < 1e-9, s[1] + ' vs ' + attendu);
  assert.equal(rec.charts['#rc-or-argent'].series[0].data.length, 120, 'historique court : toute la série tient dans la fenêtre de 3 ans');
  const L = await run(LONG), jours = c => (c.xmax - c.xmin) / DAY, ch = () => L.rec.charts['#rc-cuivre-or'];
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
