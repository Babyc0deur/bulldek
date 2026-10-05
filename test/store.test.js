// Le stockage doit se comporter de la même façon avec SQLite et avec le repli JSON.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { openSqlite, openJson, openStore } = require('../store.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bd-store-'));
let sqliteOk = true; try { require('node:sqlite'); } catch { sqliteOk = false; }
const BACKENDS = [['SQLite', openSqlite, !sqliteOk && 'node:sqlite indisponible sur cette version de Node'], ['JSON', openJson, false]];

for (const [nom, open, skip] of BACKENDS) {
  test(`${nom} : écrire, relire après réouverture, écraser`, { skip }, () => {
    const dir = tmp();
    let s = open(dir);
    const rows = [[1, 10.5, 11, 10], [2, 11.5, 12, 11]], cot = { at: 5, latest: { report_date_as_yyyy_mm_dd: '2026-09-15' }, hist: [['2026-09-15', 1, 2]] };
    s.put('daily', '209742', rows, 1000); s.put('cot', '209742', cot, 2000); s.put('daily', '088691', [[3, 1, 1, 1]], 3000);
    s.putMeta('lastRefresh', 4000);
    s.put('daily', '209742', [[9, 9, 9, 9]], 5000);                            // écrasement : la dernière valeur gagne
    s.close();
    s = open(dir);
    const d = s.load();
    assert.deepEqual(d.data.daily['209742'], [[9, 9, 9, 9]]); assert.equal(d.ts.daily['209742'], 5000);
    assert.deepEqual(d.data.daily['088691'], [[3, 1, 1, 1]]);
    assert.deepEqual(d.data.cot['209742'], cot); assert.equal(d.ts.cot['209742'], 2000);
    assert.deepEqual(d.data.weekly, {}); assert.equal(d.meta.lastRefresh, 4000);
    s.close(); fs.rmSync(dir, { recursive: true, force: true });
  });

  test(`${nom} : base vide au premier démarrage`, { skip }, () => {
    const dir = tmp(), s = open(dir), d = s.load();
    assert.deepEqual(Object.keys(d.data).sort(), ['cash', 'cot', 'daily', 'disagg', 'macro', 'tff', 'weekly']);
    assert.deepEqual(d.data.daily, {}); assert.deepEqual(d.meta, {});
    s.close(); fs.rmSync(dir, { recursive: true, force: true });
  });

  test(`${nom} : reprend un ancien cache.json (migration)`, { skip }, () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'cache.json'), JSON.stringify({
      weekly: { A: [[1, 2, 3, 1]] }, daily: { A: [[1, 2, 3, 1]] }, cot: { A: { at: 777, latest: {}, hist: [] } }, tff: {}, disagg: {},
      weeklyAt: 111, dailyAt: 222 }));
    const s = open(dir), d = s.load();
    assert.deepEqual(d.data.weekly.A, [[1, 2, 3, 1]]);
    assert.equal(d.ts.weekly.A, 111); assert.equal(d.ts.daily.A, 222); assert.equal(d.ts.cot.A, 777);   // horodatages par marché reconstitués
    assert.equal(d.meta.lastRefresh, 111);
    s.close(); fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('SQLite : une mise à jour n\'écrit pas tout le cache (le fichier grossit à peine)', { skip: !sqliteOk && 'node:sqlite indisponible' }, () => {
  const dir = tmp(), s = openSqlite(dir), big = Array.from({ length: 5000 }, (_, i) => [i, i * 1.5, i * 1.5 + 1, i * 1.5 - 1]);
  for (let i = 0; i < 20; i++) s.put('daily', 'M' + i, big);                    // 20 marchés × 5000 séances
  const wal = path.join(dir, 'bulldesk.db-wal'), size = () => (fs.existsSync(wal) ? fs.statSync(wal).size : 0);
  const avant = size(); s.put('daily', 'M0', big); const apres = size();
  assert.ok(apres - avant < 400 * 1024, `une mise à jour a écrit ${apres - avant} octets (le cache entier ferait plusieurs Mo)`);
  s.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('SQLite : une migration interrompue à mi-chemin ne laisse rien (tout ou rien)', { skip: !sqliteOk && 'node:sqlite indisponible' }, () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'cache.json'), JSON.stringify({ weekly: { A: [[1, 2, 3, 1]], B: [[1, 2, 3, 1]], C: [[1, 2, 3, 1]] }, daily: {}, cot: {}, tff: {}, disagg: {}, weeklyAt: 5 }));
  const realStringify = JSON.stringify; let calls = 0;
  JSON.stringify = (...a) => { if (++calls === 2) throw new Error('panne simulée pendant la reprise'); return realStringify(...a); };   // 2e ligne : échec
  try { assert.throws(() => openSqlite(dir), /panne simulée/); } finally { JSON.stringify = realStringify; }
  const { DatabaseSync } = require('node:sqlite'), db = new DatabaseSync(path.join(dir, 'bulldesk.db'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kv').get().n, 0, 'la 1re ligne aurait dû être annulée');
  db.close();
  const s = openSqlite(dir);                                                                  // le démarrage suivant reprend normalement
  assert.deepEqual(Object.keys(s.load().data.weekly).sort(), ['A', 'B', 'C']);
  s.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('openStore : STORE=json force le repli, et le choix par défaut fonctionne', () => {
  const dir = tmp();
  assert.equal(openStore(dir, 'json').kind, 'json');
  const s = openStore(tmp()); assert.ok(['sqlite', 'json'].includes(s.kind));
  if (sqliteOk) assert.equal(s.kind, 'sqlite');
  s.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('JSON : un fichier tronqué ou illisible ne fait pas tomber le démarrage', () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'cache.json'), '{"weekly": {"A": [[1,2');
  const s = openJson(dir); assert.deepEqual(s.load().data.daily, {});                       // repart d'un cache vide
  s.close(); fs.rmSync(dir, { recursive: true, force: true });
});
