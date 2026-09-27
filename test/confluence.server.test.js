// Confluence à 4 signaux, de bout en bout : deux marchés où prix et open interest montent ; l'un a un changement de contrat récent.
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const CALC = require('../calc.js');

const ROOT = path.join(__dirname, '..'), PORT = 21000 + Math.floor(Math.random() * 900);
const MARKETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'markets.json'), 'utf8'));
const CLEAN = MARKETS.find(m => m.slug === 'nasdaq-100'), ROLL = MARKETS.find(m => m.slug === 'gold');
let proc, tmp;

function lastPublishedTuesday() {
  let t = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  while (new Date(t).getUTCDay() !== 2) t -= 864e5;
  for (;; t -= 7 * 864e5) if (CALC.etInstant(CALC.cotReleaseDate(new Date(t).toISOString().slice(0, 10)).date) <= Date.now() - 36e5) return t;
}
const R = lastPublishedTuesday();

// prix : +0,1 % par jour (donc ≈ +0,7 % par semaine, au-dessus du seuil de 0,5 %), une séance par jour calendaire ; `saut` : à partir du lundi précédant le dernier rapport, ×1,12
function daily(saut) {
  const rows = [], start = Date.UTC(new Date().getUTCFullYear() - 11, 0, 1), end = Date.now() - 864e5;
  for (let t = start, i = 0; t < end; t += 864e5, i++) { let c = 1000 * Math.pow(1.001, i); if (saut && t >= R - 864e5) c *= 1.12; rows.push([t / 1e3, +c.toFixed(3), +(c * 1.005).toFixed(3), +(c * 0.995).toFixed(3)]); }
  return rows;
}
// COT : open interest en hausse de 6 % sur la dernière semaine
const cotHist = () => Array.from({ length: 200 }, (_, i) => [new Date(R - (199 - i) * 7 * 864e5).toISOString().slice(0, 10), 100 + i, 300 - i, 50, 60, 10, 20, i === 199 ? 106000 : 100000]);
const weekly = d => d.filter((_, i) => i % 7 === 0).slice(-100);
const latest = { report_date_as_yyyy_mm_dd: '2026-09-15T00:00:00.000' };

const get = p => new Promise((res, rej) => http.get(`http://127.0.0.1:${PORT}${p}`, r => { const c = []; r.on('data', x => c.push(x)); r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(c).toString() })); }).on('error', rej));
const stop = p => new Promise(done => { if (!p || p.exitCode !== null) return done(); p.once('exit', done); p.kill(); });

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-conf-'));
  const dClean = daily(false), dRoll = daily(true), h = cotHist(), now = Date.now(), cot = { at: now, latest, hist: h };
  fs.writeFileSync(path.join(tmp, 'cache.json'), JSON.stringify({
    weekly: { [CLEAN.code]: weekly(dClean), [ROLL.code]: weekly(dRoll) }, daily: { [CLEAN.code]: dClean, [ROLL.code]: dRoll },
    cot: { [CLEAN.code]: cot, [ROLL.code]: cot }, tff: {}, disagg: {}, weeklyAt: now, dailyAt: now }));
  proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, NO_REFRESH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await get('/health')).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('serveur non démarré');
});
test.after(async () => { await stop(proc); if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

const rows = async () => Object.fromEntries(JSON.parse((await get('/api/screener')).body).rows.map(r => [r.slug, r]));

test('marché sans anomalie : prix et open interest en hausse → hausse confirmée → signal +1, compté dans la confluence', async () => {
  const r = (await rows())[CLEAN.slug];
  assert.equal(r.roll, false);
  assert.equal(r.oi.key, 'trend-up'); assert.equal(r.oi.label, 'Hausse confirmée');
  assert.ok(Math.abs(r.oi.chgPct - 6) < 1e-9, 'open interest +6 %'); assert.ok(r.oi.priceChgPct > 0.5, 'prix > 0,5 % : ' + r.oi.priceChgPct);
  assert.equal(r.sig.oi, 1);
  assert.equal(r.score, r.sig.cot + r.sig.season + r.sig.wr + 1);
});

test('changement de contrat récent : la lecture brute reste visible, mais le signal est neutralisé (0)', async () => {
  const r = (await rows())[ROLL.slug];
  assert.equal(r.roll, true, 'le saut de 12 % doit être détecté');
  assert.equal(r.oi.key, 'trend-up', 'la lecture brute est conservée pour l\'affichage');
  assert.equal(r.sig.oi, 0, 'signal d\'open interest neutralisé');
  assert.equal(r.sig.wr, 0, 'le Williams %R est neutralisé pour la même raison');
  assert.equal(r.score, r.sig.cot + r.sig.season);
});

test('l\'open interest fait varier la confluence : même marché, sans le signal, le score serait inférieur de 1', async () => {
  const c = (await rows())[CLEAN.slug];
  assert.equal(c.score - (c.sig.cot + c.sig.season + c.sig.wr), 1);
});

test('marché sans données : pas de ligne d\'open interest, pas de plantage', async () => {
  const w = (await rows())['wheat'];
  assert.equal(w.missing, true); assert.equal('oi' in w, false);
});
