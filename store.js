// Persistance du cache des données : SQLite (module intégré node:sqlite) avec repli automatique sur un fichier JSON.
// Chaque (jeu de données, marché) est une ligne : une mise à jour n'écrit que cette ligne (quelques dizaines de Ko),
// au lieu de réécrire les ~12 Mo du cache complet ; les écritures sont transactionnelles (WAL) donc sans fichier corrompu en cas d'arrêt brutal.
const fs = require('fs'), path = require('path');

const STORES = ['weekly', 'daily', 'cot', 'tff', 'disagg', 'macro', 'cash'];      // cash : indices au comptant (S&P 500, Nasdaq 100, Dow, Russell), pour ajuster les changements de contrat
const blank = () => ({ data: Object.fromEntries(STORES.map(s => [s, {}])), ts: Object.fromEntries(STORES.map(s => [s, {}])), meta: {} });

// Ancien format : un seul fichier cache.json { weekly:{code:…}, …, weeklyAt, dailyAt }. Sert à la migration et au mode JSON.
function readLegacy(dir) {
  let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, 'cache.json'), 'utf8')); } catch { return null; }
  const out = blank();
  for (const s of STORES) for (const [code, v] of Object.entries(j[s] || {})) {
    out.data[s][code] = v;
    // attention : sur un tableau, `v.at` est la MÉTHODE Array.prototype.at, pas un horodatage → vérifier le type
    const own = v && !Array.isArray(v) && typeof v.at === 'number' ? v.at : 0;
    out.ts[s][code] = (j._ts && j._ts[s] && j._ts[s][code]) || own || (s === 'weekly' ? j.weeklyAt : s === 'daily' ? j.dailyAt : 0) || 0;
  }
  if (j.lastRefresh || j.weeklyAt) out.meta.lastRefresh = j.lastRefresh || j.weeklyAt;
  return out;
}

function openSqlite(dir) {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'bulldesk.db'));
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS kv (store TEXT NOT NULL, code TEXT NOT NULL, ts INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (store, code)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, val TEXT NOT NULL) WITHOUT ROWID;`);
  const upsert = db.prepare('INSERT INTO kv (store, code, ts, json) VALUES (?, ?, ?, ?) ON CONFLICT (store, code) DO UPDATE SET ts = excluded.ts, json = excluded.json');
  const upMeta = db.prepare('INSERT INTO meta (key, val) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET val = excluded.val');

  // Première ouverture : reprend l'ancien cache.json s'il existe (une seule transaction : tout ou rien).
  if (db.prepare('SELECT COUNT(*) AS n FROM kv').get().n === 0) {
    const old = readLegacy(dir);
    if (old) {
      db.exec('BEGIN');
      try {
        for (const s of STORES) for (const [code, v] of Object.entries(old.data[s])) upsert.run(s, code, old.ts[s][code], JSON.stringify(v));
        for (const [k, v] of Object.entries(old.meta)) upMeta.run(k, String(v));
        db.exec('COMMIT');
        console.log('cache.json repris dans SQLite');
      } catch (e) { try { db.exec('ROLLBACK'); } catch {} db.close(); throw e; }       // libère le fichier avant de laisser l'erreur remonter
    }
  }
  return {
    kind: 'sqlite',
    load() {
      const out = blank();
      for (const r of db.prepare('SELECT store, code, ts, json FROM kv').all()) { if (!out.data[r.store]) continue; out.data[r.store][r.code] = JSON.parse(r.json); out.ts[r.store][r.code] = r.ts; }
      for (const r of db.prepare('SELECT key, val FROM meta').all()) out.meta[r.key] = +r.val;
      return out;
    },
    put(store, code, value, ts = Date.now()) { upsert.run(store, code, ts, JSON.stringify(value)); },
    putMeta(key, val) { upMeta.run(key, String(val)); },
    close() { db.close(); },
  };
}

// Repli : un seul fichier JSON réécrit en entier (après 500 ms de calme). Même interface que SQLite.
function openJson(dir) {
  const file = path.join(dir, 'cache.json'), state = readLegacy(dir) || blank();
  let timer;
  const flush = () => {
    clearTimeout(timer);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const j = { ...state.data, _ts: state.ts, lastRefresh: state.meta.lastRefresh };
      fs.writeFileSync(file + '.tmp', JSON.stringify(j)); fs.renameSync(file + '.tmp', file);      // écriture atomique
    } catch (e) { console.log('sauvegarde JSON :', e.message); }
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(flush, 500); };
  return {
    kind: 'json',
    load: () => state,
    put(store, code, value, ts = Date.now()) { state.data[store][code] = value; state.ts[store][code] = ts; later(); },
    putMeta(key, val) { state.meta[key] = +val; later(); },
    close() { flush(); },
  };
}

// Choisit SQLite si le module est disponible (Node ≥ 22.13), sinon JSON. STORE=json force le repli.
function openStore(dir, kind = process.env.STORE) {
  if (kind !== 'json') {
    try { return openSqlite(dir); }
    catch (e) { console.log('SQLite indisponible (' + e.message.split('\n')[0] + '), repli sur un fichier JSON'); }
  }
  return openJson(dir);
}

module.exports = { openStore, openSqlite, openJson, STORES };
