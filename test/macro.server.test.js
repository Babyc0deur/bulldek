// Routes macro et debrief du vrai serveur, avec un cache factice (aucun accès réseau : les données macro sont préchargées et fraîches).
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const ROOT = path.join(__dirname, '..'), PORT = 19000 + Math.floor(Math.random() * 900), BASE = `http://127.0.0.1:${PORT}`;
const NQ = JSON.parse(fs.readFileSync(path.join(ROOT, 'markets.json'), 'utf8')).find(m => m.slug === 'nasdaq-100');
let proc, tmp;
const get = p => new Promise((res, rej) => http.get(BASE + p, r => { const c = []; r.on('data', x => c.push(x)); r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(c).toString() })); }).on('error', rej));
const now = Date.now();

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulldesk-macro-'));
  const macro = {
    cpi: { yoy: { USA: [['2026-07', 3.2], ['2026-08', 3.4]] }, mom: { USA: [['2026-08', 0.2]] } },
    rates: { immediate: { USA: [['2026-08', 3.64]] }, short: {}, long: {} },
    yields: { us10y: [['2026-09-24', 5.18]], vix: [['2026-09-22', 14.21]] },
    calendar: [{ t: now + 2 * 36e5, ccy: 'USD', title: 'Core PCE', impact: 'High', forecast: '0.2%', previous: '0.3%' }],
  };
  fs.writeFileSync(path.join(tmp, 'cache.json'), JSON.stringify({ weekly: {}, daily: {}, cot: {}, tff: {}, disagg: {}, macro, _ts: { macro: { cpi: now, rates: now, calendar: now, yields: now } } }));
  proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, NO_REFRESH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await get('/health')).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('le serveur ne démarre pas');
});
test.after(async () => { await new Promise(done => { if (!proc || proc.exitCode !== null) return done(); proc.once('exit', done); proc.kill(); }); if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

test('/api/macro : inflation et taux servis avec la liste des zones ; « kind » invalide → 400', async () => {
  const c = JSON.parse((await get('/api/macro?kind=cpi')).body), r = JSON.parse((await get('/api/macro?kind=rates')).body);
  assert.deepEqual(c.data.yoy.USA, [['2026-07', 3.2], ['2026-08', 3.4]]); assert.ok(c.areas.some(a => a.code === 'USA' && a.name === 'États-Unis')); assert.ok(c.updated > 0);
  assert.deepEqual(r.data.immediate.USA, [['2026-08', 3.64]]);
  assert.equal((await get('/api/macro?kind=x')).status, 400); assert.equal((await get('/api/macro')).status, 400);
});

test('/api/calendar : annonces normalisées', async () => {
  const c = JSON.parse((await get('/api/calendar')).body);
  assert.equal(c.events.length, 1); assert.equal(c.events[0].title, 'Core PCE');
});

test('/api/debrief : marché inconnu → 400 ; marché sans données de prix → indisponible (pas d\'invention)', async () => {
  assert.equal((await get('/api/debrief?slug=nimportequoi')).status, 400); assert.equal((await get('/api/debrief')).status, 400);
  const d = JSON.parse((await get('/api/debrief?slug=' + NQ.slug)).body);
  assert.equal(d.available, false); assert.match(d.message, /insuffisantes/);
});

test('pages Inflation et Taux servies, avec leur script ; les modules serveur ne sont pas exposés', async () => {
  for (const [p, kind] of [['/inflation', 'cpi'], ['/taux', 'rates']]) { const r = await get(p); assert.equal(r.status, 200); assert.match(r.body, new RegExp(`data-kind="${kind}"`)); assert.match(r.body, /macroview\.js/); }
  assert.equal((await get('/macroview.js')).status, 200); assert.equal((await get('/debriefview.js')).status, 200);
  for (const p of ['/macro.js', '/debrief.js']) assert.equal((await get(p)).status, 404, p);
});

test('/api/yields : rendements et VIX servis depuis le cache', async () => {
  const y = JSON.parse((await get('/api/yields')).body);
  assert.deepEqual(y.data.us10y, [['2026-09-24', 5.18]]); assert.ok(y.updated > 0);
});
