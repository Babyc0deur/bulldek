// Page « Fiabilité » : API et routes du vrai serveur (cache factice), rendu client dans un faux DOM, menu ; API volatilité et dates clés.
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { render } = require('../tools/fake-dom.js');

const ROOT = path.join(__dirname, '..'), PORT = 22000 + Math.floor(Math.random() * 900), BASE = `http://127.0.0.1:${PORT}`;
const MARKETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'markets.json'), 'utf8')), code = s => MARKETS.find(m => m.slug === s).code;
let proc, tmp;
const get = p => new Promise((res, rej) => http.get(BASE + p, r => { const c = []; r.on('data', x => c.push(x)); r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(c).toString() })); }).on('error', rej));

// 9 ans de séances (hausse régulière) et de rapports COT hebdomadaires pour l'or : assez pour 5 années de saisonnalité puis des mesures.
const DAY = 86400, rows = []; { let c = 100; for (let t = Date.UTC(2015, 0, 2) / 1e3 + 75600; t < Date.UTC(2024, 0, 1) / 1e3; t += DAY) { const w = new Date(t * 1e3).getUTCDay(); if (w === 0 || w === 6) continue; c *= 1.0004; rows.push([t, +c.toFixed(4), +c.toFixed(4), +(c * 0.997).toFixed(4)]); } }
const hist = []; for (let t = Date.UTC(2015, 0, 6), k = 0; t < Date.UTC(2024, 0, 1); t += 7 * 864e5, k++) hist.push([new Date(t).toISOString().slice(0, 10), 100000 + (k % 40) * 1000, 100000, 0, 0, 0, 0, 500000 + k]);

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulldesk-rel-'));
  const g = code('gold');
  fs.writeFileSync(path.join(tmp, 'cache.json'), JSON.stringify({ weekly: {}, daily: { [g]: rows }, cot: { [g]: { at: 1, latest: {}, hist } }, tff: {}, disagg: {}, macro: {}, cash: {},
    _ts: { daily: { [g]: Date.now() }, cot: { [g]: Date.now() } } }));
  proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, NO_REFRESH: '1', QUIET: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await get('/health')).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('le serveur ne démarre pas');
});
test.after(async () => { await new Promise(done => { if (!proc || proc.exitCode !== null) return done(); proc.once('exit', done); proc.kill(); }); if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

test('/api/reliability : calcul en arrière-plan (« en cours » avec avancement, puis résultat) ; trois horizons, signaux et libellés ; /fiabilite servie', async () => {
  let r, d;
  for (let i = 0; i < 100; i++) {                                                       // le serveur lance le calcul 2 s après son démarrage
    r = await get('/api/reliability'); d = JSON.parse(r.body);
    if (!d.loading) break;
    assert.ok(d.progress && typeof d.progress.done === 'number', 'avancement fourni pendant le calcul');
    await new Promise(res => setTimeout(res, 200));
  }
  assert.equal(r.status, 200); assert.ok(!d.loading, 'calcul terminé'); assert.deepEqual(d.horizons, [5, 10, 20]); assert.equal(d.markets.length, 1);
  const m = d.markets[0];
  assert.equal(m.slug, 'gold'); assert.equal(m.cotSource, 'legacy'); assert.equal(m.adjusted, false, 'pas de comptant pour l\'or : série brute');
  assert.ok(m.weeks > 100); assert.ok(m.horizons[5].signals.season && m.horizons[20].scores.length === 9);
  assert.ok(d.labels.wr.includes('tendance') && d.labels['cot:tff-lev'].includes('contre-sens'));
  const p = await get('/fiabilite'); assert.equal(p.status, 200); assert.match(p.body, /data-page="reliability"/); assert.match(p.body, /<script src="\/reliabilityview\.js">/);
  assert.equal((await get('/reliabilityview.js')).status, 200);
  for (const f of ['reliability.js', 'adjust.js', 'vol.js', 'keydates.js', 'dailymerge.js']) assert.equal((await get('/' + f)).status, 404, f + ' reste côté serveur');
});

test('/api/keydates : 6 mois de dates triées ; /api/volatility : réponse sans plantage même sans VIX en cache', async () => {
  const k = JSON.parse((await get('/api/keydates')).body);
  assert.ok(k.dates.length > 5); assert.ok(k.dates.every((x, i) => !i || k.dates[i - 1].date <= x.date)); assert.ok(k.dates.some(x => x.kind === 'quad'));
  const v = await get('/api/volatility'); assert.equal(v.status, 200); assert.ok('vol' in JSON.parse(v.body));
});

test('screener : Williams %R filtré par la tendance (hausse régulière : au-dessus de la moyenne 200 séances) ; source du COT', async () => {
  const s = JSON.parse((await get('/api/screener')).body).rows.find(r => r.slug === 'gold');
  assert.equal(s.trend.up, true); assert.ok(s.trend.pct > 0); assert.equal(s.cotSource, 'legacy'); assert.match(s.cotLabel, /commerciaux/);
  assert.equal(s.wrZone, -1, 'clôture au plus haut de 14 séances : surachat'); assert.equal(s.sig.wr, 0, 'surachat en tendance haussière : ignoré');
});

// ---------- rendu client ----------
const H = h => ({ base: { n: 100, mean: 0.2, median: 0.3, hit: 57 }, scores: [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(s => ({ score: s, n: 10, mean: s / 10, median: s / 10, hit: 50 })),
  up: { n: 30, mean: 0.5 }, mixed: { n: 40, mean: 0.2 }, down: { n: 30, mean: -0.1 }, spread: 0.6, t: h === 5 ? 2.4 : 0.8, verdict: h === 5 ? { key: 'good', label: 'Utile' } : { key: 'none', label: 'Non significatif' }, halves: [0.5, 0.7], stable: true,
  signals: Object.fromEntries(['cot', 'season', 'wr', 'oi', 'wrRaw', 'trend', 'cot:legacy'].map((k, i) => [k, { plus: { n: 20, mean: 0.4 }, zero: { n: 50, mean: 0.1 }, minus: { n: 20, mean: -0.2 }, spread: 0.6, t: k === 'season' ? -2.2 : 1 + i / 10,
    verdict: k === 'season' ? { key: 'bad', label: 'À contre-sens' } : { key: 'none', label: 'Non significatif' }, halves: [0.3, -0.1], stable: false }])) });
const MK = (slug, name, group) => ({ slug, name, group, from: '2005-12-30', to: '2026-09-25', weeks: 1083, cotSource: 'legacy', adjusted: true, horizons: { 5: H(5), 10: H(10), 20: H(20) } });
const DATA = { horizons: [5, 10, 20], labels: { cot: 'COT (signal de la confluence)', season: 'Saisonnalité de la semaine', wr: 'Williams %R filtré par la tendance', oi: 'Open interest', wrRaw: 'Williams %R sans filtre', trend: 'Tendance', 'cot:legacy': 'COT commerciaux (Legacy)' },
  markets: [MK('sp500', 'S&P 500 E-Mini', 'Indices'), MK('nasdaq-100', 'Nasdaq 100 E-Mini', 'Indices'), MK('gold', 'Gold', 'Metals')] };
const run = (data = DATA) => render({ src: path.join(ROOT, 'reliabilityview.js'), fnName: '((a, root) => renderReliability(a, root))', args: data, now: Date.parse('2026-10-05T10:00:00Z'), calc: {} });
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('page : catégorie Indices et horizon 5 séances par défaut ; résumé des marchés du groupe ; détail du premier', async () => {
  const { el, root } = await run(), sum = el('#rlSum').innerHTML;
  assert.match(root.innerHTML, /<option selected>Indices<\/option>/); assert.match(root.innerHTML, /data-h="5" aria-pressed="true"/);
  assert.match(sum, /S&P 500 E-Mini/); assert.match(sum, /Nasdaq 100 E-Mini/); assert.doesNotMatch(sum, /Gold/);
  assert.match(sum, /<span class="sig sm buy">Utile<\/span>/); assert.match(sum, /<span class="sig sm sell">À contre-sens<\/span>/);
  const det = text(el('#rlDetail').innerHTML);
  assert.match(det, /Détail : S&P 500 E-Mini · 5 séances/); assert.match(det, /1083/); assert.match(det, /\+0,20 %/);
  assert.match(det, /−4 10 −0,40 %/, 'score négatif avec le signe moins typographique');
  assert.match(det, /Williams %R sans filtre/); assert.match(det, /instable/);
  assert.match(text(el('#rlRead').innerHTML), /saisonnalité de la semaine a plutôt fonctionné à l'envers/);
});

test('page : changer d\'horizon, de marché et de catégorie redessine le résumé et le détail', async () => {
  const { el } = await run();
  el('#rlH').onclick({ target: { closest: () => ({ dataset: { h: '20' } }) } });
  assert.match(text(el('#rlDetail').innerHTML), /20 séances/); assert.doesNotMatch(el('#rlSum').innerHTML, />Utile</);
  el('#rlSum').onclick({ target: { closest: () => ({ dataset: { slug: 'nasdaq-100' } }) } });
  assert.match(text(el('#rlDetail').innerHTML), /Détail : Nasdaq 100 E-Mini/);
  el('#rlGrp').onchange({ target: { value: 'Metals' } });
  assert.match(el('#rlSum').innerHTML, /Gold/); assert.match(text(el('#rlDetail').innerHTML), /Détail : Gold/);
});

test('page : aucune donnée → message clair', async () => {
  const { root } = await run({ horizons: [5], markets: [] });
  assert.match(root.innerHTML, /Historique insuffisant/);
});

test('menu : « Fiabilité » juste après « Intermarket » sur toutes les pages, y compris la fiche marché', () => {
  for (const f of ['about.html', 'compare.html', 'screener.html', 'themes.html', 'inflation.html', 'rates.html', 'intermarket.html', 'reliability.html'])
    assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /Intermarket<\/a><\/li><li><a href="\/fiabilite"[^>]*>Fiabilité<\/a><\/li>/, f);
  assert.match(fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8'), /Intermarket<\/a><\/li><li><a href="\/fiabilite">\$\{ICON_COT\}Fiabilité/);
  assert.match(fs.readFileSync(path.join(ROOT, 'reliability.html'), 'utf8'), /<a href="\/fiabilite" class="cur-page">/);
});

test('page : pendant le calcul côté serveur, avancement affiché puis page rendue dès que le résultat arrive', async () => {
  const replies = [{ loading: true, progress: { done: 3, total: 37 } }, { loading: true, progress: { done: 30, total: 37 } }, DATA], seen = [];
  const { root } = await render({ src: path.join(ROOT, 'reliabilityview.js'), fnName: '((a, root) => bootReliability(root, async () => { a.push(root.innerHTML); }))', args: seen,
    now: Date.parse('2026-10-05T10:00:00Z'), calc: {}, overrides: { json: async () => replies.shift() } });
  assert.equal(seen.length, 2); assert.match(seen[0], /3 \/ 37 marchés/); assert.match(seen[1], /30 \/ 37 marchés/); assert.match(seen[0], /role="status"/);
  assert.match(root.innerHTML, /Résumé par marché/);
});

test('/calendrier et /api/calendrier : page servie, mois en cours par défaut, mois hors période refusé ; menu « Calendrier » après « Fiabilité »', async () => {
  const p = await get('/calendrier'); assert.equal(p.status, 200); assert.match(p.body, /data-page="calendar"/); assert.match(p.body, /<script src="\/calendarview\.js">/);
  assert.equal((await get('/calendarview.js')).status, 200); assert.equal((await get('/monthcal.js')).status, 404, 'module de calcul côté serveur');
  const c = JSON.parse((await get('/api/calendrier')).body);
  const cur = `${c.year}-${String(c.month + 1).padStart(2, '0')}`, i = c.months.indexOf(cur);
  assert.equal(c.view, 'month'); assert.equal(i, 6, 'six mois passés consultables, puis le mois en cours'); assert.ok(c.months.length >= 8, 'au moins le mois suivant');
  assert.ok(c.days.length >= 28 && c.days.some(d => d.today)); assert.match(c.thisWeek, /^\d{4}-\d{2}-\d{2}$/);
  const w = JSON.parse((await get('/api/calendrier?w=' + c.thisWeek)).body);
  assert.equal(w.view, 'week'); assert.equal(w.days.length, 7); assert.equal(w.days[0].weekday, 'lun.'); assert.ok(w.days.some(d => d.today)); assert.match(w.label, /^semaine du /);
  assert.equal((await get('/api/calendrier?w=2026-10-07')).status, 400, 'une semaine commence un lundi');
  assert.equal((await get('/api/calendrier?w=1999-01-04')).status, 400, 'hors période');
  const bad = await get('/api/calendrier?m=1999-01'); assert.equal(bad.status, 400); assert.ok(JSON.parse(bad.body).months);
  for (const f of ['about.html', 'compare.html', 'screener.html', 'themes.html', 'inflation.html', 'rates.html', 'intermarket.html', 'reliability.html', 'calendar.html'])
    assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /Fiabilité<\/a><\/li><li><a href="\/calendrier"[^>]*>Calendrier<\/a><\/li>/, f);
  assert.match(fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8'), /Fiabilité<\/a><\/li><li><a href="\/calendrier">\$\{ICON_COT\}Calendrier/);
});
