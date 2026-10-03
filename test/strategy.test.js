// Page « Stratégie » : route servie avec ses seuils injectés, menu présent sur toutes les pages.
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const ROOT = path.join(__dirname, '..'), PORT = 21000 + Math.floor(Math.random() * 900), BASE = `http://127.0.0.1:${PORT}`;
let proc, tmp;
const get = p => new Promise((res, rej) => http.get(BASE + p, r => { const c = []; r.on('data', x => c.push(x)); r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(c).toString() })); }).on('error', rej));

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulldesk-strat-'));
  fs.writeFileSync(path.join(tmp, 'cache.json'), JSON.stringify({ weekly: {}, daily: {}, cot: {}, tff: {}, disagg: {}, macro: {}, _ts: { daily: {} } }));
  proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, NO_REFRESH: '1', QUIET: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await get('/health')).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('le serveur ne démarre pas');
});
test.after(async () => { await new Promise(done => { if (!proc || proc.exitCode !== null) return done(); proc.once('exit', done); proc.kill(); }); if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

test('/strategie : page servie, seuils injectés depuis le code, aucun marqueur {{…}} restant, script servi', async () => {
  const p = await get('/strategie'); assert.equal(p.status, 200);
  assert.match(p.body, /Stratégie : le swing trading/);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(p.body), 'marqueur non remplacé'); assert.match(p.body, /COT Index 6 mois d'au plus 20 %/); assert.match(p.body, /au moins 60 % des années/);
  assert.match(p.body, /sous −80 \(survente\)/); assert.match(p.body, /a href="\/strategie" class="cur-page"/);
  assert.ok(!/<script>[^<]/.test(p.body) && !/ style="/.test(p.body), 'CSP : pas de script ni de style en ligne');
  assert.ok(!/id="calc"|id="risque"/.test(p.body), 'sections retirées');
});

test('menu : « Stratégie » juste après « Intermarket » sur toutes les pages, y compris la fiche marché', () => {
  for (const f of ['about.html', 'compare.html', 'screener.html', 'themes.html', 'inflation.html', 'rates.html', 'intermarket.html', 'strategy.html'])
    assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /<li><a href="\/intermarket"[^>]*>Intermarket<\/a><\/li><li><a href="\/strategie"[^>]*>Stratégie<\/a><\/li>/, f);
  assert.match(fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8'), /Intermarket<\/a><\/li><li><a href="\/strategie">\$\{ICON_COT\}Stratégie/);
});
