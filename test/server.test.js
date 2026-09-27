// Test de bout en bout : lance le vrai serveur avec un cache factice (aucun accès réseau).
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), http = require('node:http'), zlib = require('node:zlib');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const CALC = require('../calc.js');

const ROOT = path.join(__dirname, '..');
const MARKETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'markets.json'), 'utf8'));
const NQ = MARKETS.find(m => m.slug === 'nasdaq-100'), GOLD = MARKETS.find(m => m.slug === 'gold');
const PORT = 18000 + Math.floor(Math.random() * 1000), BASE = `http://127.0.0.1:${PORT}`;
let proc, tmp;

// ---- Données factices : 12 ans de séances, 200 semaines de COT ----
function daily() {
  const rows = [], start = Date.UTC(new Date().getUTCFullYear() - 11, 0, 1), end = Date.now() - 864e5;
  for (let t = start, i = 0; t < end; t += 864e5, i++) {
    const c = 1000 + i * 0.5 + 40 * Math.sin(i / 20);
    rows.push([t / 1e3, +c.toFixed(2), +(c + 5).toFixed(2), +(c - 5).toFixed(2)]);
  }
  return rows;
}
const weekly = d => d.filter((_, i) => i % 7 === 0).slice(-100);
// Dernier rapport COT publié : le mardi le plus récent dont la publication (calendrier officiel, jours fériés compris) date de plus d'une heure.
// Ainsi les données factices sont « à jour » quel que soit le jour où le test est lancé.
function lastPublishedTuesday() {
  let t = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  while (new Date(t).getUTCDay() !== 2) t -= 864e5;
  for (;; t -= 7 * 864e5) { const d = new Date(t).toISOString().slice(0, 10); if (CALC.etInstant(CALC.cotReleaseDate(d).date) <= Date.now() - 36e5) return t; }
}
const cotHist = () => { const end = lastPublishedTuesday(); return Array.from({ length: 200 }, (_, i) => [new Date(end - (199 - i) * 7 * 864e5).toISOString().slice(0, 10), 100 + i, 300 - 2 * i + (i % 7) * 15, 50, 60, 10, 20, 500]); };
const latest = { report_date_as_yyyy_mm_dd: '2026-09-15T00:00:00.000' };

function get(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(BASE + pathname, { headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
const json = async (p, h) => { const r = await get(p, h); return { ...r, data: JSON.parse((r.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(r.body) : r.body).toString()) }; };

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulldesk-'));
  const d = daily(), h = cotHist();
  fs.writeFileSync(path.join(tmp, 'cache.json'), JSON.stringify({
    weekly: { [NQ.code]: weekly(d), [GOLD.code]: weekly(d) }, daily: { [NQ.code]: d, [GOLD.code]: d },
    cot: { [NQ.code]: { at: Date.now(), latest, hist: h }, [GOLD.code]: { at: Date.now(), latest, hist: h } },
    tff: { [NQ.code]: { at: Date.now(), latest, hist: [] } }, disagg: { [GOLD.code]: { at: Date.now(), latest, hist: [] } },
    weeklyAt: Date.now(), dailyAt: Date.now(),
  }));
  proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, NO_REFRESH: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await get('/health')).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('le serveur ne démarre pas');
});
// Arrêter un serveur et attendre sa fin : sous Windows, le fichier SQLite reste verrouillé tant que le processus vit.
const stopProc = p => new Promise(done => { if (!p || p.exitCode !== null) return done(); p.once('exit', done); p.kill(); });
const rmDir = d => fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
test.after(async () => { await stopProc(proc); if (tmp) rmDir(tmp); });

test('santé et pages', async () => {
  assert.deepEqual((await json('/health')).data, { ok: true });
  const home = await get('/');
  assert.equal(home.status, 302); assert.equal(home.headers.location, '/market/nasdaq-100');
  const old = await get('/cot-report/gold');                                       // anciennes adresses → page combinée
  assert.equal(old.status, 302); assert.equal(old.headers.location, '/market/gold');
  const page = await get('/market/gold');
  assert.equal(page.status, 200); assert.match(page.headers['content-type'], /text\/html/); assert.match(page.body.toString(), /id="shell"/);
  assert.equal((await get('/market/inconnu')).status, 404);
  assert.equal((await get('/screener')).status, 200);
});

test('sécurité : les sources du serveur et le cache ne sont jamais servis', async () => {
  for (const p of ['/server.js', '/cftc.js', '/package.json', '/data/cache.json', '/tools/check.sh', '/test/server.test.js', '/%2e%2e/server.js', '/..%2fserver.js', '/market/../server.js', '/render.yaml'])
    assert.equal((await get(p)).status, 404, p);
  for (const p of ['/shared.js', '/calc.js', '/cot.js', '/seasonal.js', '/wr.js', '/screener.js', '/shared.css', '/markets.json'])
    assert.equal((await get(p)).status, 200, p);
});

test('API : codes invalides, marchés sans rapport TFF ou Disaggregated', async () => {
  assert.equal((await get('/api/cot?code=zzz')).status, 400);
  assert.equal((await get('/api/cot')).status, 400);
  assert.equal((await get(`/api/disagg?code=${NQ.code}`)).status, 404);           // marché financier : pas de Disaggregated
  assert.equal((await get(`/api/tff?code=${GOLD.code}`)).status, 404);            // matière première : pas de TFF
  assert.equal((await get(`/api/disagg?code=${GOLD.code}`)).status, 200);
  assert.equal((await get(`/api/tff?code=${NQ.code}`)).status, 200);
});

test('compression gzip et ETag (304 si inchangé)', async () => {
  const url = `/api/daily?code=${NQ.code}`;
  const brut = await get(url), gz = await get(url, { 'accept-encoding': 'gzip' });
  assert.equal(brut.headers['content-encoding'], undefined);
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(gz.body[0], 0x1f); assert.equal(gz.body[1], 0x8b);                  // signature gzip
  assert.ok(gz.body.length < brut.body.length / 2, `gzip ${gz.body.length} vs brut ${brut.body.length}`);
  assert.deepEqual(JSON.parse(zlib.gunzipSync(gz.body)), JSON.parse(brut.body));   // même contenu
  const etag = gz.headers.etag; assert.ok(etag);
  const again = await get(url, { 'if-none-match': etag });
  assert.equal(again.status, 304); assert.equal(again.body.length, 0);
});

test('screener : 37 marchés, manquants signalés, valeurs identiques aux formules de calc.js', async () => {
  const { data } = await json('/api/screener');
  assert.equal(data.rows.length, MARKETS.length);
  assert.equal(data.rows.filter(r => r.missing).length, MARKETS.length - 2);       // seuls deux marchés ont des données factices
  const nq = data.rows.find(r => r.slug === 'nasdaq-100');
  assert.ok(!nq.missing);
  const net = cotHist().map(r => r[1] - r[2]);                                     // commerciaux : longs − shorts
  assert.ok(Math.abs(nq.idx6 - CALC.cotIndex(net, 26).at(-1)) < 1e-9);
  assert.ok(Math.abs(nq.idx36 - CALC.cotIndex(net, 156).at(-1)) < 1e-9);
  const wr = CALC.williamsR(daily(), 14).at(-1)[1];
  assert.ok(Math.abs(nq.wr - wr) < 1e-9, `${nq.wr} vs ${wr}`);
  assert.ok(Number.isInteger(nq.score) && nq.score >= -4 && nq.score <= 4);
  assert.equal(nq.score, nq.sig.cot + nq.sig.season + nq.sig.wr + nq.sig.oi);                  // quatre signaux, dont l'open interest
  const oiExp = CALC.oiWeek(cotHist(), daily());                                                  // même calcul que le serveur, sur les mêmes données
  assert.equal(nq.oi.key, oiExp.reading.key); assert.equal(nq.sig.oi, CALC.oiSignal(oiExp.reading));
  assert.ok(Math.abs(nq.oi.chgPct - oiExp.chgPct) < 1e-9 && nq.oi.last === oiExp.last);
  assert.equal(nq.roll, false);                                                    // série factice sans saut de contrat
});

// =====================================================================================
// Protection de l'API
// =====================================================================================
const net = require('node:net');

function raw(port, requestText) {                       // requête HTTP brute : permet d'envoyer ce que fetch refuserait
  return new Promise(resolve => {
    const s = net.connect(port, '127.0.0.1'); let d = '';
    s.on('data', c => { d += c; }); s.on('close', () => resolve(d)); s.on('error', () => resolve(d));
    s.write(requestText); setTimeout(() => s.destroy(), 1500);
  });
}
async function launch(env) {                            // second serveur avec ses propres limites
  const port = 19000 + Math.floor(Math.random() * 900);
  const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: tmp, NO_REFRESH: '1', ...env }, stdio: 'ignore' });
  const call = (pathname, headers = {}) => new Promise((resolve, reject) => http.get(`http://127.0.0.1:${port}${pathname}`, { headers }, res => {
    const c = []; res.on('data', x => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
  }).on('error', reject));
  for (let i = 0; i < 50; i++) { try { if ((await call('/health')).status === 200) return { port, call, stop: () => stopProc(p) }; } catch {} await new Promise(r => setTimeout(r, 100)); }
  p.kill(); throw new Error('serveur de test non démarré');
}

test('en-têtes de sécurité sur toutes les réponses (page, API, 404, redirection)', async () => {
  for (const p of ['/market/gold', '/screener', '/api/screener', '/shared.js', '/inexistant', '/', '/health']) {
    const r = await get(p);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', p);
    assert.equal(r.headers['x-frame-options'], 'DENY', p);
    assert.match(r.headers['referrer-policy'], /origin/, p);
    assert.ok(r.headers['permissions-policy'], p);
    const csp = r.headers['content-security-policy'];
    assert.match(csp, /frame-ancestors 'none'/, p); assert.match(csp, /object-src 'none'/, p); assert.match(csp, /connect-src 'self'/, p);
    const script = csp.split(';').map(x => x.trim()).find(x => x.startsWith('script-src'));
    assert.equal(script, "script-src 'self'", `${p} : script-src doit rester strict`);
  }
  assert.equal((await get('/market/gold')).headers['strict-transport-security'], undefined);   // pas de HSTS sans proxy HTTPS de confiance
});

test('les pages sont compatibles avec la CSP : aucun script ni gestionnaire d\'événement en ligne', () => {
  for (const f of fs.readdirSync(ROOT).filter(f => /\.(html|js)$/.test(f))) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (f.endsWith('.html')) assert.doesNotMatch(t, /<script(?![^>]*\bsrc=)[^>]*>/i, `${f} : script en ligne`);
    if (!/^(server|guard|calc|cftc)\.js$/.test(f)) assert.doesNotMatch(t, /\son(click|change|input|load|error|submit|mouse\w+)\s*=\s*["']/i, `${f} : gestionnaire en ligne`);
  }
});

test('méthodes : seuls GET et HEAD sont acceptés', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const r = await raw(PORT, `${method} /api/screener HTTP/1.0\r\nContent-Length: 0\r\n\r\n`);
    assert.match(r.split('\r\n')[0], /405/, method);
    assert.match(r, /Allow: GET, HEAD/i, method);
  }
  const head = await new Promise(res => http.request(BASE + '/api/screener', { method: 'HEAD' }, r => { let n = 0; r.on('data', c => { n += c.length; }); r.on('end', () => res({ status: r.statusCode, len: r.headers['content-length'], n })); }).end());
  assert.equal(head.status, 200); assert.ok(+head.len > 0); assert.equal(head.n, 0);          // HEAD : en-têtes sans corps
});

test('requêtes hostiles : URL trop longue et requête mal formée', async () => {
  assert.equal((await get('/api/cot?code=' + 'a'.repeat(3000))).status, 414);
  assert.equal((await get('/api/cot?code=' + 'a'.repeat(2100))).status, 414);
  assert.match((await raw(PORT, 'GET http://[::1 HTTP/1.0\r\n\r\n')).split('\r\n')[0], /400/);
  assert.equal((await get('/api/cot?code=' + encodeURIComponent("' OR 1=1 --"))).status, 400);   // injection : refusée par la liste blanche
  assert.equal((await get('/api/cot?code=../../etc/passwd')).status, 400);
  assert.equal((await get('/health')).status, 200);                                               // le serveur a survécu à tout cela
});

test('limite de débit : 429 avec Retry-After, /health et les pages statiques indépendants', async () => {
  const s = await launch({ RATE_API: '5', RATE_WEB: '8' });
  try {
    for (let i = 1; i <= 5; i++) { const r = await s.call('/api/screener'); assert.equal(r.status, 200, `requête ${i}`); assert.equal(r.headers['ratelimit-remaining'], String(5 - i)); }
    const blocked = await s.call('/api/screener');
    assert.equal(blocked.status, 429); assert.ok(+blocked.headers['retry-after'] >= 1); assert.equal(blocked.headers['ratelimit-remaining'], '0');
    assert.match(blocked.body.toString(), /trop de requêtes/);
    assert.equal(blocked.headers['x-content-type-options'], 'nosniff');                       // les protections restent actives sur un 429
    assert.equal((await s.call('/health')).status, 200);                                      // sonde de supervision jamais bloquée
    assert.equal((await s.call('/shared.css')).status, 200);                                  // autre catégorie : autre compteur
    for (let i = 0; i < 7; i++) await s.call('/shared.css');
    assert.equal((await s.call('/shared.css')).status, 429);                                  // 8 pages/min dépassées
    assert.equal((await s.call('/health')).status, 200);                                      // compteur des pages épuisé : /health reste libre
    assert.equal((await s.call('/api/screener', { 'x-forwarded-for': '203.0.113.7' })).status, 429);   // en-tête falsifié : sans effet
  } finally { await s.stop(); }
});

test('limite de débit derrière un proxy de confiance : un compteur par client réel', async () => {
  const s = await launch({ RATE_API: '2', TRUST_PROXY: '1' });
  try {
    const as = ip => s.call('/api/screener', { 'x-forwarded-for': ip });
    assert.equal((await as('6.6.6.6, 1.1.1.1')).status, 200);
    assert.equal((await as('7.7.7.7, 1.1.1.1')).status, 200);                                 // « 6.6.6.6 » / « 7.7.7.7 » sont falsifiables : seul 1.1.1.1 compte
    assert.equal((await as('8.8.8.8, 1.1.1.1')).status, 429);                                 // même client réel → bloqué malgré un en-tête différent
    assert.equal((await as('8.8.8.8, 2.2.2.2')).status, 200);                                 // autre client réel → compteur neuf
    assert.match((await s.call('/market/gold', { 'x-forwarded-proto': 'https' })).headers['strict-transport-security'], /max-age=31536000/);
  } finally { await s.stop(); }
});

test('API saisonnalité : rapport complet calculé côté serveur, compressé, mis en cache', async () => {
  const r = await json(`/api/seasonal?code=${NQ.code}`, { 'accept-encoding': 'gzip' });
  assert.equal(r.status, 200); assert.equal(r.headers['content-encoding'], 'gzip');
  const S = r.data.report, now = new Date();
  assert.deepEqual([S.meta.year, S.meta.month], [now.getUTCFullYear(), now.getUTCMonth()]);
  assert.equal(S.annual[10].length, 365); assert.equal(S.meta.doy >= 0 && S.meta.doy < 365, true);
  assert.equal(S.month[10].length, S.meta.daysInMonth);
  for (const k of ['annual', 'ytd', 'month', 'monthly', 'weekly', 'daily', 'kpi']) assert.ok(k in S, k);
  assert.ok(S.weekly.blocks.length >= 4 && S.weekly.blocks.length <= 5);
  // identique au calcul direct de calc.js sur les mêmes données
  const direct = CALC.seasonalReport(daily(), now);
  assert.deepEqual(S.kpi.avg, direct.kpi.avg);
  assert.equal((await get('/api/seasonal?code=zzz')).status, 400);
  const again = await get(`/api/seasonal?code=${NQ.code}`, { 'if-none-match': r.headers.etag });
  assert.equal(again.status, 304);                                                   // même rapport dans la journée : ETag stable
});

test('statut de fraîcheur : résumé global et détail par marché', async () => {
  const { data: g } = await json('/api/status');
  assert.equal(g.markets.total, MARKETS.length);
  assert.equal(g.markets.ok, 2);                                                    // seuls Nasdaq et Or ont des données (factices mais fraîches)
  assert.equal(g.markets.bad, MARKETS.length - 2); assert.equal(g.markets.warn, 0);
  assert.ok(['sqlite', 'json'].includes(g.storage)); assert.equal(g.attention.length, MARKETS.length - 2);
  assert.ok(!('errors' in g) && !JSON.stringify(g).includes('cache.json'), 'le résumé ne doit rien révéler de l\'installation');

  const { data: nq } = await json(`/api/status?code=${NQ.code}`);
  assert.equal(nq.level, 'ok'); assert.equal(nq.prices.stale, false); assert.equal(nq.cot.stale, false);
  assert.equal(nq.cot.reportDate, cotHist().at(-1)[0]);                              // date du dernier rapport, lue dans les données
  assert.ok(nq.cot.next.at > Date.now() - 36e5, "le prochain rapport est à venir, ou publié depuis moins d'une heure (fenêtre qui suit chaque publication)");
  assert.match(nq.cot.next.releaseDate, /^\d{4}-\d{2}-\d{2}$/);

  const vide = MARKETS.find(m => m.slug === 'wheat'), { data: w } = await json(`/api/status?code=${vide.code}`);
  assert.equal(w.level, 'bad'); assert.equal(w.prices.missing, true); assert.equal(w.cot.missing, true);
  assert.equal((await get('/api/status?code=zzz')).status, 400);
});

test('screener : chaque ligne porte son niveau de fraîcheur', async () => {
  const { data } = await json('/api/screener');
  assert.equal(data.rows.find(r => r.slug === 'nasdaq-100').fresh, 'ok');
  assert.equal(data.rows.find(r => r.slug === 'wheat').fresh, 'bad');
});

test('page de comparaison : servie, avec son script, et le lien « Comparer » sur les fiches', async () => {
  const page = await get('/compare?a=gold&b=corn');
  assert.equal(page.status, 200); assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body.toString(), /id="selA"/); assert.match(page.body.toString(), /id="selB"/);
  assert.equal((await get('/compare.js')).status, 200);
  assert.equal((await get('/compare.html')).status, 404);                            // les gabarits ne sont pas servis directement
});
