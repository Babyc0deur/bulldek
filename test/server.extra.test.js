// Serveur réel sur un cache factice : API volatilité et dates clés, screener (tendance, source du COT), page et API du calendrier, menu.
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

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

test('/calendrier et /api/calendrier : page servie, mois en cours par défaut, mois hors période refusé ; menu « Calendrier » après « Intermarket », plus de page Fiabilité', async () => {
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
  for (const f of ['about.html', 'compare.html', 'screener.html', 'themes.html', 'inflation.html', 'rates.html', 'intermarket.html', 'calendar.html'])
    assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /Intermarket<\/a><\/li><li><a href="\/calendrier"[^>]*>Calendrier<\/a><\/li>/, f);
  assert.match(fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8'), /Intermarket<\/a><\/li><li><a href="\/calendrier">\$\{ICON_COT\}Calendrier/);
  assert.equal((await get('/fiabilite')).status, 404); assert.notEqual((await get('/api/reliability')).status, 200, 'API supprimée');
  for (const f of ['about.html', 'screener.html', 'calendar.html']) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /fiabilite/, f);
});
