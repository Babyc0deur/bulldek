// Pages réellement servies par le serveur : valeurs injectées, liens valides, alerte de démarrage.
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const CALC = require('../calc.js'), { LIMITS } = require('../freshness.js'), T = CALC.THRESHOLDS;

const ROOT = path.join(__dirname, '..'), PORT = 20000 + Math.floor(Math.random() * 900), BASE = `http://127.0.0.1:${PORT}`;
let proc, tmp, log = '';
const get = p => new Promise((res, rej) => http.get(BASE + p, r => { const c = []; r.on('data', x => c.push(x)); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(c).toString() })); }).on('error', rej));
const stop = p => new Promise(done => { if (!p || p.exitCode !== null) return done(); p.once('exit', done); p.kill(); });
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-pages-'));
  proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, NO_REFRESH: '1' } });
  proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 50; i++) { try { if ((await get('/health')).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('serveur non démarré');
});
test.after(async () => { await stop(proc); if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

test('« À propos » : toutes les valeurs sont injectées depuis le code, aucun {{…}} ne reste', async () => {
  const r = await get('/a-propos'), t = text(r.body);
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /text\/html/);
  assert.doesNotMatch(r.body, /\{\{[A-Z_]+\}\}/, 'placeholder non remplacé');
  const moins = n => String(n).replace('-', '−');
  for (const attendu of [
    `à ${T.cotBuy} % ou plus`, `à ${T.cotSell} % ou moins`, `les ${T.cotShortWeeks} dernières semaines`, `les ${T.cotLongWeeks} dernières semaines`,
    `N = ${T.wrPeriod}`, `au-dessus de ${moins(T.wrHigh)}`, `en dessous de ${moins(T.wrLow)}`, `au moins ${Math.round(T.seasonHitRate * 100)} % des années`, `au moins ${T.seasonMinYears} années`,
    `plus de ${Math.round(T.rollJump * 100)} % en une séance dans les ${T.rollWindow} dernières séances`, `au moins +${T.confluenceStrong}`,
    `plus de ${LIMITS.sessionMaxAge / 864e5} jours`, `plus de ${LIMITS.fetchMaxAge / 36e5} h`, `${LIMITS.cotOverdueGrace / 36e5} h après son heure officielle`, 'toutes les 6 h',
  ]) assert.ok(t.includes(attendu), `valeur absente de la page : « ${attendu} »`);
});

test('« À propos » : le signe moins des seuils négatifs est le signe typographique (−) et non un tiret', async () => {
  const t = text((await get('/a-propos')).body);
  assert.ok(t.includes('−20') && t.includes('−80')); assert.ok(!/ -20 | -80 /.test(t));
});

test("la page mentions légales n'existe plus et aucune page n'y renvoie", async () => {
  assert.equal((await get('/mentions-legales')).status, 404);
  for (const p of ['/a-propos', '/screener', '/compare', '/market/nasdaq-100']) assert.doesNotMatch((await get(p)).body, /mentions-legales/, p);
});

test('tous les liens internes des pages pointent vers une page qui répond', async () => {
  const pages = ['/a-propos', '/screener', '/compare', '/market/nasdaq-100'], vus = new Set();
  for (const p of pages) {
    const html = (await get(p)).body;
    for (const m of html.matchAll(/(?:href|src)="(\/[^"#]*)(#[^"]*)?"/g)) {
      const cible = m[1]; if (vus.has(cible)) continue; vus.add(cible);
      const r = await get(cible);
      assert.ok([200, 302].includes(r.status), `${p} → ${cible} : ${r.status}`);
    }
  }
  assert.ok(vus.size >= 12, 'assez de liens vérifiés : ' + vus.size);
  for (const a of ['/a-propos', '/compare', '/screener']) assert.ok(vus.has(a), a + ' est bien lié depuis les pages');
});

test('ancres inter-pages : #limites existe dans les pages servies', async () => {
  assert.match((await get('/a-propos')).body, /id="limites"/);
});

test('« À propos » : la méthodologie de l\'open interest cite les seuils réels, avec la virgule décimale', async () => {
  const t = text((await get('/a-propos')).body);
  for (const attendu of ['Open interest', 'hausse confirmée', 'hausse fragile', 'baisse confirmée', 'baisse par liquidation', 'moyenne mobile sur 52 semaines',
    `inférieure à ${String(T.priceFlatPct).replace('.', ',')} % pour le prix ou à ${String(T.oiFlatPct).replace('.', ',')} % pour l'open interest`]) assert.ok(t.includes(attendu), `absent : « ${attendu} »`);
  assert.ok(t.includes('0,5 %') && !t.includes('0.5 %'), 'virgule décimale à la française');
  assert.ok(t.includes('Elle entre dans la confluence par un signal'), 'précise que la lecture entre dans la confluence');
  assert.ok(t.includes('score de −4 à +4') && t.includes('quatre signaux'), 'la confluence est décrite à quatre signaux');
});

test('la fiche marché charge le script de l\'open interest et la section existe', async () => {
  const page = (await get('/market/gold')).body;
  assert.match(page, /<section id="sOi">/); assert.match(page, /<script src="\/oi\.js"><\/script>/);
  assert.equal((await get('/oi.js')).status, 200);
  assert.ok(page.indexOf('id="sCot"') < page.indexOf('id="sOi"'), 'l\'open interest vient juste après le COT');
});
