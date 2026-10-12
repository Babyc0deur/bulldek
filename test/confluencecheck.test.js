// Fiabilité mesurée de la confluence (confluencecheck.js) : résumé par niveau, rejeu sans regarder le futur, branchement serveur et affichage.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const CC = require('../confluencecheck.js');

const nq = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'nq-daily.json'), 'utf8'));
const cotHist = Array.from({ length: 600 }, (_, i) => [new Date(Date.UTC(2015, 0, 6) + i * 7 * 864e5).toISOString().slice(0, 10), 100 + ((i * 7) % 90), 40 + (i % 13), 5, 5, 5, 5, 500 + i]);

test('résumé : parts de hausses et de baisses par niveau de confluence, référence sur toutes les semaines', () => {
  const t0 = Date.UTC(2020, 0, 3) / 1e3, mk = (score, fwd, k) => ({ t: t0 + k * 604800, score, fwd });
  const list = [mk(3, 1, 0), mk(2, -1, 1), mk(2, 2, 2), mk(2, 1, 3), mk(-2, -1, 4), mk(-3, 1, 5), mk(0, 1, 6), mk(0, -1, 7)];
  const s = CC.summarize(list);
  assert.equal(s.weeks, 8); assert.equal(s.horizon, 5); assert.equal(s.from, '2020-01-03');
  assert.deepEqual(s.bull, { n: 4, up: 75, down: 25 }); assert.deepEqual(s.bear, { n: 2, up: 50, down: 50 });
  assert.deepEqual(s.base, { up: 62.5, down: 37.5 });
  assert.equal(CC.summarize([]), null);
});

test('rejeu : une mesure par fin de semaine, rendement sur 5 séances, jamais de donnée du futur ; historique trop court → rien', () => {
  const list = CC.samples({ rows: nq, raw: nq, legacyHist: cotHist });
  assert.ok(list.length > 50, 'semaines mesurées : ' + list.length);
  const idx = new Map(nq.map((r, i) => [r[0], i]));
  for (const x of list.slice(0, 40)) {
    const i = idx.get(x.t); assert.ok(i != null && i + CC.HORIZON < nq.length);
    assert.ok(Math.abs(x.fwd - (nq[i + CC.HORIZON][1] / nq[i][1] - 1) * 100) < 1e-9);
    assert.ok(Number.isInteger(x.score) && Math.abs(x.score) <= 4);
  }
  const wk = t => { const d = new Date(t * 1e3), w = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - w); };
  assert.equal(new Set(list.map(x => wk(x.t))).size, list.length, 'une seule mesure par semaine');
  assert.deepEqual(CC.samples({ rows: nq.slice(0, 100), raw: nq.slice(0, 100), legacyHist: cotHist }), []);
  assert.deepEqual(CC.samples({ rows: nq, raw: nq, legacyHist: cotHist.slice(0, 10) }), []);
});

test('rejeu sans regard vers le futur : modifier les prix après une date ne change pas les scores avant cette date', () => {
  const cut = Math.floor(nq.length * 0.8), alt = nq.map((r, i) => (i > cut + 6 ? [r[0], r[1] * 1.5, r[2] * 1.5, r[3] * 1.5] : r));
  const a = CC.samples({ rows: nq, raw: nq, legacyHist: cotHist }), b = CC.samples({ rows: alt, raw: alt, legacyHist: cotHist });
  const tCut = nq[cut][0], pa = a.filter(x => x.t <= tCut), pb = b.filter(x => x.t <= tCut);
  assert.ok(pa.length > 30); assert.deepEqual(pa.map(x => x.score), pb.map(x => x.score));
});

test('serveur et pages : route à la demande, sondage tant que le calcul est en cours, mention de la fiabilité sous la pastille et sous le panneau de la fiche', () => {
  const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(rd('server.js'), /\/api\/confluence-check/); assert.match(rd('server.js'), /CONFCHECK = require\('\.\/confluencecheck\.js'\)/);
  assert.match(rd('screener.js'), /\/api\/confluence-check/); assert.match(rd('screener.js'), /toutes semaines/); assert.match(rd('screener.js'), /trop peu de cas/);
  assert.match(rd('market.js'), /fillConfluenceAccuracy/); assert.match(rd('market.js'), /Fiabilité mesurée sur ce marché/);
});
