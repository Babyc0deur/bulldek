// Protections de l'API : limiteur de débit, identification du client, et déduplication des appels aux sources externes.
// Module pur (horloge injectable) pour être testé sans serveur ni réseau.

// Limiteur à fenêtre fixe : au plus `limit` requêtes par clé et par fenêtre.
function createLimiter({ windowMs = 60000, maxKeys = 100000, now = Date.now } = {}) {
  const buckets = new Map();
  function sweep() { const t = now(); for (const [k, e] of buckets) if (t >= e.reset) buckets.delete(k); }
  function hit(key, limit) {
    const t = now();
    let e = buckets.get(key);
    if (!e || t >= e.reset) {
      if (!e && buckets.size >= maxKeys) { sweep(); if (buckets.size >= maxKeys) return { ok: true, limit, remaining: limit, retryAfter: 0 }; }  // saturation : on laisse passer plutôt que de bloquer tout le monde
      e = { n: 0, reset: t + windowMs }; buckets.set(key, e);
    }
    e.n++;
    return { ok: e.n <= limit, limit, remaining: Math.max(0, limit - e.n), retryAfter: Math.max(1, Math.ceil((e.reset - t) / 1000)) };
  }
  return { hit, sweep, size: () => buckets.size };
}

// Adresse du client. Derrière un proxy (Render, nginx…), X-Forwarded-For est ajouté par chaque proxy : seule la valeur
// écrite par NOTRE proxy est fiable, c'est-à-dire la n-ième en partant de la droite (n = nombre de proxys de confiance).
// Avec 0 proxy de confiance, l'en-tête est ignoré : sinon n'importe quel client pourrait contourner la limite en le falsifiant.
function clientIp(req, trustedProxies = 0) {
  const clean = ip => String(ip || '').trim().replace(/^::ffff:/, '');
  const socketIp = clean(req.socket && req.socket.remoteAddress) || 'inconnu';
  if (!trustedProxies) return socketIp;
  const chain = String(req.headers['x-forwarded-for'] || '').split(',').map(clean).filter(Boolean);
  return chain[chain.length - trustedProxies] || socketIp;
}

// Regroupe les appels simultanés à la même clé en un seul (évite d'inonder une source externe quand 100 visiteurs
// demandent la même donnée manquante), et met les clés en échec en pause `cooldownMs` avant de réessayer.
function singleFlight(fn, { cooldownMs = 60000, now = Date.now } = {}) {
  const inflight = new Map(), failed = new Map();
  return key => {
    if (inflight.has(key)) return inflight.get(key);
    const f = failed.get(key);
    if (f && now() - f.at < cooldownMs) return Promise.reject(f.err);
    const p = (async () => {
      try { const r = await fn(key); failed.delete(key); return r; }
      catch (err) { failed.set(key, { at: now(), err }); throw err; }
      finally { inflight.delete(key); }
    })();
    inflight.set(key, p);
    return p;
  };
}

module.exports = { createLimiter, clientIp, singleFlight };
