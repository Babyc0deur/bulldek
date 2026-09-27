const test = require('node:test'), assert = require('node:assert/strict');
const { createLimiter, clientIp, singleFlight } = require('../guard.js');

const clock = () => { let t = 1e6; const f = () => t; f.advance = ms => { t += ms; }; return f; };
const req = (ip, xff) => ({ socket: { remoteAddress: ip }, headers: xff ? { 'x-forwarded-for': xff } : {} });

test('limiteur : bloque au-delà de la limite puis rouvre à la fenêtre suivante', () => {
  const now = clock(), L = createLimiter({ windowMs: 60000, now });
  for (let i = 1; i <= 3; i++) { const r = L.hit('a', 3); assert.equal(r.ok, true); assert.equal(r.remaining, 3 - i); }
  const blocked = L.hit('a', 3);
  assert.equal(blocked.ok, false); assert.equal(blocked.remaining, 0); assert.equal(blocked.retryAfter, 60);
  now.advance(20000);
  assert.equal(L.hit('a', 3).retryAfter, 40);                                   // le compte à rebours suit l'horloge
  now.advance(40000);
  assert.equal(L.hit('a', 3).ok, true);                                         // nouvelle fenêtre
});

test('limiteur : chaque clé a son propre compteur', () => {
  const L = createLimiter({ now: clock() });
  L.hit('a|api', 1); assert.equal(L.hit('a|api', 1).ok, false);
  assert.equal(L.hit('b|api', 1).ok, true);                                     // autre client
  assert.equal(L.hit('a|static', 1).ok, true);                                  // autre catégorie
});

test('limiteur : la mémoire reste bornée et le nettoyage supprime les fenêtres expirées', () => {
  const now = clock(), L = createLimiter({ windowMs: 1000, maxKeys: 3, now });
  ['a', 'b', 'c'].forEach(k => L.hit(k, 5));
  assert.equal(L.size(), 3);
  assert.equal(L.hit('d', 5).ok, true); assert.equal(L.size(), 3);              // saturé : laisse passer sans stocker
  now.advance(1500); L.sweep(); assert.equal(L.size(), 0);
  assert.equal(L.hit('d', 5).ok, true); assert.equal(L.size(), 1);
});

test('adresse client : X-Forwarded-For ignoré sans proxy de confiance (anti-contournement)', () => {
  assert.equal(clientIp(req('10.0.0.1', '1.2.3.4'), 0), '10.0.0.1');            // falsifiable : on l'ignore
  assert.equal(clientIp(req('::ffff:10.0.0.1'), 0), '10.0.0.1');                // IPv4 mappée en IPv6
  assert.equal(clientIp({ socket: {}, headers: {} }, 0), 'inconnu');
});

test('adresse client : avec un proxy de confiance, on lit la valeur écrite par ce proxy', () => {
  // Un client malveillant peut écrire « 6.6.6.6 » ; notre proxy ajoute ensuite la vraie adresse à la fin de la liste.
  assert.equal(clientIp(req('10.0.0.1', '6.6.6.6, 203.0.113.9'), 1), '203.0.113.9');
  assert.equal(clientIp(req('10.0.0.1', '6.6.6.6, 203.0.113.9, 10.1.1.1'), 2), '203.0.113.9');   // deux proxys
  assert.equal(clientIp(req('10.0.0.1'), 1), '10.0.0.1');                       // en-tête absent → adresse du socket
  assert.equal(clientIp(req('10.0.0.1', '203.0.113.9'), 3), '10.0.0.1');        // chaîne plus courte que prévu → socket
});

test('singleFlight : les appels simultanés partagent une seule requête', async () => {
  let calls = 0, release;
  const gate = new Promise(r => { release = r; });
  const get = singleFlight(async k => { calls++; await gate; return 'v:' + k; });
  const ps = [get('x'), get('x'), get('x'), get('y')];
  release();
  assert.deepEqual(await Promise.all(ps), ['v:x', 'v:x', 'v:x', 'v:y']);
  assert.equal(calls, 2);                                                       // une fois pour x, une fois pour y
  assert.equal(await get('x'), 'v:x'); assert.equal(calls, 3);                  // terminé : un nouvel appel repart
});

test('singleFlight : une clé en échec est mise en pause puis réessayée', async () => {
  const now = clock(); let calls = 0, fail = true;
  const get = singleFlight(async () => { calls++; if (fail) throw new Error('source en panne'); return 'ok'; }, { cooldownMs: 60000, now });
  await assert.rejects(get('k'), /source en panne/); assert.equal(calls, 1);
  await assert.rejects(get('k'), /source en panne/); assert.equal(calls, 1);    // pause : la source n'est pas re-sollicitée
  now.advance(61000); fail = false;
  assert.equal(await get('k'), 'ok'); assert.equal(calls, 2);                   // pause terminée
});
